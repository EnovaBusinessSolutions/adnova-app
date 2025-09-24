'use strict';

// Reemplaza estos helpers con tus llamadas reales a Google Ads
async function fetchGoogleSnapshot(userId) {
 
  const series = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    conv_value: 0,
  }));

  // Ejemplo byCampaign vacío si no hay campañas activas (ajusta a tu realidad)
  const byCampaign = []; 

  const kpis = {
    impressions: series.reduce((a, d) => a + d.impressions, 0),
    clicks: series.reduce((a, d) => a + d.clicks, 0),
    cost: series.reduce((a, d) => a + d.cost, 0),
    conversions: series.reduce((a, d) => a + d.conversions, 0),
    convValue: series.reduce((a, d) => a + d.conv_value, 0),
  };

  return {
    currency: 'USD',
    timeRange: { from: series[0]?.date, to: series.at(-1)?.date },
    kpis,
    byCampaign,
    series,
    targets: { cpaHigh: 15 }, // opcional
  };
}

async function collectGoogle(userId) {
  const snapshot = await fetchGoogleSnapshot(userId);
  return snapshot;
}

module.exports = { collectGoogle };
