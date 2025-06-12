// backend/routes/privacyRoutes.js
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const router = express.Router();

// ---------- Webhooks de privacidad obligatorios ----------
 const rawBodyParser = bodyParser.raw({
   type: 'application/json',
   verify: (req, _res, buf) => {
     req.rawBody = buf;
   }
});

function isValidShopifyWebhook(req) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const generatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(req.rawBody, 'utf8')
    .digest('base64');

  return generatedHmac === hmacHeader;
}

router.post('/webhooks/customers/data_request', rawBodyParser, (req, res) => {
  if (!isValidShopifyWebhook(req)) return res.status(401).send('Invalid HMAC');
    const payload = JSON.parse(req.rawBody.toString('utf8'));
  console.log('🔍 Shopify Webhook - Data request:', req.body);
  res.status(200).send('OK');
});

router.post('/webhooks/customers/redact', rawBodyParser, (req, res) => {
  if (!isValidShopifyWebhook(req)) return res.status(401).send('Invalid HMAC');
    const payload = JSON.parse(req.rawBody.toString('utf8'));
  console.log('🗑️ Shopify Webhook - Customer redact:', req.body);
  res.status(200).send('OK');
});

router.post('/webhooks/shop/redact', rawBodyParser, (req, res) => {
  if (!isValidShopifyWebhook(req)) return res.status(401).send('Invalid HMAC');
    const payload = JSON.parse(req.rawBody.toString('utf8'));
  console.log('🧹 Shopify Webhook - Shop redact:', req.body);
  res.status(200).send('OK');
});

// ---------- Rutas públicas de privacidad ----------
router.get('/privacy-policy', (req, res) =>
  res.sendFile(path.join(__dirname, '../../public/privacy-policy.html'))
);

router.get('/terms-of-service', (req, res) =>
  res.sendFile(path.join(__dirname, '../../public/terms-of-service.html'))
);

router.get('/contact', (req, res) =>
  res.sendFile(path.join(__dirname, '../../public/contact.html'))
);

module.exports = router;
