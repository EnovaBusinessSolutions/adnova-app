// backend/jobs/collect/metaCollector.js
'use strict';

const fetch = require('node-fetch');
const mongoose = require('mongoose');

const API_VER = process.env.FACEBOOK_API_VERSION || 'v19.0';
// [★] Límite duro 3 por requerimiento, sobre-escribible por env (pero no mayor a 3)
const HARD_LIMIT = 3;
const MAX_ACCOUNTS = Math.min(
  HARD_LIMIT,
  Number(process.env.META_MAX_ACCOUNTS || HARD_LIMIT)
);

// --- Models (con fallbacks) ---
let MetaAccount, User;
try { MetaAccount = require('../../models/MetaAccount'); } catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    access_token: String,
    token: String,
    accessToken: String,
    longLivedToken: String,
    longlivedToken: String,
    defaultAccountId: String,
    ad_accounts: { type: Array, default: [] },
    adAccounts: { type: Array, default: [] },
    scopes: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now },
  }, { collection: 'metaaccounts' });
  schema.pre('save', function (n) { this.updatedAt = new Date(); n(); });
  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}
try { User = require('../../models/User'); } catch (_) {
  const { Schema, model } = mongoose;
  User = mongoose.models.User || model('User', new Schema({}, { strict: false, collection: 'users' }));
}

/* ---------------- utils ---------------- */
const toNum   = (v) => Number(v || 0);
const safeDiv = (n, d) => (Number(d || 0) ? Number(n || 0) / Number(d || 0) : 0);
// Normaliza id de ad account / campaña: quita "act_" y cualquier no-dígito
const normAct = (s = '') => String(s).replace(/^act_/, '').replace(/[^\d]/g, '').trim();

// budgets en Meta vienen en unidades menores (p.ej. centavos)
const minorToUnit = (v) => (v == null ? null : Number(v) / 100);

function pickToken(acc) {
  return (
    acc?.longLivedToken ||
    acc?.longlivedToken ||
    acc?.access_token ||
    acc?.accessToken ||
    acc?.token ||
    null
  );
}

function pickDefaultAccountId(acc) {
  let id = normAct(acc?.defaultAccountId || '');
  if (id) return id;

  const first =
    (Array.isArray(acc?.ad_accounts) && (acc.ad_accounts[0]?.id || acc.ad_accounts[0])) ||
    (Array.isArray(acc?.adAccounts) && (acc.adAccounts[0]?.id || acc.adAccounts[0])) ||
    null;

  if (first) return normAct(first);
  return '';
}

async function fetchJSON(url, { retries = 1 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { timeout: 30000 });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const code = j?.error?.code || r.status;
        if ((code === 4 || code === 17 || String(code).startsWith('5')) && i < retries) {
          await new Promise(res => setTimeout(res, 800 + i * 500));
          continue;
        }
        const msg = j?.error?.message || `HTTP_${r.status}`;
        const err = new Error(msg);
        err._meta = j?.error || {};
        throw err;
      }
      return j;
    } catch (e) {
      lastErr = e;
      if (i === retries) throw e;
    }
  }
  throw lastErr || new Error('unknown_error');
}

async function pageAllInsights(baseUrl) {
  const out = [];
  let next = baseUrl;
  let guard = 0;
  while (next && guard < 20) {
    guard += 1;
    const j = await fetchJSON(next, { retries: 1 });
    const data = Array.isArray(j?.data) ? j.data : [];
    out.push(...data);
    next = j?.paging?.next || null;
  }
  return out;
}

function extractPurchaseMetrics(x) {
  let purchases = null;
  let value = null;

  const actions = Array.isArray(x.actions) ? x.actions : [];
  for (const a of actions) {
    const t = (a.action_type || '').toLowerCase();
    if (t === 'purchase' || t.includes('fb_pixel_purchase')) {
      const v = Number(a.value);
      if (!Number.isNaN(v)) purchases = (purchases || 0) + v;
    }
  }

  const actionValues = Array.isArray(x.action_values) ? x.action_values : [];
  for (const av of actionValues) {
    const t = (av.action_type || '').toLowerCase();
    if (t === 'purchase' || t.includes('fb_pixel_purchase')) {
      const v = Number(av.value);
      if (!Number.isNaN(v)) value = (value || 0) + v;
    }
  }

  return { purchases, purchase_value: value };
}

/* ---------------- helpers de cuentas ---------------- */

// Normaliza todas las cuentas disponibles desde el documento MetaAccount del usuario
function getAllAvailableAccounts(accDoc) {
  const raw = [
    ...(Array.isArray(accDoc?.ad_accounts) ? accDoc.ad_accounts : []),
    ...(Array.isArray(accDoc?.adAccounts) ? accDoc.adAccounts : []),
  ];
  return raw
    .map(x => {
      const id = normAct(x?.id || x || '');
      const name = x?.name || x?.account_name || null;
      return id ? { id, name } : null;
    })
    .filter(Boolean);
}

/** Trae metadatos de campañas de una ad account (status + objetivo + budgets) */
async function fetchAllCampaignMeta(actId, token) {
  const map = new Map();
  let next = `https://graph.facebook.com/${API_VER}/act_${actId}/campaigns?fields=id,name,status,effective_status,objective,buying_type,bid_strategy,daily_budget,lifetime_budget,special_ad_category&limit=500&access_token=${encodeURIComponent(token)}`;
  let guard = 0;

  while (next && guard < 20) {
    guard += 1;
    const j = await fetchJSON(next, { retries: 1 });
    const data = Array.isArray(j?.data) ? j.data : [];
    for (const c of data) {
      const id = normAct(c.id || '');
      if (!id) continue;
      map.set(id, {
        id,
        name: c.name || null,
        status: c.status || null,
        effective_status: c.effective_status || null,
        objective: c.objective || null,
        buying_type: c.buying_type || null,
        bid_strategy: c.bid_strategy || null,
        daily_budget: minorToUnit(c.daily_budget),
        lifetime_budget: minorToUnit(c.lifetime_budget),
        special_ad_category: c.special_ad_category || null,
      });
    }
    next = j?.paging?.next || null;
  }

  return map;
}

/* ---------------- collector ---------------- */

async function collectMeta(userId, opts = {}) {
  const {
    account_id,               // opcional: forzar una sola cuenta
    date_preset = 'last_30d', // today, yesterday, last_7d, last_30d, this_month, last_month, lifetime
    level = 'campaign',       // campaign|adset|ad
    fields: userFields,       // opcional override
    since, until              // si defines since/until, ignoramos date_preset
  } = opts;

  // Carga MetaAccount (tokens) y User (selección)
  const [acc, user] = await Promise.all([
    MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
      .select('+access_token +token +accessToken +longLivedToken +longlivedToken scopes ad_accounts adAccounts defaultAccountId')
      .lean(),
    User.findById(userId).lean()
  ]);

  if (!acc) {
    return { notAuthorized: true, reason: 'NO_METAACCOUNT', byCampaign: [], accountIds: [] };
  }

  const token = pickToken(acc);
  if (!token) {
    return { notAuthorized: true, reason: 'NO_TOKEN', byCampaign: [], accountIds: [] };
  }

  const scopes = Array.isArray(acc.scopes) ? acc.scopes.map(s => String(s || '').toLowerCase()) : [];
  const hasRead = scopes.includes('ads_read') || scopes.includes('ads_management');
  if (!hasRead) {
    return {
      notAuthorized: true,
      reason: 'MISSING_SCOPES(ads_read|ads_management)',
      byCampaign: [],
      accountIds: []
    };
  }

  // Universo disponible
  const available = getAllAvailableAccounts(acc);
  const availById = new Map(available.map(a => [a.id, a]));
  const availSet = new Set(available.map(a => a.id));

  // --- Selección real ---
  // 1) si pasan account_id => solo esa
  // 2) merge de users.selectedMetaAccounts + users.preferences.meta.auditAccountIds (en ese orden)
  // 3) fallback: defaultAccountId ó primeras disponibles
  let accountsToAudit = [];

  if (account_id) {
    const id = normAct(account_id);
    if (!id) {
      return { notAuthorized: true, reason: 'INVALID_ACCOUNT_ID', byCampaign: [], accountIds: [] };
    }
    if (availSet.has(id)) accountsToAudit = [{ id, name: availById.get(id)?.name || null }];
  } else {
    const legacySel = Array.isArray(user?.selectedMetaAccounts) ? user.selectedMetaAccounts : [];
    const prefSel   = Array.isArray(user?.preferences?.meta?.auditAccountIds) ? user.preferences.meta.auditAccountIds : [];
    const merged = [...legacySel, ...prefSel]
      .map(normAct)
      .filter(id => id && availSet.has(id));

    // preserva orden del usuario, dedupe y cap
    const seen = new Set();
    const ordered = [];
    for (const id of merged) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
      if (ordered.length >= MAX_ACCOUNTS) break;
    }
    if (ordered.length) {
      accountsToAudit = ordered.map(id => ({ id, name: availById.get(id)?.name || null }));
    } else {
      const fallback = pickDefaultAccountId(acc);
      if (fallback && availSet.has(fallback)) {
        accountsToAudit = [{ id: fallback, name: availById.get(fallback)?.name || null }];
      } else {
        accountsToAudit = available.slice(0, Math.max(1, MAX_ACCOUNTS));
      }
    }
  }

  // Si por alguna razón quedó vacío, último fallback a primera disponible
  if (!accountsToAudit.length && available.length) {
    accountsToAudit = available.slice(0, 1);
  }

  // Campos de insights base (puedes añadir más si hace falta)
  const baseFields = [
    'date_start', 'date_stop',
    'campaign_id', 'campaign_name', 'objective',
    'spend', 'impressions', 'reach', 'frequency',
    'clicks', 'cpm', 'cpc', 'ctr',
    'unique_clicks', 'inline_link_clicks',
    'actions', 'action_values', 'purchase_roas'
  ];
  const fields = Array.isArray(userFields) && userFields.length ? userFields : baseFields;

  // Construye URL con presets/rangos (+ extras como breakdowns)
  const mkUrl = (actId, preset, extra = {}) => {
    const qp = new URLSearchParams();
    if (since && until) {
      qp.set('time_range', JSON.stringify({ since, until }));
    } else if (preset) {
      qp.set('date_preset', preset);
    }
    qp.set('level', level);
    qp.set('fields', fields.join(','));
    qp.set('limit', '5000');
    qp.set('use_unified_attribution_setting', 'true');
    if (extra.breakdowns) qp.set('breakdowns', extra.breakdowns);
    if (extra.time_increment != null) qp.set('time_increment', String(extra.time_increment));
    qp.set('access_token', token);
    return `https://graph.facebook.com/${API_VER}/act_${actId}/insights?${qp.toString()}`;
  };

  // Lee metadatos de una cuenta
  async function getAccountMeta(actId) {
    try {
      const u = `https://graph.facebook.com/${API_VER}/act_${actId}?fields=currency,name,timezone_name&access_token=${encodeURIComponent(token)}`;
      const j = await fetchJSON(u);
      return {
        currency: j?.currency || null,
        accountName: j?.name || null,
        timezone_name: j?.timezone_name || null,
      };
    } catch {
      return { currency: null, accountName: null, timezone_name: null };
    }
  }

  /* ---------- loop por cuentas ---------- */

  const byCampaign = [];
  const byCampaignDevice = [];     // 👈 nuevo
  const byCampaignPlacement = [];  // 👈 nuevo
  const accountIds = [];
  const accountCurrency = new Map();
  const accountNameMap = new Map();
  const accountTzMap = new Map();

  let minStart = null;
  let maxStop  = null;

  for (const acct of accountsToAudit) {
    const actId = acct.id;
    accountIds.push(actId);

    // metadatos de la cuenta
    const meta = await getAccountMeta(actId);
    accountCurrency.set(actId, meta.currency);
    accountNameMap.set(actId, acct.name || meta.accountName || null);
    accountTzMap.set(actId, meta.timezone_name);

    // metadatos de campañas (status, objetivo, budgets, etc.)
    let campMeta = new Map();
    try {
      campMeta = await fetchAllCampaignMeta(actId, token);
    } catch {
      campMeta = new Map();
    }

    // insights generales por campaña
    let data = [];
    let presetTried = since && until ? undefined : (date_preset || 'last_30d');
    try {
      data = await pageAllInsights(mkUrl(actId, presetTried));
    } catch (e) {
      const code = e?._meta?.code;
      const subcode = e?._meta?.error_subcode;
      const isAuth = code === 190 || subcode === 463 || subcode === 467;
      const reason = isAuth ? 'TOKEN_INVALID_OR_EXPIRED' : (e?.message || 'Meta insights failed');
      return { notAuthorized: true, reason, byCampaign: [], accountIds };
    }

    // si no hay datos recientes, probamos rangos más largos
    if (!since && !until && data.length === 0) {
      for (const p of ['last_90d', 'last_180d', 'last_year']) {
        try {
          presetTried = p;
          data = await pageAllInsights(mkUrl(actId, p));
          if (data.length > 0) break;
        } catch { /* sigue */ }
      }
    }

    // agregadores por campaña (cuenta actual)
    const byCampAgg = new Map();

    for (const x of data) {
      const { purchases, purchase_value } = extractPurchaseMetrics(x);
      const roasField = (Array.isArray(x.purchase_roas) && x.purchase_roas[0]?.value)
        ? Number(x.purchase_roas[0].value)
        : null;

      if (x.date_start && (!minStart || x.date_start < minStart)) minStart = x.date_start;
      if (x.date_stop  && (!maxStop  || x.date_stop  > maxStop )) maxStop  = x.date_stop;

      const campIdNorm = normAct(x.campaign_id || '');
      const metaInfo = campMeta.get(campIdNorm) || {};

      const key = campIdNorm || x.campaign_id || 'unknown';

      const cur = byCampAgg.get(key) || {
        account_id: actId,
        id: x.campaign_id,
        name: x.campaign_name || metaInfo.name || 'Sin nombre',
        objective: x.objective || metaInfo.objective || null,
        status: metaInfo.status || metaInfo.effective_status || null,
        effectiveStatus: metaInfo.effective_status || null,
        buying_type: metaInfo.buying_type || null,
        bid_strategy: metaInfo.bid_strategy || null,
        budget: {
          daily: metaInfo.daily_budget || null,
          lifetime: metaInfo.lifetime_budget || null,
        },
        special_ad_category: metaInfo.special_ad_category || null,
        period: { since: x.date_start, until: x.date_stop },
        kpis: {
          spend: 0,
          impressions: 0,
          reach: 0,
          frequency: 0,
          clicks: 0,
          cpm: 0,
          cpc: 0,
          ctr: 0,
          unique_clicks: 0,
          inline_link_clicks: 0,
          purchases: 0,
          purchase_value: 0,
          roas: 0,
        },
        _freqDenominator: 0, // para promediar frequency correctamente
      };

      const k = cur.kpis;
      k.spend       += toNum(x.spend);
      k.impressions += toNum(x.impressions);
      k.reach       += toNum(x.reach);
      k.clicks      += toNum(x.clicks);
      k.unique_clicks      += toNum(x.unique_clicks);
      k.inline_link_clicks += toNum(x.inline_link_clicks);
      if (purchases != null)      k.purchases      += purchases;
      if (purchase_value != null) k.purchase_value += purchase_value;

      // frequency viene ya promediada por fila, la re-promediamos ponderada por impresiones
      const freqVal = toNum(x.frequency);
      if (freqVal && toNum(x.impressions) > 0) {
        cur._freqDenominator += toNum(x.impressions);
        k.frequency = safeDiv(
          (k.frequency * (cur._freqDenominator - toNum(x.impressions)) + freqVal * toNum(x.impressions)),
          cur._freqDenominator
        );
      }

      // recalculamos métricas derivadas
      k.cpm  = k.impressions ? (k.spend / k.impressions) * 1000 : 0;
      k.cpc  = k.clicks ? (k.spend / k.clicks) : 0;
      k.ctr  = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
      k.roas = roasField != null
        ? roasField
        : (k.purchase_value ? safeDiv(k.purchase_value, k.spend) : 0);

      byCampAgg.set(key, cur);
    }

    // insights por dispositivo
    const byCampDeviceAgg = new Map();
    try {
      const devData = await pageAllInsights(
        mkUrl(actId, presetTried, { breakdowns: 'device_platform' })
      );
      for (const x of devData) {
        const campIdNorm = normAct(x.campaign_id || '');
        if (!campIdNorm) continue;
        const device = x.device_platform || null;
        if (!device) continue;

        const { purchases, purchase_value } = extractPurchaseMetrics(x);

        const dupKey = `${campIdNorm}::${device}`;
        const cur = byCampDeviceAgg.get(dupKey) || {
          account_id: actId,
          campaign_id: campIdNorm,
          device,
          kpis: {
            spend: 0,
            impressions: 0,
            reach: 0,
            clicks: 0,
            cpm: 0,
            cpc: 0,
            ctr: 0,
            purchases: 0,
            purchase_value: 0,
            roas: 0,
          },
        };
        const k = cur.kpis;
        k.spend       += toNum(x.spend);
        k.impressions += toNum(x.impressions);
        k.reach       += toNum(x.reach);
        k.clicks      += toNum(x.clicks);
        if (purchases != null)      k.purchases      += purchases;
        if (purchase_value != null) k.purchase_value += purchase_value;

        k.cpm  = k.impressions ? (k.spend / k.impressions) * 1000 : 0;
        k.cpc  = k.clicks ? (k.spend / k.clicks) : 0;
        k.ctr  = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
        k.roas = k.purchase_value ? safeDiv(k.purchase_value, k.spend) : 0;

        byCampDeviceAgg.set(dupKey, cur);
      }
    } catch {
      // si falla el breakdown, no rompemos el collector
    }

    // insights por plataforma (Facebook / Instagram / Audience Network…)
    const byCampPlacementAgg = new Map();
    try {
      const plData = await pageAllInsights(
        mkUrl(actId, presetTried, { breakdowns: 'publisher_platform' })
      );
      for (const x of plData) {
        const campIdNorm = normAct(x.campaign_id || '');
        if (!campIdNorm) continue;
        const platform = x.publisher_platform || null;
        if (!platform) continue;

        const { purchases, purchase_value } = extractPurchaseMetrics(x);

        const dupKey = `${campIdNorm}::${platform}`;
        const cur = byCampPlacementAgg.get(dupKey) || {
          account_id: actId,
          campaign_id: campIdNorm,
          platform,
          kpis: {
            spend: 0,
            impressions: 0,
            reach: 0,
            clicks: 0,
            cpm: 0,
            cpc: 0,
            ctr: 0,
            purchases: 0,
            purchase_value: 0,
            roas: 0,
          },
        };
        const k = cur.kpis;
        k.spend       += toNum(x.spend);
        k.impressions += toNum(x.impressions);
        k.reach       += toNum(x.reach);
        k.clicks      += toNum(x.clicks);
        if (purchases != null)      k.purchases      += purchases;
        if (purchase_value != null) k.purchase_value += purchase_value;

        k.cpm  = k.impressions ? (k.spend / k.impressions) * 1000 : 0;
        k.cpc  = k.clicks ? (k.spend / k.clicks) : 0;
        k.ctr  = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
        k.roas = k.purchase_value ? safeDiv(k.purchase_value, k.spend) : 0;

        byCampPlacementAgg.set(dupKey, cur);
      }
    } catch {
      // igual, si falla no se rompe nada
    }

    // volcamos campañas agregadas de la cuenta a byCampaign
    for (const [, v] of byCampAgg.entries()) {
      byCampaign.push({
        account_id: v.account_id,
        id: v.id,
        name: v.name,
        objective: v.objective,
        status: v.status,
        effectiveStatus: v.effectiveStatus,
        buying_type: v.buying_type,
        bid_strategy: v.bid_strategy,
        budget: v.budget,
        special_ad_category: v.special_ad_category,
        kpis: {
          spend: v.kpis.spend,
          impressions: v.kpis.impressions,
          reach: v.kpis.reach,
          frequency: v.kpis.frequency,
          clicks: v.kpis.clicks,
          cpm: v.kpis.cpm,
          cpc: v.kpis.cpc,
          ctr: v.kpis.ctr,
          unique_clicks: v.kpis.unique_clicks,
          inline_link_clicks: v.kpis.inline_link_clicks,
          purchases: v.kpis.purchases,
          purchase_value: v.kpis.purchase_value,
          roas: v.kpis.roas,
        },
        period: v.period,
        accountMeta: {
          name: accountNameMap.get(actId) || null,
          currency: accountCurrency.get(actId) || null,
          timezone_name: accountTzMap.get(actId) || null,
        }
      });
    }

    // volcamos desglose por dispositivo
    for (const [, v] of byCampDeviceAgg.entries()) {
      byCampaignDevice.push({
        account_id: v.account_id,
        campaign_id: v.campaign_id,
        device: v.device,
        kpis: v.kpis,
        period: { since: minStart, until: maxStop },
      });
    }

    // volcamos desglose por plataforma
    for (const [, v] of byCampPlacementAgg.entries()) {
      byCampaignPlacement.push({
        account_id: v.account_id,
        campaign_id: v.campaign_id,
        platform: v.platform,
        kpis: v.kpis,
        period: { since: minStart, until: maxStop },
      });
    }
  } // fin loop cuentas

  // KPIs globales (todas las cuentas / campañas)
  const G = byCampaign.reduce(
    (a, c) => {
      const k = c.kpis || {};
      a.impr += k.impressions || 0;
      a.clk  += k.clicks || 0;
      a.cost += k.spend || 0;
      a.pur  += k.purchases || 0;
      a.val  += k.purchase_value || 0;
      return a;
    },
    { impr: 0, clk: 0, cost: 0, pur: 0, val: 0 }
  );

  // moneda unificada (si aplica)
  const uniqueCurrencies = Array.from(new Set(
    accountIds.map(id => accountCurrency.get(id)).filter(Boolean)
  ));
  const unifiedCurrency = uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : null;

  // KPI por cuenta
  const byAccountAgg = new Map();
  for (const c of byCampaign) {
    const id = c.account_id;
    const k = c.kpis || {};
    const agg = byAccountAgg.get(id) || { impr: 0, clk: 0, cost: 0, pur: 0, val: 0 };
    agg.impr += k.impressions || 0;
    agg.clk  += k.clicks || 0;
    agg.cost += k.spend || 0;
    agg.pur  += k.purchases || 0;
    agg.val  += k.purchase_value || 0;
    byAccountAgg.set(id, agg);
  }

  // arreglo de cuentas para UI/LLM (con KPIs)
  const accounts = accountIds.map(id => {
    const agg = byAccountAgg.get(id) || { impr: 0, clk: 0, cost: 0, pur: 0, val: 0 };
    return {
      id,
      name: accountNameMap.get(id) || null,
      currency: accountCurrency.get(id) || null,
      timezone_name: accountTzMap.get(id) || null,
      kpis: {
        impressions: agg.impr,
        clicks: agg.clk,
        cost: agg.cost,
        purchases: agg.pur,
        purchase_value: agg.val,
        cpc: safeDiv(agg.cost, agg.clk),
        roas: agg.val ? safeDiv(agg.val, agg.cost) : 0,
      },
    };
  });

  return {
    notAuthorized: false,
    defaultAccountId: pickDefaultAccountId(acc) || null,
    currency: unifiedCurrency,
    timeRange: { from: minStart, to: maxStop },
    kpis: {
      impressions: G.impr,
      clicks: G.clk,
      cost: G.cost,
      purchases: G.pur,
      purchase_value: G.val,
      cpc: safeDiv(G.cost, G.clk),
      roas: G.val ? safeDiv(G.val, G.cost) : 0,
    },
    byCampaign,
    byCampaignDevice,     // 👈 NUEVO: desglose por tipo de dispositivo
    byCampaignPlacement,  // 👈 NUEVO: desglose por plataforma (FB, IG, Audience, etc.)
    accountIds,   // para audits.js (reparto)
    accounts,     // para anotar [Nombre] en títulos y dar contexto de cuenta
    version: 'metaCollector@multi-accounts+rich-v2',
  };
}

module.exports = { collectMeta };
