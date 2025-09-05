// backend/routes/googleConnect.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const qs      = require('querystring');
const User    = require('../models/User');

let GoogleAccount = null;
try { GoogleAccount = require('../models/GoogleAccount'); } catch (_) {}

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GOOGLE_CONNECT_CALLBACK_URL;

// Guard simple
function requireAuth(req, res, next) {
  if (!req.isAuthenticated?.() || !req.user?._id) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  next();
}

// STEP 1: redirigir a Google OAuth
router.get('/connect', (req, res) => {
  if (!req.isAuthenticated?.()) return res.redirect('/');

  const state = req.sessionID;
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    access_type:   'offline',            // refresh_token
    include_granted_scopes: 'true',
    prompt:        'consent',            // forzar refresh_token en cada conexión
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords'
    ].join(' '),
    state
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// STEP 2: callback
router.get('/connect/callback', async (req, res) => {
  if (!req.isAuthenticated?.()) return res.redirect('/');

  const { code } = req.query || {};
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
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );

    const {
      access_token,
      refresh_token, // puede venir undefined si se había concedido antes
      expires_in,
      id_token,
      scope = ''
    } = tokenRes.data || {};

    // email desde el id_token (JWT)
    let email = '';
    if (id_token) {
      const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64').toString());
      email = payload.email || '';
    }

    const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

    // Persistir en User (si ya lo venías usando)
    const userUpdate = {
      googleConnected:    true,
      googleAccessToken:  access_token,
    };
    if (refresh_token) userUpdate.googleRefreshToken = refresh_token;
    if (email)         userUpdate.googleEmail = email;
    await User.findByIdAndUpdate(req.user._id, userUpdate);

    // Persistir en GoogleAccount (colección separada)
    if (GoogleAccount) {
      await GoogleAccount.findOneAndUpdate(
        { user: req.user._id },
        {
          $set: {
            email,
            access_token,
            refresh_token: refresh_token || undefined,
            expires_at:    expiresAt,
            scopes:        String(scope).split(' ').filter(Boolean),
          }
        },
        { upsert: true, new: true }
      );
    }

    // Vuelve al onboarding con marca explícita
    return res.redirect('/onboarding?google=ok');
  } catch (err) {
    console.error('❌ Google connect callback error:', err.response?.data || err.message);
    return res.redirect('/onboarding?google=error');
  }
});

// Estado para el frontend
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (GoogleAccount) {
      const doc = await GoogleAccount.findOne({ user: req.user._id }).select('access_token objective').lean();
      return res.json({
        connected: !!doc?.access_token,
        objective: doc?.objective || null
      });
    } else {
      const u = await User.findById(req.user._id).select('googleAccessToken googleObjective').lean();
      return res.json({
        connected: !!u?.googleAccessToken,
        objective: u?.googleObjective || null
      });
    }
  } catch (e) {
    return res.json({ connected: false, objective: null });
  }
});

// Guardar objetivo
router.post('/objective', requireAuth, express.json(), async (req, res) => {
  const allowed = ['ventas', 'alcance', 'leads'];
  const { objective } = req.body || {};
  if (!allowed.includes(objective)) {
    return res.status(400).json({ error: 'objetivo_invalido' });
  }
  try {
    if (GoogleAccount) {
      await GoogleAccount.findOneAndUpdate(
        { user: req.user._id },
        { $set: { objective } },
        { upsert: true }
      );
    } else {
      await User.findByIdAndUpdate(req.user._id, { $set: { googleObjective: objective } });
    }
    res.json({ ok: true, objective });
  } catch (e) {
    res.status(500).json({ error: 'save_failed' });
  }
});

module.exports = router;
