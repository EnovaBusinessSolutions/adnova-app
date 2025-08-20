// backend/routes/googleConnect.js
const express = require('express');
const router = express.Router();
const axios  = require('axios');
const qs     = require('querystring');
const User   = require('../models/User');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GOOGLE_CONNECT_CALLBACK_URL;

router.get('/connect', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const state = req.sessionID;

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    access_type:   'offline',            // refresh_token
    include_granted_scopes: 'true',      // incremental auth
    prompt:        'consent',            // fuerza el diálogo (importante al añadir scopes)
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/analytics.edit'  // <— aquí estaba faltando la coma
    ].join(' '),
    state
  });

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/connect/callback', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const { code } = req.query;
  if (!code) return res.redirect('/onboarding?google=fail');

  try {
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

    let decodedEmail = '';
    if (id_token) {
      const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64').toString());
      decodedEmail = payload.email || '';
    }

    const updateData = {
      googleConnected:    true,
      googleAccessToken:  access_token,
      googleRefreshToken: refresh_token // ojo: puede venir vacío si el usuario ya concedió antes sin prompt=consent
    };
    if (decodedEmail) updateData.googleEmail = decodedEmail;

    await User.findByIdAndUpdate(req.user._id, updateData);
    console.log('✅ Google Analytics/Ads conectado para usuario:', req.user._id);

    return res.redirect('/onboarding');
  } catch (err) {
    console.error('❌ Error intercambiando tokens de Analytics/Ads:', err.response?.data || err.message);
    return res.redirect('/onboarding?google=error');
  }
});

module.exports = router;
