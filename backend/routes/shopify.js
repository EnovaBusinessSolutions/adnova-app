// backend/routes/shopify.js

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ensureAuthenticated } = require('../middleware/auth'); // ajusta ruta si tu middleware está en otro lugar

const router = express.Router();

// Scopes que pide tu aplicación de Shopify
const SCOPES = 'read_products,read_customers,read_orders'; // ajusta según lo que necesites
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

// ─────────────────────────────────────────────────────────────────
// 1) Endpoint para iniciar el OAuth con Shopify
// ─────────────────────────────────────────────────────────────────

// GET /api/shopify/connect?userId=...&shop=mi-tienda.myshopify.com
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

    // 1.1) Generamos un nonce que combine userId y un valor aleatorio
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `${nonce}_${userId}`;

    // 1.2) Guardamos el state en la sesión para verificarlo luego
    req.session.shopifyState = state;

    // 1.3) Construimos la URL de autorización de Shopify
    const redirectUri = `${process.env.APP_URL}/api/shopify/callback`;
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;

    // 1.4) Redirigimos al merchant a la página de autorización de Shopify
    return res.redirect(installUrl);
  }
);

// ─────────────────────────────────────────────────────────────────
// 2) Callback que Shopify invoca tras instalar la app
// ─────────────────────────────────────────────────────────────────

// GET /api/shopify/callback?shop=…&code=…&hmac=…&state=…
router.get(
  '/callback',
  async (req, res) => {
    const { shop, hmac, code, state } = req.query;
    if (!shop || !hmac || !code || !state) {
      console.warn('⚠️ Parámetros faltantes en Shopify callback:', req.query);
      return res.redirect('/onboarding?error=missing_params');
    }

    // 2.1) Verificar que el state coincida con el guardado en sesión
    if (state !== req.session.shopifyState) {
      console.warn('⚠️ State inválido en Shopify callback:', {
        recibido: state,
        esperado: req.session.shopifyState,
      });
      return res.redirect('/onboarding?error=invalid_state');
    }

    // 2.2) Validación HMAC
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
      // 2.3) Intercambiar 'code' por access_token
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

      // 2.4) Extraer userId del state (state guardado como `${nonce}_${userId}`)
      const parts = state.split('_');
      const userId = parts.pop();

      // 2.5) Calcular hash de scopes y timestamp (opcional, pero recomendado para verificar futuros cambios de permisos)
      const scopeHash = crypto
        .createHash('sha256')
        .update(SCOPES)
        .digest('hex');
      const scopeHashUpdatedAt = Date.now();

      // 2.6) Actualizar en MongoDB: marcar shopifyConnected = true
      await User.findByIdAndUpdate(userId, {
        shop,
        shopifyAccessToken: accessToken,
        shopifyConnected: true,
        shopifyScopeHash: scopeHash,
        shopifyScopeHashUpdatedAt: scopeHashUpdatedAt,
      });

      console.log(`✅ Shopify conectado para usuario ${userId}`);

      // 2.7) Generar JWT para el front-end (opcional, solo para verificar en JS)
      const payload = { shop };
      const tokenJwt = jwt.sign(payload, SHOPIFY_API_SECRET);

      // 2.8) Redirigir al onboarding con el JWT en query
      return res.redirect(`/onboarding?shopifyToken=${tokenJwt}`);
    } catch (err) {
      console.error(
        '❌ Error al intercambiar code por access_token en Shopify callback:',
        err.response?.data || err
      );
      return res.redirect('/onboarding?error=token_exchange_failed');
    }
  }
);

module.exports = router;
