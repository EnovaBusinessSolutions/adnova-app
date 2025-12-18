'use strict';

const crypto = require('crypto');

module.exports = function verifyShopifyWebhookHmac(req, res, next) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error('[SHOPIFY_WEBHOOK] Missing SHOPIFY_API_SECRET');
    return res.status(500).send('Server misconfigured');
  }

  const hmacHeader =
    req.get('X-Shopify-Hmac-Sha256') ||
    req.get('x-shopify-hmac-sha256');

  if (!hmacHeader) {
    return res.status(401).send('Missing HMAC');
  }

  // IMPORTANTE: req.body debe ser el RAW buffer (por eso usamos express.raw en index.js)
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(req.body ? String(req.body) : '', 'utf8');

  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  try {
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(String(hmacHeader), 'utf8');
    if (a.length !== b.length) return res.status(401).send('Invalid HMAC');
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).send('Invalid HMAC');
    return next();
  } catch (e) {
    return res.status(401).send('Invalid HMAC');
  }
};
