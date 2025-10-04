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

// ---------------- Heurísticos (garantiza hallazgos si LLM cae) ----------------
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
        metrics: { ctr, impressions: impr, clicks: clk, campaign: c.name },
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
        metrics: { clicks: clk, cost, conversions: conv, campaign: c.name },
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
        metrics: { roas, cost, conv_value: value, campaign: c.name },
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
        metrics: { impressions: impr, ctr, campaign: c.name },
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
        metrics: { roas, spend, campaign: c.name },
        campaignRef: { id: c.id, name: c.name }
      });
    }
  }
  return issues;
}

function heuristicsFromGA4(snap) {
  const issues = [];
  const channels = Array.isArray(snap?.channels) ? snap.channels : [];
  const totals = channels.reduce((a,c)=>({
    users: a.users + Number(c.users||0),
    sessions: a.sessions + Number(c.sessions||0),
    conv: a.conv + Number(c.conversions||0),
    rev: a.rev + Number(c.revenue||0),
  }), {users:0,sessions:0,conv:0,rev:0});

  if (totals.sessions > 500 && totals.conv === 0) {
    issues.push({
      area: 'tracking',
      title: 'Tráfico sin conversiones',
      severity: 'alta',
      evidence: `Se registraron ${totals.sessions} sesiones y 0 conversiones en el rango.`,
      recommendation: 'Verifica configuración de eventos/conversions en GA4 y la correcta importación desde Ads.',
      metrics: totals
    });
  }

  const paid = channels.filter(c => /paid|cpc|display|paid social/i.test(c.channel || ''));
  const paidConv = paid.reduce((a,c)=>a+Number(c.conversions||0),0);
  const paidSess = paid.reduce((a,c)=>a+Number(c.sessions||0),0);
  if (paidSess > 200 && paidConv === 0) {
    issues.push({
      area: 'performance',
      title: 'Tráfico de pago sin conversiones',
      severity: 'media',
      evidence: `Se observaron ${paidSess} sesiones de canales de pago sin conversiones registradas.`,
      recommendation: 'Cruza datos con plataformas de Ads; revisa eventos de conversión (duplicados/filtros/consent).',
      metrics: { paidSessions: paidSess, paidConversions: paidConv }
    });
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

// Valores válidos que se guardan en BD (respetan tu enum)
const VALID_SOURCES_DB = ['google','meta','ga4'];

// ---------------- Núcleo: ejecutar una auditoría ----------------
async function runSingleAudit({ userId, type, flags }) {
  // Aseguramos tipo persistible según enum del modelo
  const persistType = SOURCE_ALIASES[type] || type; // e.g., 'ga' -> 'ga4'

  // 1) Si la fuente no está conectada → placeholder
  if (!flags[persistType]) {
    const doc = await Audit.create({
      userId,
      type: persistType,
      generatedAt: new Date(),
      resumen: 'Fuente no conectada',
      summary: 'Fuente no conectada',
      issues: [buildSetupIssue({ type: persistType, title: 'Fuente no conectada', evidence: 'Conecta la cuenta para auditar.' })],
      actionCenter: [],
      inputSnapshot: { notAuthorized: true, reason: 'NOT_CONNECTED' },
      version: 'audits@1.1.1',
    });
    return { type: persistType, ok: true, auditId: doc._id };
  }

  // 2) Colecta
  let snap = {};
  try {
    if (persistType === 'google') snap = await collectGoogle(userId);   // Google Ads
    else if (persistType === 'meta') snap = await collectMeta(userId);  // Meta Ads
    else if (persistType === 'ga4') {
      if (typeof collectGA4 === 'function') snap = await collectGA4(userId); // GA4
      else return { type: persistType, ok: false, error: 'SOURCE_NOT_READY' };
    }
  } catch (e) {
    console.warn('COLLECTOR_ERROR', persistType, e?.message || e);
    snap = {};
  }

  // 3) Autorización y si hay datos reales
  const authorized = !snap?.notAuthorized;
  const hasData =
    persistType === 'ga4'
      ? (Array.isArray(snap?.channels) && snap.channels.length > 0)
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

  // 5) Fallback heurístico si LLM no devolvió nada
  if (issues.length === 0 && hasData && authorized) {
    if (persistType === 'google') issues = heuristicsFromGoogle(snap);
    if (persistType === 'meta')   issues = heuristicsFromMeta(snap);
    if (persistType === 'ga4')    issues = heuristicsFromGA4(snap);
    summary = summary || 'Hallazgos generados con reglas básicas (fallback).';
  }

  // 6) Normaliza, ordena y persiste
  issues = normalizeIssues(issues, persistType, 10);
  const top3 = sortIssuesBySeverityThenImpact(issues).slice(0, 3);

  const doc = await Audit.create({
    userId,
    type: persistType, // <-- ¡clave! respeta el enum del modelo
    generatedAt: new Date(),
    resumen: summary,
    summary,
    issues,
    actionCenter: top3,
    topProducts: Array.isArray(snap?.topProducts) ? snap.topProducts : [],
    inputSnapshot: snap,
    version: 'audits@1.1.0',
  });

  return { type: persistType, ok: true, auditId: doc._id };
}

// =====================================================
// RUTAS
// =====================================================

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

    const results = [];
    for (const type of VALID_SOURCES_DB) {
      const r = await runSingleAudit({ userId, type, flags });
      results.push(r);
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

function normalizeSource(src = '') {
  const v = String(src).toLowerCase().trim();
  return SOURCE_ALIASES[v] || v;
}

// (B) Ejecutar UNA (con alias de entrada, siempre persiste como ga4)
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
    const r = await runSingleAudit({ userId, type: normalized, flags });
    if (!r.ok) return res.status(400).json(r);
    return res.json({ ok: true, ...r });
  } catch (e) {
    console.error('AUDIT_SINGLE_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

// (C) Últimas (todas)
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const [google, meta, ga4] = await Promise.all(
      VALID_SOURCES_DB.map((t) =>
        Audit.findOne({ userId, type: t }).sort({ generatedAt: -1 }).lean()
      )
    );

    return res.json({ ok: true, data: { google: google || null, meta: meta || null, ga4: ga4 || null } });
  } catch (e) {
    console.error('LATEST_ERROR:', e);
    return res.status(400).json({ ok: false, error: 'LATEST_ERROR', detail: e?.message });
  }
});

// (D) Última por fuente (con alias de entrada)
router.get('/:source/latest', requireAuth, async (req, res) => {
  const normalized = normalizeSource(req.params.source);

  if (!VALID_SOURCES_DB.includes(normalized)) {
    return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
  }
  try {
    const userId = req.user._id;
    const doc = await Audit.findOne({ userId, type: normalized }).sort({ generatedAt: -1 }).lean();
    if (!doc) return res.json({ summary: null, findings: [], createdAt: null });
    return res.json({
      summary: doc.summary || doc.resumen || null,
      findings: Array.isArray(doc.issues) ? doc.issues : [],
      createdAt: doc.generatedAt || doc.createdAt || null,
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
