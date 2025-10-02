'use strict';
/**
 * Collector de Meta Ads: trae campañas últimos 30 días a nivel campaign.
 * Requiere: MetaAccount con longlivedToken|access_token y defaultAccountId.
 */

const fetch = require('node-fetch');
const mongoose = require('mongoose');

let MetaAccount;
try { MetaAccount = require('../../models/MetaAccount'); }
catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    access_token: String,
    longlivedToken: String,
    defaultAccountId: String, // ej. "1125719348244164"
    ad_accounts: { type: Array, default: [] },
    scopes: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now },
  }, { collection: 'metaaccounts' });
  schema.pre('save', function(n){ this.updatedAt = new Date(); n(); });
  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}

const microsafe = (v) => Number(v||0);
const toNum = (v) => Number(v || 0);
const safeDiv = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);

async function collectMeta(userId, { account_id, date_preset = 'last_30d', level = 'campaign' } = {}) {
  const acc = await MetaAccount.findOne({ user: userId }).lean();
  if (!acc) {
    return { notAuthorized: true, reason: 'NO_METAACCOUNT', byCampaign: [], accountIds: [] };
  }
  const token = acc.longlivedToken || acc.access_token;
  const actId = account_id || acc.defaultAccountId;
  if (!token || !actId) {
    return { notAuthorized: true, reason: !token ? 'NO_TOKEN' : 'NO_DEFAULT_ACCOUNT', byCampaign: [], accountIds: [] };
  }

  // Campos útiles
  const fields = [
    'date_start','date_stop',
    'campaign_id','campaign_name','objective',
    'spend','impressions','clicks','cpm','cpc','ctr','actions','purchase_roas'
  ];
  const url = `https://graph.facebook.com/v19.0/act_${actId}/insights?date_preset=${date_preset}&level=${level}&fields=${fields.join(',')}&limit=5000&access_token=${encodeURIComponent(token)}`;

  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) {
    const msg = j?.error?.message || 'Meta insights failed';
    return { notAuthorized: true, reason: msg, byCampaign: [], accountIds: [actId] };
  }

  const data = Array.isArray(j?.data) ? j.data : [];
  const byCampaign = [];
  for (const x of data) {
    const roas = Array.isArray(x.purchase_roas) && x.purchase_roas[0]?.value ? Number(x.purchase_roas[0].value) : null;
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
        roas: roas ?? safeDiv(0,0),
      },
      period: { since: x.date_start, until: x.date_stop },
    });
  }

  // KPIs globales básicos
  const G = byCampaign.reduce((a, c) => {
    a.impr += c.kpis.impressions; a.clk+=c.kpis.clicks; a.cost+=c.kpis.spend;
    return a;
  }, { impr:0, clk:0, cost:0 });

  return {
    notAuthorized: false,
    timeRange: { from: data[0]?.date_start || null, to: data[0]?.date_stop || null },
    kpis: {
      impressions: G.impr, clicks: G.clk, cost: G.cost,
      cpc: safeDiv(G.cost, G.clk),
    },
    byCampaign,
    accountIds: [actId]
  };
}

module.exports = { collectMeta };
