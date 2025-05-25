const express       = require('express');
const router        = express.Router();
const querystring   = require('querystring');

const SHOPIFY_API_KEY   = process.env.SHOPIFY_API_KEY;
const REDIRECT_URI_RAW  = process.env.SHOPIFY_REDIRECT_URI;           // ← texto puro
const REDIRECT_URI_ENC  = encodeURIComponent(REDIRECT_URI_RAW);       // ← codificada UNA VEZ

router.get('/connect', (req, res) => {
  const { shop, userId } = req.query;
  if (!shop || !userId) return res.status(400).send('Faltan shop o userId');

  const scopes = [
    'read_products',
    'read_orders',
    'read_customers',
    'read_analytics'
  ].join(',');

  /* Construimos la URL final */
  const authUrl =
    `https://${shop}/admin/oauth/authorize?` +
    querystring.stringify({
      client_id    : SHOPIFY_API_KEY,
      scope        : scopes,
      redirect_uri : REDIRECT_URI_ENC,   // ← ya codificada una sola vez
      state        : userId
    });

  /* (opcional) log para depurar */
  console.log('Auth URL:', decodeURIComponent(authUrl));

  res.redirect(authUrl);
});

module.exports = router;
