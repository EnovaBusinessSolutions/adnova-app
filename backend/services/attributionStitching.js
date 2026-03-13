const prisma = require('../utils/prismaClient');

/**
 * Parses domain from URL
 */
function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch (e) {
    return null;
  }
}

/**
 * Analyzes previous checkout session to stitch attribution for an order
 * @param {Object} order - The partially built order object
 * @param {Object} checkoutMap - The CheckoutSessionMap record (can be null)
 * @returns {Object} { channel, platform, confidence }
 */
async function stitchAttribution(order, checkoutMap) {
  if (!checkoutMap) {
    return { channel: 'unattributed', platform: null, confidence: 0.0 };
  }

  const snap = checkoutMap.attributionSnapshot || {};

  let result = { channel: 'direct', platform: null, confidence: 0.5 };

  // 1. Click IDs (Highest confidence)
  if (snap.fbclid) {
    result = { channel: 'paid_social', platform: 'facebook', clickId: snap.fbclid, confidence: 1.0 };
  } else if (snap.gclid) {
    result = { channel: 'paid_search', platform: 'google', clickId: snap.gclid, confidence: 1.0 };
  } else if (snap.ttclid) {
    result = { channel: 'paid_social', platform: 'tiktok', clickId: snap.ttclid, confidence: 1.0 };
  }
  // 2. UTM Parameters
  else if (snap.utm_source) {
    result = { 
      channel: snap.utm_medium || 'referral', 
      platform: snap.utm_source,
      campaign: snap.utm_campaign,
      adset: snap.utm_content,
      ad: snap.utm_term,
      confidence: 0.85 
    };
  }
  // 3. Referrer
  else if (snap.referrer) {
    const domain = getDomain(snap.referrer);
    if (domain) {
      if (['google.com', 'bing.com', 'yahoo.com'].some(d => domain.includes(d))) {
        result = { channel: 'organic_search', platform: domain, confidence: 0.7 };
      } else if (['facebook.com', 'instagram.com', 't.co'].some(d => domain.includes(d))) {
        result = { channel: 'organic_social', platform: domain, confidence: 0.7 };
      } else {
        result = { channel: 'referral', platform: domain, confidence: 0.7 };
      }
    }
  }

  // Update order record
  const updateData = {
    attributedChannel: result.channel,
    attributedCampaign: result.campaign || null,
    attributedAdset: result.adset || null,
    attributedAd: result.ad || null,
    attributedClickId: result.clickId || null,
    confidenceScore: result.confidence,
    attributionSnapshot: snap
  };

  try {
    await prisma.order.update({
      where: { orderId: order.orderId },
      data: updateData
    });
  } catch (error) {
    console.error('Failed to update order with attribution:', error);
  }

  return result;
}

module.exports = {
  stitchAttribution
};
