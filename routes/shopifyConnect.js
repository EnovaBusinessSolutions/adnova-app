const express = require('express');
const router = express.Router();
const querystring = require('querystring');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;

// Ruta: http://localhost:3000/api/shopify/connect?shop=tu-tienda.myshopify.com&userId=ID123
router.get('/connect', (req, res) => {
  const { shop, userId } = req.query;

  if (!shop || !userId) {
    return res.status(400).send('Faltan parámetros: shop o userId');
  }

  const scopes = [
    'read_products',
    'read_orders',
    'read_customers',
    'read_analytics'
  ].join(',');

  const authUrl = `https://${shop}/admin/oauth/authorize?` + querystring.stringify({
    client_id: SHOPIFY_API_KEY,
    scope: scopes,
    redirect_uri: REDIRECT_URI,
    state: userId // Usado para identificar al usuario al volver
  });

  res.redirect(authUrl);
});

module.exports = router;
