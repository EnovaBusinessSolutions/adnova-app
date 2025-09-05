// backend/routes/googleConnect.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const qs      = require('querystring');
const crypto  = require('crypto');
const User    = require('../models/User');

// ENV
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GOOGLE_CONNECT_CALLBACK_URL;

// helper auth
function requireAuth(req, res, next) {
  if (!req.isAuthenticated?.() || !req.user?._id) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  return next();
}

// scopes (incluye openid/email para obtener id_token y email)
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/adwords',
].join(' ');

/* ──────────────────────────────────────────────────────────
 * Iniciar OAuth
 * ────────────────────────────────────────────────────────── */
router.get('/connect', requireAuth, (req, res) => {
  // CSRF 'state'
  const state = crypto.randomBytes(16).toString('hex');
  req.session.g_state = state;

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    access_type:   'offline',           // refresh_token
    include_granted_scopes: 'true',
    prompt:        'consent',           // fuerza pantalla para refresh_token
    scope:         SCOPES,
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

/* ──────────────────────────────────────────────────────────
 * Callback OAuth
 * ────────────────────────────────────────────────────────── */
router.get('/connect/callback', requireAuth, async (req, res) => {
  const { code, state } = req.query || {};

  if (!code || !state || state !== req.session.g_state) {
    return res.redirect('/onboarding?google=error');
  }
  delete req.session.g_state;

  try {
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const { access_token, refresh_token, id_token, scope } = tokenRes.data;

    // decodificar email del id_token (si vino)
    let decodedEmail = '';
    if (id_token) {
      try {
        const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64').toString('utf8'));
        decodedEmail = payload?.email || '';
      } catch {}
    }

    const update = {
      googleConnected:    true,
      googleAccessToken:  access_token || null,
      googleRefreshToken: refresh_token || null,
      googleScopes:       scope ? scope.split(' ') : [],
    };
    if (decodedEmail) update.googleEmail = decodedEmail;

    await User.findByIdAndUpdate(req.user._id, update, { new: false });
    console.log('✅ Google conectado para usuario', req.user._id);

    // avisa al frontend que el OAuth terminó bien
    return res.redirect('/onboarding?google=ok');
  } catch (err) {
    console.error('❌ Error en Google callback:', err.response?.data || err.message);
    return res.redirect('/onboarding?google=error');
  }
});

/* ──────────────────────────────────────────────────────────
 * NUEVO: Estado para el paso de objetivo de Google
 * GET /auth/google/status  -> { connected, objective }
 * ────────────────────────────────────────────────────────── */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id)
      .select('googleConnected googleAccessToken googleObjective')
      .lean();

    const connected = !!(u?.googleConnected || u?.googleAccessToken);
    const objective = u?.googleObjective || null;

    return res.json({ connected, objective });
  } catch (e) {
    return res.status(500).json({ error: 'status_failed' });
  }
});

/* ──────────────────────────────────────────────────────────
 * NUEVO: Guardar objetivo de Google
 * POST /auth/google/objective  body: { objective: 'ventas'|'alcance'|'leads' }
 * ────────────────────────────────────────────────────────── */
router.post('/objective', requireAuth, express.json(), async (req, res) => {
  const allowed = ['ventas', 'alcance', 'leads']; // "Mensajes/Formulario" = 'leads'
  const { objective } = req.body || {};
  if (!allowed.includes(objective)) {
    return res.status(400).json({ error: 'objetivo_invalido' });
  }

  try {
    await User.findByIdAndUpdate(
      req.user._id,
      { $set: { googleObjective: objective } },
      { new: false },
    );
    return res.json({ ok: true, objective });
  } catch (e) {
    return res.status(500).json({ error: 'save_failed' });
  }
});

module.exports = router;
