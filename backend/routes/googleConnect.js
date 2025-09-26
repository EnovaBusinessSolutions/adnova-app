'use strict';

const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');

/* =========================
 * Modelo GoogleAccount (fallback si falla el require)
 * ========================= */
let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user:              { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId:            { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },

      accessToken:       { type: String, select: false },
      refreshToken:      { type: String, select: false },
      scope:             { type: [String], default: [] },
      expiresAt:         { type: Date },

      // Google Ads
      managerCustomerId: { type: String },
      defaultCustomerId: { type: String },
      customers:         { type: Array, default: [] },

      // GA4
      gaProperties:      { type: Array, default: [] },
      defaultPropertyId: { type: String, default: null },

      objective:         { type: String, enum: ['ventas','alcance','leads'], default: null },
      createdAt:         { type: Date, default: Date.now },
      updatedAt:         { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );
  schema.pre('save', function (next) { this.updatedAt = new Date(); next(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* =========================
 * ENV
 * ========================= */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,   // redirectUri usado en este router
  GOOGLE_DEVELOPER_TOKEN,        // Ads developer token
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,  // opcional: manager CID sin guiones
} = process.env;

const ADS_API = 'https://googleads.googleapis.com/v16';
const DEFAULT_GOOGLE_OBJECTIVE = 'ventas';

/* =========================
 * Middlewares / helpers
 * ========================= */
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

const normId = (s='') => String(s).replace(/-/g, '').trim();
const normalizeScopes = (raw) => Array.from(
  new Set(
    (Array.isArray(raw) ? raw : String(raw || '').split(' '))
      .map(s => String(s || '').trim())
      .filter(Boolean)
  )
);

/* =========================
 * Google Ads: discovery
 * ========================= */
async function listAccessibleCustomers(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = String(GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, '');
  }

  const { data } = await axios.get(`${ADS_API}/customers:listAccessibleCustomers`, {
    headers,
    timeout: 20000,
  });

  return Array.isArray(data?.resourceNames) ? data.resourceNames : [];
}

async function fetchCustomer(accessToken, cid) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = String(GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, '');
  }

  const { data } = await axios.get(`${ADS_API}/customers/${cid}`, {
    headers,
    timeout: 15000,
  });

  return {
    id: normId(cid),
    resourceName: data?.resourceName || `customers/${cid}`,
    descriptiveName: data?.descriptiveName || null,
    currencyCode: data?.currencyCode || null,
    timeZone: data?.timeZone || null,
  };
}

async function discoverCustomers(accessToken) {
  const rn = await listAccessibleCustomers(accessToken);
  const ids = rn.map((r) => (r || '').split('/')[1]).filter(Boolean);
  const out = [];
  for (const cid of ids.slice(0, 50)) {
    try { out.push(await fetchCustomer(accessToken, cid)); }
    catch { /* errores individuales */ }
  }
  // dedupe por id
  const map = new Map();
  for (const c of out) map.set(c.id, c);
  return Array.from(map.values());
}

/* =========================
 * GA4: properties
 * ========================= */
async function fetchGA4Properties(oauthClient) {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: oauthClient });
  const out = [];
  let pageToken;
  do {
    // properties.search devuelve todas a las que el usuario tiene acceso
    const resp = await admin.properties.search({
      requestBody: { query: "" },
      pageToken,
      pageSize: 200,
    });
    (resp.data.properties || []).forEach((p) => {
      out.push({
        propertyId: p.name,            // "properties/123"
        displayName: p.displayName || p.name,
        timeZone: p.timeZone || null,
        currencyCode: p.currencyCode || null,
      });
    });
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);

  // dedupe por propertyId
  const map = new Map();
  for (const p of out) map.set(p.propertyId, p);
  return Array.from(map.values());
}

/* =========================
 * Rutas
 * ========================= */

// Iniciar OAuth
router.get('/connect', requireSession, async (req, res) => {
  try {
    const client   = oauth();
    const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
      ? req.query.returnTo
      : '/onboarding?google=connected';

    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/adwords',
        'https://www.googleapis.com/auth/analytics.readonly',
        'openid'
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

// Callback OAuth
async function googleCallbackHandler(req, res) {
  try {
    if (req.query.error) {
      return res.redirect(`/onboarding?google=error&reason=${encodeURIComponent(req.query.error)}`);
    }
    const code = req.query.code;
    if (!code) {
      return res.redirect('/onboarding?google=error&reason=no_code');
    }

    const client = oauth();
    const { tokens } = await client.getToken(code);
    if (!tokens?.access_token) {
      return res.redirect('/onboarding?google=error&reason=no_access_token');
    }

    const accessToken  = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt    = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    const grantedScopes = normalizeScopes(tokens.scope);

    // Descubre Google Ads
    let customers = [];
    try {
      customers = await discoverCustomers(accessToken);
    } catch (e) {
      console.warn('⚠️ no se pudieron listar customers:', e?.response?.data || e.message);
    }
    const defaultCustomerId = customers?.[0]?.id || null;

    // Descubre GA4 (mismo cliente OAuth con credenciales)
    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
      expiry_date: tokens.expiry_date,
    });

    let gaProps = [];
    try {
      gaProps = await fetchGA4Properties(client);
    } catch (e) {
      console.warn('⚠️ no se pudieron listar GA4 properties:', e?.response?.data || e.message);
    }
    const defaultPropertyId = gaProps?.[0]?.propertyId || null;

    // Upsert en Mongo
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const update = {
      user: req.user._id,
      userId: req.user._id,
      accessToken,
      expiresAt,
      customers,
      gaProperties: gaProps,
      ...(defaultPropertyId ? { defaultPropertyId } : {}),
      scope: grantedScopes,
      ...(defaultCustomerId ? { defaultCustomerId } : {}),
      updatedAt: new Date(),
    };
    if (refreshToken) update.refreshToken = refreshToken;

    await GoogleAccount.findOneAndUpdate(q, update, { upsert: true, new: true, setDefaultsOnInsert: true });

    // Marca usuario como conectado a Google
    await User.findByIdAndUpdate(req.user._id, { $set: { googleConnected: true } });

    // Setea objetivo por defecto si no existe aún
    const [uObj, gaObj] = await Promise.all([
      User.findById(req.user._id).select('googleObjective').lean(),
      GoogleAccount.findOne(q).select('objective').lean()
    ]);

    if (!(uObj?.googleObjective) && !(gaObj?.objective)) {
      await Promise.all([
        User.findByIdAndUpdate(req.user._id, { $set: { googleObjective: DEFAULT_GOOGLE_OBJECTIVE } }),
        GoogleAccount.findOneAndUpdate(q, { $set: { objective: DEFAULT_GOOGLE_OBJECTIVE, updatedAt: new Date() } })
      ]);
    }

    // Redirección final
    let returnTo = '/onboarding?google=connected';
    if (req.query.state) {
      try {
        const s = JSON.parse(req.query.state);
        if (s && typeof s.returnTo === 'string' && s.returnTo.trim()) returnTo = s.returnTo;
      } catch { /* ignore */ }
    }
    return res.redirect(returnTo);
  } catch (err) {
    console.error('google callback error:', err?.response?.data || err.message || err);
    return res.redirect('/onboarding?google=error&reason=callback_exception');
  }
}

router.get('/callback',         requireSession, googleCallbackHandler);
router.get('/connect/callback', requireSession, googleCallbackHandler);

/* =========================
 * Estado y cuentas Ads (con refresh token si es necesario)
 * ========================= */
router.get('/status', requireSession, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).lean();

    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+refreshToken +accessToken objective defaultCustomerId customers managerCustomerId scope')
      .lean();

    const hasTokens = !!(ga?.refreshToken || ga?.accessToken);
    const customers = Array.isArray(ga?.customers) ? ga.customers : [];
    const defaultCustomerId = ga?.defaultCustomerId || customers?.[0]?.id || null;

    res.json({
      ok: true,
      connected: !!u?.googleConnected && hasTokens,
      hasCustomers: customers.length > 0,
      defaultCustomerId,
      customers,
      scopes: Array.isArray(ga?.scope) ? ga.scope : [],
      objective: u?.googleObjective || ga?.objective || null,
      managerCustomerId: ga?.managerCustomerId || null,
    });
  } catch (err) {
    console.error('google status error:', err);
    res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

router.get('/accounts', requireSession, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers scope')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, customers: [], defaultCustomerId: null, scopes: [] });
    }

    // Asegura access token fresco
    let accessToken = ga.accessToken;
    if ((!accessToken || accessToken.length < 10) && ga.refreshToken) {
      const client = oauth();
      client.setCredentials({ refresh_token: ga.refreshToken });
      try {
        const t = await client.getAccessToken();
        accessToken = t?.token || accessToken;
      } catch {}
    }

    let customers = ga.customers || [];

    if (!customers || customers.length === 0) {
      try {
        customers = await discoverCustomers(accessToken);
      } catch (e) {
        // Si falló por expiración, intenta refrescar y reintenta una vez
        if (ga.refreshToken) {
          try {
            const client = oauth();
            client.setCredentials({ refresh_token: ga.refreshToken });
            const t = await client.getAccessToken();
            accessToken = t?.token || accessToken;
            customers = await discoverCustomers(accessToken);
          } catch {}
        }
      }
      await GoogleAccount.updateOne(
        { _id: ga._id },
        { $set: { customers, updatedAt: new Date() } }
      );
    }

    const defaultCustomerId = ga.defaultCustomerId || customers?.[0]?.id || null;
    res.json({ ok: true, customers, defaultCustomerId, scopes: Array.isArray(ga?.scope) ? ga.scope : [] });
  } catch (err) {
    console.error('google accounts error:', err);
    res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

router.post('/default-customer', requireSession, express.json(), async (req, res) => {
  try {
    const cid = normId(req.body?.customerId || '');
    if (!cid) return res.status(400).json({ ok: false, error: 'CUSTOMER_REQUIRED' });

    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultCustomerId: cid, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ ok: true, defaultCustomerId: cid });
  } catch (err) {
    console.error('google default-customer error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_CUSTOMER_ERROR' });
  }
});

/* =========================
 * Objetivo (Ads)
 * ========================= */
router.post('/objective', requireSession, express.json(), async (req, res) => {
  try {
    const val = String(req.body?.objective || '').trim().toLowerCase();
    if (!['ventas', 'alcance', 'leads'].includes(val)) {
      return res.status(400).json({ ok: false, error: 'BAD_OBJECTIVE' });
    }

    await User.findByIdAndUpdate(req.user._id, { $set: { googleObjective: val } });
    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { objective: val, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('save objective error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_OBJECTIVE_ERROR' });
  }
});

module.exports = router;
