// backend/routes/audits.js
'use strict';

const express = require('express');
const router = express.Router();

// ---------------- Models ----------------
const Audit = require('../models/Audit');
const User  = require('../models/User');

// ---------------- Collectors ----------------
const { collectGoogle } = require('../jobs/collect/googleCollector'); // Google Ads
const { collectMeta   } = require('../jobs/collect/metaCollector');   // Meta Ads

// GA4 (aceptamos varios paths por compatibilidad)
let collectGA4 = null;
try { ({ collectGA4 } = require('../jobs/collect/ga4Collector')); }
catch (_) {
  try { ({ collectGA4 } = require('../jobs/collect/googleAnalyticsCollector')); }
  catch (_) {
    try { ({ collectGA4 } = require('../jobs/collect/googleAnalytics')); }
    catch (_) { collectGA4 = null; }
  }
}

// ---------------- LLM (opcional; con fallback heurístico) ----------------
let generateAudit = null;
try { generateAudit = require('../jobs/llm/generateAudit'); } catch { generateAudit = null; }

// ---------------- Auth ----------------
function requireAuth(req, _res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return next({ status: 401, message: 'UNAUTHENTICATED' });
}

// ---------------- Normalizadores / Utils ----------------
const OK_AREAS = new Set(['setup','performance','creative','tracking','budget','bidding','otros']);
const sevRank  = { alta: 3, media: 2, baja: 1 };

const safeStr = (v, fb = '') => (typeof v === 'string' ? v : fb);
const cap     = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);

/* ========= CONFIG DE PLANES (uso de auditorías) =========
 *
 * Claves internas de plan que mandaremos al frontend:
 *  - gratis
 *  - emprendedor
 *  - crecimiento
 *  - pro
 *
 * Puedes ajustar los límites cuando quieras.
 */
const PLAN_CONFIG = {
  // 1 auditoría IA al mes
  gratis: {
    limit: 1,
    period: 'daily',
    unlimited: false,
  },
  // 2 auditorías IA al mes
  emprendedor: {
    limit: 2,
    period: 'monthly',
    unlimited: false,
  },
  // Auditorías semanales (1 por semana)
  crecimiento: {
    limit: 1,
    period: 'weekly',
    unlimited: false,
  },
  // Auditorías ilimitadas
  pro: {
    limit: null,
    period: 'unlimited',
    unlimited: true,
  },
};

/**
 * Normaliza el plan guardado en Mongo a nuestras claves internas.
 * Soporta variantes tipo: "free", "gratis", "growth", "crecimiento", etc.
 */
function normalizePlan(rawPlan) {
  const v = String(rawPlan || '').toLowerCase().trim();

  if (['free', 'gratis', 'plan_free', 'plan_gratis'].includes(v)) return 'gratis';
  if (['emprendedor', 'entrepreneur', 'starter', 'plan_emprendedor'].includes(v)) return 'emprendedor';
  if (['crecimiento', 'growth', 'growth_plus', 'plan_crecimiento'].includes(v)) return 'crecimiento';
  if (['pro', 'plan_pro'].includes(v)) return 'pro';

  // fallback por defecto
  return 'gratis';
}

function getWindowForPeriod(period) {
  const now = new Date();
  const start = new Date(now);
  const end   = new Date(now);

  if (period === 'daily') {
    // Ventana: hoy 00:00 → mañana 00:00 (hora local del servidor)
    start.setHours(0, 0, 0, 0);
    end.setDate(start.getDate() + 1);
    end.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    // Semana tipo lunes-domingo
    const day = start.getDay(); // 0 dom, 1 lun...
    const diffToMonday = (day + 6) % 7;
    start.setDate(start.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);

    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
    end.setHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    // Mes calendario
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    end.setMonth(start.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);
  } else if (period === 'rolling') {
    // Rolling 15 días
    start.setDate(start.getDate() - 15);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    // unlimited
    start.setTime(0);
    end.setFullYear(now.getFullYear() + 10);
  }

  return { start, end };
}


const toSev = (s) => {
  const v = String(s || '').toLowerCase().trim();
  if (v === 'alta' || v === 'high')  return 'alta';
  if (v === 'baja' || v === 'low')   return 'baja';
  return 'media';
};
const toArea = (a) => {
  const v = String(a || '').toLowerCase().trim();
  return OK_AREAS.has(v) ? v : 'performance';
};

function normalizeIssue(raw, i = 0, type = 'google') {
  const id    = safeStr(raw?.id, `iss-${type}-${Date.now()}-${i}`).trim();
  const area  = toArea(raw?.area);
  const title = safeStr(raw?.title, 'Hallazgo').trim();
  const sev   = toSev(raw?.severity);

  const base = {
    id,
    area,
    title,
    severity: sev,
    evidence: safeStr(raw?.evidence, ''),
    metrics: raw?.metrics && typeof raw.metrics === 'object' ? raw.metrics : {},
    recommendation: safeStr(raw?.recommendation, ''),
    estimatedImpact: ['alto','medio','bajo'].includes(String(raw?.estimatedImpact || '').toLowerCase())
      ? String(raw.estimatedImpact).toLowerCase()
      : null,
    blockers: Array.isArray(raw?.blockers) ? raw.blockers.map(String) : [],
    links: Array.isArray(raw?.links)
      ? raw.links.map(l => ({ label: safeStr(l?.label, ''), url: safeStr(l?.url, '') }))
      : [],
  };

  // compat: campaignRef → guardado dentro de metrics
  if (raw?.campaignRef && typeof raw.campaignRef === 'object') {
    base.metrics = {
      ...base.metrics,
      campaignRef: {
        id:   safeStr(raw.campaignRef.id, ''),
        name: safeStr(raw.campaignRef.name, ''),
      }
    };
  }
  // GA (segmentRef)
  if (raw?.segmentRef && typeof raw.segmentRef === 'object') {
    base.metrics = {
      ...base.metrics,
      segmentRef: {
        type: safeStr(raw.segmentRef.type, ''),
        name: safeStr(raw.segmentRef.name, ''),
      }
    };
  }
  return base;
}

function normalizeIssues(list, type = 'google', limit = 10) {
  if (!Array.isArray(list)) return [];
  return cap(list, limit).map((it, i) => normalizeIssue(it, i, type));
}

function buildSetupIssue({ title, evidence, type }) {
  return normalizeIssue({
    id: `setup-${type}-${Date.now()}`,
    area: 'setup',
    title,
    severity: 'alta',
    evidence,
    recommendation:
      type === 'google'
        ? 'Revisa los permisos (scope "adwords") y asegúrate de tener campañas activas o histórico. Si trabajas vía MCC, valida login-customer-id y el vínculo MCC.'
        : type === 'meta'
        ? 'Revisa permisos (ads_read/ads_management) y confirma que hay cuentas con campañas activas. Valida el píxel/eventos en Events Manager.'
        : 'Conecta la propiedad de GA4 y confirma que hay datos en el rango de fechas.',
  }, 0, type);
}

function sortIssuesBySeverityThenImpact(issues) {
  return [...issues].sort((a, b) => {
    const s = (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
    if (s !== 0) return s;
    const ib = b.estimatedImpact === 'alto' ? 3 : b.estimatedImpact === 'medio' ? 2 : b.estimatedImpact === 'bajo' ? 1 : 0;
    const ia = a.estimatedImpact === 'alto' ? 3 : a.estimatedImpact === 'medio' ? 2 : a.estimatedImpact === 'bajo' ? 1 : 0;
    return ib - ia;
  });
}

/* ================= Helpers para repartir 6/3-3/2-2-2 por cuenta ================= */

function computeQuota(num) {
  if (num <= 1) return { per: 6, takeAccounts: 1 };
  if (num === 2) return { per: 3, takeAccounts: 2 };
  return { per: 2, takeAccounts: 3 };
}

function accountKeyFromIssue(it) {
  return (
    it.metrics?.campaignRef?.accountId || // si el LLM lo incluyera
    it.metrics?.accountId ||
    it.metrics?.account ||
    null
  );
}

function annotateTitleWithAccount(issue, label) {
  if (!label) return issue;
  const t = String(issue.title || '').trim();
  if (!t.startsWith('[')) issue.title = `[${label}] ${t}`;
  return issue;
}

function distributeByAccounts(issues, selectedIds = [], accountMap = {}) {
  const cleanSelected = Array.isArray(selectedIds) ? [...new Set(selectedIds.map(String))] : [];
  const { per, takeAccounts } = computeQuota(cleanSelected.length || 1);

  // bucket: accountId -> issues[]
  const bucket = new Map();
  for (const id of cleanSelected.slice(0, takeAccounts)) bucket.set(String(id), []);
  if (bucket.size === 0) bucket.set('default', []);

  const ranked = sortIssuesBySeverityThenImpact(issues);

  // Asignación por accountKey
  for (const it of ranked) {
    const k = accountKeyFromIssue(it);
    if (k && bucket.has(String(k)) && bucket.get(String(k)).length < per) {
      bucket.get(String(k)).push(it);
    }
  }

  // Relleno round-robin
  const leftovers = ranked.filter(it => ![...bucket.values()].some(arr => arr.includes(it)));
  const order = [...bucket.keys()];
  let idx = 0;
  for (const it of leftovers) {
    let placed = false;
    for (let tries = 0; tries < order.length; tries++) {
      const key = order[idx % order.length];
      const arr = bucket.get(key);
      if (arr.length < per) {
        arr.push(it);
        placed = true;
        idx++;
        break;
      }
      idx++;
    }
    if (!placed) break;
  }

  const out = [];
  for (const [key, arr] of bucket.entries()) {
    const label =
      key === 'default'
        ? null
        : (accountMap[key]?.name || accountMap[key]?.label || `Cuenta ${key}`);
    for (const it of arr) out.push(annotateTitleWithAccount(it, label));
  }

  return out.slice(0, 6);
}

/** Extrae entidades del snapshot para mapear ids->nombre por fuente */
function extractEntitiesForSnapshot(type, snap) {
  // GOOGLE y META: preferimos snap.accounts [{id,name,...}]
  if (type === 'google' || type === 'meta') {
    const ids = Array.isArray(snap?.accountIds) ? snap.accountIds.map(String) : [];
    const map = {};
    if (Array.isArray(snap?.accounts)) {
      for (const a of snap.accounts) {
        const id = String(a.id || '');
        if (id) map[id] = { name: a.name || `Cuenta ${id}` };
      }
    }
    if (!Object.keys(map).length && Array.isArray(snap?.byCampaign)) {
      for (const c of snap.byCampaign) {
        const id = String(c.account_id || '');
        if (id && !map[id]) map[id] = { name: c.accountMeta?.name || `Cuenta ${id}` };
      }
    }
    return { ids, map };
  }

  // GA4: usa propiedades de byProperty
  if (type === 'ga4') {
    const props = Array.isArray(snap?.byProperty) ? snap.byProperty : [];
    const ids = props.map(p => String(p.property || '')).filter(Boolean);
    const map = {};
    for (const p of props) {
      const id = String(p.property || '');
      if (!id) continue;
      const name = p.propertyName
        ? `${p.propertyName}${p.accountName ? ` — ${p.accountName}` : ''}`
        : (p.accountName ? `${id} — ${p.accountName}` : id);
      map[id] = { name };
    }
    if (!props.length && snap?.property) {
      const id = String(snap.property);
      ids.push(id);
      map[id] = { name: snap.propertyName || id };
    }
    return { ids, map };
  }

  return { ids: [], map: {} };
}

/** Inyecta metrics.accountId en issues usando campaignRef + snapshot (por si el LLM no lo puso) */
function injectAccountOnIssues(issues = [], snap = {}) {
  try {
    // índice campId -> accountId
    const idx = new Map();
    if (Array.isArray(snap.byCampaign)) {
      for (const c of snap.byCampaign) {
        const campId = String(c?.id || c?.campaign_id || '');
        const accId  = String(c?.account_id || '');
        if (campId && accId) idx.set(campId, accId);
      }
    }
    for (const it of issues) {
      const has = it?.metrics?.accountId || it?.metrics?.account || it?.metrics?.campaignRef?.accountId;
      if (has) continue;
      const camp = it?.campaignRef?.id || it?.metrics?.campaignRef?.id;
      const accId = camp ? idx.get(String(camp)) : null;
      if (accId) {
        it.metrics = it.metrics || {};
        it.metrics.accountId = accId;
        if (it.metrics.campaignRef && !it.metrics.campaignRef.accountId) {
          it.metrics.campaignRef.accountId = accId;
        }
      }
    }
  } catch {}
  return issues;
}

// ===== Fallback: si no hay issues, espejar actionCenter =====
function mirrorActionCenterToIssues(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  const hasIssues = Array.isArray(out.issues) && out.issues.length > 0;
  const ac = Array.isArray(out.actionCenter) ? out.actionCenter : [];
  if (!hasIssues && ac.length) {
    out.issues = ac.map((x, i) =>
      normalizeIssue(
        {
          title: x.title,
          evidence: x.evidence || x.description || x.detail || '',
          recommendation: x.recommendation || x.action || '',
          severity: toSev(x.severity || 'media'),
          area: x.area || 'performance',
          campaignRef: x.campaignRef,
          metrics: x.metrics,
        },
        i,
        out.type || 'google'
      )
    );
  }
  return out;
}

// ---------------- Heurísticos ----------------
function heuristicsFromGoogle(snap) {
  const issues = [];
  const byCamp = Array.isArray(snap?.byCampaign) ? snap.byCampaign : [];
  for (const c of byCamp.slice(0, 50)) {
    const k = c.kpis || {};
    const impr = Number(k.impressions||0);
    const clk  = Number(k.clicks||0);
    const cost = Number(k.cost||0);
    const conv = Number(k.conversions||0);
    const value= Number(k.conv_value||0);
    const ctr  = impr>0 ? (clk/impr)*100 : 0;
    const roas = cost>0 ? (value/cost) : 0;

    if (impr > 1000 && ctr < 1) {
      issues.push({
        area: 'performance',
        title: `CTR bajo · ${c.name || c.id}`,
        severity: 'media',
        evidence: `CTR ${ctr.toFixed(2)}% con ${impr} impresiones y ${clk} clics.`,
        recommendation: 'Optimiza RSA/anuncios, extensiones y relevancia de keywords. Testea creatividades.',
        metrics: { ctr, impressions: impr, clicks: clk, campaign: c.name, accountId: c.account_id },
        campaignRef: { id: c.id, name: c.name }
      });
    }
    if (clk >= 150 && conv === 0 && cost > 0) {
      issues.push({
        area: 'performance',
        title: `Gasto sin conversiones · ${c.name || c.id}`,
        severity: 'alta',
        evidence: `Clicks ${clk}, coste ${cost.toFixed(2)} y 0 conversiones.`,
        recommendation: 'Revisa Search Terms, negativas y concordancias. Verifica la calidad de la landing.',
        metrics: { clicks: clk, cost, conversions: conv, campaign: c.name, accountId: c.account_id },
        campaignRef: { id: c.id, name: c.name }
      });
    }
    if (roas > 0 && roas < 1 && cost > 100) {
      issues.push({
        area: 'performance',
        title: `ROAS bajo · ${c.name || c.id}`,
        severity: 'media',
        evidence: `ROAS ${roas.toFixed(2)} con gasto ${cost.toFixed(2)}.`,
        recommendation: 'Ajusta pujas, audiencias y ubicaciones; evalúa pausar segmentos de bajo rendimiento.',
        metrics: { roas, cost, conv_value: value, campaign: c.name, accountId: c.account_id },
        campaignRef: { id: c.id, name: c.name }
      });
    }
  }
  return issues;
}

function heuristicsFromMeta(snap) {
  const issues = [];
  const byCamp = Array.isArray(snap?.byCampaign) ? snap.byCampaign : [];
  for (const c of byCamp.slice(0, 50)) {
    const k = c.kpis || {};
    const impr = Number(k.impressions||0);
    const clk  = Number(k.clicks||0);
    const spend= Number(k.spend||0);
    const roas = Number(k.roas||0);
    const ctr  = Number(k.ctr||0);

    if (impr > 2000 && ctr < 0.6) {
      issues.push({
        area: 'creative',
        title: `CTR bajo · ${c.name || c.id}`,
        severity: 'media',
        evidence: `CTR ${ctr.toFixed(2)}% con ${impr} impresiones.`,
        recommendation: 'Test A/B de creatividades y textos. Revisa el hook visual y la segmentación.',
        metrics: { impressions: impr, ctr, campaign: c.name, accountId: c.account_id },
        campaignRef: { id: c.id, name: c.name }
      });
    }
    if (spend > 100 && (roas > 0 && roas < 1)) {
      issues.push({
        area: 'performance',
        title: `ROAS bajo · ${c.name || c.id}`,
        severity: 'media',
        evidence: `ROAS ${roas.toFixed(2)} con inversión ${spend.toFixed(2)}.`,
        recommendation: 'Optimiza creatividades, audiencias y ubicaciones; revisa atribución y ventanas.',
        metrics: { roas, spend, campaign: c.name, accountId: c.account_id },
        campaignRef: { id: c.id, name: c.name }
      });
    }
  }
  return issues;
}

function heuristicsFromGA4(snap) {
  const issues = [];

  const props = Array.isArray(snap?.byProperty) && snap.byProperty.length
    ? snap.byProperty
    : (snap?.property
        ? [{
            property: snap.property,
            accountName: snap.accountName || '',
            propertyName: snap.propertyName || '',
            channels: Array.isArray(snap.channels) ? snap.channels : []
          }]
        : []);

  for (const p of props.slice(0, 10)) {
    const channels = Array.isArray(p.channels) ? p.channels : [];
    const totals = channels.reduce((a, c) => ({
      users:       a.users + Number(c.users || 0),
      sessions:    a.sessions + Number(c.sessions || 0),
      conversions: a.conversions + Number(c.conversions || 0),
      revenue:     a.revenue + Number(c.revenue || 0),
    }), { users:0, sessions:0, conversions:0, revenue:0 });

    const cr = totals.sessions > 0 ? (totals.conversions / totals.sessions) * 100 : 0;
    const paid = channels.filter(c => /paid|cpc|display|paid social/i.test(c.channel || ''));
    const paidSess = paid.reduce((a,c)=> a + Number(c.sessions||0), 0);
    const paidConv = paid.reduce((a,c)=> a + Number(c.conversions||0), 0);

    const accountLabel  = p.accountName ? ` — ${p.accountName}` : '';
    const propertyLabel = p.propertyName || p.property || '';

    if (totals.sessions > 200 && cr < 1) {
      issues.push({
        area: 'performance',
        title: `Tasa de conversión baja (${cr.toFixed(2)}%) · ${propertyLabel}${accountLabel}`,
        severity: 'alta',
        evidence: `Sesiones: ${totals.sessions}, Conversiones: ${totals.conversions}, CR: ${cr.toFixed(2)}%.`,
        recommendation: 'Revisa embudos clave, velocidad de página, mensajes de valor y configuración de eventos de conversión.',
        metrics: { ...totals, cr, accountId: p.property },
        segmentRef: {
          type: 'property',
          name: `${propertyLabel}${accountLabel ? ` — ${p.accountName}` : ''}`,
        },
      });
    }

    if (paidSess > 200 && paidConv === 0) {
      issues.push({
        area: 'performance',
        title: `Tráfico de pago sin conversiones · ${propertyLabel}${accountLabel}`,
        severity: 'media',
        evidence: `Se observaron ${paidSess} sesiones de canales de pago sin conversiones registradas.`,
        recommendation: 'Cruza datos con plataformas de Ads; revisa eventos de conversión (duplicados/filtros/consent) y la relevancia de landing pages.',
        metrics: { paidSessions: paidSess, paidConversions: paidConv, accountId: p.property },
        segmentRef: {
          type: 'property',
          name: `${propertyLabel}${accountLabel ? ` — ${p.accountName}` : ''}`,
        },
      });
    }
  }

  return issues;
}

// ---------------- Alias de fuentes (entrada) ----------------
const SOURCE_ALIASES = {
  ga: 'ga4',
  ga4: 'ga4',
  analytics: 'ga4',
  'google-analytics': 'ga4',
  googleanalytics: 'ga4',
};

// Valores válidos que se guardan en BD
const VALID_SOURCES_DB = ['google','meta','ga4'];

function normalizeSource(src = '') {
  const v = String(src).toLowerCase().trim();
  return SOURCE_ALIASES[v] || v;
}

/* ====== Helpers de selección (lee preferences y selected*; cae a snapshot) ====== */
function getSelectedIdsForType(type, user = {}, snap = {}) {
  const p = user?.preferences || {};
  if (type === 'meta') {
    const pref = p?.meta?.auditAccountIds || [];
    const legacy = user?.selectedMetaAccounts || [];
    return (pref.length ? pref : legacy).map(String);
  }
  if (type === 'google') {
    const pref = p?.googleAds?.auditAccountIds || [];
    const legacy = user?.selectedGoogleAccounts || [];
    return (pref.length ? pref : legacy).map(String);
  }
  if (type === 'ga4') {
    const pref = p?.googleAnalytics?.auditPropertyIds || [];
    const legacy = user?.selectedGAProperties || [];
    return (pref.length ? pref : legacy).map(String);
  }
  // fallback: ids del snapshot
  if (Array.isArray(snap?.accountIds)) return snap.accountIds.map(String);
  return [];
}

// ---------------- Núcleo: ejecutar una auditoría ----------------
async function runSingleAudit({ userId, type, flags, source = 'manual' }) {
  const persistType = SOURCE_ALIASES[type] || type;

  // 1) Si la fuente no está conectada → placeholder
  if (!flags[persistType]) {
    const doc = await Audit.create({
      userId,
      type: persistType,
      origin: source || 'manual',
      generatedAt: new Date(),
      resumen: 'Fuente no conectada',
      summary: 'Fuente no conectada',
      issues: [buildSetupIssue({ type: persistType, title: 'Fuente no conectada', evidence: 'Conecta la cuenta para auditar.' })],
      actionCenter: [],
      inputSnapshot: { notAuthorized: true, reason: 'NOT_CONNECTED' },
      version: 'audits@1.1.2',
    });
    return { type: persistType, ok: true, auditId: doc._id };
  }

  // 2) Colecta
  let snap = {};
  try {
    if (persistType === 'google') snap = await collectGoogle(userId);
    else if (persistType === 'meta') snap = await collectMeta(userId);
    else if (persistType === 'ga4') {
      if (typeof collectGA4 === 'function') snap = await collectGA4(userId);
      else return { type: persistType, ok: false, error: 'SOURCE_NOT_READY' };
    }
  } catch (e) {
    console.warn('COLLECTOR_ERROR', persistType, e?.message || e);
    snap = {};
  }

  // 3) Autorización y datos + normalización GA4
  const authorized = !snap?.notAuthorized;

  if (persistType === 'ga4') {
    const flatChannels =
      (Array.isArray(snap?.channels) ? snap.channels : [])
        .concat(
          Array.isArray(snap?.byProperty)
            ? snap.byProperty.flatMap(p => Array.isArray(p?.channels) ? p.channels : [])
            : []
        );
    if ((!snap.channels || !snap.channels.length) && flatChannels.length) {
      snap.channels = flatChannels;
    }
  }

  const hasData =
    persistType === 'ga4'
      ? (
          (Array.isArray(snap?.channels) && snap.channels.length > 0) ||
          (Array.isArray(snap?.byProperty) &&
            snap.byProperty.some(p => Array.isArray(p?.channels) && p.channels.length > 0)) ||
          (snap?.aggregate && (
            Number(snap.aggregate.users || 0) > 0 ||
            Number(snap.aggregate.sessions || 0) > 0 ||
            Number(snap.aggregate.conversions || 0) > 0 ||
            Number(snap.aggregate.revenue || 0) > 0
          ))
        )
      : (Array.isArray(snap?.byCampaign) && snap.byCampaign.length > 0);

  // 4) Generar issues
  let issues = [];
  let summary = '';

  if (!authorized) {
    issues.push(buildSetupIssue({
      type: persistType,
      title: 'Permisos insuficientes o acceso denegado',
      evidence: `Motivo: ${snap?.reason || 'no autorizado'}. Afecta a: ${(snap?.accountIds || []).join(', ') || 'N/D'}`,
    }));
    summary = 'No fue posible auditar por permisos insuficientes.';
  } else if (!hasData) {
    issues.push(buildSetupIssue({
      type: persistType,
      title: 'No se detectaron campañas/datos recientes',
      evidence: 'El snapshot no contiene campañas o datos en el rango consultado.',
    }));
    summary = 'No hay datos suficientes para auditar.';
  } else if (generateAudit) {
    try {
      const ai = await generateAudit({ type: persistType, inputSnapshot: snap });
      summary = safeStr(ai?.summary, '');
      issues  = normalizeIssues(ai?.issues, persistType, 10);
    } catch (e) {
      console.warn('LLM_ERROR', e?.message || e);
      issues = [];
    }
  }

  // 5) Fallback heurístico si no hay nada
  if (issues.length === 0 && hasData && authorized) {
    if (persistType === 'google') issues = heuristicsFromGoogle(snap);
    if (persistType === 'meta')   issues = heuristicsFromMeta(snap);
    if (persistType === 'ga4')    issues = heuristicsFromGA4(snap);
    summary = summary || 'Hallazgos generados con reglas básicas (fallback).';
  }

  // 5.1 Inyecta accountId en issues usando snapshot (por si el LLM no lo trajo)
  issues = injectAccountOnIssues(issues, snap);

  // 5.2 Reparto 6/3-3/2-2-2 por cuentas/props seleccionadas + anotación de títulos
  try {
    const user = await User.findById(userId).lean().select(
      'selectedMetaAccounts selectedGoogleAccounts selectedGAProperties preferences'
    );
    const selectedIds = getSelectedIdsForType(persistType, user, snap);
    const { map } = extractEntitiesForSnapshot(persistType, snap);
    issues = distributeByAccounts(
      issues,
      selectedIds.length ? selectedIds : (Array.isArray(snap.accountIds) ? snap.accountIds : []),
      map
    );
  } catch (e) {
    console.warn('ISSUE_DISTRIBUTION_WARN', e?.message || e);
  }

  // 6) Normaliza, ordena y persiste
  issues = normalizeIssues(issues, persistType, 10);
  const top3 = sortIssuesBySeverityThenImpact(issues).slice(0, 3);

  const doc = await Audit.create({
    userId,
    type: persistType,
    origin: source || 'manual',
    generatedAt: new Date(),
    resumen: summary,
    summary,
    issues,
    actionCenter: top3,
    topProducts: Array.isArray(snap?.topProducts) ? snap.topProducts : [],
    inputSnapshot: snap,
    version: 'audits@1.1.3',
  });

  return { type: persistType, ok: true, auditId: doc._id };
}

// (0) USO DE AUDITORÍAS (para GenerateAudit.tsx)
// GET /api/audits/usage
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // 👇 Importante: leemos también auditUsageResetAt para reiniciar al cambiar de plan
    const user = await User.findById(userId)
      .lean()
      .select('plan auditUsageResetAt createdAt');

    if (!user) {
      return res.status(401).json({ error: 'NO_USER' });
    }

    const planKey = normalizePlan(user.plan);
    const cfg = PLAN_CONFIG[planKey] || PLAN_CONFIG.gratis;

    let used = 0;
    let nextResetAt = null;

    if (!cfg.unlimited) {
      // 1) Ventana del periodo (mensual, semanal, etc.)
      let { start, end } = getWindowForPeriod(cfg.period);

      // 2) Si tenemos un "reset" (cambio de plan), empezamos a contar desde ahí
      let resetAt = null;
      if (user.auditUsageResetAt instanceof Date) {
        resetAt = user.auditUsageResetAt;
      } else if (user.auditUsageResetAt) {
        resetAt = new Date(user.auditUsageResetAt);
      }

      if (resetAt && resetAt > start && resetAt < end) {
        start = resetAt;
      }

      const range = { $gte: start, $lt: end };

      // 3) Traemos SOLO auditorías manuales (excluimos onboarding)
      const docs = await Audit.find({
        userId,
        origin: { $ne: 'onboarding' }, // ← onboarding no suma uso
        $or: [
          { generatedAt: range },
          { createdAt: range },
        ],
      })
        .select('generatedAt createdAt origin')
        .sort({ generatedAt: 1, createdAt: 1 })
        .lean();

      // 4) Agrupamos docs en "sesiones" (un clic en Generar Auditoría)
      //    google/meta/ga4 se crean casi al mismo tiempo, así que:
      //    - si la diferencia entre docs es < 30s → misma sesión
      //    - si es > 30s → nueva sesión (nuevo clic)
      const MAX_GAP_MS = 30 * 1000; // 30 segundos
      let sessions = 0;
      let lastTs = null;

      for (const d of docs) {
        const base = d.generatedAt || d.createdAt;
        if (!base) continue;

        const ts = base instanceof Date ? base.getTime() : new Date(base).getTime();
        if (!Number.isFinite(ts)) continue;

        if (!lastTs || ts - lastTs > MAX_GAP_MS) {
          sessions++; // nueva sesión de auditoría
        }
        lastTs = ts;
      }

      used = sessions;
      nextResetAt = end.toISOString();
    }

    return res.json({
      plan: planKey,      // "gratis" | "emprendedor" | "crecimiento" | "pro"
      limit: cfg.limit,   // número de auditorías IA del plan
      used,               // usos en el periodo
      period: cfg.period, // "monthly" | "weekly" | ...
      nextResetAt,        // cuándo se reinicia el periodo
      unlimited: cfg.unlimited,
    });
  } catch (e) {
    console.error('AUDIT_USAGE_ERROR:', e);
    return res.status(500).json({ error: 'FETCH_FAIL' });
  }
});


// (A) Ejecutar TODAS
router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId).lean();
    const flags = {
      google:  !!(req.body?.googleConnected  ?? user?.googleConnected),
      meta:    !!(req.body?.metaConnected    ?? user?.metaConnected),
      ga4:     !!(req.body?.googleConnected  ?? user?.googleConnected), // GA comparte login Google
    };

    const source = req.body?.source || 'manual';

    const results = [];
    for (const type of VALID_SOURCES_DB) {
      const r = await runSingleAudit({ userId, type, flags, source });
      results.push(r);
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

// (B) Ejecutar UNA (con alias de entrada)
router.post('/:source/run', requireAuth, async (req, res) => {
  const userId = req.user._id;
  const normalized = normalizeSource(req.params.source);

  if (!VALID_SOURCES_DB.includes(normalized)) {
    return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
  }

  try {
    const user = await User.findById(userId).lean();
    const flags = {
      google: !!user?.googleConnected,
      meta:   !!user?.metaConnected,
      ga4:    !!user?.googleConnected,
    };
    const source = req.body?.source || 'manual';
    const r = await runSingleAudit({ userId, type: normalized, flags, source });
    if (!r.ok) return res.status(400).json(r);
    return res.json({ ok: true, ...r });
  } catch (e) {
    console.error('AUDIT_SINGLE_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

// (C) Últimas (soporta ?type=all | google | meta | ga | ga4) con doble formato
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const qType = (req.query?.type ? normalizeSource(req.query.type) : 'all');

    if (qType === 'all') {
      const [googleDoc, metaDoc, gaDoc] = await Promise.all(
        ['google','meta','ga4'].map((t) =>
          Audit.findOne({ userId, type: t }).sort({ generatedAt: -1 }).lean()
        )
      );

      const items = [googleDoc, metaDoc, gaDoc]
        .map(mirrorActionCenterToIssues)
        .filter(Boolean);

      return res.json({
        ok: true,
        data: {
          google: items.find(d => d?.type === 'google') || null,
          meta:   items.find(d => d?.type === 'meta')   || null,
          ga4:    items.find(d => d?.type === 'ga4')    || null,
        },
        items
      });
    }

    if (!VALID_SOURCES_DB.includes(qType)) {
      return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
    }

    const doc = await Audit.findOne({ userId, type: qType }).sort({ generatedAt: -1 }).lean();
    return res.json({ ok: true, data: mirrorActionCenterToIssues(doc) || null, items: doc ? [mirrorActionCenterToIssues(doc)] : [] });
  } catch (e) {
    console.error('LATEST_ERROR:', e);
    return res.status(400).json({ ok: false, error: 'LATEST_ERROR', detail: e?.message });
  }
});

// (D) Última por fuente (compat legacy)
router.get('/:source/latest', requireAuth, async (req, res) => {
  const normalized = normalizeSource(req.params.source);

  if (!VALID_SOURCES_DB.includes(normalized)) {
    return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
  }
  try {
    const userId = req.user._id;
    const doc = await Audit.findOne({ userId, type: normalized }).sort({ generatedAt: -1 }).lean();
    const finalDoc = mirrorActionCenterToIssues(doc);
    if (!finalDoc) return res.json({ summary: null, findings: [], createdAt: null });

    return res.json({
      summary: finalDoc.summary || finalDoc.resumen || null,
      findings: Array.isArray(finalDoc.issues) ? finalDoc.issues : [],

      createdAt: finalDoc.generatedAt || finalDoc.createdAt || null,
    });
  } catch (e) {
    console.error('LATEST_SINGLE_ERROR:', e);
    return res.status(400).json({ ok: false, error: 'LATEST_SINGLE_ERROR', detail: e?.message });
  }
});

// (E) Action Center
router.get('/action-center', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const audits = await Audit.find({ userId }).sort({ generatedAt: -1 }).limit(6).lean();

    const items = [];
    for (const a of audits) {
      const list = Array.isArray(a.actionCenter) ? a.actionCenter : [];
      for (const it of list) {
        items.push({
          title: it.title || '(Sin título)',
          description: it.evidence || it.recommendation || '',
          severity: toSev(it.severity),
          type: a.type,
          at: a.generatedAt,
          button: null,
          estimated: it.estimatedImpact || null,
        });
      }
    }

    items.sort((x, y) => {
      const s = (sevRank[y.severity] || 0) - (sevRank[x.severity] || 0);
      if (s !== 0) return s;
      return new Date(y.at) - new Date(x.at);
    });

    return res.json({ ok: true, items: items.slice(0, 30) });
  } catch (e) {
    console.error('ACTION_CENTER_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'ACTION_CENTER_ERROR', detail: e?.message });
  }
});

module.exports = router;
