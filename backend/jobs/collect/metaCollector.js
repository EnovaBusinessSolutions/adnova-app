// backend/jobs/collect/metaCollector.js
'use strict';

const fetch = require('node-fetch');
const mongoose = require('mongoose');

const API_VER = process.env.FACEBOOK_API_VERSION || 'v19.0';
// [★] Límite duro 3 por requerimiento, sobre-escribible por env
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
const normAct = (s = '') => String(s).replace(/^act_/, '').trim();

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

/* ---------------- collector ---------------- */

async function collectMeta(userId, opts = {}) {
  const {
    account_id,               // opcional: forzar una sola cuenta (útil para “ver una cuenta”)
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
  const availSet = new Set(available.map(a => a.id));

  // [★] Selección “real” a usar:
  // - si pasan account_id => solo esa
  // - si el usuario tiene selectedMetaAccounts => usarlas (cap a 3), y además filtrar a las disponibles
  // - si nada de lo anterior => defaultAccountId o primeras disponibles (cap a 3)
  let accountsToAudit = [];
  if (account_id) {
    const id = normAct(account_id);
    if (!id) {
      return { notAuthorized: true, reason: 'INVALID_ACCOUNT_ID', byCampaign: [], accountIds: [] };
    }
    accountsToAudit = [{ id, name: null }];
  } else if (Array.isArray(user?.selectedMetaAccounts) && user.selectedMetaAccounts.length) {
    const normalized = user.selectedMetaAccounts
      .map((x) => normAct(x))
      .filter((x) => x && availSet.has(x)); // sólo las que realmente están disponibles para este Meta
    const unique = Array.from(new Set(normalized)).slice(0, MAX_ACCOUNTS);
    accountsToAudit = unique.map(id => {
      const found = available.find(a => a.id === id);
      return { id, name: found?.name || null };
    });
  } else {
    const fallback = pickDefaultAccountId(acc);
    if (fallback) {
      accountsToAudit = [{ id: fallback, name: (available.find(a => a.id === fallback)?.name) || null }];
    } else {
      accountsToAudit = available.slice(0, Math.max(1, MAX_ACCOUNTS));
    }
  }

  // Campos de insights
  const baseFields = [
    'date_start', 'date_stop',
    'campaign_id', 'campaign_name', 'objective',
    'spend', 'impressions', 'clicks', 'cpm', 'cpc', 'ctr',
    'actions', 'action_values', 'purchase_roas'
  ];
  const fields = Array.isArray(userFields) && userFields.length ? userFields : baseFields;

  // Construye URL con presets/rangos
  const mkUrl = (actId, preset) => {
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
  const accountIds = [];
  const accountCurrency = new Map();
  const accountNameMap = new Map();
  const accountTzMap = new Map();

  let minStart = null;
  let maxStop  = null;

  for (const acct of accountsToAudit) {
    const actId = acct.id;
    accountIds.push(actId);

    // metadatos
    const meta = await getAccountMeta(actId);
    accountCurrency.set(actId, meta.currency);
    accountNameMap.set(actId, acct.name || meta.accountName || null);
    accountTzMap.set(actId, meta.timezone_name);

    // insights
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

    if (!since && !until && data.length === 0) {
      for (const p of ['last_90d', 'last_180d', 'last_year']) {
        try {
          presetTried = p;
          data = await pageAllInsights(mkUrl(actId, p));
          if (data.length > 0) break;
        } catch { /* sigue */ }
      }
    }

    // campañas
    for (const x of data) {
      const roas = Array.isArray(x.purchase_roas) && x.purchase_roas[0]?.value ? Number(x.purchase_roas[0].value) : null;
      const { purchases, purchase_value } = extractPurchaseMetrics(x);

      if (x.date_start && (!minStart || x.date_start < minStart)) minStart = x.date_start;
      if (x.date_stop  && (!maxStop  || x.date_stop  > maxStop )) maxStop  = x.date_stop;

      byCampaign.push({
        account_id: actId,
        id: x.campaign_id,
        name: x.campaign_name || 'Sin nombre',
        objective: x.objective || null,
        kpis: {
          spend: toNum(x.spend),
          impressions: toNum(x.impressions),
          clicks: toNum(x.clicks),
          cpm: toNum(x.cpm),
          cpc: toNum(x.cpc),
          ctr: toNum(x.ctr),
          roas: roas ?? (purchase_value ? safeDiv(purchase_value, toNum(x.spend)) : 0),
          purchases: purchases ?? null,
          purchase_value: purchase_value ?? null,
        },
        period: { since: x.date_start, until: x.date_stop },
        accountMeta: {
          name: accountNameMap.get(actId) || null,
          currency: accountCurrency.get(actId) || null,
          timezone_name: accountTzMap.get(actId) || null,
        }
      });
    }
  }

  // KPIs globales
  const G = byCampaign.reduce(
    (a, c) => {
      a.impr += c.kpis.impressions || 0;
      a.clk  += c.kpis.clicks || 0;
      a.cost += c.kpis.spend || 0;
      return a;
    },
    { impr: 0, clk: 0, cost: 0 }
  );

  // moneda unificada (si aplica)
  const uniqueCurrencies = Array.from(new Set(
    accountIds.map(id => accountCurrency.get(id)).filter(Boolean)
  ));
  const unifiedCurrency = uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : null;

  // arreglo de cuentas para UI/LLM
  const accounts = accountIds.map(id => ({
    id,
    name: accountNameMap.get(id) || null,
    currency: accountCurrency.get(id) || null,
    timezone_name: accountTzMap.get(id) || null,
  }));

  return {
    notAuthorized: false,
    defaultAccountId: pickDefaultAccountId(acc) || null,
    currency: unifiedCurrency,
    timeRange: { from: minStart, to: maxStop },
    kpis: {
      impressions: G.impr,
      clicks: G.clk,
      cost: G.cost,
      cpc: safeDiv(G.cost, G.clk),
    },
    byCampaign,
    accountIds,   // compat
    accounts,     // { id, name, currency, timezone_name }
    version: 'metaCollector@multi-accounts',
  };
}

module.exports = { collectMeta };
