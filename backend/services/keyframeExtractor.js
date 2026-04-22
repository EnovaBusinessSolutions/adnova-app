/**
 * Adray Behavioral Revenue Intelligence
 * Keyframe Extraction — adray-process Lambda
 *
 * Scans a merged, timestamp-sorted rrweb event stream and emits
 * keyframe objects for every meaningful behavioral moment.
 *
 * Thresholds match the architecture spec exactly:
 *   - Scroll stop      : velocity === 0 for > 2 000 ms
 *   - Product hover    : cursor in bounding box for > 1 500 ms
 *   - Rage click       : 3+ clicks on same element within 2 000 ms
 *   - Checkout hesitat.: > 60 000 ms on checkout page without URL change
 */

'use strict';

// ─── rrweb event type constants ───────────────────────────────────────────────
const RRWebEventType = {
  DomContentLoaded: 0,
  Load:             1,
  FullSnapshot:     2,
  IncrementalSnapshot: 3,
  Meta:             4,
  Custom:           5,
};

const IncrementalSource = {
  Mutation:          0,
  MouseMove:         1,
  MouseInteraction:  2,
  Scroll:            3,
  ViewportResize:    4,
  Input:             5,
  TouchMove:         6,
  MediaInteraction:  7,
  StyleSheetRule:    8,
  CanvasMutation:    9,
  Font:             10,
  Log:              11,
  Drag:             12,
  StyleDeclaration: 13,
  Selection:        14,
  AdoptedStyleSheet:15,
  CustomElement:    16,
};

const MouseInteractionType = {
  MouseUp:    0,
  MouseDown:  1,
  Click:      2,
  ContextMenu:3,
  DblClick:   4,
  Focus:      5,
  Blur:       6,
  TouchStart: 7,
  TouchMove:  8,
  TouchEnd:   9,
};

// ─── Thresholds ───────────────────────────────────────────────────────────────
const SCROLL_STOP_MS         = 2_000;
const PRODUCT_HOVER_MS       = 1_500;
const RAGE_CLICK_WINDOW_MS   = 2_000;
const RAGE_CLICK_COUNT        = 3;
const CHECKOUT_HESITATION_MS = 60_000;
const SESSION_TIMEOUT_MS     = 30 * 60_000;

// Checkout URL patterns — extend per merchant config if needed
const CHECKOUT_URL_PATTERNS = [
  /\/checkout/i,
  /\/cart\/checkout/i,
  /\/pago/i,
  /\/order\/confirm/i,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isCheckoutUrl(url) {
  return CHECKOUT_URL_PATTERNS.some(p => p.test(url));
}

function isIncrementalOf(event, source) {
  return (
    event.type === RRWebEventType.IncrementalSnapshot &&
    event.data?.source === source
  );
}

function getUrl(event) {
  // rrweb Meta events carry the current href
  if (event.type === RRWebEventType.Meta) return event.data?.href ?? null;
  // Custom page_view events from the Adray pixel
  if (event.type === RRWebEventType.Custom && event.data?.tag === 'page_view')
    return event.data?.payload?.url ?? null;
  return null;
}

function makeId(prefix, index) {
  return `${prefix}_${String(index).padStart(3, '0')}`;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * @param {Array}  events       Merged, timestamp-sorted rrweb event array
 * @param {Object} sessionMeta  { sessionId, merchantId, visitorId, startTs }
 * @param {Object} productIndex Map of elementId → { id, name, price, category }
 *                              Pre-built from the merchant's product catalogue
 * @returns {Array} keyframes   Array of keyframe objects
 */
function extractKeyframes(events, sessionMeta, productIndex = {}) {
  const keyframes = [];
  let kfIndex = 0;

  const { sessionId, startTs } = sessionMeta;

  // ── State machines ──────────────────────────────────────────────────────────
  let currentUrl        = null;
  let lastScrollTs      = null;
  let lastScrollDepth   = 0;
  let scrollStopTimer   = null;   // virtual — we scan forward, not real-time

  let mouseX = 0;
  let mouseY = 0;
  let hoverTarget       = null;   // { elementId, enteredTs }

  // Rage click: { elementId → [timestamps] }
  const clickHistory    = new Map();

  let onCheckout        = false;
  let checkoutEnteredTs = null;
  let checkoutProgressed = false;

  let previousAction    = null;
  let lastKfType        = null;

  // ── Scroll stop detection uses a look-ahead approach ────────────────────────
  // We pre-scan to find scroll-stop moments before the main pass.
  const scrollStops = detectScrollStops(events);

  // ── Main event pass ──────────────────────────────────────────────────────────
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const ts    = event.timestamp;
    const elapsed = Math.round((ts - startTs) / 1000);

    // ── 1. Page navigation ───────────────────────────────────────────────────
    const newUrl = getUrl(event);
    if (newUrl && newUrl !== currentUrl) {
      // Detect checkout entry
      const enteringCheckout = isCheckoutUrl(newUrl) && !isCheckoutUrl(currentUrl ?? '');
      const leavingCheckout  = !isCheckoutUrl(newUrl) && isCheckoutUrl(currentUrl ?? '');

      // Checkout hesitation: close out the open hesitation window
      if (onCheckout && leavingCheckout) {
        const hesitationMs = ts - (checkoutEnteredTs ?? ts);
        if (hesitationMs > CHECKOUT_HESITATION_MS && !checkoutProgressed) {
          keyframes.push({
            keyframe_id: makeId('kf', kfIndex++),
            type: 'checkout_hesitation',
            timestamp: checkoutEnteredTs + CHECKOUT_HESITATION_MS,
            elapsed_seconds: Math.round((checkoutEnteredTs + CHECKOUT_HESITATION_MS - startTs) / 1000),
            duration_at_state_seconds: Math.round(hesitationMs / 1000),
            page_url: currentUrl,
            interaction: {
              hesitation_duration_seconds: Math.round(hesitationMs / 1000),
              resolved: leavingCheckout,
              previous_action: previousAction,
              next_action: 'page_navigation',
            },
          });
          lastKfType = 'checkout_hesitation';
        }
        onCheckout = false;
        checkoutEnteredTs = null;
        checkoutProgressed = false;
      }

      // Emit page_navigation keyframe
      keyframes.push({
        keyframe_id: makeId('kf', kfIndex++),
        type: 'page_navigation',
        timestamp: ts,
        elapsed_seconds: elapsed,
        duration_at_state_seconds: null,
        page_url: newUrl,
        interaction: {
          from_url: currentUrl,
          previous_action: previousAction,
          next_action: null,
        },
      });
      lastKfType = 'page_navigation';
      previousAction = 'page_navigation';

      // Open checkout tracking
      if (enteringCheckout) {
        onCheckout = true;
        checkoutEnteredTs = ts;
        checkoutProgressed = false;

        keyframes.push({
          keyframe_id: makeId('kf', kfIndex++),
          type: 'checkout_entry',
          timestamp: ts,
          elapsed_seconds: elapsed,
          duration_at_state_seconds: null,
          page_url: newUrl,
          interaction: {
            from_url: currentUrl,
            previous_action: previousAction,
            next_action: null,
          },
        });
        lastKfType = 'checkout_entry';
        previousAction = 'checkout_entry';
      }

      currentUrl = newUrl;
      continue;
    }

    // ── 2. Scroll stop (pre-computed) ─────────────────────────────────────────
    const scrollStop = scrollStops.get(ts);
    if (scrollStop) {
      keyframes.push({
        keyframe_id: makeId('kf', kfIndex++),
        type: 'scroll_stop',
        timestamp: ts,
        elapsed_seconds: elapsed,
        duration_at_state_seconds: scrollStop.durationSeconds,
        page_url: currentUrl,
        scroll_depth_percent: scrollStop.scrollDepthPercent,
        dom_context: buildDomContext(scrollStop, productIndex),
        interaction: {
          cursor_on_element: null,
          hover_duration_seconds: null,
          previous_action: previousAction,
          next_action: null,
        },
      });
      lastKfType = 'scroll_stop';
      previousAction = 'scroll';
    }

    // Track last scroll depth for context
    if (isIncrementalOf(event, IncrementalSource.Scroll)) {
      lastScrollDepth = computeScrollDepth(event.data);
      lastScrollTs = ts;
    }

    // ── 3. Mouse position tracking ────────────────────────────────────────────
    if (isIncrementalOf(event, IncrementalSource.MouseMove)) {
      const positions = event.data?.positions ?? [];
      if (positions.length > 0) {
        const last = positions[positions.length - 1];
        mouseX = last.x;
        mouseY = last.y;

        // Check if cursor entered a product bounding box
        const productHit = hitTestProducts(mouseX, mouseY, productIndex);

        if (productHit && hoverTarget?.elementId !== productHit.elementId) {
          // Entered a new product element
          hoverTarget = { elementId: productHit.elementId, enteredTs: ts };
        } else if (!productHit && hoverTarget) {
          // Left a product element — check dwell time
          const dwellMs = ts - hoverTarget.enteredTs;
          if (dwellMs >= PRODUCT_HOVER_MS) {
            const product = productIndex[hoverTarget.elementId];
            keyframes.push({
              keyframe_id: makeId('kf', kfIndex++),
              type: 'product_hover',
              timestamp: hoverTarget.enteredTs,
              elapsed_seconds: Math.round((hoverTarget.enteredTs - startTs) / 1000),
              duration_at_state_seconds: Math.round(dwellMs / 1000),
              page_url: currentUrl,
              interaction: {
                cursor_on_element: hoverTarget.elementId,
                product: product ?? { id: hoverTarget.elementId },
                hover_duration_seconds: Math.round(dwellMs / 1000),
                previous_action: previousAction,
                next_action: null,
              },
            });
            lastKfType = 'product_hover';
            previousAction = 'product_hover';
          }
          hoverTarget = null;
        }
      }
    }

    // ── 4. Click events ───────────────────────────────────────────────────────
    if (
      isIncrementalOf(event, IncrementalSource.MouseInteraction) &&
      event.data?.type === MouseInteractionType.Click
    ) {
      const elementId = String(event.data?.id ?? 'unknown');

      // Rage click detection
      if (!clickHistory.has(elementId)) clickHistory.set(elementId, []);
      const clicks = clickHistory.get(elementId);
      clicks.push(ts);

      // Purge clicks outside the window
      const windowStart = ts - RAGE_CLICK_WINDOW_MS;
      const recentClicks = clicks.filter(t => t >= windowStart);
      clickHistory.set(elementId, recentClicks);

      if (recentClicks.length >= RAGE_CLICK_COUNT) {
        keyframes.push({
          keyframe_id: makeId('kf', kfIndex++),
          type: 'rage_click',
          timestamp: ts,
          elapsed_seconds: elapsed,
          duration_at_state_seconds: Math.round((ts - recentClicks[0]) / 1000),
          page_url: currentUrl,
          interaction: {
            element_id: elementId,
            click_count: recentClicks.length,
            window_ms: RAGE_CLICK_WINDOW_MS,
            previous_action: previousAction,
            next_action: null,
          },
        });
        lastKfType = 'rage_click';
        previousAction = 'rage_click';
        // Reset so we don't fire on every subsequent click
        clickHistory.set(elementId, []);
      }
    }

    // ── 5. Tab visibility ─────────────────────────────────────────────────────
    if (
      event.type === RRWebEventType.Custom &&
      event.data?.tag === 'visibility_change'
    ) {
      const hidden = event.data?.payload?.hidden;
      keyframes.push({
        keyframe_id: makeId('kf', kfIndex++),
        type: 'tab_switch',
        timestamp: ts,
        elapsed_seconds: elapsed,
        duration_at_state_seconds: null,
        page_url: currentUrl,
        interaction: {
          direction: hidden ? 'left_tab' : 'returned_to_tab',
          previous_action: previousAction,
          next_action: null,
        },
      });
      lastKfType = 'tab_switch';
      previousAction = 'tab_switch';
    }

    // ── 6. Form interactions ──────────────────────────────────────────────────
    if (
      isIncrementalOf(event, IncrementalSource.MouseInteraction) &&
      event.data?.type === MouseInteractionType.Focus
    ) {
      const elementId = String(event.data?.id ?? 'unknown');
      keyframes.push({
        keyframe_id: makeId('kf', kfIndex++),
        type: 'form_interaction',
        timestamp: ts,
        elapsed_seconds: elapsed,
        duration_at_state_seconds: null,
        page_url: currentUrl,
        interaction: {
          element_id: elementId,
          interaction_type: 'focus',
          previous_action: previousAction,
          next_action: null,
        },
      });
      lastKfType = 'form_interaction';
      previousAction = 'form_interaction';

      // Mark checkout as progressed if interacting with form on checkout page
      if (onCheckout) checkoutProgressed = true;
    }

    // ── 7. Custom ecommerce events from Adray pixel ───────────────────────────
    if (event.type === RRWebEventType.Custom) {
      const tag = event.data?.tag;
      const payload = event.data?.payload ?? {};

      if (tag === 'add_to_cart') {
        keyframes.push({
          keyframe_id: makeId('kf', kfIndex++),
          type: 'add_to_cart',
          timestamp: ts,
          elapsed_seconds: elapsed,
          duration_at_state_seconds: null,
          page_url: currentUrl,
          interaction: {
            product_id: payload.product_id,
            product_name: payload.product_name,
            price: payload.price,
            quantity: payload.quantity,
            cart_value: payload.cart_value,
            previous_action: previousAction,
            next_action: null,
          },
        });
        lastKfType = 'add_to_cart';
        previousAction = 'add_to_cart';
      }

      if (tag === 'remove_from_cart') {
        keyframes.push({
          keyframe_id: makeId('kf', kfIndex++),
          type: 'cart_modification',
          timestamp: ts,
          elapsed_seconds: elapsed,
          duration_at_state_seconds: null,
          page_url: currentUrl,
          interaction: {
            modification_type: 'remove',
            product_id: payload.product_id,
            cart_value: payload.cart_value,
            previous_action: previousAction,
            next_action: null,
          },
        });
        lastKfType = 'cart_modification';
        previousAction = 'cart_modification';
      }

      if (tag === 'purchase') {
        // Mark checkout as progressed
        if (onCheckout) checkoutProgressed = true;

        keyframes.push({
          keyframe_id: makeId('kf', kfIndex++),
          type: 'purchase',
          timestamp: ts,
          elapsed_seconds: elapsed,
          duration_at_state_seconds: null,
          page_url: currentUrl,
          interaction: {
            order_id: payload.order_id,
            order_value: payload.order_value,
            currency: payload.currency,
            item_count: payload.items?.length ?? null,
            previous_action: previousAction,
            next_action: null,
          },
        });
        lastKfType = 'purchase';
        previousAction = 'purchase';
      }
    }
  }

  // ── 8. Session end ────────────────────────────────────────────────────────
  const lastEvent = events[events.length - 1];
  if (lastEvent) {
    const lastTs      = lastEvent.timestamp;
    const lastElapsed = Math.round((lastTs - startTs) / 1000);
    const isTimeout   = (lastTs - startTs) >= SESSION_TIMEOUT_MS;

    keyframes.push({
      keyframe_id: makeId('kf', kfIndex++),
      type: 'session_end',
      timestamp: lastTs,
      elapsed_seconds: lastElapsed,
      duration_at_state_seconds: null,
      page_url: currentUrl,
      interaction: {
        end_reason: isTimeout ? 'timeout_30min' : 'page_unload',
        total_events: events.length,
        previous_action: previousAction,
        next_action: null,
      },
    });
  }

  // ── Backfill next_action ──────────────────────────────────────────────────
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (keyframes[i].interaction) {
      keyframes[i].interaction.next_action = keyframes[i + 1].type;
    }
  }

  return keyframes;
}

// ─── Scroll stop pre-scan ─────────────────────────────────────────────────────
/**
 * Pre-scans the event array to find moments where scroll velocity
 * drops to zero for >= SCROLL_STOP_MS.
 *
 * Returns a Map<timestamp → { durationSeconds, scrollDepthPercent, visibleArea }>
 * keyed on the timestamp of the scroll event that preceded the stop.
 */
function detectScrollStops(events) {
  const stops = new Map();
  const scrollEvents = events.filter(e => isIncrementalOf(e, IncrementalSource.Scroll));

  for (let i = 0; i < scrollEvents.length - 1; i++) {
    const curr = scrollEvents[i];
    const next = scrollEvents[i + 1];
    const gap  = next.timestamp - curr.timestamp;

    if (gap >= SCROLL_STOP_MS) {
      stops.set(curr.timestamp, {
        durationSeconds:    Math.round(gap / 1000),
        scrollDepthPercent: computeScrollDepth(curr.data),
        rawScrollData:      curr.data,
      });
    }
  }

  // Also catch a scroll stop at the very end of the session
  if (scrollEvents.length > 0) {
    const last       = scrollEvents[scrollEvents.length - 1];
    const lastEvent  = events[events.length - 1];
    const trailingGap = lastEvent.timestamp - last.timestamp;
    if (trailingGap >= SCROLL_STOP_MS) {
      stops.set(last.timestamp, {
        durationSeconds:    Math.round(trailingGap / 1000),
        scrollDepthPercent: computeScrollDepth(last.data),
        rawScrollData:      last.data,
      });
    }
  }

  return stops;
}

// ─── DOM utilities ────────────────────────────────────────────────────────────

/**
 * Computes scroll depth as a percentage of the total page height.
 * rrweb scroll events carry { id, x, y } where id is the scrolled element.
 * For the root document scroll (id === 1 or id matches <html>/<body>),
 * y is the scrollTop value.
 *
 * Approximation: we compare y against the last known full-snapshot height.
 * In production, pass the page height from the merchant's DOM snapshot.
 */
function computeScrollDepth(scrollData, pageHeight = 3000) {
  if (!scrollData) return 0;
  const scrollTop = scrollData.y ?? 0;
  return Math.min(100, Math.round((scrollTop / pageHeight) * 100));
}

/**
 * Determines which (if any) product element is under the cursor.
 * productIndex maps elementId → { id, name, price, bbox: { x, y, w, h } }
 *
 * In production, the pixel sends product bounding box data as custom events
 * when product elements enter the viewport (IntersectionObserver).
 */
function hitTestProducts(x, y, productIndex) {
  for (const [elementId, product] of Object.entries(productIndex)) {
    const { bbox } = product;
    if (!bbox) continue;
    if (x >= bbox.x && x <= bbox.x + bbox.w && y >= bbox.y && y <= bbox.y + bbox.h) {
      return { elementId, product };
    }
  }
  return null;
}

/**
 * Builds the dom_context block for a scroll_stop keyframe.
 * In production this reads which products were in the viewport
 * at the time of the stop from the merchant's product index.
 */
function buildDomContext(scrollStop, productIndex) {
  const { scrollDepthPercent } = scrollStop;
  const visibleProducts = [];

  for (const [elementId, product] of Object.entries(productIndex)) {
    if (!product.bbox) continue;
    // Simple viewport approximation — products near the scroll position
    const viewportTop    = (scrollDepthPercent / 100) * 3000;  // approx
    const viewportBottom = viewportTop + 900;
    const productTop     = product.bbox.y;
    if (productTop >= viewportTop && productTop <= viewportBottom) {
      visibleProducts.push({
        id:       product.id,
        name:     product.name,
        price:    product.price,
        position: productTop < viewportTop + 400 ? 'above_fold' : 'mid_fold',
      });
    }
  }

  return {
    visible_products: visibleProducts,
    page_section:     null,  // enriched downstream from DOM snapshot context
    cta_visible:      null,  // enriched downstream
  };
}

module.exports = { extractKeyframes };
