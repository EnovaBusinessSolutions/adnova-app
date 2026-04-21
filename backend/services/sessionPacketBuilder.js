'use strict';

/**
 * sessionPacketBuilder.js
 *
 * Converts a finalized rrweb event stream into the structured SessionPacket
 * artifact (Phase 4 per rrweb-phase.md). The packet is the permanent record
 * that downstream AI reasoning reads — raw rrweb is erased 24h after.
 *
 * Pipeline:
 *   1. Build productIndex from the stream's product_view Custom events
 *      (emitted by the pixel's IntersectionObserver) so the keyframe extractor
 *      can hit-test hover events against products without a pre-built catalog.
 *   2. Run keyframeExtractor (ported from the arch v2 spec file) → 50–150
 *      narrative-style keyframes.
 *   3. Run recordingSignalExtractor (existing) → aggregate scores.
 *   4. Derive ecommerceEvents array: subset of keyframes with tags add_to_cart,
 *      remove_from_cart, begin_checkout, purchase.
 *   5. Derive session metadata (start/end/duration/landing/device/traffic).
 *   6. Assemble final JSON packet matching the SessionPacket Prisma shape.
 */

const { extractKeyframes } = require('./keyframeExtractor');

const RRWEB = {
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
};

/**
 * Collect every product_view Custom event in the stream into an
 * elementId → { id, name, price, bbox } map for hitTestProducts.
 */
function buildProductIndex(events) {
  const index = {};
  for (const ev of events) {
    if (ev?.type !== RRWEB.Custom) continue;
    if (ev?.data?.tag !== 'product_view') continue;
    const p = ev.data.payload || {};
    const key = p.element_id || p.product_id;
    if (!key) continue;
    index[key] = {
      id: p.product_id || p.element_id,
      name: p.name || null,
      price: typeof p.price === 'number' ? p.price : null,
      bbox: p.bbox || null,
    };
  }
  return index;
}

/**
 * Extract ecommerce-relevant keyframes (subset) for the packet's
 * ecommerceEvents array. Keeps the signals layer thin: the LLM reads
 * keyframes; analytics queries read ecommerceEvents.
 */
function deriveEcommerceEvents(keyframes) {
  const ECOMMERCE_TYPES = new Set([
    'add_to_cart',
    'cart_modification',
    'checkout_entry',
    'checkout_hesitation',
    'purchase',
  ]);
  return keyframes
    .filter((kf) => ECOMMERCE_TYPES.has(kf.type))
    .map((kf) => ({
      type: kf.type,
      timestamp: kf.timestamp,
      elapsed_seconds: kf.elapsed_seconds,
      page_url: kf.page_url,
      interaction: kf.interaction || null,
    }));
}

/**
 * Derive top-level session metadata from the event stream + recording row.
 */
function deriveSessionMeta(events, recording) {
  if (!events.length) {
    const now = Date.now();
    return { startTs: now, endTs: now, durationMs: 0, landingPage: null, device: null };
  }
  const startTs = events[0].timestamp;
  const endTs   = events[events.length - 1].timestamp;

  // Landing page: first Meta event or first page_view Custom event
  let landingPage = null;
  for (const ev of events) {
    if (ev.type === RRWEB.Meta && ev.data?.href) { landingPage = ev.data.href; break; }
    if (ev.type === RRWEB.Custom && ev.data?.tag === 'page_view' && ev.data?.payload?.url) {
      landingPage = ev.data.payload.url; break;
    }
  }

  // Device: prefer recording.deviceType; fall back to Meta viewport width→heuristic
  let deviceType = recording?.deviceType || null;
  let viewport = null;
  const metaEv = events.find((e) => e.type === RRWEB.Meta && e.data?.width != null);
  if (metaEv) viewport = { width: metaEv.data.width, height: metaEv.data.height };
  if (!deviceType && viewport) {
    if (viewport.width <= 640) deviceType = 'mobile';
    else if (viewport.width <= 1024) deviceType = 'tablet';
    else deviceType = 'desktop';
  }

  return {
    startTs,
    endTs,
    durationMs: Math.max(0, endTs - startTs),
    landingPage,
    device: deviceType || viewport ? { type: deviceType, viewport } : null,
  };
}

/**
 * Pick outcome from the stream. If the Custom 'purchase' event is present,
 * PURCHASED. Else, STILL_BROWSING for now (a separate job will update to
 * ABANDONED/BOUNCED after a retention window — matches existing check-outcome
 * behavior).
 */
function deriveOutcome(events) {
  for (const ev of events) {
    if (ev?.type === RRWEB.Custom && ev?.data?.tag === 'purchase') return 'PURCHASED';
  }
  return 'STILL_BROWSING';
}

/**
 * Build a SessionPacket data object ready for prisma.sessionPacket.upsert.
 *
 * @param {object}   params
 * @param {Array}    params.events     — sorted rrweb events for the session
 * @param {object}   params.recording  — row from prisma.sessionRecording
 *                                        (provides sessionId, accountId, userKey,
 *                                         cartValue, attributionSnapshot, deviceType,
 *                                         orderId if already attributed)
 * @param {object}   [params.signals]  — pre-computed signals (optional; if
 *                                        omitted the caller should run
 *                                        recordingSignalExtractor separately)
 * @returns {object} packet             — matches SessionPacket model fields
 */
function buildSessionPacket({ events, recording, signals }) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('buildSessionPacket: events array is empty');
  }
  if (!recording?.sessionId) {
    throw new Error('buildSessionPacket: recording.sessionId required');
  }

  const productIndex = buildProductIndex(events);
  const { startTs, endTs, durationMs, landingPage, device } = deriveSessionMeta(events, recording);

  const keyframes = extractKeyframes(events, {
    sessionId:  recording.sessionId,
    merchantId: recording.accountId,
    visitorId:  recording.userKey,
    startTs,
  }, productIndex);

  const ecommerceEvents = deriveEcommerceEvents(keyframes);
  const outcome = deriveOutcome(events);

  // attribution snapshot → trafficSource
  const attr = recording.attributionSnapshot && typeof recording.attributionSnapshot === 'object'
    ? recording.attributionSnapshot : {};
  const trafficSource = {
    utm_source:   attr.utm_source   || null,
    utm_medium:   attr.utm_medium   || null,
    utm_campaign: attr.utm_campaign || null,
    utm_content:  attr.utm_content  || null,
    utm_term:     attr.utm_term     || null,
    referrer:     attr.referrer     || null,
    fbclid:       attr.fbclid       || null,
    gclid:        attr.gclid        || null,
    ttclid:       attr.ttclid       || null,
  };

  // cartValueAtEnd: last cart_value observed in ecommerce events; else recording.cartValue
  let cartValueAtEnd = null;
  for (let i = ecommerceEvents.length - 1; i >= 0; i--) {
    const v = ecommerceEvents[i]?.interaction?.cart_value;
    if (typeof v === 'number') { cartValueAtEnd = v; break; }
  }
  if (cartValueAtEnd == null && typeof recording.cartValue === 'number') cartValueAtEnd = recording.cartValue;

  return {
    sessionId: recording.sessionId,
    accountId: recording.accountId,
    visitorId: recording.userKey || null,
    personId:  null,                      // filled by identity resolver (Phase 7)
    startTs:   new Date(startTs),
    endTs:     new Date(endTs),
    durationMs,
    device,
    trafficSource,
    landingPage,
    keyframes,
    signals:   signals || {},
    ecommerceEvents,
    outcome,
    cartValueAtEnd,
    orderId:   recording.orderId || null,
  };
}

module.exports = {
  buildSessionPacket,
  buildProductIndex,
  deriveEcommerceEvents,
  deriveSessionMeta,
  deriveOutcome,
};
