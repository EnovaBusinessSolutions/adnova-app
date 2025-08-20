// backend/routes/meta.js
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const MetaAccount = require('../models/MetaAccount'); // lo creamos en el punto 4

const router = express.Router();

const FB_VERSION = 'v20.0'; // usa la versión que tengas disponible
const FB_DIALOG = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_GRAPH  = `https://graph.facebook.com/${FB_VERSION}`;

const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;

// Cambia los scopes cuando pidas más (por ahora sólo login básico)
const SCOPES = ['public_profile','email'].join(',');

// GET /auth/meta/login  -> redirige al diálogo OAuth
router.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.fb_state = state; // anti-CSRF

  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: SCOPES,
    response_type: 'code',
  });

  res.redirect(`${FB_DIALOG}?${params.toString()}`);
});

// GET /auth/meta/callback  -> intercambia "code" por token y guarda
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) return res.status(400).send('Falta el parámetro code');
    if (!state || state !== req.session.fb_state) {
      return res.status(400).send('Estado inválido');
    }
    delete req.session.fb_state;

    // 1) Intercambio del code por un token de usuario (corto)
    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      },
    });

    const shortLivedToken = tokenRes.data.access_token;
    const shortExp = tokenRes.data.expires_in;

    // 2) (opcional pero recomendado) convertir a token de larga duración
    let accessToken = shortLivedToken;
    let expiresIn = shortExp;

    try {
      const longRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: APP_ID,
          client_secret: APP_SECRET,
          fb_exchange_token: shortLivedToken,
        },
      });
      accessToken = longRes.data.access_token || accessToken;
      expiresIn   = longRes.data.expires_in   || expiresIn;
    } catch (e) {
      // si falla, seguimos con el de corta duración
      console.warn('No se pudo obtener token de larga duración:', e?.response?.data || e.message);
    }

    // 3) Perfil básico del usuario
    const meRes = await axios.get(`${FB_GRAPH}/me`, {
      params: { fields: 'id,name,email', access_token: accessToken },
    });
    const { id: fbUserId, name, email } = meRes.data;

    // 4) Guardar/actualizar en DB (ver modelo en el punto 4)
    const userId = req.user?._id || null; // si usas sesión con tu usuario del SaaS
    const expiresAt = new Date(Date.now() + (expiresIn || 0) * 1000);

    await MetaAccount.findOneAndUpdate(
      { fb_user_id: fbUserId, user: userId },
      { name, email, access_token: accessToken, expires_at: expiresAt },
      { upsert: true, new: true }
    );

    // 5) Redirige de vuelta a tu UI
    res.redirect('/?connected=facebook'); // ajústalo a tu UI del onboarding
  } catch (err) {
    console.error('FB callback error:', err?.response?.data || err);
    res.status(500).send('Error al conectar con Meta');
  }
});

module.exports = router;
