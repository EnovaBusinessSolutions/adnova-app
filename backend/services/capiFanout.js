const prisma = require('../utils/prismaClient');
const User = require('../models/User');
const GoogleAccount = require('../models/GoogleAccount');
const MetaAccount = require('../models/MetaAccount');
const PixelSelection = require('../models/PixelSelection');
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

  if (conn?.accessToken && conn?.pixelId) {
    return {
      ok: true,
      accessToken: conn.accessToken,
      pixelId: conn.pixelId,
      destinationId: conn.pixelId,
      configSource: 'prisma_platform_connection',
      testEventCode: process.env.META_CAPI_TEST_CODE || null,
    };
  }

  const user = await User.findOne({
    $or: [{ shop: accountId }, { email: accountId }],
  }).lean();

  if (!user) {
    return { ok: false, reason: 'No User / PlatformConnection found for Meta CAPI' };
  }

  const metaAccount = await MetaAccount.loadForUserWithTokens(user._id).lean();
  const accessToken =
    metaAccount?.longLivedToken ||
    metaAccount?.longlivedToken ||
    metaAccount?.access_token ||
    metaAccount?.accessToken ||
    metaAccount?.token ||
    null;

  if (!accessToken) {
    return { ok: false, reason: 'No Meta access token' };
  }

  const pixelSel = await PixelSelection.findOne({
    $or: [{ userId: user._id }, { user: user._id }],
    provider: 'meta',
  }).lean();

  const pixelId = pixelSel?.selectedId || null;
  if (!pixelId) {
    return { ok: false, reason: 'No Meta pixel selected for this account' };
  }

  return {
    ok: true,
    accessToken,
    pixelId,
    destinationId: pixelId,
    configSource: 'mongo_fallback',
    testEventCode: process.env.META_CAPI_TEST_CODE || null,
  };
}

async function resolveGoogleConfig(accountId) {
  if (!accountId) return { ok: false, reason: 'No accountId in order' };

  const conn = await prisma.platformConnection.findFirst({
    where: { accountId, platform: 'GOOGLE', status: 'ACTIVE' },
  }).catch(() => null);

  if (conn?.accessToken && conn?.adAccountId) {
    return {
      ok: true,
      accessToken: conn.accessToken,
      refreshToken: null,
      adAccountId: conn.adAccountId,
      configSource: 'prisma_platform_connection',
      destinationId: conn.adAccountId,
    };
  }

  const user = await User.findOne({ shop: accountId }).lean();
  if (!user) {
    return { ok: false, reason: 'User not found' };
  }

  const ga = await GoogleAccount.findOne({
    $or: [{ user: user._id }, { userId: user._id }]
  })
    .select('+accessToken +refreshToken defaultCustomerId')
    .lean();

  if (!ga || !ga.defaultCustomerId) {
    return { ok: false, reason: 'No Google Ads account connected' };
  }

  return {
    ok: true,
    accessToken: ga.accessToken || null,
    refreshToken: ga.refreshToken || null,
    adAccountId: ga.defaultCustomerId,
    configSource: 'mongo_google_account',
    destinationId: ga.defaultCustomerId,
  };
}

async function sendToMeta(order) {
  await updateOrderDeliveryStatus(order.orderId, 'meta', {
    status: 'queued',
    queuedAt: new Date().toISOString(),
    eventId: String(order.eventId || order.orderId || ''),
    verificationHint: 'Queued for Meta Conversions API delivery.',
  });

  const config = await resolveMetaConfig(order.accountId);
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

  const result = await withRetry(async () => {
    const response = await metaStack.sendConversion(order, {
      accessToken: config.accessToken,
      pixelId: config.pixelId,
      testEventCode: config.testEventCode || undefined,
    });

    if (!response?.success) {
      throw new Error(response?.reason || 'Meta CAPI call failed');
    }

    return response.data || {};
  }, 'meta_capi', { orderId: order.orderId, accountId: order.accountId });

  if (!result.success) {
    const errorMessage = result.error?.message || String(result.error || 'Meta CAPI call failed');
    await updateOrderDeliveryStatus(order.orderId, 'meta', {
      status: 'failed',
      failedAt: new Date().toISOString(),
      attempts: result.attempts,
      reason: errorMessage,
      configured: true,
      destinationId: config.destinationId,
      configSource: config.configSource,
      testEventCode: config.testEventCode || null,
      verifiedBy: 'meta_capi_error',
      verificationHint: 'Check Meta Events Manager diagnostics or the CAPI response payload for the failure reason.',
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

  return { success: true, status: 'accepted', response: result.value };
}

async function sendToGoogle(order) {
  await updateOrderDeliveryStatus(order.orderId, 'google', {
    status: 'queued',
    queuedAt: new Date().toISOString(),
    eventId: String(order.eventId || order.orderId || ''),
    verificationHint: 'Queued for Google Ads offline conversion upload.',
  });

  const config = await resolveGoogleConfig(order.accountId);
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

  const result = await withRetry(async () => {
    const response = await googleStack.sendConversion(order, {
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      adAccountId: config.adAccountId,
      pixelId: null,
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

  const results = {
    meta: await sendToMeta(order),
    google: await sendToGoogle(order),
    tiktok: await maybeMarkTikTokUnsupported(order),
  };

  return results;
}

module.exports = {
  sendToAllPlatforms,
  sendToMeta,
  sendToGoogle,
};
