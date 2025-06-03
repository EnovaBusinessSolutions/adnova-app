const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const qs = require('querystring');
const router = express.Router();
const User = require('../models/User');
const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_REDIRECT_URI,
  DEFAULT_SHOP,
} = process.env;

const SCOPES = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_analytics',
].join(',');

// 🔗 Iniciar conexión con Shopify
router.get('/connect', (req, res) => {
  const { userId, shop } = req.query;

  if (!userId) return res.status(400).send('❌ Falta userId');
  if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/i.test(shop)) {
    return res.status(400).send('❌ Dominio de tienda inválido');
  }

  const nonce = crypto.randomBytes(12).toString('hex');
  req.session.shopifyState = `${nonce}_${userId}`;

  const authUrl = `https://${shop}/admin/oauth/authorize?` + qs.stringify({
    client_id: SHOPIFY_API_KEY,
    scope: SCOPES,
    redirect_uri: SHOPIFY_REDIRECT_URI,
    state: req.session.shopifyState,
  });

  res.redirect(authUrl);
});

// 🪝 Callback OAuth después de la autorización de Shopify
router.get('/callback', async (req, res) => {
  console.log('🔥 Entró a /callback con query:', req.query);

  const { shop, hmac, code, state } = req.query;

  if (!shop || !hmac || !code || !state) {
    console.warn('⚠️ Parámetros faltantes en callback:', req.query);
    return res.redirect('/onboarding?error=missing_params');
  }

  if (state !== req.session.shopifyState) {
    console.warn('⚠️ Estado inválido en OAuth callback:', {
      recibido: state,
      esperado: req.session.shopifyState,
    });
    return res.redirect('/onboarding?error=invalid_state');
  }

  // Validar HMAC
  const msg = Object.keys(req.query)
    .filter(k => k !== 'signature' && k !== 'hmac')
    .sort()
    .map(k => `${k}=${req.query[k]}`)
    .join('&');

  const generatedHmac = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(msg)
    .digest('hex');

  if (generatedHmac !== hmac) {
    console.warn('❌ HMAC inválido');
    return res.redirect('/onboarding?error=invalid_hmac');
  }

  try {
    // Solicitar token de acceso
    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    const userId = state.split('_').pop();

    await User.findByIdAndUpdate(userId, {
      shop,
      shopifyAccessToken: accessToken,
      shopifyConnected: true,
      shopifyScopeHash: crypto.createHash('sha256').update(SCOPES).digest('hex'),
    });

    console.log(`✅ Shopify conectado para usuario ${userId}`);
    res.redirect('/onboarding');
  } catch (err) {
    console.error('❌ Error al intercambiar token con Shopify:', err.response?.data || err);
    res.redirect('/onboarding?error=token_exchange_failed');
  }
});

// Ruta de prueba protegida por token verificado
router.get('/protected', verifyShopifyToken, (req, res) => {
  res.json({ success: true, message: '✅ Acceso autorizado con token de Shopify' });
});

module.exports = router;
