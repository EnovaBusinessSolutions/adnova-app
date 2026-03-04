const axios = require('axios');
const prisma = require('../utils/prismaClient');
const { decrypt } = require('../utils/encryption');
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
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delays[attempt] || 30000));
    }
  }
}

/**
 * Send order to Meta Conversions API
 */
async function sendToMeta(order) {
  return withRetry(async () => {
    // Get Meta connection
    const connection = await prisma.platformConnection.findFirst({
      where: {
        shopId: order.shopId,
        platform: 'META',
        status: 'ACTIVE'
      }
    });

    if (!connection || !connection.accessToken || !connection.pixelId) {
      return { success: false, reason: 'No active connection' };
    }

    const token = decrypt(connection.accessToken);
    if (!token) throw new Error('Failed to decrypt Meta access token');

    const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
    const contents = lineItems.map(item => ({
      id: item.variant_id || item.product_id,
      quantity: item.quantity || 1,
      item_price: item.price
    }));

    const eventTime = Math.floor(new Date(order.shopifyCreatedAt).getTime() / 1000);

    const payload = {
      data: [{
        event_name: 'Purchase',
        event_time: eventTime,
        action_source: 'website',
        event_id: order.eventId, // very important for dedup
        user_data: {
          em: order.emailHash ? [order.emailHash] : [],
          ph: order.phoneHash ? [order.phoneHash] : [],
        },
        custom_data: {
          value: order.revenue,
          currency: order.currency,
          order_id: order.orderId,
          content_type: 'product',
          contents
        }
      }]
    };

    const url = `https://graph.facebook.com/v18.0/${connection.pixelId}/events`;
    
    const response = await axios.post(url, payload, {
      params: { access_token: token }
    });

    // Mark as sent
    await prisma.order.update({
      where: { orderId: order.orderId },
      data: {
        capiSentMeta: true,
        capiMetaResponse: response.data
      }
    });

    if (order.eventId) {
       await prisma.eventDedup.updateMany({
         where: { eventId: order.eventId },
         data: { capiSentAt: new Date(), dedupStatus: 'SERVER_ONLY' }
       });
    }

    return { success: true, response: response.data };
  }, 'meta_capi', { orderId: order.orderId });
}

/**
 * Send order to Google API (Stub for now)
 */
async function sendToGoogle(order) {
  return withRetry(async () => {
    // 1. Get Google connection (Prisma first, then Mongo fallback?)
    // Assuming we use Prisma PlatformConnection for now
    const connection = await prisma.platformConnection.findFirst({
       where: {
         shopId: order.shopId,
         platform: 'GOOGLE',
         status: 'ACTIVE'
       }
    });
    
    // If not found, check older Mongo model?
    // Let's assume Prisma is the source of truth for AdRay pipeline (as per README architecture)
    if (!connection) {
       return { success: false, reason: 'No active Google connection' };
    }

    const token = decrypt(connection.accessToken);
    if (!token) throw new Error('Failed to decrypt Google access token');

    const result = await googleStack.sendConversion(order, {
       accessToken: token,
       adAccountId: connection.adAccountId,
       pixelId: connection.pixelId // mapped to conversionAction resource name
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

  // Promise.allSettled guarantees one failure won't block others
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
