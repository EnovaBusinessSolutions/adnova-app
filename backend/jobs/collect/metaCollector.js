// backend/api/jobs/collect/metaCollector.js
'use strict';

/**
 * Collector de Meta Ads (Facebook/Instagram)
 * - Trae insights a nivel campaign (por defecto) con fallback de fechas si no hay datos recientes.
 * - Autoselecciona la primera ad account si falta defaultAccountId.
 * - Soporta paginación y extrae compras/valor de actions/action_values.
 */

const fetch = require('node-fetch');
const mongoose = require('mongoose');

let MetaAccount;
try {
  MetaAccount = require('../../models/MetaAccount');
} catch (_) {
  // Fallback mínimo si el modelo no está disponible (no debería pasar en prod)
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

const API_VER = process.env.FACEBOOK_API_VERSION || 'v19.0';

const toNum   = (v) => Number(v || 0);
const safeDiv = (n, d) => (Number(d || 0) ? Number(n || 0) / Number(d || 0) : 0);
const normAct = (s = '') => String(s).replace(/^act_/, '').trim();

function extractPurchaseMetrics(x) {
  // Meta puede devolver purchases y value en "actions" y "action_values"
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

async function fetchJSON(url, { retries = 1 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { timeout: 30000 });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const code = j?.error?.code || r.status;
        // 4/17 => rate limit; 5xx => server; reintenta 1–2 veces
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

function pickToken(acc) {
  // Soporta múltiples campos posibles (por compatibilidad)
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
  // 1) defaultAccountId
  let id = normAct(acc?.defaultAccountId || '');
  if (id) return id;

  // 2) primera cuenta en ad_accounts o adAccounts
  const first =
    (Array.isArray(acc?.ad_accounts) && acc.ad_accounts[0]?.id) ||
    (Array.isArray(acc?.adAccounts) && acc.adAccounts[0]?.id) ||
    null;

  if (first) return normAct(first);

  return '';
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

async function collectMeta(userId, opts = {}) {
  const {
    account_id,
    date_preset = 'last_30d', // today, yesterday, last_7d, last_30d, this_month, last_month, lifetime
    level = 'campaign',       // campaign|adset|ad
    fields: userFields,       // opcional override
    since, until              // si defines since/until, ignoramos date_preset
  } = opts;

  // Carga documento (con o sin helper del modelo)
  const acc = await MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
    .select('+access_token +token +accessToken +longLivedToken +longlivedToken')
    .lean();

  if (!acc) {
    return { notAuthorized: true, reason: 'NO_METAACCOUNT', byCampaign: [], accountIds: [] };
  }

  const token = pickToken(acc);
  const actId = normAct(account_id || pickDefaultAccountId(acc));

  if (!token || !actId) {
    return {
      notAuthorized: true,
      reason: !token ? 'NO_TOKEN' : 'NO_DEFAULT_ACCOUNT',
      byCampaign: [],
      accountIds: actId ? [actId] : []
    };
  }

  // Validación (best-effort) de scopes
  const scopes = Array.isArray(acc.scopes) ? acc.scopes.map(s => String(s || '').toLowerCase()) : [];
  const hasRead = scopes.includes('ads_read') || scopes.includes('ads_management'); // cualquiera permite insights
  if (!hasRead) {
    return {
      notAuthorized: true,
      reason: 'MISSING_SCOPES(ads_read|ads_management)',
      byCampaign: [],
      accountIds: [actId]
    };
  }

  // Campos de insights
  const baseFields = [
    'date_start', 'date_stop',
    'campaign_id', 'campaign_name', 'objective',
    'spend', 'impressions', 'clicks', 'cpm', 'cpc', 'ctr',
    'actions', 'action_values', 'purchase_roas'
  ];
  const fields = Array.isArray(userFields) && userFields.length ? userFields : baseFields;

  // Helper para construir URL con presets/rangos
  const mkUrl = (preset) => {
    const qp = new URLSearchParams();
    if (since && until) {
      qp.set('time_range', JSON.stringify({ since, until }));
    } else {
      qp.set('date_preset', preset);
    }
    qp.set('level', level);
    qp.set('fields', fields.join(','));
    qp.set('limit', '5000');
    qp.set('access_token', token);
    return `https://graph.facebook.com/${API_VER}/act_${actId}/insights?${qp.toString()}`;
  };

  // 1er intento: preset solicitado (por defecto last_30d)
  let presetTried = since && until ? undefined : date_preset;
  let data = [];
  try {
    const url = mkUrl(presetTried || 'last_30d');
    data = await pageAllInsights(url);
  } catch (e) {
    const code = e?._meta?.code;
    const subcode = e?._meta?.error_subcode;
    const isAuth = code === 190 || subcode === 463 || subcode === 467; // token inválido/expirado
    const reason = isAuth ? 'TOKEN_INVALID_OR_EXPIRED' : (e?.message || 'Meta insights failed');
    return { notAuthorized: true, reason, byCampaign: [], accountIds: [actId] };
  }

  // Fallbacks automáticos si no hay datos (sólo cuando usamos date_preset)
  if (!since && !until && data.length === 0 && presetTried === 'last_30d') {
    try {
      presetTried = 'last_90d';
      data = await pageAllInsights(mkUrl('last_90d'));
    } catch {}
  }
  if (!since && !until && data.length === 0 && presetTried === 'last_90d') {
    try {
      presetTried = 'last_180d';
      data = await pageAllInsights(mkUrl('last_180d'));
    } catch {}
  }

  const byCampaign = [];
  for (const x of data) {
    const roas = Array.isArray(x.purchase_roas) && x.purchase_roas[0]?.value ? Number(x.purchase_roas[0].value) : null;
    const { purchases, purchase_value } = extractPurchaseMetrics(x);

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
    });
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

  const first = data[0] || {};
  return {
    notAuthorized: false,
    timeRange: { from: first.date_start || null, to: first.date_stop || null },
    kpis: {
      impressions: G.impr,
      clicks: G.clk,
      cost: G.cost,
      cpc: safeDiv(G.cost, G.clk),
    },
    byCampaign,
    accountIds: [actId],
  };
}

module.exports = { collectMeta };
