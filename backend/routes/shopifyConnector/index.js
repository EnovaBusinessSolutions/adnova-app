// routes/shopifyConnector/index.js   ← versión “original” estable
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const axios   = require('axios');

const router  = express.Router();
const ShopConnections = require('../../models/ShopConnections');

const {
  SHOPIFY_API_KEY,
  SHOPIFY_APP_HANDLE          // (por si lo usas en el futuro)
} = process.env;

/* --- Config --- */
const SCOPES       = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://adnova-app.onrender.com/connector/auth/callback';

/* =========================================================
   1) Inicio de OAuth (sin “state”)
   ========================================================= */
function startOAuth(req, res) {
  const { shop, host } = req.query;
  if (!shop || !host) {
    return res.status(400).send('Faltan shop u host en la query');
  }

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  return res.redirect(installUrl);
}

/* Shopify prueba estos dos endpoints: */
['/grant', '/app/grant'].forEach(p => router.get(p, startOAuth));

/* GET /connector?shop=...&host=... (instalación desde Adnova) */
router.get('/', (req, res) => {
  const { shop, host } = req.query;
  if (shop && host) return startOAuth(req, res);
  return res.send('👍 Adnova Connector online');
});

/* =========================================================
   2) Callback OAuth
   ========================================================= */
router.get('/auth/callback', async (req, res) => {
  const { shop, host, code } = req.query;
  if (!shop || !host || !code) {
    return res.status(400).send('Faltan parámetros en callback');
  }

  try {
    /* Intercambia el “code” por access_token */
    const { data } = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id:     SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    /* Guarda / actualiza conexión (todavía sin userId) */
    await ShopConnections.findOneAndUpdate(
      { shop },
      { shop, accessToken: data.access_token, installedAt: Date.now() },
      { upsert: true }
    );
  } catch (err) {
    console.error('❌ Error obteniendo access_token:', err.response?.data || err);
    return res.status(500).send('Falló intercambio de token');
  }

  /* Redirige al interfaz embebido */
  return res.redirect(
    `/connector/interface?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
  );
});

/* =========================================================
   3) Webhooks de privacidad
   ========================================================= */
router.use('/webhooks', require('./webhooks'));

/* =========================================================
   4) Interfaz embebida (HTML dentro del iframe)
   ========================================================= */
router.get('/interface', (req, res) => {
  /* Estos headers eran los que cumplían la verificación de Shopify */
  res.setHeader(
    'Content-Security-Policy',
    'frame-ancestors https://admin.shopify.com https://*.myshopify.com'
  );
  res.removeHeader('X-Frame-Options');

  res.sendFile(path.join(__dirname, '../../public/connector/interface.html'));
});

module.exports = router;
