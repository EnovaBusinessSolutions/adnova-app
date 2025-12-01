// backend/jobs/auditJob.js
'use strict';

const mongoose = require('mongoose');

const Audit = require('../models/Audit');
const User  = require('../models/User');

// Preferir selección desde los conectores
let MetaAccount, GoogleAccount, ShopConnections;
try { MetaAccount = require('../models/MetaAccount'); } catch {
  const { Schema, model } = mongoose;
  MetaAccount = mongoose.models.MetaAccount ||
    model('MetaAccount', new Schema({}, { strict:false, collection:'metaaccounts' }));
}
try { GoogleAccount = require('../models/GoogleAccount'); } catch {
  const { Schema, model } = mongoose;
  GoogleAccount = mongoose.models.GoogleAccount ||
    model('GoogleAccount', new Schema({}, { strict:false, collection:'googleaccounts' }));
}
try { ShopConnections = require('../models/ShopConnections'); } catch {
  const { Schema, model } = mongoose;
  ShopConnections = mongoose.models.ShopConnections ||
    model('ShopConnections', new Schema({}, { strict:false, collection:'shopconnections' }));
}

// Collectors principales
const { collectGoogle }  = require('./collect/googleCollector');
const { collectMeta }    = require('./collect/metaCollector');
const { collectShopify } = require('./collect/shopifyCollector');

// Collector GA4 (robusto a distintos nombres de export)
let collectGA4 = null;
try {
  // usamos el archivo real que tienes hoy
  const ga4Mod = require('./collect/googleAnalyticsCollector');
  collectGA4 =
    ga4Mod.collectGA4 ||
    ga4Mod.collectGa4 ||
    ga4Mod.collectGA  ||
    ga4Mod.collect    ||
    null;
} catch (_) {
  collectGA4 = null;
}


const generateAudit = require('./llm/generateAudit');

/* ---------- normalizadores ---------- */
const normMeta   = (s='') => String(s).trim().replace(/^act_/, '');
const normGoogle = (s='') => String(s).trim().replace(/^customers\//,'').replace(/-/g,'');

/* ---------- límites por plan (issues por fuente) ---------- */
const PLAN_MAX_FINDINGS = {
  gratis:       5,
  emprendedor:  8,
  crecimiento: 10,
  pro:         15,
};

// Límite global “duro” para cualquier plan
const GLOBAL_MAX_FINDINGS = 5;
const GLOBAL_MIN_FINDINGS = 1;

function getPlanSlug(user) {
  if (!user) return 'gratis';
  // priorizamos planSlug, luego plan, luego default
  return (user.planSlug || user.plan || 'gratis').toString().toLowerCase();
}

/* ---------- helpers kpis / tendencias ---------- */
const safeDiv = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);

function recomputeGoogle(snapshot) {
  const G = (snapshot.byCampaign || []).reduce((a,c)=>(Object.assign(a, {
    impr: a.impr + Number(c?.kpis?.impressions||0),
    clk:  a.clk  + Number(c?.kpis?.clicks||0),
    cost: a.cost + Number(c?.kpis?.cost||0),
    conv: a.conv + Number(c?.kpis?.conversions||0),
    val:  a.val  + Number(c?.kpis?.conv_value||0),
  })), { impr:0,clk:0,cost:0,conv:0,val:0 });

  const base = {
    impressions: G.impr,
    clicks:      G.clk,
    cost:        G.cost,
    conversions: G.conv,
    conv_value:  G.val,
  };

  return {
    ...base,
    ctr:  safeDiv(G.clk, G.impr) * 100,
    cpc:  safeDiv(G.cost, G.clk),
    cpa:  safeDiv(G.cost, G.conv),
    roas: safeDiv(G.val,  G.cost),
  };
}

function recomputeMeta(snapshot) {
  const G = (snapshot.byCampaign || []).reduce((a,c)=>(Object.assign(a, {
    impr: a.impr + Number(c?.kpis?.impressions||0),
    clk:  a.clk  + Number(c?.kpis?.clicks||0),
    cost: a.cost + Number(c?.kpis?.spend||0),
    val:  a.val  + Number(c?.kpis?.purchase_value || c?.kpis?.conv_value || 0),
  })), { impr:0,clk:0,cost:0,val:0 });

  const base = {
    impressions: G.impr,
    clicks:      G.clk,
    cost:        G.cost,
  };

  return {
    ...base,
    cpc:  safeDiv(G.cost, G.clk),
    roas: safeDiv(G.val,  G.cost),
  };
}

function recomputeGA4(snapshot) {
  if (!snapshot) {
    return { users:0, sessions:0, conversions:0, revenue:0, cr:0 };
  }

  let users = 0, sessions = 0, conversions = 0, revenue = 0;

  if (snapshot.aggregate) {
    users       = Number(snapshot.aggregate.users || 0);
    sessions    = Number(snapshot.aggregate.sessions || 0);
    conversions = Number(snapshot.aggregate.conversions || 0);
    revenue     = Number(snapshot.aggregate.revenue || 0);
  }

  // Fallback: sumar canales si no hay aggregate
  if (!sessions && !conversions && Array.isArray(snapshot.channels)) {
    for (const c of snapshot.channels) {
      users       += Number(c.users || 0);
      sessions    += Number(c.sessions || 0);
      conversions += Number(c.conversions || 0);
      revenue     += Number(c.revenue || 0);
    }
  }

  const base = { users, sessions, conversions, revenue };
  const cr = safeDiv(conversions, sessions) * 100;

  return { ...base, cr };
}

function diffKpis(cur = {}, prev = {}) {
  const out = {};
  const keys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
  for (const k of keys) {
    const c = Number(cur[k] ?? 0);
    const p = Number(prev[k] ?? 0);
    const abs = c - p;
    const pct = safeDiv(abs, Math.abs(p) || 1) * 100;
    out[k] = {
      current:  c,
      previous: p,
      absolute: abs,
      percent:  pct,
    };
  }
  return out;
}

/**
 * Construye un objeto de tendencia simple para que la IA pueda
 * decir “mejoraste/empeoraste” entre la auditoría anterior y la actual.
 */
function buildTrend(type, currentSnapshot, previousSnapshot) {
  if (!previousSnapshot) return null;
  try {
    if (type === 'google') {
      const cur  = recomputeGoogle(currentSnapshot);
      const prev = recomputeGoogle(previousSnapshot);
      return {
        type,
        kpisCurrent:  cur,
        kpisPrevious: prev,
        deltas: diffKpis(cur, prev),
      };
    }
    if (type === 'meta') {
      const cur  = recomputeMeta(currentSnapshot);
      const prev = recomputeMeta(previousSnapshot);
      return {
        type,
        kpisCurrent:  cur,
        kpisPrevious: prev,
        deltas: diffKpis(cur, prev),
      };
    }
    if (type === 'ga4') {
      const cur  = recomputeGA4(currentSnapshot);
      const prev = recomputeGA4(previousSnapshot);
      return {
        type,
        kpisCurrent:  cur,
        kpisPrevious: prev,
        deltas: diffKpis(cur, prev),
      };
    }
    // Shopify u otros: de momento sin tendencia numérica
    return null;
  } catch (_) {
    return null;
  }
}

/* ---------- util: filtrar snapshot por cuentas ---------- */
function filterSnapshot(type, snapshot, allowedIds = []) {
  if (!snapshot || !Array.isArray(allowedIds) || allowedIds.length === 0) return snapshot;

  const norm  = type === 'meta' ? normMeta : normGoogle;
  const allow = new Set(allowedIds.map(norm));

  const byCampaign = (snapshot.byCampaign || []).filter(c => allow.has(norm(c.account_id)));
  const accounts   = (snapshot.accounts   || []).filter(a => allow.has(norm(a.id)));
  const accountIds = (snapshot.accountIds || []).filter(id => allow.has(norm(id)));

  let kpis = snapshot.kpis || {};
  if (type === 'google') kpis = recomputeGoogle({ ...snapshot, byCampaign });
  if (type === 'meta')   kpis = recomputeMeta({ ...snapshot, byCampaign });

  return { ...snapshot, byCampaign, accounts, accountIds, kpis };
}

/* ---------- escoger subconjunto seguro si no hay selección ---------- */
/* (hoy casi no se usa porque los collectors ya respetan máx. 3,
 *  pero lo dejamos para compat si snapshot ya viene con varias cuentas) */
function autoPickIds(type, snapshot, max = 3) {
  const norm = type === 'meta' ? normMeta : normGoogle;

  const idsFromArray = (arr=[]) => arr
    .map(x => (typeof x === 'string' ? x : x?.id))
    .map(norm)
    .filter(Boolean);

  const ids = new Set();

  // soportar defaultCustomerId además de defaultAccountId
  const def = norm(snapshot?.defaultAccountId || snapshot?.defaultCustomerId || '');
  if (def) ids.add(def);

  for (const id of idsFromArray(snapshot?.accountIds || [])) {
    if (ids.size >= max) break;
    ids.add(id);
  }
  for (const id of idsFromArray(snapshot?.accounts || [])) {
    if (ids.size >= max) break;
    ids.add(id);
  }
  for (const c of (snapshot.byCampaign || [])) {
    if (ids.size >= max) break;
    const id = norm(c.account_id || '');
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/* ---------- helpers de conexiones ---------- */
async function detectConnections(userId) {
  const [meta, google, shop] = await Promise.all([
    MetaAccount.findOne({ $or:[{user:userId},{userId}] })
      .select('access_token token accessToken longLivedToken longlivedToken selectedAccountIds defaultAccountId')
      .lean(),
    GoogleAccount.findOne({ $or:[{user:userId},{userId}] })
      .select('refreshToken accessToken selectedCustomerIds defaultCustomerId')
      .lean(),
    ShopConnections.findOne({ $or:[{user:userId},{userId}] })
      .select('shop access_token accessToken')
      .lean()
  ]);

  return {
    meta: {
      connected: !!(meta && (meta.access_token || meta.token || meta.accessToken || meta.longLivedToken || meta.longlivedToken)),
      selectedIds: Array.isArray(meta?.selectedAccountIds) ? meta.selectedAccountIds.map(normMeta) : [],
      defaultId: meta?.defaultAccountId ? normMeta(meta.defaultAccountId) : null,
    },
    google: {
      connected: !!(google && (google.refreshToken || google.accessToken)),
      selectedIds: Array.isArray(google?.selectedCustomerIds) ? google.selectedCustomerIds.map(normGoogle) : [],
      defaultId: google?.defaultCustomerId ? normGoogle(google.defaultCustomerId) : null,
    },
    shopify: {
      connected: !!(shop && shop.shop && (shop.access_token || shop.accessToken)),
    }
  };
}

/* ---------- helpers de issues especiales ---------- */

/**
 * Issue específico cuando el collector pide selección explícita (>3 cuentas/propiedades).
 */
function buildSelectionRequiredIssue(type, raw) {
  const reason    = String(raw?.reason || '').toUpperCase();
  const available = Number(raw?.availableCount || (raw?.accountIds || []).length || 0);

  let title    = 'Selecciona las fuentes que quieres auditar';
  let platform = 'la fuente conectada';
  if (type === 'google') platform = 'Google Ads';
  if (type === 'meta')   platform = 'Meta Ads (Facebook/Instagram)';
  if (type === 'ga4')    platform = 'Google Analytics 4';

  if (reason.startsWith('SELECTION_REQUIRED')) {
    title = `Selecciona qué cuentas de ${platform} auditar`;
  }

  return {
    id: `selection_required_${type}`,
    area: 'setup',
    severity: 'media',
    title,
    evidence: available
      ? `Se detectaron ${available} cuentas/propiedades conectadas en ${platform}. Por claridad y rendimiento solo se pueden auditar hasta 3 a la vez.`
      : `Hay varias cuentas/propiedades conectadas en ${platform} y es necesario elegir cuáles auditar.`,
    recommendation: 'En Ajustes → Conexiones selecciona explícitamente las cuentas o propiedades que quieras incluir en la auditoría.',
    estimatedImpact: 'medio',
  };
}

/* ---------- MAIN ---------- */
/**
 * Ejecuta una auditoría para una fuente.
 * @param {Object} params
 * @param {string} params.userId
 * @param {('google'|'meta'|'shopify'|'ga4'|'ga')} params.type
 * @param {string} [params.source='manual']  // 'onboarding' | 'panel' | 'manual'
 */
async function runAuditFor({ userId, type, source = 'manual' }) {
  // Normalizamos type para manejar alias "ga"
  let t = String(type || '').toLowerCase();
  if (t === 'ga') t = 'ga4';

  try {
    const user = await User.findById(userId)
      .select('selectedGoogleAccounts selectedMetaAccounts plan planSlug')
      .lean();

    const planSlug = getPlanSlug(user);

    // límite efectivo por plan PERO capado a GLOBAL_MAX_FINDINGS
    const planLimit   = PLAN_MAX_FINDINGS[planSlug] || PLAN_MAX_FINDINGS.gratis;
    const maxFindings = Math.min(GLOBAL_MAX_FINDINGS, planLimit);
    const minFindings = GLOBAL_MIN_FINDINGS;

    // Estado real de conexiones y selección preferida desde conectores
    const connections = await detectConnections(userId);

    // Guardas de conexión (defensa en profundidad; auditRunner / router ya filtran)
    if (t === 'meta'    && !connections.meta.connected)    throw new Error('SOURCE_NOT_CONNECTED_META');
    if (t === 'google'  && !connections.google.connected)  throw new Error('SOURCE_NOT_CONNECTED_GOOGLE');
    if (t === 'ga4'     && !connections.google.connected)  throw new Error('SOURCE_NOT_CONNECTED_GA4');
    if (t === 'shopify' && !connections.shopify.connected) throw new Error('SOURCE_NOT_CONNECTED_SHOPIFY');

    // Selección efectiva “extra” desde los conectores (legacy),
    // los collectors ya usan preferencias nuevas, pero esto permite
    // filtrar aún más si el usuario marcó algo ahí.
    const selMeta = (
      connections.meta.selectedIds.length
        ? connections.meta.selectedIds
        : (user?.selectedMetaAccounts || [])
    ).map(normMeta);

    const selGoogle = (
      connections.google.selectedIds.length
        ? connections.google.selectedIds
        : (user?.selectedGoogleAccounts || [])
    ).map(normGoogle);

    let raw          = null;
    let snapshot     = null;
    let selectionNote = null; // nota informativa si llegamos a autoPick (hoy casi nunca)

    /* ---------- GOOGLE ADS ---------- */
    if (t === 'google') {
      raw = await collectGoogle(userId);

      // Caso especial: collector pide selección explícita (>3 cuentas)
      if (raw?.notAuthorized && raw.requiredSelection &&
          String(raw.reason || '').startsWith('SELECTION_REQUIRED')) {

        const issue = buildSelectionRequiredIssue('google', raw);
        await Audit.create({
          userId,
          type: 'google',
          origin: source || 'manual',
          generatedAt: new Date(),
          plan: planSlug,
          maxFindings,
          summary: 'Antes de generar la auditoría, selecciona qué cuentas de Google Ads quieres analizar.',
          issues: [issue],
          actionCenter: [issue],
          topProducts: [],
          inputSnapshot: raw,
          version: 'audits@1.2.0-selection',
        });
        return true;
      }

      const total = (raw?.accountIds && raw.accountIds.length) ||
                    (raw?.accounts   && raw.accounts.length)   || 0;

      // Solo filtramos por selGoogle si HAY intersección con las
      // cuentas realmente presentes en el snapshot.
      if (selGoogle.length && total > 0) {
        const norm = normGoogle;
        const snapshotIds = new Set(
          (raw.accountIds || (raw.accounts || []).map(a => a.id) || [])
            .map(norm)
        );
        const effectiveSel = selGoogle.filter(id => snapshotIds.has(norm(id)));

        if (effectiveSel.length > 0) {
          snapshot = filterSnapshot('google', raw, effectiveSel);
        } else {
          // selección no coincide con lo que trajo el collector → no filtramos
          snapshot = raw;
        }
      } else {
        // Confiamos en la lógica de selección del collector (máx. 3)
        snapshot = raw;

        // fallback ultra-defensivo: si por alguna razón el snapshot viene con >3 cuentas,
        // auto-limitamos y dejamos nota
        if (total > 3) {
          const picked = autoPickIds('google', raw, 3);
          snapshot = filterSnapshot('google', raw, picked);
          selectionNote = {
            id: 'auto_selection_google',
            title: 'Auditoría limitada a 3 cuentas',
            area: 'setup',
            severity: 'media',
            evidence: `Se detectaron ${total} cuentas de Google Ads. Se auditó solo: ${picked.join(', ')}.`,
            recommendation: 'En Ajustes → Conexiones elige explícitamente las cuentas a auditar.',
            estimatedImpact: 'medio',
          };
        }
      }
    }

    /* ---------- META ADS ---------- */
    if (t === 'meta') {
      raw = await collectMeta(userId);

      if (raw?.notAuthorized && raw.requiredSelection &&
          String(raw.reason || '').startsWith('SELECTION_REQUIRED')) {

        const issue = buildSelectionRequiredIssue('meta', raw);
        await Audit.create({
          userId,
          type: 'meta',
          origin: source || 'manual',
          generatedAt: new Date(),
          plan: planSlug,
          maxFindings,
          summary: 'Antes de generar la auditoría, selecciona qué cuentas de Meta Ads quieres analizar.',
          issues: [issue],
          actionCenter: [issue],
          topProducts: [],
          inputSnapshot: raw,
          version: 'audits@1.2.0-selection',
        });
        return true;
      }

      const total = (raw?.accountIds && raw.accountIds.length) ||
                    (raw?.accounts   && raw.accounts.length)   || 0;

      if (selMeta.length && total > 0) {
        const norm = normMeta;
        const snapshotIds = new Set(
          (raw.accountIds || (raw.accounts || []).map(a => a.id) || [])
            .map(norm)
        );
        const effectiveSel = selMeta.filter(id => snapshotIds.has(norm(id)));

        if (effectiveSel.length > 0) {
          snapshot = filterSnapshot('meta', raw, effectiveSel);
        } else {
          snapshot = raw;
        }
      } else {
        snapshot = raw;
        if (total > 3) {
          const picked = autoPickIds('meta', raw, 3);
          snapshot = filterSnapshot('meta', raw, picked);
          selectionNote = {
            id: 'auto_selection_meta',
            title: 'Auditoría limitada a 3 cuentas',
            area: 'setup',
            severity: 'media',
            evidence: `Se detectaron ${total} cuentas de Meta Ads. Se auditó solo: ${picked.map(x=>'act_'+x).join(', ')}.`,
            recommendation: 'En Ajustes → Conexiones elige explícitamente las cuentas a auditar.',
            estimatedImpact: 'medio',
          };
        }
      }
    }

    /* ---------- GA4 ---------- */
    if (t === 'ga4') {
      if (!collectGA4) {
        throw new Error('GA4_COLLECTOR_NOT_AVAILABLE');
      }

      raw = await collectGA4(userId);

      if (raw?.notAuthorized && raw.requiredSelection &&
          String(raw.reason || '').startsWith('SELECTION_REQUIRED')) {

        const issue = buildSelectionRequiredIssue('ga4', raw);
        await Audit.create({
          userId,
          type: 'ga4',
          origin: source || 'manual',
          generatedAt: new Date(),
          plan: planSlug,
          maxFindings,
          summary: 'Antes de generar la auditoría, selecciona qué propiedades de GA4 quieres analizar.',
          issues: [issue],
          actionCenter: [issue],
          topProducts: [],
          inputSnapshot: raw,
          version: 'audits@1.2.0-selection',
        });
        return true;
      }

      snapshot = raw;
    }

    /* ---------- SHOPIFY ---------- */
    if (t === 'shopify') {
      snapshot = await collectShopify(userId);
      raw = snapshot;
    }

    if (!snapshot) throw new Error('SNAPSHOT_EMPTY');

    // Buscar auditoría anterior de esta misma fuente para tendencias
    const previousAudit = await Audit.findOne({
      userId,
      type: t,
    }).sort({ generatedAt: -1 }).lean();

    const previousSnapshot = previousAudit?.inputSnapshot || null;
    const trend = buildTrend(t, snapshot, previousSnapshot);

    // ¿Tenemos datos reales tras el filtrado?
    const hasAdsData =
      Array.isArray(snapshot.byCampaign) && snapshot.byCampaign.length > 0;

    const hasGAData =
      (Array.isArray(snapshot.channels)   && snapshot.channels.length   > 0) ||
      (Array.isArray(snapshot.byProperty) && snapshot.byProperty.length > 0) ||
      (snapshot.aggregate && (
        Number(snapshot.aggregate.users || 0)       > 0 ||
        Number(snapshot.aggregate.sessions || 0)    > 0 ||
        Number(snapshot.aggregate.conversions || 0) > 0 ||
        Number(snapshot.aggregate.revenue || 0)     > 0
      ));

    let noData = false;
    if (t === 'google' || t === 'meta') {
      noData = !hasAdsData;
    } else if (t === 'ga4') {
      noData = !hasGAData;
    }

    let auditJson = { summary: '', issues: [] };

    if (!noData) {
      // Pasamos maxFindings limitado y contexto de auditoría anterior
      auditJson = await generateAudit({
        type: t,
        inputSnapshot: snapshot,
        maxFindings,
        minFindings,
        previousSnapshot,
        previousAudit: previousAudit
          ? {
              id:         previousAudit._id,
              generatedAt: previousAudit.generatedAt || previousAudit.createdAt || null,
              summary:     previousAudit.summary || previousAudit.resumen || '',
            }
          : null,
        trend,
      });
    }

    // Nota de selección (si aplicó autoPick de seguridad)
    if (selectionNote) {
      auditJson.issues = Array.isArray(auditJson.issues) ? auditJson.issues : [];
      auditJson.issues.unshift(selectionNote);
    }

    // Normalizamos issues a array
    auditJson.issues = Array.isArray(auditJson.issues) ? auditJson.issues : [];

    // Si hay datos pero la IA no devolvió nada, forzamos al menos 1 recomendación suave
    if (!noData && auditJson.issues.length === 0) {
      auditJson.issues.push({
        id: 'mantener_y_experimentar',
        area: 'estrategia',
        severity: 'baja',
        title: 'La cuenta está razonablemente optimizada, pero puedes seguir experimentando',
        evidence: 'En la revisión de los últimos datos no se detectaron problemas críticos, pero siempre hay margen para optimizar creatividades, audiencias y pruebas A/B.',
        recommendation: 'Define al menos un experimento para los próximos 30 días (por ejemplo, probar nuevas creatividades, pujas o segmentaciones) para evitar que el rendimiento se estanque.',
        estimatedImpact: 'bajo',
      });
    }

    // clamp final al límite por plan y al máximo global de 5
    if (auditJson.issues.length > maxFindings) {
      auditJson.issues = auditJson.issues.slice(0, maxFindings);
    }

    const auditDoc = {
      userId,
      type: t,
      origin: source || 'manual',  // onboarding | panel | manual
      generatedAt: new Date(),
      plan: planSlug,
      maxFindings,
      summary: auditJson?.summary || (noData ? 'No hay datos suficientes en el periodo.' : 'Auditoría generada'),
      issues: auditJson?.issues || [],
      actionCenter: auditJson?.actionCenter || (auditJson?.issues || []).slice(0, 3),
      topProducts: auditJson?.topProducts || [],
      inputSnapshot: snapshot,
      version: 'audits@1.2.0',
      // guardamos un trozo del trend para debug / comparativas futuras
      trendSummary: trend || null,
    };

    await Audit.create(auditDoc);
    return true;

  } catch (e) {
    // Siempre escribe un doc para que el frontend vea el motivo
    await Audit.create({
      userId,
      type: String(type || '').toLowerCase() === 'ga' ? 'ga4' : String(type || '').toLowerCase(),
      origin: source || 'manual',
      generatedAt: new Date(),
      plan: 'unknown',
      maxFindings: GLOBAL_MAX_FINDINGS,
      summary: 'No se pudo generar la auditoría',
      issues: [{
        id: 'setup_incompleto',
        area: 'setup', severity: 'alta',
        title: 'Faltan datos o permisos',
        evidence: String(e && (e.message || e)),
        recommendation: 'Verifica conexión y permisos. Si tienes varias cuentas, elige cuáles auditar en Ajustes.',
        estimatedImpact: 'alto',
      }],
      actionCenter: [],
      inputSnapshot: {},
      version: 'audits@1.2.0-error',
    });
    return false;
  }
}

module.exports = { runAuditFor };
