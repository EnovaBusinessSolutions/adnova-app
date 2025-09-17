'use strict';

const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');

const router = express.Router();

const User = require('../models/User');
let GoogleAccount = null;
try { GoogleAccount = require('../models/GoogleAccount'); } catch (_) {}

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID, // opcional (tu MCC)
} = process.env;

const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'openid',
  'email',
  'profile',
];

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect('/login');
}

function oAuthClient() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/* =========================
   Conectar (OAuth consent)
   ========================= */
router.get('/connect', requireAuth, (req, res) => {
  const client = oAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',                // para refresh_token
    prompt: 'consent',                     // garantiza refresh_token la 1ª vez
    scope: SCOPES,
    include_granted_scopes: true,
  });
  res.redirect(url);
});

/* =========================
   Callback
   ========================= */
router.get('/connect/callback', requireAuth, async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.redirect('/onboarding?google=error');

    const client = oAuthClient();
    const { tokens } = await client.getToken(code);
    // tokens: { access_token, refresh_token?, expiry_date, scope, ... }
    client.setCredentials(tokens);

    // Guardamos/actualizamos doc
    const userId = req.user._id;

    // 1) Obtener lista de cuentas accesibles
    const { data: listData } = await axios.get(
      'https://googleads.googleapis.com/v16/customers:listAccessibleCustomers',
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'developer-token': GOOGLE_DEVELOPER_TOKEN,
        },
      }
    );
    const resourceNames = listData.resourceNames || []; // ["customers/123...", ...]

    // 2) Elegimos la primera y leemos detalles básicos del customer con GAQL
    let customers = [];
    let defaultCustomerId = null;

    if (resourceNames.length > 0) {
      const firstId = String(resourceNames[0]).replace('customers/', '');
      defaultCustomerId = firstId;

      const gaql = `
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone
        FROM customer
        LIMIT 50
      `;

      const { data: searchRes } = await axios.post(
        `https://googleads.googleapis.com/v16/customers/${firstId}/googleAds:search`,
        { query: gaql },
        {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'developer-token': GOOGLE_DEVELOPER_TOKEN,
            ...(GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { 'login-customer-id': GOOGLE_ADS_LOGIN_CUSTOMER_ID } : {}),
            'Content-Type': 'application/json',
          },
        }
      );

      const rows = searchRes.results || [];
      customers = rows.map(r => ({
        id: r?.customer?.id || firstId,
        resourceName: `customers/${r?.customer?.id || firstId}`,
        descriptiveName: r?.customer?.descriptiveName || null,
        currencyCode: r?.customer?.currencyCode || null,
        timeZone: r?.customer?.timeZone || null,
      }));
      if (!customers.length) {
        customers.push({
          id: firstId,
          resourceName: `customers/${firstId}`,
          descriptiveName: null,
          currencyCode: null,
          timeZone: null,
        });
      }
    }

    // 3) Persistimos
    if (GoogleAccount) {
      await GoogleAccount.findOneAndUpdate(
        { $or: [{ userId }, { user: userId }] },
        {
          $set: {
            userId, user: userId,
            accessToken: tokens.access_token || undefined,
            refreshToken: tokens.refresh_token || undefined,
            scope: (tokens.scope || '').split(' ').filter(Boolean),
            expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            managerCustomerId: GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined,
            customers,
            defaultCustomerId,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );
    }

    await User.findByIdAndUpdate(userId, { $set: { googleConnected: true } });

    // refrescamos sesión y volvemos al onboarding con ?google=ok
    const destino = req.user.onboardingComplete ? '/dashboard' : '/onboarding?google=ok';
    req.login(req.user, () => res.redirect(destino));
  } catch (err) {
    console.error('❌ Google connect callback error:', err?.response?.data || err.message);
    res.redirect('/onboarding?google=error');
  }
});

/* =========================
   STATUS para onboarding
   ========================= */
// GET /auth/google/status -> { connected, objective }
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (!GoogleAccount) return res.json({ connected: !!req.user.googleConnected, objective: null });

    const doc = await GoogleAccount
      .findOne({ $or: [{ userId: req.user._id }, { user: req.user._id }] })
      .select('+refreshToken +accessToken objective defaultCustomerId')
      .lean();

    const connected = !!(doc?.refreshToken || doc?.accessToken);
    return res.json({ connected, objective: doc?.objective || null });
  } catch (e) {
    console.error('google/status error:', e);
    res.status(500).json({ error: 'STATUS_ERROR' });
  }
});

/* =========================
   Guardar objetivo onboarding
   ========================= */
router.post('/objective', requireAuth, express.json(), async (req, res) => {
  try {
    const allowed = new Set(['ventas', 'alcance', 'leads']);
    const objective = String(req.body?.objective || '').toLowerCase();
    if (!allowed.has(objective)) {
      return res.status(400).json({ ok: false, error: 'INVALID_OBJECTIVE' });
    }

    if (!GoogleAccount) return res.status(500).json({ ok: false, error: 'MODEL_NOT_FOUND' });

    const doc = await GoogleAccount.findOneAndUpdate(
      { $or: [{ userId: req.user._id }, { user: req.user._id }] },
      { $set: { objective } },
      { new: true, upsert: false }
    ).lean();

    if (!doc) return res.status(404).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });

    res.json({ ok: true, objective });
  } catch (e) {
    console.error('google/objective error:', e);
    res.status(500).json({ ok: false, error: 'OBJECTIVE_SAVE_ERROR' });
  }
});

module.exports = router;
