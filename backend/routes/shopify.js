const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const qs = require('querystring');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_REDIRECT_URI,
  // Eliminamos DEFAULT_SHOP: ya no lo usamos aquí
} = process.env;

const SCOPES = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_analytics',
].join(',');

/* ---------- /connect ---------- */
router.get('/connect', (req, res) => {
  const userId = req.query.userId;
  const shop = req.query.shop; // Ya no usamos DEFAULT_SHOP

  if (!userId) return res.status(400).send('Falta userId');
  if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/i.test(shop)) {
    return res.status(400).send('Dominio shop inválido');
  }

  const nonce = crypto.randomBytes(12).toString('hex');
  req.session.shopifyState = `${nonce}_${userId}`;

  const authUrl =
    `https://${shop}/admin/oauth/authorize?` +
    qs.stringify({
      client_id: SHOPIFY_API_KEY,
      scope: SCOPES,
      redirect_uri: SHOPIFY_REDIRECT_URI,
      state: req.session.shopifyState,
    });

  res.redirect(authUrl);
});

/* ---------- /callback ---------- */
// routes/shopify.js (MODIFICADO)

router.get('/callback', async (req, res) => {
  console.log('🔥 Entró a /callback con query:', req.query);

  const { shop, hmac, code, state } = req.query;
  if (!shop || !hmac || !code || !state) {
    return res.redirect('/onboarding?error=missing_params');
  }

  // Verificas state y HMAC aquí (mismo que antes)

  try {
    // 1) Intercambio de code → access_token
    const tokenRes = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const accessToken = tokenRes.data.access_token;

    // 2) Extraer userId desde state
    const userId = state.split('_').pop();

    // ─────────────────────────────────────────────────────────────────
    // 3) ACTUALIZAR en Mongo: marcar shopifyConnected = true
    await User.findByIdAndUpdate(userId, {
      shop,
      shopifyAccessToken: accessToken,
      shopifyConnected: true,                  // <— campo agregado
      shopifyScopeHash: crypto
        .createHash('sha256')
        .update(SCOPES)
        .digest('hex'),
      shopifyScopeHashUpdatedAt: Date.now()
    });
    console.log(`✅ Shopify conectado para usuario ${userId}`);
    // ─────────────────────────────────────────────────────────────────

    // 4) Generar JWT para front-end (opcional)
    const payload = { shop };
    const tokenJwt = jwt.sign(payload, SHOPIFY_API_SECRET);

    // 5) Redirigir de nuevo a onboarding con el token en query
    return res.redirect(`/onboarding?shopifyToken=${tokenJwt}`);
  } catch (err) {
    console.error('❌ Error al intercambiar token:', err.response?.data || err);
    return res.redirect('/onboarding?error=token_exchange_failed');
  }
});

/* ---------- Ruta protegida de prueba ---------- */
router.get('/protected', verifyShopifyToken, (req, res) => {
  res.json({ success: true, message: 'Access granted via verified Shopify token' });
});

module.exports = router;
