// backend/routes/googleConnect.js
'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const mongoose = require('mongoose');

const { discoverAndEnrich, selfTest } = require('../services/googleAdsService');

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
      customers:         { type: Array, default: [] },
      ad_accounts:       { type: [AdAccountSchema], default: [] },

      // GA4
      gaProperties:      { type: Array, default: [] },
      defaultPropertyId: { type: String },

      // Misc
      objective:             { type: String, enum: ['ventas','alcance','leads'], default: null },
      lastAdsDiscoveryError: { type: String, default: null },
      lastAdsDiscoveryLog:   { type: mongoose.Schema.Types.Mixed, default: null, select: false },

      createdAt:             { type: Date, default: Date.now },
      updatedAt:             { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );

  schema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
  });

  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* =========================
 * ENV
 * ========================= */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,          // preferido
  GOOGLE_CONNECT_CALLBACK_URL,  // fallback legacy
} = process.env;

const DEFAULT_GOOGLE_OBJECTIVE = 'ventas';

/* =========================
 * Helpers
 * ========================= */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function oauth() {
  const redirectUri = GOOGLE_REDIRECT_URI || GOOGLE_CONNECT_CALLBACK_URL;
  return new OAuth2Client({
    clientId:     GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri,
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

// Scopes Ads / GA
const ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GA_SCOPE  = 'https://www.googleapis.com/auth/analytics.readonly';

const hasAdwordsScope = (scopes=[]) =>
  Array.isArray(scopes) && scopes.some(s => String(s).includes('/auth/adwords'));

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
 *  Iniciar OAuth (Ads + GA) — estilo Master Metrics
 * =======================================================*/
function buildAuthUrl(req, returnTo) {
  const client = oauth();
  const state = JSON.stringify({
    uid: String(req.user._id),
    returnTo,
  });

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      GA_SCOPE,
      ADS_SCOPE,
    ],
    state,
  });
}

async function startConnect(req, res) {
  try {
    const returnTo =
      typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
        ? req.query.returnTo
        : '/onboarding?google=connected';

    const url = buildAuthUrl(req, returnTo);
    return res.redirect(url);
  } catch (err) {
    console.error('[googleConnect] connect error:', err);
    return res.redirect('/onboarding?google=error&reason=connect_build');
  }
}

// Rutas para iniciar OAuth
router.get('/connect', requireSession, startConnect);
// alias más explícito
router.get('/ads', requireSession, startConnect);

/* =========================================================
 *  Callback compartido (connect / ads)
 * =======================================================*/
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
    client.setCredentials(tokens);

    const accessToken  = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt    = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    const grantedScopes = normalizeScopes(tokens.scope || []);

    if (!accessToken) {
      return res.redirect('/onboarding?google=error&reason=no_access_token');
    }

    // Perfil básico de Google (email)
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: profile } = await oauth2.userinfo.get().catch(() => ({ data: {} }));

    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    let ga = await GoogleAccount.findOne(q).select('+refreshToken scope');

    if (!ga) {
      ga = new GoogleAccount({ user: req.user._id, userId: req.user._id });
    }

    ga.email = profile.email || ga.email || null;

    // Tokens
    if (refreshToken) {
      ga.refreshToken = refreshToken;
    } else if (!ga.refreshToken && tokens.refresh_token) {
      // por si Google lo manda en otra propiedad (raro)
      ga.refreshToken = tokens.refresh_token;
    }

    ga.accessToken = accessToken;
    ga.expiresAt   = expiresAt;

    // Scopes acumulados
    const existingScopes = Array.isArray(ga.scope) ? ga.scope : [];
    ga.scope = normalizeScopes([...existingScopes, ...grantedScopes]);

    ga.updatedAt = new Date();
    await ga.save();

    // ============================
    // 1) Descubrir cuentas de Ads
    // ============================
    if (hasAdwordsScope(ga.scope) && ga.refreshToken) {
      try {
        const enriched = await discoverAndEnrich(ga); // <-- multi-usuario (usa refreshToken)

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

        const previous = normId(ga.defaultCustomerId || '');
        const firstEnabled = ad_accounts.find(a => (a.status || '').toUpperCase() === 'ENABLED')?.id;
        const defaultCustomerId = previous || firstEnabled || (ad_accounts[0]?.id || null);

        ga.customers = customers;
        ga.ad_accounts = ad_accounts;
        if (defaultCustomerId) ga.defaultCustomerId = normId(defaultCustomerId);
        ga.lastAdsDiscoveryError = null;
        ga.lastAdsDiscoveryLog = null;
        ga.updatedAt = new Date();
        await ga.save();

        // selftest opcional
        try {
          const st = await selfTest(ga);
          console.log('[googleConnect] Google Ads selfTest:', st);
        } catch (err) {
          console.warn('[googleConnect] selfTest error:', err.message);
        }
      } catch (e) {
        const reason = e?.response?.data || e?.message || 'DISCOVERY_FAILED';
        console.warn('⚠️ Ads discovery failed:', reason);
        ga.lastAdsDiscoveryError = String(reason).slice(0, 4000);
        ga.updatedAt = new Date();
        await ga.save();
      }
    } else {
      if (!hasAdwordsScope(ga.scope)) {
        ga.lastAdsDiscoveryError = 'ADS_SCOPE_MISSING';
        await ga.save();
      }
    }

    // ============================
    // 2) Listar properties GA4
    // ============================
    try {
      const props = await fetchGA4Properties(client);
      if (Array.isArray(props) && props.length > 0) {
        ga.gaProperties = props;
        if (!ga.defaultPropertyId) {
          ga.defaultPropertyId = props[0].propertyId;
        }
        ga.updatedAt = new Date();
        await ga.save();
      }
    } catch (e) {
      console.warn('⚠️ GA4 properties listing failed:', e?.response?.data || e.message);
    }

    // Marcar usuario como conectado a Google
    await User.findByIdAndUpdate(req.user._id, {
      $set: { googleConnected: true },
    });

    // Objetivo por defecto (ventas) si no existe
    const [uObj, gaObj] = await Promise.all([
      User.findById(req.user._id).select('googleObjective').lean(),
      GoogleAccount.findOne(q).select('objective').lean(),
    ]);

    if (!(uObj?.googleObjective) && !(gaObj?.objective)) {
      await Promise.all([
        User.findByIdAndUpdate(req.user._id, {
          $set: { googleObjective: DEFAULT_GOOGLE_OBJECTIVE },
        }),
        GoogleAccount.findOneAndUpdate(q, {
          $set: { objective: DEFAULT_GOOGLE_OBJECTIVE, updatedAt: new Date() },
        }, { upsert: true }),
      ]);
    }

    // ReturnTo desde state
    let returnTo = '/onboarding?google=connected';
    if (req.query.state) {
      try {
        const s = JSON.parse(req.query.state);
        if (s && typeof s.returnTo === 'string' && s.returnTo.trim()) {
          returnTo = s.returnTo;
        }
      } catch {
        // ignore
      }
    }

    return res.redirect(returnTo);
  } catch (err) {
    console.error('[googleConnect] callback error:', err?.response?.data || err.message || err);
    return res.redirect('/onboarding?google=error&reason=callback_exception');
  }
}

// Rutas de callback (mantengo las 3 que ya tenías)
router.get('/callback',         requireSession, googleCallbackHandler);
router.get('/connect/callback', requireSession, googleCallbackHandler);
router.get('/ads/callback',     requireSession, googleCallbackHandler);

/* =========================
 * Estado de conexión
 * ========================= */
router.get('/status', requireSession, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).lean();

    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select(
        '+refreshToken +accessToken objective defaultCustomerId ' +
        'customers ad_accounts scope gaProperties defaultPropertyId ' +
        'lastAdsDiscoveryError lastAdsDiscoveryLog expiresAt'
      )
      .lean();

    const hasTokens = !!(ga?.refreshToken || ga?.accessToken);
    const customers = Array.isArray(ga?.customers) ? ga.customers : [];
    const adAccounts = Array.isArray(ga?.ad_accounts) ? ga.ad_accounts : [];

    const previous = normId(ga?.defaultCustomerId || '');
    const firstEnabled = adAccounts.find(a => (a.status || '').toUpperCase() === 'ENABLED')?.id;
    const defaultCustomerId = previous || firstEnabled || normId(customers?.[0]?.id || '') || null;

    const scopesArr = Array.isArray(ga?.scope) ? ga.scope : [];
    const adsScopeOk = hasAdwordsScope(scopesArr);

    res.json({
      ok: true,
      connected: !!u?.googleConnected && hasTokens,
      hasCustomers: customers.length > 0,
      defaultCustomerId,
      customers,
      ad_accounts: adAccounts,
      scopes: scopesArr,
      adsScopeOk,
      objective: u?.googleObjective || ga?.objective || null,
      gaProperties: ga?.gaProperties || [],
      defaultPropertyId: ga?.defaultPropertyId || null,
      expiresAt: ga?.expiresAt || null,
      lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
      lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
    });
  } catch (err) {
    console.error('[googleConnect] status error:', err);
    res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

/* =========================
 * Guardar objetivo (ventas / alcance / leads)
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
    console.error('[googleConnect] save objective error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_OBJECTIVE_ERROR' });
  }
});

/* =========================
 * Listar cuentas Ads (selector en onboarding)
 * ========================= */
router.get('/accounts', requireSession, async (req, res) => {
  try {
    let ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('+refreshToken customers ad_accounts scope defaultCustomerId lastAdsDiscoveryError lastAdsDiscoveryLog')
      .lean();

    if (!ga || (!ga.refreshToken && !ga.accessToken)) {
      return res.json({
        ok: true,
        customers: [],
        ad_accounts: [],
        defaultCustomerId: null,
        scopes: [],
        lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
        lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
      });
    }

    const scopesArr = Array.isArray(ga?.scope) ? ga.scope : [];
    if (!hasAdwordsScope(scopesArr)) {
      return res.status(428).json({
        ok: false,
        error: 'ADS_SCOPE_MISSING',
        message: 'Necesitamos permiso de Google Ads para listar tus cuentas.',
        connectUrl: '/auth/google/connect?returnTo=/onboarding?google=connected',
      });
    }

    let customers = ga.customers || [];
    let ad_accounts = ga.ad_accounts || [];

    const forceRefresh = req.query.refresh === '1';

    if (forceRefresh || customers.length === 0 || ad_accounts.length === 0) {
      // Recargamos usando el flujo multi-usuario (refreshToken se usa en el service)
      const fullGa = await GoogleAccount.findOne({
        $or: [{ user: req.user._id }, { userId: req.user._id }],
      });

      if (!fullGa || !fullGa.refreshToken) {
        return res.json({
          ok: true,
          customers: [],
          ad_accounts: [],
          defaultCustomerId: null,
          scopes: scopesArr,
          lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
          lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
        });
      }

      try {
        const enriched = await discoverAndEnrich(fullGa);

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

        fullGa.customers = customers;
        fullGa.ad_accounts = ad_accounts;
        fullGa.lastAdsDiscoveryError = null;
        fullGa.lastAdsDiscoveryLog = null;
        fullGa.updatedAt = new Date();
        await fullGa.save();

        ga = fullGa.toObject();
      } catch (e) {
        const reason = e?.response?.data || e?.message || 'LAZY_DISCOVERY_FAILED';
        console.warn('⚠️ lazy ads refresh failed:', reason);
        await GoogleAccount.updateOne(
          { $or: [{ user: req.user._id }, { userId: req.user._id }] },
          {
            $set: {
              lastAdsDiscoveryError: String(reason).slice(0, 4000),
              updatedAt: new Date(),
            },
          }
        );
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
      scopes: scopesArr,
      lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
      lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
    });
  } catch (err) {
    console.error('[googleConnect] accounts error:', err?.response?.data || err);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
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
    console.error('[googleConnect] default-customer error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_CUSTOMER_ERROR' });
  }
});

module.exports = router;
