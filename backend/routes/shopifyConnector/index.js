// routes/shopifyConnector/index.js
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const path = require('path');                 // ← para sendFile del interfaz
const axios = require('axios');               // ← para pedir access_token
const ShopConnections = require('../../models/ShopConnections'); // ← modelo nuevo

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

// 4) Callback OAuth: obtiene access_token, lo guarda y muestra interfaz
router.get('/auth/callback', async (req, res) => {
  const { shop, host, code } = req.query;
  if (!shop || !host || !code) {
    return res.status(400).send('Faltan parámetros en callback');
  }

  // 4-A · Intercambiar `code` por access_token
  try {
    const { data } = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id:  SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // 4-B · Guardar / actualizar en ShopConnections (aún sin userId)
    await ShopConnections.findOneAndUpdate(
      { shop },
      { shop, accessToken: data.access_token, installedAt: Date.now() },
      { upsert: true }
    );

  } catch (err) {
    console.error('❌ Error obteniendo access_token:', err.response?.data || err);
    return res.status(500).send('Falló intercambio de token');
  }

  // 4-C · Redirigir al interfaz embebido con instrucciones
  return res.redirect(
    `/connector/interface?shop=${encodeURIComponent(shop)}`
  );
});

// 5) Webhooks de privacidad (HMAC) — dejalos como tenías
router.use('/webhooks', require('./webhooks'));

// routes/shopifyConnector/index.js
router.get('/interface', (req,res)=>{
  res.setHeader(
    'Content-Security-Policy',
    'frame-ancestors https://admin.shopify.com https://*.myshopify.com'
  );
  res.removeHeader('X-Frame-Options');
  res.sendFile(path.join(__dirname,'../../public/connector/interface.html'));
});

module.exports = router;