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

// Collector GA4 (lo hacemos robusto a distintos nombres de export)
let collectGA4 = null;
try {
  const ga4Mod = require('./collect/ga4Collector');
  collectGA4 =
    ga4Mod.collectGA4 ||
    ga4Mod.collectGa4 ||
    ga4Mod.collectGA ||
    ga4Mod.collect ||
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
  gratis: 5,          // 👉 plan Gratis: hasta 5 recomendaciones por auditoría/fuente
  emprendedor: 8,
  crecimiento: 10,
  pro: 15
};

function getPlanSlug(user) {
  if (!user) return 'gratis';
  // priorizamos planSlug, luego plan, luego default
  return (user.planSlug || user.plan || 'gratis').toString().toLowerCase();
}

/* ---------- helpers kpis tras filtro ---------- */
const safeDiv = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);

function recomputeGoogle(snapshot) {
  const G = (snapshot.byCampaign || []).reduce((a,c)=>(Object.assign(a, {
    impr: a.impr + Number(c?.kpis?.impressions||0),
    clk:  a.clk  + Number(c?.kpis?.clicks||0),
    cost: a.cost + Number(c?.kpis?.cost||0),
    conv: a.conv + Number(c?.kpis?.conversions||0),
    val:  a.val  + Number(c?.kpis?.conv_value||0),
  })), { impr:0,clk:0,cost:0,conv:0,val:0 });

  return {
    impressions: G.impr,
    clicks:      G.clk,
    cost:        G.cost,
    conversions: G.conv,
    conv_value:  G.val,
    ctr: safeDiv(G.clk, G.impr) * 100,
    cpc: safeDiv(G.cost, G.clk),
    cpa: safeDiv(G.cost, G.conv),
    roas: safeDiv(G.val, G.cost),
  };
}

function recomputeMeta(snapshot) {
  const G = (snapshot.byCampaign || []).reduce((a,c)=>(Object.assign(a, {
    impr: a.impr + Number(c?.kpis?.impressions||0),
    clk:  a.clk  + Number(c?.kpis?.clicks||0),
    cost: a.cost + Number(c?.kpis?.spend||0),
    val:  a.val  + Number(c?.kpis?.purchase_value || c?.kpis?.conv_value || 0),
  })), { impr:0,clk:0,cost:0,val:0 });

  return {
    impressions: G.impr,
    clicks:      G.clk,
    cost:        G.cost,
    cpc: safeDiv(G.cost, G.clk),
    roas: safeDiv(G.val, G.cost),
  };
}

/* ---------- util: filtrar snapshot por cuentas ---------- */
function filterSnapshot(type, snapshot, allowedIds = []) {
  if (!snapshot || !Array.isArray(allowedIds) || allowedIds.length === 0) return snapshot;

  const norm = type === 'meta' ? normMeta : normGoogle;
  const allow = new Set(allowedIds.map(norm));

  const byCampaign = (snapshot.byCampaign || []).filter(c => allow.has(norm(c.account_id)));
  const accounts   = (snapshot.accounts || []).filter(a => allow.has(norm(a.id)));
  const accountIds = (snapshot.accountIds || []).filter(id => allow.has(norm(id)));

  let kpis = snapshot.kpis || {};
  if (type === 'google') kpis = recomputeGoogle({ ...snapshot, byCampaign });
  if (type === 'meta')   kpis = recomputeMeta({ ...snapshot, byCampaign });

  return { ...snapshot, byCampaign, accounts, accountIds, kpis };
}

/* ---------- escoger subconjunto seguro si no hay selección ---------- */
function autoPickIds(type, snapshot, max = 3) {
  const norm = type === 'meta' ? normMeta : normGoogle;

  const idsFromArray = (arr=[]) => arr
    .map(x => (typeof x === 'string' ? x : x?.id))
    .map(norm).filter(Boolean);

  const ids = new Set();
  const def = norm(snapshot?.defaultAccountId || '');
  if (def) ids.add(def);

  for (const id of idsFromArray(snapshot?.accountIds || [])) {
    if (ids.size >= max) break; ids.add(id);
  }
  for (const id of idsFromArray(snapshot?.accounts || [])) {
    if (ids.size >= max) break; ids.add(id);
  }
  for (const c of (snapshot.byCampaign || [])) {
    if (ids.size >= max) break;
    const id = norm(c.account_id || '');
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/* ---------- conexión por fuente ---------- */
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
    const maxFindings = PLAN_MAX_FINDINGS[planSlug] || PLAN_MAX_FINDINGS.gratis;

    // Estado real de conexiones y selección preferida desde conectores
    const connections = await detectConnections(userId);

    // Guardas de conexión (defensa en profundidad; auditRunner ya filtra)
    if (t === 'meta'   && !connections.meta.connected)    throw new Error('SOURCE_NOT_CONNECTED_META');
    if (t === 'google' && !connections.google.connected)  throw new Error('SOURCE_NOT_CONNECTED_GOOGLE');
    if (t === 'ga4'    && !connections.google.connected)  throw new Error('SOURCE_NOT_CONNECTED_GA4');
    if (t === 'shopify'&& !connections.shopify.connected) throw new Error('SOURCE_NOT_CONNECTED_SHOPIFY');

    // Selección efectiva: conector > user (legacy)
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

    let raw = null;
    let snapshot = null;
    let selectionNote = null;

    if (t === 'google') {
      raw = await collectGoogle(userId);

      const total = (raw?.accountIds && raw.accountIds.length) ||
                    (raw?.accounts && raw.accounts.length) || 0;

      if (selGoogle.length) {
        snapshot = filterSnapshot('google', raw, selGoogle);
      } else if (total > 3) {
        const picked = autoPickIds('google', raw, 3);
        snapshot = filterSnapshot('google', raw, picked);
        selectionNote = {
          id: 'auto_selection_google',
          title: 'Auditoría limitada a 3 cuentas',
          area: 'setup',
          severity: 'media',
          evidence: `Se detectaron ${total} cuentas de Google Ads y aún no has seleccionado. Se auditó: ${picked.join(', ')}.`,
          recommendation: 'En Ajustes → Conexiones elige explícitamente las cuentas a auditar.',
          estimatedImpact: 'medio'
        };
      } else {
        snapshot = raw;
      }
    }

    if (t === 'meta') {
      raw = await collectMeta(userId);

      const total = (raw?.accountIds && raw.accountIds.length) ||
                    (raw?.accounts && raw.accounts.length) || 0;

      if (selMeta.length) {
        snapshot = filterSnapshot('meta', raw, selMeta);
      } else if (total > 3) {
        const picked = autoPickIds('meta', raw, 3);
        snapshot = filterSnapshot('meta', raw, picked);
        selectionNote = {
          id: 'auto_selection_meta',
          title: 'Auditoría limitada a 3 cuentas',
          area: 'setup',
          severity: 'media',
          evidence: `Se detectaron ${total} cuentas de Meta Ads y aún no has seleccionado. Se auditó: ${picked.map(x=>'act_'+x).join(', ')}.`,
          recommendation: 'En Ajustes → Conexiones elige explícitamente las cuentas a auditar.',
          estimatedImpact: 'medio'
        };
      } else {
        snapshot = raw;
      }
    }

    if (t === 'ga4') {
      if (!collectGA4) {
        throw new Error('GA4_COLLECTOR_NOT_AVAILABLE');
      }
      // El collector GA4 ya se encarga de propiedades seleccionadas / defaults
      snapshot = await collectGA4(userId);
      raw = snapshot;
    }

    if (t === 'shopify') {
      snapshot = await collectShopify(userId);
    }

    if (!snapshot) throw new Error('SNAPSHOT_EMPTY');

    // Si no hay datos después del filtrado, registra setup claro (pero sin abortar antes)
    const hasAdsData = Array.isArray(snapshot.byCampaign) && snapshot.byCampaign.length > 0;
    const hasGAData  =
      (Array.isArray(snapshot.channels) && snapshot.channels.length > 0) ||
      (Array.isArray(snapshot.byProperty) && snapshot.byProperty.length > 0);

    let noData = false;
    if (t === 'google' || t === 'meta') {
      noData = !hasAdsData;
    } else if (t === 'ga4') {
      noData = !hasGAData;
    }

    let auditJson = { summary: '', issues: [] };
    if (!noData) {
      // Pasamos maxFindings segun plan (gratis, emprendedor, crecimiento, pro)
      auditJson = await generateAudit({
        type: t,
        inputSnapshot: snapshot,
        maxFindings
      });
    }

    if (selectionNote) {
      auditJson.issues = Array.isArray(auditJson.issues) ? auditJson.issues : [];
      auditJson.issues.unshift(selectionNote);
    }

    // clamp final al límite por plan (dejando la nota de selección al frente)
    if (Array.isArray(auditJson.issues) && auditJson.issues.length > maxFindings) {
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
      version: 'audits@1.1.0',
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
      maxFindings: PLAN_MAX_FINDINGS.gratis,
      summary: 'No se pudo generar la auditoría',
      issues: [{
        id: 'setup_incompleto',
        area: 'setup', severity: 'alta',
        title: 'Faltan datos o permisos',
        evidence: String(e && (e.message || e)),
        recommendation: 'Verifica conexión y permisos. Si tienes varias cuentas, elige cuáles auditar en Ajustes.',
        estimatedImpact: 'alto'
      }],
      actionCenter: [],
      inputSnapshot: {},
      version: 'audits@1.1.0-error'
    });
    return false;
  }
}

module.exports = { runAuditFor };
