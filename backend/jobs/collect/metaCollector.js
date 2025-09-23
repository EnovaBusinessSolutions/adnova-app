'use strict';

const MetaAccount = require('../../models/MetaAccount');

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Snapshot Meta Ads últimos 30 días (MOCK si no hay datos reales).
 */
async function collectMeta(userId) {
  const acc = await MetaAccount.findOne({ user: userId }).lean();
  if (!acc) throw new Error('META_NOT_CONNECTED');

  const today = new Date();
  const fromDate = addDays(today, -30);
  const from = fmt(fromDate);
  const to = fmt(today);

  // --- MOCK coherente ---
  const byCampaign = [
    { id: 'mcmp_1', name: 'Sales — Broad Advantage+', objective: 'SALES', status: 'ACTIVE', impressions: 180000, clicks: 6000, spend: 2200, purchases: 130, purchase_value: 9100 },
    { id: 'mcmp_2', name: 'Retargeting — 30d',        objective: 'SALES', status: 'ACTIVE', impressions:  90000, clicks: 4200, spend:  950, purchases: 170, purchase_value: 11900 }
  ].map(c => ({
    ...c,
    ctr: c.impressions ? (c.clicks / c.impressions) : 0,
    cpc: c.clicks ? (c.spend / c.clicks) : 0,
    cpa: c.purchases ? (c.spend / c.purchases) : 0,
    roas: c.spend ? (c.purchase_value / c.spend) : 0,
    cvr: c.clicks ? (c.purchases / c.clicks) : 0,
  }));

  const totals = byCampaign.reduce((a, c) => ({
    impressions: a.impressions + c.impressions,
    clicks: a.clicks + c.clicks,
    spend: a.spend + c.spend,
    purchases: a.purchases + c.purchases,
    purchase_value: a.purchase_value + c.purchase_value
  }), { impressions: 0, clicks: 0, spend: 0, purchases: 0, purchase_value: 0 });

  const kpis = {
    impressions: totals.impressions,
    clicks: totals.clicks,
    cost: totals.spend,
    conversions: totals.purchases,
    conv_value: totals.purchase_value,
    ctr: totals.impressions ? (totals.clicks / totals.impressions) : 0,
    cpc: totals.clicks ? (totals.spend / totals.clicks) : 0,
    cpa: totals.purchases ? (totals.spend / totals.purchases) : 0,
    roas: totals.spend ? (totals.purchase_value / totals.spend) : 0,
    cvr: totals.clicks ? (totals.purchases / totals.clicks) : 0,
  };

  const pixelHealth = {
    eventsConfigured: Boolean(acc.pixelId),
    warnings: 0,
    errors: 0,
  };

  return {
    kpis,
    byCampaign,
    pixelHealth,
    timeRange: { from, to },
  };
}

module.exports = { collectMeta };
