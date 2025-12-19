// backend/routes/shopifyConnector/webhooks.js
'use strict';

const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const SECRET = process.env.SHOPIFY_API_SECRET;

function validHmac(req) {
  try {
    if (!SECRET) return false;

    const hmacHeader = String(req.get('X-Shopify-Hmac-Sha256') || '');
    if (!hmacHeader) return false;

    // req.body DEBE ser Buffer (lo parsea index.js con express.raw)
    const body = req.body;
    if (!Buffer.isBuffer(body)) return false;

    const digest = crypto
      .createHmac('sha256', SECRET)
      .update(body)
      .digest('base64');

    const a = Buffer.from(digest, 'base64');
    const b = Buffer.from(hmacHeader, 'base64');
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    console.error('[WEBHOOK] validHmac error:', e?.message || e);
    return false;
  }
}

const TOPICS = [
  'shop/redact',
  'customers/redact',
  'customers/data_request',
];

TOPICS.forEach((topic) => {
  router.post(`/${topic}`, (req, res) => {
    const ok = validHmac(req);

    if (!ok) {
      console.warn('[WEBHOOK] ❌ HMAC inválido', {
        topic,
        contentType: req.get('content-type'),
        hasBodyBuffer: Buffer.isBuffer(req.body),
        bodyLen: Buffer.isBuffer(req.body) ? req.body.length : null,
        hasHeader: !!req.get('X-Shopify-Hmac-Sha256'),
      });
      return res.status(401).send('Invalid HMAC');
    }

    // Parse best-effort (no afecta HMAC)
    let payload = null;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (_) {}

    console.log('[WEBHOOK] ✅ OK', { topic, shop: req.get('X-Shopify-Shop-Domain') || null });
    return res.status(200).send('OK');
  });
});

module.exports = router;
