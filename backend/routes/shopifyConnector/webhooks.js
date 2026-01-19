'use strict';

// routes/shopifyConnector/webhooks.js
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// Shopify usa SHOPIFY_API_SECRET para firmar webhooks
// En algunas configuraciones también puede estar en SHOPIFY_CLIENT_SECRET
function getShopifySecret() {
  return process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '';
}

function validHmac(req) {
  const secret = getShopifySecret();
  const hmacHeader = String(req.get('X-Shopify-Hmac-Sha256') || '').trim();
  
  if (!secret) {
    console.error('[WEBHOOK] No secret configured (SHOPIFY_API_SECRET or SHOPIFY_CLIENT_SECRET)');
    return false;
  }
  
  if (!hmacHeader) {
    console.error('[WEBHOOK] No HMAC header received');
    return false;
  }

  // req.body DEBE ser Buffer (porque en backend/index.js usas express.raw)
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    console.error('[WEBHOOK] Body is not a Buffer');
    return false;
  }

  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64'); // base64 string para comparar directamente

  // Comparación segura usando timingSafeEqual con buffers
  const computedBuf = Buffer.from(computed, 'utf8');
  const receivedBuf = Buffer.from(hmacHeader, 'utf8');

  // Debug logging (sin mostrar el secret completo)
  console.log('[WEBHOOK][DEBUG]', {
    secretLength: secret.length,
    secretPrefix: secret.substring(0, 4) + '...',
    hmacHeader: hmacHeader.substring(0, 20) + '...',
    computedHmac: computed.substring(0, 20) + '...',
    bodyLength: rawBody.length,
    bodyPreview: rawBody.toString('utf8').substring(0, 50),
  });

  if (computedBuf.length !== receivedBuf.length) {
    console.warn('[WEBHOOK] HMAC length mismatch:', {
      computed: computedBuf.length,
      received: receivedBuf.length
    });
    return false;
  }
  
  return crypto.timingSafeEqual(computedBuf, receivedBuf);
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
        hasSecret: !!getShopifySecret(),
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
