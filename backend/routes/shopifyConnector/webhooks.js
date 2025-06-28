// routes/shopifyConnector/webhooks.js
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const SECRET  = process.env.SHOPIFY_API_SECRET;


function validHmac(req) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256') || '';

  const generated = crypto
    .createHmac('sha256', SECRET)
    .update(req.body)
    .digest('base64');


  const generatedBuf = Buffer.from(generated, 'base64');
  const headerBuf    = Buffer.from(hmacHeader, 'base64');

  return (
    generatedBuf.length === headerBuf.length &&
    crypto.timingSafeEqual(generatedBuf, headerBuf)
  );
}

router.use(express.raw({ type: 'application/json' }));

['shop/redact', 'customers/redact', 'customers/data_request'].forEach(topic => {
  router.post(`/${topic}`, (req, res) => {
    if (!validHmac(req)) {
      console.warn('❌ HMAC inválido para webhook', topic);
      return res.status(401).send('Invalid HMAC');
    }

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
