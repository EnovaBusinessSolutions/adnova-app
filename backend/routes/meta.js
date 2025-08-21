// routes/meta.js
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();

const FB_VERSION = 'v20.0';
const FB_DIALOG  = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;

const APP_ID       = process.env.FACEBOOK_APP_ID;
const APP_SECRET   = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI; // https://ai.adnova.digital/auth/meta/callback

const SCOPES = ['public_profile','email'].join(',');

// 1) Login: guarda userId y state
router.get('/login', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/login'); // asegúrate que solo usuarios logueados hagan el vínculo
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.fb_state  = state;
  req.session.fb_userId = req.user._id.toString();  // <--- guarda userId aquí

  const params = new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    response_type: 'code',
    state
  });

  res.redirect(`${FB_DIALOG}?${params.toString()}`);
});

// 2) Callback: usa req.user o el id guardado en sesión
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Falta code');

    if (!state || state !== req.session.fb_state) {
      return res.redirect('/onboarding?meta=error'); // CSRF/state mismatch
    }
    delete req.session.fb_state;

    // Intercambia code por token
    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        client_id:     APP_ID,
        client_secret: APP_SECRET,
        redirect_uri:  REDIRECT_URI,
        code
      }
    });
    const { access_token } = tokenRes.data;

    // (opcional) Trae info básica
    let me = {};
    try {
      const meRes = await axios.get(`${FB_GRAPH}/me`, {
        params: { access_token, fields: 'id,name,email' }
      });
      me = meRes.data || {};
    } catch {}

    // Determina el userId
    const userId =
      (req.user && req.user._id) ||
      req.session.fb_userId;                  // <--- usa el que guardaste
    if (!userId) {
      console.error('⚠️ No hay userId en sesión para ligar Meta');
      return res.redirect('/onboarding?meta=error');
    }
    delete req.session.fb_userId;

    // Marca conectado en BD
    await require('../models/User').findByIdAndUpdate(
      userId,
      {
        metaConnected: true,
        metaAccessToken: access_token,
        metaUserId: me.id,
        metaEmail: me.email
      }
    );

    return res.redirect('/onboarding?meta=ok');
  } catch (err) {
    console.error('❌ META CALLBACK', err.response?.data || err.message);
    return res.redirect('/onboarding?meta=error');
  }
});

module.exports = router;
