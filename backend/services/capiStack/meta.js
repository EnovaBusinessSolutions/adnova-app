// backend/services/capiStack/meta.js
'use strict';

const axios = require('axios');

const FB_VERSION    = process.env.FACEBOOK_API_VERSION || 'v19.0';
const FB_CAPI_BASE  = `https://graph.facebook.com/${FB_VERSION}`;

/**
 * Send a Purchase conversion event to Meta Conversions API.
 *
 * @param {Object} order  - Full order record from DB
 * @param {Object} config - { accessToken, pixelId, testEventCode? }
 * @returns {Promise<{ success: boolean, data?, reason? }>}
 */
async function sendConversion(order, config) {
  const { accessToken, pixelId, testEventCode } = config;

  if (!accessToken) return { success: false, reason: 'Missing Meta accessToken' };
  if (!pixelId)     return { success: false, reason: 'Missing Meta pixelId' };

  // ── event_time: epoch seconds from order date ──────────────────────────────
  const rawDate   = order.platformCreatedAt || order.createdAt;
  const eventTime = Math.floor(new Date(rawDate).getTime() / 1000);

  // ── user_data ──────────────────────────────────────────────────────────────
  // emailHash / phoneHash are already SHA-256(lower+trim) from hashPII(),
  // which is exactly what Meta requires.
  const userData = {};
  if (order.emailHash) userData.em = [order.emailHash];
  if (order.phoneHash) userData.ph = [order.phoneHash];

  // ── custom_data ────────────────────────────────────────────────────────────
  const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
  const contents  = lineItems
    .map((item) => ({
      id:         String(item.id || item.sku || item.variant_id || ''),
      quantity:   Number(item.quantity || 1),
      item_price: Number(item.price || 0),
    }))
    .filter((c) => c.id);

  const customData = {
    value:     Number(order.revenue  || 0),
    currency:  (order.currency || 'MXN').toUpperCase(),
    order_id:  String(order.orderNumber || order.orderId || ''),
    num_items: lineItems.length,
  };
  if (contents.length > 0) customData.contents = contents;

  // ── event object ───────────────────────────────────────────────────────────
  const eventPayload = {
    event_name:   'Purchase',
    event_time:   eventTime,
    event_id:     String(order.eventId || order.orderId || ''),
    action_source: 'website',
    user_data:    userData,
    custom_data:  customData,
  };

  // Best-effort source URL (helps Meta match the session)
  if (order.accountId) {
    const num = order.orderNumber || order.orderId || '';
    eventPayload.event_source_url = `https://${order.accountId}/checkout/order-received/${num}/`;
  }

  // ── request body ───────────────────────────────────────────────────────────
  const body = {
    data:         [eventPayload],
    access_token: accessToken,
  };
  if (testEventCode) body.test_event_code = testEventCode;

  // ── POST ───────────────────────────────────────────────────────────────────
  const url = `${FB_CAPI_BASE}/${pixelId}/events`;

  try {
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    return { success: true, data: response.data };
  } catch (error) {
    const responseData = error?.response?.data || null;
    const message =
      responseData?.error?.message ||
      responseData?.message ||
      error?.message ||
      'Meta CAPI request failed';

    console.error('[Meta CAPI Error]', responseData || message);
    return {
      success: false,
      reason: message,
      data: responseData,
    };
  }
}

module.exports = { sendConversion };
