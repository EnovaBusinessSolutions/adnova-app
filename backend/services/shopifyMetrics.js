// backend/services/shopifyMetrics.js
const axios = require('axios');

const api = (shop, token) => axios.create({
  baseURL: `https://${shop}/admin/api/2024-07`,
  headers: { 'X-Shopify-Access-Token': token }
});

module.exports.getSalesMetrics = async (shop, token) => {
  const since = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const { data } = await api(shop, token)
      .get(`/orders.json`, { params: { status: 'any', created_at_min: since }});

  const orders = data.orders;
  const sales  = orders.reduce((s,o)=>s+parseFloat(o.total_price), 0);
  const aov    = orders.length ? sales / orders.length : 0;

  return { salesLast30: sales, ordersLast30: orders.length, avgOrderValue: aov };
};

// funciones getProductMetrics() y getCustomerMetrics() similares
