const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const prisma = require('../utils/prismaClient');
const redisClient = require('../utils/redisClient');
const { resolveUserKey } = require('../services/identityResolution');
const eventBus = require('../utils/eventBus');
const { hashPII } = require('../utils/encryption');

function isSchemaDriftError(error) {
  if (!error) return false;
  if (error.code === 'P2022') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('column') && msg.includes('does not exist');
}

async function persistEventWithFallback(prismaClient, payload) {
  // 1) Preferred write with enriched fields.
  try {
    await prismaClient.event.create({ data: payload.enriched });
    return true;
  } catch (error1) {
    if (!isSchemaDriftError(error1)) throw error1;
  }

  // 2) Legacy-compatible write.
  try {
    await prismaClient.event.create({ data: payload.legacy });
    return true;
  } catch (error2) {
    if (!isSchemaDriftError(error2)) throw error2;
  }

  // 3) Minimal write for heavily drifted schemas.
  await prismaClient.event.create({ data: payload.minimal });
  return true;
}

async function persistCollectFailure(prismaClient, params) {
  try {
    await prismaClient.failedJob.create({
      data: {
        jobType: params.jobType,
        payload: params.payload,
        error: params.error,
      }
    });
    return true;
  } catch (failedJobError) {
    console.error('[AdRay Collect] Failed to persist collect failure:', failedJobError?.message || failedJobError);
    return false;
  }
}

function safeHostname(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value).hostname;
  } catch (_) {
    return null;
  }
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

router.post('/', async (req, res) => {
  let step = 'init';
  try {
    step = 'parse_payload';
    const payload = req.body;
    // Support both account_id (new universal) and shop_id (legacy Shopify)
    const accountId = normalizeAccountId(payload.account_id || payload.shop_id);
    const platform = payload.platform || 'custom';
    console.log(`\n[AdRay Collect] Received event '${payload.event_name}' for account: ${accountId} (platform: ${platform})`);

    step = 'validate_account';
    if (!accountId) {
      console.warn('[AdRay Collect] Rejected: account_id is required');
      return res.status(400).json({ success: false, error: 'account_id is required' });
    }

    // 0. Ensure Account exists in DB (auto-provision for new accounts)
    step = 'account_upsert';
    const platformEnum = platform.toUpperCase();
    await prisma.account.upsert({
      where: { accountId },
      create: {
        accountId,
        domain: safeHostname(payload.page_url) || accountId,
        platform: ['SHOPIFY', 'WOOCOMMERCE', 'MAGENTO', 'CUSTOM', 'OTHER'].includes(platformEnum) ? platformEnum : 'CUSTOM'
      },
      update: {} // No updates if exists
    });

    // 1. Identity Resolution (Reads/Sets Cookie)
    step = 'identity_resolution';
    if (!payload.ip) payload.ip = req.ip;
    const ipHash = payload.ip ? hashPII(payload.ip) : null;
    const cookieUserKey = req.cookies ? req.cookies._adray_uid : null;
    let identity;
    try {
      identity = await resolveUserKey(accountId, cookieUserKey, payload, res);
    } catch (identityError) {
      console.error('[AdRay Collect] Identity resolution fallback:', identityError?.message || identityError);
      identity = {
        userKey: cookieUserKey || randomUUID(),
        isNew: false,
        confidenceScore: 0,
        matchType: 'probabilistic'
      };
    }
    const userKey = identity.userKey;
    console.log(`[AdRay Collect] Resolved UserKey: ${userKey} (IsNew: ${identity.isNew}, Confidence: ${identity.confidenceScore})`);

    // 2. Generate Event ID
    step = 'event_id_generation';
    const eventId = randomUUID();

    // 3. Deduplication Check (if Redis is available)
    if (redisClient) {
      step = 'redis_dedup';
      try {
        const dedupKey = `adray:ev:${payload.event_id || eventId}`;
        const isNew = await redisClient.set(dedupKey, '1', 'EX', 86400, 'NX');
        if (!isNew) {
           console.log(`[AdRay Collect] Deduplicated event: ${payload.event_id}`);
           return res.json({ success: true, event_id: payload.event_id, user_key: userKey, deduplicated: true });
        }
      } catch (redisErr) {
        // Redis is an optimization layer. Do not fail collection if it's unavailable.
        console.warn('[AdRay Collect] Redis dedup unavailable, continuing without dedup:', redisErr.message);
      }
    }

    const sessionId = payload.session_id || randomUUID();
    console.log(`[AdRay Collect] Session ID: ${sessionId}`);

    // Emit live event for Dashboard Feed after identity + session are resolved.
    eventBus.emit('event', {
      type: 'COLLECT',
      accountId,
      sessionId,
      userKey,
      eventId,
      payload: {
        eventName: payload.event_name,
        timestamp: new Date().toISOString(),
        pageUrl: payload.page_url,
        platform,
        productId: payload.product_id || null,
        cartValue: payload.cart_value ? parseFloat(payload.cart_value) : null,
        checkoutToken: payload.checkout_token || null,
        orderId: payload.order_id || null,
      }
    });

    // 4. Handle begin_checkout special case
    if (payload.event_name === 'begin_checkout' && payload.checkout_token) {
      step = 'checkout_map_upsert';
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
    step = 'event_insert';
    const enrichedEventData = {
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
      rawSource: payload.raw_source || 'pixel',
      matchType: identity.matchType || null,
      confidenceScore: identity.confidenceScore,
      ipHash,
      revenue: payload.revenue ? parseFloat(payload.revenue) : null,
      currency: payload.currency,
      items: payload.items || null,
      rawPayload: payload,
      collectedAt: new Date(),
      browserReceivedAt: payload.timestamp ? new Date(payload.timestamp) : null,
      serverReceivedAt: new Date()
    };

    const legacyEventData = {
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
    };

    const minimalEventData = {
      eventId,
      accountId,
      sessionId,
      userKey,
      eventName: payload.event_name,
      rawPayload: payload,
      serverReceivedAt: new Date()
    };

    let eventPersisted = false;
    let fallbackStored = false;
    try {
      eventPersisted = await persistEventWithFallback(prisma, {
        enriched: enrichedEventData,
        legacy: legacyEventData,
        minimal: minimalEventData
      });
    } catch (eventPersistError) {
      // Do not fail collect response; realtime feed is already emitted.
      console.error('[AdRay Collect] Event persistence non-fatal error:', eventPersistError?.message || eventPersistError);
      eventPersisted = false;
      fallbackStored = await persistCollectFailure(prisma, {
        jobType: 'collect_event_persist',
        payload: {
          accountId,
          sessionId,
          userKey,
          eventId,
          eventName: payload.event_name,
          collectPayload: payload,
        },
        error: String(eventPersistError?.message || eventPersistError || 'event persistence failed').slice(0, 1000)
      });
    }

    // 6. Upsert Session
    step = 'session_upsert';
    const enrichedSessionCreate = {
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
      ipHash,
      fbclid: payload.fbclid,
      gclid: payload.gclid,
      ttclid: payload.ttclid,
      fbp: payload.fbp,
      fbc: payload.fbc,
      isFirstTouch: true
    };

    const enrichedSessionUpdate = {
      lastEventAt: new Date(),
      userKey, // update in case it was resolved differently
      ...(ipHash ? { ipHash } : {}),
      // Only merge utms if they exist in payload
      ...(payload.utm_source ? { utmSource: payload.utm_source } : {}),
      ...(payload.fbclid ? { fbclid: payload.fbclid } : {})
    };

    let sessionPersisted = false;
    try {
      await prisma.session.upsert({
        where: { sessionId },
        create: enrichedSessionCreate,
        update: enrichedSessionUpdate
      });
      sessionPersisted = true;
    } catch (sessionUpsertError) {
      if (!isSchemaDriftError(sessionUpsertError)) {
        console.error('[AdRay Collect] Session upsert non-fatal error:', sessionUpsertError?.message || sessionUpsertError);
        fallbackStored = await persistCollectFailure(prisma, {
          jobType: 'collect_session_persist',
          payload: {
            accountId,
            sessionId,
            userKey,
            collectPayload: payload,
          },
          error: String(sessionUpsertError?.message || sessionUpsertError || 'session persistence failed').slice(0, 1000)
        }) || fallbackStored;
      } else {
        try {
          await prisma.session.upsert({
            where: { sessionId },
            create: {
              ...enrichedSessionCreate,
              ipHash: undefined
            },
            update: {
              ...enrichedSessionUpdate,
              ipHash: undefined
            }
          });
          sessionPersisted = true;
        } catch (sessionFallbackError) {
          console.error('[AdRay Collect] Session fallback non-fatal error:', sessionFallbackError?.message || sessionFallbackError);
          fallbackStored = await persistCollectFailure(prisma, {
            jobType: 'collect_session_fallback_persist',
            payload: {
              accountId,
              sessionId,
              userKey,
              collectPayload: payload,
            },
            error: String(sessionFallbackError?.message || sessionFallbackError || 'session fallback persistence failed').slice(0, 1000)
          }) || fallbackStored;
        }
      }
    }

    res.json({
      success: true,
      event_id: eventId,
      user_key: userKey,
      event_persisted: eventPersisted,
      session_persisted: sessionPersisted,
      fallback_stored: fallbackStored
    });

  } catch (error) {
    console.error(`[AdRay Collect] Error at step '${step}':`, error);
    // Return non-5xx to avoid browser retry storms while we surface diagnostics.
    res.status(200).json({ success: false, error: 'Collect processing failed', step });
  }
});

module.exports = router;
