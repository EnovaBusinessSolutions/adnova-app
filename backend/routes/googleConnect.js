// googleConnect.js (modificado)
const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs    = require('querystring');
const User  = require('../models/User');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Este es ahora el connect callback correcto:
const REDIRECT_URI  = 'https://adnova-app.onrender.com/auth/google/connect/callback';

//
// 1) Dispara el OAuth únicamente para Analytics & Ads
//
router.get('/auth/google/connect', (req, res) => {
  // 1A) Si no está logueado, no puede conectar Analytics → redirigir a login
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  // 1B) Armar la URL de autorización de Google SOLO para Analytics/Ads
  const state  = req.sessionID;
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    access_type:   'offline',
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords'
    ].join(' '),
    state
  });

  // Redirige al diálogo de Google para solicitar SOLO estos scopes
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

//
// 2) Callback de Google tras aceptar Analytics/Ads
//
router.get('/auth/google/connect/callback', async (req, res) => {
  // 2A) Validar que el usuario siga logueado
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const { code } = req.query;
  if (!code) {
    // Usuario canceló o Google devolvió error
    return res.redirect('/onboarding?google=fail');
  }

  try {
    // 2B) Intercambiar el “code” por tokens
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, id_token } = tokenRes.data;

    // 2C) (Opcional) extraer email del id_token
    let decodedEmail = '';
    if (id_token) {
      const payload = JSON.parse(
        Buffer.from(id_token.split('.')[1], 'base64').toString()
      );
      decodedEmail = payload.email || '';
    }

    // 2D) Guardar sólo en el documento existente (no crear uno nuevo)
    const updateData = {
      googleConnected:    true,
      googleAccessToken:  access_token,
      googleRefreshToken: refresh_token
    };
    if (decodedEmail) {
      updateData.googleEmail = decodedEmail;
    }

    await User.findByIdAndUpdate(req.user._id, updateData);
    console.log('✅ Google Analytics/Ads conectado para usuario:', req.user._id);

    // 2E) Volver a /onboarding para pintar el botón “Connected”
    return res.redirect('/onboarding');
  } catch (err) {
    console.error(
      '❌ Error intercambiando tokens de Analytics/Ads:',
      err.response?.data || err.message
    );
    return res.redirect('/onboarding?google=error');
  }
});

module.exports = router;
