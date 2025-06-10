// routes/shopifyConnector/index.js
const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');
const jwt     = require('jsonwebtoken');
const User    = require('../../models/User');

const router  = express.Router();

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_APP_HANDLE   // ←  añade en tu .env  (ej. adnova-ai-connector-1)
} = process.env;

const SCOPES   = 'read_products,read_customers,read_orders';
const REDIRECT = 'https://adnova-app.onrender.com/connector/auth/callback';

// ──────────────────────────────────────────────
// 1)  URL pública de la App (pantalla Instalar)
//     GET /connector?shop=...&host=...
// ──────────────────────────────────────────────
router.get('/', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.send('👍 Adnova Connector online');

  const state = crypto.randomBytes(16).toString('hex');
  req.session.shopifyState = state;

  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
    `&state=${state}`;

  return res.redirect(url);
});

// ──────────────────────────────────────────────
// 2)  Callback  GET /connector/auth/callback
// ──────────────────────────────────────────────
router.get('/auth/callback', async (req, res) => {
  const { shop, code, state, hmac } = req.query;

  // 2-A  State check
  if (state !== req.session.shopifyState) {
    return res.status(400).send('Bad state');
  }

  // 2-B  HMAC check  (igual que antes)
  const msg = Object.entries({ ...req.query, hmac: undefined, signature: undefined })
                    .filter(([k]) => k !== 'hmac' && k !== 'signature')
                    .sort()
                    .map(([k, v]) => `${k}=${v}`)
                    .join('&');

  const digest = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(msg)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))) {
    return res.status(400).send('Invalid HMAC');
  }

  // 2-C  Access-token
  const { data } = await axios.post(
    `https://${shop}/admin/oauth/access_token`,
    { client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code },
    { headers: { 'Content-Type': 'application/json' } }
  );

  // 2-D  Actualizar usuario
  await User.findByIdAndUpdate(req.session.userId, {
    shop,
    shopifyAccessToken: data.access_token,
    shopifyConnected: true
  });

  // 2-E  Redirección que el robot “espera”
  const hostParam = req.query.host;                    // ⇐ viene en el install flow
  const uiUrl =
    `https://admin.shopify.com/apps/${SHOPIFY_APP_HANDLE}` +
    `?host=${hostParam}&shop=${shop}`;

  // Opcional: JWT si tu front lo usa
  // const token = jwt.sign({ shop }, SHOPIFY_API_SECRET, { expiresIn: '10m' });

  return res.redirect(uiUrl);
});

// ──────────────────────────────────────────────
// 3)  Webhooks obligatorios (se mantienen igual)
// ──────────────────────────────────────────────
router.use('/webhooks', require('./webhooks'));

module.exports = router;
