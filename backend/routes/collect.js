const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const prisma = require('../utils/prismaClient');
const redisClient = require('../utils/redisClient');
const { resolveUserKey } = require('../services/identityResolution');
const eventBus = require('../utils/eventBus');

router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    // Support both account_id (new universal) and shop_id (legacy Shopify)
    const accountId = payload.account_id || payload.shop_id;
    const platform = payload.platform || 'custom';
    console.log(`\n[AdRay Collect] Received event '${payload.event_name}' for account: ${accountId} (platform: ${platform})`);

    // Emit live event for Dashboard Feed
    eventBus.emit('event', {
       type: 'COLLECT',
       accountId: accountId,
       payload: {
          eventName: payload.event_name,
          timestamp: new Date(),
          pageUrl: payload.page_url,
          platform: platform
       }
    });

    if (!accountId) {
      console.warn('[AdRay Collect] Rejected: account_id is required');
      return res.status(400).json({ success: false, error: 'account_id is required' });
    }

    // 0. Ensure Account exists in DB (auto-provision for new accounts)
    const platformEnum = platform.toUpperCase();
    await prisma.account.upsert({
      where: { accountId },
      create: {
        accountId,
        domain: payload.page_url ? new URL(payload.page_url).hostname : accountId,
        platform: ['SHOPIFY', 'WOOCOMMERCE', 'MAGENTO', 'CUSTOM', 'OTHER'].includes(platformEnum) ? platformEnum : 'CUSTOM'
      },
      update: {} // No updates if exists
    });

    // 1. Identity Resolution (Reads/Sets Cookie)
    const cookieUserKey = req.cookies ? req.cookies._adray_uid : null;
    const identity = await resolveUserKey(accountId, cookieUserKey, payload, res);
    const userKey = identity.userKey;
    console.log(`[AdRay Collect] Resolved UserKey: ${userKey} (IsNew: ${identity.isNew}, Confidence: ${identity.confidenceScore})`);

    // 2. Generate Event ID
    const eventId = randomUUID();

    // 3. Deduplication Check (if Redis is available)
    if (redisClient) {
      const dedupKey = `adray:ev:${payload.event_id || eventId}`;
      const isNew = await redisClient.set(dedupKey, '1', 'EX', 86400, 'NX');
      if (!isNew) {
         console.log(`[AdRay Collect] Deduplicated event: ${payload.event_id}`);
         return res.json({ success: true, event_id: payload.event_id, user_key: userKey, deduplicated: true });
      }
    }

    const sessionId = payload.session_id || randomUUID();
    console.log(`[AdRay Collect] Session ID: ${sessionId}`);

    // 4. Handle begin_checkout special case
    if (payload.event_name === 'begin_checkout' && payload.checkout_token) {
      const attributionSnapshot = {
        utm_source: payload.utm_source,
        utm_medium: payload.utm_medium,
        utm_campaign: payload.utm_campaign,
        utm_content: payload.utm_content,
        utm_term: payload.utm_term,
        referrer: payload.referrer,
        fbclid: payload.fbclid,
        gclid: payload.gclid,
        ttclid: payload.ttclid
      };

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await prisma.checkoutSessionMap.upsert({
        where: { checkoutToken: payload.checkout_token },
        create: {
          checkoutToken: payload.checkout_token,
          accountId,
          sessionId,
          userKey,
          attributionSnapshot,
          eventId, // pre-assigned for dedup with order webhook
          expiresAt
        },
        update: {
          sessionId,
          userKey,
          attributionSnapshot,
          expiresAt
        }
      });
    }

    // 5. Write Event to DB
    await prisma.event.create({
      data: {
        eventId,
        accountId,
        sessionId,
        userKey,
        eventName: payload.event_name,
        pageType: payload.page_type,
        pageUrl: payload.page_url,
        productId: payload.product_id,
        variantId: payload.variant_id,
        cartId: payload.cart_id,
        cartValue: payload.cart_value ? parseFloat(payload.cart_value) : null,
        checkoutToken: payload.checkout_token,
        orderId: payload.order_id,
        revenue: payload.revenue ? parseFloat(payload.revenue) : null,
        currency: payload.currency,
        items: payload.items || null,
        rawPayload: payload,
        browserReceivedAt: payload.timestamp ? new Date(payload.timestamp) : null,
        serverReceivedAt: new Date()
      }
    });

    // 6. Upsert Session
    await prisma.session.upsert({
      where: { sessionId },
      create: {
        sessionId,
        accountId,
        userKey,
        utmSource: payload.utm_source,
        utmMedium: payload.utm_medium,
        utmCampaign: payload.utm_campaign,
        utmContent: payload.utm_content,
        utmTerm: payload.utm_term,
        referrer: payload.referrer,
        landingPageUrl: payload.landing_page_url,
        fbclid: payload.fbclid,
        gclid: payload.gclid,
        ttclid: payload.ttclid,
        fbp: payload.fbp,
        fbc: payload.fbc,
        isFirstTouch: true
      },
      update: {
        lastEventAt: new Date(),
        userKey, // update in case it was resolved differently
        // Only merge utms if they exist in payload
        ...(payload.utm_source ? { utmSource: payload.utm_source } : {}),
        ...(payload.fbclid ? { fbclid: payload.fbclid } : {})
      }
    });

    res.json({ success: true, event_id: eventId, user_key: userKey });

  } catch (error) {
    console.error('Error in /collect:', error);
    // Still return 200/success-ish to client so pixel doesn't retry infinitely
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
