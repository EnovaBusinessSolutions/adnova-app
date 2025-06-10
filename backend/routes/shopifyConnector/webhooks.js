// routes/shopifyConnector/webhooks.js
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const SECRET  = process.env.SHOPIFY_API_SECRET;

// helper para comprobar firma
function validHmac(req) {
  const h = req.get('X-Shopify-Hmac-Sha256') || '';
  const d = crypto.createHmac('sha256', SECRET)
                  .update(req.body, 'utf8')
                  .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(d), Buffer.from(h));
}

// usa body crudo:
router.use(express.raw({ type: 'application/json' }));

['shop/redact','customers/redact','customers/data_request'].forEach(t => {
  router.post(`/${t}`, (req, res) => {
    if (!validHmac(req)) {
      console.warn('❌ HMAC inválido', t);
      return res.status(401).send('Invalid HMAC');
    }
    console.log('✅ Webhook HMAC OK', t);
    return res.status(200).send('OK');
  });
});

