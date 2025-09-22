'use strict';

async function collectShopify(userId) {
  // Usa tus rutas/servicios actuales de shopify para traer topProducts y KPIs
  return {
    topProducts: [/* {title, revenue, units} */],
    kpis: {/* aov, repeatRate, refundRate,... */}
  };
}
module.exports = { collectShopify };
