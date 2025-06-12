// routes/shopifyConnector/index.js
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const {
  SHOPIFY_API_KEY,
  SHOPIFY_APP_HANDLE
} = process.env;

const SCOPES       = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://adnova-app.onrender.com/connector/auth/callback';

// 1) Inicia OAuth en Shopify sin usar state
function startOAuth(req, res) {
  const { shop, host } = req.query;
  if (!shop || !host) {
    return res.status(400).send('Faltan shop o host en la query');
  }

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  // Redirige inmediatamente (HTTP 302)
  return res.redirect(installUrl);
}

// 2) Shopify probará ambos endpoints: /connector/grant y /connector/app/grant
['/grant', '/app/grant'].forEach(path => {
  router.get(path, startOAuth);
});

// 3) También acepta GET /connector?shop=...&host=...
router.get('/', (req, res) => {
  const { shop, host } = req.query;
  if (shop && host) {
    return startOAuth(req, res);
  }
  // Si no hay parámetros, un simple “online”
  return res.send('👍 Adnova Connector online');
});

// 4) Callback OAuth: redirige al UI embebido sin validaciones extra
router.get('/auth/callback', (req, res) => {
  const { shop, host } = req.query;
  if (!shop || !host) {
    return res.status(400).send('Faltan shop o host en callback');
  }

  const uiUrl =
    `https://admin.shopify.com/apps/${SHOPIFY_APP_HANDLE}` +
    `?shop=${encodeURIComponent(shop)}` +
    `&host=${encodeURIComponent(host)}`;

  return res.redirect(uiUrl);
});

// 5) Webhooks de privacidad (HMAC) — dejalos como tenías
router.use('/webhooks', require('./webhooks'));

module.exports = router;
