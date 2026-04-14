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

function getHeaderValue(req, headerNames = []) {
  for (const headerName of headerNames) {
    const raw = req?.headers?.[headerName];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (Array.isArray(raw) && raw.length) {
      const first = String(raw[0] || '').trim();
      if (first) return first;
    }
  }
  return '';
}

function normalizeClientIp(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  const first = raw.split(',')[0].trim();
  if (!first) return null;

  let normalized = first.replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice('::ffff:'.length);
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(normalized)) {
    normalized = normalized.replace(/:\d+$/, '');
  }

  return normalized || null;
}

function splitAndNormalizeClientIps(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];

  return raw
    .split(',')
    .map((part) => normalizeClientIp(part))
    .filter(Boolean);
}

function isPrivateOrLocalIp(ip) {
  const value = String(ip || '').trim().toLowerCase();
  if (!value) return true;

  if (value.includes(':')) {
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80');
  }

  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;

  return false;
}

function isLikelyCloudflareIp(ip) {
  const value = String(ip || '').trim();
  if (!value || value.includes(':')) return false;

  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 172 && b >= 64 && b <= 71) return true;
  if (a === 162 && b === 158) return true;
  if (a === 198 && b === 41) return true;
  if (a === 104 && b >= 16 && b <= 31) return true;
  if (a === 173 && b === 245) return true;
  if (a === 188 && b === 114) return true;
  if (a === 190 && b === 93) return true;
  if (a === 197 && b === 234) return true;

  return false;
}

function pickBestClientIp(candidates = []) {
  const normalized = Array.from(
    new Set(
      (Array.isArray(candidates) ? candidates : [candidates])
        .flatMap((candidate) => splitAndNormalizeClientIps(candidate))
        .filter(Boolean)
    )
  );

  if (!normalized.length) return null;

  const nonProxyPublic = normalized.find((ip) => !isPrivateOrLocalIp(ip) && !isLikelyCloudflareIp(ip));
  if (nonProxyPublic) return nonProxyPublic;

  const publicIp = normalized.find((ip) => !isPrivateOrLocalIp(ip));
  if (publicIp) return publicIp;

  return normalized[0] || null;
}

function resolveTrustedClientIp(req, payload = {}) {
  const candidates = [];

  ['cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'fastly-client-ip', 'x-client-ip', 'x-cluster-client-ip'].forEach((headerName) => {
    const value = getHeaderValue(req, [headerName]);
    if (value) candidates.push(value);
  });

  const xff = getHeaderValue(req, ['x-forwarded-for', 'x-original-forwarded-for', 'forwarded-for']);
  if (xff) candidates.push(xff);

  const forwarded = getHeaderValue(req, ['forwarded']);
  if (forwarded) {
    const forwardedMatches = String(forwarded)
      .split(',')
      .map((entry) => {
        const match = entry.match(/for="?([^;\s,"]+)"?/i);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    candidates.push(...forwardedMatches);
  }

  candidates.push(
    req?.ip,
    payload?.client_ip_address,
    payload?.client_ip,
    payload?.ip,
  );

  return pickBestClientIp(candidates);
}

function resolveRequestUserAgent(req, payload = {}) {
  const explicit = String(payload.user_agent || '').trim();
  if (explicit) return explicit;

  const fromHeader = getHeaderValue(req, ['user-agent']);
  return fromHeader || null;
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function isOrderReceivedUrl(value) {
  return /\/order-received(?:\/|\?|$)/i.test(String(value || ''));
}

function isAccountAllowed(accountId) {
  const allowed = parseAllowedAccountIds();
  if (!allowed) return true;
  const normalized = normalizeAccountId(accountId) || String(accountId || '').trim().toLowerCase();
  return normalized ? allowed.has(normalized) : false;
}

// Intercept GET requests from crawlers (like Meta) immediately
router.get('/', (req, res) => {
  return res.status(200).send('OK');
});

router.post('/', async (req, res) => {
  let step = 'init';
  try {
    step = 'parse_payload';
    const payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    const normalizedEventName = normalizeIncomingEventName(payload.event_name);
    // Support both account_id (new universal) and shop_id (legacy Shopify)
    const accountId = normalizeAccountId(payload.account_id || payload.shop_id);
    const platform = payload.platform || 'custom';
    const resolvedClientIp = resolveTrustedClientIp(req, payload);
    const resolvedUserAgent = resolveRequestUserAgent(req, payload);

    if (resolvedClientIp) {
      payload.ip = resolvedClientIp;
      payload.client_ip = resolvedClientIp;
      payload.client_ip_address = resolvedClientIp;
    }
    if (resolvedUserAgent && !payload.user_agent) {
      payload.user_agent = resolvedUserAgent;
    }
    if (!payload.user_data || typeof payload.user_data !== 'object' || Array.isArray(payload.user_data)) {
      payload.user_data = {};
    }
    if (resolvedClientIp && !payload.user_data.client_ip_address) {
      payload.user_data.client_ip_address = resolvedClientIp;
    }
    if (resolvedUserAgent && !payload.user_data.client_user_agent) {
      payload.user_data.client_user_agent = resolvedUserAgent;
    }
    if (payload.fbp && !payload.user_data.fbp) payload.user_data.fbp = payload.fbp;
    if (payload.fbc && !payload.user_data.fbc) payload.user_data.fbc = payload.fbc;
    if (payload.gclid && !payload.user_data.gclid) payload.user_data.gclid = payload.gclid;
    if (payload.wbraid && !payload.user_data.wbraid) payload.user_data.wbraid = payload.wbraid;
    if (payload.gbraid && !payload.user_data.gbraid) payload.user_data.gbraid = payload.gbraid;
    if (payload.msclkid && !payload.user_data.msclkid) payload.user_data.msclkid = payload.msclkid;
    if (payload.fbclid && !payload.user_data.fbclid) payload.user_data.fbclid = payload.fbclid;
    if (!payload.click_id) {
      payload.click_id = payload.gclid || payload.wbraid || payload.gbraid || payload.fbclid || payload.ttclid || payload.msclkid || payload.fbc || null;
    }

    const normalizedGa4Source = deriveGa4SessionSource(payload);
    if (!payload.ga4_session_source && normalizedGa4Source) {
      payload.ga4_session_source = normalizedGa4Source;
    }

    console.log(`\n[AdRay Collect] Received event '${normalizedEventName}' for account: ${accountId} (platform: ${platform})`);
    if (normalizedEventName === 'begin_checkout' || normalizedEventName === 'purchase') {
      console.log('[AdRay Collect][signal_context]', {
        accountId,
        eventName: normalizedEventName,
        rawSource: payload.raw_source || 'pixel',
        clientIp: resolvedClientIp || null,
        hasUserAgent: Boolean(resolvedUserAgent),
        hasFbp: Boolean(payload.fbp),
        hasFbc: Boolean(payload.fbc),
        hasFbclid: Boolean(payload.fbclid),
        hasGclid: Boolean(payload.gclid),
        hasTtclid: Boolean(payload.ttclid),
        hasUtmHistory: Boolean(payload.utm_session_history || payload.utm_browser_history),
      });
    }

    step = 'validate_account';
    if (!accountId) {
      console.warn('[AdRay Collect] Rejected: account_id is required');
      return res.status(400).json({ success: false, error: 'account_id is required' });
    }

    if (!isAccountAllowed(accountId)) {
      console.info(`[AdRay Collect] Ignored event for non-allowed account: ${accountId}`);
      return res.json({ success: true, ignored: true, reason: 'account_not_allowed', accountId });
    }

    if (normalizedEventName === 'begin_checkout' && isOrderReceivedUrl(payload.page_url)) {
      return res.json({ success: true, ignored: true, reason: 'begin_checkout_on_order_received' });
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
    const ipHash = resolvedClientIp ? hashPII(resolvedClientIp) : null;
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
    const ga4SessionSource = payload.ga4_session_source || deriveGa4SessionSource(payload);
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
        eventName: normalizedEventName,
        timestamp: new Date().toISOString(),
        pageUrl: payload.page_url,
        platform,
        rawSource: payload.raw_source || 'pixel',
        matchType: identity.matchType || null,
        confidenceScore: identity.confidenceScore,
        collectedAt: new Date().toISOString(),
        productId: payload.product_id || null,
        cartValue: parseOptionalNumber(payload.cart_value),
        checkoutToken: payload.checkout_token || null,
        orderId: payload.order_id || null,
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
        ttclid: payload.ttclid,
        fbp: payload.fbp || null,
        fbc: payload.fbc || null,
        utm_entry_url: payload.utm_entry_url || null,
        utm_session_history: payload.utm_session_history || null,
        utm_browser_history: payload.utm_browser_history || null,
        landing_page_url: payload.landing_page_url || null,
        client_ip_address: resolvedClientIp || null,
        user_agent: resolvedUserAgent || null,
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
      cartValue: parseOptionalNumber(payload.cart_value),
      checkoutToken: payload.checkout_token,
      orderId: payload.order_id,
      rawSource: payload.raw_source || 'pixel',
      matchType: identity.matchType || null,
      confidenceScore: identity.confidenceScore,
      ipHash,
      revenue: parseOptionalNumber(payload.revenue),
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
      eventName: normalizedEventName,
      pageType: payload.page_type,
      pageUrl: payload.page_url,
      productId: payload.product_id,
      variantId: payload.variant_id,
      cartId: payload.cart_id,
      cartValue: parseOptionalNumber(payload.cart_value),
      checkoutToken: payload.checkout_token,
      orderId: payload.order_id,
      revenue: parseOptionalNumber(payload.revenue),
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
      ...(payload.gclid ? { gclid: payload.gclid } : {}),
      ...(payload.ttclid ? { ttclid: payload.ttclid } : {}),
      ...(payload.fbp ? { fbp: payload.fbp } : {}),
      ...(payload.fbc ? { fbc: payload.fbc } : {}),
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
