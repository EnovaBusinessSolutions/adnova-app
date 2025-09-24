'use strict';

const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');

// ========= ENV =========
const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

// ========= Modelo =========
let MetaAccount;
try {
  MetaAccount = require('../../models/MetaAccount');
} catch (_) {
  // Fallback mínimo si no está el modelo real
  const { Schema, model } = mongoose;
  const AdAccountSchema = new Schema({
    id: String, account_id: String, name: String,
    currency: String, configured_status: Schema.Types.Mixed, timezone_name: String
  }, { _id: false });
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
    access_token: { type: String, select: false },
    longlivedToken: { type: String, select: false },
    longLivedToken: { type: String, select: false },
    token: { type: String, select: false },
    ad_accounts: { type: [AdAccountSchema], default: [] },
    adAccounts:  { type: [AdAccountSchema], default: [] },
    defaultAccountId: { type: String },
    scopes: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now },
  }, { collection: 'metaaccounts' });
  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}

// ========= Utils =========
const sinceDays = (n) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0,10);
};
const todayISO = () => new Date().toISOString().slice(0,10);

const micros = (n) => Number(n || 0);
const num    = (v) => (v == null ? 0 : Number(v) || 0);

const safeDiv = (a, b) => {
  const A = num(a), B = num(b);
  return B ? (A / B) : 0;
};

const uniq = (arr) => Array.from(new Set(Array.isArray(arr) ? arr : []));

const actId = (s='') => String(s).replace(/^act_/, '').trim();
const toAct = (s='') => {
  const id = actId(s);
  return id ? `act_${id}` : '';
};

function appSecretProof(token) {
  if (!APP_SECRET) return null;
  return crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex');
}

// ========= Graph helpers =========

async function fetchAdAccountsFromGraph(accessToken) {
  // Por si el doc no tiene ad_accounts, hacemos fallback
  const params = {
    access_token: accessToken,
    fields: 'account_id,name,currency,configured_status,timezone_name',
    limit: 100
  };
  const proof = appSecretProof(accessToken);
  if (proof) params.appsecret_proof = proof;

  const out = [];
  let url = `${FB_GRAPH}/me/adaccounts`;
  for (let guard=0; guard<5 && url; guard++) {
    const { data } = await axios.get(url, { params, timeout: 20000 });
    const list = Array.isArray(data?.data) ? data.data : [];
    for (const a of list) {
      out.push({
        id: toAct(a.account_id),
        account_id: actId(a.account_id),
        name: a.name || null,
        currency: a.currency || null,
        configured_status: a.configured_status,
        timezone_name: a.timezone_name || null,
      });
    }
    url = data?.paging?.next || null;
  }
  return out;
}

async function fetchCampaignInsights({ accessToken, accountId, since, until }) {
  // Insights: nivel campaña, últimos 30 días
  // docs: https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/
  const params = {
    access_token: accessToken,
    level: 'campaign',
    time_range: JSON.stringify({ since, until }),
    fields: [
      'campaign_id', 'campaign_name',
      'objective',
      'impressions', 'clicks', 'spend', 'cpm', 'ctr', 'cpc',
      'actions', 'action_values'
    ].join(','),
    limit: 200,
    // Filtramos solo campañas con delivery relevante (opcional):
    // 'filtering': JSON.stringify([{field:'campaign.delivery_status',operator:'IN',value:['active','limited']}])
  };
  const proof = appSecretProof(accessToken);
  if (proof) params.appsecret_proof = proof;

  const out = [];
  let url = `${FB_GRAPH}/${toAct(accountId)}/insights`;
  for (let guard=0; guard<10 && url; guard++) {
    const { data } = await axios.get(url, { params, timeout: 45000 });
    if (Array.isArray(data?.data)) out.push(...data.data);
    url = data?.paging?.next || null;
  }
  return out;
}

function pickAction(actions, key) {
  // Busca 'purchase' o 'offsite_conversion.fb_pixel_purchase' u otras variantes
  const arr = Array.isArray(actions) ? actions : [];
  const match = arr.find(a =>
    (a?.action_type || '').toLowerCase() === key
  );
  return num(match?.value);
}

function sumAction(actions, keys) {
  const arr = Array.isArray(actions) ? actions : [];
  let s = 0;
  for (const a of arr) {
    const t = (a?.action_type || '').toLowerCase();
    if (keys.includes(t)) s += num(a.value);
  }
  return s;
}

function purchaseValue(actionValues) {
  // busca action_values purchase (puede venir como total_value en algunas variantes)
  const arr = Array.isArray(actionValues) ? actionValues : [];
  const match = arr.find(a =>
    (a?.action_type || '').toLowerCase().includes('purchase')
  );
  return num(match?.value);
}

// ========= Snapshot principal =========
async function fetchMetaSnapshot(userId) {
  // 1) Cargar credenciales del usuario
  const doc = await MetaAccount.findOne({
    $or: [{ userId: userId }, { user: userId }]
  })
    .select('+access_token +longLivedToken +longlivedToken +token ad_accounts adAccounts defaultAccountId scopes')
    .lean();

  const token =
    doc?.longLivedToken ||
    doc?.longlivedToken ||
    doc?.access_token ||
    doc?.token ||
    null;

  if (!token) {
    return {
      notAuthorized: true,
      reason: 'NO_TOKEN',
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions: 0, clicks: 0, spend: 0, conversions: 0 },
      byCampaign: [],
      series: [],
      targets: {},
    };
  }

  // 2) Determinar cuentas a consultar
  let accounts = Array.isArray(doc?.ad_accounts) && doc.ad_accounts.length
    ? doc.ad_accounts
    : (Array.isArray(doc?.adAccounts) ? doc.adAccounts : []);

  if (!accounts.length) {
    // Fallback: pedimos a Graph
    try {
      accounts = await fetchAdAccountsFromGraph(token);
    } catch (e) {
      return {
        notAuthorized: true,
        reason: 'NO_ACCOUNTS',
        currency: null,
        timeRange: { from: null, to: null },
        kpis: { impressions: 0, clicks: 0, spend: 0, conversions: 0 },
        byCampaign: [],
        series: [],
        targets: {},
        hint: e?.response?.data || e?.message
      };
    }
  }

  const defaultAccountId =
    doc?.defaultAccountId ||
    accounts?.[0]?.account_id ||
    accounts?.[0]?.id?.replace(/^act_/, '') ||
    null;

  // Selección: priorizamos default + 1-2 extras para no pasarnos
  const ids = uniq([
    defaultAccountId,
    ...accounts.map(a => a.account_id || actId(a.id))
  ]).filter(Boolean).slice(0, 3);

  const since = sinceDays(30);
  const until = todayISO();

  // 3) Agregación
  let G_impr = 0, G_clicks = 0, G_spend = 0, G_conv = 0, G_value = 0;
  const byCampaign = [];
  let currency = null;

  for (const accountId of ids) {
    let rows = [];
    try {
      rows = await fetchCampaignInsights({ accessToken: token, accountId, since, until });
    } catch (e) {
      // Si una cuenta falla, continúa con las otras
      continue;
    }

    for (const r of rows) {
      // Algunas cuentas devuelven currency por adaccount, pero insights no siempre lo incluye.
      // Nos quedamos con la primera currency válida de la lista original:
      if (!currency) {
        const acc = accounts.find(a => (a.account_id || actId(a.id)) === accountId);
        currency = acc?.currency || currency || 'USD';
      }

      const impressions = num(r.impressions);
      const clicks      = num(r.clicks);
      const spend       = num(r.spend);
      // conversiones: sumamos varias variantes de 'purchase'
      const conversions = sumAction(r.actions, [
        'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'
      ]);
      const convValue   = purchaseValue(r.action_values);

      G_impr  += impressions;
      G_clicks+= clicks;
      G_spend += spend;
      G_conv  += conversions;
      G_value += convValue;

      const cpc  = safeDiv(spend, clicks);
      const cpa  = safeDiv(spend, conversions);
      const roas = safeDiv(convValue, spend);

      byCampaign.push({
        account_id: accountId,
        id: r.campaign_id,
        name: r.campaign_name || 'Sin nombre',
        objective: r.objective || null,
        kpis: {
          impressions, clicks, spend,
          conversions, conv_value: convValue,
          cpc, cpa, roas,
          ctr: num(r.ctr), cpm: num(r.cpm)
        },
        period: { since, until },
      });
    }
  }

  // 4) Resultado
  return {
    notAuthorized: false,
    currency: currency || 'USD',
    timeRange: { from: since, to: until },
    kpis: {
      impressions: G_impr,
      clicks: G_clicks,
      spend: G_spend,
      conversions: G_conv,
      convValue: G_value,
      cpc: safeDiv(G_spend, G_clicks),
      cpa: safeDiv(G_spend, G_conv),
      roas: safeDiv(G_value, G_spend),
    },
    byCampaign,
    series: [], // (si después quieres por día/serie, se puede añadir con breakdown=...),
    targets: { cpaHigh: 15 }, // ejemplo
  };
}

async function collectMeta(userId) {
  try {
    return await fetchMetaSnapshot(userId);
  } catch (e) {
    return {
      notAuthorized: true,
      reason: 'COLLECTOR_ERROR',
      error: e?.response?.data || e?.message || String(e),
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions: 0, clicks: 0, spend: 0, conversions: 0 },
      byCampaign: [],
      series: [],
      targets: {},
    };
  }
}

module.exports = { collectMeta };
