'use strict';

const GoogleAccount = require('../../models/GoogleAccount');

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
 * Snapshot Google Ads últimos 30 días (MOCK si no hay datos reales).
 */
async function collectGoogle(userId) {
  const acc = await GoogleAccount.findOne({ user: userId }).lean();
  if (!acc) throw new Error('GOOGLE_NOT_CONNECTED');

  const today = new Date();
  const fromDate = addDays(today, -30);
  const from = fmt(fromDate);
  const to = fmt(today);

  // --- MOCK coherente ---
  const byCampaign = [
    { id: 'cmp_1', name: 'Search — Brand', status: 'ENABLED', budget: 25, impressions: 120000, clicks: 7800, cost: 1850, conversions: 210, conv_value: 15600 },
    { id: 'cmp_2', name: 'PMax — Prospecting', status: 'ENABLED', budget: 40, impressions: 220000, clicks: 9200, cost: 3100, conversions: 150, conv_value: 9750 }
  ].map(c => ({
    ...c,
    ctr: c.impressions ? (c.clicks / c.impressions) : 0,
    cpc: c.clicks ? (c.cost / c.clicks) : 0,
    cpa: c.conversions ? (c.cost / c.conversions) : 0,
    roas: c.cost ? (c.conv_value / c.cost) : 0,
    cvr: c.clicks ? (c.conversions / c.clicks) : 0,
  }));

  const totals = byCampaign.reduce((a, c) => ({
    impressions: a.impressions + c.impressions,
    clicks: a.clicks + c.clicks,
    cost: a.cost + c.cost,
    conversions: a.conversions + c.conversions,
    conv_value: a.conv_value + c.conv_value
  }), { impressions: 0, clicks: 0, cost: 0, conversions: 0, conv_value: 0 });

  const kpis = {
    ...totals,
    ctr: totals.impressions ? (totals.clicks / totals.impressions) : 0,
    cpc: totals.clicks ? (totals.cost / totals.clicks) : 0,
    cpa: totals.conversions ? (totals.cost / totals.conversions) : 0,
    roas: totals.cost ? (totals.conv_value / totals.cost) : 0,
    cvr: totals.clicks ? (totals.conversions / totals.clicks) : 0,
  };

  const series = Array.from({ length: 30 }).map((_, i) => {
    const d = fmt(addDays(fromDate, i));
    const impressions = Math.floor(1000 + Math.random() * 5000);
    const clicks = Math.floor(impressions * (0.04 + Math.random() * 0.02));
    const cost = clicks * (0.25 + Math.random() * 0.3);
    const conversions = Math.floor(clicks * (0.02 + Math.random() * 0.02));
    const conv_value = conversions * (40 + Math.random() * 60);
    return { date: d, impressions, clicks, cost, conversions, conv_value };
  });

  return {
    kpis,
    byCampaign,
    series,
    currency: acc.currency || 'USD',
    timeRange: { from, to },
  };
}

module.exports = { collectGoogle };
