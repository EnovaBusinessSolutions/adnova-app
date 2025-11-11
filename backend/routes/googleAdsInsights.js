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
    customers:         { type: Array, default: [] }, // [{ id, descriptiveName, currencyCode, timeZone, status }]
    ad_accounts:       { type: [AdAccountSchema], default: [] },

    // Selección persistente
    selectedCustomerIds: { type: [String], default: [] },

    // Logs/errores de discovery (útiles para Google soporte)
    lastAdsDiscoveryError: { type: String, default: null },
    lastAdsDiscoveryLog:   { type: Schema.Types.Mixed, default: null, select: false },

    // Opcional
    objective:         { type: String, enum: ['ventas','alcance','leads'], default: 'ventas' },
    expiresAt:         { type: Date },
  }, { collection: 'googleaccounts', timestamps: true });

  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

// ===== Servicio de Ads (import NO-destructurado) =====
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

/** Normaliza un objeto de cuenta (API o Mongo) garantizando .name cuando sea posible */
function normalizeAcc(a = {}) {
  const id = normId(a.id || a.customerId || a.resourceName || '');
  const name = (a.name || a.descriptiveName || null);
  return {
    id,
    name,
    currencyCode: a.currencyCode || a.currency || null,
    timeZone: a.timeZone || a.timezone || null,
    status: (a.status || a.accountStatus || null),
  };
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
 * POST /api/google/ads/insights/accounts/selection
 * Guarda selección persistente en GoogleAccount.selectedCustomerIds
 * (y espejo opcional en User.selectedGoogleAccounts para retrocompat)
 * ==========================================================================*/
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

    // Guarda selección en el conector
    await GoogleAccount.updateOne(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { selectedCustomerIds: selected } }
    );

    // (opcional) espejo legacy en User
    await User.updateOne(
      { _id: req.user._id },
      { $set: { selectedGoogleAccounts: selected } }
    );

    // Asegura default dentro de la selección
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
    console.error('google/accounts/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights/accounts
 * Descubre y devuelve las cuentas accesibles para el usuario actual.
 * Estructura esperada por el hook del frontend:
 *   { ok, accounts, defaultCustomerId, requiredSelection }
 *   Soporta ?force=1 para re-descubrir y enriquecer nombres ignorando caché.
 * ==========================================================================*/
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const force = String(req.query.force || '').trim() === '1';

    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers ad_accounts defaultCustomerId loginCustomerId managerCustomerId scope selectedCustomerIds lastAdsDiscoveryError lastAdsDiscoveryLog')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, accounts: [], defaultCustomerId: null, requiredSelection: false });
    }

    // 1) intentamos usar caché salvo que pidan force
    let accounts = [];
    if (!force) {
      const cached = (Array.isArray(ga.ad_accounts) && ga.ad_accounts.length ? ga.ad_accounts : (ga.customers || []));
      accounts = cached.map(normalizeAcc);
    }

    // 2) si no hay nombres, o force=1, re-descubrimos con la API
    const missingNames = accounts.length && accounts.every(a => !a.name);
    if (force || accounts.length === 0 || missingNames) {
      try {
        const accessToken = await getFreshAccessToken(ga);
        const enriched = await Ads.discoverAndEnrich(accessToken); // [{id, name || descriptiveName, ...}]
        accounts = (Array.isArray(enriched) ? enriched : []).map(c => ({
          id: normId(c.id),
          name: c.name || c.descriptiveName || null,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        // guarda enriquecido y espejo en customers (con descriptiveName por compat)
        await GoogleAccount.updateOne(
          { _id: ga._id },
          {
            $set: {
              ad_accounts: accounts.map(a => ({ id: a.id, name: a.name, currencyCode: a.currencyCode, timeZone: a.timeZone, status: a.status })),
              customers:   accounts.map(a => ({ id: a.id, descriptiveName: a.name, currencyCode: a.currencyCode, timeZone: a.timeZone, status: a.status })),
              updatedAt: new Date(),
              lastAdsDiscoveryError: null,
              lastAdsDiscoveryLog: null,
            },
          }
        );
      } catch (e) {
        const reason = e?.api?.error || e?.response?.data || e?.message || 'LAZY_DISCOVERY_FAILED';
        const log    = e?.api?.log || null;
        await saveDiscoveryFailure(req.user._id, reason, log);
        // Si no logramos descubrir y no había caché utilizable, devolvemos error
        if (!accounts.length) {
          return res.status(502).json({ ok: false, error: 'DISCOVERY_ERROR', reason, apiLog: log || null });
        }
        // De lo contrario, devolvemos la caché (aunque sean ids pelones)
      }
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

    // defaultCustomerId: guardado (si permitido) > primero ENABLED > primero
    let defaultCustomerId = normId(ga?.defaultCustomerId || '');
    if (selected.length > 0 && defaultCustomerId && !selected.includes(defaultCustomerId)) {
      defaultCustomerId = '';
    }
    if (!defaultCustomerId) {
      const firstEnabled = filtered.find(a => (a.status || '').toUpperCase() === 'ENABLED')?.id;
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
      accounts: filtered,                 // <-- ya incluyen .name cuando fue posible
      defaultCustomerId: defaultCustomerId || null,
      requiredSelection,
    });
  } catch (err) {
    console.error('google/ads/accounts error:', err?.response?.data || err);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights
 * Devuelve KPIs + serie para el customer_id seleccionado o default.
 * Query params soportados:
 *   customer_id | account_id, date_preset, range, include_today, objective, compare_mode
 * ==========================================================================*/
router.get('/', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken objective defaultCustomerId customers ad_accounts loginCustomerId managerCustomerId expiresAt selectedCustomerIds')
      .lean();

    if (!ga?.refreshToken && !ga?.accessToken) {
      return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });
    }

    // Regla de selección (consistente con Meta): si hay >3 y no hay selección ⇒ 400
    const availIds = availableAccountIds(ga);
    const selected = selectedFromDocOrUser(ga, req);
    if (availIds.length > MAX_BY_RULE && selected.length === 0) {
      return res.status(400).json({
        ok: false,
        reason: 'SELECTION_REQUIRED(>3_ACCOUNTS)',
        requiredSelection: true
      });
    }

    // Resolver customerId: query > default > primero de lista
    let requested = normId(String(req.query.customer_id || req.query.account_id || '')) ||
                    normId(ga.defaultCustomerId || '') ||
                    normId((ga.ad_accounts?.[0]?.id) || (ga.customers?.[0]?.id) || '');

    if (!requested) {
      return res.status(400).json({ ok: false, error: 'NO_CUSTOMER_ID' });
    }

    // Si hay selección y el solicitado no pertenece, forzamos a uno permitido o 403 si venía por query
    if (selected.length > 0 && !selected.includes(requested)) {
      if (req.query.customer_id || req.query.account_id) {
        return res.status(403).json({ ok: false, error: 'ACCOUNT_NOT_ALLOWED' });
      }
      requested = selected[0];
    }

    const data = await Ads.fetchInsights({
      accessToken: await getFreshAccessToken(ga),
      customerId: requested,
      datePreset: String(req.query.date_preset || '').toLowerCase() || null,
      range: String(req.query.range || '').trim() || null,          // default se aplica dentro del servicio
      includeToday: String(req.query.include_today || '0'),
      objective: (['ventas','alcance','leads'].includes(String(req.query.objective || ga.objective || DEFAULT_OBJECTIVE).toLowerCase())
        ? String(req.query.objective || ga.objective || DEFAULT_OBJECTIVE).toLowerCase()
        : DEFAULT_OBJECTIVE),
      compareMode: String(req.query.compare_mode || 'prev_period'),
    });

    return res.json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || err?.api?.error || err.message || String(err);
    const apiLog = err?.api?.log || null; // viene del servicio si falló una llamada v22
    if (status === 401 || status === 403) {
      console.error('google/ads auth error: Revisa Developer Token ↔ OAuth Client ID y permisos del MCC.');
    }
    console.error('google/ads insights error:', detail);
    return res.status(status).json({ ok: false, error: 'GOOGLE_ADS_ERROR', detail, apiLog });
  }
});

/* ============================================================================
 * POST /api/google/ads/insights/default
 * Guarda defaultCustomerId (si tu UI lo usa).
 * ==========================================================================*/
router.post('/default', requireAuth, express.json(), async (req, res) => {
  try {
    const cid = normId(req.body?.customerId || '');
    if (!cid) return res.status(400).json({ ok: false, error: 'CUSTOMER_REQUIRED' });

    // Verifica que, si hay selección, el default pertenezca a la selección
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
    console.error('google/ads/default error:', err);
    return res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_ERROR' });
  }
});

/* ============================================================================
 * POST /api/google/ads/insights/mcc/invite
 * Envía invitación Manager→Client usando el MCC configurado.
 * Body: { customer_id: "123-456-7890" }
 * ==========================================================================*/
router.post('/mcc/invite', requireAuth, express.json(), async (req, res) => {
  try {
    const customerId = normId(req.body?.customer_id || req.body?.customerId || '');
    if (!customerId) return res.status(400).json({ ok: false, error: 'CUSTOMER_ID_REQUIRED' });

    const ga = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+accessToken +refreshToken managerCustomerId loginCustomerId')
      .lean();
    if (!ga) return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });

    const accessToken = await getFreshAccessToken(ga);

    // ManagerId: preferimos env → managerCustomerId guardado → loginCustomerId
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
    return res.status(400).json({ ok: false, error: 'MCC_INVITE_ERROR', detail, apiLog });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights/mcc/invite/status
 * Consulta el estado del vínculo Manager↔Client para el MCC configurado.
 * Query: ?customer_id=123-456-7890
 * ==========================================================================*/
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
    return res.status(400).json({ ok: false, error: 'MCC_STATUS_ERROR', detail, apiLog });
  }
});

/* ============================================================================
 * GET /api/google/ads/insights/selftest
 * Autodiagnóstico rápido de searchStream: ejecuta un GAQL mínimo y retorna
 * requestId / apiLog en caso de error. Útil para soporte de Google.
 * Query opcional: customer_id
 * ==========================================================================*/
router.get('/selftest', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken defaultCustomerId customers ad_accounts selectedCustomerIds')
      .lean();

    if (!ga) return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });

    const accessToken = await getFreshAccessToken(ga);

    // Resolver customerId (query > default > primero)
    let cid = normId(String(req.query.customer_id || '')) ||
              normId(ga.defaultCustomerId || '') ||
              normId((ga.ad_accounts?.[0]?.id) || (ga.customers?.[0]?.id) || '');

    if (!cid) return res.status(400).json({ ok: false, error: 'NO_CUSTOMER_ID' });

    // GAQL mínimo (últimos 7 días)
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
      // Preserva requestId / apiLog para soporte
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
    console.error('google/ads/selftest error:', err);
    return res.status(500).json({ ok: false, error: 'SELFTEST_ERROR', detail: err?.message || String(err) });
  }
});

// DEBUG: ver respuesta cruda de listAccessibleCustomers y getCustomer
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
      apiVersion: process.env.GADS_API_VERSION || 'v22',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'DEBUG_RAW_ERROR', detail: err?.message || String(err) });
  }
});

module.exports = router;
