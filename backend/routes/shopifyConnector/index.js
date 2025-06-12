// routes/shopifyConnector/index.js
const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');
const User    = require('../../models/User');

const router  = express.Router();

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_APP_HANDLE
} = process.env;

const SCOPES      = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://adnova-app.onrender.com/connector/auth/callback';

// ─── 1) Función que inicia el flujo OAuth ───
function startOAuth(req, res) {
  const { shop, host } = req.query;
  if (!shop || !host) {
    return res.status(400).send('Faltan shop o host en la query');
  }

  // Generamos y guardamos state para proteger contra CSRF
  const state = crypto.randomBytes(16).toString('hex');
  req.session.shopifyState = state;

  // Construimos la URL de autorización de Shopify
  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}`;

  return res.redirect(installUrl);
}

// ─── 2) Rutas que Shopify usará para iniciar la instalación ───
// Soportamos tanto /grant como /app/grant
['/grant', '/app/grant'].forEach(path => {
  router.get(path, startOAuth);
});

// ─── 3) También capturamos GET /connector?shop=…&host=… ───
router.get('/', (req, res) => {
  const { shop, host } = req.query;
  if (shop && host) return startOAuth(req, res);
  // Si se entra sin parámetros, devolvemos un simple “online”
  return res.send('👍 Adnova Connector online');
});

// ─── 4) Callback de OAuth ───
router.get('/auth/callback', async (req, res) => {
  const { shop, code, state, host, hmac, signature } = req.query;

  // 4-A) Verificar state
  if (state !== req.session.shopifyState) {
    return res.status(400).send('State no coincide');
  }

  // 4-B) Validar HMAC de la query
  const mapParams = Object.entries(req.query)
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const generatedDigest = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(mapParams)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(generatedDigest), Buffer.from(hmac))) {
    return res.status(400).send('HMAC inválido');
  }

  // 4-C) Intercambiar `code` por access token
  let tokenResponse;
  try {
    tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id:     SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Error obteniendo access token:', err.response?.data || err.message);
    return res.status(500).send('Error obteniendo access token');
  }

  const accessToken = tokenResponse.data.access_token;

  // 4-D) Guardar en MongoDB
  try {
    await User.findByIdAndUpdate(req.session.userId, {
      shop,
      shopifyAccessToken: accessToken,
      shopifyConnected:   true
    });
  } catch (err) {
    console.error('Error guardando token en DB:', err);
    // No interrumpimos el flujo, pero avisamos
  }

  // 4-E) Redirigir al UI embebido
  const uiUrl =
    `https://admin.shopify.com/apps/${SHOPIFY_APP_HANDLE}` +
    `?host=${encodeURIComponent(host)}` +
    `&shop=${encodeURIComponent(shop)}`;

  return res.redirect(uiUrl);
});

// ─── 5) Webhooks obligatorios ───
router.use('/webhooks', require('./webhooks'));

module.exports = router;
