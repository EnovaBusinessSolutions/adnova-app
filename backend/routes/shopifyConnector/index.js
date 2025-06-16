// routes/shopifyConnector/index.js
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const path = require('path');               
const axios = require('axios');               
const ShopConnections = require('../../models/ShopConnections'); 

const {
  SHOPIFY_API_KEY,
  SHOPIFY_APP_HANDLE
} = process.env;

const SCOPES       = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://adnova-app.onrender.com/connector/auth/callback';


function startOAuth(req, res) {
  const { shop, host } = req.query;
   if (!shop || !host) {
    return res.status(400).send('Faltan shop o host en la query');
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(host)) {
    return res.status(400).send('Host inválido');
  }
  
  if (!shop || !host) {
    return res.status(400).send('Faltan shop o host en la query');
  }

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;


  return res.redirect(installUrl);
}

['/grant', '/app/grant'].forEach(path => {
  router.get(path, startOAuth);
});

router.get('/', (req, res) => {
  const { shop, host } = req.query;
  if (shop && host) {
    return startOAuth(req, res);
  }

  return res.send('👍 Adnova Connector online');
});


router.get('/auth/callback', async (req, res) => {
  const { shop, host, code } = req.query;
  if (!shop || !host || !code) {
    return res.status(400).send('Faltan parámetros en callback');
  }

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


    await ShopConnections.findOneAndUpdate(
      { shop },
      { shop, accessToken: data.access_token, installedAt: Date.now() },
      { upsert: true }
    );

  } catch (err) {
    console.error('❌ Error obteniendo access_token:', err.response?.data || err);
    return res.status(500).send('Falló intercambio de token');
  }
  return res.redirect(
    `/connector/interface?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
  );
});

router.use('/webhooks', require('./webhooks'));

router.get('/interface', (req, res) => {
  res.sendFile(
    path.join(__dirname, '../../public/connector/interface.html')
  );
});

module.exports = router;