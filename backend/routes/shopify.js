// backend/routes/shopify.js
'use strict';

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ensureAuthenticated } = require('../auth');

const router = express.Router();

// Scopes compartidos con el conector (o fallback por defecto)
const SHOPIFY_SCOPES =
  process.env.SHOPIFY_SCOPES ||
  'read_products,read_customers,read_orders';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

// Redirect específico para el flujo SAAS (NO el del conector)
const SAAS_REDIRECT_URI =
  process.env.SHOPIFY_SAAS_REDIRECT_URI ||
  'https://adray.ai/api/shopify/callback';

if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
  console.warn(
    '[SHOPIFY_SAAS] ⚠️ Faltan SHOPIFY_API_KEY o SHOPIFY_API_SECRET en el entorno.'
  );
}

router.get('/connect', ensureAuthenticated, async (req, res) => {
  try {
    const { shop } = req.query;
    // Preferimos el userId autenticado; si viene por query, lo respetamos por compatibilidad
    const userId = req.query.userId || (req.user && req.user._id && req.user._id.toString());

    if (!userId || !shop) {
      return res
        .status(400)
        .send('Faltan parámetros: userId y shop son requeridos.');
    }

    // State = nonce + userId
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `${nonce}_${userId}`;
    req.session.shopifyState = state;

    const installUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(SHOPIFY_API_KEY)}` +
      `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(SAAS_REDIRECT_URI)}` +
      `&state=${encodeURIComponent(state)}`;

    return res.redirect(installUrl);
  } catch (e) {
    console.error('[SHOPIFY_SAAS][CONNECT_ERROR]', e);
    return res
      .status(500)
      .send('Error iniciando la conexión con Shopify desde el SAAS.');
  }
});

router.get('/callback', async (req, res) => {
  const { shop, hmac, code, state } = req.query;

  if (!shop || !hmac || !code || !state) {
    console.warn('⚠️ Parámetros faltantes en Shopify callback SAAS:', req.query);
    return res.redirect('/onboarding?error=missing_params');
  }

  // Validar state contra sesión
  if (state !== req.session.shopifyState) {
    console.warn('⚠️ State inválido en Shopify callback SAAS:', {
      recibido: state,
      esperado: req.session.shopifyState,
    });
    return res.redirect('/onboarding?error=invalid_state');
  }

  // Validar HMAC
  const map = { ...req.query };
  delete map.signature;
  delete map.hmac;

  const message = Object.keys(map)
    .sort()
    .map((key) => `${key}=${map[key]}`)
    .join('&');

  const generatedHash = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(generatedHash, 'utf-8'),
        Buffer.from(hmac, 'utf-8')
      )
    ) {
      console.warn('⚠️ HMAC inválido en Shopify callback SAAS');
      return res.redirect('/onboarding?error=invalid_hmac');
    }
  } catch (e) {
    console.warn('⚠️ Error comparando HMAC en Shopify callback SAAS', e);
    return res.redirect('/onboarding?error=invalid_hmac');
  }

  try {
    // Intercambiar code por access_token
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

    // Recuperar userId desde el state
    const parts = state.split('_');
    const userId = parts.pop();

    // Hash de scopes para detectar cambios futuros
    const scopeHash = crypto
      .createHash('sha256')
      .update(SHOPIFY_SCOPES)
      .digest('hex');
    const scopeHashUpdatedAt = Date.now();

    await User.findByIdAndUpdate(userId, {
      shop,
      shopifyAccessToken: accessToken,
      shopifyConnected: true,
      shopifyScopeHash: scopeHash,
      shopifyScopeHashUpdatedAt: scopeHashUpdatedAt,
    });

    console.log(`✅ Shopify conectado para usuario ${userId} (SAAS)`);

    // Token JWT opcional (por si luego lo usamos para algo)
    const payload = { shop };
    const tokenJwt = jwt.sign(payload, SHOPIFY_API_SECRET, {
      expiresIn: '1h',
    });
    // De momento no lo usamos, pero lo dejamos por si quieres guardarlo / usarlo luego.

    // Tras conectar desde el SAAS, lo normal es regresar al onboarding
    // para que el usuario vea el estado "Shopify conectado".
    return res.redirect('/onboarding?shopify=connected');
  } catch (err) {
    console.error(
      '❌ Error al intercambiar code por access_token en Shopify callback SAAS:',
      err.response?.data || err
    );
    return res.redirect('/onboarding?error=token_exchange_failed');
  }
});

// Alias sencillo: /api/shopify/auth/shopify?shop=xxx
// (por si lo usabas antes en el front)
router.get('/auth/shopify', ensureAuthenticated, (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Falta el parámetro ?shop');
  }

  const userId = req.user && req.user._id && req.user._id.toString();
  if (!userId) {
    return res
      .status(401)
      .send('No hay usuario autenticado para vincular con Shopify.');
  }

  const url =
    `/api/shopify/connect?shop=${encodeURIComponent(shop)}` +
    `&userId=${encodeURIComponent(userId)}`;

  return res.redirect(url);
});

module.exports = router;
