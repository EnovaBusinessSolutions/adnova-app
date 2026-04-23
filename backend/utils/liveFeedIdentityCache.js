'use strict';

/**
 * liveFeedIdentityCache.js
 *
 * In-memory cache of identity signals (customerName, email, customerId) keyed
 * by userKey and sessionId. Populated when events with identity hints pass
 * through collect.js or the webhooks, consumed when emitting Live Feed events
 * that don't themselves carry identity (page_view, view_item, etc).
 *
 * Purpose: the old HTML dashboard built this map client-side. In the React
 * dashboard we do it server-side so names appear consistently on page loads,
 * not only after a purchase has been seen in the current browser session.
 *
 * Bounded at ~10k entries per map via a naive FIFO eviction to cap memory.
 */

const MAX_ENTRIES = 10_000;

const byUserKey   = new Map();
const bySessionId = new Map();

function trim(map) {
  if (map.size <= MAX_ENTRIES) return;
  const drop = map.size - MAX_ENTRIES;
  let i = 0;
  for (const k of map.keys()) {
    if (i++ >= drop) break;
    map.delete(k);
  }
}

function pickFirst(...vals) {
  for (const v of vals) {
    const s = v == null ? '' : String(v).trim();
    if (s) return s;
  }
  return null;
}

/**
 * Extract a display name from a heterogeneous payload (pixel, webhook, etc).
 * Mirrors the old dashboard's extractor — covers Woo + Shopify + custom shapes.
 */
function extractCustomerName(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const customer = payload.customer && typeof payload.customer === 'object' ? payload.customer : {};
  const billing  = payload.billing  && typeof payload.billing  === 'object' ? payload.billing  : {};
  const shipping = payload.shipping && typeof payload.shipping === 'object' ? payload.shipping : {};
  const userData = payload.user_data && typeof payload.user_data === 'object' ? payload.user_data : {};

  return pickFirst(
    payload.customer_name,
    payload.customerName,
    payload.customer_display_name,
    payload.customerDisplayName,
    payload.display_name,
    payload.displayName,
    [payload.customer_first_name, payload.customer_last_name].filter(Boolean).join(' '),
    [payload.first_name, payload.last_name].filter(Boolean).join(' '),
    [payload.firstName, payload.lastName].filter(Boolean).join(' '),
    [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    customer.name,
    customer.display_name,
    [billing.first_name, billing.last_name].filter(Boolean).join(' '),
    [shipping.first_name, shipping.last_name].filter(Boolean).join(' '),
    [userData.fn, userData.ln].filter(Boolean).join(' '),
    userData.name,
  );
}

/**
 * Cache identity signals under userKey and sessionId if present.
 * Safe to call with partial/empty values — no-ops when nothing useful.
 */
function cacheIdentity({ userKey, sessionId, customerName, email, customerId } = {}) {
  const name   = customerName ? String(customerName).trim() : '';
  if (!name) return; // only cache when we actually have a name

  const record = { customerName: name, email: email || null, customerId: customerId || null, at: Date.now() };

  if (userKey) {
    byUserKey.set(String(userKey), record);
    trim(byUserKey);
  }
  if (sessionId) {
    bySessionId.set(String(sessionId), record);
    trim(bySessionId);
  }
}

/**
 * Convenience: extract name from payload and cache it under userKey/sessionId.
 * Returns the extracted name (or null) so the caller can also attach it inline.
 */
function cacheFromPayload({ userKey, sessionId, payload } = {}) {
  const name = extractCustomerName(payload);
  if (name) cacheIdentity({ userKey, sessionId, customerName: name });
  return name;
}

/**
 * Look up a cached name by userKey or sessionId. Returns null if not found.
 */
function lookupCustomerName({ userKey, sessionId } = {}) {
  if (userKey) {
    const r = byUserKey.get(String(userKey));
    if (r?.customerName) return r.customerName;
  }
  if (sessionId) {
    const r = bySessionId.get(String(sessionId));
    if (r?.customerName) return r.customerName;
  }
  return null;
}

module.exports = {
  cacheIdentity,
  cacheFromPayload,
  lookupCustomerName,
  extractCustomerName,
};
