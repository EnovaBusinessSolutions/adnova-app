// backend/routes/googleAdsInsights.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const router = express.Router();

// === Logger con sanitizado (no expone tokens/secretos) ===
const logger = require('../utils/logger');

// === Helpers Google Ads (solo normalización) ===
const {
  normalizeId: normalizeIdHelper,
} = require('../utils/googleAdsHelpers');

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
    customers:         { type: Array, default: [] },
    ad_accounts:       { type: [AdAccountSchema], default: [] },

    // Selección persistente
    selectedCustomerIds: { type: [String], default: [] },

    // Logs/errores de discovery
    lastAdsDiscoveryError: { type: String, default: null },
    lastAdsDiscoveryLog:   { type: Schema.Types.Mixed, default: null, select: false },

    // Opcional
    objective:         { type: String, enum: ['ventas','alcance','leads'], default: 'ventas' },
    expiresAt:         { type: Date },
  }, { collection: 'googleaccounts', timestamps: true });

  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

// ===== Servicio de Ads (REST) =====
const Ads = require('../services/googleAdsService');

// ===== Constantes / helpers =====
const DEFAULT_OBJECTIVE = 'ventas';
const MAX_BY_RULE = 3;

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

const normId = (s = '') =>
  String(s).replace(/^customers\//, '').replace(/[^\d]/g, '').trim();

function oauth() {
  return new OAuth2Client({
    clientId:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri:  process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/** Utilidad: primer valor definido entre varias claves (snake/camel). */
function pickAny(obj = {}, keys = []) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/** Acepta objeto con claves camelCase o snake_case y normaliza a nuestro shape. */
function normalizeAcc(a = {}) {
  // id puede venir como id, customerId o dentro de resourceName "customers/123"
  const idRaw = pickAny(a, ['id', 'customerId', 'customer_id', 'customerID', 'resourceName', 'resource_name']) || '';
  const id = normId(idRaw);

  // nombre: name | descriptiveName | descriptive_name
  const name = pickAny(a, ['name', 'descriptiveName', 'descriptive_name']) ?? null;

  // currency/timezone en ambas variantes
  const currencyCode = pickAny(a, ['currencyCode', 'currency_code', 'currency']) ?? null;
  const timeZone     = pickAny(a, ['timeZone', 'time_zone', 'timezone']) ?? null;

  // status: status | accountStatus
  const status = pickAny(a, ['status', 'accountStatus']) ?? null;

  return { id, name, currencyCode, timeZone, status };
}

/**
 * Devuelve un access_token vigente usando accessToken o refreshToken.
 * Actualiza Mongo si logra un refresh con nueva expiración.
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

  // 1) refreshAccessToken (con expiry)
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
  } catch (_) { /* ignore y probamos getAccessToken */ }

  // 2) getAccessToken (sin expiry)
  const t = await client.getAccessToken().catch(() => null);
  if (t?.token) return t.token;

  if (gaDoc?.accessToken) return gaDoc.accessToken;
  throw new Error('NO_ACCESS_OR_REFRESH_TOKEN');
}

// === selección: helpers
function selectedFromDocOrUser(gaDoc, req) {
  const fromDoc = Array.isArray(gaDoc?.selectedCustomerIds) && gaDoc.selectedCustomerIds.length
    ? gaDoc.selectedCustomerIds.map(normId)
    : [];
  if (fromDoc.length) return [...new Set(fromDoc.filter(Boolean))];

  const legacy = Array.isArray(req.user?.selectedGoogleAccounts)
    ? req.user.selectedGoogleAccounts.map(normId)
    : [];
  return [...new Set(legacy.filter(Boolean))];
}

function availableAccountIds(gaDoc) {
  const fromAdAcc = (Array.isArray(gaDoc?.ad_accounts) ? gaDoc.ad_accounts : []).map(a => normId(a.id)).filter(Boolean);
  const fromCust  = (Array.isArray(gaDoc?.customers) ? gaDoc.customers : []).map(c => normId(c.id)).filter(Boolean);
  const set = new Set([...fromAdAcc, ...fromCust]);
  return [...set];
}

// Guardar error/log de discovery
async function saveDiscoveryFailure(userId, reason, log) {
  const safeReason = (() => {
    try { return JSON.stringify(reason).slice(0, 8000); } catch { return String(reason).slice(0, 2000); }
  })();
  await GoogleAccount.updateOne(
    { $or: [{ user: userId }, { userId }] },
    { $set: { lastAdsDiscoveryError: safeReason, lastAdsDiscoveryLog: log || null } }
  ).catch(()=>{});
}

/* ============================================================================
 * Enriquecimiento vía GAQL desde el MCC (REST)
 * ========================================================================= */
async function enrichAccountsWithGAQL(ga) {
  const accessToken = await getFreshAccessToken(ga);
  const managerId = normId(process.env.GOOGLE_LOGIN_CUSTOMER_ID || ga.managerCustomerId || ga.loginCustomerId || '');
  if (!managerId) throw new Error('NO_MANAGER_ID_FOR_GAQL');

  const GAQL = `
    SELECT
      customer_client.id,
      customer_client.descriptive_name,
      customer_client.currency_code,
      customer_client.time_zone,
      customer_client.status,
      customer_client.level
    FROM customer_client
    WHERE customer_client.level <= 1
    ORDER BY customer_client.id
  `.replace(/\s+/g, ' ').trim();

  const rows = await Ads.searchGAQLStream(accessToken, managerId, GAQL);

  // Aceptamos tanto r.customer_client (snake) como r.customerClient (camel)
  const accounts = rows.map(r => {
    const cc = r?.customer_client || r?.customerClient || {};
    return normalizeAcc({
      // id
      id: pickAny(cc, ['id', 'customerId', 'customer_id']),
      // nombre
      name: pickAny(cc, ['descriptiveName', 'descriptive_name']),
      descriptive_name: cc.descriptive_name, // por si acaso
      descriptiveName: cc.descriptiveName,
      // currency/timezone/status en ambas variantes
      currency_code: pickAny(cc, ['currency_code', 'currencyCode']),
      time_zone:     pickAny(cc, ['time_zone', 'timeZone']),
      status:        cc.status,
    });
  }).filter(a => a.id);

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
        updatedAt: new Date(),
        lastAdsDiscoveryError: null,
        lastAdsDiscoveryLog: null,
      },
    }
  );

  return accounts;
}

/* ============================================================================
 * POST /api/google/ads/insights/accounts/selection
 * ========================================================================= */
router.post('/accounts/selection', requireAuth, express.json(), async (req, res) => {
  try {
    const { accountIds } = req.body;
    if (!Array.isArray(accountIds)) {
      return res.status(400).json({ ok: false, error: 'accountIds[] requerido' });
    }

    const wanted = [...new Set(accountIds.map(normId).filter(Boolean))];

    const ga = await GoogleAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('ad_accounts customers defaultCustomerId')
      .lean();

    if (!ga) {
      return res.status(404).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });
    }

    const available = new Set(
      (Array.isArray(ga?.ad_accounts) && ga.ad_accounts.length ? ga.ad_accounts : (ga?.customers || []))
        .map(a => normId(a.id))
    );

    const selected = wanted.filter(id => available.has(id));
    if (!selected.length) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_ACCOUNTS' });
    }

    await GoogleAccount.updateOne(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { selectedCustomerIds: selected } }
    );

    await User.updateOne(
      { _id: req.user._id },
      { $set: { selectedGoogleAccounts: selected } }
    );

    let nextDefault = ga?.defaultCustomerId ? normId(ga.defaultCustomerId) : null;
    if (!nextDefault || !selected.includes(nextDefault)) {
      nextDefault = selected[0];
      await GoogleAccount.updateOne(
        { $or: [{ user: req.user._id }, { userId: req.user._id }] },
        { $set: { defaultCustomerId: nextDefault } }
      );
    }

    return res.json({ ok: true, selected, defaultCustomerId: nextDefault });
  } catch (e) {
    logger.error('google/accounts/selection error', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights/accounts
 * ========================================================================= */
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers ad_accounts defaultCustomerId loginCustomerId managerCustomerId scope selectedCustomerIds lastAdsDiscoveryError lastAdsDiscoveryLog')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, accounts: [], defaultCustomerId: null, requiredSelection: false });
    }

    const force = String(req.query.force || '0') === '1';

    // 1) Cargar lo guardado
    let accounts = Array.isArray(ga.ad_accounts) ? ga.ad_accounts : [];

    // 2) ¿Faltan nombres? usamos GAQL desde MCC
    const hasName = (a) => !!(a && (a.name || a.descriptiveName || a.descriptive_name));
    const needsEnrich = force || accounts.length === 0 || accounts.some(a => !hasName(a));

    if (needsEnrich) {
      try {
        accounts = await enrichAccountsWithGAQL(ga);
      } catch (e) {
        const reason = e?.api?.error || e?.response?.data || e?.message || 'GAQL_ENRICH_FAILED';
        const log    = e?.api?.log || null;
        await saveDiscoveryFailure(req.user._id, reason, log);
        // devolvemos lo que haya guardado (aunque sea solo IDs)
      }
    } else {
      // Normaliza nombres si ya estaban guardados con otra llave
      accounts = accounts.map(normalizeAcc);
    }

    // === Regla de selección
    const availIds = accounts.map(a => normId(a.id));
    const selected = selectedFromDocOrUser(ga, req);
    const requiredSelection = availIds.length > MAX_BY_RULE && selected.length === 0;

    // Filtrar por selección si existe
    let filtered = accounts;
    if (selected.length > 0) {
      const allow = new Set(selected);
      filtered = accounts.filter(a => allow.has(normId(a.id)));
    }

    // defaultCustomerId
    let defaultCustomerId = normId(ga?.defaultCustomerId || '');
    if (selected.length > 0 && defaultCustomerId && !selected.includes(defaultCustomerId)) {
      defaultCustomerId = '';
    }
    if (!defaultCustomerId) {
      const firstEnabled = filtered.find(a => (String(a.status || '').toUpperCase()) === 'ENABLED')?.id;
      defaultCustomerId = normId(firstEnabled || (filtered[0]?.id || '')) || null;
      if (defaultCustomerId) {
        await GoogleAccount.updateOne(
          { $or: [{ user: req.user._id }, { userId: req.user._id }] },
          { $set: { defaultCustomerId } }
        );
      }
    }

    return res.json({
      ok: true,
      accounts: filtered,
      defaultCustomerId: defaultCustomerId || null,
      requiredSelection,
    });
  } catch (err) {
    logger.error('google/ads/accounts error', err?.response?.data || err);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights  ← 100% REST (dinámico por rango/preset)
 * ========================================================================= */
router.get('/', requireAuth, async (req, res) => {
  try {
    // 1) Validar conexión
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken objective defaultCustomerId customers ad_accounts loginCustomerId managerCustomerId expiresAt selectedCustomerIds')
      .lean();

    if (!ga?.refreshToken && !ga?.accessToken) {
      return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });
    }

    // 2) Reglas de selección
    const availIds = availableAccountIds(ga);
    const selected = selectedFromDocOrUser(ga, req);
    if (availIds.length > MAX_BY_RULE && selected.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'SELECTION_REQUIRED',
        reason: 'SELECTION_REQUIRED(>3_ACCOUNTS)',
        requiredSelection: true
      });
    }

    // 3) Resolver customerId (query > default > primero)
    const rawQueryId = String(req.query.account_id || req.query.customer_id || req.query.customer || '');
    let requested = normalizeIdHelper(rawQueryId)
                 || normalizeIdHelper(ga.defaultCustomerId || '')
                 || normalizeIdHelper((ga.ad_accounts?.[0]?.id) || (ga.customers?.[0]?.id) || '');

    if (!requested) {
      return res.status(400).json({ ok: false, error: 'NO_CUSTOMER_ID' });
    }

    // Si hay selección y el solicitado no pertenece, forzar/denegar
    if (selected.length > 0 && !selected.includes(requested)) {
      if (rawQueryId) {
        return res.status(403).json({ ok: false, error: 'ACCOUNT_NOT_ALLOWED' });
      }
      requested = selected[0];
    }

    // (Extra) Validar que exista en los disponibles para evitar URL manipulada
    const availableSet = new Set(availIds);
    if (!availableSet.has(requested)) {
      return res.status(404).json({ ok: false, error: 'ACCOUNT_NOT_FOUND' });
    }

    // 4) Normalizar rango: si hay date_preset úsalo; si no, usa range/include_today
    const datePreset = req.query.date_preset
      ? String(req.query.date_preset).toLowerCase()
      : null;

    const range = (req.query.range != null && req.query.range !== '')
      ? Number(req.query.range)
      : null; // días (null = default del service)

    const includeToday = String(req.query.include_today || '0') === '1';

    // 5) Objetivo
    const validObjectives = new Set(['ventas', 'alcance', 'leads']);
    const rqObj = String(req.query.objective || '').toLowerCase();
    const objective = validObjectives.has(rqObj) ? rqObj : (ga.objective || DEFAULT_OBJECTIVE);

    // 6) Traer KPIs y serie reales (REST GAQL vía service)
    const accessToken = await getFreshAccessToken(ga);

    const payload = await Ads.fetchInsights({
      accessToken,
      customerId: requested,
      datePreset: datePreset || undefined,          // 'today','yesterday','last_7d','this_month', etc.
      range,                                        // número de días o null
      includeToday,                                 // boolean
      objective,                                    // 'ventas' | 'alcance' | 'leads'
      compareMode: req.query.compare_mode || null,  // reservado para deltas futuras
    });

    return res.json(payload);
  } catch (err) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || err?.api?.error || err.message || String(err);
    if (status === 401 || status === 403) {
      logger.error('google/ads auth error', { status, detail });
    } else {
      logger.error('google/ads insights error', { status, detail });
    }
    return res.status(status).json({ ok: false, error: 'GOOGLE_ADS_ERROR', detail });
  }
});

/* ============================================================================
 * POST /api/google/ads/insights/default
 * ========================================================================= */
router.post('/default', requireAuth, express.json(), async (req, res) => {
  try {
    const cid = normId(req.body?.customerId || '');
    if (!cid) return res.status(400).json({ ok: false, error: 'CUSTOMER_REQUIRED' });

    const ga = await GoogleAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('selectedCustomerIds')
      .lean();

    const selected = selectedFromDocOrUser(ga || {}, req);
    if (selected.length > 0 && !selected.includes(cid)) {
      return res.status(403).json({ ok: false, error: 'ACCOUNT_NOT_ALLOWED' });
    }

    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultCustomerId: cid } },
      { upsert: true }
    );

    return res.json({ ok: true, defaultCustomerId: cid });
  } catch (err) {
    logger.error('google/ads/default error', err);
    return res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_ERROR' });
  }
});

/* ============================================================================
 * POST /api/google/ads/insights/mcc/invite
 * ========================================================================= */
router.post('/mcc/invite', requireAuth, express.json(), async (req, res) => {
  try {
    const customerId = normId(req.body?.customer_id || req.body?.customerId || '');
    if (!customerId) return res.status(400).json({ ok: false, error: 'CUSTOMER_ID_REQUIRED' });

    const ga = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+accessToken +refreshToken managerCustomerId loginCustomerId')
      .lean();
    if (!ga) return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });

    const accessToken = await getFreshAccessToken(ga);
    const managerId = normId(process.env.GOOGLE_LOGIN_CUSTOMER_ID || ga.managerCustomerId || ga.loginCustomerId || '');
    if (!managerId) {
      return res.status(400).json({ ok: false, error: 'NO_MANAGER_ID', note: 'Configura GOOGLE_LOGIN_CUSTOMER_ID o guarda managerCustomerId/loginCustomerId en GoogleAccount.' });
    }

    const data = await Ads.mccInviteCustomer({
      accessToken,
      managerId,
      clientId: customerId,
    });

    return res.json({ ok: true, managerId, customerId, data });
  } catch (err) {
    const detail = err?.api?.error || err?.response?.data || err.message || String(err);
    const apiLog = err?.api?.log || null;
    logger.error('google/ads mcc/invite error', { detail, apiLog });
    return res.status(400).json({ ok: false, error: 'MCC_INVITE_ERROR', detail, apiLog });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights/mcc/invite/status
 * ========================================================================= */
router.get('/mcc/invite/status', requireAuth, async (req, res) => {
  try {
    const customerId = normId(String(req.query.customer_id || req.query.customerId || ''));
    if (!customerId) return res.status(400).json({ ok: false, error: 'CUSTOMER_ID_REQUIRED' });

    const ga = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+accessToken +refreshToken managerCustomerId loginCustomerId')
      .lean();
    if (!ga) return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });

    const accessToken = await getFreshAccessToken(ga);
    const managerId = normId(process.env.GOOGLE_LOGIN_CUSTOMER_ID || ga.managerCustomerId || ga.loginCustomerId || '');
    if (!managerId) {
      return res.status(400).json({ ok: false, error: 'NO_MANAGER_ID', note: 'Configura GOOGLE_LOGIN_CUSTOMER_ID o guarda managerCustomerId/loginCustomerId en GoogleAccount.' });
    }

    const status = await Ads.getMccLinkStatus({
      accessToken,
      managerId,
      clientId: customerId,
    });

    return res.json({ ok: true, managerId, customerId, ...status });
  } catch (err) {
    const detail = err?.api?.error || err?.response?.data || err.message || String(err);
    const apiLog = err?.api?.log || null;
    logger.error('google/ads mcc/invite/status error', { detail, apiLog });
    return res.status(400).json({ ok: false, error: 'MCC_STATUS_ERROR', detail, apiLog });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights/selftest
 * ========================================================================= */
router.get('/selftest', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken defaultCustomerId customers ad_accounts selectedCustomerIds')
      .lean();

    if (!ga) return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });

    const accessToken = await getFreshAccessToken(ga);

    let cid = normId(String(req.query.customer_id || '')) ||
              normId(ga.defaultCustomerId || '') ||
              normId((ga.ad_accounts?.[0]?.id) || (ga.customers?.[0]?.id) || '');

    if (!cid) return res.status(400).json({ ok: false, error: 'NO_CUSTOMER_ID' });

    const now = new Date();
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = new Date(to); from.setUTCDate(to.getUTCDate() - 6);
    const fmt = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;

    const GAQL = `
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks
      FROM customer
      WHERE segments.date BETWEEN '${fmt(from)}' AND '${fmt(to)}'
      ORDER BY segments.date
    `;

    try {
      const rows = await Ads.searchGAQLStream(accessToken, cid, GAQL);
      return res.json({
        ok: true,
        customer_id: cid,
        rows,
        rowsCount: rows.length,
        gaql: GAQL.replace(/\s+/g, ' ').trim(),
      });
    } catch (e) {
      logger.warn('google/ads/selftest searchStream 400', { detail: e?.api?.error || e.message });
      return res.status(400).json({
        ok: false,
        error: 'SEARCHSTREAM_400',
        detail: e?.api?.error || e.message,
        apiLog: e?.api?.log || null,
        requestId: e?.api?.log?.requestId || null,
        gaql: GAQL.replace(/\s+/g, ' ').trim(),
        customer_id: cid,
      });
    }
  } catch (err) {
    logger.error('google/ads/selftest error', err);
    return res.status(500).json({ ok: false, error: 'SELFTEST_ERROR', detail: err?.message || String(err) });
  }
});

/* ============================================================================
 * DEBUG: ver respuesta de nombres vía GAQL customer_client
 * ========================================================================= */
router.get('/debug/names', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('+accessToken +refreshToken managerCustomerId loginCustomerId').lean();

    if (!ga) return res.status(400).json({ ok: false, error: 'NO_GA_DOC' });

    const accessToken = await getFreshAccessToken(ga);
    const managerId = normId(process.env.GOOGLE_LOGIN_CUSTOMER_ID || ga.managerCustomerId || ga.loginCustomerId || '');
    if (!managerId) return res.status(400).json({ ok: false, error: 'NO_MANAGER_ID' });

    const GAQL = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.status,
        customer_client.level
      FROM customer_client
      WHERE customer_client.level <= 1
      ORDER BY customer_client.id
    `.replace(/\s+/g, ' ').trim();

    const rows = await Ads.searchGAQLStream(accessToken, managerId, GAQL);
    return res.json({ ok: true, managerId, rowsCount: rows.length, rows });
  } catch (err) {
    logger.error('google/ads/debug/names error', err);
    return res.status(500).json({ ok: false, error: 'DEBUG_NAMES_ERROR', detail: err?.message || String(err) });
  }
});

/* ============================================================================
 * DEBUG: listAccessibleCustomers y getCustomer del primero
 * ========================================================================= */
router.get('/debug/raw', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('+accessToken +refreshToken loginCustomerId').lean();

    if (!ga) return res.status(400).json({ ok: false, error: 'NO_GA_DOC' });

    const accessToken = await getFreshAccessToken(ga);

    let list, errList = null, listLog = null;
    try {
      list = await Ads.listAccessibleCustomers(accessToken);
    } catch (e) {
      errList = e?.api?.error || e?.response?.data || e.message;
      listLog = e?.api?.log || null;
    }

    let firstMeta = null, errMeta = null, metaLog = null;
    const firstId = Array.isArray(list) && list.length ? String(list[0]).split('/')[1] : null;
    if (firstId) {
      try {
        firstMeta = await Ads.getCustomer(accessToken, firstId);
      } catch (e) {
        errMeta = e?.api?.error || e?.response?.data || e.message;
        metaLog = e?.api?.log || null;
      }
    }

    res.json({
      ok: true,
      loginCustomerId: ga.loginCustomerId || process.env.GOOGLE_LOGIN_CUSTOMER_ID || null,
      listAccessibleCustomers: list || [],
      listError: errList,
      listApiLog: listLog,
      firstCustomerTried: firstId,
      firstCustomerMeta: firstMeta,
      firstCustomerError: errMeta,
      firstCustomerApiLog: metaLog,
      apiVersion: process.env.GADS_API_VERSION || 'v18',
    });
  } catch (err) {
    logger.error('google/ads/debug/raw error', err);
    res.status(500).json({ ok: false, error: 'DEBUG_RAW_ERROR', detail: err?.message || String(err) });
  }
});

module.exports = router;
