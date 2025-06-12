// routes/shopifyConnector/webhooks.js
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const SECRET  = process.env.SHOPIFY_API_SECRET;

// Helper para comprobar firma HMAC de Shopify
function validHmac(req) {
  // Shopify envía el HMAC en Base64 en la cabecera
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256') || '';

  // `req.body` es un Buffer gracias a express.raw, así que pasamos el Buffer directamente
  const generated = crypto
    .createHmac('sha256', SECRET)
    .update(req.body)
    .digest('base64');

  // Decodificamos ambos de Base64 a Buffer de bytes
  const generatedBuf = Buffer.from(generated, 'base64');
  const headerBuf    = Buffer.from(hmacHeader, 'base64');

  // Comparación segura contra timing attacks
  return (
    generatedBuf.length === headerBuf.length &&
    crypto.timingSafeEqual(generatedBuf, headerBuf)
  );
}

// Montamos el body parser en crudo para todas las rutas de webhooks
router.use(express.raw({ type: 'application/json' }));

// Endpoints obligatorios de privacidad de Shopify
['shop/redact', 'customers/redact', 'customers/data_request'].forEach(topic => {
  router.post(`/${topic}`, (req, res) => {
    if (!validHmac(req)) {
      console.warn('❌ HMAC inválido para webhook', topic);
      return res.status(401).send('Invalid HMAC');
    }

    // Parseamos el JSON a partir del raw body para inspección o procesamiento
    let payload = {};
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      console.warn('⚠️ No se pudo parsear JSON del body para', topic);
    }
    console.log('✅ Webhook HMAC OK:', topic, payload);

    return res.status(200).send('OK');
  });
});

module.exports = router;
