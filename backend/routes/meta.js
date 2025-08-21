// backend/routes/meta.js
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const User = require('../models/User');
const MetaAccount = require('../models/MetaAccount');

const router = express.Router();

// === Config ===
const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_DIALOG  = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;

const APP_ID       = process.env.FACEBOOK_APP_ID;
const APP_SECRET   = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;

// p. ej. 'public_profile,email'
const SCOPES = ['public_profile', 'email'].join(',');

// Utilidad rápida
function mustAuth(req, res) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.redirect('/');
    return false;
  }
  return true;
}

/**
 * GET /auth/meta/login
 * Redirige al diálogo OAuth de Meta con anti-CSRF state
 */
router.get('/login', (req, res) => {
  if (!mustAuth(req, res)) return;

  const state = crypto.randomBytes(16).toString('hex');
  req.session.fb_state = state;

  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: SCOPES,
    response_type: 'code',
    auth_type: 'rerequest', // por si el usuario negó antes
  });

  const url = `${FB_DIALOG}?${params.toString()}`;
  return res.redirect(url);
});

/**
 * GET /auth/meta/callback
 * Intercambia "code" -> token, llama a /me y guarda en Mongo
 */
router.get('/callback', async (req, res) => {
  if (!mustAuth(req, res)) return;

  const { code, state } = req.query || {};
  if (!code) {
    return res.redirect('/onboarding?meta=fail');
  }
  if (!state || state !== req.session.fb_state) {
    return res.redirect('/onboarding?meta=fail');
  }

  try {
    // 1) code -> short-lived token
    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      },
    });

    let accessToken = tokenRes.data?.access_token;
    const tokenType = tokenRes.data?.token_type;
    const expiresIn = tokenRes.data?.expires_in;

    // 2) Opcional: intercambiar por long-lived token (más práctico para luego)
    try {
      const longRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: APP_ID,
          client_secret: APP_SECRET,
          fb_exchange_token: accessToken,
        },
      });
      if (longRes.data?.access_token) {
        accessToken = longRes.data.access_token;
      }
    } catch (e) {
      console.warn('⚠️ No se pudo obtener long-lived token:', e.response?.data || e.message);
    }

    // 3) Llamada real al Graph (esto cuenta para "Llamadas a la API")
    let fbUserId = null, fbName = null, fbEmail = null;
    try {
      const meRes = await axios.get(`${FB_GRAPH}/me`, {
        params: { fields: 'id,name,email', access_token: accessToken },
      });
      fbUserId = meRes.data?.id || null;
      fbName   = meRes.data?.name || null;
      fbEmail  = meRes.data?.email || null;
      console.log('✅ /me OK:', meRes.data);
    } catch (e) {
      console.error('❌ Error en /me:', e.response?.data || e.message);
    }

    // 4) Guardar/actualizar cuenta de Meta
    const now = new Date();
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await MetaAccount.findOneAndUpdate(
      { user: req.user._id },
      {
        access_token: accessToken,
        fb_user_id: fbUserId,
        name: fbName,
        email: fbEmail,
        createdAt: now,
        updatedAt: now,
        expires_at: expiresAt,
      },
      { upsert: true, new: true }
    );

    // 5) Marcar conectado en Users (y guarda token si quieres usarlo fácil)
    await User.findByIdAndUpdate(
      req.user._id,
      { metaConnected: true, metaAccessToken: accessToken },
      { new: true }
    );

    // Limpia el state anti-CSRF
    try { delete req.session.fb_state; } catch (_) {}

    return res.redirect('/onboarding?meta=ok');
  } catch (err) {
    console.error('❌ Callback Meta error:', err.response?.data || err.message);
    return res.redirect('/onboarding?meta=error');
  }
});

/**
 * GET /auth/meta/me
 * Ruta de prueba: usa el token guardado y pide /me (útil para “forzar” llamadas)
 */
router.get('/me', async (req, res) => {
  if (!mustAuth(req, res)) return;
  try {
    const acc = await MetaAccount.findOne({ user: req.user._id });
    if (!acc?.access_token) {
      return res.status(400).json({ error: 'Conecta Meta primero' });
    }
    const r = await axios.get(`${FB_GRAPH}/me`, {
      params: { fields: 'id,name,email', access_token: acc.access_token },
    });
    return res.json(r.data);
  } catch (err) {
    console.error('❌ /auth/meta/me:', err.response?.data || err.message);
    return res.status(500).json({
      error: 'Graph error',
      detail: err.response?.data || err.message,
    });
  }
});

module.exports = router;
