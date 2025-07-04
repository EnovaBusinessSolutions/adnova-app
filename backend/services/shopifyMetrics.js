// backend/services/shopifyMetrics.js
const axios = require('axios');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';


const shopifyGraphQL = (shop, token) => axios.create({
  baseURL: `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
  headers: {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  },
});

module.exports.getSalesMetrics = async (shop, token) => {
  
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const query = `
    {
      orders(first: 100, query: "created_at:>=${since}") {
        edges {
          node {
            totalPriceSet { shopMoney { amount } }
            createdAt
          }
        }
      }
    }
  `;

  const { data } = await shopifyGraphQL(shop, token).post('', { query });

  const orders = (data.data.orders.edges || []).map(e => e.node);
  const sales = orders.reduce(
    (sum, order) => sum + parseFloat(order.totalPriceSet.shopMoney.amount),
    0
  );
  const aov = orders.length ? sales / orders.length : 0;

  return {
    salesLast30: sales,
    ordersLast30: orders.length,
    avgOrderValue: aov,
  };
};
