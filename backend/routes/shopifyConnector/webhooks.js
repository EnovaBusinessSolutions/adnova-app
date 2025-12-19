'use strict';

const express = require('express');
const crypto  = require('crypto');

const router  = express.Router();
const SECRET  = process.env.SHOPIFY_API_SECRET || '';

function validHmac(req) {
  if (!SECRET) return false;

  // Shopify manda Base64 en este header
  const hmacHeader =
    req.get('X-Shopify-Hmac-Sha256') ||
    req.get('x-shopify-hmac-sha256') ||
    '';

  if (!hmacHeader) return false;

  // req.body debe ser Buffer (porque lo parsea express.raw en backend/index.js)
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(req.body ? String(req.body) : '', 'utf8');

  const digestBase64 = crypto
    .createHmac('sha256', SECRET)
    .update(rawBody)
    .digest('base64');

  try {
    const a = Buffer.from(digestBase64, 'base64');
    const b = Buffer.from(String(hmacHeader), 'base64');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Webhooks GDPR obligatorios
router.post('/shop/redact', (req, res) => {
  if (!validHmac(req)) return res.status(401).send('Invalid HMAC');
  return res.status(200).send('OK');
});

router.post('/customers/redact', (req, res) => {
  if (!validHmac(req)) return res.status(401).send('Invalid HMAC');
  return res.status(200).send('OK');
});

router.post('/customers/data_request', (req, res) => {
  if (!validHmac(req)) return res.status(401).send('Invalid HMAC');
  return res.status(200).send('OK');
});

module.exports = router;
