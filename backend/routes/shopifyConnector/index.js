// routes/shopifyConnector/index.js
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const router  = express.Router();

const ShopConnections = require('../../models/ShopConnections');
const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;

/* ---------- constantes ---------- */
const SCOPES       = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://adnova-app.onrender.com/connector/auth/callback';

/* ---------- 1. arranque de OAuth ---------- */
function startOAuth(req, res) {
  const { shop, host } = req.query;
  if (!shop || !host) return res.status(400).send('Faltan shop u host');

  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  return res.redirect(url);
}

/* paths que pueden iniciar OAuth (incluye tests de Shopify) */
['/grant', '/app/grant', '/'].forEach(p => router.get(p, (req, res) => {
  const { shop, host } = req.query;
  if (shop && host) return startOAuth(req, res);
  res.send('👍 Adnova Connector online');
}));

/* ---------- 2. callback ---------- */
router.get('/auth/callback', async (req, res) => {
  const { shop, host, code } = req.query;
  if (!shop || !host || !code) return res.status(400).send('Missing params');

  try {
    /* 2-A. code → access_token */
    const { data } = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      { client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code },
      { headers: { 'Content-Type': 'application/json' } }
    );

    /* 2-B. upsert conexión en Mongo */
    await ShopConnections.findOneAndUpdate(
      { shop },
      { shop, accessToken: data.access_token, installedAt: Date.now() },
      { upsert: true }
    );

    /* 2-C. redirige al iframe de interfaz */
    return res.redirect(
      `/connector/interface?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
    );
  } catch (err) {
    console.error('❌ access_token error:', err.response?.data || err);
    return res.status(500).send('Token exchange failed');
  }
});

/* ---------- 3. webhooks de desinstalación / privacidad ---------- */
router.use('/webhooks', require('./webhooks'));

/* ---------- 4. interfaz embebida ---------- */
router.get('/interface', (req, res) => {
  res.sendFile(path.join(__dirname, '../../../public/connector/interface.html'));
});

module.exports = router;
