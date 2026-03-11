const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const prisma = require('../utils/prismaClient');

function normalizeWooChannel(payload = {}) {
  const utmSource = String(payload.utm_source || '').trim().toLowerCase();
  const utmMedium = String(payload.utm_medium || '').trim().toLowerCase();
  const wooSourceLabel = String(payload.woo_source_label || '').trim().toLowerCase();
  const wooSourceType = String(payload.woo_source_type || '').trim().toLowerCase();

  if (utmSource === 'google') return 'google';
  if (utmSource === 'facebook' || utmSource === 'instagram') return 'meta';
  if (utmSource === 'tiktok') return 'tiktok';
  if (utmSource === 'yahoo' || utmSource === 'bing') return 'other';

  if (utmMedium === 'paid_search') return 'google';
  if (utmMedium === 'paid_social') {
    if (utmSource === 'tiktok') return 'tiktok';
    return 'meta';
  }

  if (wooSourceLabel.includes('google')) {
    return 'google';
  }
  if (wooSourceLabel.includes('yahoo') || wooSourceLabel.includes('bing') || wooSourceLabel.includes('referido')) {
    return 'other';
  }
  if (wooSourceLabel.includes('facebook') || wooSourceLabel.includes('instagram')) {
    return 'meta';
  }
  if (wooSourceLabel.includes('tiktok')) {
    return 'tiktok';
  }
  if (wooSourceLabel.includes('directo') || wooSourceType === 'direct') {
    return 'unattributed';
  }

  return 'unattributed';
}

function parseFloatSafe(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

router.post('/woo/orders-sync', async (req, res) => {
  try {
    const payload = req.body || {};
    const accountId = String(payload.account_id || '').trim();
    const orderId = String(payload.order_id || '').trim();

    if (!accountId || !orderId) {
      return res.status(400).json({ success: false, error: 'account_id and order_id are required' });
    }

    await prisma.account.upsert({
      where: { accountId },
      create: {
        accountId,
        domain: accountId,
        platform: 'WOOCOMMERCE',
      },
      update: {},
    });

    const checkoutToken = payload.checkout_token ? String(payload.checkout_token) : null;
    const checkoutMap = checkoutToken
      ? await prisma.checkoutSessionMap.findUnique({ where: { checkoutToken } })
      : null;

    const attributedChannel = normalizeWooChannel(payload);
    const attributionSnapshot = {
      utm_source: payload.utm_source || null,
      utm_medium: payload.utm_medium || null,
      utm_campaign: payload.utm_campaign || null,
      utm_content: payload.utm_content || null,
      utm_term: payload.utm_term || null,
      referrer: payload.referrer || null,
      gclid: payload.gclid || null,
      fbclid: payload.fbclid || null,
      ttclid: payload.ttclid || null,
      woo_source_label: payload.woo_source_label || null,
      woo_source_type: payload.woo_source_type || null,
    };

    const orderData = {
      orderNumber: String(payload.order_number || payload.order_id),
      accountId,
      checkoutToken,
      userKey: checkoutMap ? checkoutMap.userKey : null,
      sessionId: checkoutMap ? checkoutMap.sessionId : null,
      customerId: payload.customer_id ? String(payload.customer_id) : null,
      revenue: parseFloatSafe(payload.revenue),
      subtotal: parseFloatSafe(payload.subtotal),
      discountTotal: parseFloatSafe(payload.discount_total),
      shippingTotal: parseFloatSafe(payload.shipping_total),
      taxTotal: parseFloatSafe(payload.tax_total),
      currency: String(payload.currency || 'MXN'),
      lineItems: Array.isArray(payload.items) ? payload.items : [],
      attributedChannel,
      attributedCampaign: payload.utm_campaign || null,
      attributedAdset: payload.utm_content || null,
      attributedAd: payload.utm_term || null,
      attributedClickId: payload.gclid || payload.fbclid || payload.ttclid || null,
      attributionModel: attributedChannel === 'unattributed' ? 'woo_direct' : 'woo_fallback',
      attributionSnapshot,
      confidenceScore: attributedChannel === 'unattributed' ? 0.4 : 0.75,
      eventId: checkoutMap ? checkoutMap.eventId : randomUUID(),
      platformCreatedAt: payload.created_at ? new Date(payload.created_at) : new Date(),
    };

    const order = await prisma.order.upsert({
      where: { orderId },
      create: {
        orderId,
        ...orderData,
      },
      update: orderData,
    });

    res.json({ success: true, orderId: order.orderId, attributedChannel: order.attributedChannel });
  } catch (error) {
    console.error('[Woo Orders Sync] Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;