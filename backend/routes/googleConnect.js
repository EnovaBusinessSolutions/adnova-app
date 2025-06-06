const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('querystring');
const User = require('../models/User');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'https://adnova-app.onrender.com/auth/google/login/callback';

router.get('/google', (req, res) => {
  const state = req.sessionID;
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    qs.stringify({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/adwords'
      ].join(' '),
      state
    });
  res.redirect(authUrl);
});

router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/onboarding?google=fail');

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

    let userId = req.session.userId;
    if (!userId) return res.redirect('/onboarding?google=invalid_session');

    await User.findByIdAndUpdate(userId, {
      googleAccessToken: access_token,
      googleRefreshToken: refresh_token,
      googleConnected: true
    });

    console.log('✅ Google conectado para el usuario:', userId);
    return res.redirect('/onboarding');
  } catch (err) {
    console.error('❌ Error al obtener access token:', err.response?.data || err.message);
    return res.redirect('/onboarding?google=error');
  }
});

module.exports = router;
