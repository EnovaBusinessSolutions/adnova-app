// backend/routes/shopifyConnector/index.js
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const router  = express.Router();

const ShopConnections = require('../../models/ShopConnections');

const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;

/* ---------- Constantes ---------- */
const SCOPES       = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://adnova-app.onrender.com/connector/auth/callback';

/* ---------- 1. Arranque del OAuth ---------- */
function startOAuth(req, res) {
  const { shop, host } = req.query;
  if (!shop || !host) {
    return res.status(400).send('Faltan parámetros shop u host.');
  }

  /* URL de instalación */
  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  return res.redirect(installUrl); // 302
}

/* /connector/grant y /connector/app/grant (tests de Shopify) */
['/grant', '/app/grant'].forEach(p => router.get(p, startOAuth));

/* GET /connector?shop=…&host=…  */
router.get('/', (req, res) => {
  const { shop, host } = req.query;
  if (shop && host) return startOAuth(req, res);
  return res.send('👍 Adnova AI Connector online');
});

/* ---------- 2. Callback ---------- */
router.get('/auth/callback', async (req, res) => {
  const { shop, host, code } = req.query;
  if (!shop || !host || !code) {
    return res.status(400).send('Faltan parámetros en callback.');
  }

  try {
    /* 2-A. Intercambiamos code → access_token */
    const { data } = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id:     SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    /* 2-B. Guardamos la conexión (upsert) */
    await ShopConnections.findOneAndUpdate(
      { shop },
      { shop, accessToken: data.access_token, installedAt: Date.now() },
      { upsert: true }
    );

    /* 2-C. Redirigimos al interfaz embebido */
    return res.redirect(
      `/connector/interface?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
    );
  } catch (err) {
    console.error('❌ Error obteniendo access_token:', err.response?.data || err);
    return res.status(500).send('Falló el intercambio de token');
  }
});

/* ---------- 3. Webhooks de privacidad ---------- */
router.use('/webhooks', require('./webhooks'));

/* ---------- 4. Interfaz HTML dentro del iframe ---------- */
router.get('/interface', (req, res) => {
  res.sendFile(
    path.join(__dirname, '../../../public/connector/interface.html')
  );
});

module.exports = router;
