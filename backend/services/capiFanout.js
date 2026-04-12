const prisma = require('../utils/prismaClient');
const User = require('../models/User');
const GoogleAccount = require('../models/GoogleAccount');
const MetaAccount = require('../models/MetaAccount');
const McpData = require('../models/McpData');
const ShopConnections = require('../models/ShopConnections');
const PixelSelection = require('../models/PixelSelection');
const { decrypt } = require('../utils/encryption');
const {
  listAuthorizedAnalyticsShopsForUser,
  normalizeGoogleCustomerId,
  normalizeMetaAccountId,
  normalizeShopDomain,
} = require('./analyticsAccess');
const googleStack = require('./capiStack/google');
const metaStack = require('./capiStack/meta');

function isSchemaDriftError(error) {
  if (!error) return false;
  if (error.code === 'P2022') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('column') && msg.includes('does not exist');
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyEncryptedToken(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts.every((part) => /^[0-9a-fA-F]+$/.test(part));
}

function maybeDecryptToken(value) {
  const token = String(value || '').trim();
  if (!token) return null;
  if (!isLikelyEncryptedToken(token)) return token;
  return decrypt(token) || null;
}

function buildShopLookupCandidates(accountId) {
  const raw = String(accountId || '').trim();
  const normalized = normalizeShopDomain(raw);
  const values = new Set([raw, normalized].filter(Boolean));

  if (normalized) {
    values.add(`www.${normalized}`);
    values.add(`https://${normalized}`);
    values.add(`http://${normalized}`);
    values.add(`https://www.${normalized}`);
    values.add(`http://www.${normalized}`);
  }

  return Array.from(values).filter(Boolean);
}

function buildNormalizedShopCandidates(accountId) {
  return uniqueStrings(
    buildShopLookupCandidates(accountId)
      .map((value) => normalizeShopDomain(value))
      .filter(Boolean)
  );
}

function extractRootSourceShopCandidates(sources = {}) {
  const root = normalizeObject(sources);
  return uniqueStrings(
    [
      root?.metaAds?.name,
      root?.googleAds?.name,
      root?.ga4?.name,
      root?.shopify?.name,
      root?.shopify?.shop,
      root?.website?.name,
      root?.website?.domain,
      root?.store?.name,
      root?.store?.domain,
    ]
      .map((value) => normalizeShopDomain(value))
      .filter(Boolean)
  );
}

function extractOrderSignalPresence(order = {}) {
  const snapshot = normalizeObject(order?.attributionSnapshot);
  return {
    hasEmailHash: Boolean(order?.emailHash),
    hasPhoneHash: Boolean(order?.phoneHash),
    hasMetaClickId: Boolean(snapshot?.fbclid || snapshot?.fbc || snapshot?._fbc || order?.attributedClickId),
    hasGoogleClickId: Boolean(order?.gclid || order?.attributedClickId || snapshot?.gclid || snapshot?.click_id),
    attributedChannel: String(order?.attributedChannel || '').trim() || null,
    attributedPlatform: String(order?.attributedPlatform || '').trim() || null,
  };
}

function logFanout(orderId, platform, stage, details = {}) {
  const safeDetails = details && typeof details === 'object' ? details : { value: details };
  console.log(`[CAPI Fanout][${String(platform || 'platform').toUpperCase()}][${stage}]`, {
    orderId: String(orderId || '').trim() || null,
    ...safeDetails,
  });
}

async function resolveUserIdFromMcpRootByShop(accountId) {
  const normalizedShopCandidates = buildNormalizedShopCandidates(accountId);
  if (!McpData || !normalizedShopCandidates.length) return null;

  const patterns = normalizedShopCandidates.map((value) => new RegExp(escapeRegex(value), 'i'));
  const orClauses = [];
  patterns.forEach((pattern) => {
    orClauses.push({ 'sources.metaAds.name': pattern });
    orClauses.push({ 'sources.googleAds.name': pattern });
    orClauses.push({ 'sources.ga4.name': pattern });
    orClauses.push({ 'sources.shopify.name': pattern });
    orClauses.push({ 'sources.shopify.shop': pattern });
    orClauses.push({ 'sources.website.name': pattern });
    orClauses.push({ 'sources.website.domain': pattern });
    orClauses.push({ 'sources.store.name': pattern });
    orClauses.push({ 'sources.store.domain': pattern });
  });

  const docs = await McpData.find({
    kind: 'root',
    latestSnapshotId: { $ne: null },
    $or: orClauses,
  })
    .select('userId sources updatedAt createdAt')
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(25)
    .lean()
    .catch(() => []);

  for (const doc of docs) {
    const rootShops = extractRootSourceShopCandidates(doc?.sources);
    const matchedShop = rootShops.find((shop) => normalizedShopCandidates.includes(shop));
    if (doc?.userId && matchedShop) {
      return {
        userId: doc.userId,
        matchedShop,
      };
    }
  }

  return null;
}

async function resolveUserIdByAuthorizedShopScan(accountId) {
  const normalizedShopCandidates = buildNormalizedShopCandidates(accountId);
  if (!normalizedShopCandidates.length) return null;

  const [metaCandidates, googleCandidates] = await Promise.all([
    MetaAccount.find({})
      .select('user userId updatedAt')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean()
      .catch(() => []),
    GoogleAccount.find({})
      .select('user userId updatedAt')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean()
      .catch(() => []),
  ]);

  const candidateUserIds = uniqueStrings(
    [...metaCandidates, ...googleCandidates]
      .map((doc) => doc?.userId || doc?.user)
      .filter(Boolean)
  );

  for (const candidateUserId of candidateUserIds) {
    try {
      const access = await listAuthorizedAnalyticsShopsForUser(candidateUserId);
      const matchedShop = (Array.isArray(access?.shops) ? access.shops : [])
        .map((entry) => normalizeShopDomain(entry?.shop || ''))
        .find((shop) => normalizedShopCandidates.includes(shop));

      if (matchedShop) {
        return {
          userId: candidateUserId,
          matchedShop,
          defaultShop: normalizeShopDomain(access?.defaultShop || '') || null,
        };
      }
    } catch (_) {
      // best-effort fallback only
    }
  }

  return null;
}

async function maybePersistResolvedUserShop(user, matchedShop, resolutionSource, accountId) {
  const userId = user?._id ? String(user._id) : null;
  const normalizedMatchedShop = normalizeShopDomain(matchedShop || accountId || '');
  const currentShop = normalizeShopDomain(user?.shop || '');
  if (!userId || !normalizedMatchedShop || currentShop) return false;

  try {
    await User.updateOne(
      { _id: userId, $or: [{ shop: { $exists: false } }, { shop: null }, { shop: '' }] },
      { $set: { shop: normalizedMatchedShop } }
    );
    console.log('[CAPI Fanout][SHOP_BACKFILL]', {
      accountId: String(accountId || '').trim() || null,
      userId,
      matchedShop: normalizedMatchedShop,
      resolutionSource,
    });
    return true;
  } catch (error) {
    console.warn('[CAPI Fanout][SHOP_BACKFILL_FAILED]', {
      accountId: String(accountId || '').trim() || null,
      userId,
      matchedShop: normalizedMatchedShop,
      resolutionSource,
      reason: error?.message || String(error),
    });
    return false;
  }
}

async function resolveUserForAccountId(accountId) {
  const shopCandidates = buildShopLookupCandidates(accountId);
  const normalizedShopCandidates = buildNormalizedShopCandidates(accountId);

  if (ShopConnections && shopCandidates.length) {
    const shopConnection = await ShopConnections.findOne({
      shop: { $in: shopCandidates },
      matchedToUserId: { $ne: null },
    })
      .select('matchedToUserId shop')
      .lean()
      .catch(() => null);

    if (shopConnection?.matchedToUserId) {
      const matchedUser = await User.findById(shopConnection.matchedToUserId)
        .select('_id shop email')
        .lean()
        .catch(() => null);
      if (matchedUser?._id) {
        const resolvedUser = {
          ...matchedUser,
          resolutionSource: 'shop_connection',
          matchedShop: normalizeShopDomain(shopConnection?.shop || matchedUser?.shop || '') || null,
        };
        void maybePersistResolvedUserShop(
          matchedUser,
          resolvedUser.matchedShop,
          resolvedUser.resolutionSource,
          accountId
        );
        console.log('[CAPI Fanout][USER_RESOLUTION]', {
          accountId: String(accountId || '').trim() || null,
          userId: String(resolvedUser?._id || '') || null,
          resolutionSource: resolvedUser.resolutionSource,
          matchedShop: resolvedUser.matchedShop,
        });
        return resolvedUser;
      }
    }
  }

  const user = await User.findOne({
    $or: [
      { shop: { $in: shopCandidates } },
      { email: { $in: shopCandidates.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean) } },
    ],
  })
    .select('_id shop email')
    .lean()
    .catch(() => null);

  if (user?._id) {
    const resolvedUser = {
      ...user,
      resolutionSource: 'user_shop',
      matchedShop:
        normalizedShopCandidates.find((candidate) => candidate === normalizeShopDomain(user?.shop || ''))
        || normalizeShopDomain(user?.shop || '')
        || null,
    };
    void maybePersistResolvedUserShop(
      user,
      resolvedUser.matchedShop,
      resolvedUser.resolutionSource,
      accountId
    );
    console.log('[CAPI Fanout][USER_RESOLUTION]', {
      accountId: String(accountId || '').trim() || null,
      userId: String(resolvedUser?._id || '') || null,
      resolutionSource: resolvedUser.resolutionSource,
      matchedShop: resolvedUser.matchedShop,
    });
    return resolvedUser;
  }

  const rootMatch = await resolveUserIdFromMcpRootByShop(accountId);
  if (rootMatch?.userId) {
    const rootUser = await User.findById(rootMatch.userId)
      .select('_id shop email')
      .lean()
      .catch(() => null);

    if (rootUser?._id) {
      const resolvedUser = {
        ...rootUser,
        resolutionSource: 'mcp_root_shop',
        matchedShop: rootMatch.matchedShop || normalizeShopDomain(rootUser?.shop || '') || null,
      };
      void maybePersistResolvedUserShop(
        rootUser,
        resolvedUser.matchedShop,
        resolvedUser.resolutionSource,
        accountId
      );
      console.log('[CAPI Fanout][USER_RESOLUTION]', {
        accountId: String(accountId || '').trim() || null,
        userId: String(resolvedUser?._id || '') || null,
        resolutionSource: resolvedUser.resolutionSource,
        matchedShop: resolvedUser.matchedShop,
      });
      return resolvedUser;
    }

    const resolvedUser = {
      _id: rootMatch.userId,
      shop: rootMatch.matchedShop || null,
      email: null,
      resolutionSource: 'mcp_root_shop',
      matchedShop: rootMatch.matchedShop || null,
    };
    console.log('[CAPI Fanout][USER_RESOLUTION]', {
      accountId: String(accountId || '').trim() || null,
      userId: String(resolvedUser?._id || '') || null,
      resolutionSource: resolvedUser.resolutionSource,
      matchedShop: resolvedUser.matchedShop,
    });
    return resolvedUser;
  }

  const analyticsAuthorizedMatch = await resolveUserIdByAuthorizedShopScan(accountId);
  if (analyticsAuthorizedMatch?.userId) {
    const authorizedUser = await User.findById(analyticsAuthorizedMatch.userId)
      .select('_id shop email')
      .lean()
      .catch(() => null);

    if (authorizedUser?._id) {
      const resolvedUser = {
        ...authorizedUser,
        resolutionSource: 'authorized_shop_scan',
        matchedShop:
          analyticsAuthorizedMatch.matchedShop
          || analyticsAuthorizedMatch.defaultShop
          || normalizeShopDomain(authorizedUser?.shop || '')
          || null,
      };
      void maybePersistResolvedUserShop(
        authorizedUser,
        resolvedUser.matchedShop,
        resolvedUser.resolutionSource,
        accountId
      );
      console.log('[CAPI Fanout][USER_RESOLUTION]', {
        accountId: String(accountId || '').trim() || null,
        userId: String(resolvedUser?._id || '') || null,
        resolutionSource: resolvedUser.resolutionSource,
        matchedShop: resolvedUser.matchedShop,
      });
      return resolvedUser;
    }
  }

  console.log('[CAPI Fanout][USER_RESOLUTION]', {
    accountId: String(accountId || '').trim() || null,
    userId: null,
    resolutionSource: 'not_found',
    matchedShop: null,
  });
  return null;
}

async function findPixelSelectionByProvider({ provider, userId = null, metaField = '', normalizedAccountId = '' }) {
  if (userId) {
    const byUser = await PixelSelection.findOne({
      $or: [{ userId }, { user: userId }],
      provider,
    }).lean().catch(() => null);

    if (byUser?.selectedId) return byUser;
  }

  if (metaField && normalizedAccountId) {
    const byAccount = await PixelSelection.findOne({
      provider,
      [`meta.${metaField}`]: normalizedAccountId,
    }).lean().catch(() => null);

    if (byAccount?.selectedId) return byAccount;
  }

  return null;
}

async function ensurePlatformConnectionBackfill({
  orderId,
  accountId,
  platform,
  accessToken,
  pixelId = null,
  adAccountId = null,
  source = null,
}) {
  const normalizedPlatform = String(platform || '').trim().toUpperCase();
  const normalizedAccountId = String(accountId || '').trim();
  const normalizedAccessToken = String(accessToken || '').trim();
  const normalizedPixelId = String(pixelId || '').trim() || null;
  const normalizedAdAccountId = String(adAccountId || '').trim() || null;

  if (!normalizedPlatform || !normalizedAccountId || !normalizedAccessToken) return false;

  try {
    await prisma.account.upsert({
      where: { accountId: normalizedAccountId },
      create: {
        accountId: normalizedAccountId,
        domain: normalizedAccountId,
        platform: 'WOOCOMMERCE',
      },
      update: {
        domain: normalizedAccountId,
      },
    });

    const existing = await prisma.platformConnection.findFirst({
      where: { accountId: normalizedAccountId, platform: normalizedPlatform },
    });

    if (existing) {
      await prisma.platformConnection.update({
        where: { id: existing.id },
        data: {
          accessToken: normalizedAccessToken,
          pixelId: normalizedPixelId,
          adAccountId: normalizedAdAccountId,
          status: 'ACTIVE',
        },
      });

      logFanout(orderId, normalizedPlatform.toLowerCase(), 'connection_backfill', {
        action: 'updated',
        accountId: normalizedAccountId,
        adAccountId: normalizedAdAccountId,
        pixelId: normalizedPixelId,
        source,
      });
      return true;
    }

    await prisma.platformConnection.create({
      data: {
        accountId: normalizedAccountId,
        platform: normalizedPlatform,
        accessToken: normalizedAccessToken,
        pixelId: normalizedPixelId,
        adAccountId: normalizedAdAccountId,
        status: 'ACTIVE',
      },
    });

    logFanout(orderId, normalizedPlatform.toLowerCase(), 'connection_backfill', {
      action: 'created',
      accountId: normalizedAccountId,
      adAccountId: normalizedAdAccountId,
      pixelId: normalizedPixelId,
      source,
    });
    return true;
  } catch (error) {
    logFanout(orderId, normalizedPlatform.toLowerCase(), 'connection_backfill_failed', {
      accountId: normalizedAccountId,
      source,
      reason: error?.message || String(error),
    });
    return false;
  }
}

function platformLabel(platform) {
  if (platform === 'meta') return 'Meta CAPI';
  if (platform === 'google') return 'Google Ads Offline Conversion';
  if (platform === 'tiktok') return 'TikTok Events API';
  return String(platform || 'Platform');
}

function isAcceptedStatus(status) {
  return String(status || '').toLowerCase() === 'accepted';
}

function summarizeMetaResponse(data = {}) {
  return {
    eventsReceived: Number(data?.events_received || data?.num_processed_entries || 0) || null,
    messages: Array.isArray(data?.messages) ? data.messages.slice(0, 3) : [],
    fbtraceId: data?.fbtrace_id || data?.fbtraceId || null,
  };
}

function summarizeGoogleResponse(data = {}) {
  return {
    resultsCount: Array.isArray(data?.results) ? data.results.length : 0,
    jobId: data?.jobId || null,
    requestId: data?.requestId || data?.responseMetadata?.requestId || null,
    partialFailureMessage: data?.partialFailureError?.message || null,
  };
}

function summarizePlatformError(data = {}) {
  const payload = normalizeObject(data);
  const nestedError = normalizeObject(payload.error);
  return {
    message: nestedError.message || payload.message || null,
    code: nestedError.code || payload.code || null,
    type: nestedError.type || payload.type || null,
    subcode: nestedError.error_subcode || payload.error_subcode || null,
    fbtraceId: payload.fbtrace_id || nestedError.fbtrace_id || null,
    requestId: payload.requestId || payload.request_id || null,
  };
}

function isSkippableMetaReason(reason = '') {
  const message = String(reason || '').toLowerCase();
  return [
    'no accountid in order',
    'no user / platformconnection found',
    'no meta access token',
    'no meta pixel selected',
    'missing meta accesstoken',
    'missing meta pixelid',
  ].some((token) => message.includes(token));
}

function isSkippableGoogleReason(reason = '') {
  const message = String(reason || '').toLowerCase();
  return [
    'missing developer token',
    'no accountid in order',
    'user not found',
    'no google ads account connected',
    'no google access token available',
    'no gclid found',
    'no google customer id configured',
    'no valid google conversion action configured',
  ].some((token) => message.includes(token));
}

async function withRetry(fn, jobType, payload, maxAttempts = 3, delays = [1000, 5000, 30000]) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await fn(attempt);
      return { success: true, value, attempts: attempt };
    } catch (error) {
      if (attempt === maxAttempts) {
        await prisma.failedJob.create({
          data: {
            jobType,
            payload: payload || {},
            error: error?.message || String(error),
            attempts: maxAttempts,
          }
        });
        return { success: false, error, attempts: attempt };
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1] || 30000));
    }
  }

  return { success: false, error: new Error('retry_exhausted'), attempts: maxAttempts };
}

async function updateOrderDeliveryStatus(orderId, platform, patch = {}) {
  const lowerPlatform = String(platform || '').trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const responseField =
    lowerPlatform === 'meta' ? 'capiMetaResponse'
      : lowerPlatform === 'google' ? 'capiGoogleResponse'
        : null;
  const sentField =
    lowerPlatform === 'meta' ? 'capiSentMeta'
      : lowerPlatform === 'google' ? 'capiSentGoogle'
        : 'capiSentTiktok';

  const nextPayload = {
    platform: lowerPlatform,
    platformLabel: platformLabel(lowerPlatform),
    updatedAt: nowIso,
    ...patch,
  };

  let directPersisted = false;
  try {
    const directData = {
      [sentField]: isAcceptedStatus(nextPayload.status),
    };

    if (responseField) {
      directData[responseField] = nextPayload;
    }

    await prisma.order.update({
      where: { orderId },
      data: directData,
    });
    directPersisted = true;
    if (lowerPlatform !== 'tiktok') {
      return true;
    }
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
  }

  try {
    const order = await prisma.order.findUnique({
      where: { orderId },
      select: { attributionSnapshot: true },
    });

    const snapshot = normalizeObject(order?.attributionSnapshot);
    const deliveryStatus = normalizeObject(snapshot.deliveryStatus);
    deliveryStatus[lowerPlatform] = {
      ...normalizeObject(deliveryStatus[lowerPlatform]),
      ...nextPayload,
    };

    await prisma.order.update({
      where: { orderId },
      data: {
        attributionSnapshot: {
          ...snapshot,
          deliveryStatus,
        },
      },
    });
    return true;
  } catch (fallbackError) {
    console.error(`[CAPI Fanout] Could not persist delivery status for ${orderId}/${lowerPlatform}:`, fallbackError?.message || fallbackError);
    return directPersisted;
  }
}

async function resolveMetaConfig(accountId) {
  if (!accountId) return { ok: false, reason: 'No accountId in order' };

  const conn = await prisma.platformConnection.findFirst({
    where: { accountId, platform: 'META', status: 'ACTIVE' },
  }).catch(() => null);
  const connAccessToken = maybeDecryptToken(conn?.accessToken);
  const normalizedMetaAccountId = normalizeMetaAccountId(conn?.adAccountId || '');
  const user = await resolveUserForAccountId(accountId);
  const pixelSel = await findPixelSelectionByProvider({
    provider: 'meta',
    userId: user?._id || null,
    metaField: 'adAccountId',
    normalizedAccountId: normalizedMetaAccountId,
  });
  const resolvedPixelId = conn?.pixelId || pixelSel?.selectedId || null;
  const userId = user?._id ? String(user._id) : null;
  const userResolutionSource = user?.resolutionSource || null;
  const resolvedAdAccountId =
    normalizedMetaAccountId
    || normalizeMetaAccountId(pixelSel?.meta?.adAccountId || '');

  if (connAccessToken && resolvedPixelId) {
    return {
      ok: true,
      accessToken: connAccessToken,
      pixelId: resolvedPixelId,
      destinationId: resolvedPixelId,
      configSource: conn?.pixelId ? 'prisma_platform_connection' : 'prisma_connection_plus_pixel_selection',
      testEventCode: process.env.META_CAPI_TEST_CODE || null,
      userId,
      userResolutionSource,
      resolvedAdAccountId,
    };
  }

  if (!user) {
    return { ok: false, reason: 'No User / PlatformConnection found for Meta CAPI' };
  }

  const metaAccount = await MetaAccount.loadForUserWithTokens(user._id).lean();
  const accessToken =
    maybeDecryptToken(metaAccount?.longLivedToken) ||
    maybeDecryptToken(metaAccount?.longlivedToken) ||
    maybeDecryptToken(metaAccount?.access_token) ||
    maybeDecryptToken(metaAccount?.accessToken) ||
    maybeDecryptToken(metaAccount?.token) ||
    null;

  if (!accessToken) {
    return { ok: false, reason: 'No Meta access token' };
  }

  const pixelId = resolvedPixelId || null;
  if (!pixelId) {
    return { ok: false, reason: 'No Meta pixel selected for this account' };
  }

  const fallbackResolvedAdAccountId =
    resolvedAdAccountId
    || normalizeMetaAccountId(metaAccount?.defaultAccountId || '')
    || normalizeMetaAccountId(Array.isArray(metaAccount?.selectedAccountIds) ? metaAccount.selectedAccountIds[0] : '')
    || normalizeMetaAccountId(metaAccount?.ad_accounts?.[0]?.account_id || metaAccount?.ad_accounts?.[0]?.id || '')
    || normalizeMetaAccountId(metaAccount?.adAccounts?.[0]?.account_id || metaAccount?.adAccounts?.[0]?.id || '');

  return {
    ok: true,
    accessToken,
    pixelId,
    destinationId: pixelId,
    configSource: 'mongo_fallback',
    testEventCode: process.env.META_CAPI_TEST_CODE || null,
    userId,
    userResolutionSource,
    resolvedAdAccountId: fallbackResolvedAdAccountId,
  };
}

async function resolveGoogleConfig(accountId) {
  if (!accountId) return { ok: false, reason: 'No accountId in order' };

  const conn = await prisma.platformConnection.findFirst({
    where: { accountId, platform: 'GOOGLE', status: 'ACTIVE' },
  }).catch(() => null);
  const normalizedCustomerId = normalizeGoogleCustomerId(conn?.adAccountId || '');
  const user = await resolveUserForAccountId(accountId);
  const pixelSel = await findPixelSelectionByProvider({
    provider: 'google_ads',
    userId: user?._id || null,
    metaField: 'customerId',
    normalizedAccountId: normalizedCustomerId,
  });
  const resolvedConversionAction = String(conn?.pixelId || pixelSel?.selectedId || '').trim() || null;
  const userId = user?._id ? String(user._id) : null;
  const userResolutionSource = user?.resolutionSource || null;
  const connAccessToken = maybeDecryptToken(conn?.accessToken);

  if (connAccessToken && conn?.adAccountId && resolvedConversionAction) {
    return {
      ok: true,
      accessToken: connAccessToken,
      refreshToken: null,
      adAccountId: normalizedCustomerId || conn.adAccountId,
      conversionAction: resolvedConversionAction,
      configSource: conn?.pixelId ? 'prisma_platform_connection' : 'prisma_connection_plus_pixel_selection',
      destinationId: normalizedCustomerId || conn.adAccountId,
      userId,
      userResolutionSource,
    };
  }

  if (!user) {
    return { ok: false, reason: 'User not found' };
  }

  const ga = await GoogleAccount.findOne({
    $or: [{ user: user._id }, { userId: user._id }]
  })
    .select('+accessToken +refreshToken defaultCustomerId selectedCustomerIds customers ad_accounts')
    .lean();

  const googleCustomerId = normalizeGoogleCustomerId(
    pixelSel?.meta?.customerId
    || (Array.isArray(ga?.selectedCustomerIds) ? ga.selectedCustomerIds[0] : '')
    || ga?.defaultCustomerId
    || ga?.customers?.[0]?.id
    || ga?.ad_accounts?.[0]?.id
  );

  if (!ga || !googleCustomerId) {
    return { ok: false, reason: 'No Google Ads account connected' };
  }

  if (!resolvedConversionAction) {
    return { ok: false, reason: 'No valid Google conversion action configured' };
  }

  return {
    ok: true,
    accessToken: maybeDecryptToken(ga.accessToken) || ga.accessToken || null,
    refreshToken: maybeDecryptToken(ga.refreshToken) || ga.refreshToken || null,
    adAccountId: googleCustomerId,
    conversionAction: resolvedConversionAction,
    configSource: 'mongo_google_account_plus_pixel_selection',
    destinationId: googleCustomerId,
    userId,
    userResolutionSource,
  };
}

async function sendToMeta(order) {
  logFanout(order.orderId, 'meta', 'queue', {
    accountId: order.accountId || null,
    ...extractOrderSignalPresence(order),
  });
  await updateOrderDeliveryStatus(order.orderId, 'meta', {
    status: 'queued',
    queuedAt: new Date().toISOString(),
    eventId: String(order.eventId || order.orderId || ''),
    verificationHint: 'Queued for Meta Conversions API delivery.',
  });

  const config = await resolveMetaConfig(order.accountId);
  logFanout(order.orderId, 'meta', 'config', {
    accountId: order.accountId || null,
    ok: config.ok,
    reason: config.reason || null,
    configSource: config.configSource || null,
    destinationId: config.destinationId || null,
    resolvedAdAccountId: config.resolvedAdAccountId || null,
    userId: config.userId || null,
    userResolutionSource: config.userResolutionSource || null,
    hasAccessToken: Boolean(config.accessToken),
    hasPixelId: Boolean(config.pixelId),
  });
  if (!config.ok) {
    await updateOrderDeliveryStatus(order.orderId, 'meta', {
      status: isSkippableMetaReason(config.reason) ? 'skipped' : 'failed',
      skippedAt: isSkippableMetaReason(config.reason) ? new Date().toISOString() : null,
      failedAt: isSkippableMetaReason(config.reason) ? null : new Date().toISOString(),
      reason: config.reason,
      configured: false,
      verifiedBy: 'config_gate',
      verificationHint: 'Meta delivery was not attempted because the account is not fully configured for CAPI.',
    });
    logFanout(order.orderId, 'meta', isSkippableMetaReason(config.reason) ? 'skipped' : 'failed', {
      reason: config.reason,
    });
    return { success: false, status: isSkippableMetaReason(config.reason) ? 'skipped' : 'failed', reason: config.reason };
  }

  await updateOrderDeliveryStatus(order.orderId, 'meta', {
    status: 'sending',
    sendingAt: new Date().toISOString(),
    configured: true,
    destinationId: config.destinationId,
    configSource: config.configSource,
    testEventCode: config.testEventCode || null,
    verifiedBy: config.testEventCode ? 'meta_test_event_code' : 'meta_capi_request',
    verificationHint: config.testEventCode
      ? 'Verify this order in Meta Events Manager Test Events with the same test_event_code.'
      : 'Verify this order in Meta Events Manager and deduplicate with the event_id.',
  });

  if (!String(config.configSource || '').startsWith('prisma_')) {
    await ensurePlatformConnectionBackfill({
      orderId: order.orderId,
      accountId: order.accountId,
      platform: 'META',
      accessToken: config.accessToken,
      pixelId: config.pixelId,
      adAccountId: config.resolvedAdAccountId,
      source: config.configSource,
    });
  }

  const result = await withRetry(async () => {
    logFanout(order.orderId, 'meta', 'send_attempt', {
      accountId: order.accountId || null,
      destinationId: config.destinationId || null,
      configSource: config.configSource || null,
    });
    const response = await metaStack.sendConversion(order, {
      accessToken: config.accessToken,
      pixelId: config.pixelId,
      testEventCode: config.testEventCode || undefined,
    });

    if (!response?.success) {
      const err = new Error(response?.reason || 'Meta CAPI call failed');
      err.responseData = response?.data || null;
      throw err;
    }

    return response.data || {};
  }, 'meta_capi', { orderId: order.orderId, accountId: order.accountId });

  if (!result.success) {
    const errorMessage = result.error?.message || String(result.error || 'Meta CAPI call failed');
    const responseSummary = summarizePlatformError(result.error?.responseData || {});
    await updateOrderDeliveryStatus(order.orderId, 'meta', {
      status: 'failed',
      failedAt: new Date().toISOString(),
      attempts: result.attempts,
      reason: errorMessage,
      configured: true,
      destinationId: config.destinationId,
      configSource: config.configSource,
      testEventCode: config.testEventCode || null,
      responseSummary,
      verifiedBy: 'meta_capi_error',
      verificationHint: 'Check Meta Events Manager diagnostics or the CAPI response payload for the failure reason.',
    });
    logFanout(order.orderId, 'meta', 'failed', {
      reason: errorMessage,
      attempts: result.attempts,
      responseSummary,
      rawResponse: result.error?.responseData || null,
    });
    return { success: false, status: 'failed', reason: errorMessage };
  }

  await updateOrderDeliveryStatus(order.orderId, 'meta', {
    status: 'accepted',
    sentAt: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
    attempts: result.attempts,
    configured: true,
    destinationId: config.destinationId,
    configSource: config.configSource,
    testEventCode: config.testEventCode || null,
    responseSummary: summarizeMetaResponse(result.value),
    verifiedBy: config.testEventCode ? 'meta_test_event_code' : 'meta_capi_response',
    verificationHint: config.testEventCode
      ? 'Meta accepted this event. Confirm it in Test Events using the same test_event_code.'
      : 'Meta accepted this event. Confirm it in Events Manager with the event_id and fbtrace_id.',
  });
  logFanout(order.orderId, 'meta', 'accepted', {
    attempts: result.attempts,
    destinationId: config.destinationId || null,
    responseSummary: summarizeMetaResponse(result.value),
  });

  return { success: true, status: 'accepted', response: result.value };
}

async function sendToGoogle(order) {
  logFanout(order.orderId, 'google', 'queue', {
    accountId: order.accountId || null,
    ...extractOrderSignalPresence(order),
  });
  await updateOrderDeliveryStatus(order.orderId, 'google', {
    status: 'queued',
    queuedAt: new Date().toISOString(),
    eventId: String(order.eventId || order.orderId || ''),
    verificationHint: 'Queued for Google Ads offline conversion upload.',
  });

  const config = await resolveGoogleConfig(order.accountId);
  logFanout(order.orderId, 'google', 'config', {
    accountId: order.accountId || null,
    ok: config.ok,
    reason: config.reason || null,
    configSource: config.configSource || null,
    destinationId: config.destinationId || null,
    adAccountId: config.adAccountId || null,
    userId: config.userId || null,
    userResolutionSource: config.userResolutionSource || null,
    hasAccessToken: Boolean(config.accessToken),
    hasRefreshToken: Boolean(config.refreshToken),
    hasConversionAction: Boolean(config.conversionAction),
  });
  if (String(config.reason || '').toLowerCase().includes('missing developer token')) {
    logFanout(order.orderId, 'google', 'env_missing', {
      envVar: 'GOOGLE_ADS_DEVELOPER_TOKEN',
      accountId: order.accountId || null,
      userId: config.userId || null,
      userResolutionSource: config.userResolutionSource || null,
    });
  }
  if (!config.ok) {
    await updateOrderDeliveryStatus(order.orderId, 'google', {
      status: isSkippableGoogleReason(config.reason) ? 'skipped' : 'failed',
      skippedAt: isSkippableGoogleReason(config.reason) ? new Date().toISOString() : null,
      failedAt: isSkippableGoogleReason(config.reason) ? null : new Date().toISOString(),
      reason: config.reason,
      configured: false,
      verifiedBy: 'config_gate',
      verificationHint: 'Google delivery was not attempted because the Ads account is not fully configured.',
    });
    logFanout(order.orderId, 'google', isSkippableGoogleReason(config.reason) ? 'skipped' : 'failed', {
      reason: config.reason,
    });
    return { success: false, status: isSkippableGoogleReason(config.reason) ? 'skipped' : 'failed', reason: config.reason };
  }

  await updateOrderDeliveryStatus(order.orderId, 'google', {
    status: 'sending',
    sendingAt: new Date().toISOString(),
    configured: true,
    destinationId: config.destinationId,
    configSource: config.configSource,
    verifiedBy: 'google_ads_request',
    verificationHint: 'Verify this upload in Google Ads offline conversion diagnostics using the request id or job metadata.',
  });

  if (!String(config.configSource || '').startsWith('prisma_')) {
    await ensurePlatformConnectionBackfill({
      orderId: order.orderId,
      accountId: order.accountId,
      platform: 'GOOGLE',
      accessToken: config.accessToken,
      pixelId: config.conversionAction,
      adAccountId: config.adAccountId,
      source: config.configSource,
    });
  }

  const result = await withRetry(async () => {
    logFanout(order.orderId, 'google', 'send_attempt', {
      accountId: order.accountId || null,
      destinationId: config.destinationId || null,
      conversionAction: config.conversionAction || null,
      configSource: config.configSource || null,
    });
    const response = await googleStack.sendConversion(order, {
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      adAccountId: config.adAccountId,
      pixelId: config.conversionAction || null,
      conversionAction: config.conversionAction || null,
    });

    if (!response?.success) {
      const err = new Error(response?.reason || response?.error || 'Google conversion upload failed');
      err.responseData = response?.data || null;
      throw err;
    }

    return response.data || {};
  }, 'google_capi', { orderId: order.orderId, accountId: order.accountId });

  if (!result.success) {
    const errorMessage = result.error?.message || String(result.error || 'Google conversion upload failed');
    await updateOrderDeliveryStatus(order.orderId, 'google', {
      status: isSkippableGoogleReason(errorMessage) ? 'skipped' : 'failed',
      skippedAt: isSkippableGoogleReason(errorMessage) ? new Date().toISOString() : null,
      failedAt: isSkippableGoogleReason(errorMessage) ? null : new Date().toISOString(),
      attempts: result.attempts,
      reason: errorMessage,
      configured: true,
      destinationId: config.destinationId,
      configSource: config.configSource,
      responseSummary: result.error?.responseData || null,
      verifiedBy: isSkippableGoogleReason(errorMessage) ? 'eligibility_gate' : 'google_ads_error',
      verificationHint: isSkippableGoogleReason(errorMessage)
        ? 'Google delivery was skipped because the purchase did not have a valid upload key such as GCLID.'
        : 'Check the Google Ads response for partial failures or diagnostic errors.',
    });
    logFanout(order.orderId, 'google', isSkippableGoogleReason(errorMessage) ? 'skipped' : 'failed', {
      reason: errorMessage,
      attempts: result.attempts,
    });
    return { success: false, status: isSkippableGoogleReason(errorMessage) ? 'skipped' : 'failed', reason: errorMessage };
  }

  await updateOrderDeliveryStatus(order.orderId, 'google', {
    status: 'accepted',
    sentAt: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
    attempts: result.attempts,
    configured: true,
    destinationId: config.destinationId,
    configSource: config.configSource,
    responseSummary: summarizeGoogleResponse(result.value),
    verifiedBy: 'google_ads_upload_response',
    verificationHint: 'Google accepted this upload. Confirm it in the offline conversions diagnostics with the request id.',
  });
  logFanout(order.orderId, 'google', 'accepted', {
    attempts: result.attempts,
    destinationId: config.destinationId || null,
    conversionAction: config.conversionAction || null,
    responseSummary: summarizeGoogleResponse(result.value),
  });

  return { success: true, status: 'accepted', response: result.value };
}

async function maybeMarkTikTokUnsupported(order) {
  const channel = String(order?.attributedChannel || '').trim().toLowerCase();
  const platform = String(order?.attributedPlatform || '').trim().toLowerCase();
  const shouldMark = channel.includes('tiktok') || platform.includes('tiktok');
  if (!shouldMark) return { success: false, status: 'skipped', reason: 'not_applicable' };

  await updateOrderDeliveryStatus(order.orderId, 'tiktok', {
    status: 'skipped',
    skippedAt: new Date().toISOString(),
    configured: false,
    reason: 'TikTok delivery is not implemented in the backend fanout yet.',
    verifiedBy: 'unsupported_destination',
    verificationHint: 'TikTok Events API delivery is not implemented in this backend yet.',
  });
  return { success: false, status: 'skipped', reason: 'TikTok delivery is not implemented in the backend fanout yet.' };
}

async function sendToAllPlatforms(orderId) {
  const order = await prisma.order.findUnique({
    where: { orderId }
  });

  if (!order) {
    console.error(`Order not found for CAPIFanout: ${orderId}`);
    return null;
  }

  logFanout(order.orderId, 'all', 'start', {
    accountId: order.accountId || null,
    ...extractOrderSignalPresence(order),
  });

  const results = {
    meta: await sendToMeta(order),
    google: await sendToGoogle(order),
    tiktok: await maybeMarkTikTokUnsupported(order),
  };

  logFanout(order.orderId, 'all', 'complete', {
    accountId: order.accountId || null,
    results: {
      meta: results.meta?.status || null,
      google: results.google?.status || null,
      tiktok: results.tiktok?.status || null,
    },
  });

  return results;
}

module.exports = {
  sendToAllPlatforms,
  sendToMeta,
  sendToGoogle,
};
