const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const SECRET  = process.env.SHOPIFY_API_SECRET;

function verify(req) {
  const h = req.get('X-Shopify-Hmac-Sha256') || '';
  const d = crypto.createHmac('sha256', SECRET).update(req.body, 'utf8').digest('base64');
  return crypto.timingSafeEqual(Buffer.from(d), Buffer.from(h));
}

['shop/redact', 'customers/redact', 'customers/data_request'].forEach(t => {
  router.post(`/${t}`, express.raw({ type: 'application/json' }), (req, res) => {
    if (!verify(req)) return res.status(401).send('Invalid HMAC');
    console.log('✅ Webhook', t);
    return res.status(200).send('OK');
  });
});

module.exports = router;
