'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');

// Modelo GoogleAccount “resiliente” si no existe require(...)
let GoogleAccount;
try { GoogleAccount = require('../models/GoogleAccount'); } catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    managerCustomerId: String,
    defaultCustomerId: String,
    customers: Array,
    objective: String,
  }, { collection: 'googleaccounts', timestamps: true });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
} = process.env;

function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function oauth() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/* =========================
   1) Iniciar conexión
   GET /auth/google/connect
   ========================= */
router.get('/connect', requireSession, async (req, res) => {
  try {
    const client = oauth();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // asegura refresh_token la primera vez
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        // Ads:
        'https://www.googleapis.com/auth/adwords',
        // (agrega analytics si lo necesitas)
        // 'https://www.googleapis.com/auth/analytics.readonly',
      ],
      state: JSON.stringify({
        uid: String(req.user._id),
        returnTo: '/onboarding?google=connected',
      }),
    });
    return res.redirect(url);
  } catch (err) {
    console.error('google connect error:', err);
    return res.redirect('/onboarding?google=error&reason=connect_build');
  }
});

/* =========================
   2) Callback OAuth
   GET /auth/google/callback
   ========================= */
router.get('/callback', requireSession, async (req, res) => {
  try {
    if (req.query.error) {
      // Usuario canceló o Google devolvió error
      return res.redirect(`/onboarding?google=error&reason=${encodeURIComponent(req.query.error)}`);
    }

    const code = req.query.code;
    if (!code) {
      return res.redirect('/onboarding?google=error&reason=no_code');
    }

    const client = oauth();
    const { tokens } = await client.getToken(code);
    // tokens: access_token, refresh_token (si prompt=consent), expiry_date, etc.

    if (!tokens?.access_token) {
      return res.redirect('/onboarding?google=error&reason=no_access_token');
    }

    // Guarda/actualiza la cuenta Google de este usuario
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const update = {
      user: req.user._id,
      userId: req.user._id,
      accessToken: tokens.access_token,
    };
    if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;

    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
    await GoogleAccount.findOneAndUpdate(q, update, opts);

    // Marca al usuario como conectado
    await User.findByIdAndUpdate(req.user._id, { $set: { googleConnected: true } });

    // Redirige al onboarding; el JS consultará /auth/google/status
    return res.redirect('/onboarding?google=connected');
  } catch (err) {
    console.error('google callback error:', err?.response?.data || err);
    return res.redirect('/onboarding?google=error&reason=callback_exception');
  }
});

/* =========================
   3) Status para onboarding
   GET /auth/google/status
   ========================= */
router.get('/status', requireSession, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    const connected = !!user?.googleConnected;

    // opcional: validación “suave” si hay registro en GoogleAccount
    const ga = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+refreshToken +accessToken objective defaultCustomerId')
      .lean();

    const hasTokens = !!ga?.refreshToken || !!ga?.accessToken;

    return res.json({
      ok: true,
      connected: connected && hasTokens,
      objective: user?.googleObjective || ga?.objective || null,
      defaultCustomerId: ga?.defaultCustomerId || null,
    });
  } catch (err) {
    console.error('google status error:', err);
    return res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

/* =========================
   4) Guardar objetivo
   POST /auth/google/objective
   body: { objective: "ventas" | "alcance" | "leads" }
   ========================= */
router.post('/objective', requireSession, express.json(), async (req, res) => {
  try {
    const { objective } = req.body || {};
    if (!['ventas', 'alcance', 'leads'].includes(String(objective))) {
      return res.status(400).json({ ok: false, error: 'BAD_OBJECTIVE' });
    }
    await User.findByIdAndUpdate(req.user._id, { $set: { googleObjective: objective } });
    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { objective } },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('save objective error:', err);
    return res.status(500).json({ ok: false, error: 'SAVE_OBJECTIVE_ERROR' });
  }
});

module.exports = router;
