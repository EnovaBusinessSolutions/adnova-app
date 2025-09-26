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

      managerCustomerId: { type: String },         // opcional (no requerido)
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
  // GOOGLE_ADS_LOGIN_CUSTOMER_ID  // ya NO lo usamos (multi-tenant puro)
} = process.env;

/* =========================
 * Constantes
 * ========================= */
const ADS_API_VERSIONS = ['v17', 'v16']; // probamos en cascada
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

/* =========================================================
 * Google Ads helpers con retry de versión (v17 → v16)
 * ========================================================= */
function adsHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

async function adsGet({ accessToken, path }) {
  let lastErr;
  for (const ver of ADS_API_VERSIONS) {
    try {
      const url = `https://googleads.googleapis.com/${ver}${path}`;
      const { data } = await axios.get(url, { headers: adsHeaders(accessToken), timeout: 20000 });
      return { data, version: ver };
    } catch (e) {
      const status = e?.response?.status;
      // 404 → intentamos siguiente versión; 403/401/400 rompemos
      if (status === 404) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('ADS_GET_FAILED');
}

async function listAccessibleCustomers(accessToken) {
  const { data } = await adsGet({ accessToken, path: `/customers:listAccessibleCustomers` });
  return Array.isArray(data?.resourceNames) ? data.resourceNames : [];
}

async function fetchCustomer(accessToken, cid) {
  const { data } = await adsGet({ accessToken, path: `/customers/${cid}` });
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
    catch (e) {
      console.warn('⚠️ error fetchCustomer:', cid, e?.response?.status, e?.response?.data || e.message);
    }
  }
  return out;
}

/* =========================================================
 * Google Analytics Admin: fallback robusto para GA4
 * ========================================================= */
async function fetchGA4Properties(oauthClient) {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: oauthClient });

  // 1) Intento rápido: accountSummaries.list (trae propiedades resumidas)
  try {
    const out = [];
    let pageToken;
    do {
      const resp = await admin.accountSummaries.list({ pageSize: 200, pageToken });
      for (const acc of (resp.data.accountSummaries || [])) {
        for (const ps of (acc.propertySummaries || [])) {
          out.push({
            propertyId: ps.property,             // "properties/123"
            displayName: ps.displayName || ps.property,
            timeZone: null,                      // se puede completar con properties.get si lo necesitas
            currencyCode: null,
          });
        }
      }
      pageToken = resp.data.nextPageToken || undefined;
    } while (pageToken);

    if (out.length) return out;
  } catch (e) {
    console.warn('⚠️ GA4 accountSummaries.list falló:', e?.response?.data || e.message);
  }

  // 2) Fallback: accounts.list → properties.list por cada account
  try {
    const properties = [];
    const accResp = await admin.accounts.list({ pageSize: 200 });
    const accounts = accResp.data.accounts || [];

    for (const acc of accounts) {
      try {
        const props = await admin.properties.list({
          filter: `parent:${acc.name}`, // "accounts/XXXX"
          pageSize: 200,
        });
        (props.data.properties || []).forEach((p) => {
          properties.push({
            propertyId: p.name, // "properties/123"
            displayName: p.displayName,
            timeZone: p.timeZone,
            currencyCode: p.currencyCode,
          });
        });
      } catch (e) {
        console.warn('⚠️ GA4 properties.list falló para', acc.name, e?.response?.data || e.message);
      }
    }
    return properties;
  } catch (e) {
    console.warn('⚠️ GA4 accounts.list falló:', e?.response?.data || e.message);
    return [];
  }
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

    // Google Ads: descubrir customers (con retry de versión)
    let customers = [];
    try {
      customers = await discoverCustomers(accessToken);
    } catch (e) {
      console.warn('⚠️ no se pudieron listar customers:', e?.response?.status, e?.response?.data || e.message);
    }
    const defaultCustomerId = customers?.[0]?.id || null;

    // GA4: listar properties (fallback robusto)
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
