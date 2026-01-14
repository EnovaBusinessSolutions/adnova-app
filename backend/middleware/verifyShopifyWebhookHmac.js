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
  // Si no es Buffer, convertimos a string UTF-8 (mejor esfuerzo) pero idealmente debe ser Buffer.
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(req.body ? String(req.body) : '', 'utf8');

  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  try {
    // Shopify manda base64. Comparar como bytes decodificados de base64 (NO utf8).
    const a = Buffer.from(digest, 'base64');
    const b = Buffer.from(String(hmacHeader).trim(), 'base64');

    if (a.length !== b.length) return res.status(401).send('Invalid HMAC');
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).send('Invalid HMAC');

    return next();
  } catch (e) {
    // Si el header no es base64 válido o algo raro ocurre
    return res.status(401).send('Invalid HMAC');
  }
};