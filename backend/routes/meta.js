// backend/routes/meta.js
const express = require('express');
const axios   = require('axios');
const User    = require('../models/User');

const router = express.Router();

// === Config ===
const FB_VERSION   = 'v20.0';
const FB_DIALOG    = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_GRAPH     = `https://graph.facebook.com/${FB_VERSION}`;

const APP_ID       = process.env.FACEBOOK_APP_ID;
const APP_SECRET   = process.env.FACEBOOK_APP_SECRET;
// Debe ser EXACTAMENTE el mismo que configuraste en la consola
// Ej: https://ai.adnova.digital/auth/meta/callback
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;

// Los permisos que ya añadiste en "Permisos y funciones"
const SCOPES = ['public_profile','email'].join(',');

// GET /auth/meta/login -> redirige al diálogo OAuth
router.get('/login', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  // usa el sessionID como state (igual que en Google)
  const state = req.sessionID;

  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_type: 'code',
    state,
    // Opcional si alguna vez el usuario negó permisos y quieres rerequest:
    // auth_type: 'rerequest'
  });

  return res.redirect(`${FB_DIALOG}?${params.toString()}`);
});

// GET /auth/meta/callback -> intercambia code, llama /me y guarda
router.get('/callback', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const { code } = req.query;
  if (!code) return res.redirect('/onboarding?meta=fail');

  try {
    // 1) Intercambio code -> access_token
    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code
      }
    });
    const { access_token, token_type, expires_in } = tokenRes.data;

    // 2) *** Llamada a Graph para que cuente como "Llamadas a la API" ***
    //    y para recuperar id/email.
    const meRes = await axios.get(`${FB_GRAPH}/me`, {
      params: { fields: 'id,name,email', access_token }
    });
    const { id: fbUserId, email, name } = meRes.data;

    // 3) Guarda en Mongo y marca metaConnected = true
    const updates = {
      metaConnected: true,
      metaAccessToken: access_token,
      metaFbUserId: fbUserId,
      metaEmail: email || null,
      metaTokenType: token_type || null,
      metaTokenExpiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null
    };

    const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, { new: true });

    // 4) Refresca la sesión para que /api/session devuelva metaConnected: true de inmediato
    req.login(updatedUser, (err) => {
      if (err) {
        console.error('req.login error:', err);
        return res.redirect('/onboarding?meta=error');
      }
      return res.redirect('/onboarding?meta=ok');
    });
  } catch (err) {
    console.error('❌ Error en callback de Meta:', err.response?.data || err.message);
    return res.redirect('/onboarding?meta=error');
  }
});

module.exports = router;
