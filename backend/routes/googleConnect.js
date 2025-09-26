// backend/routes/googleConnect.js
'use strict';

const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');

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
      customers:         { type: Array, default: [] },
      // GA4
      gaProperties:      { type: Array, default: [] },
      defaultPropertyId: { type: String },
      objective:         { type: String, enum: ['ventas','alcance','leads'], default: null },
      createdAt:         { type: Date, default: Date.now },
      updatedAt:         { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );
  schema.pre('save', function (next) { this.updatedAt = new Date(); next(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  GOOGLE_ADS_API_VERSION, // <-- nuevo (opcional)
} = process.env;

// Usa v17 por defecto (v16 te está dando 404)
const ADS_VERSION = (GOOGLE_ADS_API_VERSION || 'v17').trim();
const ADS_API = `https://googleads.googleapis.com/${ADS_VERSION}`;

const DEFAULT_GOOGLE_OBJECTIVE = 'ventas';

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

// ---------- Helpers Google Ads ----------
function buildAdsHeaders(accessToken, managerId) {
  const h = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const login = String(managerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '')
    .replace(/-/g,'').trim();
  if (login) h['login-customer-id'] = login;
  return h;
}

async function listAccessibleCustomers(accessToken, managerId) {
  const url = `${ADS_API}/customers:listAccessibleCustomers`;
  const { data } = await axios.get(url, {
    headers: buildAdsHeaders(accessToken, managerId),
    timeout: 20000,
    validateStatus: () => true, // para loguear mejor
  });
  if (!data || data.error) {
    throw new Error(`Ads listAccessibleCustomers error: ${JSON.stringify(data?.error || data)}`);
  }
  return Array.isArray(data?.resourceNames) ? data.resourceNames : [];
}

async function fetchCustomer(accessToken, cid, managerId) {
  const url = `${ADS_API}/customers/${cid}`;
  const { data } = await axios.get(url, {
    headers: buildAdsHeaders(accessToken, managerId),
    timeout: 15000,
    validateStatus: () => true,
  });
  if (!data || data.error) {
    throw new Error(`Ads fetchCustomer error: ${JSON.stringify(data?.error || data)}`);
  }
  return {
    id: normId(cid),
    resourceName: data?.resourceName || `customers/${cid}`,
    descriptiveName: data?.descriptiveName || null,
    currencyCode: data?.currencyCode || null,
    timeZone: data?.timeZone || null,
  };
}

async function discoverCustomers(accessToken, managerId) {
  const rn = await listAccessibleCustomers(accessToken, managerId);
  const ids = rn.map((r) => (r || '').split('/')[1]).filter(Boolean);
  const out = [];
  for (const cid of ids.slice(0, 50)) {
    try { out.push(await fetchCustomer(accessToken, cid, managerId)); }
    catch (e) { console.warn('✖ fetchCustomer', cid, e?.message); }
  }
  return out;
}

// ---------- Helpers GA4 (compatibles con googleapis viejas) ----------
async function fetchGA4Properties(oauthClient) {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: oauthClient });

  // Camino compatible: listar account summaries (trae properties embebidas)
  const out = [];
  let pageToken;
  do {
    const resp = await admin.accountSummaries.list({
      pageToken,
      pageSize: 200,
    });
    (resp.data.accountSummaries || []).forEach((acc) => {
      (acc.propertySummaries || []).forEach((p) => {
        out.push({
          propertyId: `properties/${p.property}`,
          displayName: p.displayName || p.property,
          timeZone: p.propertyDisplayName ? undefined : undefined, // no lo trae aquí
          currencyCode: undefined,
        });
      });
    });
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);

  return out;
}

// ---------- Rutas ----------
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

async function googleCallbackHandler(req, res) {
  try {
    if (req.query.error) {
      return res.redirect(`/onboarding?google=error&reason=${encodeURIComponent(req.query.error)}`);
    }
    const code = req.query.code;
    if (!code) return res.redirect('/onboarding?google=error&reason=no_code');

    const client = oauth();
    const { tokens } = await client.getToken(code);
    if (!tokens?.access_token) {
      return res.redirect('/onboarding?google=error&reason=no_access_token');
    }

    const accessToken  = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt    = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    const grantedScopes = normalizeScopes(tokens.scope);

    // set credentials para siguientes llamadas
    client.setCredentials({ access_token: accessToken, refresh_token: refreshToken || undefined });

    // ADS customers
    let customers = [];
    try {
      customers = await discoverCustomers(accessToken, GOOGLE_ADS_LOGIN_CUSTOMER_ID);
      console.log('✓ ADS customers:', customers.length);
    } catch (e) {
      console.warn('⚠️ no se pudieron listar customers:', e?.message);
    }
    const defaultCustomerId = customers?.[0]?.id || null;

    // GA4 properties
    let gaProps = [];
    try {
      gaProps = await fetchGA4Properties(client);
      console.log('✓ GA4 properties:', gaProps.length);
    } catch (e) {
      console.warn('⚠️ no se pudieron listar GA4 properties:', e?.message);
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
      ...(defaultCustomerId ? { defaultCustomerId } : {}),
      ...(defaultPropertyId ? { defaultPropertyId } : {}),
      scope: grantedScopes,
      updatedAt: new Date(),
    };
    if (refreshToken) update.refreshToken = refreshToken;

    await GoogleAccount.findOneAndUpdate(q, update, { upsert: true, new: true, setDefaultsOnInsert: true });

    await User.findByIdAndUpdate(req.user._id, { $set: { googleConnected: true } });

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

    let returnTo = '/onboarding?google=connected';
    if (req.query.state) {
      try {
        const s = JSON.parse(req.query.state);
        if (s && typeof s.returnTo === 'string' && s.returnTo.trim()) returnTo = s.returnTo;
      } catch {}
    }
    return res.redirect(returnTo);
  } catch (err) {
    console.error('google callback error:', err?.response?.data || err.message || err);
    return res.redirect('/onboarding?google=error&reason=callback_exception');
  }
}

router.get('/callback',         requireSession, googleCallbackHandler);
router.get('/connect/callback', requireSession, googleCallbackHandler);

// Estado
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
      gaProperties: ga?.gaProperties || [],
      defaultPropertyId: ga?.defaultPropertyId || null,
      scopes: Array.isArray(ga?.scope) ? ga.scope : [],
      objective: u?.googleObjective || ga?.objective || null,
      managerCustomerId: ga?.managerCustomerId || null,
    });
  } catch (err) {
    console.error('google status error:', err);
    res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

// Cambiar objetivo
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

// Cuentas Ads (con backfill)
router.get('/accounts', requireSession, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers scope managerCustomerId defaultCustomerId')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, customers: [], defaultCustomerId: null, scopes: [] });
    }

    const accessToken = ga.accessToken;
    let customers = ga.customers || [];

    if (!customers || customers.length === 0) {
      try { customers = await discoverCustomers(accessToken, ga.managerCustomerId); } catch {}
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

// Guardar customer por defecto
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

// (Opcional) Resync manual desde UI
router.post('/resync', requireSession, async (req, res) => {
  try {
    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('+refreshToken +accessToken managerCustomerId').lean();

    if (!doc) return res.status(404).json({ ok:false, error:'NO_GOOGLE_DOC' });

    const o = oauth();
    o.setCredentials({ refresh_token: doc.refreshToken, access_token: doc.accessToken });
    const t = await o.getAccessToken();
    const accessToken = t?.token || doc.accessToken;

    let customers = [];
    try { customers = await discoverCustomers(accessToken, doc.managerCustomerId); }
    catch (e) { console.warn('✖ resync Ads:', e?.message); }

    let gaProps = [];
    try { gaProps = await fetchGA4Properties(o); }
    catch (e) { console.warn('✖ resync GA4:', e?.message); }

    const update = {
      customers,
      gaProperties: gaProps,
      ...(customers?.[0]?.id ? { defaultCustomerId: customers[0].id } : {}),
      ...(gaProps?.[0]?.propertyId ? { defaultPropertyId: gaProps[0].propertyId } : {}),
      updatedAt: new Date(),
    };
    await GoogleAccount.updateOne(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: update }
    );

    res.json({ ok:true, customersCount: customers.length, propertiesCount: gaProps.length });
  } catch (e) {
    console.error('resync error:', e);
    res.status(500).json({ ok:false, error:'RESYNC_ERROR', detail: String(e.message || e) });
  }
});

module.exports = router;
