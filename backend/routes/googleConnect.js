// backend/routes/googleConnect.js
'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const mongoose = require('mongoose');

const { discoverAndEnrich } = require('../services/googleAdsService');
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
      managerCustomerId: { type: String },
      loginCustomerId:   { type: String },
      defaultCustomerId: { type: String },
      customers:         { type: Array, default: [] }, // [{ id, descriptiveName, currencyCode, timeZone, status }]
      ad_accounts:       { type: [AdAccountSchema], default: [] },

      // GA4
      gaProperties:      { type: Array, default: [] },
      defaultPropertyId: { type: String },

      // Misc
      objective:             { type: String, enum: ['ventas','alcance','leads'], default: null },
      lastAdsDiscoveryError: { type: String, default: null },
      createdAt:             { type: Date, default: Date.now },
      updatedAt:             { type: Date, default: Date.now },
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

const DEV_TOKEN =
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN || process.env.GOOGLE_DEVELOPER_TOKEN || '';

const LOGIN_CID =
  (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || process.env.GOOGLE_LOGIN_CUSTOMER_ID || '')
    .replace(/[^\d]/g, '');

const DEFAULT_GOOGLE_OBJECTIVE = 'ventas';

/* =========================
 * Helpers
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

const normId = (s='') => String(s).replace(/[^\d]/g, '');

const normalizeScopes = (raw) => Array.from(
  new Set(
    (Array.isArray(raw) ? raw : String(raw || '').split(/[,\s]+/))
      .map(s => String(s || '').trim())
      .filter(Boolean)
  )
);

/* =========================================================
 *  Refresco de Access Token (si expira o falta)
 * =======================================================*/
async function ensureFreshAccessToken(userId) {
  const ga = await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
    .select('+accessToken +refreshToken expiresAt loginCustomerId');
  if (!ga) throw new Error('GoogleAccount not found');

  const now = Date.now();
  const notExpiring = ga.expiresAt && (new Date(ga.expiresAt).getTime() - 60_000) > now;

  if (ga.accessToken && notExpiring) {
    return { accessToken: ga.accessToken, loginCustomerId: ga.loginCustomerId || LOGIN_CID || null };
  }

  if (!ga.refreshToken) throw new Error('No refreshToken stored');

  const client = oauth();
  client.setCredentials({ refresh_token: ga.refreshToken });

  let credentials;
  try {
    ({ credentials } = await client.refreshAccessToken());
  } catch (e) {
    console.warn('⚠️ refreshAccessToken failed:', e?.response?.data || e.message);
    throw e;
  }

  const newAccess = credentials.access_token;
  const newExpiry = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(now + 50 * 60_000);

  if (!newAccess) throw new Error('Failed to refresh access token');

  ga.accessToken = newAccess;
  ga.expiresAt   = newExpiry;
  if (!ga.loginCustomerId && LOGIN_CID) ga.loginCustomerId = normId(LOGIN_CID);
  await ga.save();

  return { accessToken: newAccess, loginCustomerId: ga.loginCustomerId || LOGIN_CID || null };
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
async function syncGoogleAdsAccountsForUserWithToken(userId, accessToken) {
  if (!DEV_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN missing');

  // validamos scope para Ads
  const scopeDoc = await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
    .select('scope defaultCustomerId');
  const hasAdwordsScope = (scopeDoc?.scope || [])
    .includes('https://www.googleapis.com/auth/adwords');

  if (!hasAdwordsScope) {
    return { customers: [], ad_accounts: [], defaultCustomerId: scopeDoc?.defaultCustomerId || null };
  }

  // descubrimos y enriquecemos (el service maneja MCC cuando aplica)
  const enriched = await discoverAndEnrich(accessToken); // [{ id, name, currencyCode, timeZone, status }]

  const customers = enriched.map(c => ({
    id: normId(c.id),
    descriptiveName: c.name,
    currencyCode: c.currencyCode || null,
    timeZone: c.timeZone || null,
    status: c.status || null,
  }));

  const ad_accounts = enriched.map(c => ({
    id: normId(c.id),
    name: c.name,
    currencyCode: c.currencyCode || null,
    timeZone: c.timeZone || null,
    status: c.status || null,
  }));

  // prioriza selección previa; si no, primera cuenta ENABLED; si no, la primera
  const previous = normId(scopeDoc?.defaultCustomerId || '');
  const firstEnabled = ad_accounts.find(a => (a.status || '').toUpperCase() === 'ENABLED')?.id;
  const defaultCustomerId = previous || firstEnabled || (ad_accounts[0]?.id || null);

  await GoogleAccount.updateOne(
    { $or: [{ user: userId }, { userId }] },
    {
      $set: {
        customers,
        ad_accounts,
        ...(defaultCustomerId ? { defaultCustomerId } : {}),
        loginCustomerId: normId(LOGIN_CID || '') || undefined,
        lastAdsDiscoveryError: null,
        updatedAt: new Date(),
      }
    }
  );

  return { customers, ad_accounts, defaultCustomerId };
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
        'https://www.googleapis.com/auth/adwords',            // Google Ads (read)
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

    const accessToken   = tokens.access_token;
    const refreshToken  = tokens.refresh_token || null;
    const expiresAt     = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    // Si Google no devuelve scope/refresh en este callback (consent previo),
    // no borres los previos: recupera del doc.
    const prev = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+refreshToken scope')
      .lean();
    const grantedScopes = normalizeScopes(tokens.scope || prev?.scope || []);

    // === Guardamos tokens mínimos ===
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const baseUpdate = {
      user: req.user._id,
      userId: req.user._id,
      accessToken,
      expiresAt,
      scope: grantedScopes,
      ...(LOGIN_CID ? { loginCustomerId: normId(LOGIN_CID) } : {}),
      updatedAt: new Date(),
    };
    if (refreshToken) {
      baseUpdate.refreshToken = refreshToken;
    } else if (prev?.refreshToken) {
      // preserva el refresh anterior si no llega uno nuevo
      baseUpdate.refreshToken = prev.refreshToken;
    }

    await GoogleAccount.findOneAndUpdate(q, baseUpdate, { upsert: true, new: true, setDefaultsOnInsert: true });

    // === DISCOVERY de Ads inmediatamente con el accessToken fresco ===
    let customers = [];
    let ad_accounts = [];
    let defaultCustomerId = null;

    try {
      const result = await syncGoogleAdsAccountsForUserWithToken(req.user._id, accessToken);
      customers = result.customers || [];
      ad_accounts = result.ad_accounts || [];
      defaultCustomerId = result.defaultCustomerId || null;
      console.log('[Ads Sync] customers:', customers.length, 'ad_accounts:', ad_accounts.length);
    } catch (e) {
      console.warn('⚠️ Ads discovery failed:', {
        status: e?.response?.status,
        data: e?.response?.data,
        msg: e?.message
      });
      await GoogleAccount.updateOne(q, { $set: { lastAdsDiscoveryError: 'DISCOVERY_FAILED' } }).catch(()=>{});
    }

    // === GA4 (listar properties) ===
    client.setCredentials({ access_token: accessToken, refresh_token: (refreshToken || prev?.refreshToken) || undefined });
    let gaProps = [];
    let defaultPropertyId = null;
    try {
      gaProps = await fetchGA4Properties(client);
      defaultPropertyId = gaProps?.[0]?.propertyId || null;
    } catch (e) {
      console.warn('⚠️ GA4 properties listing failed:', e?.response?.data || e.message);
    }

    // Upsert final (por si discovery/GA4 aportaron datos)
    const update = {
      ...(customers.length ? { customers } : {}),
      ...(ad_accounts.length ? { ad_accounts } : {}),
      ...(defaultCustomerId ? { defaultCustomerId: normId(defaultCustomerId) } : {}),
      ...(gaProps.length ? { gaProperties: gaProps } : {}),
      ...(defaultPropertyId ? { defaultPropertyId } : {}),
      loginCustomerId: normId(LOGIN_CID || '') || undefined,
      lastAdsDiscoveryError: null,
      updatedAt: new Date(),
    };
    await GoogleAccount.updateOne(q, { $set: update });

    await User.findByIdAndUpdate(req.user._id, { $set: { googleConnected: true } });

    // Objetivo por defecto si no existía
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
      .select('+refreshToken +accessToken objective defaultCustomerId customers ad_accounts managerCustomerId scope gaProperties defaultPropertyId loginCustomerId expiresAt lastAdsDiscoveryError')
      .lean();

    const hasTokens = !!(ga?.refreshToken || ga?.accessToken);
    const customers = Array.isArray(ga?.customers) ? ga.customers : [];

    // default: guardado > primera ENABLED > primera
    const previous = normId(ga?.defaultCustomerId || '');
    const firstEnabled = (ga?.ad_accounts || []).find(a => (a.status || '').toUpperCase() === 'ENABLED')?.id;
    const defaultCustomerId = previous || firstEnabled || normId(customers?.[0]?.id || '') || null;

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
      expiresAt: ga?.expiresAt || null,
      lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
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
 * Listar cuentas Ads (con refresco perezoso)
 * ========================= */
router.get('/accounts', requireSession, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers ad_accounts scope defaultCustomerId loginCustomerId lastAdsDiscoveryError')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, customers: [], ad_accounts: [], defaultCustomerId: null, scopes: [] });
    }

    let customers = ga.customers || [];
    let ad_accounts = ga.ad_accounts || [];

    if ((!customers || customers.length === 0) || (!ad_accounts || ad_accounts.length === 0)) {
      try {
        const t = await ensureFreshAccessToken(req.user._id);
        const enriched = await discoverAndEnrich(t.accessToken);

        customers = enriched.map(c => ({
          id: normId(c.id),
          descriptiveName: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        ad_accounts = enriched.map(c => ({
          id: normId(c.id),
          name: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        await GoogleAccount.updateOne(
          { $or: [{ user: req.user._id }, { userId: req.user._id }] },
          { $set: { customers, ad_accounts, lastAdsDiscoveryError: null, updatedAt: new Date() } }
        );
      } catch (e) {
        console.warn('⚠️ lazy ads refresh failed:', e?.response?.data || e.message);
      }
    }

    const previous = normId(ga?.defaultCustomerId || '');
    const firstEnabled = ad_accounts.find(a => (a.status || '').toUpperCase() === 'ENABLED')?.id;
    const defaultCustomerId = previous || firstEnabled || normId(customers?.[0]?.id || '') || null;

    res.json({
      ok: true,
      customers,
      ad_accounts,
      defaultCustomerId,
      scopes: Array.isArray(ga?.scope) ? ga.scope : [],
      lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
    });
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
 * Forzar refresco de cuentas Ads (debug)
 * ========================= */
router.post('/ads/refresh', requireSession, async (req, res) => {
  try {
    const t = await ensureFreshAccessToken(req.user._id);
    const result = await discoverAndEnrich(t.accessToken);

    const customers = result.map(c => ({
      id: normId(c.id),
      descriptiveName: c.name,
      currencyCode: c.currencyCode || null,
      timeZone: c.timeZone || null,
      status: c.status || null
    }));
    const ad_accounts = result.map(c => ({
      id: normId(c.id),
      name: c.name,
      currencyCode: c.currencyCode || null,
      timeZone: c.timeZone || null,
      status: c.status || null
    }));

    res.json({
      ok: true,
      customers,
      ad_accounts,
      defaultCustomerId: customers?.[0]?.id || null
    });
  } catch (e) {
    console.error('ads refresh error', e.message);
    res.status(500).json({ ok: false, error: 'ADS_REFRESH_ERROR', detail: e.message });
  }
});

/* =========================
 * (Opcional) Refrescar token manual (debug)
 * ========================= */
router.post('/ads/token/refresh', requireSession, async (req, res) => {
  try {
    const t = await ensureFreshAccessToken(req.user._id);
    res.json({ ok: true, ...t });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'TOKEN_REFRESH_ERROR', detail: e.message });
  }
});

module.exports = router;
