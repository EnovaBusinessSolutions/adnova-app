// routes/auth/meta.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../../models/User');

const clientId = process.env.META_APP_ID;
const clientSecret = process.env.META_APP_SECRET;
const redirectUri = 'https://adnova-app.onrender.com/auth/meta/callback';

// 1. Redirige a Facebook con los permisos adecuados
router.get('/login', (req, res) => {
  const scope = [
    'ads_read',
    'ads_management',
    'business_management',
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic',
    'public_profile',
    'email',
  ].join(',');

  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`;
  res.redirect(authUrl);
});

// 2. Callback que recibe el `code` y guarda el access_token
router.get('/callback', async (req, res) => {
  const code = req.query.code;

  if (!code || !req.session.userId) {
    return res.redirect('/onboarding?meta=error');
  }

  try {
    const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      },
    });

    const accessToken = response.data.access_token;

    // Guarda el token y marca conexión en MongoDB
    await User.findByIdAndUpdate(req.session.userId, {
      metaAccessToken: accessToken,
      metaConnected: true,
    });

    console.log('✅ Meta conectado para el usuario:', req.session.userId);
    res.redirect('/onboarding');

  } catch (error) {
    console.error('❌ Error al obtener el token de Meta:', error.message);
    res.redirect('/onboarding?meta=fail');
  }
});

module.exports = router;
