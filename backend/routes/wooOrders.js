const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const prisma = require('../utils/prismaClient');
const { sendToAllPlatforms } = require('../services/capiFanout');
const { hashPII } = require('../utils/encryption');
const eventBus = require('../utils/eventBus');
const { forwardToStaging } = require('../utils/stagingForward');

function isSchemaDriftError(error) {
  if (!error) return false;
  if (error.code === 'P2022') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('column') && msg.includes('does not exist');
}

function normalizeAccountId(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
    return host.replace(/^www\./, '');
  } catch (_) {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function parseAllowedAccountIds() {
  const raw = String(process.env.ADRAY_ALLOWED_ACCOUNT_IDS || '').trim();
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((item) => normalizeAccountId(item) || String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return values.length ? new Set(values) : null;
}

function isAccountAllowed(accountId) {
  const allowed = parseAllowedAccountIds();
  if (!allowed) return true;
  const normalized = normalizeAccountId(accountId) || String(accountId || '').trim().toLowerCase();
  return normalized ? allowed.has(normalized) : false;
}

function normalizeWooChannel(payload = {}) {
  const utmSource = String(payload.utm_source || '').trim().toLowerCase();
  const utmMedium = String(payload.utm_medium || '').trim().toLowerCase();
  const wooSourceLabel = String(payload.woo_source_label || '').trim().toLowerCase();
  const wooSourceType = String(payload.woo_source_type || '').trim().toLowerCase();

  const isPaidGoogle = utmMedium === 'cpc' || utmMedium === 'paid_search' || payload.gclid || wooSourceLabel.includes('cpc') || wooSourceLabel.includes('ads');

  if (utmSource === 'google') return isPaidGoogle ? 'google' : 'organic';
  if (utmSource === 'facebook' || utmSource === 'instagram') return 'meta';
  if (utmSource === 'tiktok') return 'tiktok';
  if (utmSource === 'yahoo' || utmSource === 'bing') return 'other';

  if (utmMedium === 'paid_search') return 'google';
  if (utmMedium === 'organic') return 'organic';
  if (utmMedium === 'paid_social') {
    if (utmSource === 'tiktok') return 'tiktok';
    return 'meta';
  }

  if (wooSourceLabel.includes('google')) {
    return isPaidGoogle ? 'google' : 'organic';
  }
  if (wooSourceLabel.includes('yahoo') || wooSourceLabel.includes('bing') || wooSourceLabel.includes('referido')) {
    return 'other';
  }
  if (wooSourceLabel.includes('facebook') || wooSourceLabel.includes('instagram')) {
    return 'meta';
  }
  if (wooSourceLabel.includes('tiktok')) {
    return 'tiktok';
  }
  if (wooSourceLabel.includes('directo') || wooSourceType === 'direct') {
    return 'unattributed';
  }

  return 'unattributed';
}

function parseFloatSafe(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIntSafe(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function parseBooleanSafe(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return false;
}

function hasExplicitTimezone(value) {
  return /([zZ]|[+\-]\d{2}:\d{2})$/.test(String(value || '').trim());
}

function parseWooDateValue(rawValue, offsetSeconds = null) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');

  if (hasExplicitTimezone(normalized)) {
    const direct = new Date(normalized);
    return Number.isNaN(direct.getTime()) ? null : direct;
  }

  // When Woo sends a naive datetime, use its offset if available instead of server timezone.
  const parts = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (parts) {
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = Number(parts[6] || 0);

    if (Number.isFinite(offsetSeconds)) {
      const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - (Number(offsetSeconds) * 1000);
      const reconstructed = new Date(utcMs);
      return Number.isNaN(reconstructed.getTime()) ? null : reconstructed;
    }
  }

  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseWooOrderCreatedAt(payload = {}) {
  const offsetSeconds = Number(payload.created_at_offset_seconds);
  const safeOffsetSeconds = Number.isFinite(offsetSeconds) ? offsetSeconds : null;

  const gmtCandidate = parseWooDateValue(payload.created_at_gmt || payload.date_created_gmt || null, 0);
  if (gmtCandidate) return gmtCandidate;

  const localCandidate = parseWooDateValue(payload.created_at || payload.date_created || null, safeOffsetSeconds);
  if (localCandidate) return localCandidate;

  return new Date();
}

async function resolveOrdersCountFallback({ prismaClient, accountId, customerId, emailHash }) {
  const or = [];
  if (customerId) or.push({ customerId });
  if (emailHash) or.push({ emailHash });
  if (!or.length) return null;

  const historicalCount = await prismaClient.order.count({
    where: {
      accountId,
      OR: or,
    }
  });

  return historicalCount + 1;
}

async function persistWooEvent(prismaClient, payload) {
  try {
    await prismaClient.event.create({ data: payload.enriched });
    return true;
  } catch (error1) {
    if (!isSchemaDriftError(error1)) throw error1;
  }

  try {
    await prismaClient.event.create({ data: payload.legacy });
    return true;
  } catch (error2) {
    if (!isSchemaDriftError(error2)) throw error2;
  }

  await prismaClient.event.create({ data: payload.minimal });
  return true;
}

function normalizeCustomerDisplayName(...values) {
  const invalidTokens = new Set(['unknown', 'undefined', 'null', 'n/a', 'none', '-']);

  for (const value of values) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    if (invalidTokens.has(normalized.toLowerCase())) continue;
    if (/^\d+$/.test(normalized)) continue;
    return normalized;
  }

  return null;
}

router.post('/woo/orders-sync', async (req, res) => {
  let step = 'init';
  try {
    const payload = req.body || {};
    const accountId = normalizeAccountId(payload.account_id);
    const orderId = String(payload.order_id || '').trim();

    if (!accountId || !orderId) {
      return res.status(400).json({ success: false, error: 'account_id and order_id are required' });
    }

    if (!isAccountAllowed(accountId)) {
      return res.json({ success: true, ignored: true, reason: 'account_not_allowed', accountId, orderId });
    }

    step = 'account_upsert';
    await prisma.account.upsert({
      where: { accountId },
      create: {
        accountId,
        domain: accountId,
        platform: 'WOOCOMMERCE',
      },
      update: {},
    });

    step = 'checkout_lookup';
    const checkoutToken = payload.checkout_token ? String(payload.checkout_token) : null;
    const checkoutMap = checkoutToken
      ? await prisma.checkoutSessionMap.findUnique({ where: { checkoutToken } })
      : null;

    const attributedChannel = normalizeWooChannel(payload);
    const customerDisplayName = normalizeCustomerDisplayName(
      payload.customer_name,
      [payload.customer_first_name, payload.customer_last_name].filter(Boolean).join(' '),
      payload.billing_company
    );

    const emailHash = typeof hashPII === 'function' ? hashPII(payload.customer_email) : null;
    const phoneHash = typeof hashPII === 'function' ? hashPII(payload.customer_phone) : null;

    const attributionSnapshot = {
      utm_source: payload.utm_source || null,
      utm_medium: payload.utm_medium || null,
      utm_campaign: payload.utm_campaign || null,
      utm_content: payload.utm_content || null,
      utm_term: payload.utm_term || null,
      referrer: payload.referrer || null,
      gclid: payload.gclid || null,
      fbclid: payload.fbclid || null,
      ttclid: payload.ttclid || null,
      woo_source_label: payload.woo_source_label || null,
      woo_source_type: payload.woo_source_type || null,
      woo_session_source: payload.woo_session_source || null,
      raw_source: payload.raw_source || null,
      collected_at: payload.collected_at || null,
      customer_name: customerDisplayName,
      customer_first_name: payload.customer_first_name || null,
      customer_last_name: payload.customer_last_name || null,
      billing_company: payload.billing_company || null,
    };

    const customerId = payload.customer_id ? String(payload.customer_id) : null;
    const incomingOrdersCount = parseIntSafe(payload.orders_count);
    const resolvedOrdersCount = incomingOrdersCount ?? await resolveOrdersCountFallback({
      prismaClient: prisma,
      accountId,
      customerId,
      emailHash,
    });

    const orderData = {
      orderNumber: String(payload.order_number || payload.order_id),
      accountId,
      checkoutToken,
      userKey: payload.user_key || (checkoutMap ? checkoutMap.userKey : null),
      sessionId: payload.session_id || (checkoutMap ? checkoutMap.sessionId : null),
      customerId,
      emailHash,
      phoneHash,
      revenue: parseFloatSafe(payload.revenue),
      subtotal: parseFloatSafe(payload.subtotal),
      discountTotal: parseFloatSafe(payload.discount_total),
      shippingTotal: parseFloatSafe(payload.shipping_total),
      taxTotal: parseFloatSafe(payload.tax_total),
      refundAmount: parseFloatSafe(payload.refund_amount),
      chargebackFlag: parseBooleanSafe(payload.chargeback_flag),
      ordersCount: resolvedOrdersCount,
      currency: String(payload.currency || 'MXN'),
      lineItems: Array.isArray(payload.items) ? payload.items : [],
      attributedChannel,
      attributedCampaign: payload.utm_campaign || null,
      attributedAdset: payload.utm_content || null,
      attributedAd: payload.utm_term || null,
      attributedClickId: payload.gclid || payload.fbclid || payload.ttclid || null,
      attributionModel: attributedChannel === 'unattributed' ? 'woo_direct' : 'woo_fallback',
      attributionSnapshot,
      confidenceScore: attributedChannel === 'unattributed' ? 0.4 : 0.75,
      eventId: checkoutMap ? checkoutMap.eventId : randomUUID(),
      platformCreatedAt: parseWooOrderCreatedAt(payload),
    };

    step = 'order_upsert';
    let order;
    try {
      order = await prisma.order.upsert({
        where: { orderId },
        create: {
          orderId,
          ...orderData,
        },
        update: orderData,
      });
    } catch (orderUpsertError) {
      if (!isSchemaDriftError(orderUpsertError)) throw orderUpsertError;

      const fallbackOrderData = { ...orderData };
      delete fallbackOrderData.refundAmount;
      delete fallbackOrderData.chargebackFlag;
      delete fallbackOrderData.ordersCount;

      order = await prisma.order.upsert({
        where: { orderId },
        create: {
          orderId,
          ...fallbackOrderData,
        },
        update: fallbackOrderData,
      });
    }

    // Emit realtime dashboard signal for Woo sync events.
    // Skip emitting to the live dashboard if it's an old historic order from a backfill sync.
    const platformCreatedAtObj = order.platformCreatedAt ? new Date(order.platformCreatedAt).getTime() : new Date().getTime();
    const isRecentOrder = (new Date().getTime() - platformCreatedAtObj) < (1000 * 60 * 60 * 24); // 24 hours

    if (isRecentOrder) {
      const identityCache = require('../utils/liveFeedIdentityCache');
      const wooCustomerName = identityCache.extractCustomerName(payload) || identityCache.extractCustomerName(payload?.attribution_snapshot);
      if (wooCustomerName) {
        identityCache.cacheIdentity({
          userKey: order.userKey,
          sessionId: order.sessionId,
          customerName: wooCustomerName,
        });
      }

      eventBus.emit('event', {
        type: 'WEBHOOK',
        accountId,
        sessionId: order.sessionId || null,
        userKey: order.userKey || null,
        eventId: order.eventId || null,
        customerName: wooCustomerName,
        payload: {
          eventName: 'purchase',
          platform: 'woocommerce',
          orderId: order.orderId,
          revenue: order.revenue,
          currency: order.currency,
          customerName: wooCustomerName,
          rawSource: payload.raw_source || 'api',
          matchType: order.sessionId ? 'deterministic' : 'probabilistic',
          confidenceScore: Number(order.confidenceScore || 0),
          collectedAt: new Date().toISOString(),
          timestamp: order.platformCreatedAt ? new Date(order.platformCreatedAt).toISOString() : new Date().toISOString(),
          source: 'woo_orders_sync',
        }
      });
    }

    const rawSource = payload.raw_source || 'api';
    const matchType = order.sessionId ? 'deterministic' : 'probabilistic';
    const confidenceScore = Number(order.confidenceScore || 0);
    const persistedEventId = randomUUID();

    await persistWooEvent(prisma, {
      enriched: {
        eventId: persistedEventId,
        accountId,
        sessionId: order.sessionId || `woo_${order.orderId}`,
        userKey: order.userKey || 'unknown',
        eventName: 'purchase',
        pageType: 'checkout',
        checkoutToken: order.checkoutToken || null,
        orderId: order.orderId,
        rawSource,
        matchType,
        confidenceScore,
        revenue: order.revenue,
        currency: order.currency,
        items: Array.isArray(payload.items) ? payload.items : [],
        rawPayload: payload,
        collectedAt: new Date(),
        browserReceivedAt: payload.collected_at ? new Date(payload.collected_at) : null,
        serverReceivedAt: new Date(),
      },
      legacy: {
        eventId: persistedEventId,
        accountId,
        sessionId: order.sessionId || `woo_${order.orderId}`,
        userKey: order.userKey || 'unknown',
        eventName: 'purchase',
        checkoutToken: order.checkoutToken || null,
        orderId: order.orderId,
        revenue: order.revenue,
        currency: order.currency,
        items: Array.isArray(payload.items) ? payload.items : [],
        rawPayload: payload,
        browserReceivedAt: payload.collected_at ? new Date(payload.collected_at) : null,
        serverReceivedAt: new Date(),
      },
      minimal: {
        eventId: persistedEventId,
        accountId,
        sessionId: order.sessionId || `woo_${order.orderId}`,
        userKey: order.userKey || 'unknown',
        eventName: 'purchase',
        rawPayload: payload,
        serverReceivedAt: new Date(),
      }
    });

    // Fire-and-forget: keep sync endpoint fast while still pushing conversions.
    setImmediate(async () => {
      try {
        await sendToAllPlatforms(order.orderId);
      } catch (fanoutError) {
        console.error(`[Woo Orders Sync] CAPI fanout failed for ${order.orderId}:`, fanoutError?.message || fanoutError);
      }
    });

    res.json({ success: true, orderId: order.orderId, attributedChannel: order.attributedChannel });

    // Mirror to staging so both environments stay in sync (fire-and-forget).
    forwardToStaging('/api/woo/orders-sync', payload);

  } catch (error) {
    console.error(`[Woo Orders Sync] Error at step '${step}':`, error);
    res.status(500).json({ success: false, error: 'Internal Server Error', step });
  }
});

module.exports = router;