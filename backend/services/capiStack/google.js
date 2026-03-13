
const axios = require('axios');
const { decrypt } = require('../../utils/encryption');
const { OAuth2Client } = require('google-auth-library');

// Developer Token is required for Google Ads API - put this in .env
const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';

const GOOGLE_LOGIN_CUSTOMER_ID = String(
  process.env.GOOGLE_LOGIN_CUSTOMER_ID ||
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
  ''
).replace(/[^\d]/g, '');

function isLikelyEncryptedToken(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts.every((part) => /^[0-9a-fA-F]+$/.test(part));
}

function normalizeDigits(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function normalizeConversionActionResource(customerId, rawValue) {
  const input = String(rawValue || '').trim();
  if (!input) return null;

  if (/^customers\/\d+\/conversionActions\/\d+$/i.test(input)) {
    return input;
  }

  const numericId = normalizeDigits(input);
  if (!numericId) return null;
  return `customers/${customerId}/conversionActions/${numericId}`;
}

async function refreshGoogleAccessToken(refreshToken) {
  if (!refreshToken) return null;

  const oauth = new OAuth2Client({
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_ADS_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CONNECT_CALLBACK_URL || '',
  });

  oauth.setCredentials({ refresh_token: refreshToken });

  try {
    const { token } = await oauth.getAccessToken();
    return token || null;
  } catch (_) {
    return null;
  }
}

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

  // 1. Resolve access token from raw/encrypted/refresh-token paths.
  const rawAccessToken = connection?.accessToken || null;
  const rawRefreshToken = connection?.refreshToken || null;
  const accessToken = isLikelyEncryptedToken(rawAccessToken)
    ? decrypt(rawAccessToken)
    : (rawAccessToken || await refreshGoogleAccessToken(rawRefreshToken));

  if (!accessToken) {
    return { success: false, reason: 'No Google access token available' };
  }

  // 2. Extract GCLID from stitched attribution signals.
  let gclid =
    order?.gclid ||
    order?.attributedClickId ||
    order?.attributionSnapshot?.gclid ||
    order?.attributionSnapshot?.click_id ||
    null;

  if (gclid) gclid = String(gclid).trim();

  if (!gclid) {
      return { success: false, reason: 'No GCLID found for Google conversion' };
  }

  // 3. Prepare Payload
  const customerId = normalizeDigits(connection?.adAccountId || connection?.customerId || '');
  if (!customerId) {
    return { success: false, reason: 'No Google customer ID configured' };
  }

  const conversionAction = normalizeConversionActionResource(customerId, connection?.pixelId || connection?.conversionAction || '');
  if (!conversionAction) {
    return { success: false, reason: 'No valid Google conversion action configured' };
  }

  // Google Ads API Endpoint
  const url = `https://googleads.googleapis.com/v14/customers/${customerId}:uploadClickConversions`;
  
  const conversionDateTime = new Date(order.platformCreatedAt || order.createdAt)
    .toISOString()
    .replace('T', ' ')
    .split('.')[0] + '+00:00';

  const payload = {
    conversions: [{
      gclid: gclid,
      conversionAction,
      conversionDateTime: conversionDateTime,
      conversionValue: Number(order.revenue || 0),
      currencyCode: String(order.currency || 'MXN').toUpperCase(),
      orderId: String(order.orderId || order.orderNumber || '')
    }],
    partialFailure: true
  };

  // 4. Send Request
  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
        ...(GOOGLE_LOGIN_CUSTOMER_ID ? { 'login-customer-id': GOOGLE_LOGIN_CUSTOMER_ID } : {}),
        'Content-Type': 'application/json'
      }
    });

    const partialFailureError = response?.data?.partialFailureError;
    if (partialFailureError) {
      return { success: false, reason: partialFailureError.message || 'Google partial failure', data: response.data };
    }
    
    return { success: true, data: response.data };

  } catch (error) {
    console.error('[Google CAPI Error]', error.response?.data || error.message);
    // If 401, maybe token expired? Need refresh logic.
    return { success: false, error: error.response?.data || error.message };
  }
}

module.exports = { sendConversion };
