const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('querystring');
const User = require('../backend/models/User');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'https://adnova-app.onrender.com/google/callback';

// 🔹 1. Ruta para iniciar la conexión con Google (flujo OAuth)
router.get('/google', (req, res) => {
  const scope = [
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/adwords'
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${qs.stringify({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent'
  })}`;

  res.redirect(authUrl);
});

// 🔹 2. Callback después del consentimiento de Google
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    console.error('❌ No se recibió código de autorización');
    return res.redirect('/onboarding?error=missing_code');
  }

  try {
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token } = tokenRes.data;

    const userId = req.session.userId || req.user?._id;

    if (!userId) {
      console.warn('⚠️ No hay sesión activa al volver de Google');
      return res.redirect('/onboarding?google=fail');
    }

    await User.findByIdAndUpdate(userId, {
      googleAccessToken: access_token,
      googleRefreshToken: refresh_token,
      googleConnected: true
    });

    console.log('✅ Google conectado para el usuario:', userId);
    return res.redirect('/onboarding'); // vuelve al paso de conexión

  } catch (err) {
    console.error('❌ Error al obtener access token:', err.response?.data || err.message);
    return res.redirect('/onboarding?google=error');
  }
});

module.exports = router;
