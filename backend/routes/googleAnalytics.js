// backend/routes/googleAnalytics.js
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
// ✅ Regla UX actual: si hay >1 disponible => exigir selección explícita
const MAX_SELECT = 1;

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

/** GA data API suele mandar date como YYYYMMDD. Lo normalizamos a YYYY-MM-DD. */
function normalizeDateKey(raw) {
  const s = String(raw || '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
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
  return list
    .map(p => toPropertyResource(p?.propertyId || p?.name || ''))
    .filter(Boolean);
}

/**
 * Selección GA4 robusta (orden de prioridad):
 * 1) GoogleAccount.selectedPropertyIds (nuevo)
 * 2) User.preferences.googleAnalytics.auditPropertyIds
 * 3) User.selectedGAProperties (legacy)
 * 4) GoogleAccount.selectedGaPropertyId (legacy viejo)
 * 5) GoogleAccount.defaultPropertyId (fallback SOLO si no hay multi-prop sin selección)
 */
function selectedPropsFromDocOrUser(doc, userDoc) {
  const fromDocArr = Array.isArray(doc?.selectedPropertyIds) ? doc.selectedPropertyIds : [];
  const normalizedDocArr = fromDocArr.map(toPropertyResource).filter(Boolean);
  if (normalizedDocArr.length) return [...new Set(normalizedDocArr)];

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

  const legacyOne = toPropertyResource(doc?.selectedGaPropertyId);
  if (legacyOne) return [legacyOne];

  // ❗️defaultPropertyId NO cuenta como selección explícita en multi-prop
  const def = toPropertyResource(doc?.defaultPropertyId);
  if (def) return [def];

  return [];
}

/** Detecta si existe selección EXPLÍCITA (no default). */
function hasExplicitGASelection(doc, userDoc) {
  const docSelArr = Array.isArray(doc?.selectedPropertyIds) && doc.selectedPropertyIds.length > 0;
  const docLegacy = !!toPropertyResource(doc?.selectedGaPropertyId);

  const pref = userDoc?.preferences?.googleAnalytics?.auditPropertyIds;
  const userPref = Array.isArray(pref) && pref.length > 0;

  const userLegacy = Array.isArray(userDoc?.selectedGAProperties) && userDoc.selectedGAProperties.length > 0;

  return !!(docSelArr || docLegacy || userPref || userLegacy);
}

function selectionIsRequired({ availableCount, explicitSelectedCount }) {
  return availableCount > MAX_SELECT && explicitSelectedCount === 0;
}

function respondSelectionRequired(res, extra = {}) {
  return res.status(428).json({
    ok: false,
    error: 'SELECTION_REQUIRED',
    reason: 'SELECTION_REQUIRED(>1_PROPERTIES)',
    requiredSelection: true,
    ...extra,
  });
}

/**
 * Resolver property para endpoints:
 * - si viene en query => se usa
 * - si NO viene => usa selección (selectedPropertyIds / user pref / legacy)
 * - si hay 1 disponible y no hay selección => usa esa
 * - si hay >1 disponible y NO hay selección explícita => '' (para disparar 428)
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

  const available = availablePropertyIdsFromDoc(doc);
  const selected = selectedPropsFromDocOrUser(doc, userDoc);
  const explicit = hasExplicitGASelection(doc, userDoc) ? selected : [];

  if (selectionIsRequired({ availableCount: available.length, explicitSelectedCount: explicit.length })) {
    return '';
  }

  if (explicit.length) return explicit[0];

  // si solo hay 1 property, dejamos pasar aunque no esté “seleccionada”
  if (available.length === 1) return available[0];

  // fallback final
  return toPropertyResource(doc.defaultPropertyId) || '';
}

/** Middleware: valida selección y/o propiedad permitida por la selección. */
async function ensureGaPropertyAllowed(req, res, next) {
  try {
    const [doc, userDoc] = await Promise.all([
      getGaAccountDoc(req.user._id),
      getUserDoc(req.user._id),
    ]);

    if (!doc) return res.status(401).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = availablePropertyIdsFromDoc(doc);
    const selectedAll = selectedPropsFromDocOrUser(doc, userDoc);

    const explicitSelected = hasExplicitGASelection(doc, userDoc) ? selectedAll : [];
    const needSel = selectionIsRequired({
      availableCount: available.length,
      explicitSelectedCount: explicitSelected.length,
    });

    // ✅ Blindaje: si hay >1 disponibles y no hay selección explícita, NO dejamos correr endpoints de datos.
    if (needSel) {
      return respondSelectionRequired(res, {
        availableCount: available.length,
        selectedPropertyIds: [],
      });
    }

    // Si la request trae property explícita, debe ser válida/permitida
    const raw = String(req.query.property || req.query.propertyId || '').trim();
    const normalized = raw ? toPropertyResource(raw) : '';

    // Si hay selección explícita, solo permitimos esas
    if (explicitSelected.length > 0 && normalized) {
      if (!explicitSelected.includes(normalized)) {
        return res.status(403).json({
          ok: false,
          error: 'PROPERTY_NOT_ALLOWED',
          allowed: explicitSelected,
        });
      }
    }

    // Si NO hay selección explícita (y no se requiere), pero hay query property, validamos que exista en disponibles (si tenemos lista)
    if (explicitSelected.length === 0 && normalized && available.length > 0) {
      if (!available.includes(normalized)) {
        return res.status(404).json({ ok: false, error: 'PROPERTY_NOT_FOUND' });
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
    last_60d: 60, last_60_days: 60,
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
  return true;
}

function parseDatePreset(req, fallback = 'last_30_days') {
  const raw = String(req.query.date_preset || req.query.dateRange || fallback).trim();
  const norm = raw
    .replace(/^last_(\d+)d$/i, 'last_$1_days')
    .replace(/^last_(\d+)_day$/i, 'last_$1_days');
  return norm || fallback;
}

/* =============== HELPERS KPIs =============== */
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function pctChange(now, prev) {
  const a = n(now);
  const b = n(prev);
  if (!b) return a ? 1 : 0;
  return (a - b) / b;
}

function buildDeltas(nowObj, prevObj, keys) {
  const deltas = {};
  for (const k of keys) deltas[k] = pctChange(nowObj[k], prevObj[k]);
  return deltas;
}

async function gaDataRunReport({ auth, property, body }) {
  const dataApi = google.analyticsdata({ version: 'v1beta', auth });
  const resp = await dataApi.properties.runReport({ property, requestBody: body });
  return resp.data;
}

async function runReportNowPrev({ auth, property, nowRange, prevRange, metrics, dimensions, dimensionFilter, orderBys, limit }) {
  const baseBody = {
    metrics: (metrics || []).map(name => ({ name })),
    ...(dimensions ? { dimensions: dimensions.map(name => ({ name })) } : {}),
    ...(dimensionFilter ? { dimensionFilter } : {}),
    ...(orderBys ? { orderBys } : {}),
    ...(limit ? { limit } : {}),
  };

  const [repNow, repPrev] = await Promise.all([
    gaDataRunReport({ auth, property, body: { ...baseBody, dateRanges: [nowRange] } }),
    gaDataRunReport({ auth, property, body: { ...baseBody, dateRanges: [prevRange] } }),
  ]);

  return { repNow, repPrev };
}

function firstRowMetrics(rep) {
  const row = rep?.rows?.[0];
  const vals = row?.metricValues || [];
  return vals.map(x => n(x?.value));
}

/** Meta de propiedad (currency/timeZone/displayName) desde gaProperties */
async function getPropertyMeta(userId, property) {
  try {
    const doc = await getGaAccountDoc(userId);
    const list = Array.isArray(doc?.gaProperties) ? doc.gaProperties : [];
    const hit = list.find(p => String(toPropertyResource(p?.propertyId || p?.name || '')).trim() === String(property || '').trim());
    return {
      currencyCode: hit?.currencyCode || null,
      timeZone: hit?.timeZone || null,
      displayName: hit?.displayName || null,
    };
  } catch {
    return { currencyCode: null, timeZone: null, displayName: null };
  }
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

    // defaultPropertyId solo como fallback, NO como selección explícita
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
    const availableIds = properties.map(p => toPropertyResource(p?.propertyId || p?.name || '')).filter(Boolean);

    const selectedAll = selectedPropsFromDocOrUser(doc, userDoc);
    const explicitSelected = hasExplicitGASelection(doc, userDoc) ? selectedAll : [];

    // ✅ Para /properties NO bloqueamos con 428: devolvemos lista para que UI seleccione
    if (selectionIsRequired({ availableCount: availableIds.length, explicitSelectedCount: explicitSelected.length })) {
      return res.json({
        ok: false,
        error: 'SELECTION_REQUIRED',
        reason: 'SELECTION_REQUIRED(>1_PROPERTIES)',
        requiredSelection: true,
        properties,
        availableCount: availableIds.length,
        selectedPropertyIds: [],
        defaultPropertyId: null,
      });
    }

    // Si hay selección explícita, filtramos
    if (explicitSelected.length > 0) {
      const allow = new Set(explicitSelected);
      properties = properties.filter(p => allow.has(toPropertyResource(p?.propertyId || p?.name || '')));

      if (defaultPropertyId && !allow.has(defaultPropertyId)) {
        defaultPropertyId = properties[0]?.propertyId || null;
        if (doc && defaultPropertyId) {
          await GoogleAccount.updateOne({ _id: doc._id }, { $set: { defaultPropertyId } });
        }
      }
    } else {
      // si solo hay 1, lo dejamos como default (sin considerarlo selección)
      if (!defaultPropertyId && properties[0]?.propertyId) defaultPropertyId = properties[0].propertyId;
    }

    return res.json({
      ok: true,
      properties,
      availableCount: properties.length,
      selectedPropertyIds: explicitSelected,
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

    const available = new Set(
      (Array.isArray(doc.gaProperties) ? doc.gaProperties : [])
        .map(p => toPropertyResource(p?.propertyId || p?.name || ''))
        .filter(Boolean)
    );

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
    doc.selectedGaPropertyId = selected[0]; // legacy mirror
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

/* ===================== RESOLVER BASICS ===================== */
async function resolveBasics(req) {
  const property = await resolvePropertyForRequest(req);

  if (!/^properties\/\d+$/.test(property)) {
    // si no resolvió property es porque se requiere selección o falta el query
    const [doc, userDoc] = await Promise.all([getGaAccountDoc(req.user._id), getUserDoc(req.user._id)]);
    const available = availablePropertyIdsFromDoc(doc);
    const selectedAll = selectedPropsFromDocOrUser(doc, userDoc);
    const explicitSelected = hasExplicitGASelection(doc, userDoc) ? selectedAll : [];
    if (selectionIsRequired({ availableCount: available.length, explicitSelectedCount: explicitSelected.length })) {
      const err = new Error('SELECTION_REQUIRED');
      err.code = 'SELECTION_REQUIRED';
      throw err;
    }

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

  const nowRange  = { startDate, endDate };
  const prevRange = { startDate: fmt(prevStart), endDate: fmt(prevEnd) };

  const meta = await getPropertyMeta(req.user._id, property);

  return { property, datePreset, includeToday, startDate, endDate, days, prevStart, prevEnd, fmt, nowRange, prevRange, meta };
}

/** GET /api/google/analytics/overview */
router.get('/overview', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, nowRange, prevRange, meta } = await resolveBasics(req);
    const objective = String(req.query.objective || 'ventas');

    const { repNow: baseNowRep, repPrev: basePrevRep } = await runReportNowPrev({
      auth, property,
      nowRange, prevRange,
      metrics: [
        'totalUsers',
        'sessions',
        'newUsers',
        'conversions',
        'purchaseRevenue',
        'averageSessionDuration',
        'engagementRate',
      ],
    });

    const [
      totalUsersNow,
      sessionsNow,
      newUsersNow,
      conversionsNow,
      revenueNow,
      avgSessionDurationNow,
      engagementRateNow
    ] = firstRowMetrics(baseNowRep);

    const [
      totalUsersPrev,
      sessionsPrev,
      newUsersPrev,
      conversionsPrev,
      revenuePrev,
      avgSessionDurationPrev,
      engagementRatePrev
    ] = firstRowMetrics(basePrevRep);

    const commonNow = {
      totalUsers: totalUsersNow,
      sessions: sessionsNow,
      newUsers: newUsersNow,
      conversions: conversionsNow,
      revenue: revenueNow,
      engagementRate: engagementRateNow,
      avgEngagementTime: avgSessionDurationNow,
      currencyCode: meta?.currencyCode || null,
      timeZone: meta?.timeZone || null,
    };

    const commonPrev = {
      totalUsers: totalUsersPrev,
      sessions: sessionsPrev,
      newUsers: newUsersPrev,
      conversions: conversionsPrev,
      revenue: revenuePrev,
      engagementRate: engagementRatePrev,
      avgEngagementTime: avgSessionDurationPrev,
      currencyCode: meta?.currencyCode || null,
      timeZone: meta?.timeZone || null,
    };

    const out = {
      ok: true,
      property,
      range: { startDate, endDate, days },
      data: {
        kpis: { ...commonNow },
        prev: { ...commonPrev },
        deltas: buildDeltas(commonNow, commonPrev, Object.keys(commonNow)),
      },
    };

    if (objective === 'ventas') {
      const { repNow: purNowRep, repPrev: purPrevRep } = await runReportNowPrev({
        auth, property,
        nowRange, prevRange,
        metrics: ['eventCount'],
        dimensions: ['eventName'],
        dimensionFilter: {
          filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } },
        },
        limit: 50,
      });

      const purchasesNow = n(purNowRep.rows?.[0]?.metricValues?.[0]?.value);
      const purchasesPrev = n(purPrevRep.rows?.[0]?.metricValues?.[0]?.value);

      const purchaseConversionRateNow = sessionsNow ? (purchasesNow / sessionsNow) : 0;
      const purchaseConversionRatePrev = sessionsPrev ? (purchasesPrev / sessionsPrev) : 0;

      const aovNow = purchasesNow ? (revenueNow / purchasesNow) : 0;
      const aovPrev = purchasesPrev ? (revenuePrev / purchasesPrev) : 0;

      const ventasNow = {
        revenue: revenueNow,
        purchases: purchasesNow,
        aov: aovNow,
        purchaseConversionRate: purchaseConversionRateNow,
      };
      const ventasPrev = {
        revenue: revenuePrev,
        purchases: purchasesPrev,
        aov: aovPrev,
        purchaseConversionRate: purchaseConversionRatePrev,
      };

      out.data.kpis = { ...out.data.kpis, ...ventasNow };
      out.data.prev = { ...out.data.prev, ...ventasPrev };
      out.data.deltas = { ...out.data.deltas, ...buildDeltas(ventasNow, ventasPrev, Object.keys(ventasNow)) };

      return res.json(out);
    }

    if (objective === 'leads') {
      const rawLeadEvents = String(req.query.lead_events || req.query.events || 'generate_lead').trim();
      const leadEvents = rawLeadEvents.split(',').map(s => String(s || '').trim()).filter(Boolean);

      const { repNow: leadsNowRep, repPrev: leadsPrevRep } = await runReportNowPrev({
        auth, property,
        nowRange, prevRange,
        metrics: ['eventCount'],
        dimensions: ['eventName'],
        dimensionFilter: {
          filter: { fieldName: 'eventName', inListFilter: { values: leadEvents } },
        },
        limit: 200,
      });

      const sumRows = (rep) =>
        (rep.rows || []).reduce((acc, r) => acc + n(r.metricValues?.[0]?.value), 0);

      const leadsNow = sumRows(leadsNowRep);
      const leadsPrev = sumRows(leadsPrevRep);

      const leadConversionRateNow = sessionsNow ? (leadsNow / sessionsNow) : 0;
      const leadConversionRatePrev = sessionsPrev ? (leadsPrev / sessionsPrev) : 0;

      const leadsNowObj = { leads: leadsNow, leadConversionRate: leadConversionRateNow, conversionRate: leadConversionRateNow };
      const leadsPrevObj = { leads: leadsPrev, leadConversionRate: leadConversionRatePrev, conversionRate: leadConversionRatePrev };

      out.data.kpis = { ...out.data.kpis, ...leadsNowObj };
      out.data.prev = { ...out.data.prev, ...leadsPrevObj };
      out.data.deltas = { ...out.data.deltas, ...buildDeltas(leadsNowObj, leadsPrevObj, Object.keys(leadsNowObj)) };

      return res.json(out);
    }

    if (objective === 'adquisicion') {
      const ch = await gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [nowRange],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
          limit: 25,
        },
      });

      const channels = {};
      for (const r of ch.rows || []) {
        const name = r.dimensionValues?.[0]?.value || 'Other';
        const val  = n(r.metricValues?.[0]?.value);
        const key =
          (/organic/i.test(name) ? 'organic'
          : /paid|cpc|ppc/i.test(name) ? 'paid'
          : /social/i.test(name) ? 'social'
          : /referral/i.test(name) ? 'referral'
          : /direct/i.test(name) ? 'direct'
          : name);
        channels[key] = (channels[key] || 0) + val;
      }

      out.data.channels = channels;
      return res.json(out);
    }

    const engNowObj = {
      engagementRate: engagementRateNow,
      avgEngagementTime: avgSessionDurationNow,
    };
    const engPrevObj = {
      engagementRate: engagementRatePrev,
      avgEngagementTime: avgSessionDurationPrev,
    };

    out.data.kpis = { ...out.data.kpis, ...engNowObj };
    out.data.prev = { ...out.data.prev, ...engPrevObj };
    out.data.deltas = { ...out.data.deltas, ...buildDeltas(engNowObj, engPrevObj, Object.keys(engNowObj)) };

    return res.json(out);
  } catch (e) {
    console.error('GA /overview error:', e?.response?.data || e);

    if (e?.code === 'SELECTION_REQUIRED' || e?.message === 'SELECTION_REQUIRED') {
      return respondSelectionRequired(res);
    }

    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;

    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

/* =========================================================
 * ✅ RUTAS DASHBOARD (E2E)
 * ======================================================= */

router.get('/sales', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, nowRange, prevRange, meta } = await resolveBasics(req);

    const { repNow: baseNowRep, repPrev: basePrevRep } = await runReportNowPrev({
      auth, property,
      nowRange, prevRange,
      metrics: ['sessions', 'purchaseRevenue'],
    });

    const [sessionsNow, revenueNow] = firstRowMetrics(baseNowRep);
    const [sessionsPrev, revenuePrev] = firstRowMetrics(basePrevRep);

    const { repNow: purNowRep, repPrev: purPrevRep } = await runReportNowPrev({
      auth, property,
      nowRange, prevRange,
      metrics: ['eventCount'],
      dimensions: ['eventName'],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } },
      },
      limit: 50,
    });

    const purchasesNow = n(purNowRep.rows?.[0]?.metricValues?.[0]?.value);
    const purchasesPrev = n(purPrevRep.rows?.[0]?.metricValues?.[0]?.value);

    const purchaseConversionRateNow = sessionsNow ? (purchasesNow / sessionsNow) : 0;
    const purchaseConversionRatePrev = sessionsPrev ? (purchasesPrev / sessionsPrev) : 0;

    const aovNow = purchasesNow ? (revenueNow / purchasesNow) : 0;
    const aovPrev = purchasesPrev ? (revenuePrev / purchasesPrev) : 0;

    const funnelReport = async (range) => {
      const rep = await gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [range],
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
      for (const r of rep.rows || []) {
        fObj[r.dimensionValues?.[0]?.value] = n(r.metricValues?.[0]?.value);
      }
      return {
        view_item:      fObj.view_item || 0,
        add_to_cart:    fObj.add_to_cart || 0,
        begin_checkout: fObj.begin_checkout || 0,
        purchase:       fObj.purchase || 0,
      };
    };

    const [funnelNow, funnelPrev] = await Promise.all([
      funnelReport(nowRange),
      funnelReport(prevRange),
    ]);

    const convTotalNow = funnelNow.view_item ? (funnelNow.purchase / funnelNow.view_item) : 0;
    const convTotalPrev = funnelPrev.view_item ? (funnelPrev.purchase / funnelPrev.view_item) : 0;

    const seriesBase = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [nowRange],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'purchaseRevenue' }, { name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });

    const byDay = new Map();
    for (const r of seriesBase.rows || []) {
      const dateRaw = r.dimensionValues?.[0]?.value || '';
      const date = normalizeDateKey(dateRaw);
      const revenue = n(r.metricValues?.[0]?.value);
      const sessions = n(r.metricValues?.[1]?.value);
      byDay.set(date, { date, revenue, sessions, purchases: 0 });
    }

    const seriesPurch = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [nowRange],
        dimensions: [{ name: 'date' }, { name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } },
        },
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });

    for (const r of seriesPurch.rows || []) {
      const dateRaw = r.dimensionValues?.[0]?.value || '';
      const date = normalizeDateKey(dateRaw);
      const purchases = n(r.metricValues?.[0]?.value);
      const cur = byDay.get(date) || { date, revenue: 0, sessions: 0, purchases: 0 };
      cur.purchases = purchases;
      byDay.set(date, cur);
    }

    const trend = Array.from(byDay.values())
      .sort((a,b) => String(a.date).localeCompare(String(b.date)))
      .map((d) => {
        const conversionRate = d.sessions ? (d.purchases / d.sessions) : 0;
        const aov = d.purchases ? (d.revenue / d.purchases) : 0;
        return {
          date: d.date,
          revenue: d.revenue,
          purchases: d.purchases,
          sessions: d.sessions,
          conversionRate,
          aov,
        };
      });

    const nowData = {
      revenue: revenueNow,
      purchases: purchasesNow,
      purchaseConversionRate: purchaseConversionRateNow,
      aov: aovNow,
      currencyCode: meta?.currencyCode || null,
      timeZone: meta?.timeZone || null,
    };
    const prevData = {
      revenue: revenuePrev,
      purchases: purchasesPrev,
      purchaseConversionRate: purchaseConversionRatePrev,
      aov: aovPrev,
      funnel: funnelPrev,
      convTotal: convTotalPrev,
      currencyCode: meta?.currencyCode || null,
      timeZone: meta?.timeZone || null,
    };

    const deltas = {
      revenue: pctChange(nowData.revenue, prevData.revenue),
      purchases: pctChange(nowData.purchases, prevData.purchases),
      purchaseConversionRate: pctChange(nowData.purchaseConversionRate, prevData.purchaseConversionRate),
      aov: pctChange(nowData.aov, prevData.aov),
      funnelConversion: pctChange(convTotalNow, convTotalPrev),
    };

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      data: {
        ...nowData,
        trend,
        funnel: funnelNow,
        prev: prevData,
        deltas,
      },
    });
  } catch (e) {
    console.error('GA /sales error:', e?.response?.data || e);

    if (e?.code === 'SELECTION_REQUIRED' || e?.message === 'SELECTION_REQUIRED') {
      return respondSelectionRequired(res);
    }

    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;

    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get('/leads', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, nowRange, prevRange, meta } = await resolveBasics(req);

    const rawLeadEvents = String(req.query.lead_events || req.query.events || 'generate_lead').trim();
    const leadEvents = rawLeadEvents
      .split(',')
      .map(s => String(s || '').trim())
      .filter(Boolean);

    const { repNow: sessNowRep, repPrev: sessPrevRep } = await runReportNowPrev({
      auth, property,
      nowRange, prevRange,
      metrics: ['sessions'],
    });
    const [sessionsNow] = firstRowMetrics(sessNowRep);
    const [sessionsPrev] = firstRowMetrics(sessPrevRep);

    const { repNow: leadsNowRep, repPrev: leadsPrevRep } = await runReportNowPrev({
      auth, property,
      nowRange, prevRange,
      metrics: ['eventCount'],
      dimensions: ['eventName'],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: leadEvents } },
      },
      limit: 200,
    });

    const sumRows = (rep) =>
      (rep.rows || []).reduce((acc, r) => acc + n(r.metricValues?.[0]?.value), 0);

    const leadsNow = sumRows(leadsNowRep);
    const leadsPrev = sumRows(leadsPrevRep);

    const leadConversionRateNow = sessionsNow ? (leadsNow / sessionsNow) : 0;
    const leadConversionRatePrev = sessionsPrev ? (leadsPrev / sessionsPrev) : 0;

    const leadsDaily = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [nowRange],
        dimensions: [{ name: 'date' }, { name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', inListFilter: { values: leadEvents } },
        },
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });

    const byDay = new Map();
    for (const r of leadsDaily.rows || []) {
      const dRaw = r.dimensionValues?.[0]?.value || '';
      const d = normalizeDateKey(dRaw);
      const c = n(r.metricValues?.[0]?.value);
      byDay.set(d, (byDay.get(d) || 0) + c);
    }
    const trend = Array.from(byDay.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([date, leads]) => ({ date, leads }));

    const deltas = {
      leads: pctChange(leadsNow, leadsPrev),
      leadConversionRate: pctChange(leadConversionRateNow, leadConversionRatePrev),
      conversionRate: pctChange(leadConversionRateNow, leadConversionRatePrev),
    };

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      data: {
        leads: leadsNow,
        leadConversionRate: leadConversionRateNow,
        conversionRate: leadConversionRateNow,
        trend,
        leadEvents,
        currencyCode: meta?.currencyCode || null,
        timeZone: meta?.timeZone || null,
        prev: {
          leads: leadsPrev,
          leadConversionRate: leadConversionRatePrev,
          conversionRate: leadConversionRatePrev,
        },
        deltas,
      },
    });
  } catch (e) {
    console.error('GA /leads error:', e?.response?.data || e);

    if (e?.code === 'SELECTION_REQUIRED' || e?.message === 'SELECTION_REQUIRED') {
      return respondSelectionRequired(res);
    }

    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;

    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get('/acquisition', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, nowRange, prevRange, meta } = await resolveBasics(req);

    const { repNow: kNowRep, repPrev: kPrevRep } = await runReportNowPrev({
      auth, property,
      nowRange, prevRange,
      metrics: ['totalUsers', 'sessions', 'newUsers'],
    });

    const [totalUsersNow, sessionsNow, newUsersNow] = firstRowMetrics(kNowRep);
    const [totalUsersPrev, sessionsPrev, newUsersPrev] = firstRowMetrics(kPrevRep);

    const ch = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [nowRange],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
        limit: 25,
      },
    });

    const channels = {};
    for (const r of ch.rows || []) {
      const name = r.dimensionValues?.[0]?.value || 'Other';
      const val  = n(r.metricValues?.[0]?.value);
      const key =
        (/organic/i.test(name) ? 'organic'
        : /paid|cpc|ppc/i.test(name) ? 'paid'
        : /social/i.test(name) ? 'social'
        : /referral/i.test(name) ? 'referral'
        : /direct/i.test(name) ? 'direct'
        : name);
      channels[key] = (channels[key] || 0) + val;
    }

    const s = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [nowRange],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });

    const trend = (s.rows || []).map(r => ({
      date: normalizeDateKey(r.dimensionValues?.[0]?.value || null),
      sessions: n(r.metricValues?.[0]?.value),
    }));

    const deltas = {
      totalUsers: pctChange(totalUsersNow, totalUsersPrev),
      sessions: pctChange(sessionsNow, sessionsPrev),
      newUsers: pctChange(newUsersNow, newUsersPrev),
    };

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      data: {
        kpis: {
          totalUsers: totalUsersNow,
          sessions: sessionsNow,
          newUsers: newUsersNow,
        },
        totalUsers: totalUsersNow,
        sessions: sessionsNow,
        newUsers: newUsersNow,

        channels,
        trend,

        currencyCode: meta?.currencyCode || null,
        timeZone: meta?.timeZone || null,

        prev: {
          kpis: { totalUsers: totalUsersPrev, sessions: sessionsPrev, newUsers: newUsersPrev },
          totalUsers: totalUsersPrev,
          sessions: sessionsPrev,
          newUsers: newUsersPrev,
        },
        deltas,
      },
    });
  } catch (e) {
    console.error('GA /acquisition error:', e?.response?.data || e);

    if (e?.code === 'SELECTION_REQUIRED' || e?.message === 'SELECTION_REQUIRED') {
      return respondSelectionRequired(res);
    }

    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;

    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get('/engagement', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, nowRange, prevRange, meta } = await resolveBasics(req);

    const { repNow: repNow, repPrev: repPrev } = await runReportNowPrev({
      auth, property,
      nowRange, prevRange,
      metrics: ['engagementRate', 'averageSessionDuration', 'conversions'],
    });

    const [engagementRateNow, avgSessionDurationNow, conversionsNow] = firstRowMetrics(repNow);
    const [engagementRatePrev, avgSessionDurationPrev, conversionsPrev] = firstRowMetrics(repPrev);

    const s = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [nowRange],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'engagementRate' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      },
    });

    const trend = (s.rows || []).map(r => ({
      date: normalizeDateKey(r.dimensionValues?.[0]?.value || null),
      engagementRate: n(r.metricValues?.[0]?.value),
    }));

    const deltas = {
      engagementRate: pctChange(engagementRateNow, engagementRatePrev),
      avgEngagementTime: pctChange(avgSessionDurationNow, avgSessionDurationPrev),
      conversions: pctChange(conversionsNow, conversionsPrev),
    };

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      data: {
        engagementRate: engagementRateNow,
        avgEngagementTime: avgSessionDurationNow,
        conversions: conversionsNow,
        trend,
        currencyCode: meta?.currencyCode || null,
        timeZone: meta?.timeZone || null,
        prev: {
          engagementRate: engagementRatePrev,
          avgEngagementTime: avgSessionDurationPrev,
          conversions: conversionsPrev,
        },
        deltas,
      },
    });
  } catch (e) {
    console.error('GA /engagement error:', e?.response?.data || e);

    if (e?.code === 'SELECTION_REQUIRED' || e?.message === 'SELECTION_REQUIRED') {
      return respondSelectionRequired(res);
    }

    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;

    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

// Top landing pages
router.get('/landing-pages', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, nowRange } = await resolveBasics(req);

    const rep = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [nowRange],
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
      sessions: n(r.metricValues?.[0]?.value),
      users: n(r.metricValues?.[1]?.value),
      conversions: n(r.metricValues?.[2]?.value),
      revenue: n(r.metricValues?.[3]?.value),
    }));

    return res.json({ ok: true, property, range: { startDate, endDate, days }, data: { rows } });
  } catch (e) {
    console.error('GA /landing-pages error:', e?.response?.data || e);

    if (e?.code === 'SELECTION_REQUIRED' || e?.message === 'SELECTION_REQUIRED') {
      return respondSelectionRequired(res);
    }

    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;

    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

// Funnel ecommerce
router.get('/funnel', requireSession, ensureGaPropertyAllowed, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const { property, startDate, endDate, days, nowRange } = await resolveBasics(req);

    const funnel = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [nowRange],
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
      fObj[r.dimensionValues?.[0]?.value] = n(r.metricValues?.[0]?.value);
    }

    return res.json({
      ok: true,
      property,
      range: { startDate, endDate, days },
      data: {
        funnel: {
          view_item:      fObj.view_item || 0,
          add_to_cart:    fObj.add_to_cart || 0,
          begin_checkout: fObj.begin_checkout || 0,
          purchase:       fObj.purchase || 0,
        },
      },
    });
  } catch (e) {
    console.error('GA /funnel error:', e?.response?.data || e);

    if (e?.code === 'SELECTION_REQUIRED' || e?.message === 'SELECTION_REQUIRED') {
      return respondSelectionRequired(res);
    }

    const status =
      e?.code === 'PROPERTY_REQUIRED' ? 400 :
      e?.code === 'NO_REFRESH_TOKEN' ? 401 : 500;

    return res.status(status).json({ ok: false, error: e?.message || String(e) });
  }
});

module.exports = router;
