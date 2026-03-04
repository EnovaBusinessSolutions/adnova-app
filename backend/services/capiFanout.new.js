const axios = require('axios');
const prisma = require('../utils/prismaClient');
const User = require('../models/User'); // Mongo
const GoogleAccount = require('../models/GoogleAccount'); // Mongo
const googleStack = require('./capiStack/google');

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
 * Send order to Meta Conversions API (Placeholder)
 */
async function sendToMeta(order) {
  return withRetry(async () => {
    // Phase 3 todo: Implement Meta CAPI using User/MetaAccount models
    return { success: true, reason: 'Meta CAPI temporarily skipped in fanout rewrite' };
  }, 'meta_capi', { orderId: order.orderId });
}

/**
 * Send order to Google API
 */
async function sendToGoogle(order) {
  return withRetry(async () => {
    const shopId = order.shopId;
    if (!shopId) return { success: false, reason: 'No shopId in order' };

    // 1. Resolve User (Mongo)
    const user = await User.findOne({ shop: shopId }).lean();
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
