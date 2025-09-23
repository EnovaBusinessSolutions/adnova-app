'use strict';

const GoogleAccount = require('../../models/GoogleAccount');
const dayjs = require('dayjs');

async function collectGoogle(userId) {
  // 0) Verifica conexión (ajusta si tu modelo difiere)
  const acc = await GoogleAccount.findOne({ user: userId }).lean();
  if (!acc) throw new Error('GOOGLE_NOT_CONNECTED');

  // 🔁 REEMPLAZA el bloque MOCK por tu integración real (GAQL / servicio interno)
  const today = dayjs().startOf('day');
  const from = today.subtract(30, 'day').format('YYYY-MM-DD');
  const to = today.format('YYYY-MM-DD');

  // --- MOCK coherente — elimina cuando conectes datos reales ---
  const byCampaign = [
    {
      id: 'cmp_1',
      name: 'Search — Brand',
      status: 'ENABLED',
      budget: 25,
      impressions: 120000,
      clicks: 7800,
      cost: 1850.0,
      conversions: 210,
      conv_value: 15600,
    },
    {
      id: 'cmp_2',
      name: 'PMax — Prospecting',
      status: 'ENABLED',
      budget: 40,
      impressions: 220000,
      clicks: 9200,
      cost: 3100.0,
      conversions: 150,
      conv_value: 9750,
    }
  ].map(c => ({
    ...c,
    ctr: c.impressions ? (c.clicks / c.impressions) : 0,
    cpc: c.clicks ? (c.cost / c.clicks) : 0,
    cpa: c.conversions ? (c.cost / c.conversions) : 0,
    roas: c.cost ? (c.conv_value / c.cost) : 0,
    cvr: c.clicks ? (c.conversions / c.clicks) : 0,
  }));

  const totals = byCampaign.reduce((a, c) => {
    a.impressions += c.impressions;
    a.clicks += c.clicks;
    a.cost += c.cost;
    a.conversions += c.conversions;
    a.conv_value += c.conv_value;
    return a;
  }, { impressions: 0, clicks: 0, cost: 0, conversions: 0, conv_value: 0 });

  const kpis = {
    ...totals,
    ctr: totals.impressions ? (totals.clicks / totals.impressions) : 0,
    cpc: totals.clicks ? (totals.cost / totals.clicks) : 0,
    cpa: totals.conversions ? (totals.cost / totals.conversions) : 0,
    roas: totals.cost ? (totals.conv_value / totals.cost) : 0,
    cvr: totals.clicks ? (totals.conversions / totals.clicks) : 0,
  };

  const series = Array.from({ length: 30 }).map((_, i) => {
    const d = dayjs(from).add(i, 'day').format('YYYY-MM-DD');
    // números dummy — sustituye por métricas diarias reales
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
