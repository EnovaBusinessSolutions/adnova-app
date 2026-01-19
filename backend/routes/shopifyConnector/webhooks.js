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

  // Debug logging completo
  console.log('[WEBHOOK][DEBUG]', {
    secretLength: secret.length,
    secretPrefix: secret.substring(0, 4) + '...',
    hmacHeader: hmacHeader,
    computedHmac: computed,
    bodyLength: rawBody.length,
    bodyFull: rawBody.toString('utf8'),
    match: hmacHeader === computed
  });

  // Comparación directa de strings base64 (más simple y correcta)
  if (hmacHeader === computed) {
    return true;
  }

  // Fallback: comparación segura con timingSafeEqual
  try {
    const computedBuf = Buffer.from(computed, 'base64');
    const receivedBuf = Buffer.from(hmacHeader, 'base64');
    
    if (computedBuf.length !== receivedBuf.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(computedBuf, receivedBuf);
  } catch (e) {
    console.error('[WEBHOOK] Error in HMAC comparison:', e.message);
    return false;
  }
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
  'app/uninstalled',  // Este se dispara inmediatamente al desinstalar
];

// Endpoint de verificación para probar HMAC manualmente
// POST /connector/webhooks/verify-hmac
// Body: cualquier JSON
// Header: X-Test-Hmac con el HMAC esperado
router.post('/verify-hmac', (req, res) => {
  const secret = getShopifySecret();
  const rawBody = req.body;
  
  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: 'Body must be raw buffer' });
  }
  
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  
  // Mostrar info de debug (sin exponer el secret completo)
  const info = {
    secretLength: secret.length,
    secretFirst4: secret.substring(0, 4),
    secretLast4: secret.substring(secret.length - 4),
    bodyLength: rawBody.length,
    bodyPreview: rawBody.toString('utf8').substring(0, 100),
    computedHmac: computed,
    message: 'Compare this computedHmac with what Shopify sends in X-Shopify-Hmac-Sha256'
  };
  
  console.log('[WEBHOOK][VERIFY-HMAC]', info);
  return res.json(info);
});

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
