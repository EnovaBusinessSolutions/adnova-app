const express     = require('express');
const router      = express.Router();
const qs          = require('querystring');

const SHOPIFY_API_KEY  = process.env.SHOPIFY_API_KEY;
const REDIRECT_URI     = process.env.SHOPIFY_REDIRECT_URI.trim(); // ← limpia \n

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

  const authUrl =
    `https://${shop}/admin/oauth/authorize?` +
    qs.stringify({
      client_id   : SHOPIFY_API_KEY,
      scope       : scopes,
      redirect_uri: REDIRECT_URI,   // ← SIN encodeURIComponent
      state       : userId
    });

  console.log('[ShopifyOAuth] Auth URL:\n', decodeURIComponent(authUrl));
  res.redirect(authUrl);
  // 🔹 Callback de Shopify después del consentimiento del usuario
router.get('/callback', async (req, res) => {
  const { shop, code, state } = req.query;
  const userId = state;

  if (!shop || !code || !userId) {
    return res.status(400).send('Parámetros inválidos en el callback de Shopify');
  }

  try {
    // Intercambiar el code por access_token
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    });

    const accessToken = tokenResponse.data.access_token;

    // Guardar en MongoDB
    const User = require('../models/User');
    await User.findByIdAndUpdate(userId, {
      shopifyAccessToken: accessToken,
      shopifyConnected: true
    });

    console.log(`✅ Shopify conectado para usuario ${userId}`);
    res.redirect('/onboarding');
  } catch (err) {
    console.error('❌ Error al obtener access token de Shopify:', err.response?.data || err.message);
    res.redirect('/onboarding?shopify=error');
  }
});
});

module.exports = router;