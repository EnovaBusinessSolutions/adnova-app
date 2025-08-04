// routes/shopifyConnector/index.js
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const router  = express.Router();
const ShopConnections = require('../../models/ShopConnections');

const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;

const SCOPES       = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://ai.adnova.digital/connector/auth/callback';

/* ---------------------------------------------------- */
/* Util: genera y hace redirect al endpoint de OAuth    */
/* ---------------------------------------------------- */
function startOAuth (req, res) {
  let shop = req.query.shop || req.headers['x-shopify-shop-domain'];

  if (!shop) return res.status(400).send('Falta parámetro shop');

  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  return res.redirect(url);               // <-- termina aquí
}

/* ---------------------------------------------------- */
/* 1) Entrada genérica (health + disparador OAuth)      */
/* ---------------------------------------------------- */
['/grant', '/app/grant', '/'].forEach(p =>
  router.get(p, (req, res) => {
    const { shop } = req.query;

    console.log('[connector] incoming', { path: p, shop });

    /* Si trae ?shop => siempre inicia OAuth, no importa hmac/host */
    if (shop) return startOAuth(req, res);

    /* Solo health-check */
    res.send('👍 Adnova Connector online');
  })
);

/* ---------------------------------------------------- */
/* 2) Callback de OAuth                                 */
/* ---------------------------------------------------- */
router.get('/auth/callback', async (req, res) => {
  const { shop, host, code } = req.query;
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

    /* Dentro del admin embebido */
    return res.redirect(
      `/apps/${SHOPIFY_API_KEY}/connector/interface?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host || '')}`
    );
  } catch (err) {
    console.error('❌ access_token error:', err.response?.data || err);
    return res.status(500).send('Token exchange failed');
  }
});

/* ---------------------------------------------------- */
/* 3) Webhooks sub-router                               */
/* ---------------------------------------------------- */
router.use('/webhooks', require('./webhooks'));

/* ---------------------------------------------------- */
/* 4) Interfaz embebida                                 */
/* ---------------------------------------------------- */
router.get('/interface', async (req, res) => {
  let shop = req.query.shop;

  /* Intenta detectar shop por header o referer si no viene en query */
  if (!shop && req.headers['x-shopify-shop-domain']) {
    shop = req.headers['x-shopify-shop-domain'];
  }
  if (!shop && req.headers.referer) {
    const m = req.headers.referer.match(/shop=([a-zA-Z0-9\-\.]+\.myshopify\.com)/);
    if (m) shop = m[1];
  }

  if (!shop) {
    return res.status(400).send(
      'No se detectó la tienda (shop). Instala la app usando el link directo.'
    );
  }

  const shopConn = await ShopConnections.findOne({ shop });

  /* Sin token => redirige a flujo OAuth */
  if (!shopConn || !shopConn.accessToken) {
    console.log('[interface] No token aún, redirigiendo a OAuth');
    return res.redirect(`/connector?shop=${encodeURIComponent(shop)}`);
  }

  /* Sirve la SPA embebida */
  return res.sendFile(path.join(__dirname, '../../../public/connector/interface.html'));
});

module.exports = router;
