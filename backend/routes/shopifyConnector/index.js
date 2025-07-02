// routes/shopifyConnector/index.js
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const router  = express.Router();
const ShopConnections = require('../../models/ShopConnections');
const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;


const SCOPES       = 'read_products,read_customers,read_orders';
const REDIRECT_URI = 'https://adnova-app.onrender.com/connector/auth/callback';
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


['/grant', '/app/grant', '/'].forEach(p => router.get(p, (req, res) => {
  const { shop, host } = req.query;
  if (shop && host) return startOAuth(req, res);
  res.send('👍 Adnova Connector online');
}));


router.get('/auth/callback', async (req, res) => {
  const { shop, host, code } = req.query;
  if (!shop || !host || !code) return res.status(400).send('Missing params');

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

   
    return res.redirect(
  `/apps/${SHOPIFY_API_KEY}/connector/interface?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
);
  } catch (err) {
    console.error('❌ access_token error:', err.response?.data || err);
    return res.status(500).send('Token exchange failed');
  }
});

router.use('/webhooks', require('./webhooks'));
router.get('/interface', async (req, res) => {
  const { shop, host } = req.query;
  if (!shop || !host) {
    return res.status(400).send('Faltan parámetros "shop" y/o "host"');
  }

  // Busca en tu base si ya tienes accessToken de ese shop
  const shopConn = await ShopConnections.findOne({ shop });
  if (!shopConn || !shopConn.accessToken) {
    // No hay sesión, fuerza OAuth
    return res.redirect(`/connector?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`);
    // Nota: /connector ya inicia OAuth (ver tu código arriba)
  }

  // Si sí tienes token, muestra la UI embebida
  res.sendFile(path.join(__dirname, '../../../public/connector/interface.html'));
});


module.exports = router;
