'use strict';

/**
 * recordingSignalExtractor.js
 * Extracts behavioral signals from a raw rrweb events array.
 *
 * rrweb event types (numeric):
 *   DomContentLoaded=0, Load=1, FullSnapshot=2, IncrementalSnapshot=3, Meta=4, Custom=5
 *
 * IncrementalSnapshot sources:
 *   Mutation=0, MouseMove=1, MouseInteraction=2, Scroll=3, ViewportResize=4,
 *   Input=5, TouchMove=6, MediaInteraction=7, StyleSheetRule=8, CanvasMutation=9,
 *   Font=10, Log=11, Drag=12
 *
 * MouseInteraction types:
 *   MouseUp=0, MouseDown=1, Click=2, ContextMenu=3, DblClick=4, Focus=5, Blur=6,
 *   TouchStart=7, TouchMove_Departed=8, TouchEnd=9
 */

const EventType = { FullSnapshot: 2, IncrementalSnapshot: 3 };
const IncrementalSource = { MouseMove: 1, MouseInteraction: 2, Scroll: 3, Input: 5 };
const MouseInteractionType = { Click: 2, Focus: 5, Blur: 6 };

// CSS selectors that commonly indicate shipping/price/total display
const SHIPPING_SELECTORS = [
  'shipping', 'ship', 'freight', 'delivery', 'envio', 'envío', 'flete',
  'total', 'order-total', 'cart-total', 'checkout-total',
  '.woocommerce-shipping', '.shipping-total', '.order-total',
];

/**
 * Check if a node ID (from rrweb snapshot) is likely a shipping/total element.
 * We look for class names / text content hints in FullSnapshot nodes.
 * @param {Map} nodeMap - built from FullSnapshot
 * @param {number} nodeId
 * @returns {boolean}
 */
function isShippingNode(nodeMap, nodeId) {
  const node = nodeMap.get(nodeId);
  if (!node) return false;
  const attrs = node.attributes || {};
  const classVal = (attrs.class || '').toLowerCase();
  const idVal = (attrs.id || '').toLowerCase();
  return SHIPPING_SELECTORS.some((s) => classVal.includes(s) || idVal.includes(s));
}

/**
 * Build a node ID → node map from the first FullSnapshot event.
 * Shallow: only top-level childNodes for now.
 */
function buildNodeMap(events) {
  const map = new Map();
  for (const ev of events) {
    if (ev.type === EventType.FullSnapshot && ev.data?.node) {
      function walk(node) {
        if (node.id != null) map.set(node.id, node);
        (node.childNodes || []).forEach(walk);
      }
      walk(ev.data.node);
      break; // only first full snapshot
    }
  }
  return map;
}

/**
 * Main signal extraction function.
 * @param {Array} events - raw rrweb events array (already sorted by timestamp)
 * @param {object} options - { cartValue }
 * @returns {object} behavioral signals + riskScore
 */
function extractSignals(events, options = {}) {
  if (!Array.isArray(events) || events.length === 0) {
    return { error: 'empty_events', riskScore: 0 };
  }

  const { cartValue = null } = options;
  const nodeMap = buildNodeMap(events);

  const firstTs = events[0]?.timestamp || 0;
  const lastTs = events[events.length - 1]?.timestamp || 0;
  const totalDurationMs = lastTs - firstTs;

  // Accumulated signals
  const rageClicks = [];         // { selector, count, timestamp }
  const exitIntents = [];        // { timestamp, elapsedMs }
  const formFieldsAbandoned = [];// field identifiers
  const hesitationZones = [];    // { timestamp, durationMs, nearShipping }
  let shippingShockLikelihood = 0;
  let lastScrollY = 0;
  let lastScrollTs = 0;
  let scrolledToShipping = false;
  let shippingScrollTs = null;

  // --- Click clustering for rage detection ---
  const clickClusters = new Map(); // nodeId → [timestamps]
  const inputFocusMap = new Map(); // nodeId → { focusTs, fieldName }

  // --- Mouse position tracking for hesitation ---
  let lastMouseX = -1;
  let lastMouseY = -1;
  let lastMouseMoveTs = 0;
  const HESITATION_THRESHOLD_MS = 5000;
  const HESITATION_ZONE_PX = 50;

  for (const ev of events) {
    if (ev.type !== EventType.IncrementalSnapshot) continue;
    const { source, data } = ev;
    const ts = ev.timestamp || 0;

    // ── Mouse interactions ────────────────────────────────────────────────
    if (source === IncrementalSource.MouseInteraction) {
      const { type: iType, id: nodeId } = data || {};

      // Rage click detection: 3+ clicks on same element within 500ms
      if (iType === MouseInteractionType.Click && nodeId != null) {
        const cluster = clickClusters.get(nodeId) || [];
        cluster.push(ts);
        // Keep only clicks within the last 500ms
        const recent = cluster.filter((t) => ts - t <= 500);
        clickClusters.set(nodeId, recent);
        if (recent.length >= 3) {
          const existingRage = rageClicks.find((r) => r.nodeId === nodeId);
          if (existingRage) {
            existingRage.count = recent.length;
            existingRage.timestamp = ts;
          } else {
            rageClicks.push({ nodeId, count: recent.length, timestamp: ts, elapsedMs: ts - firstTs });
          }
        }
      }

      // Form focus tracking
      if (iType === MouseInteractionType.Focus && nodeId != null) {
        inputFocusMap.set(nodeId, { focusTs: ts });
      }
      // Form blur → check if field was abandoned (focus without value change)
      if (iType === MouseInteractionType.Blur && nodeId != null) {
        const focusEntry = inputFocusMap.get(nodeId);
        if (focusEntry) {
          // We'll also check via Input source — blur without corresponding input = abandoned
          if (!focusEntry.hadInput) {
            formFieldsAbandoned.push({ nodeId, elapsedMs: ts - firstTs });
          }
          inputFocusMap.delete(nodeId);
        }
      }
    }

    // ── Mouse moves (hesitation + exit intent) ────────────────────────────
    if (source === IncrementalSource.MouseMove) {
      const positions = data?.positions || [];
      for (const pos of positions) {
        const { x, y, timeOffset = 0 } = pos;
        const posTs = ts + timeOffset;

        // Exit intent: Y < 5% of viewport (top of browser)
        if (y < 50 && lastMouseY > 150) {
          exitIntents.push({ timestamp: posTs, elapsedMs: posTs - firstTs });
        }

        // Hesitation: mouse stationary for >5s in same 50px zone
        if (lastMouseMoveTs > 0 && posTs - lastMouseMoveTs >= HESITATION_THRESHOLD_MS) {
          const dx = Math.abs(x - lastMouseX);
          const dy = Math.abs(y - lastMouseY);
          if (dx < HESITATION_ZONE_PX && dy < HESITATION_ZONE_PX) {
            const durationMs = posTs - lastMouseMoveTs;
            const nearShipping = scrolledToShipping && posTs - (shippingScrollTs || 0) < 10000;
            hesitationZones.push({ timestamp: posTs, durationMs, nearShipping, elapsedMs: posTs - firstTs });
          }
        }

        lastMouseX = x;
        lastMouseY = y;
        lastMouseMoveTs = posTs;
      }
    }

    // ── Scroll events (shipping shock detection) ──────────────────────────
    if (source === IncrementalSource.Scroll) {
      const { id: nodeId, y: scrollY } = data || {};
      const scrolled = (scrollY || 0) - lastScrollY;
      lastScrollY = scrollY || 0;
      lastScrollTs = ts;

      // Check if the scrolled-to element is likely a shipping/total section
      if (nodeId && isShippingNode(nodeMap, nodeId)) {
        scrolledToShipping = true;
        shippingScrollTs = ts;
      }
    }

    // ── Input events (mark field as active) ──────────────────────────────
    if (source === IncrementalSource.Input) {
      const { id: nodeId } = data || {};
      if (nodeId != null) {
        const entry = inputFocusMap.get(nodeId);
        if (entry) entry.hadInput = true;
      }
    }
  }

  // Shipping shock likelihood:
  // If user scrolled to shipping area AND hesitated for >3s nearby → high likelihood
  const shippingHesitations = hesitationZones.filter((h) => h.nearShipping && h.durationMs >= 3000);
  if (scrolledToShipping && shippingHesitations.length > 0) {
    shippingShockLikelihood = Math.min(0.3 + shippingHesitations.length * 0.25, 1.0);
  } else if (scrolledToShipping) {
    shippingShockLikelihood = 0.2;
  }

  const totalHesitationMs = hesitationZones.reduce((sum, h) => sum + h.durationMs, 0);
  const maxHesitationMs = hesitationZones.reduce((max, h) => Math.max(max, h.durationMs), 0);
  const rageClickCount = rageClicks.length;
  const exitIntentCount = exitIntents.length;
  const formAbandonCount = formFieldsAbandoned.length;

  // ── Risk score (0-100) ───────────────────────────────────────────────────
  const riskScore = Math.round(
    Math.min(maxHesitationMs / 60000, 1) * 30 +
    Math.min(exitIntentCount, 3) * 20 +
    shippingShockLikelihood * 25 +
    Math.min(rageClickCount, 3) * 15 +
    Math.min(formAbandonCount, 2) * 10
  );

  // ── Abandonment pattern assignment ──────────────────────────────────────
  let abandonmentPattern = 'unknown';
  if (shippingShockLikelihood > 0.6) abandonmentPattern = 'shipping_shock';
  else if (formAbandonCount >= 2) abandonmentPattern = 'form_friction';
  else if (rageClickCount >= 3) abandonmentPattern = 'rage_exit';
  else if (totalDurationMs < 15000 && exitIntentCount === 0) abandonmentPattern = 'passive_browse';
  else if (cartValue && cartValue > 500 && maxHesitationMs > 30000) abandonmentPattern = 'high_value_hesitation';
  else if (exitIntentCount > 0) abandonmentPattern = 'exit_intent';

  return {
    totalDurationMs,
    rageClickCount,
    exitIntentCount,
    formFieldsAbandoned: formFieldsAbandoned.map((f) => f.nodeId),
    formAbandonCount,
    shippingShockLikelihood: Math.round(shippingShockLikelihood * 100) / 100,
    scrolledToShipping,
    hesitationCount: hesitationZones.length,
    totalHesitationMs,
    maxHesitationMs,
    abandonmentPattern,
    riskScore,
    // detailed arrays for debugging / LLM input
    rageClicks: rageClicks.slice(0, 5),
    exitIntents: exitIntents.slice(0, 3),
    hesitationZones: hesitationZones.slice(0, 5),
  };
}

module.exports = { extractSignals };
