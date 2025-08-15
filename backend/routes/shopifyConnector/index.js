// routes/shopifyConnector/index.js
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const crypto  = require('crypto');

const router  = express.Router();
const ShopConnections = require('../../models/ShopConnections');

const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;
const SCOPES       = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://ai.adnova.digital/connector/auth/callback';

// --- util: extraer shop de query/header/referer ---
function extractShop(req) {
  let { shop } = req.query || {};
  if (!shop && req.headers['x-shopify-shop-domain']) {
    shop = req.headers['x-shopify-shop-domain'];
  }
  if (!shop && req.headers.referer) {
    const m = req.headers.referer.match(/shop=([a-z0-9\-\.]+\.myshopify\.com)/i);
    if (m) shop = m[1];
  }
  return shop;
}

// --- middleware: fuerza OAuth en TODO /connector* (excepto excluidas) ---
router.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();

  const url = req.originalUrl || '';
  // exclusiones donde NO forzamos OAuth
  if (url.startsWith('/connector/auth/callback') ||
      url.startsWith('/connector/webhooks') ||
      url.startsWith('/connector/interface')) {
    return next();
  }

  const shop = extractShop(req);
  if (!shop) return next(); // sin shop, que siga (acabará en 400 con mensaje claro)

  const state = crypto.randomBytes(16).toString('hex');
  const authorize =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(SHOPIFY_API_KEY)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  console.log('[OAUTH_START]', {
    path: req.originalUrl,
    ip: req.ip,
    ua: req.headers['user-agent'],
    shop
  });

  return res.redirect(302, authorize);
});

// --- webhooks (si los usas) ---
router.use('/webhooks', require('./webhooks'));

// --- callback OAuth ---
router.get('/auth/callback', async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send('Missing params');

  try {
    const { data } = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      { client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code },
      { headers: { 'Content-Type': 'application/json' } }
    );

    await ShopConnections.findOneAndUpdate(
      { shop },
      { shop, accessToken: data.access_token, installedAt: Date.now() },
      { upsert: true }
    );

    const host = req.query.host || '';
    return res.redirect(
      `/apps/${SHOPIFY_API_KEY}/connector/interface?shop=${encodeURIComponent(shop)}${host ? `&host=${encodeURIComponent(host)}` : ''}`
    );
  } catch (err) {
    console.error('❌ access_token error:', err.response?.data || err);
    return res.status(500).send('Token exchange failed');
  }
});

// --- interfaz embebida ---
router.get('/interface', async (req, res) => {
  const shop = extractShop(req);
  if (!shop) {
    return res
      .status(400)
      .send('No se detectó la tienda (shop). Abre desde Shopify Admin.');
  }

  const shopConn = await ShopConnections.findOne({ shop });
  if (!shopConn || !shopConn.accessToken) {
    return res.redirect(`/connector?shop=${encodeURIComponent(shop)}`);
  }

  res.sendFile(path.join(__dirname, '../../../public/connector/interface.html'));
});

// --- landing/health ---
router.get('/', (_req, res) => {
  res.send('👍 Adnova Connector online');
});

module.exports = router;
