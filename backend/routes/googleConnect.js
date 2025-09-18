'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');

/* ============================================================
 * Modelo GoogleAccount “resiliente” (si no existe el require)
 * ============================================================ */
let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user:             { type: Schema.Types.ObjectId, ref: 'User', index: true },
      userId:           { type: Schema.Types.ObjectId, ref: 'User' },
      accessToken:      { type: String, select: false },
      refreshToken:     { type: String, select: false },
      managerCustomerId:{ type: String },
      defaultCustomerId:{ type: String },
      customers:        { type: Array },
      objective:        { type: String },
    },
    { collection: 'googleaccounts', timestamps: true }
  );
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* ========================
 * ENV
 * ====================== */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL, // ej: https://ai.adnova.digital/auth/google/connect/callback
} = process.env;

/* ========================
 * Helpers / middlewares
 * ====================== */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function oauth() {
  return new OAuth2Client({
    clientId:     GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri:  GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/* ============================================================
 * 1) Iniciar conexión
 *    GET /auth/google/connect[?returnTo=/onboarding%3Fgoogle%3Dconnected]
 * ============================================================ */
router.get('/connect', requireSession, async (req, res) => {
  try {
    const client   = oauth();
    const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
      ? req.query.returnTo
      : '/onboarding?google=connected';

    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // asegura refresh_token la primera vez
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        // Google Ads:
        'https://www.googleapis.com/auth/adwords',
        // Agrega Analytics si lo necesitas:
        // 'https://www.googleapis.com/auth/analytics.readonly',
      ],
      state: JSON.stringify({
        uid: String(req.user._id),
        returnTo,
      }),
    });

    return res.redirect(url);
  } catch (err) {
    console.error('google connect error:', err);
    return res.redirect('/onboarding?google=error&reason=connect_build');
  }
});

/* ============================================================
 * 2) Callback OAuth
 *    Acepta /auth/google/callback y /auth/google/connect/callback
 * ============================================================ */
async function googleCallbackHandler(req, res) {
  try {
    if (req.query.error) {
      // Usuario canceló o Google devolvió error
      return res.redirect(`/onboarding?google=error&reason=${encodeURIComponent(req.query.error)}`);
    }

    const code = req.query.code;
    if (!code) {
      return res.redirect('/onboarding?google=error&reason=no_code');
    }

    const client   = oauth();
    const { tokens } = await client.getToken(code); // { access_token, refresh_token?, expiry_date, ... }

    if (!tokens?.access_token) {
      return res.redirect('/onboarding?google=error&reason=no_access_token');
    }

    // Guarda/actualiza tokens
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const update = {
      user:        req.user._id,
      userId:      req.user._id,
      accessToken: tokens.access_token,
    };
    if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;

    await GoogleAccount.findOneAndUpdate(q, update, { upsert: true, new: true, setDefaultsOnInsert: true });

    // Marca al usuario como conectado
    await User.findByIdAndUpdate(req.user._id, { $set: { googleConnected: true } });

    // Resuelve returnTo desde state (si viene)
    let returnTo = '/onboarding?google=connected';
    if (req.query.state) {
      try {
        const s = JSON.parse(req.query.state);
        if (s && typeof s.returnTo === 'string' && s.returnTo.trim()) {
          returnTo = s.returnTo;
        }
      } catch (_) {
        // state malformado: ignorar silenciosamente
      }
    }

    return res.redirect(returnTo);
  } catch (err) {
    console.error('google callback error:', err?.response?.data || err);
    return res.redirect('/onboarding?google=error&reason=callback_exception');
  }
}

// Alias para ambos endpoints de callback
router.get('/callback',         requireSession, googleCallbackHandler);
router.get('/connect/callback', requireSession, googleCallbackHandler);

/* ============================================================
 * 3) Status para onboarding
 *    GET /auth/google/status
 * ============================================================ */
router.get('/status', requireSession, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    const connectedFlag = !!user?.googleConnected;

    // validación suave con GoogleAccount
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+refreshToken +accessToken objective defaultCustomerId')
      .lean();

    const hasTokens = !!ga?.refreshToken || !!ga?.accessToken;

    return res.json({
      ok: true,
      connected: connectedFlag && hasTokens,
      objective: user?.googleObjective || ga?.objective || null,
      defaultCustomerId: ga?.defaultCustomerId || null,
    });
  } catch (err) {
    console.error('google status error:', err);
    return res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

/* ============================================================
 * 4) Guardar objetivo
 *    POST /auth/google/objective  body: { objective: "ventas"|"alcance"|"leads" }
 * ============================================================ */
router.post('/objective', requireSession, express.json(), async (req, res) => {
  try {
    const { objective } = req.body || {};
    const val = String(objective || '').trim();

    if (!['ventas', 'alcance', 'leads'].includes(val)) {
      return res.status(400).json({ ok: false, error: 'BAD_OBJECTIVE' });
    }

    await User.findByIdAndUpdate(req.user._id, { $set: { googleObjective: val } });
    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { objective: val } },
      { upsert: true }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('save objective error:', err);
    return res.status(500).json({ ok: false, error: 'SAVE_OBJECTIVE_ERROR' });
  }
});

module.exports = router;
