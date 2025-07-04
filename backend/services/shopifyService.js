// backend/services/shopifyService.js
const axios = require('axios');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';

function shopifyGraphQL(shop, accessToken) {
  return axios.create({
    baseURL: `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });
}

async function getShopInfo(shop, accessToken) {
  const query = `
    {
      shop {
        name
        email
        myshopifyDomain
        myshopifyDomain
        primaryDomain { url }
        currencyCode
        plan { displayName }
      }
    }
  `;
  const { data } = await shopifyGraphQL(shop, accessToken).post('', { query });
  return data.data.shop;
}

async function getProducts(shop, accessToken, limit = 50) {
  const query = `
    {
      products(first: ${limit}) {
        edges {
          node {
            id
            title
            descriptionHtml
            totalInventory
            tags
            vendor
            productType
            createdAt
            updatedAt
            publishedAt
            onlineStoreUrl
            featuredImage { url }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
    }
  `;
  const { data } = await shopifyGraphQL(shop, accessToken).post('', { query });
  return data.data.products.edges.map(e => e.node);
}

async function getCustomers(shop, accessToken, limit = 50) {
  const query = `
    {
      customers(first: ${limit}) {
        edges {
          node {
            id
            displayName
            email
            phone
            state
            createdAt
            ordersCount
            totalSpent
          }
        }
      }
    }
  `;
  const { data } = await shopifyGraphQL(shop, accessToken).post('', { query });
  return data.data.customers.edges.map(e => e.node);
}

async function getOrders(shop, accessToken, limit = 50) {
  const query = `
    {
      orders(first: ${limit}, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            processedAt
            totalPriceSet { shopMoney { amount } }
            subtotalPriceSet { shopMoney { amount } }
            totalShippingPriceSet { shopMoney { amount } }
            currencyCode
            customer { id, displayName, email }
            lineItems(first: 20) {
              edges {
                node {
                  title
                  quantity
                  originalUnitPriceSet { shopMoney { amount } }
                }
              }
            }
            fulfillments { trackingCompany, trackingInfo { number, url } }
            financialStatus
            fulfillmentStatus
          }
        }
      }
    }
  `;
  const { data } = await shopifyGraphQL(shop, accessToken).post('', { query });
  return data.data.orders.edges.map(e => e.node);
}

module.exports = {
  getShopInfo,
  getProducts,
  getCustomers,
  getOrders,
};
