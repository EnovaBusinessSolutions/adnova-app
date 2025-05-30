// backend/routes/privacyRoutes.js
const express = require('express');
const router = express.Router();

// 1. Solicitud de datos del cliente
router.post('/webhooks/customers/data_request', (req, res) => {
  console.log('🔍 Shopify Webhook - Data request:', req.body);
  res.status(200).send('OK');
});

// 2. Eliminación de datos del cliente
router.post('/webhooks/customers/redact', (req, res) => {
  console.log('🗑️ Shopify Webhook - Customer redact:', req.body);
  res.status(200).send('OK');
});

// 3. Supresión de datos de la tienda
router.post('/webhooks/shop/redact', (req, res) => {
  console.log('🧹 Shopify Webhook - Shop redact:', req.body);
  res.status(200).send('OK');
});

module.exports = router;
