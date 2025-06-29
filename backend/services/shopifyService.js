// backend/services/shopifyService.js
const axios = require('axios');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04';

function shopifyApiUrl(shop, endpoint) {
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
}

// GET genérico a la API de Shopify
async function shopifyGet(shop, accessToken, endpoint) {
  const url = shopifyApiUrl(shop, endpoint);
  const res = await axios.get(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });
  return res.data;
}

// Ejemplo de funciones específicas
async function getShopInfo(shop, accessToken) {
  return shopifyGet(shop, accessToken, 'shop.json');
}

async function getProducts(shop, accessToken) {
  return shopifyGet(shop, accessToken, 'products.json?limit=100');
}

async function getCustomers(shop, accessToken) {
  return shopifyGet(shop, accessToken, 'customers.json?limit=100');
}

async function getOrders(shop, accessToken) {
  return shopifyGet(shop, accessToken, 'orders.json?limit=50&status=any');
}

module.exports = {
  getShopInfo,
  getProducts,
  getCustomers,
  getOrders,
};
