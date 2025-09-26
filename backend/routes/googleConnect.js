'use strict';

const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');

/* =========================
 * Modelo GoogleAccount (fallback si no existe)
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

      managerCustomerId: { type: String },
      defaultCustomerId: { type: String },

      customers:         { type: Array, default: [] },     // [{id, descriptiveName, currencyCode, timeZone, ...}]
      gaProperties:      { type: Array, default: [] },     // [{propertyId, displayName, timeZone, currencyCode}]
      defaultPropertyId: { type: String },                 // "properties/123456789"

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
  GOOGLE_CONNECT_CALLBACK_URL,   // redirect para conectar (Analytics/Ads)
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,  // opcional: MCC para headers (si no lo usas, déjalo vacío)
} = process.env;

/* =========================
 * Constantes
 * ========================= */
const DEFAULT_GOOGLE_OBJECTIVE = 'ventas';

/* =========================
 * Helpers comunes
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

/* =======================================================================
 * Google Ads: helpers con fallback de versión (v18 → v17 → v16) y GET/POST
 * ======================================================================= */
const ADS_VERSIONS = ['v18', 'v17', 'v16'];

function adsHeaders(accessToken) {
  const h = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const loginId = (GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '').trim();
  if (loginId) h['login-customer-id'] = loginId; // opcional
  return h;
}

async function tryAxios(fn, label) {
  try {
    return await fn();
  } catch (e) {
    const s = e?.response?.status;
    const d = e?.response?.data;
    console.warn(`⚠️ [ADS] ${label} error`, s, typeof d === 'string' ? d.slice(0, 240) : d);
    throw e;
  }
}

async function listAccessibleCustomers(accessToken) {
  for (const ver of ADS_VERSIONS) {
    const base = `https://googleads.googleapis.com/${ver}`;
    const url  = `${base}/customers:listAccessibleCustomers`;

    // A) GET
    try {
      const { data } = await tryAxios(
        () => axios.get(url, {
          headers: adsHeaders(accessToken),
          timeout: 20000,
          maxRedirects: 0,
          validateStatus: s => s === 200,
        }),
        `GET ${ver} listAccessibleCustomers`
      );
      return Array.isArray(data?.resourceNames) ? data.resourceNames : [];
    } catch (_) {}

    // B) POST
    try {
      const { data } = await tryAxios(
        () => axios.post(url, {}, {
          headers: adsHeaders(accessToken),
          timeout: 20000,
          maxRedirects: 0,
          validateStatus: s => s === 200,
        }),
        `POST ${ver} listAccessibleCustomers`
      );
      return Array.isArray(data?.resourceNames) ? data.resourceNames : [];
    } catch (_) {}
  }
  return [];
}

async function fetchCustomer(accessToken, cid) {
  for (const ver of ADS_VERSIONS) {
    const base = `https://googleads.googleapis.com/${ver}`;
    const url  = `${base}/customers/${cid}`;

    try {
      const { data } = await tryAxios(
        () => axios.get(url, {
          headers: adsHeaders(accessToken),
          timeout: 15000,
          maxRedirects: 0,
          validateStatus: s => s === 200,
        }),
        `GET ${ver} customers/${cid}`
      );

      return {
        id: normId(cid),
        resourceName: data?.resourceName || `customers/${cid}`,
        descriptiveName: data?.descriptiveName || null,
        currencyCode: data?.currencyCode || null,
        timeZone: data?.timeZone || null,
      };
    } catch (_) {}
  }
  throw new Error(`No se pudo leer customers/${cid} en ninguna versión de la API de Google Ads`);
}

async function discoverCustomers(accessToken) {
  const rn  = await listAccessibleCustomers(accessToken);      // ["customers/123", ...]
  const ids = rn.map(r => (r || '').split('/')[1]).filter(Boolean);

  const out = [];
  for (const cid of ids.slice(0, 100)) {
    try {
      out.push(await fetchCustomer(accessToken, cid));
    } catch (e) {
      console.warn('⚠️ [ADS] fetchCustomer falló para', cid, e.message);
    }
  }
  return out;
}

/* =========================
 * Google Analytics Admin: listar GA4 properties
 * ========================= */
async function fetchGA4Properties(oauthClient) {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: oauthClient });
  const out = [];
  let pageToken;
  do {
    // properties.search devuelve todas las propiedades GA4 accesibles por el usuario
    const resp = await admin.properties.search({
      requestBody: { query: '' },
      pageToken,
      pageSize: 200,
    });
    (resp.data.properties || []).forEach((p) => {
      out.push({
        propertyId: p.name,            // "properties/123"
        displayName: p.displayName || p.name,
        timeZone: p.timeZone,
        currencyCode: p.currencyCode,
      });
    });
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

/* =========================
 * Rutas
 * ========================= */

// Lanzar OAuth para conectar Google
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
        'https://www.googleapis.com/auth/adwords',            // Google Ads
        'https://www.googleapis.com/auth/analytics.readonly', // GA4 Data
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

// Callback (login + guardar cuentas/properties)
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

    // Scopes concedidos
    const grantedScopes = normalizeScopes(tokens.scope);

    // Google Ads: descubrir customers
    let customers = [];
    try {
      customers = await discoverCustomers(accessToken);
    } catch (e) {
      console.warn('⚠️ no se pudieron listar customers:', e?.response?.data || e.message);
    }
    const defaultCustomerId = customers?.[0]?.id || null;

    // GA4: listar properties
    client.setCredentials({ access_token: accessToken, refresh_token: refreshToken || undefined });
    let gaProps = [];
    try {
      gaProps = await fetchGA4Properties(client);
    } catch (e) {
      console.warn('⚠️ no se pudieron listar GA4 properties:', e?.response?.data || e.message);
    }
    const defaultPropertyId = gaProps?.[0]?.propertyId || null;

    // Upsert en googleaccounts
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const update = {
      user: req.user._id,
      userId: req.user._id,
      accessToken,
      expiresAt,
      scope: grantedScopes,

      customers,
      ...(defaultCustomerId ? { defaultCustomerId } : {}),

      gaProperties: gaProps,
      ...(defaultPropertyId ? { defaultPropertyId } : {}),

      updatedAt: new Date(),
    };
    if (refreshToken) update.refreshToken = refreshToken;

    await GoogleAccount.findOneAndUpdate(q, update, { upsert: true, new: true, setDefaultsOnInsert: true });

    // Flag en usuario
    await User.findByIdAndUpdate(req.user._id, { $set: { googleConnected: true } });

    // Objetivo por defecto si no existe
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
 * Estado de conexión
 * ========================= */
router.get('/status', requireSession, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).lean();

    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+refreshToken +accessToken objective defaultCustomerId customers managerCustomerId scope gaProperties defaultPropertyId')
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
      gaProperties: ga?.gaProperties || [],
      defaultPropertyId: ga?.defaultPropertyId || null,
    });
  } catch (err) {
    console.error('google status error:', err);
    res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

/* =========================
 * Guardar objetivo
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

/* =========================
 * Listar cuentas Ads (fallback y cacheo)
 * ========================= */
router.get('/accounts', requireSession, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers scope defaultCustomerId')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, customers: [], defaultCustomerId: null, scopes: [] });
    }

    const accessToken = ga.accessToken;
    let customers = ga.customers || [];

    // Si no hay customers cacheados, descubrimos y guardamos
    if (!customers || customers.length === 0) {
      try { customers = await discoverCustomers(accessToken); } catch {}
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

/* =========================
 * Guardar defaultCustomerId
 * ========================= */
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

module.exports = router;
