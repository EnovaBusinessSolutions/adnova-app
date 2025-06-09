// backend/routes/shopifyWebhooks.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Middleware para obtener el body crudo (Shopify lo requiere para HMAC)
router.use(express.raw({ type: 'application/json' }));

// Verifica el HMAC del webhook
function verifyShopifyHmac(req, res, next) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(req.body, 'utf8')
    .digest('base64');

  const valid = crypto.timingSafeEqual(
    Buffer.from(digest, 'utf8'),
    Buffer.from(hmacHeader || '', 'utf8')
  );

  if (!valid) {
    console.warn('❌ Webhook no verificado: firma HMAC inválida');
    return res.status(401).send('Unauthorized');
  }

  next();
}

// --- Webhooks obligatorios ---

// 1. Solicitud de datos del cliente
router.post('/customers/data_request', verifyShopifyHmac, (req, res) => {
  console.log('📦 Webhook: customer data request');
  console.log(JSON.parse(req.body.toString()));
  res.status(200).send('OK');
});

// 2. Eliminación de datos del cliente
router.post('/customers/redact', verifyShopifyHmac, (req, res) => {
  console.log('📦 Webhook: customer redact');
  console.log(JSON.parse(req.body.toString()));
  res.status(200).send('OK');
});

// 3. Eliminación de datos de la tienda
router.post('/shop/redact', verifyShopifyHmac, (req, res) => {
  console.log('📦 Webhook: shop redact');
  console.log(JSON.parse(req.body.toString()));
  res.status(200).send('OK');
});

module.exports = router;
