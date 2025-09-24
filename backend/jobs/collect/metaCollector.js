'use strict';

const axios    = require('axios');
const mongoose = require('mongoose');

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;

/* --------- Modelo resiliente --------- */
let MetaAccount;
try {
  MetaAccount = require('../../models/MetaAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const ad = new Schema({
    id: String,
    account_id: String,
    name: String,
    currency: String,
    configured_status: Schema.Types.Mixed,
    timezone_name: String,
  }, { _id:false });
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId:{ type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
    access_token:   { type:String, select:false },
    longlivedToken: { type:String, select:false },
    longLivedToken: { type:String, select:false },
    ad_accounts: { type:[ad], default:[] },
    adAccounts:  { type:[ad], default:[] },
    defaultAccountId: String,
    scopes: { type:[String], default:[] },
    updatedAt: { type:Date, default:Date.now },
  }, { collection:'metaaccounts' });
  schema.pre('save', function(n){ this.updatedAt = new Date(); n(); });
  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}

/* --------- Helpers --------- */
const normAct = s => String(s||'').replace(/^act_/, '').trim();
const toAct   = s => (s ? `act_${normAct(s)}` : '');
const safeDiv = (n,d)=> (Number(d||0) ? Number(n||0)/Number(d||0) : 0);

/* --------- API helpers --------- */
function pickToken(doc){
  return doc?.longLivedToken || doc?.longlivedToken || doc?.access_token || null;
}

async function graphGET(path, params={}, timeout=20000) {
  const { data } = await axios.get(`${FB_GRAPH}/${path}`, { params, timeout });
  return data;
}

/* --------- Colector principal --------- */
async function collectMeta(userId) {
  // 1) cargar doc + token + cuentas
  const doc = await MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
    .select('+access_token +longlivedToken +longLivedToken ad_accounts adAccounts defaultAccountId scopes')
    .lean();

  if (!doc) {
    return { notAuthorized:true, reason:'NO_METAACCOUNT', currency:null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], pixelHealth:{errors:[],warnings:[]} };
  }
  const token = pickToken(doc);
  if (!token) {
    return { notAuthorized:true, reason:'NO_TOKEN', currency:null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], pixelHealth:{errors:[],warnings:[]} };
  }

  const scopes = new Set((doc.scopes || []).map(String));
  if (!(scopes.has('ads_read') || scopes.has('ads_management'))) {
    return { notAuthorized:true, reason:'MISSING_META_SCOPES', currency:null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], pixelHealth:{errors:[],warnings:[]} };
  }

  // 2) seleccionar ad account
  const adAccounts = doc.adAccounts?.length ? doc.adAccounts : doc.ad_accounts || [];
  const chosenId = normAct(doc.defaultAccountId || adAccounts?.[0]?.account_id || '');
  if (!chosenId) {
    return { notAuthorized:false, reason:'NO_ADACCOUNT', currency:null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], pixelHealth:{errors:[],warnings:[]} };
  }

  const actId = toAct(chosenId);
  const until = Math.floor(Date.now()/1000);
  const since = until - 29*24*3600; // 30 días

  // 3) insights de campaña últimos 30 días
  let rows = [];
  let currency = 'USD';
  try {
    const params = {
      access_token: token,
      time_range: JSON.stringify({ since: new Date(since*1000).toISOString().slice(0,10), until: new Date(until*1000).toISOString().slice(0,10) }),
      level: 'campaign',
      fields: [
        'campaign_id','campaign_name',
        'impressions','clicks','spend',
        'actions','action_values','account_currency'
      ].join(','),
      limit: 500,
    };
    const data = await graphGET(`${actId}/insights`, params);
    rows = Array.isArray(data?.data) ? data.data : [];
    if (rows[0]?.account_currency) currency = rows[0].account_currency;
  } catch (e) {
    const code = e?.response?.status || 0;
    const msg  = e?.response?.data || e.message;
    if (code === 400 || code === 403) {
      return { notAuthorized:true, reason:'INSIGHTS_DENIED', detail: msg, currency:null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], pixelHealth:{errors:[],warnings:[]} };
    }
    // otros errores: sigue, snapshot vacío
  }

  // 4) consolidar
  let G = { impr:0, clk:0, spend:0, conv:0, value:0 };
  const byCampaign = [];

  function findActionSum(list, key) {
    let total = 0;
    for (const a of (Array.isArray(list) ? list : [])) {
      if ((a?.action_type || a?.action_category) === key) total += Number(a?.value || 0);
    }
    return total;
  }

  for (const r of rows) {
    const impressions = Number(r.impressions || 0);
    const clicks      = Number(r.clicks || 0);
    const spend       = Number(r.spend || 0);
    // intenta matchear compras; ajusta si usas otro pixel event
    const purchases   = findActionSum(r.actions, 'purchase');
    const value       = findActionSum(r.action_values, 'purchase');

    G.impr += impressions; G.clk += clicks; G.spend += spend; G.conv += purchases; G.value += value;

    byCampaign.push({
      account_id: chosenId,
      id: r.campaign_id,
      name: r.campaign_name || 'Untitled',
      kpis: {
        impressions, clicks, spend,
        conversions: purchases,
        conv_value: value,
        cpc:  safeDiv(spend, clicks),
        cpa:  safeDiv(spend, purchases),
        roas: safeDiv(value, spend),
      },
      period: {
        since: new Date(since*1000).toISOString().slice(0,10),
        until: new Date(until*1000).toISOString().slice(0,10),
      }
    });
  }

  // 5) health básico de pixel (opcional)
  const pixelHealth = { errors: [], warnings: [] };
  try {
    const diags = await graphGET(`${actId}/adspixels`, { access_token: token, fields:'id,name' });
    if (!Array.isArray(diags?.data) || diags.data.length === 0) {
      pixelHealth.warnings.push('No se encontró pixel asociado a la cuenta.');
    }
  } catch { /* ignore */ }

  return {
    notAuthorized: false,
    currency,
    timeRange: {
      from: new Date(since*1000).toISOString().slice(0,10),
      to:   new Date(until*1000).toISOString().slice(0,10),
    },
    kpis: {
      impressions: G.impr,
      clicks: G.clk,
      spend: G.spend,
      conversions: G.conv,
      conv_value: G.value,
      cpc:  safeDiv(G.spend, G.clk),
      cpa:  safeDiv(G.spend, G.conv),
      roas: safeDiv(G.value,  G.spend),
    },
    byCampaign,
    pixelHealth,
    targets: { cprHigh: 5 },
  };
}

module.exports = { collectMeta };
