const express = require('express');
const router = express.Router();
const qs = require('querystring');
const axios = require('axios');
const User = require('../models/User');

const clientId = process.env.META_APP_ID;
const clientSecret = process.env.META_APP_SECRET;
const redirectUri = 'https://ai.adnova.digital/auth/meta/callback';

router.get('/login', (req, res) => {
  const state = req.sessionID;
  const scope = ['ads_read', 'ads_management', 'business_management'].join(',');
  const authUrl =
    'https://www.facebook.com/v16.0/dialog/oauth?' +
    qs.stringify({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope
    });
  res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/onboarding?meta=fail');

  try {
    const tokenRes = await axios.get(
      `https://graph.facebook.com/v16.0/oauth/access_token?client_id=${clientId}` +
      `&redirect_uri=${redirectUri}&client_secret=${clientSecret}&code=${code}`
    );
    const { access_token } = tokenRes.data;

    let userId = req.session.userId;
    if (!userId) return res.redirect('/onboarding?meta=invalid_session');

    await User.findByIdAndUpdate(userId, {
      metaAccessToken: access_token,
      metaConnected: true,
    });

    console.log('✅ Meta conectado para el usuario:', userId);
    res.redirect('/onboarding');
  } catch (error) {
    console.error('❌ Error al obtener el token de Meta:', error.message);
    res.redirect('/onboarding?meta=fail');
  }
});

module.exports = router;
