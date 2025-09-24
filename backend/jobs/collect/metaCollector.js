'use strict';

// Reemplaza estos helpers con tus llamadas reales al Graph API
async function fetchMetaSnapshot(userId) {
  // TODO: Integra tu pipeline real. Este es un mock consistente.

  const byCampaign = []; 

  const kpis = {
    impressions: byCampaign.reduce((a, c) => a + Number(c?.kpis?.impressions || 0), 0),
    clicks: byCampaign.reduce((a, c) => a + Number(c?.kpis?.clicks || 0), 0),
    spend: byCampaign.reduce((a, c) => a + Number(c?.kpis?.spend || 0), 0),
    conversions: byCampaign.reduce((a, c) => a + Number(c?.kpis?.conversions || 0), 0),
  };

  const pixelHealth = {
    errors: [],   // llena con tu Event Diagnostics si lo tienes
    warnings: [],
  };

  return {
    currency: 'USD',
    timeRange: { from: null, to: null },
    kpis,
    byCampaign,
    pixelHealth,
    targets: { cprHigh: 5 }, // opcional
  };
}

async function collectMeta(userId) {
  const snapshot = await fetchMetaSnapshot(userId);
  return snapshot;
}

module.exports = { collectMeta };
