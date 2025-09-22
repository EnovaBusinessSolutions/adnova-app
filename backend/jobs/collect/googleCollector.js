'use strict';
const GoogleAccount = require('../../models/GoogleAccount');
const axios = require('axios');

async function collectGoogle(userId) {
  const ga = await GoogleAccount.findOne({ $or:[{user:userId},{userId}] }).lean();
  const customerId = (ga?.defaultCustomerId || '').replace(/-/g,'');
  if (!customerId) throw new Error('NO_CUSTOMER_ID');

  // KPIs 30d
  const { data:insights } = await axios.get(
    `http://localhost:${process.env.PORT||3000}/api/google/ads/insights?customer_id=${customerId}&objective=ventas&date_preset=last_30d`,
    { headers: { Cookie: '' } } // si necesitas sesión interna, mejor llama a funciones internas
  );

  // TODO (opcional): campañas y conversiones para enriquecer el análisis
  // ... si ya tienes helpers GAQL, úsalos aquí y agrega a snapshot

  return {
    kpis: insights?.kpis || {},
    series: insights?.series || [],
    currency: insights?.currency || 'USD',
    timeZone: insights?.time_zone || 'UTC',
    // byCampaign: [...],
    // conversionsSetup: [...]
  };
}
module.exports = { collectGoogle };
