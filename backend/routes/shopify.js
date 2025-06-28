// backend/routes/shopify.js

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ensureAuthenticated } = require('../auth');
const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');

const router = express.Router();

const SCOPES = 'read_products,read_customers,read_orders'; 
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

router.get(
  '/connect',
  ensureAuthenticated,
  async (req, res) => {
    const { userId, shop } = req.query;
    if (!userId || !shop) {
      return res
        .status(400)
        .send('Faltan parámetros: userId y shop son requeridos.');
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `${nonce}_${userId}`;

    req.session.shopifyState = state;

    const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;

    return res.redirect(installUrl);
  }
);

router.get(
  '/callback',
  async (req, res) => {
    const { shop, hmac, code, state } = req.query;
    if (!shop || !hmac || !code || !state) {
      console.warn('⚠️ Parámetros faltantes en Shopify callback:', req.query);
      return res.redirect('/onboarding?error=missing_params');
    }

    if (state !== req.session.shopifyState) {
      console.warn('⚠️ State inválido en Shopify callback:', {
        recibido: state,
        esperado: req.session.shopifyState,
      });
      return res.redirect('/onboarding?error=invalid_state');
    }

    const map = { ...req.query };
    delete map['signature'];
    delete map['hmac'];
    const message = Object.keys(map)
      .sort()
      .map((key) => `${key}=${map[key]}`)
      .join('&');

    const generatedHash = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(message)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(generatedHash), Buffer.from(hmac))) {
      console.warn('⚠️ HMAC inválido en Shopify callback');
      return res.redirect('/onboarding?error=invalid_hmac');
    }

    try {
      const tokenRequestUrl = `https://${shop}/admin/oauth/access_token`;
      const tokenPayload = {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      };
      const tokenResponse = await axios.post(tokenRequestUrl, tokenPayload, {
        headers: { 'Content-Type': 'application/json' },
      });

      const accessToken = tokenResponse.data.access_token;

      const parts = state.split('_');
      const userId = parts.pop();

  
      const scopeHash = crypto
        .createHash('sha256')
        .update(SCOPES)
        .digest('hex');
      const scopeHashUpdatedAt = Date.now();

      await User.findByIdAndUpdate(userId, {
        shop,
        shopifyAccessToken: accessToken,
        shopifyConnected: true,
        shopifyScopeHash: scopeHash,
        shopifyScopeHashUpdatedAt: scopeHashUpdatedAt,
      });

      console.log(`✅ Shopify conectado para usuario ${userId}`);


      const payload = { shop };
      const tokenJwt = jwt.sign(payload, SHOPIFY_API_SECRET);

      return res.redirect(`/apps/${SHOPIFY_API_KEY}/connector/interface?shop=${shop}`);
    } catch (err) {
      console.error(
        '❌ Error al intercambiar code por access_token en Shopify callback:',
        err.response?.data || err
      );
      return res.redirect('/onboarding?error=token_exchange_failed');
    }
  }
);

router.get('/auth/shopify', (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Falta el parámetro ?shop');
  }

  return res.redirect(`/api/shopify/connect?shop=${shop}&userId=auto`);
});

module.exports = router; 