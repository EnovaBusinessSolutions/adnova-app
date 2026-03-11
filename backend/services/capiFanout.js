const axios = require('axios');
const prisma = require('../utils/prismaClient');
const User = require('../models/User'); // Mongo
const GoogleAccount = require('../models/GoogleAccount'); // Mongo
const MetaAccount = require('../models/MetaAccount'); // Mongo
const PixelSelection = require('../models/PixelSelection'); // Mongo
const googleStack = require('./capiStack/google');
const metaStack   = require('./capiStack/meta');

/**
 * Generic retry wrapper with exponential backoff
 */
async function withRetry(fn, jobType, payload, maxAttempts = 3, delays = [1000, 5000, 30000]) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        // Final failure, write to failed_jobs
        await prisma.failedJob.create({
          data: {
            jobType,
            payload: payload || {},
            error: error.message || String(error),
            attempts: maxAttempts
          }
        });
        return { success: false, error };
      }
      await new Promise(resolve => setTimeout(resolve, delays[attempt] || 30000));
    }
  }
}

/**
 * Send order to Meta Conversions API.
 * Resolution order:
 *   1. PlatformConnection (Prisma/PostgreSQL) — works for Woo + Shopify
 *   2. MongoDB MetaAccount / PixelSelection   — legacy Shopify fallback
 */
async function sendToMeta(order) {
  return withRetry(async () => {
    const accountId = order.accountId;
    console.log(`[Meta CAPI] Starting fanout for order ${order.orderId} / account ${accountId}`);
    if (!accountId) {
      console.warn('[Meta CAPI] SKIP: No accountId in order');
      return { success: false, reason: 'No accountId in order' };
    }

    let accessToken = null;
    let pixelId     = null;

    // ── 1. PlatformConnection (Prisma) ─────────────────────────────────────
    const conn = await prisma.platformConnection.findFirst({
      where: { accountId, platform: 'META', status: 'ACTIVE' },
    });

    if (conn?.accessToken && conn?.pixelId) {
      accessToken = conn.accessToken;
      pixelId     = conn.pixelId;
      console.log(`[Meta CAPI] PlatformConnection found — pixel: ${pixelId}`);
    } else {
      console.log(`[Meta CAPI] No PlatformConnection for ${accountId}, trying MongoDB fallback…`);

      // ── 2. MongoDB fallback (legacy Shopify path) ───────────────────────
      const user = await User.findOne({
        $or: [{ shop: accountId }, { email: accountId }],
      }).lean();

      if (!user) {
        console.warn(`[Meta CAPI] SKIP: No User found for accountId=${accountId} (Prisma+Mongo both empty)`);
        return { success: false, reason: 'No User / PlatformConnection found for Meta CAPI' };
      }
      console.log(`[Meta CAPI] Mongo User found: ${user._id}`);

      const metaAccount = await MetaAccount.loadForUserWithTokens(user._id).lean();
      accessToken =
        metaAccount?.longLivedToken ||
        metaAccount?.longlivedToken ||
        metaAccount?.access_token  ||
        metaAccount?.accessToken   ||
        metaAccount?.token         ||
        null;

      if (!accessToken) {
        console.warn(`[Meta CAPI] SKIP: No Meta token for userId=${user._id}`);
        return { success: false, reason: 'No Meta access token' };
      }

      const pixelSel = await PixelSelection.findOne({
        $or: [{ userId: user._id }, { user: user._id }],
        provider: 'meta',
      }).lean();

      pixelId = pixelSel?.selectedId || null;
      if (!pixelId) {
        console.warn(`[Meta CAPI] SKIP: No Meta pixel selected for userId=${user._id}`);
        return { success: false, reason: 'No Meta pixel selected for this account' };
      }
      console.log(`[Meta CAPI] Mongo pixel resolved: ${pixelId}`);
    }

    console.log(`[Meta CAPI] Sending — pixel: ${pixelId} — testCode: ${process.env.META_CAPI_TEST_CODE || 'none'}`);

    // ── 3. Send conversion ──────────────────────────────────────────────────
    const result = await metaStack.sendConversion(order, {
      accessToken,
      pixelId,
      testEventCode: process.env.META_CAPI_TEST_CODE || undefined,
    });

    if (!result.success) throw new Error(result.reason || 'Meta CAPI call failed');
    console.log(`[Meta CAPI] ✅ Purchase sent for order ${order.orderId} → pixel ${pixelId}`);
    return { success: true, response: result.data };
  }, 'meta_capi', { orderId: order.orderId });
}

/**
 * Send order to Google API
 */
async function sendToGoogle(order) {
  return withRetry(async () => {
    const accountId = order.accountId;
    if (!accountId) return { success: false, reason: 'No accountId in order' };

    // 1. Resolve User (Mongo) - using accountId as shop identifier for backward compat
    const user = await User.findOne({ shop: accountId }).lean();
    if (!user) {
        return { success: false, reason: 'User not found' };
    }

    // 2. Resolve Google Account (Mongo)
    const ga = await GoogleAccount.findOne({
        $or: [{ user: user._id }, { userId: user._id }]
    })
    .select('+accessToken +refreshToken defaultCustomerId')
    .lean();
    
    if (!ga || !ga.defaultCustomerId) {
       return { success: false, reason: 'No Google Ads account connected' };
    }

    // 3. Send via Google Stack
    const result = await googleStack.sendConversion(order, {
       accessToken: ga.accessToken,
       refreshToken: ga.refreshToken,
       adAccountId: ga.defaultCustomerId,
       pixelId: null
    });

    if (!result.success) {
       throw new Error(result.error || result.reason);
    }

    return { success: true, response: result.data };

  }, 'google_capi', { orderId: order.orderId });
}

/**
 * Main fanout router - calls all platforms in parallel
 */
async function sendToAllPlatforms(orderId) {
  const order = await prisma.order.findUnique({
    where: { orderId }
  });

  if (!order) {
    console.error(`Order not found for CAPIFanout: ${orderId}`);
    return;
  }

  const results = await Promise.allSettled([
    sendToMeta(order),
    sendToGoogle(order)
  ]);

  return results;
}

module.exports = {
  sendToAllPlatforms,
  sendToMeta,
  sendToGoogle
};
