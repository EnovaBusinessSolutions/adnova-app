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

// 🔹 2. Ruta callback que recibe el code y guarda los tokens
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;

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
    if (!userId) return res.status(401).send('No autenticado');

    await User.findByIdAndUpdate(userId, {
      googleAccessToken: access_token,
      googleRefreshToken: refresh_token,
      googleConnected: true
    });

    return res.redirect('/onboarding/connect'); // Puedes cambiar esto si quieres redirigir a otro paso
  } catch (err) {
    console.error('❌ Error al obtener access token:', err.response?.data || err.message);
    res.status(500).send('Error al conectar con Google');
  }
});

module.exports = router;
