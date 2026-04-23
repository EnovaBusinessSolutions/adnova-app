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
  const { accessToken, pixelId, testEventCode, bri } = config;

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

  // BRI enrichment — allows Meta to optimize audiences using behavioral signals
  if (bri) {
    if (bri.archetype)                          customData.bri_archetype    = bri.archetype;
    if (bri.customer_tier)                      customData.bri_tier         = bri.customer_tier;
    if (bri.confidence != null)                 customData.bri_confidence   = bri.confidence;
    if (bri.organic_converter        === true)  customData.bri_organic      = '1';
    if (bri.exclude_from_retargeting === true)  customData.bri_suppress     = '1';
  }

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
  const url      = `${FB_CAPI_BASE}/${pixelId}/events`;
  const response = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  return { success: true, data: response.data };
}

module.exports = { sendConversion };
