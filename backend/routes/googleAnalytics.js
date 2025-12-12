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
    if (!available.length) return next();

    const selected = selectedPropsFromDocOrUser(doc, userDoc);

    // Regla: > MAX y sin selección explícita
    if (
      available.length > MAX_BY_RULE &&
      (!Array.isArray(doc?.selectedPropertyIds) || doc.selectedPropertyIds.length === 0) &&
      !doc?.selectedGaPropertyId
    ) {
      return res.status(400).json({
        ok: false,
        reason: 'SELECTION_REQUIRED(>3_PROPERTIES)',
        requiredSelection: true,
      });
    }

    // Si la request trae property explícita y hay selección => validar
    const raw = String(req.query.property || req.query.propertyId || '').trim();
    const normalized = raw ? toPropertyResource(raw) : '';

    if (selected.length > 0 && normalized) {
      if (!selected.includes(normalized)) {
        return res.status(403).json({
          ok: false,
          error: 'PROPERTY_NOT_ALLOWED',
          allowed: selected,
        });
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

  const fmt = (d) => d.toISOString().slice(0, 10);
  const days = Math.ceil((end - start) / 86400000) + 1;
  return { startDate: fmt(start), endDate: fmt(end), days };
}

function parseIncludeToday(req) {
  const v = String(req.query.include_today ?? '').trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  // default: true (histórico en tu UI es “incluye hoy” apagable)
  return true;
}

function parseDatePreset(req, fallback = 'last_30_days') {
  // tu UI manda date_preset=last_30d o dateRange=last_30d
  const raw = String(req.query.date_preset || req.query.dateRange || fallback).trim();
  // normalizamos last_30d => last_30_days
  const norm = raw
    .replace(/^last_(\d+)d$/i, 'last_$1_days')
    .replace(/^last_(\d+)_day$/i, 'last_$1_days');
  return norm || fallback;
}

function pct(now, prev) {
  if (!prev) return now ? 1 : 0;
  return (now - prev) / prev;
}
function deltaObj(now, prev) {
  return {
    value: now,
    prev: prev,
    delta: now - prev,
    deltaPct: pct(now, prev),
  };
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
        propertyId: p.name,
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
          updatedAt: new Date(),
        },
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
        defaultPropertyId: null,
      });
    }

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
      defaultPropertyId,
    });
  } catch (e) {
    console.error('GA /properties error:', e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ==== HANDLER COMPARTIDO PARA GUARDAR SELECCIÓN DE GA4 ==== */
async function handleGaSelection(req, res) {
  try {
    const { propertyIds } = req.body;
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

    let nextDefault = toPropertyResource(doc.defaultPropertyId);
    if (!nextDefault || !selected.includes(nextDefault)) {
      nextDefault = selected[0];
    }

    doc.selectedPropertyIds = selected;
    doc.selectedGaPropertyId = selected[0];
    doc.defaultPropertyId = nextDefault;
    await doc.save();

    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          selectedGAProperties: selected,
          'preferences.googleAnalytics.auditPropertyIds': selected,
        },
      }
    );

    return res.json({ ok: true, selected, defaultPropertyId: nextDefault });
  } catch (e) {
    console.error('GA properties/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
}

router.post('/properties/selection', requireSession, express.json(), handleGaSelection);
router.post('/selection', requireSession, express.json(), handleGaSelection);

/** GET /api/google/analytics/overview */
router.get('/overview', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const property = await resolvePropertyForRequest(req);
    const datePreset = parseDatePreset(req, 'last_30_days');
    const includeToday = parseIncludeToday(req);
    const objective = String(req.query.objective || 'ventas');

    if (!/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }

    const auth = await getOAuthClientForUser(req.user._id);

    const { startDate, endDate, days } = buildDateRange(datePreset, includeToday);
    const prevStart = new Date(startDate); prevStart.setDate(prevStart.getDate() - days);
    const prevEnd   = new Date(endDate);   prevEnd.setDate(prevEnd.getDate() - days);
    const fmt = (d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));

    const kpi = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [
          { startDate, endDate },
          { startDate: fmt(prevStart), endDate: fmt(prevEnd) },
        ],
        metrics: [
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'newUsers' },
          { name: 'conversions' },
          { name: 'purchaseRevenue' },
          { name: 'averageSessionDuration' },
          { name: 'engagementRate' },
        ],
      },
    });

    const V = (row, i) => Number(row?.metricValues?.[i]?.value || 0);
    const rowNow  = kpi.rows?.[0];
    const rowPrev = kpi.rows?.[1];

    const base = {
      totalUsers: V(rowNow, 0),
      sessions:   V(rowNow, 1),
      newUsers:   V(rowNow, 2),
      conversions: V(rowNow, 3),
      revenue:    V(rowNow, 4),
      avgSessionDuration: V(rowNow, 5),
      engagementRate:    V(rowNow, 6),
    };
    const basePrev = {
      totalUsers: V(rowPrev, 0),
      sessions:   V(rowPrev, 1),
      newUsers:   V(rowPrev, 2),
      conversions: V(rowPrev, 3),
      revenue:    V(rowPrev, 4),
      avgSessionDuration: V(rowPrev, 5),
      engagementRate:    V(rowPrev, 6),
    };

    const out = { ok: true, data: {}, property, range: { startDate, endDate, days } };

    if (objective === 'ventas') {
      const [purNow, purPrev] = await Promise.all([
        gaDataRunReport({
          auth, property,
          body: {
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: {
              filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } },
            },
          },
        }),
        gaDataRunReport({
          auth, property,
          body: {
            dateRanges: [{ startDate: fmt(prevStart), endDate: fmt(prevEnd) }],
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: {
              filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } },
            },
          },
        }),
      ]);

      const purchasesNow  = Number(purNow.rows?.[0]?.metricValues?.[0]?.value || 0);
      const purchasesPrev = Number(purPrev.rows?.[0]?.metricValues?.[0]?.value || 0);

      const pcrNow  = base.sessions ? purchasesNow / base.sessions : 0;
      const pcrPrev = basePrev.sessions ? purchasesPrev / basePrev.sessions : 0;
      const aovNow  = purchasesNow ? base.revenue / purchasesNow : 0;
      const aovPrev = purchasesPrev ? basePrev.revenue / purchasesPrev : 0;

      out.data = {
        kpis: {
          revenue:  deltaObj(base.revenue, basePrev.revenue),
          orders:   deltaObj(purchasesNow, purchasesPrev),
          aov:      deltaObj(aovNow, aovPrev),
          purchaseConversionRate: deltaObj(pcrNow, pcrPrev),
        },
      };
    } else if (objective === 'leads') {
      const leadEvt = await gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'generate_lead' } },
          },
        },
      });
      const leads = Number(leadEvt.rows?.[0]?.metricValues?.[0]?.value || 0);
      const leadConversionRate = base.sessions ? leads / base.sessions : 0;

      out.data = {
        kpis: {
          leads: deltaObj(leads, 0),
          leadConversionRate: deltaObj(leadConversionRate, 0),
        },
      };
    } else if (objective === 'adquisicion') {
      const ch = await gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
          limit: 25,
        },
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

      out.data = {
        kpis: {
          users:    deltaObj(base.totalUsers, basePrev.totalUsers),
          sessions: deltaObj(base.sessions, basePrev.sessions),
          newUsers: deltaObj(base.newUsers, basePrev.newUsers),
        },
        channels,
      };
    } else {
      out.data = {
        kpis: {
          engagementRate: deltaObj(base.engagementRate, basePrev.engagementRate),
          avgSessionDuration: deltaObj(base.avgSessionDuration, basePrev.avgSessionDuration),
        },
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
 * ✅ NUEVAS RUTAS PARA EL DASHBOARD (E2E)
 * - /sales
 * - /leads
 * - /acquisition
 * - /engagement
 * Extras útiles si tu UI ya los usa:
 * - /landing-pages
 * - /funnel
 * ======================================================= */

async function resolveBasics(req) {
  const property = await resolvePropertyForRequest(req);
  if (!/^properties\/\d+$/.test(property)) {
    const err = new Error('PROPERTY_REQUIRED');
    err.code = 'PROPERTY_REQUIRED';
    throw err;
  }
  const datePreset = parseDatePreset(req, 'last_30_days');
  const includeToday = parseIncludeToday(req);
  const { startDate, endDate, days } = buildDateRange(datePreset, includeToday);

  const prevStart = new Date(startDate); prevStart.setDate(prevStart.getDate() - days);
  const prevEnd   = new Date(endDate);   prevEnd.setDate(prevEnd.getDate() - days);
  const fmt = (d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));

  return { property, datePreset, includeToday, startDate, endDate, days, prevStart, prevEnd, fmt };
}

router.get('/sales', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, prevStart, prevEnd, fmt } = await resolveBasics(req);

    // KPIs base (revenue + sessions)
    const base = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [
          { startDate, endDate },
          { startDate: fmt(prevStart), endDate: fmt(prevEnd) },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'purchaseRevenue' },
        ],
      },
    });

    const V = (row, i) => Number(row?.metricValues?.[i]?.value || 0);
    const rowNow  = base.rows?.[0];
    const rowPrev = base.rows?.[1];

    const sessionsNow = V(rowNow, 0);
    const sessionsPrev= V(rowPrev, 0);

    const revenueNow  = V(rowNow, 1);
    const revenuePrev = V(rowPrev, 1);

    // Purchases (purchase eventCount) ahora y previo
    const [purNow, purPrev] = await Promise.all([
      gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } },
          },
        },
      }),
      gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate: fmt(prevStart), endDate: fmt(prevEnd) }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } },
          },
        },
      }),
    ]);

    const purchasesNow  = Number(purNow.rows?.[0]?.metricValues?.[0]?.value || 0);
    const purchasesPrev = Number(purPrev.rows?.[0]?.metricValues?.[0]?.value || 0);

    const aovNow  = purchasesNow ? revenueNow / purchasesNow : 0;
    const aovPrev = purchasesPrev ? revenuePrev / purchasesPrev : 0;

    const pcrNow  = sessionsNow ? purchasesNow / sessionsNow : 0;
    const pcrPrev = sessionsPrev ? purchasesPrev / sessionsPrev : 0;

    // Serie diaria (para chart)
    const series = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'purchaseRevenue' },
          { name: 'sessions' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });

    const trend = (series.rows || []).map(r => ({
      date: r.dimensionValues?.[0]?.value || null, // YYYYMMDD
      revenue: Number(r.metricValues?.[0]?.value || 0),
      sessions: Number(r.metricValues?.[1]?.value || 0),
    }));

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      kpis: {
        revenue: deltaObj(revenueNow, revenuePrev),
        orders: deltaObj(purchasesNow, purchasesPrev),
        aov: deltaObj(aovNow, aovPrev),
        purchaseConversionRate: deltaObj(pcrNow, pcrPrev),
      },
      trend,
    });
  } catch (e) {
    console.error('GA /sales error:', e?.response?.data || e);
    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;
    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get('/leads', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, prevStart, prevEnd, fmt } = await resolveBasics(req);

    // Permitir lista de eventos de lead desde UI:
    // ?lead_events=generate_lead,form_submit,contact_click
    const rawLeadEvents = String(req.query.lead_events || req.query.events || 'generate_lead').trim();
    const leadEvents = rawLeadEvents
      .split(',')
      .map(s => String(s || '').trim())
      .filter(Boolean);

    // Sessions ahora y previo (para rate)
    const base = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [
          { startDate, endDate },
          { startDate: fmt(prevStart), endDate: fmt(prevEnd) },
        ],
        metrics: [{ name: 'sessions' }],
      },
    });
    const sessionsNow = Number(base.rows?.[0]?.metricValues?.[0]?.value || 0);
    const sessionsPrev= Number(base.rows?.[1]?.metricValues?.[0]?.value || 0);

    // Sumar leads por eventName IN LIST
    const leadsNowRep = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', inListFilter: { values: leadEvents } },
        },
        limit: 200,
      },
    });
    const leadsPrevRep = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate: fmt(prevStart), endDate: fmt(prevEnd) }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', inListFilter: { values: leadEvents } },
        },
        limit: 200,
      },
    });

    const sumRows = (rep) =>
      (rep.rows || []).reduce((acc, r) => acc + Number(r.metricValues?.[0]?.value || 0), 0);

    const leadsNow = sumRows(leadsNowRep);
    const leadsPrev = sumRows(leadsPrevRep);

    const rateNow = sessionsNow ? leadsNow / sessionsNow : 0;
    const ratePrev= sessionsPrev ? leadsPrev / sessionsPrev : 0;

    // Trend (daily leads)
    const leadsDaily = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }, { name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', inListFilter: { values: leadEvents } },
        },
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });

    // agregamos por día
    const byDay = new Map();
    for (const r of leadsDaily.rows || []) {
      const d = r.dimensionValues?.[0]?.value || '';
      const c = Number(r.metricValues?.[0]?.value || 0);
      byDay.set(d, (byDay.get(d) || 0) + c);
    }
    const trend = Array.from(byDay.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([date, leads]) => ({ date, leads }));

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      leadEvents,
      kpis: {
        leads: deltaObj(leadsNow, leadsPrev),
        leadConversionRate: deltaObj(rateNow, ratePrev),
      },
      trend,
    });
  } catch (e) {
    console.error('GA /leads error:', e?.response?.data || e);
    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;
    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get('/acquisition', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, prevStart, prevEnd, fmt } = await resolveBasics(req);

    const kpi = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [
          { startDate, endDate },
          { startDate: fmt(prevStart), endDate: fmt(prevEnd) },
        ],
        metrics: [
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'newUsers' },
        ],
      },
    });

    const V = (row, i) => Number(row?.metricValues?.[i]?.value || 0);
    const rowNow  = kpi.rows?.[0];
    const rowPrev = kpi.rows?.[1];

    const usersNow = V(rowNow,0), usersPrev = V(rowPrev,0);
    const sessionsNow = V(rowNow,1), sessionsPrev = V(rowPrev,1);
    const newUsersNow = V(rowNow,2), newUsersPrev = V(rowPrev,2);

    // canales
    const ch = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
        limit: 25,
      },
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

    // trend daily sessions
    const s = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });
    const trend = (s.rows || []).map(r => ({
      date: r.dimensionValues?.[0]?.value || null,
      sessions: Number(r.metricValues?.[0]?.value || 0),
    }));

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      kpis: {
        users: deltaObj(usersNow, usersPrev),
        sessions: deltaObj(sessionsNow, sessionsPrev),
        newUsers: deltaObj(newUsersNow, newUsersPrev),
      },
      channels,
      trend,
    });
  } catch (e) {
    console.error('GA /acquisition error:', e?.response?.data || e);
    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;
    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get('/engagement', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, prevStart, prevEnd, fmt } = await resolveBasics(req);

    const rep = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [
          { startDate, endDate },
          { startDate: fmt(prevStart), endDate: fmt(prevEnd) },
        ],
        metrics: [
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
          { name: 'conversions' },
        ],
      },
    });

    const V = (row, i) => Number(row?.metricValues?.[i]?.value || 0);
    const rowNow  = rep.rows?.[0];
    const rowPrev = rep.rows?.[1];

    const erNow = V(rowNow,0), erPrev = V(rowPrev,0);
    const durNow = V(rowNow,1), durPrev = V(rowPrev,1);
    const convNow = V(rowNow,2), convPrev = V(rowPrev,2);

    // trend daily engagementRate
    const s = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'engagementRate' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });
    const trend = (s.rows || []).map(r => ({
      date: r.dimensionValues?.[0]?.value || null,
      engagementRate: Number(r.metricValues?.[0]?.value || 0),
    }));

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      kpis: {
        engagementRate: deltaObj(erNow, erPrev),
        avgSessionDuration: deltaObj(durNow, durPrev),
        conversions: deltaObj(convNow, convPrev),
      },
      trend,
    });
  } catch (e) {
    console.error('GA /engagement error:', e?.response?.data || e);
    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;
    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

// (Opcional) Top landing pages
router.get('/landing-pages', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days } = await resolveBasics(req);

    const rep = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'conversions' },
          { name: 'purchaseRevenue' },
        ],
        orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
        limit: Number(req.query.limit || 25),
      },
    });

    const rows = (rep.rows || []).map(r => ({
      page: r.dimensionValues?.[0]?.value || '/',
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      conversions: Number(r.metricValues?.[2]?.value || 0),
      revenue: Number(r.metricValues?.[3]?.value || 0),
    }));

    return res.json({ ok: true, property, range: { startDate, endDate, days }, rows });
  } catch (e) {
    console.error('GA /landing-pages error:', e?.response?.data || e);
    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;
    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

// (Opcional) Funnel ecommerce
router.get('/funnel', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days } = await resolveBasics(req);

    const funnel = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            inListFilter: { values: ['view_item','add_to_cart','begin_checkout','purchase'] },
          },
        },
        limit: 50,
      },
    });

    const fObj = {};
    for (const r of funnel.rows || []) {
      fObj[r.dimensionValues?.[0]?.value] = Number(r.metricValues?.[0]?.value || 0);
    }

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      funnel: {
        view_item:      fObj.view_item || 0,
        add_to_cart:    fObj.add_to_cart || 0,
        begin_checkout: fObj.begin_checkout || 0,
        purchase:       fObj.purchase || 0,
      },
    });
  } catch (e) {
    console.error('GA /funnel error:', e?.response?.data || e);
    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;
    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

module.exports = router;
