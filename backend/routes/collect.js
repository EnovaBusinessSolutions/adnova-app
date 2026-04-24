const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const prisma = require('../utils/prismaClient');
const redisClient = require('../utils/redisClient');
const { resolveUserKey } = require('../services/identityResolution');
const eventBus = require('../utils/eventBus');
const { hashPII } = require('../utils/encryption');
const { forwardToStaging } = require('../utils/stagingForward');
const { classifyChannel, normalizeChannel } = require('../utils/channelClassifier');

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

function deriveGa4SessionSource(payload = {}) {
  const explicit = String(payload.ga4_session_source || '').trim();
  if (explicit) return explicit;

  const source = String(payload.utm_source || '').trim();
  const medium = String(payload.utm_medium || '').trim();
  if (source || medium) {
    return `${source || '(direct)'} / ${medium || '(none)'}`;
  }

  return null;
}

function normalizeIncomingEventName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'page_view';

  if (['added_to_cart', 'cart_add', 'addtocart'].includes(normalized)) return 'add_to_cart';
  if (['checkout_start', 'start_checkout'].includes(normalized)) return 'begin_checkout';
  if (['order_complete', 'order_completed'].includes(normalized)) return 'purchase';
  if (['user_login', 'login'].includes(normalized)) return 'user_logged_in';
  if (['user_logout', 'logout'].includes(normalized)) return 'user_logged_out';

  return normalized;
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

// 1x1 transparent GIF for pixel-image fallback responses.
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64'
);

function respondTransparentGif(res) {
  res.status(200);
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Length', TRANSPARENT_GIF.length);
  return res.end(TRANSPARENT_GIF);
}

// Expand compact keys emitted by the pixel's Image fallback path back into
// the full payload shape that the POST handler expects. Keep this mapping
// in sync with _adrayTryImagePixel() in public/adray-pixel.js.
function expandCompactPayload(compact = {}) {
  return {
    account_id: compact.a,
    session_id: compact.s,
    browser_id: compact.b,
    event_name: compact.e,
    captured_at: compact.t,
    timestamp: compact.t,
    seq: compact.q,
    page_url: compact.u,
    page_type: compact.pt,
    fbclid: compact.fb,
    gclid: compact.gc,
    ttclid: compact.tc,
    utm_source: compact.us,
    utm_medium: compact.um,
    utm_campaign: compact.uc,
    utm_term: compact.ut,
    utm_content: compact.uo,
    cart_value: compact.cv,
    order_id: compact.oi,
    checkout_token: compact.ck,
    revenue: compact.rv,
    currency: compact.cu,
    referrer: compact.r,
    platform: compact.pl,
    raw_source: 'pixel_image_fallback',
  };
}

function decodePixelImageParam(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    // base64url → base64.
    let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (b64.length % 4)) % 4;
    b64 = b64 + '='.repeat(padLen);
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const compact = JSON.parse(json);
    return compact && typeof compact === 'object' ? compact : null;
  } catch (_) {
    return null;
  }
}

// GET handler serves two purposes:
//  1) Crawler health-check (Meta, scanners) — plain "OK" response.
//  2) Pixel GIF fallback for ad-blocked clients — `?d=<base64url>` carries a
//     compact event payload and we respond with a 1×1 transparent GIF.
router.get('/', async (req, res) => {
  const raw = req.query && req.query.d;
  if (!raw) {
    return res.status(200).send('OK');
  }

  const compact = decodePixelImageParam(raw);
  if (!compact) {
    return respondTransparentGif(res);
  }

  // Reuse the POST handler by mutating req.body. Always respond with the GIF
  // first so the browser never sees a 5xx even if processing fails downstream.
  respondTransparentGif(res);

  req.body = expandCompactPayload(compact);
  // Detach processing — the response is already sent.
  setImmediate(() => {
    processCollectPayload(req)
      .catch((err) => {
        console.error('[AdRay Collect][image-fallback] processing error:', err?.message || err);
      });
  });
});

// Shared processor used by both POST /collect and the GET image-fallback path.
// When `res` is provided, responds with JSON. When `res` is null (detached
// processing from the image-fallback handler), returns a result object and
// lets errors bubble up to the caller.
async function processCollectPayload(req, res = null) {
  let step = 'init';
  try {
    step = 'parse_payload';
    const payload = req.body;
    const normalizedEventName = normalizeIncomingEventName(payload.event_name);
    // Support both account_id (new universal) and shop_id (legacy Shopify)
    const accountId = normalizeAccountId(payload.account_id || payload.shop_id);
    const platform = payload.platform || 'custom';
    console.log(`\n[AdRay Collect] Received event '${normalizedEventName}' for account: ${accountId} (platform: ${platform})`);

    step = 'validate_account';
    if (!accountId) {
      console.warn('[AdRay Collect] Rejected: account_id is required');
      if (res) return res.status(400).json({ success: false, error: 'account_id is required' });
      return { success: false, error: 'account_id is required' };
    }

    if (!isAccountAllowed(accountId)) {
      console.info(`[AdRay Collect] Ignored event for non-allowed account: ${accountId}`);
      const body = { success: true, ignored: true, reason: 'account_not_allowed', accountId };
      if (res) return res.json(body);
      return body;
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
    const ga4SessionSource = deriveGa4SessionSource(payload);
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
           const body = { success: true, event_id: payload.event_id, user_key: userKey, deduplicated: true };
           if (res) return res.json(body);
           return body;
        }
      } catch (redisErr) {
        // Redis is an optimization layer. Do not fail collection if it's unavailable.
        console.warn('[AdRay Collect] Redis dedup unavailable, continuing without dedup:', redisErr.message);
      }
    }

    const sessionId = payload.session_id || randomUUID();
    console.log(`[AdRay Collect] Session ID: ${sessionId}`);

    // Enrich with customer name: from payload if present, otherwise from cache.
    const identityCache = require('../utils/liveFeedIdentityCache');
    const inlineName = identityCache.cacheFromPayload({ userKey, sessionId, payload });
    const customerName = inlineName || identityCache.lookupCustomerName({ userKey, sessionId });

    // Classify the traffic channel at event time so the Live Feed can show
    // "Meta / Google / TikTok / Organic / Direct / Other" next to each row.
    const classified = classifyChannel({
      gclid:       payload.gclid,
      fbclid:      payload.fbclid || payload.fbc,
      ttclid:      payload.ttclid,
      utm_source:  payload.utm_source,
      utm_medium:  payload.utm_medium,
      referrer:    payload.referrer || payload.document_referrer,
    });
    const normalizedChannel = normalizeChannel(classified.channel);

    // Emit live event for Dashboard Feed after identity + session are resolved.
    eventBus.emit('event', {
      type: 'COLLECT',
      accountId,
      sessionId,
      userKey,
      eventId,
      customerName,
      payload: {
        eventName: normalizedEventName,
        timestamp: new Date().toISOString(),
        pageUrl: payload.page_url,
        platform,
        rawSource: payload.raw_source || 'pixel',
        matchType: identity.matchType || null,
        confidenceScore: identity.confidenceScore,
        collectedAt: new Date().toISOString(),
        productId: payload.product_id || null,
        cartValue: payload.cart_value ? parseFloat(payload.cart_value) : null,
        checkoutToken: payload.checkout_token || null,
        orderId: payload.order_id || null,
        customerName,
        // Attribution surface for the Live Feed:
        channel:         normalizedChannel,   // meta / google / tiktok / organic / other / direct
        channelRaw:      classified.channel,
        channelPlatform: classified.platform,
        channelSource:   classified.source,   // click_id / utm / referrer / none
        clickIdProvider: classified.clickIdProvider,
        utmCampaign:     payload.utm_campaign || null,
      }
    });

    // 4. Handle begin_checkout special case
    if (normalizedEventName === 'begin_checkout' && payload.checkout_token) {
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
      eventName: normalizedEventName,
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
      serverReceivedAt: new Date(),
      capturedAt: payload.captured_at ? new Date(payload.captured_at) : (payload.timestamp ? new Date(payload.timestamp) : new Date()),
      seq: Number.isFinite(Number(payload.seq)) ? Number(payload.seq) : null,
      postPurchase: Boolean(payload.post_purchase) === true,
    };

    const legacyEventData = {
      eventId,
      accountId,
      sessionId,
      userKey,
      eventName: normalizedEventName,
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
      eventName: normalizedEventName,
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
          eventName: normalizedEventName,
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
      ga4SessionSource,
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
      isFirstTouch: true,
      sessionEndAt: new Date()
    };

    const enrichedSessionUpdate = {
      lastEventAt: new Date(),
      sessionEndAt: new Date(),
      userKey, // update in case it was resolved differently
      ...(ipHash ? { ipHash } : {}),
      // Only merge utms if they exist in payload
      ...(payload.utm_source ? { utmSource: payload.utm_source } : {}),
      ...(payload.fbclid ? { fbclid: payload.fbclid } : {}),
      ...(ga4SessionSource ? { ga4SessionSource } : {})
    };

    // Clarity session linking: attach playback URL and Clarity session ID when available.
    const claritySessionId = String(payload.clarity_session_id || '').trim() || null;
    const clarityPlaybackUrl = String(payload.clarity_playback_url || '').trim() || null;
    if (claritySessionId) enrichedSessionCreate.claritySessionId = claritySessionId;
    if (clarityPlaybackUrl) enrichedSessionCreate.clarityPlaybackUrl = clarityPlaybackUrl;
    if (claritySessionId) enrichedSessionUpdate.claritySessionId = claritySessionId;
    if (clarityPlaybackUrl) enrichedSessionUpdate.clarityPlaybackUrl = clarityPlaybackUrl;

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
              ipHash: undefined,
              ga4SessionSource: undefined,
              sessionEndAt: undefined,
              claritySessionId: undefined,
              clarityPlaybackUrl: undefined,
            },
            update: {
              ...enrichedSessionUpdate,
              ipHash: undefined,
              ga4SessionSource: undefined,
              sessionEndAt: undefined,
              claritySessionId: undefined,
              clarityPlaybackUrl: undefined,
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

    const result = {
      success: true,
      event_id: eventId,
      user_key: userKey,
      event_persisted: eventPersisted,
      session_persisted: sessionPersisted,
      fallback_stored: fallbackStored
    };
    if (res) res.json(result);

    // Mirror to staging so both environments stay in sync (fire-and-forget).
    forwardToStaging('/collect', payload);

    return result;

  } catch (error) {
    console.error(`[AdRay Collect] Error at step '${step}':`, error);
    // Return non-5xx to avoid browser retry storms while we surface diagnostics.
    if (res) return res.status(200).json({ success: false, error: 'Collect processing failed', step });
    throw error;
  }
}

router.post('/', (req, res) => processCollectPayload(req, res));

module.exports = router;
