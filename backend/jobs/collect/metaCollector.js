'use strict';


const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

/* =====================  Modelo  ===================== */
let MetaAccount;
try {
  MetaAccount = require('../../models/MetaAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId:{ type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      access_token:   { type: String, select: false },
      longlivedToken: { type: String, select: false },
      longLivedToken: { type: String, select: false },
      ad_accounts:    { type: Array, default: [] },
      adAccounts:     { type: Array, default: [] },
      defaultAccountId: String,
      scopes: { type: [String], default: [] },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'metaaccounts' }
  );
  schema.pre('save', function(n){ this.updatedAt=new Date(); n(); });
  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}

/* =====================  Utils  ===================== */
const makeProof = (token) => crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex');
const normActId = (s='') => s.toString().replace(/^act_/, '').trim();
const toActId   = (s='') => (s ? `act_${normActId(s)}` : '');
const todayISO   = () => new Date().toISOString().slice(0,10);
const daysAgoISO = (n) => { const d=new Date(); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); };
const safeDiv = (n, d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);

/**
 * Convierte arrays de actions/action_values en conversions y conv_value.
 */
function extractConversions(actions = [], actionValues = []) {
  const act = Object.fromEntries(actions.map(a => [a.action_type, Number(a.value||0)]));
  const val = Object.fromEntries(actionValues.map(a => [a.action_type, Number(a.value||0)]));

  // Los tipos más comunes para compras
  const purchaseKeys = [
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'onsite_conversion.purchase',
    'offsite_conversion',
  ];

  let conversions = 0;
  let convValue   = 0;
  for (const k of purchaseKeys) {
    conversions += Number(act[k] || 0);
    convValue   += Number(val[k] || 0);
  }
  return { conversions, convValue };
}

/* =====================  REST calls  ===================== */
async function listCampaigns({ token, accountId }) {
  // /act_{id}/campaigns
  const { data } = await axios.get(`${FB_GRAPH}/${toActId(accountId)}/campaigns`, {
    params: {
      fields: 'id,name,status,effective_status',
      limit: 200,
      access_token: token,
      appsecret_proof: makeProof(token),
    },
    timeout: 25000,
  });
  return Array.isArray(data?.data) ? data.data : [];
}

async function campaignsInsights({ token, accountId, since, until }) {
  // Insights a nivel campaña por día
  // https://developers.facebook.com/docs/marketing-api/reference/ads-insights
  const { data } = await axios.get(`${FB_GRAPH}/${toActId(accountId)}/insights`, {
    params: {
      level: 'campaign',
      time_range: JSON.stringify({ since, until }),
      time_increment: 1,
      fields: [
        'date_start',
        'date_stop',
        'campaign_id',
        'campaign_name',
        'impressions',
        'clicks',
        'spend',
        'actions',
        'action_values',
      ].join(','),
      limit: 1000,
      access_token: token,
      appsecret_proof: makeProof(token),
    },
    timeout: 45000,
  });
  return Array.isArray(data?.data) ? data.data : [];
}

/* =====================  Collector  ===================== */
async function collectMeta(userId) {
  // 1) doc del usuario
  const ma = await MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
    .select('+access_token +longlivedToken +longLivedToken ad_accounts adAccounts defaultAccountId scopes')
    .lean();

  if (!ma) {
    return {
      notAuthorized: true,
      reason: 'NO_META_ACCOUNT',
      currency: 'USD',
      timeRange: { from: null, to: null },
      kpis: { impressions:0, clicks:0, spend:0, conversions:0 },
      byCampaign: [],
      pixelHealth: { errors: [], warnings: [] },
      targets: {},
    };
  }

  // 2) validar scope ads_read
  const scopes = Array.isArray(ma.scopes) ? ma.scopes : [];
  const hasAdsRead = scopes.includes('ads_read') || scopes.includes('ads_management');
  if (!hasAdsRead) {
    return {
      notAuthorized: true,
      reason: 'MISSING_SCOPE_ADS_READ',
      currency: 'USD',
      timeRange: { from: null, to: null },
      kpis: { impressions:0, clicks:0, spend:0, conversions:0 },
      byCampaign: [],
      pixelHealth: { errors: [], warnings: [] },
      hint: 'Re-conecta Meta y acepta ads_read/ads_management.',
    };
  }

  const token =
    ma.longLivedToken || ma.longlivedToken || ma.access_token || null;
  if (!token) {
    return {
      notAuthorized: true,
      reason: 'NO_ACCESS_TOKEN',
      currency: 'USD',
      timeRange: { from: null, to: null },
      kpis: { impressions:0, clicks:0, spend:0, conversions:0 },
      byCampaign: [],
      pixelHealth: { errors: [], warnings: [] },
    };
  }

  // 3) cuentas a consultar
  const accounts = (ma.ad_accounts && ma.ad_accounts.length ? ma.ad_accounts : ma.adAccounts) || [];
  let accountId = ma.defaultAccountId || accounts?.[0]?.account_id || accounts?.[0]?.id || null;
  accountId = accountId ? normActId(accountId) : null;

  if (!accountId) {
    return {
      notAuthorized: false,
      reason: 'NO_AD_ACCOUNTS',
      currency: 'USD',
      timeRange: { from: null, to: null },
      kpis: { impressions:0, clicks:0, spend:0, conversions:0 },
      byCampaign: [],
      pixelHealth: { errors: [], warnings: [] },
    };
  }

  const since = daysAgoISO(30);
  const until = todayISO();

  // 4) leer campañas y sus insights
  let campaigns = [];
  try {
    campaigns = await listCampaigns({ token, accountId });
  } catch (e) {
    if (e?.response?.status === 400 || e?.response?.status === 401 || e?.response?.status === 403) {
      return {
        notAuthorized: true,
        reason: 'DENIED_OR_EXPIRED',
        currency: 'USD',
        timeRange: { from: null, to: null },
        kpis: { impressions:0, clicks:0, spend:0, conversions:0 },
        byCampaign: [],
        pixelHealth: { errors: [], warnings: [] },
      };
    }
    // otro error no bloquea
  }

  let rows = [];
  try {
    rows = await campaignsInsights({ token, accountId, since, until });
  } catch (e) {
    // si insights falla, seguimos con snapshot vacío pero autorizado=false
    return {
      notAuthorized: true,
      reason: 'INSIGHTS_FAILED',
      currency: 'USD',
      timeRange: { from: since, to: until },
      kpis: { impressions:0, clicks:0, spend:0, conversions:0 },
      byCampaign: [],
      pixelHealth: { errors: [], warnings: [] },
    };
  }

  // 5) Agregación
  let G_impr=0, G_clicks=0, G_spend=0, G_conv=0, G_value=0;
  const byCampAgg = new Map(); // id → {name, impr, clicks, spend, conv, value}
  const seriesMap = new Map();  // date → agg

  for (const r of rows.slice(0, 5000)) {
    const date  = r.date_start; // date_stop es igual con time_increment=1
    const id    = r.campaign_id;
    const name  = r.campaign_name || 'Untitled';

    const impressions = Number(r.impressions || 0);
    const clicks      = Number(r.clicks || 0);
    const spend       = Number(r.spend || 0);

    const { conversions, convValue } = extractConversions(r.actions, r.action_values);

    G_impr += impressions; G_clicks += clicks; G_spend += spend; G_conv += conversions; G_value += convValue;

    if (date) {
      const cur = seriesMap.get(date) || { impressions:0, clicks:0, spend:0, conversions:0, conv_value:0 };
      cur.impressions += impressions;
      cur.clicks      += clicks;
      cur.spend       += spend;
      cur.conversions += conversions;
      cur.conv_value  += convValue;
      seriesMap.set(date, cur);
    }

    if (id) {
      const agg = byCampAgg.get(id) || { name, impressions:0, clicks:0, spend:0, conversions:0, convValue:0 };
      agg.impressions += impressions;
      agg.clicks      += clicks;
      agg.spend       += spend;
      agg.conversions += conversions;
      agg.convValue   += convValue;
      byCampAgg.set(id, agg);
    }
  }

  const byCampaign = [];
  for (const [cid, v] of byCampAgg.entries()) {
    byCampaign.push({
      account_id: accountId,
      id: cid,
      name: v.name,
      kpis: {
        impressions: v.impressions,
        clicks: v.clicks,
        spend: v.spend,
        conversions: v.conversions,
        conv_value: v.convValue,
        cpc:  safeDiv(v.spend, v.clicks),
        cpa:  safeDiv(v.spend, v.conversions),
        roas: safeDiv(v.convValue, v.spend),
      },
      period: { since, until },
    });
  }

  const series = Array.from(seriesMap.keys()).sort().map(d => ({ date: d, ...seriesMap.get(d) }));

  return {
    notAuthorized: false,
    currency: 'USD',
    timeRange: { from: since, to: until },
    kpis: {
      impressions: G_impr,
      clicks: G_clicks,
      spend: G_spend,
      conversions: G_conv,
      convValue: G_value,
      cpc:  safeDiv(G_spend, G_clicks),
      cpa:  safeDiv(G_spend, G_conv),
      roas: safeDiv(G_value, G_spend),
    },
    byCampaign,
    series,
    targets: { cpaHigh: 15 }, // opcional para reglas de la IA
    pixelHealth: { errors: [], warnings: [] }, // puedes poblar esto con Event Diagnostics si lo deseas
  };
}

module.exports = { collectMeta };
