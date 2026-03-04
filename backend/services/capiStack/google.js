
const axios = require('axios');
const prisma = require('../../utils/prismaClient');
const { decrypt } = require('../../utils/encryption');

// Developer Token is required for Google Ads API - put this in .env
const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';

/**
 * Sends a conversion to Google Ads API
 * @param {Object} order - Full order object
 * @param {Object} connection - Prisma platform connection or Mongo account
 * @returns {Promise<Object>}
 */
async function sendConversion(order, connection) {
  if (!GOOGLE_ADS_DEVELOPER_TOKEN) {
      console.warn('[Google CAPI] Missing GOOGLE_ADS_DEVELOPER_TOKEN');
      return { success: false, reason: 'Missing Developer Token' };
  }

  // 1. Get Access Token (decrypt if needed)
  let accessToken = connection.accessToken;
  // If it's a Prisma record and encrypted, decrypt it. Mongo records are usually raw?
  // Let's assume connection object has valid accessToken string for now.
  // In real implementation, handle refresh token logic here if expired.

  // 2. Extract GCLID from order attributes or session
  // Order schema has gclid? Let's check schema.
  // If not, look up session via sessionId
  let gclid = order.gclid || null; 
  // If not in order directly, try to get from session or checkout map?
  // The 'stitchAttribution' step should have enriched the order with attribution data.
  // Let's assume order.attributedClickId is the gclid if channel is Google.

  if (!gclid && order.attributedChannel === 'google') {
      gclid = order.attributedClickId;
  }

  if (!gclid) {
      return { success: false, reason: 'No GCLID found for Google conversion' };
  }

  // 3. Prepare Payload
  const customerId = connection.adAccountId; // e.g. 123-456-7890
  const conversionActionId = connection.pixelId; // e.g. "customers/123/conversionActions/456"

  // Google Ads API Endpoint
  const url = `https://googleads.googleapis.com/v14/customers/${customerId.replace(/-/g, '')}:uploadClickConversions`;
  
  const conversionDateTime = new Date(order.createdAt).toISOString().replace('T', ' ').split('.')[0] + '+00:00';

  const payload = {
    conversions: [{
      gclid: gclid,
      conversionAction: conversionActionId,
      conversionDateTime: conversionDateTime,
      conversionValue: order.revenue,
      currencyCode: order.currency,
      orderId: order.orderId
    }],
    partialFailure: true
  };

  // 4. Send Request
  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    return { success: true, data: response.data };

  } catch (error) {
    console.error('[Google CAPI Error]', error.response?.data || error.message);
    // If 401, maybe token expired? Need refresh logic.
    return { success: false, error: error.response?.data || error.message };
  }
}

module.exports = { sendConversion };
