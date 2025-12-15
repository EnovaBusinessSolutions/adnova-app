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
const normGoogle = (s='') => String(s).trim().replace(/^customers\//,'').replace(/-/g,'').replace(/[^\d]/g,'');

/**
 * GA4 Property suele venir como:
 * - "385966493"
 * - "properties/385966493"
 * - objeto { propertyId: "385..." } / { name: "properties/385..." }
 */
const normGA4 = (s='') => {
  const raw = String(s || '').trim();
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits || raw.replace(/^properties\//, '').trim();
};
const ga4ToApiName = (id='') => {
  const n = normGA4(id);
  return n ? (String(id).startsWith('properties/') ? String(id) : `properties/${n}`) : '';
};

/* ---------- límites por plan (issues por fuente) ---------- */
const PLAN_MAX_FINDINGS = {
  gratis:       5,
  emprendedor:  8,
  crecimiento: 10,
  pro:         15,
};

// Límite global “duro”
const GLOBAL_MAX_FINDINGS = 5;
const GLOBAL_MIN_FINDINGS = 1;

// 👇 Importante: tu UX quiere 1 selección por tipo
const MAX_SELECT_PER_TYPE = 1;

function getPlanSlug(user) {
  if (!user) return 'gratis';
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

function buildTrend(type, currentSnapshot, previousSnapshot) {
  if (!previousSnapshot) return null;
  try {
    if (type === 'google') {
      const cur  = recomputeGoogle(currentSnapshot);
      const prev = recomputeGoogle(previousSnapshot);
      return { type, kpisCurrent: cur, kpisPrevious: prev, deltas: diffKpis(cur, prev) };
    }
    if (type === 'meta') {
      const cur  = recomputeMeta(currentSnapshot);
      const prev = recomputeMeta(previousSnapshot);
      return { type, kpisCurrent: cur, kpisPrevious: prev, deltas: diffKpis(cur, prev) };
    }
    if (type === 'ga4') {
      const cur  = recomputeGA4(currentSnapshot);
      const prev = recomputeGA4(previousSnapshot);
      return { type, kpisCurrent: cur, kpisPrevious: prev, deltas: diffKpis(cur, prev) };
    }
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

/* ---------- util: filtrar snapshot GA4 por property ---------- */
function filterGA4Snapshot(snapshot, selectedPropertyId) {
  if (!snapshot || !selectedPropertyId) return snapshot;

  const wanted = normGA4(selectedPropertyId);
  const matchPropId = (x) => {
    const pid = normGA4(x?.propertyId || x?.property_id || x?.property || x?.id || '');
    const name = normGA4(x?.name || x?.propertyName || '');
    return pid === wanted || name === wanted;
  };

  const out = { ...snapshot };

  if (Array.isArray(out.gaProperties)) out.gaProperties = out.gaProperties.filter(matchPropId);
  if (Array.isArray(out.properties))   out.properties   = out.properties.filter(matchPropId);

  if (Array.isArray(out.byProperty)) {
    out.byProperty = out.byProperty.filter(matchPropId);

    // ✅ MEJORA: si queda 1 property, fijamos aggregate a esa property (para que LLM/UI no use el global)
    if (out.byProperty.length === 1) {
      const one = out.byProperty[0];
      const users       = Number(one?.users ?? one?.kpis?.users ?? 0);
      const sessions    = Number(one?.sessions ?? one?.kpis?.sessions ?? 0);
      const conversions = Number(one?.conversions ?? one?.kpis?.conversions ?? 0);
      const revenue     = Number(one?.revenue ?? one?.kpis?.revenue ?? 0);
      out.aggregate = { users, sessions, conversions, revenue };
      out.property = one?.property || out.property || ga4ToApiName(wanted) || wanted;
      out.propertyName = one?.propertyName || out.propertyName || '';
      out.accountName = one?.accountName || out.accountName || '';
    }
  }

  if (out.propertyId || out.property_id || out.property) {
    const pid = normGA4(out.propertyId || out.property_id || out.property);
    if (pid !== wanted) {
      delete out.propertyId;
      delete out.property_id;
      // out.property lo mantenemos si ya lo set arriba; si no, se limpia:
      if (!out.property || normGA4(out.property) !== wanted) delete out.property;
    }
  }

  out.selectedPropertyId = ga4ToApiName(wanted) || wanted;
  return out;
}

/* ---------- escoger subconjunto seguro si no hay selección ---------- */
function autoPickIds(type, snapshot, max = 3) {
  const norm = type === 'meta' ? normMeta : normGoogle;

  const idsFromArray = (arr=[]) => arr
    .map(x => (typeof x === 'string' ? x : x?.id))
    .map(norm)
    .filter(Boolean);

  const ids = new Set();

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
      .select('refreshToken accessToken selectedCustomerIds defaultCustomerId selectedPropertyIds defaultPropertyId')
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

      // 👇 GA4 selections
      selectedPropertyIds: Array.isArray(google?.selectedPropertyIds) ? google.selectedPropertyIds.map(normGA4) : [],
      defaultPropertyId: google?.defaultPropertyId ? normGA4(google.defaultPropertyId) : null,
    },
    shopify: {
      connected: !!(shop && shop.shop && (shop.access_token || shop.accessToken)),
    }
  };
}

/* ---------- wait/retry por condición de carrera ---------- */
async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForSelectionIfOnboarding({ userId, type, source, maxTries = 6, delayMs = 500 }) {
  if (String(source || '').toLowerCase() !== 'onboarding') return null;

  for (let i = 0; i < maxTries; i++) {
    const [user, conn] = await Promise.all([
      User.findById(userId)
        .select('selectedGoogleAccounts selectedMetaAccounts selectedGAProperties')
        .lean(),
      detectConnections(userId),
    ]);

    if (type === 'google') {
      const sel =
        (conn.google.selectedIds?.length ? conn.google.selectedIds : (user?.selectedGoogleAccounts || []).map(normGoogle));
      if (sel && sel.length) return { user, conn };
    }

    if (type === 'meta') {
      const sel =
        (conn.meta.selectedIds?.length ? conn.meta.selectedIds : (user?.selectedMetaAccounts || []).map(normMeta));
      if (sel && sel.length) return { user, conn };
    }

    if (type === 'ga4') {
      const userSel = Array.isArray(user?.selectedGAProperties) ? user.selectedGAProperties.map(normGA4) : [];
      const connSel = conn.google.selectedPropertyIds || [];
      const eff = (connSel.length ? connSel : userSel);
      if (eff && eff.length) return { user, conn };
    }

    await sleep(delayMs);
  }

  return null;
}

/* ---------- helpers de issues especiales ---------- */
function buildSelectionRequiredIssue(type, raw) {
  const reason    = String(raw?.reason || '').toUpperCase();
  const available = Number(raw?.availableCount || (raw?.accountIds || []).length || 0);

  let platform = 'la fuente conectada';
  if (type === 'google') platform = 'Google Ads';
  if (type === 'meta')   platform = 'Meta Ads (Facebook/Instagram)';
  if (type === 'ga4')    platform = 'Google Analytics 4';

  const title =
    reason.startsWith('SELECTION_REQUIRED')
      ? `Selecciona qué cuenta de ${platform} auditar`
      : `Selecciona la cuenta / propiedad de ${platform}`;

  return {
    id: `selection_required_${type}`,
    area: 'setup',
    severity: 'media',
    title,
    evidence: available
      ? `Se detectaron ${available} cuentas/propiedades en ${platform}. Debes elegir 1 para auditar.`
      : `Hay varias cuentas/propiedades conectadas en ${platform} y es necesario elegir 1.`,
    recommendation: 'Vuelve al onboarding y selecciona 1 cuenta / 1 propiedad. Si el problema persiste, desconecta y vuelve a conectar Google/Meta.',
    estimatedImpact: 'medio',
  };
}

function buildSelectionMismatchIssue({ type, selected, available = [] }) {
  let platform = 'la fuente';
  if (type === 'google') platform = 'Google Ads';
  if (type === 'meta')   platform = 'Meta Ads';
  if (type === 'ga4')    platform = 'Google Analytics 4';

  return {
    id: `selection_mismatch_${type}`,
    area: 'setup',
    severity: 'alta',
    title: `La selección guardada no coincide con lo disponible en ${platform}`,
    evidence: `Seleccionado: ${selected}. Disponible: ${available.slice(0, 8).join(', ')}${available.length > 8 ? '…' : ''}`,
    recommendation: 'En Ajustes → Conexiones vuelve a seleccionar 1 cuenta / 1 propiedad. Si no aparece, reconecta la integración con el usuario correcto.',
    estimatedImpact: 'alto',
  };
}

/* ---------- MAIN ---------- */
async function runAuditFor({ userId, type, source = 'manual' }) {
  let t = String(type || '').toLowerCase();
  if (t === 'ga') t = 'ga4';

  try {
    const user = await User.findById(userId)
      .select('selectedGoogleAccounts selectedMetaAccounts selectedGAProperties plan planSlug')
      .lean();

    const planSlug = getPlanSlug(user);

    const planLimit   = PLAN_MAX_FINDINGS[planSlug] || PLAN_MAX_FINDINGS.gratis;
    const maxFindings = Math.min(GLOBAL_MAX_FINDINGS, planLimit);
    const minFindings = GLOBAL_MIN_FINDINGS;

    const connections = await detectConnections(userId);

    // Guardas de conexión
    if (t === 'meta'    && !connections.meta.connected)    throw new Error('SOURCE_NOT_CONNECTED_META');
    if (t === 'google'  && !connections.google.connected)  throw new Error('SOURCE_NOT_CONNECTED_GOOGLE');
    if (t === 'ga4'     && !connections.google.connected)  throw new Error('SOURCE_NOT_CONNECTED_GA4');
    if (t === 'shopify' && !connections.shopify.connected) throw new Error('SOURCE_NOT_CONNECTED_SHOPIFY');

    // Selección efectiva (1) — PRIORIDAD:
    // 1) conector (MetaAccount/GoogleAccount)
    // 2) User legacy/compat (selectedMetaAccounts/selectedGoogleAccounts/selectedGAProperties)
    const selMetaAll = (
      connections.meta.selectedIds.length
        ? connections.meta.selectedIds
        : (user?.selectedMetaAccounts || [])
    ).map(normMeta).filter(Boolean);

    const selGoogleAll = (
      connections.google.selectedIds.length
        ? connections.google.selectedIds
        : (user?.selectedGoogleAccounts || [])
    ).map(normGoogle).filter(Boolean);

    const selGA4All = (
      connections.google.selectedPropertyIds.length
        ? connections.google.selectedPropertyIds
        : (Array.isArray(user?.selectedGAProperties) ? user.selectedGAProperties : [])
    ).map(normGA4).filter(Boolean);

    // aplicamos el límite de UX: 1 por tipo
    const selMeta   = selMetaAll.slice(0, MAX_SELECT_PER_TYPE);
    const selGoogle = selGoogleAll.slice(0, MAX_SELECT_PER_TYPE);
    const selGA4    = selGA4All.slice(0, MAX_SELECT_PER_TYPE);

    let raw = null;
    let snapshot = null;
    let selectionNote = null;

    /* ---------- GOOGLE ADS ---------- */
    if (t === 'google') {
      raw = await collectGoogle(userId);

      if (raw?.requiredSelection && String(raw?.reason || '').startsWith('SELECTION_REQUIRED')) {
        if (!selGoogle.length) {
          const waited = await waitForSelectionIfOnboarding({ userId, type: 'google', source });
          if (waited) {
            const conn2 = waited.conn;
            const user2 = waited.user;
            const sel2 = (
              (conn2.google.selectedIds?.length ? conn2.google.selectedIds : (user2?.selectedGoogleAccounts || []).map(normGoogle))
            ).filter(Boolean).slice(0, 1);

            if (sel2.length) {
              raw = await collectGoogle(userId);
            }
          }
        }

        if (!selGoogle.length) {
          const issue = buildSelectionRequiredIssue('google', raw);
          await Audit.create({
            userId,
            type: 'google',
            origin: source || 'manual',
            generatedAt: new Date(),
            plan: planSlug,
            maxFindings,
            summary: 'Antes de generar la auditoría, selecciona 1 cuenta de Google Ads para analizar.',
            issues: [issue],
            actionCenter: [issue],
            topProducts: [],
            inputSnapshot: raw,
            version: 'audits@1.3.0-selection-1',
          });
          return true;
        }
      }

      const total = (raw?.accountIds && raw.accountIds.length) ||
                    (raw?.accounts   && raw.accounts.length)   || 0;

      if (selGoogle.length && total > 0) {
        const snapshotIds = new Set(
          (raw.accountIds || (raw.accounts || []).map(a => a.id) || []).map(normGoogle)
        );

        const effectiveSel = selGoogle.filter(id => snapshotIds.has(normGoogle(id)));

        if (effectiveSel.length > 0) {
          snapshot = filterSnapshot('google', raw, effectiveSel);
        } else {
          const available = Array.from(snapshotIds);
          const issue = buildSelectionMismatchIssue({
            type: 'google',
            selected: effectiveSel[0] || selGoogle[0],
            available,
          });
          await Audit.create({
            userId,
            type: 'google',
            origin: source || 'manual',
            generatedAt: new Date(),
            plan: planSlug,
            maxFindings,
            summary: 'No pudimos auditar porque la selección no coincide con las cuentas disponibles.',
            issues: [issue],
            actionCenter: [issue],
            topProducts: [],
            inputSnapshot: raw,
            version: 'audits@1.3.0-mismatch',
          });
          return true;
        }
      } else {
        snapshot = raw;

        if (!selGoogle.length && total > 1) {
          const picked = autoPickIds('google', raw, MAX_SELECT_PER_TYPE);
          snapshot = filterSnapshot('google', raw, picked);
          selectionNote = {
            id: 'auto_selection_google',
            title: 'Auditoría limitada automáticamente',
            area: 'setup',
            severity: 'media',
            evidence: `No había selección guardada. Se auditó 1 cuenta por defecto: ${picked.join(', ')}.`,
            recommendation: 'En Ajustes → Conexiones selecciona explícitamente 1 cuenta de Google Ads.',
            estimatedImpact: 'medio',
          };
        }
      }
    }

    /* ---------- META ADS ---------- */
    if (t === 'meta') {
      raw = await collectMeta(userId);

      if (raw?.requiredSelection && String(raw?.reason || '').startsWith('SELECTION_REQUIRED')) {
        if (!selMeta.length) {
          const waited = await waitForSelectionIfOnboarding({ userId, type: 'meta', source });
          if (waited) raw = await collectMeta(userId);
        }

        if (!selMeta.length) {
          const issue = buildSelectionRequiredIssue('meta', raw);
          await Audit.create({
            userId,
            type: 'meta',
            origin: source || 'manual',
            generatedAt: new Date(),
            plan: planSlug,
            maxFindings,
            summary: 'Antes de generar la auditoría, selecciona 1 cuenta de Meta Ads para analizar.',
            issues: [issue],
            actionCenter: [issue],
            topProducts: [],
            inputSnapshot: raw,
            version: 'audits@1.3.0-selection-1',
          });
          return true;
        }
      }

      const total = (raw?.accountIds && raw.accountIds.length) ||
                    (raw?.accounts   && raw.accounts.length)   || 0;

      if (selMeta.length && total > 0) {
        const snapshotIds = new Set(
          (raw.accountIds || (raw.accounts || []).map(a => a.id) || []).map(normMeta)
        );

        const effectiveSel = selMeta.filter(id => snapshotIds.has(normMeta(id)));

        if (effectiveSel.length > 0) {
          snapshot = filterSnapshot('meta', raw, effectiveSel);
        } else {
          const available = Array.from(snapshotIds);
          const issue = buildSelectionMismatchIssue({
            type: 'meta',
            selected: effectiveSel[0] || selMeta[0],
            available: available.map(x => `act_${x}`),
          });
          await Audit.create({
            userId,
            type: 'meta',
            origin: source || 'manual',
            generatedAt: new Date(),
            plan: planSlug,
            maxFindings,
            summary: 'No pudimos auditar porque la selección no coincide con las cuentas disponibles.',
            issues: [issue],
            actionCenter: [issue],
            topProducts: [],
            inputSnapshot: raw,
            version: 'audits@1.3.0-mismatch',
          });
          return true;
        }
      } else {
        snapshot = raw;

        if (!selMeta.length && total > 1) {
          const picked = autoPickIds('meta', raw, MAX_SELECT_PER_TYPE);
          snapshot = filterSnapshot('meta', raw, picked);
          selectionNote = {
            id: 'auto_selection_meta',
            title: 'Auditoría limitada automáticamente',
            area: 'setup',
            severity: 'media',
            evidence: `No había selección guardada. Se auditó 1 cuenta por defecto: ${picked.map(x=>'act_'+x).join(', ')}.`,
            recommendation: 'En Ajustes → Conexiones selecciona explícitamente 1 cuenta de Meta Ads.',
            estimatedImpact: 'medio',
          };
        }
      }
    }

    /* ---------- GA4 ---------- */
    if (t === 'ga4') {
      if (!collectGA4) throw new Error('GA4_COLLECTOR_NOT_AVAILABLE');

      // ✅ MEJORA: si ya hay selección (1), forzamos el collector a esa property (menos costo/latencia y menos ruido)
      if (selGA4.length) {
        const forced = ga4ToApiName(selGA4[0]) || selGA4[0];
        raw = await collectGA4(userId, { property_id: forced });
      } else {
        raw = await collectGA4(userId);
      }

      if (raw?.requiredSelection && String(raw?.reason || '').startsWith('SELECTION_REQUIRED')) {
        if (!selGA4.length) {
          const waited = await waitForSelectionIfOnboarding({ userId, type: 'ga4', source });
          if (waited) {
            const conn2 = waited.conn;
            const user2 = waited.user;

            const userSel = Array.isArray(user2?.selectedGAProperties) ? user2.selectedGAProperties.map(normGA4) : [];
            const connSel = conn2.google.selectedPropertyIds || [];
            const eff = (connSel.length ? connSel : userSel).slice(0, 1);

            if (eff.length) {
              const forced = ga4ToApiName(eff[0]) || eff[0];
              raw = await collectGA4(userId, { property_id: forced });
            } else {
              raw = await collectGA4(userId);
            }
          }
        }

        if (!selGA4.length) {
          const issue = buildSelectionRequiredIssue('ga4', raw);
          await Audit.create({
            userId,
            type: 'ga4',
            origin: source || 'manual',
            generatedAt: new Date(),
            plan: planSlug,
            maxFindings,
            summary: 'Antes de generar la auditoría, selecciona 1 propiedad de GA4 para analizar.',
            issues: [issue],
            actionCenter: [issue],
            topProducts: [],
            inputSnapshot: raw,
            version: 'audits@1.3.0-selection-1',
          });
          return true;
        }
      }

      snapshot = raw;

      // ✅ APLICAR SELECCIÓN GA4 (1) (defensivo; aunque ya la forzamos arriba)
      if (selGA4.length) {
        const wanted = selGA4[0];
        const filtered = filterGA4Snapshot(snapshot, wanted);

        const avail = new Set();
        const pushAvail = (x) => {
          const n = normGA4(x);
          if (n) avail.add(n);
          const api = ga4ToApiName(n);
          if (api) avail.add(normGA4(api));
        };

        (snapshot?.gaProperties || []).forEach((p) => pushAvail(p?.propertyId || p?.property_id || p?.name || p?.id));
        (snapshot?.properties || []).forEach((p) => pushAvail(p?.propertyId || p?.property_id || p?.name || p?.id));
        (snapshot?.byProperty || []).forEach((p) => pushAvail(p?.propertyId || p?.property_id || p?.name || p?.id || p?.property));

        if (avail.size) {
          if (!avail.has(normGA4(wanted))) {
            const issue = buildSelectionMismatchIssue({
              type: 'ga4',
              selected: ga4ToApiName(wanted) || wanted,
              available: Array.from(avail),
            });
            await Audit.create({
              userId,
              type: 'ga4',
              origin: source || 'manual',
              generatedAt: new Date(),
              plan: planSlug,
              maxFindings,
              summary: 'No pudimos auditar porque la property seleccionada no aparece como disponible para este usuario.',
              issues: [issue],
              actionCenter: [issue],
              topProducts: [],
              inputSnapshot: raw,
              version: 'audits@1.3.0-mismatch',
            });
            return true;
          }
        }

        snapshot = filtered;
      }
    }

    /* ---------- SHOPIFY ---------- */
    if (t === 'shopify') {
      snapshot = await collectShopify(userId);
      raw = snapshot;
    }

    if (!snapshot) throw new Error('SNAPSHOT_EMPTY');

    // Auditoría anterior para tendencia
    const previousAudit = await Audit.findOne({ userId, type: t })
      .sort({ generatedAt: -1 })
      .lean();

    const previousSnapshot = previousAudit?.inputSnapshot || null;
    const trend = buildTrend(t, snapshot, previousSnapshot);

    // ¿Tenemos datos reales tras el filtrado?
    const hasAdsData = Array.isArray(snapshot.byCampaign) && snapshot.byCampaign.length > 0;

    // ✅ MEJORA: GA4 “hay data” considera también daily/sourceMedium/topEvents
    const hasGAData =
      (Array.isArray(snapshot.channels)   && snapshot.channels.length   > 0) ||
      (Array.isArray(snapshot.byProperty) && snapshot.byProperty.length > 0) ||
      (Array.isArray(snapshot.daily)      && snapshot.daily.length      > 0) ||
      (Array.isArray(snapshot.sourceMedium) && snapshot.sourceMedium.length > 0) ||
      (Array.isArray(snapshot.topEvents)  && snapshot.topEvents.length  > 0) ||
      (snapshot.aggregate && (
        Number(snapshot.aggregate.users || 0)       > 0 ||
        Number(snapshot.aggregate.sessions || 0)    > 0 ||
        Number(snapshot.aggregate.conversions || 0) > 0 ||
        Number(snapshot.aggregate.revenue || 0)     > 0
      ));

    let noData = false;
    if (t === 'google' || t === 'meta') noData = !hasAdsData;
    else if (t === 'ga4') noData = !hasGAData;

    let auditJson = { summary: '', issues: [] };

    if (!noData) {
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

    if (selectionNote) {
      auditJson.issues = Array.isArray(auditJson.issues) ? auditJson.issues : [];
      auditJson.issues.unshift(selectionNote);
    }

    auditJson.issues = Array.isArray(auditJson.issues) ? auditJson.issues : [];

    if (auditJson.issues.length > maxFindings) {
      auditJson.issues = auditJson.issues.slice(0, maxFindings);
    }

    const auditDoc = {
      userId,
      type: t,
      origin: source || 'manual',
      generatedAt: new Date(),
      plan: planSlug,
      maxFindings,
      summary: auditJson?.summary || (noData ? 'No hay datos suficientes en el periodo.' : 'Auditoría generada'),
      issues: auditJson?.issues || [],
      actionCenter: auditJson?.actionCenter || (auditJson?.issues || []).slice(0, 3),
      topProducts: auditJson?.topProducts || [],
      inputSnapshot: snapshot,
      version: 'audits@1.3.0',
      trendSummary: trend || null,
    };

    await Audit.create(auditDoc);
    return true;

  } catch (e) {
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
        recommendation: 'Verifica conexión y permisos. Asegúrate de seleccionar 1 cuenta/property antes de auditar.',
        estimatedImpact: 'alto',
      }],
      actionCenter: [],
      inputSnapshot: {},
      version: 'audits@1.3.0-error',
    });
    return false;
  }
}

module.exports = { runAuditFor };
