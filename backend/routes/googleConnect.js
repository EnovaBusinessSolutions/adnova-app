'use strict';

const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const mongoose = require('mongoose');

const router = express.Router();

const User = require('../models/User');

/* =========================================================
 *  Modelo GoogleAccount (fallback si no existe el archivo)
 * =======================================================*/
let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const AdAccountSchema = new Schema({
    id:           { type: String, required: true }, // customerId
    name:         { type: String },
    currencyCode: { type: String },
    timeZone:     { type: String },
    status:       { type: String },
  }, { _id: false });

  const schema = new Schema(
    {
      user:              { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId:            { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },

      accessToken:       { type: String, select: false },
      refreshToken:      { type: String, select: false },
      scope:             { type: [String], default: [] },
      expiresAt:         { type: Date },

      // Ads
      managerCustomerId: { type: String },        // MCC opcional
      defaultCustomerId: { type: String },
      customers:         { type: Array, default: [] },  // [{ id, descriptiveName, currencyCode, timeZone }]
      ad_accounts:       { type: [AdAccountSchema], default: [] }, // enriquecidas

      // GA4
      gaProperties:      { type: Array, default: [] }, // [{propertyId, displayName, timeZone, currencyCode}]
      defaultPropertyId: { type: String },

      // Misc
      loginCustomerId:   { type: String }, // copia de MCC si aplica
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
  GOOGLE_CONNECT_CALLBACK_URL,
} = process.env;

// Compatibilidad: preferimos GOOGLE_ADS_DEVELOPER_TOKEN; si no existe, usamos GOOGLE_DEVELOPER_TOKEN
const GOOGLE_ADS_DEVELOPER_TOKEN =
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN || process.env.GOOGLE_DEVELOPER_TOKEN || '';

const GOOGLE_LOGIN_CUSTOMER_ID = (process.env.GOOGLE_LOGIN_CUSTOMER_ID || '').replace(/-/g, '').trim();

/* =========================
 * Constantes
 * ========================= */
const ADS_HOST   = 'https://googleads.googleapis.com';
const ADS_VER    = 'v17';
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
 *  Google Ads — discovery de cuentas con Ads REST API
 * =======================================================*/
function adsHeaders(accessToken) {
  const h = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (GOOGLE_LOGIN_CUSTOMER_ID) {
    h['login-customer-id'] = GOOGLE_LOGIN_CUSTOMER_ID; // si usas MCC
  }
  return h;
}

async function listAccessibleCustomers(accessToken) {
  if (!GOOGLE_ADS_DEVELOPER_TOKEN) {
    console.error('[Google Ads] Falta GOOGLE_ADS_DEVELOPER_TOKEN/GOOGLE_DEVELOPER_TOKEN en .env');
    return [];
  }
  const url = `${ADS_HOST}/${ADS_VER}/customers:listAccessibleCustomers`;
  try {
    const { data } = await axios.get(url, {
      headers: adsHeaders(accessToken),
      timeout: 25000,
      validateStatus: () => true,
    });
    if (data?.resourceNames && Array.isArray(data.resourceNames)) return data.resourceNames;
    if (data?.error) {
      console.warn('Ads listAccessibleCustomers error:', data.error);
      return [];
    }
    console.warn('Ads listAccessibleCustomers unexpected:', data);
    return [];
  } catch (e) {
    console.warn('⚠️ Ads listAccessibleCustomers fail:', e?.response?.status, e?.response?.data || e.message);
    return [];
  }
}

async function getCustomerInfo(accessToken, customerId) {
  const url = `${ADS_HOST}/${ADS_VER}/customers/${customerId}`;
  try {
    const { data } = await axios.get(url, { headers: adsHeaders(accessToken), timeout: 20000 });
    return {
      id: customerId,
      name: data?.descriptiveName || `Cuenta ${customerId}`,
      currencyCode: data?.currencyCode || null,
      timeZone: data?.timeZone || null,
      status: data?.status || null,
    };
  } catch (e) {
    console.warn('[Ads getCustomerInfo error]', customerId, e?.response?.status, e?.response?.data || e.message);
    return { id: customerId, name: `Cuenta ${customerId}` };
  }
}

async function discoverCustomers(accessToken) {
  const rn = await listAccessibleCustomers(accessToken); // ["customers/123", ...]
  const ids = rn.map((r) => (r || '').split('/')[1]).filter(Boolean);
  const out = [];
  for (const cid of ids) {
    out.push(await getCustomerInfo(accessToken, cid));
  }
  return out;
}

/* =========================================================
 *  Google Analytics Admin — listar GA4 properties
 * =======================================================*/
async function fetchGA4Properties(oauthClient) {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: oauthClient });

  const props = [];
  const accounts = await admin.accounts.list({ pageSize: 200 })
    .then(r => r.data.accounts || [])
    .catch(() => []);

  for (const acc of accounts) {
    const accountId = (acc.name || '').split('/')[1];
    if (!accountId) continue;
    try {
      const resp = await admin.properties.list({
        filter: `parent:accounts/${accountId}`,
        pageSize: 200,
      });
      const list = resp.data.properties || [];
      for (const p of list) {
        props.push({
          propertyId: p.name, // "properties/123"
          displayName: p.displayName || p.name,
          timeZone: p.timeZone,
          currencyCode: p.currencyCode,
        });
      }
    } catch (e) {
      console.warn('⚠️ properties.list fail for account', accountId, e?.response?.data || e.message);
    }
  }
  return props;
}

/* =========================================================
 *  Sincronización completa post-OAuth (Ads)
 * =======================================================*/
async function syncGoogleAdsAccountsForUser(userId) {
  const ga = await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).select('+accessToken +refreshToken');
  if (!ga?.accessToken) throw new Error('No Google accessToken for user');
  if (!GOOGLE_ADS_DEVELOPER_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN missing');

  const customersBrief = await discoverCustomers(ga.accessToken); // [{ id, name, currencyCode, timeZone }]
  const adAccounts = customersBrief.map(c => ({
    id: c.id,
    name: c.name,
    currencyCode: c.currencyCode || null,
    timeZone: c.timeZone || null,
    status: c.status || null,
  }));
  const defaultCustomerId = ga.defaultCustomerId || adAccounts?.[0]?.id || null;

  ga.customers = customersBrief.map(c => ({ id: c.id, descriptiveName: c.name, currencyCode: c.currencyCode, timeZone: c.timeZone }));
  ga.ad_accounts = adAccounts;
  ga.loginCustomerId = ga.loginCustomerId || GOOGLE_LOGIN_CUSTOMER_ID || undefined;
  if (!ga.defaultCustomerId && defaultCustomerId) ga.defaultCustomerId = defaultCustomerId;
  await ga.save();

  return { customers: ga.customers, ad_accounts: ga.ad_accounts, defaultCustomerId: ga.defaultCustomerId || null };
}

/* =========================
 * Rutas
 * ========================= */

// Inicia OAuth
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
      state: JSON.stringify({ uid: String(req.user._id), returnTo }),
    });

    return res.redirect(url);
  } catch (err) {
    console.error('google connect error:', err);
    return res.redirect('/onboarding?google=error&reason=connect_build');
  }
});

// Callback (compartido)
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

    // === Google Ads (descubrir y guardar cuentas) ===
    let customers = [];
    let ad_accounts = [];
    let defaultCustomerId = null;

    try {
      // Persistimos primero el token para poder hacer sync con helper
      const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
      const baseUpdate = {
        user: req.user._id,
        userId: req.user._id,
        accessToken,
        expiresAt,
        scope: grantedScopes,
        updatedAt: new Date(),
      };
      if (refreshToken) baseUpdate.refreshToken = refreshToken;

      await GoogleAccount.findOneAndUpdate(q, baseUpdate, { upsert: true, new: true, setDefaultsOnInsert: true });

      // Sincronización completa de Ads (guarda customers/ad_accounts/defaultCustomerId)
      const result = await syncGoogleAdsAccountsForUser(req.user._id);
      customers = result.customers || [];
      ad_accounts = result.ad_accounts || [];
      defaultCustomerId = result.defaultCustomerId || null;
      console.log('[Ads Sync] customers:', customers.length, 'ad_accounts:', ad_accounts.length);
    } catch (e) {
      console.warn('⚠️ Ads customers discovery failed:', e?.response?.data || e.message);
    }

    // === GA4 (listar properties) ===
    client.setCredentials({ access_token: accessToken, refresh_token: refreshToken || undefined });
    let gaProps = [];
    let defaultPropertyId = null;
    try {
      gaProps = await fetchGA4Properties(client);
      defaultPropertyId = gaProps?.[0]?.propertyId || null;
    } catch (e) {
      console.warn('⚠️ GA4 properties listing failed:', e?.response?.data || e.message);
    }

    // Upsert final (por si cambió algo durante el sync)
    const q2 = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const update = {
      user: req.user._id,
      userId: req.user._id,
      accessToken,
      expiresAt,
      scope: grantedScopes,

      customers,
      ad_accounts,
      ...(defaultCustomerId ? { defaultCustomerId } : {}),

      gaProperties: gaProps,
      ...(defaultPropertyId ? { defaultPropertyId } : {}),

      loginCustomerId: GOOGLE_LOGIN_CUSTOMER_ID || undefined,
      updatedAt: new Date(),
    };
    if (refreshToken) update.refreshToken = refreshToken;

    await GoogleAccount.findOneAndUpdate(q2, update, { upsert: true, new: true, setDefaultsOnInsert: true });
    await User.findByIdAndUpdate(req.user._id, { $set: { googleConnected: true } });

    // Objetivo por defecto si no existe
    const [uObj, gaObj] = await Promise.all([
      User.findById(req.user._id).select('googleObjective').lean(),
      GoogleAccount.findOne(q2).select('objective').lean()
    ]);
    if (!(uObj?.googleObjective) && !(gaObj?.objective)) {
      await Promise.all([
        User.findByIdAndUpdate(req.user._id, { $set: { googleObjective: DEFAULT_GOOGLE_OBJECTIVE } }),
        GoogleAccount.findOneAndUpdate(q2, { $set: { objective: DEFAULT_GOOGLE_OBJECTIVE, updatedAt: new Date() } })
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
      .select('+refreshToken +accessToken objective defaultCustomerId customers ad_accounts managerCustomerId scope gaProperties defaultPropertyId loginCustomerId')
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
      ad_accounts: ga?.ad_accounts || [],
      scopes: Array.isArray(ga?.scope) ? ga.scope : [],
      objective: u?.googleObjective || ga?.objective || null,
      managerCustomerId: ga?.managerCustomerId || null,
      loginCustomerId: ga?.loginCustomerId || null,
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
 * Listar cuentas Ads (si no hay, refresca)
 * ========================= */
router.get('/accounts', requireSession, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers ad_accounts scope defaultCustomerId')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, customers: [], ad_accounts: [], defaultCustomerId: null, scopes: [] });
    }

    let customers = ga.customers || [];
    let ad_accounts = ga.ad_accounts || [];
    if ((!customers || customers.length === 0) || (!ad_accounts || ad_accounts.length === 0)) {
      // refresco perezoso
      await syncGoogleAdsAccountsForUser(req.user._id);
      const refreshed = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
        .select('customers ad_accounts defaultCustomerId')
        .lean();
      customers = refreshed?.customers || [];
      ad_accounts = refreshed?.ad_accounts || [];
    }

    const defaultCustomerId = ga.defaultCustomerId || customers?.[0]?.id || null;
    res.json({ ok: true, customers, ad_accounts, defaultCustomerId, scopes: Array.isArray(ga?.scope) ? ga.scope : [] });
  } catch (err) {
    console.error('google accounts error:', err?.response?.data || err);
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

/* =========================
 * Forzar refresco de cuentas Ads (opcional para debugging)
 * ========================= */
router.post('/ads/refresh', requireSession, async (req, res) => {
  try {
    const result = await syncGoogleAdsAccountsForUser(req.user._id);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('ads refresh error', e.message);
    res.status(500).json({ ok: false, error: 'ADS_REFRESH_ERROR', detail: e.message });
  }
});

module.exports = router;
