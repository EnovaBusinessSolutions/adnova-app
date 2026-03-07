const axios = require('axios');
const mongoose = require('mongoose');
const ShopConnections = require('../models/ShopConnections'); // Existing Mongoose model
const redisClient = require('../utils/redisClient');
const prisma = require('../utils/prismaClient');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';

/**
 * Enriches order line items with Shopify variant details
 * @param {Array} lineItems 
 * @param {string} accountId - Account ID (for Shopify, this is the shop domain)
 */
async function enrichOrderLineItems(lineItems, accountId) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return lineItems;

  // 1. Get access token
  let accessToken = null;
  
  // Try Postgres first (Account table)
  const pgAccount = await prisma.account.findUnique({
    where: { accountId }
  });
  
  if (pgAccount && pgAccount.accessToken) {
    accessToken = pgAccount.accessToken;
  } else {
    // Fallback to Mongo (ShopConnections)
    const mongoShop = await ShopConnections.findOne({ shop: accountId });
    if (mongoShop) {
      accessToken = mongoShop.accessToken;
    }
  }

  if (!accessToken) {
    console.warn(`No access token found for ${accountId} during enrichment.`);
    return lineItems;
  }

  // Determine shop domain for API calls (for Shopify accounts, accountId IS the shop domain)
  const shopDomain = pgAccount?.domain || accountId;

  const client = axios.create({
    baseURL: `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}`,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });

  const enrichedItems = [];

  for (const item of lineItems) {
    const enriched = { ...item };
    const variantId = item.variant_id;

    if (variantId) {
      const cacheKey = `adray:variant:${shopDomain}:${variantId}`;
      let variantData = null;

      // Check cache
      if (redisClient) {
        try {
          const cached = await redisClient.get(cacheKey);
          if (cached) variantData = JSON.parse(cached);
        } catch (e) {
          // ignore cache error
        }
      }

      // Fetch if not cached
      if (!variantData) {
        try {
          const res = await client.get(`/variants/${variantId}.json`);
          if (res.data && res.data.variant) {
            variantData = {
              title: res.data.variant.title,
              product_id: res.data.variant.product_id,
            };
            
            // Also get product data for vendor and type
            if (variantData.product_id) {
               const pRes = await client.get(`/products/${variantData.product_id}.json`);
               if (pRes.data && pRes.data.product) {
                 variantData.vendor = pRes.data.product.vendor;
                 variantData.product_type = pRes.data.product.product_type;
                 variantData.tags = pRes.data.product.tags;
                 if (pRes.data.product.images && pRes.data.product.images.length > 0) {
                     variantData.image_url = pRes.data.product.images[0].src;
                 }
               }
            }

            // Set cache (1 hour)
            if (redisClient) {
              await redisClient.set(cacheKey, JSON.stringify(variantData), 'EX', 3600);
            }
          }
        } catch (error) {
          console.warn(`Failed to enrich variant ${variantId} for ${shopDomain}:`, error.message);
        }
      }

      // Merge data
      if (variantData) {
        Object.assign(enriched, variantData);
      }
    }
    
    enrichedItems.push(enriched);
  }

  return enrichedItems;
}

module.exports = {
  enrichOrderLineItems
};
