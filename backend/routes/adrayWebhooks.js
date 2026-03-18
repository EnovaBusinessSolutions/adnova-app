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

function parseChargebackFlag(payload = {}) {
  const status = String(payload.financial_status || '').toLowerCase();
  const cancelReason = String(payload.cancel_reason || '').toLowerCase();
  if (status.includes('chargeback')) return true;
  if (cancelReason.includes('chargeback')) return true;
  return false;
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

    // 6. Insert Order
    let order = await prisma.order.create({
      data: {
        orderId,
        orderNumber: String(payload.order_number),
        accountId,
        checkoutToken,
        userKey: checkoutMap ? checkoutMap.userKey : null,
        sessionId: checkoutMap ? checkoutMap.sessionId : null,
        customerId: payload.customer?.id ? String(payload.customer.id) : null,
        emailHash,
        phoneHash,
        revenue,
        subtotal,
        discountTotal,
        shippingTotal,
        taxTotal,
        refundAmount,
        chargebackFlag,
        ordersCount,
        currency: payload.currency,
        lineItems: payload.line_items || [],
        eventId,
        platformCreatedAt: new Date(payload.created_at)
      }
    });

    // Emit live event for dashboard after order/session context is known.
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

    await prisma.order.updateMany({
      where: { accountId, orderId },
      data: {
        revenue,
        subtotal,
        discountTotal,
        taxTotal,
        shippingTotal,
        refundAmount,
        chargebackFlag,
        ordersCount,
        lineItems: payload.line_items || [],
      }
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

    await prisma.checkoutSessionMap.upsert({
      where: { checkoutToken },
      create: {
        checkoutToken,
        accountId,
        sessionId: 'unknown',
        userKey: 'unknown',
        attributionSnapshot: {},
        eventId,
        expiresAt
      },
      update: {
        // Only update expiration if it already exists
        expiresAt
      }
    });

  } catch (error) {
    console.error('Error handling checkouts-create webhook:', error);
  }
});

module.exports = router;
