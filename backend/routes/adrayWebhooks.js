const express = require('express');
const router = express.Router();
const prisma = require('../utils/prismaClient');
const redisClient = require('../utils/redisClient');
const eventBus = require('../utils/eventBus');
const verifyShopifyWebhookHmac = require('../middleware/verifyShopifyWebhookHmac');
const { hashPII } = require('../utils/encryption');
const { stitchAttribution } = require('../services/attributionStitching');
const { enrichOrderLineItems } = require('../services/shopifyEnrichment');
const { sendToAllPlatforms } = require('../services/capiFanout');
const { updateSnapshot } = require('../services/merchantSnapshot');

function parseFloatSafe(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function parseShopifyRefundAmount(payload = {}) {
  return parseFloatSafe(
    payload.current_total_price ? (Number(payload.total_price || 0) - Number(payload.current_total_price || 0)) :
    payload.total_refunded_set?.shop_money?.amount ||
    payload.total_refunded ||
    0
  );
}

function parseOrdersCount(payload = {}) {
  const value = Number(payload?.customer?.orders_count);
  return Number.isFinite(value) ? value : null;
}

async function resolveOrdersCountFallback({
  prismaClient,
  accountId,
  customerId,
  emailHash,
}) {
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

function parseChargebackFlag(payload = {}) {
  const status = String(payload.financial_status || '').toLowerCase();
  const cancelReason = String(payload.cancel_reason || '').toLowerCase();
  if (status.includes('chargeback')) return true;
  if (cancelReason.includes('chargeback')) return true;
  return false;
}

function normalizeShopifyCustomerId(payload = {}) {
  const id = payload?.customer?.id;
  if (!id) return null;
  const normalized = String(id).trim();
  return normalized || null;
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

function buildCheckoutAttributionSnapshot(payload = {}) {
  return {
    landing_site: payload.landing_site || null,
    referring_site: payload.referring_site || null,
    source_name: payload.source_name || null,
    currency: payload.currency || null,
    raw_source: 'webhook',
    collected_at: new Date().toISOString(),
  };
}

async function resolveCheckoutIdentityContext({ accountId, payload }) {
  const customerId = normalizeShopifyCustomerId(payload);
  const emailHash = hashPII(payload.email || payload.contact_email);
  const phoneHash = hashPII(payload.phone || payload.shipping_address?.phone || payload.billing_address?.phone);

  const identityOr = [];
  if (customerId) identityOr.push({ customerId });
  if (emailHash) identityOr.push({ emailHash });
  if (phoneHash) identityOr.push({ phoneHash });

  if (!identityOr.length) {
    return { userKey: null, sessionId: null };
  }

  const identity = await prisma.identityGraph.findFirst({
    where: {
      accountId,
      OR: identityOr,
    },
    select: {
      userKey: true,
      lastSeenAt: true,
    },
    orderBy: {
      lastSeenAt: 'desc',
    }
  });

  if (!identity?.userKey) {
    return { userKey: null, sessionId: null };
  }

  const recentSession = await prisma.session.findFirst({
    where: {
      accountId,
      userKey: identity.userKey,
    },
    select: {
      sessionId: true,
      lastEventAt: true,
    },
    orderBy: {
      lastEventAt: 'desc',
    }
  });

  return {
    userKey: identity.userKey,
    sessionId: recentSession?.sessionId || null,
  };
}

async function persistWebhookEvent(prismaClient, payload) {
  try {
    await prismaClient.event.create({ data: payload.enriched });
    return true;
  } catch (error1) {
    if (!error1 || error1.code !== 'P2022') throw error1;
  }

  try {
    await prismaClient.event.create({ data: payload.legacy });
    return true;
  } catch (error2) {
    if (!error2 || error2.code !== 'P2022') throw error2;
  }

  await prismaClient.event.create({ data: payload.minimal });
  return true;
}

// Apply HMAC verification to all routes in this file
// Note: Requires express.raw middleware to be mounted BEFORE this router
router.use(verifyShopifyWebhookHmac);

/**
 * Handle Order Creation
 * Note: Shopify sends shop domain in X-Shopify-Shop-Domain header
 * We use this as the accountId for Shopify stores (backward compatible)
 */
router.post('/orders-create', async (req, res) => {
  // For Shopify webhooks, shop domain = accountId (backward compatible)
  const accountId = req.get('X-Shopify-Shop-Domain');
  console.log(`\\n[AdRay Webhook] Received orders/create for account: ${accountId}`);

  // Always return 200 to Shopify immediately
  res.status(200).send('OK');

  if (!isAccountAllowed(accountId)) {
    console.info(`[AdRay Webhook] Ignored webhook for non-allowed account: ${accountId}`);
    return;
  }

  try {
    const payload = JSON.parse(req.body.toString('utf8'));
    const orderId = String(payload.id);
    console.log(`[AdRay Webhook] Processing orderId: ${orderId}`);

    // 0. Ensure Account exists in DB (auto-provision for Shopify)
    await prisma.account.upsert({
      where: { accountId },
      create: {
        accountId,
        domain: accountId,
        platform: 'SHOPIFY'
      },
      update: {} // No updates if exists
    });

    // 1. Idempotency Check
    const existingOrder = await prisma.order.findUnique({
      where: { orderId }
    });
    if (existingOrder) {
      console.log(`[AdRay Webhook] Order ${orderId} already processed, skipping.`);
      return;
    }

    // 2. Checkout Session Lookup
    const checkoutToken = payload.checkout_token;
    console.log(`[AdRay Webhook] Checkout Token: ${checkoutToken || 'None'}`);
    let checkoutMap = null;
    if (checkoutToken) {
      checkoutMap = await prisma.checkoutSessionMap.findUnique({
        where: { checkoutToken }
      });
    }

    // 3. Hash PII
    const emailHash = hashPII(payload.email || payload.contact_email);
    const phoneHash = hashPII(payload.phone || payload.shipping_address?.phone || payload.billing_address?.phone);

    // 4. Determine eventId for dedup (use from checkout session if available)
    const eventId = checkoutMap ? checkoutMap.eventId : require('crypto').randomUUID();

    // 5. Calculate totals properly
     const revenue = parseFloatSafe(payload.total_price || 0);
     const subtotal = parseFloatSafe(payload.subtotal_price || 0);
     const discountTotal = parseFloatSafe(payload.total_discounts || 0);
     const taxTotal = parseFloatSafe(payload.total_tax || 0);
     const shippingTotal = parseFloatSafe(
       payload.total_shipping_price_set?.shop_money?.amount || 0
    );
     const refundAmount = parseShopifyRefundAmount(payload);
     const ordersCount = parseOrdersCount(payload);
     const chargebackFlag = parseChargebackFlag(payload);
     const customerId = payload.customer?.id ? String(payload.customer.id) : null;
     const ordersCountResolved = ordersCount ?? await resolveOrdersCountFallback({
       prismaClient: prisma,
       accountId,
       customerId,
       emailHash,
     });

    // 6. Insert Order
    let order = await prisma.order.create({
      data: {
        orderId,
        orderNumber: String(payload.order_number),
        accountId,
        checkoutToken,
        userKey: checkoutMap ? checkoutMap.userKey : null,
        sessionId: checkoutMap ? checkoutMap.sessionId : null,
        customerId,
        emailHash,
        phoneHash,
        revenue,
        subtotal,
        discountTotal,
        shippingTotal,
        taxTotal,
        refundAmount,
        chargebackFlag,
        ordersCount: ordersCountResolved,
        currency: payload.currency,
        lineItems: payload.line_items || [],
        eventId,
        platformCreatedAt: new Date(payload.created_at)
      }
    });

    const webhookEventId = require('crypto').randomUUID();
    const webhookEventData = {
      eventId: webhookEventId,
      accountId,
      sessionId: checkoutMap?.sessionId || `webhook_${orderId}`,
      userKey: checkoutMap?.userKey || 'unknown',
      eventName: 'purchase',
      pageType: 'checkout',
      checkoutToken: checkoutToken || null,
      orderId,
      rawSource: 'webhook',
      matchType: checkoutMap?.sessionId ? 'deterministic' : 'probabilistic',
      confidenceScore: checkoutMap?.sessionId ? 1.0 : 0.7,
      revenue,
      currency: payload.currency || null,
      items: payload.line_items || [],
      rawPayload: payload,
      collectedAt: new Date(),
      browserReceivedAt: payload.created_at ? new Date(payload.created_at) : null,
      serverReceivedAt: new Date(),
    };

    await persistWebhookEvent(prisma, {
      enriched: webhookEventData,
      legacy: {
        eventId: webhookEventId,
        accountId,
        sessionId: webhookEventData.sessionId,
        userKey: webhookEventData.userKey,
        eventName: 'purchase',
        checkoutToken: checkoutToken || null,
        orderId,
        revenue,
        currency: payload.currency || null,
        items: payload.line_items || [],
        rawPayload: payload,
        browserReceivedAt: payload.created_at ? new Date(payload.created_at) : null,
        serverReceivedAt: new Date(),
      },
      minimal: {
        eventId: webhookEventId,
        accountId,
        sessionId: webhookEventData.sessionId,
        userKey: webhookEventData.userKey,
        eventName: 'purchase',
        rawPayload: payload,
        serverReceivedAt: new Date(),
      }
    });

    // Emit live event for dashboard after order/session context is known.
    const customerFirstName = payload.customer?.first_name || payload.billing_address?.first_name || null;
    const customerLastName  = payload.customer?.last_name  || payload.billing_address?.last_name  || null;
    const customerName = [customerFirstName, customerLastName].filter(Boolean).join(' ') || null;

    // Cache name so subsequent live events from this visitor can be labeled.
    if (customerName) {
      try {
        const identityCache = require('../utils/liveFeedIdentityCache');
        identityCache.cacheIdentity({
          userKey: checkoutMap?.userKey,
          sessionId: checkoutMap?.sessionId,
          customerName,
        });
      } catch (_) { /* non-fatal */ }
    }
    eventBus.emit('event', {
      type: 'WEBHOOK',
      accountId,
      shopId: accountId,
      sessionId: checkoutMap?.sessionId || null,
      userKey: checkoutMap?.userKey || null,
      eventId,
      payload: {
        eventType: 'orders/create',
        timestamp: new Date().toISOString(),
        orderId,
        checkoutToken: checkoutToken || null,
        revenue,
        currency: payload.currency || null,
      }
    });

    // 7. Async Follow-up Tasks (Fire and Forget)
    console.log(`[AdRay Webhook] Order ${orderId} saved to database. Starting async enrichment pipeline.`);
    setImmediate(async () => {
      try {
         // Stitch attribution
         console.log(`[AdRay Pipeline] Generating attribution logic...`);
         await stitchAttribution(order, checkoutMap);
         
         // Enrich line items
         console.log(`[AdRay Pipeline] Enriching variants...`);
         const enrichedLineItems = await enrichOrderLineItems(order.lineItems, accountId);
         
         // Update order with enriched items
         await prisma.order.update({
           where: { orderId },
           data: { lineItems: enrichedLineItems }
         });
         
         // Update the order object in memory before CAPI fanout
         order.lineItems = enrichedLineItems;

         // Send to CAPI
         console.log(`[AdRay Pipeline] Queuing CAPI events...`);
         await sendToAllPlatforms(orderId);

         // Update Merchant Snapshot
         console.log(`[AdRay Pipeline] Taking Merchant AI Snapshot...`);
         await updateSnapshot(accountId);

         console.log(`[AdRay Pipeline] Order ${orderId} processing completed successfully.`);
      } catch (err) {
         console.error(`[AdRay Pipeline] Async processing failed for order ${orderId}:`, err);
         await prisma.failedJob.create({
            data: {
              jobType: 'post_order_processing',
              payload: { orderId, accountId },
              error: err.message || String(err)
            }
         });
      }
    });

  } catch (error) {
    console.error('Error handling orders-create webhook:', error);
    // Write to failed jobs but never throw back to Shopify
    prisma.failedJob.create({
      data: {
        jobType: 'webhook_orders_create',
        payload: { accountId, topic: 'orders/create' },
        error: error.message || String(error)
      }
    }).catch(() => {});
  }
});

/**
 * Handle Order Updates (refunds, order count evolution, financial changes)
 */
router.post('/orders-updated', async (req, res) => {
  const accountId = req.get('X-Shopify-Shop-Domain');
  res.status(200).send('OK');

  try {
    const payload = JSON.parse(req.body.toString('utf8'));
    const orderId = String(payload.id || '').trim();
    if (!accountId || !orderId) return;

    const refundAmount = parseShopifyRefundAmount(payload);
    const ordersCount = parseOrdersCount(payload);
    const chargebackFlag = parseChargebackFlag(payload);
    const revenue = parseFloatSafe(payload.total_price || 0);
    const subtotal = parseFloatSafe(payload.subtotal_price || 0);
    const discountTotal = parseFloatSafe(payload.total_discounts || 0);
    const taxTotal = parseFloatSafe(payload.total_tax || 0);
    const shippingTotal = parseFloatSafe(payload.total_shipping_price_set?.shop_money?.amount || 0);

    const updateData = {
      revenue,
      subtotal,
      discountTotal,
      taxTotal,
      shippingTotal,
      refundAmount,
      chargebackFlag,
      lineItems: payload.line_items || [],
    };
    if (ordersCount !== null) {
      updateData.ordersCount = ordersCount;
    }

    await prisma.order.updateMany({
      where: { accountId, orderId },
      data: updateData,
    });

    setImmediate(async () => {
      try {
        await updateSnapshot(accountId);
      } catch (err) {
        console.error(`[AdRay Pipeline] Snapshot update failed for order update ${orderId}:`, err);
      }
    });
  } catch (error) {
    console.error('Error handling orders-updated webhook:', error);
  }
});

/**
 * Handle Checkout Creation
 */
router.post('/checkouts-create', async (req, res) => {
  const accountId = req.get('X-Shopify-Shop-Domain');
  res.status(200).send('OK');

  try {
    const payload = JSON.parse(req.body.toString('utf8'));
    const checkoutToken = payload.token;

    if (!checkoutToken) return;

    // Just store basic connection, /collect will enrich it if browser fired begin_checkout
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const eventId = require('crypto').randomUUID();
    const identityContext = await resolveCheckoutIdentityContext({ accountId, payload });
    const resolvedSessionId = identityContext.sessionId || null;
    const resolvedUserKey = identityContext.userKey || null;
    const attributionSnapshot = buildCheckoutAttributionSnapshot(payload);
    const existingMap = await prisma.checkoutSessionMap.findUnique({
      where: { checkoutToken },
      select: {
        sessionId: true,
        userKey: true,
      }
    });

    const finalSessionId = resolvedSessionId || existingMap?.sessionId || 'unknown';
    const finalUserKey = resolvedUserKey || existingMap?.userKey || 'unknown';

    await prisma.checkoutSessionMap.upsert({
      where: { checkoutToken },
      create: {
        checkoutToken,
        accountId,
        sessionId: finalSessionId,
        userKey: finalUserKey,
        attributionSnapshot,
        eventId,
        expiresAt
      },
      update: {
        sessionId: finalSessionId,
        userKey: finalUserKey,
        attributionSnapshot,
        expiresAt,
      }
    });

  } catch (error) {
    console.error('Error handling checkouts-create webhook:', error);
  }
});

module.exports = router;
