'use strict';

// routes/shopifyConnector/webhooks.js
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const SECRET = process.env.SHOPIFY_API_SECRET || '';

function validHmac(req) {
  const hmacHeader = String(req.get('X-Shopify-Hmac-Sha256') || '').trim();
  if (!SECRET || !hmacHeader) return false;

  // req.body DEBE ser Buffer (porque en backend/index.js usas express.raw)
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) return false;

  const computed = crypto
    .createHmac('sha256', SECRET)
    .update(rawBody)
    .digest(); // Buffer

  const received = Buffer.from(hmacHeader, 'base64');

  if (received.length !== computed.length) return false;
  return crypto.timingSafeEqual(received, computed);
}

function parseJson(buf) {
  try {
    return JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || ''));
  } catch {
    return null;
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
      console.warn('[WEBHOOK][HMAC_FAIL]', {
        topic,
        hasSecret: !!SECRET,
        hasHeader: !!req.get('X-Shopify-Hmac-Sha256'),
        bodyIsBuffer: Buffer.isBuffer(req.body),
        bodyLen: Buffer.isBuffer(req.body) ? req.body.length : null,
      });
      return res.status(401).send('Invalid HMAC');
    }

    const payload = parseJson(req.body);
    console.log('[WEBHOOK][OK]', { topic, shop: req.get('X-Shopify-Shop-Domain'), payload: payload || '(no-json)' });

    // Shopify solo necesita 200 OK rápido
    return res.status(200).send('OK');
  });
});

module.exports = router;
