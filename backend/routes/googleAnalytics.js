// backend/routes/googleAnalytics.js
'use strict';

const express = require('express');
const { google } = require('googleapis');
const mongoose = require('mongoose');

const router = express.Router();

// Modelos
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

      // cache de GA4
      gaProperties:      { type: Array, default: [] },
      defaultPropertyId: { type: String, default: null },
    },
    { collection: 'googleaccounts' }
  );
  GoogleAccount = mongoose.models.GoogleAccount || mongoose.model('GoogleAccount', schema);
}

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET/*, GOOGLE_CONNECT_CALLBACK_URL*/ } = process.env;

/* ----------------------------- helpers ----------------------------- */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

// Crea un OAuth client con refresh token del usuario
async function getOAuthClientForUser(userId) {
  const ga = await GoogleAccount.findOne({
    $or: [{ user: userId }, { userId }],
  })
    .select('+refreshToken +accessToken')
    .lean();

  if (!ga?.refreshToken) {
    const err = new Error('NO_REFRESH_TOKEN');
    err.code = 'NO_REFRESH_TOKEN';
    throw err;
  }

  // ⚠️ No fijamos redirectUri para evitar invalid_grant si el refresh fue emitido con otra URI.
  // Si quisieras fijarla, usa EXACTAMENTE la que emitió el token (p.ej. GOOGLE_CONNECT_CALLBACK_URL).
  const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

  oAuth2Client.setCredentials({
    refresh_token: ga.refreshToken,
    access_token: ga.accessToken || undefined,
  });

  // Forzamos a refrescar si expira
  try { await oAuth2Client.getAccessToken(); } catch {}
  return oAuth2Client;
}

// Mapeo flexible de date presets
function mapPresetToLegacy(preset) {
  switch (preset) {
    case 'last_7d': return 'last_7_days';
    case 'last_14d': return 'last_14_days';
    case 'last_28d': return 'last_28_days';
    case 'last_30d': return 'last_30_days';
    case 'last_90d': return 'last_90_days';
    case 'today': return 'today';
    case 'yesterday': return 'yesterday';
    case 'this_month': return 'this_month';
    case 'last_month': return 'last_month';
    default: return preset;
  }
}

// Construye rango usando legacy presets y include_today
function buildDateRange(inputPreset = 'last_30_days', includeToday = true) {
  const preset = mapPresetToLegacy(inputPreset) || 'last_30_days';
  const now = new Date();

  // end = hoy
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!includeToday && preset !== 'yesterday') {
    // Para yesterday lo manejamos abajo; para los demás, si no incluye hoy, terminamos en ayer.
    end.setDate(end.getDate() - 1);
  }

  const start = new Date(end);
  let days = 30;
  const daysMap = { last_7_days: 7, last_14_days: 14, last_28_days: 28, last_30_days: 30, last_90_days: 90 };

  if (preset in daysMap) {
    days = daysMap[preset];
    start.setDate(end.getDate() - (days - 1));
  } else if (preset === 'yesterday') {
    // Ayer SIEMPRE, independiente de include_today
    end.setDate(end.getDate() - 1);
    start.setTime(end.getTime());
  } else if (preset === 'today') {
    // Hoy (o ayer si include_today=0 ya se trató arriba)
    start.setTime(end.getTime());
  } else if (preset === 'this_month') {
    start.setFullYear(end.getFullYear(), end.getMonth(), 1);
  } else if (preset === 'last_month') {
    start.setMonth(end.getMonth() - 1, 1);
    end.setMonth(start.getMonth() + 1, 0); // último día del mes anterior
  } else {
    // fallback
    start.setDate(end.getDate() - (days - 1));
  }

  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end), days };
}

const pctDelta = (c, p) => {
  const C = Number(c) || 0, P = Number(p) || 0;
  if (!P && !C) return 0;
  if (!P) return 1;
  return (C - P) / P;
};

// Re-sync GA properties y persiste en Mongo (manejo de errores claros)
async function resyncAndPersistProperties(userId) {
  const auth = await getOAuthClientForUser(userId);
  const admin = google.analyticsadmin({ version: 'v1beta', auth });

  let out = [];
  let pageToken;
  try {
    do {
      // properties.search devuelve todas las propiedades GA4 accesibles por el usuario
      const resp = await admin.properties.search({
        requestBody: { query: '' },
        pageToken,
        pageSize: 200,
      });
      (resp.data.properties || []).forEach((p) => {
        out.push({
          propertyId: p.name, // "properties/123"
          displayName: p.displayName || p.name,
          timeZone: p.timeZone || null,
          currencyCode: p.currencyCode || null,
        });
      });
      pageToken = resp.data.nextPageToken || undefined;
    } while (pageToken);
  } catch (err) {
    const code = err?.response?.status || err?.code;
    if (code === 403) throw new Error('GA_ADMIN_FORBIDDEN');      // Falta scope
    if (code === 400 || code === 404) throw new Error('GA_ADMIN_NOT_ENABLED'); // API no habilitada
    throw err;
  }

  // dedupe por propertyId
  const map = new Map();
  for (const p of out) map.set(p.propertyId, p);
  const properties = Array.from(map.values());

  // Persistir
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

/* =======================
 * Listar propiedades GA4 (DB-first con auto re-sync)
 * ======================= */
router.get('/api/google/analytics/properties', requireSession, async (req, res) => {
  try {
    // 1) Leer desde Mongo
    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).lean();

    let properties = doc?.gaProperties || [];
    let defaultPropertyId = doc?.defaultPropertyId || null;

    // 2) Si está vacío, re-sync con GA Admin y persistir
    if (!properties.length) {
      try {
        properties = await resyncAndPersistProperties(req.user._id);
        defaultPropertyId = properties?.[0]?.propertyId || null;
      } catch (e) {
        const msg =
          e.message === 'GA_ADMIN_FORBIDDEN'
            ? 'GA_ADMIN_FORBIDDEN'
            : e.message === 'GA_ADMIN_NOT_ENABLED'
              ? 'GA_ADMIN_NOT_ENABLED'
              : 'NO_REFRESH_TOKEN_OR_SYNC_FAILED';
        return res.status(401).json({ ok: false, error: msg });
      }
    }

    res.json({ ok: true, properties, defaultPropertyId });
  } catch (e) {
    const code = e?.code || e?.response?.status || 500;
    res.status(code === 'NO_REFRESH_TOKEN' ? 401 : 500).json({ ok: false, error: e.message || String(e) });
  }
});

// También de DB puro (opcional, rápido)
router.get('/api/google/analytics/properties/db', requireSession, async (req, res) => {
  try {
    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).lean();
    res.json({ ok: true, properties: doc?.gaProperties || [], defaultPropertyId: doc?.defaultPropertyId || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* =========================
 * Overview KPIs + tendencia
 * ========================= */
router.get('/api/google/analytics/overview', requireSession, async (req, res) => {
  try {
    const property = req.query.property; // "properties/123456789"
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';

    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const { startDate, endDate, days } = buildDateRange(datePreset, includeToday);
    const prevStart = new Date(startDate);
    prevStart.setDate(prevStart.getDate() - days);
    const prevEnd = new Date(endDate);
    prevEnd.setDate(prevEnd.getDate() - days);
    const fmt = (d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));

    // --- KPIs (sin 'purchases' directo) ---
const kpiResp = await dataApi.properties.runReport({
  property,
  requestBody: {
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

// --- Compras por evento (NOW) ---
const purNowResp = await dataApi.properties.runReport({
  property,
  requestBody: {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { matchType: 'EXACT', value: 'purchase' }
      }
    }
  }
});

// --- Compras por evento (PREV) ---
const purPrevResp = await dataApi.properties.runReport({
  property,
  requestBody: {
    dateRanges: [{ startDate: fmt(prevStart), endDate: fmt(prevEnd) }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { matchType: 'EXACT', value: 'purchase' }
      }
    }
  }
});

const purchasesNow = Number(purNowResp.data?.rows?.[0]?.metricValues?.[0]?.value || 0);
const purchasesPrev = Number(purPrevResp.data?.rows?.[0]?.metricValues?.[0]?.value || 0);

// ... del kpiResp lee como ya lo hacías:
const r = kpiResp.data;
const rowNow  = r?.rows?.[0]?.metricValues || [];
const rowPrev = r?.rows?.[1]?.metricValues || [];
const V = (arr, i) => Number(arr?.[i]?.value || 0);

const usersNow   = V(rowNow,0), usersPrev   = V(rowPrev,0);
const sessionsNow= V(rowNow,1), sessionsPrev= V(rowPrev,1);
const newNow     = V(rowNow,2), newPrev     = V(rowPrev,2);
const convNow    = V(rowNow,3), convPrev    = V(rowPrev,3);
const revNow     = V(rowNow,4), revPrev     = V(rowPrev,4);
const durNow     = V(rowNow,5), durPrev     = V(rowPrev,5);
const engNow     = V(rowNow,6), engPrev     = V(rowPrev,6);

// KPIs derivados con 'purchasesNow'
const pcrNow  = sessionsNow ? purchasesNow / sessionsNow : 0;
const pcrPrev = sessionsPrev ? purchasesPrev / sessionsPrev : 0;
const aovNow  = purchasesNow ? revNow / purchasesNow : 0;
const aovPrev = purchasesPrev ? revPrev / purchasesPrev : 0;

res.json({
  ok: true,
  kpis: {
    revenue: revNow,
    purchases: purchasesNow,
    purchaseConversionRate: pcrNow,
    aov: aovNow,
    users: usersNow,
    sessions: sessionsNow,
    newUsers: newNow,
    engagementRate: engNow,
    averageSessionDuration: durNow
  },
  deltas: {
    revenue: pctDelta(revNow, revPrev),
    purchases: pctDelta(purchasesNow, purchasesPrev),
    purchaseConversionRate: pctDelta(pcrNow, pcrPrev),
    aov: pctDelta(aovNow, aovPrev),
    users: pctDelta(usersNow, usersPrev),
    sessions: pctDelta(sessionsNow, sessionsPrev),
    newUsers: pctDelta(newNow, newPrev),
    engagementRate: pctDelta(engNow, engPrev),
    averageSessionDuration: pctDelta(durNow, durPrev),
  },
  trend
});

  } catch (e) {
    console.error('GA overview error:', e?.response?.data || e.message || e);
    const code = e?.code || e?.response?.status || 500;
    res.status(code === 'NO_REFRESH_TOKEN' ? 401 : 500).json({ ok: false, error: e.message || String(e) });
  }
});

/* ======================
 * Adquisición: canales
 * ====================== */
router.get('/api/google/analytics/acquisition', requireSession, async (req, res) => {
  try {
    const property = req.query.property;
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(datePreset, includeToday);

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const resp = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'newUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 25,
      },
    });

    const rows = (resp.data.rows || []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value || '(other)',
      users: Number(r.metricValues?.[0]?.value || 0),
      sessions: Number(r.metricValues?.[1]?.value || 0),
      newUsers: Number(r.metricValues?.[2]?.value || 0),
    }));

    res.json({ ok: true, rows });
  } catch (e) {
    console.error('GA acquisition error:', e?.response?.data || e.message || e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/* =========================
 * Landing pages (top 10)
 * ========================= */
router.get('/api/google/analytics/landing-pages', requireSession, async (req, res) => {
  try {
    const property = req.query.property;
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(datePreset, includeToday);

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const resp = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      },
    });

    const rows = (resp.data.rows || []).map((r) => ({
      landingPage: r.dimensionValues?.[0]?.value || '/',
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      engagementRate: Number(r.metricValues?.[2]?.value || 0),
    }));

    res.json({ ok: true, rows });
  } catch (e) {
    console.error('GA landing pages error:', e?.response?.data || e.message || e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/* ======================
 * Embudo ecommerce (4)
 * ====================== */
router.get('/api/google/analytics/funnel', requireSession, async (req, res) => {
  try {
    const property = req.query.property;
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(datePreset, includeToday);

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const resp = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            inListFilter: { values: ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'] },
          },
        },
      },
    });

    const map = Object.fromEntries(
      (resp.data.rows || []).map((r) => [r.dimensionValues?.[0]?.value, Number(r.metricValues?.[0]?.value || 0)])
    );

    res.json({
      ok: true,
      steps: {
        view_item: map['view_item'] || 0,
        add_to_cart: map['add_to_cart'] || 0,
        begin_checkout: map['begin_checkout'] || 0,
        purchase: map['purchase'] || 0,
      },
    });
  } catch (e) {
    console.error('GA funnel error:', e?.response?.data || e.message || e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/* ======================
 * Leads (generate_lead)
 * ====================== */
router.get('/api/google/analytics/leads', requireSession, async (req, res) => {
  try {
    const property = req.query.property;
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(datePreset, includeToday);

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const [evt, ses] = await Promise.all([
      dataApi.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: {
              fieldName: 'eventName',
              stringFilter: { matchType: 'EXACT', value: 'generate_lead' },
            },
          },
        },
      }),
      dataApi.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: 'sessions' }],
        },
      }),
    ]);

    const leads = Number(evt.data?.rows?.[0]?.metricValues?.[0]?.value || 0);
    const sessions = Number(ses.data?.rows?.[0]?.metricValues?.[0]?.value || 0);
    const rate = sessions ? leads / sessions : 0;

    res.json({ ok: true, leads, conversionRate: rate });
  } catch (e) {
    console.error('GA leads error:', e?.response?.data || e.message || e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

module.exports = router;
