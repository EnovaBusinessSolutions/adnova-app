// backend/routes/googleAdsInsights.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const router = express.Router();

// ===== Modelos =====
const User = require('../models/User');

let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  // Fallback mínimo si falta el modelo
  const { Schema, model } = mongoose;
  const AdAccountSchema = new Schema({
    id: String,
    name: String,
    currencyCode: String,
    timeZone: String,
    status: String,
  }, { _id: false });

  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    scope: { type: [String], default: [] },
    // Ads
    managerCustomerId: { type: String },
    loginCustomerId:   { type: String },
    defaultCustomerId: { type: String },
    customers:         { type: Array, default: [] }, // [{ id, descriptiveName, currencyCode, timeZone }]
    ad_accounts:       { type: [AdAccountSchema], default: [] },
    // Opcional
    objective:         { type: String, enum: ['ventas','alcance','leads'], default: 'ventas' },
    // Guardamos expiry si existe (aunque no esté en el esquema original)
    expiresAt: { type: Date },
  }, { collection: 'googleaccounts', timestamps: true });

  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

// ===== Servicio de Ads =====
const {
  listAccessibleCustomers, // customers:listAccessibleCustomers (sin login-customer-id)
  getCustomer,             // GET customers/{cid} (con login-customer-id si MCC)
  fetchInsights,           // GAQL stream + KPIs
} = require('../services/googleAdsService');

// ===== ENV & helpers =====
const DEFAULT_OBJECTIVE = 'ventas';

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

const normId = (s = '') =>
  String(s).replace(/^customers\//, '').replace(/-/g, '').trim();

function oauth() {
  return new OAuth2Client({
    clientId:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri:  process.env.GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/**
 * Devuelve un access_token vigente usando accessToken o refreshToken.
 */
async function getFreshAccessToken(gaDoc) {
  if (gaDoc?.accessToken && gaDoc?.expiresAt) {
    const ms = new Date(gaDoc.expiresAt).getTime() - Date.now();
    if (ms > 60_000) return gaDoc.accessToken; // válido > 60s
  }

  const client = oauth();
  client.setCredentials({
    refresh_token: gaDoc?.refreshToken || undefined,
    access_token:  gaDoc?.accessToken  || undefined,
  });

  // 1) intenta refreshAccessToken (devuelve expiry)
  try {
    const { credentials } = await client.refreshAccessToken();
    const access = credentials.access_token;
    if (access) {
      await GoogleAccount.updateOne(
        { _id: gaDoc._id },
        { $set: { accessToken: access, expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null } }
      );
      return access;
    }
  } catch (_) { /* ignore */ }

  // 2) fallback getAccessToken()
  const t = await client.getAccessToken().catch(() => null);
  if (t?.token) return t.token;

  if (gaDoc?.accessToken) return gaDoc.accessToken;
  throw new Error('NO_ACCESS_OR_REFRESH_TOKEN');
}

/* ============================================================================
 * GET /api/google/ads/insights/accounts
 * Descubre y devuelve las cuentas accesibles para el usuario actual.
 *  - requiredSelection + reason cuando falte scope o no haya cuentas
 * ==========================================================================*/
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers ad_accounts defaultCustomerId loginCustomerId managerCustomerId scope expiresAt')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, accounts: [], defaultCustomerId: null, requiredSelection: true, reason: 'GOOGLE_NOT_CONNECTED' });
    }

    // ¿El usuario concedió el scope de Ads?
    const hasAdwordsScope = (ga.scope || []).includes('https://www.googleapis.com/auth/adwords');
    if (!hasAdwordsScope) {
      return res.json({
        ok: true,
        accounts: [],
        defaultCustomerId: null,
        requiredSelection: true,
        reason: 'MISSING_ADS_SCOPE',
      });
    }

    // Usa lo guardado si existe
    let accounts = Array.isArray(ga.ad_accounts) && ga.ad_accounts.length ? ga.ad_accounts : [];

    // Si no hay nada, discovery perezoso
    if (accounts.length === 0) {
      const accessToken = await getFreshAccessToken(ga);
      const resourceNames = await listAccessibleCustomers(accessToken); // ["customers/123", ...]
      const ids = resourceNames.map((rn) => rn.split('/')[1]).filter(Boolean);

      const metas = [];
      for (const cid of ids) {
        metas.push(await getCustomer(accessToken, cid));
      }
      accounts = metas;

      // Persiste enriquecido y espejo en customers
      await GoogleAccount.updateOne(
        { _id: ga._id },
        {
          $set: {
            ad_accounts: accounts,
            customers: accounts.map(a => ({
              id: a.id,
              descriptiveName: a.name,
              currencyCode: a.currencyCode,
              timeZone: a.timeZone,
              status: a.status,
            })),
          },
        }
      );
    }

    // defaultCustomerId sensato
    let defaultCustomerId = normId(ga.defaultCustomerId || '');
    if (!defaultCustomerId && accounts.length) defaultCustomerId = normId(accounts[0].id);

    // Si seguimos sin cuentas, avisa a la UI para reconectar/seleccionar
    if (!accounts.length) {
      return res.json({
        ok: true,
        accounts: [],
        defaultCustomerId: null,
        requiredSelection: true,
        reason: 'NO_ACCESSIBLE_ACCOUNTS',
      });
    }

    return res.json({
      ok: true,
      accounts,
      defaultCustomerId: defaultCustomerId || null,
      requiredSelection: false,
    });
  } catch (err) {
    console.error('google/ads/accounts error:', err?.response?.data || err);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights
 * KPIs + serie para el customer_id seleccionado o default.
 * Query params: customer_id | date_preset | range | include_today | objective | compare_mode
 * ==========================================================================*/
router.get('/', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken objective defaultCustomerId customers ad_accounts loginCustomerId managerCustomerId scope expiresAt')
      .lean();

    if (!ga?.refreshToken && !ga?.accessToken) {
      return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED', requiredSelection: true, reason: 'GOOGLE_NOT_CONNECTED' });
    }

    // Bloquea si no tiene scope de Ads
    const hasAdwordsScope = (ga.scope || []).includes('https://www.googleapis.com/auth/adwords');
    if (!hasAdwordsScope) {
      return res.status(400).json({ ok: false, error: 'MISSING_ADS_SCOPE', requiredSelection: true, reason: 'MISSING_ADS_SCOPE' });
    }

    // Resolver customerId: query > default > primero de lista
    const qCustomer = normId(String(req.query.customer_id || req.query.account_id || ''));
    const defaultCustomer = normId(ga.defaultCustomerId || '');
    const first = normId(
      (ga.ad_accounts?.[0]?.id) ||
      (ga.customers?.[0]?.id) || ''
    );
    const customerId = qCustomer || defaultCustomer || first;

    if (!customerId) {
      return res.status(400).json({ ok: false, error: 'NO_CUSTOMER_ID', requiredSelection: true, reason: 'NO_CUSTOMER_ID' });
    }

    // Parámetros de fechas/objetivo tal y como los usa el front
    const opts = {
      accessToken: await getFreshAccessToken(ga),
      customerId,
      datePreset: String(req.query.date_preset || '').toLowerCase() || null,
      range: String(req.query.range || '').trim() || null,
      includeToday: String(req.query.include_today || '0'),
      objective: (['ventas','alcance','leads'].includes(String(req.query.objective || ga.objective || DEFAULT_OBJECTIVE).toLowerCase())
        ? String(req.query.objective || ga.objective || DEFAULT_OBJECTIVE).toLowerCase()
        : DEFAULT_OBJECTIVE),
      compareMode: String(req.query.compare_mode || 'prev_period'),
    };

    const data = await fetchInsights(opts);
    return res.json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || err.message || String(err);
    if (status === 401 || status === 403) {
      console.error('google/ads auth error: Revisa Developer Token ↔ OAuth Client ID y permisos del MCC.');
    }
    console.error('google/ads insights error:', detail);
    return res.status(status).json({ ok: false, error: 'GOOGLE_ADS_ERROR', detail });
  }
});

/* ============================================================================
 * POST /api/google/ads/insights/default
 * Guarda defaultCustomerId
 * ==========================================================================*/
router.post('/default', requireAuth, express.json(), async (req, res) => {
  try {
    const cid = normId(req.body?.customerId || '');
    if (!cid) return res.status(400).json({ ok: false, error: 'CUSTOMER_REQUIRED' });

    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultCustomerId: cid } },
      { upsert: true }
    );

    return res.json({ ok: true, defaultCustomerId: cid });
  } catch (err) {
    console.error('google/ads/default error:', err);
    return res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_ERROR' });
  }
});

module.exports = router;
