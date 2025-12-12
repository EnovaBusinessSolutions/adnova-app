'use strict';

const express = require('express');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const router = express.Router();

/* ================= MODELOS ================= */
const User = require('../models/User');
let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  const schema = new mongoose.Schema(
    {
      user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },

      accessToken:  { type: String, select: false },
      refreshToken: { type: String, select: false },
      scope:        { type: [String], default: [] },

      gaProperties:      { type: Array, default: [] },
      defaultPropertyId: { type: String, default: null },

      // selección GA4 (nuevo)
      selectedPropertyIds: { type: [String], default: [] },

      // legacy
      selectedGaPropertyId: { type: String, default: null },
    },
    { collection: 'googleaccounts' }
  );
  GoogleAccount = mongoose.models.GoogleAccount || mongoose.model('GoogleAccount', schema);
}

/* =============== CONST & HELPERS =============== */
// Regla histórica: >3 disponibles => exigir selección explícita
const MAX_BY_RULE = 3;

function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function toPropertyResource(val) {
  const raw = String(val || '').trim();
  if (!raw) return '';
  if (/^properties\/\d+$/.test(raw)) return raw;
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits ? `properties/${digits}` : '';
}

async function getGaAccountDoc(userId) {
  return GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean();
}

async function getUserDoc(userId) {
  // Importante: NO depender de req.user (puede venir incompleto por sesión)
  return User.findById(userId)
    .select('_id selectedGAProperties preferences')
    .lean();
}

function availablePropertyIdsFromDoc(doc) {
  const list = Array.isArray(doc?.gaProperties) ? doc.gaProperties : [];
  return list.map(p => String(p?.propertyId || '').trim()).filter(Boolean);
}

/**
 * Selección GA4 robusta (orden de prioridad):
 * 1) GoogleAccount.selectedPropertyIds (nuevo)
 * 2) GoogleAccount.selectedGaPropertyId (legacy)
 * 3) GoogleAccount.defaultPropertyId (fallback)
 * 4) User.preferences.googleAnalytics.auditPropertyIds
 * 5) User.selectedGAProperties (legacy)
 */
function selectedPropsFromDocOrUser(doc, userDoc) {
  const fromDocArr = Array.isArray(doc?.selectedPropertyIds) ? doc.selectedPropertyIds : [];
  const normalizedDocArr = fromDocArr.map(toPropertyResource).filter(Boolean);
  if (normalizedDocArr.length) return [...new Set(normalizedDocArr)];

  const legacyOne = toPropertyResource(doc?.selectedGaPropertyId);
  if (legacyOne) return [legacyOne];

  const def = toPropertyResource(doc?.defaultPropertyId);
  if (def) return [def];

  const pref = userDoc?.preferences?.googleAnalytics?.auditPropertyIds;
  if (Array.isArray(pref) && pref.length) {
    const out = pref.map(toPropertyResource).filter(Boolean);
    if (out.length) return [...new Set(out)];
  }

  const legacyArr = userDoc?.selectedGAProperties;
  if (Array.isArray(legacyArr) && legacyArr.length) {
    const out = legacyArr.map(toPropertyResource).filter(Boolean);
    if (out.length) return [...new Set(out)];
  }

  return [];
}

/**
 * Resolver property para endpoints:
 * - si viene en query => se usa
 * - si NO viene => usa selección (selectedPropertyIds/legacy/default)
 * - si aún no hay => '' (y el handler decide si es requerido)
 */
async function resolvePropertyForRequest(req) {
  const raw = req.query.property || req.query.propertyId || '';
  const fromQuery = toPropertyResource(raw);
  if (fromQuery) return fromQuery;

  const [doc, userDoc] = await Promise.all([
    getGaAccountDoc(req.user._id),
    getUserDoc(req.user._id),
  ]);

  if (!doc) return '';

  const selected = selectedPropsFromDocOrUser(doc, userDoc);
  return selected[0] || toPropertyResource(doc.defaultPropertyId) || '';
}

/** Middleware: valida que la propiedad consultada esté permitida por la selección. */
async function ensureGaPropertyAllowed(req, res, next) {
  try {
    const [doc, userDoc] = await Promise.all([
      getGaAccountDoc(req.user._id),
      getUserDoc(req.user._id),
    ]);

    if (!doc) return res.status(401).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = availablePropertyIdsFromDoc(doc); // ["properties/123", ...]
    // Si aún no hay cache de propiedades, dejamos que las rutas sigan su flujo
    if (!available.length) return next();

    const selected = selectedPropsFromDocOrUser(doc, userDoc);

    // Regla: > MAX y sin selección explícita
    // (ojo: si doc.defaultPropertyId existe, selectedPropsFromDocOrUser te devolverá 1 y NO bloqueará)
    if (available.length > MAX_BY_RULE && (!Array.isArray(doc?.selectedPropertyIds) || doc.selectedPropertyIds.length === 0) && !doc?.selectedGaPropertyId) {
      return res.status(400).json({
        ok: false,
        reason: 'SELECTION_REQUIRED(>3_PROPERTIES)',
        requiredSelection: true
      });
    }

    // Si la request trae property explícita y hay selección => validar
    const raw = String(req.query.property || req.query.propertyId || '').trim();
    const normalized = raw ? toPropertyResource(raw) : '';

    if (selected.length > 0 && normalized) {
      if (!selected.includes(normalized)) {
        return res.status(403).json({ ok: false, error: 'PROPERTY_NOT_ALLOWED' });
      }
    }

    return next();
  } catch (e) {
    console.error('ensureGaPropertyAllowed error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_GUARD_FAILED' });
  }
}

/* =============== HELPERS / AUTH =============== */
async function getOAuthClientForUser(userId) {
  const ga = await GoogleAccount
    .findOne({ $or: [{ user: userId }, { userId }] })
    .select('+refreshToken +accessToken')
    .lean();

  if (!ga?.refreshToken) {
    const err = new Error('NO_REFRESH_TOKEN');
    err.code = 'NO_REFRESH_TOKEN';
    throw err;
  }

  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
    // no fijamos redirectUri
  );
  oAuth2Client.setCredentials({
    refresh_token: ga.refreshToken,
    access_token: ga.accessToken || undefined,
  });

  try { await oAuth2Client.getAccessToken(); } catch {}
  return oAuth2Client;
}

function buildDateRange(preset = 'last_30_days', includeToday = true) {
  const map = {
    last_7d: 7, last_7_days: 7,
    last_14d: 14, last_14_days: 14,
    last_28d: 28, last_28_days: 28,
    last_30d: 30, last_30_days: 30,
    last_90d: 90, last_90_days: 90,
  };
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!includeToday && preset !== 'yesterday') end.setDate(end.getDate() - 1);

  const start = new Date(end);
  if (map[preset]) {
    start.setDate(end.getDate() - (map[preset] - 1));
  } else if (preset === 'yesterday') {
    end.setDate(end.getDate() - 1);
    start.setTime(end.getTime());
  } else if (preset === 'today') {
    start.setTime(end.getTime());
  } else if (preset === 'this_month') {
    start.setFullYear(end.getFullYear(), end.getMonth(), 1);
  } else if (preset === 'last_month') {
    start.setMonth(end.getMonth() - 1, 1);
    end.setMonth(start.getMonth() + 1, 0);
  } else {
    start.setDate(end.getDate() - 29);
  }
  const fmt = (d) => d.toISOString().slice(0,10);
  const days = Math.ceil((end - start) / 86400000) + 1;
  return { startDate: fmt(start), endDate: fmt(end), days };
}

/* =============== GA ADMIN: SYNC PROPIEDADES =============== */
async function resyncAndPersistProperties(userId) {
  const auth = await getOAuthClientForUser(userId);
  const admin = google.analyticsadmin({ version: 'v1beta', auth });

  let out = [];
  let pageToken;
  do {
    const resp = await admin.properties.search({
      requestBody: { query: '' },
      pageToken,
      pageSize: 200,
    });
    (resp.data.properties || []).forEach((p) => {
      out.push({
        propertyId: p.name,               // "properties/123"
        displayName: p.displayName || p.name,
        timeZone: p.timeZone || null,
        currencyCode: p.currencyCode || null,
      });
    });
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);

  const map = new Map();
  for (const p of out) map.set(p.propertyId, p);
  const properties = Array.from(map.values());

  const doc = await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] });
  if (doc) {
    doc.gaProperties = properties;
    if (!doc.defaultPropertyId && properties[0]?.propertyId) {
      doc.defaultPropertyId = properties[0].propertyId;
    }
    await doc.save();
  } else {
    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: userId }, { userId }] },
      {
        $set: {
          gaProperties: properties,
          defaultPropertyId: properties[0]?.propertyId || null,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  }
  return properties;
}

/* =============== GA DATA helper =============== */
async function gaDataRunReport({ auth, property, body }) {
  const dataApi = google.analyticsdata({ version: 'v1beta', auth });
  const resp = await dataApi.properties.runReport({ property, requestBody: body });
  return resp.data;
}

/* ======================= RUTAS ======================= */

/** GET /api/google/analytics/properties */
router.get('/properties', requireSession, async (req, res) => {
  try {
    let doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).lean();

    let properties = doc?.gaProperties || [];
    let defaultPropertyId = toPropertyResource(doc?.defaultPropertyId) || null;

    if (!properties.length) {
      try {
        properties = await resyncAndPersistProperties(req.user._id);
        // recarga doc para tomar selectedPropertyIds si existían
        doc = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] }).lean();
        defaultPropertyId = toPropertyResource(doc?.defaultPropertyId) || (properties?.[0]?.propertyId || null);
      } catch (e) {
        const msg = e.message === 'NO_REFRESH_TOKEN' ? 'NO_REFRESH_TOKEN' : 'SYNC_FAILED';
        return res.status(401).json({ ok: false, error: msg });
      }
    }

    const userDoc = await getUserDoc(req.user._id);
    const availableIds = properties.map(p => p.propertyId);
    const selected = selectedPropsFromDocOrUser(doc, userDoc);

    const needsSelection =
      availableIds.length > MAX_BY_RULE &&
      // SOLO consideramos “selección guardada” si existe selectedPropertyIds o selectedGaPropertyId
      (!Array.isArray(doc?.selectedPropertyIds) || doc.selectedPropertyIds.length === 0) &&
      !doc?.selectedGaPropertyId;

    if (needsSelection) {
      return res.json({
        ok: false,
        reason: 'SELECTION_REQUIRED(>3_PROPERTIES)',
        requiredSelection: true,
        properties,
        availableCount: availableIds.length,
        selectedPropertyIds: [],
        defaultPropertyId: null
      });
    }

    // si hay selección explícita, filtra + ajusta default si quedó fuera
    const explicitSelected =
      (Array.isArray(doc?.selectedPropertyIds) && doc.selectedPropertyIds.length) ||
      !!doc?.selectedGaPropertyId;

    if (explicitSelected && selected.length > 0) {
      const allow = new Set(selected);
      properties = properties.filter(p => allow.has(p.propertyId));
      if (defaultPropertyId && !allow.has(defaultPropertyId)) {
        defaultPropertyId = properties[0]?.propertyId || null;
        if (doc && defaultPropertyId) {
          await GoogleAccount.updateOne({ _id: doc._id }, { $set: { defaultPropertyId } });
        }
      }
    }

    return res.json({
      ok: true,
      properties,
      availableCount: properties.length,
      selectedPropertyIds: selected,
      defaultPropertyId
    });
  } catch (e) {
    console.error('GA /properties error:', e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ==== HANDLER COMPARTIDO PARA GUARDAR SELECCIÓN DE GA4 ==== */
async function handleGaSelection(req, res) {
  try {
    const { propertyIds } = req.body; // ["properties/123", "123", ...]
    if (!Array.isArray(propertyIds)) {
      return res.status(400).json({ ok: false, error: 'propertyIds[] requerido' });
    }

    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('_id gaProperties defaultPropertyId selectedPropertyIds selectedGaPropertyId');

    if (!doc) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = new Set((doc.gaProperties || []).map(p => String(p.propertyId || '').trim()).filter(Boolean));

    const wanted = [...new Set(propertyIds.map(toPropertyResource).filter(Boolean))];
    const selected = wanted.filter(pid => available.has(pid));

    if (!selected.length) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_PROPERTIES' });
    }

    // default dentro de la selección
    let nextDefault = toPropertyResource(doc.defaultPropertyId);
    if (!nextDefault || !selected.includes(nextDefault)) {
      nextDefault = selected[0];
    }

    // guarda en GoogleAccount (nuevo + legacy)
    doc.selectedPropertyIds = selected;
    doc.selectedGaPropertyId = selected[0]; // legacy
    doc.defaultPropertyId = nextDefault;
    await doc.save();

    // espejo en User (legacy + preferences oficiales)
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          selectedGAProperties: selected,
          'preferences.googleAnalytics.auditPropertyIds': selected
        }
      }
    );

    return res.json({ ok: true, selected, defaultPropertyId: nextDefault });
  } catch (e) {
    console.error('GA properties/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
}

/** POST /api/google/analytics/properties/selection */
router.post('/properties/selection', requireSession, express.json(), handleGaSelection);

/** POST /api/google/analytics/selection (alias) */
router.post('/selection', requireSession, express.json(), handleGaSelection);

/** GET /api/google/analytics/overview */
router.get('/overview', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const property = await resolvePropertyForRequest(req);
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    const objective = String(req.query.objective || 'ventas');

    if (!/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }

    const auth = await getOAuthClientForUser(req.user._id);

    const { startDate, endDate, days } = buildDateRange(datePreset, includeToday);
    const prevStart = new Date(startDate); prevStart.setDate(prevStart.getDate() - days);
    const prevEnd   = new Date(endDate);   prevEnd.setDate(prevEnd.getDate() - days);
    const fmt = (d) => (typeof d === 'string' ? d : d.toISOString().slice(0,10));

    const kpi = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [
          { startDate, endDate },
          { startDate: fmt(prevStart), endDate: fmt(prevEnd) }
        ],
        metrics: [
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'newUsers' },
          { name: 'conversions' },
          { name: 'purchaseRevenue' },
          { name: 'averageSessionDuration' },
          { name: 'engagementRate' }
        ]
      }
    });

    const V = (row, i) => Number(row?.metricValues?.[i]?.value || 0);
    const rowNow  = kpi.rows?.[0];
    const rowPrev = kpi.rows?.[1];

    const base = {
      totalUsers: V(rowNow,0),
      sessions:   V(rowNow,1),
      newUsers:   V(rowNow,2),
      engagementRate:    V(rowNow,6),
      avgEngagementTime: V(rowNow,5),
    };
    const basePrev = {
      totalUsers: V(rowPrev,0),
      sessions:   V(rowPrev,1),
      newUsers:   V(rowPrev,2),
      engagementRate:    V(rowPrev,6),
      avgEngagementTime: V(rowPrev,5),
    };

    const out = { ok: true, data: {}, property };

    if (objective === 'ventas') {
      const [purNow, purPrev] = await Promise.all([
        gaDataRunReport({
          auth, property,
          body: {
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } } },
          }
        }),
        gaDataRunReport({
          auth, property,
          body: {
            dateRanges: [{ startDate: fmt(prevStart), endDate: fmt(prevEnd) }],
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } } },
          }
        }),
      ]);

      const purchasesNow  = Number(purNow.rows?.[0]?.metricValues?.[0]?.value || 0);
      const purchasesPrev = Number(purPrev.rows?.[0]?.metricValues?.[0]?.value || 0);

      const revenueNow = V(rowNow,4);
      const revenuePrev= V(rowPrev,4);

      const pcrNow  = base.sessions ? purchasesNow / base.sessions : 0;
      const pcrPrev = basePrev.sessions ? purchasesPrev / basePrev.sessions : 0;
      const aovNow  = purchasesNow ? revenueNow / purchasesNow : 0;
      const aovPrev = purchasesPrev ? revenuePrev / purchasesPrev : 0;

      const funnel = await gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: {
              fieldName: 'eventName',
              inListFilter: { values: ['view_item','add_to_cart','begin_checkout','purchase'] }
            }
          },
          limit: 50
        }
      });

      const fObj = {};
      for (const r of funnel.rows || []) {
        fObj[r.dimensionValues?.[0]?.value] = Number(r.metricValues?.[0]?.value || 0);
      }

      out.data = {
        revenue: revenueNow,
        purchases: purchasesNow,
        aov: aovNow,
        purchaseConversionRate: pcrNow,
        funnel: {
          view_item:      fObj.view_item || 0,
          add_to_cart:    fObj.add_to_cart || 0,
          begin_checkout: fObj.begin_checkout || 0,
          purchase:       fObj.purchase || 0,
        },
        prev: {
          revenue: revenuePrev,
          purchases: purchasesPrev,
          aov: aovPrev,
          purchaseConversionRate: pcrPrev,
        }
      };
    } else if (objective === 'leads') {
      const leadEvt = await gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'generate_lead' } } },
        }
      });
      const leads = Number(leadEvt.rows?.[0]?.metricValues?.[0]?.value || 0);
      const leadConversionRate = base.sessions ? leads / base.sessions : 0;
      out.data = { leads, leadConversionRate };
    } else if (objective === 'adquisicion') {
      const ch = await gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
          limit: 25,
        }
      });
      const channels = {};
      for (const r of ch.rows || []) {
        const name = r.dimensionValues?.[0]?.value || 'Other';
        const val  = Number(r.metricValues?.[0]?.value || 0);
        const key =
          (/organic/i.test(name) ? 'organic'
          : /paid|cpc|ppc/i.test(name) ? 'paid'
          : /social/i.test(name) ? 'social'
          : /referral/i.test(name) ? 'referral'
          : /direct/i.test(name) ? 'direct'
          : name);
        channels[key] = (channels[key] || 0) + val;
      }
      out.data = { sessions: base.sessions, channels };
    } else {
      out.data = {
        engagementRate: base.engagementRate,
        avgEngagementTime: base.avgEngagementTime,
      };
    }

    return res.json(out);
  } catch (e) {
    console.error('GA /overview error:', e?.response?.data || e);
    const code = e?.code || e?.response?.status || 500;
    return res.status(code === 'NO_REFRESH_TOKEN' ? 401 : 500).json({ ok: false, error: e.message || String(e) });
  }
});

/* =========================================================
 * NOTA: tus otras rutas (/sales, /landing-pages, /funnel, /leads, /acquisition, /engagement)
 * pueden quedarse tal cual como están.
 *
 * Lo ÚNICO que recomiendo (sin romper nada):
 * - donde pides property en query, puedes usar resolvePropertyForRequest(req)
 *   para que Integraciones/dashboard no fallen si la UI no manda property.
 * ======================================================= */

module.exports = router;
