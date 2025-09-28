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

      // cache GA4
      gaProperties:      { type: Array, default: [] }, // [{propertyId, displayName, timeZone, currencyCode}]
      defaultPropertyId: { type: String, default: null },
    },
    { collection: 'googleaccounts' }
  );
  GoogleAccount = mongoose.models.GoogleAccount || mongoose.model('GoogleAccount', schema);
}

/* =============== HELPERS / AUTH =============== */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function normalizePropertyId(p) {
  // admite "properties/123" o "123"
  const id = String(p || '').replace(/^properties\//, '');
  return /^\d+$/.test(id) ? id : '';
}

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
    // no fijamos redirectUri para evitar invalid_grant si el refresh se emitió con otra URI
  );
  oAuth2Client.setCredentials({
    refresh_token: ga.refreshToken,
    access_token: ga.accessToken || undefined,
  });

  try { await oAuth2Client.getAccessToken(); } catch {}
  return oAuth2Client;
}

// admite last_30d y last_30_days, etc.
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

const pctDelta = (c, p) => {
  const C = Number(c) || 0, P = Number(p) || 0;
  if (!P && !C) return 0;
  if (!P) return 1;
  return (C - P) / P;
};

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

  // dedupe
  const map = new Map();
  for (const p of out) map.set(p.propertyId, p);
  const properties = Array.from(map.values());

  // persist
  const doc = await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] });
  if (doc) {
    doc.gaProperties = properties;
    if (!doc.defaultPropertyId && properties[0]?.propertyId) doc.defaultPropertyId = properties[0].propertyId;
    await doc.save();
  } else {
    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: userId }, { userId }] },
      { $set: { gaProperties: properties, defaultPropertyId: properties[0]?.propertyId || null, updatedAt: new Date() } },
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

/* ======================= RUTAS (RELATIVAS) ======================= */
/** GET /api/google/analytics/properties */
router.get('/properties', requireSession, async (req, res) => {
  try {
    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).lean();

    let properties = doc?.gaProperties || [];
    let defaultPropertyId = doc?.defaultPropertyId || null;

    if (!properties.length) {
      try {
        properties = await resyncAndPersistProperties(req.user._id);
        defaultPropertyId = properties?.[0]?.propertyId || null;
      } catch (e) {
        const msg =
          e.message === 'NO_REFRESH_TOKEN' ? 'NO_REFRESH_TOKEN'
          : 'SYNC_FAILED';
        return res.status(401).json({ ok: false, error: msg });
      }
    }

    res.json({ ok: true, properties, defaultPropertyId });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/** GET /api/google/analytics/overview */
router.get('/overview', requireSession, async (req, res) => {
  try {
    const property = String(req.query.property || '');
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    const objective = String(req.query.objective || 'ventas');

    if (!/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }

    const auth = await getOAuthClientForUser(req.user._id);

    // Rango actual + anterior
    const { startDate, endDate, days } = buildDateRange(datePreset, includeToday);
    const prevStart = new Date(startDate); prevStart.setDate(prevStart.getDate() - days);
    const prevEnd   = new Date(endDate);   prevEnd.setDate(prevEnd.getDate() - days);
    const fmt = (d) => (typeof d === 'string' ? d : d.toISOString().slice(0,10));

    // KPIs base
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
      engagementRate:         V(rowNow,6),
      avgEngagementTime:      V(rowNow,5), // seg
    };
    const basePrev = {
      totalUsers: V(rowPrev,0),
      sessions:   V(rowPrev,1),
      newUsers:   V(rowPrev,2),
      engagementRate:    V(rowPrev,6),
      avgEngagementTime: V(rowPrev,5),
    };

    const out = { ok: true, data: {} };

    if (objective === 'ventas') {
      // purchases (evento) ahora y antes
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

      // Embudo por eventos
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
        channels[
          (/organic/i.test(name) ? 'organic'
          : /paid|cpc|ppc/i.test(name) ? 'paid'
          : /social/i.test(name) ? 'social'
          : /referral/i.test(name) ? 'referral'
          : /direct/i.test(name) ? 'direct'
          : name)
        ] = (channels[name] || 0) + val;
      }
      out.data = { sessions: base.sessions, channels };
    } else {
      // engagement
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


/** GET /api/google/analytics/sales  (RELATIVO: /sales) */
router.get('/sales', requireSession, async (req, res) => {
  try {
    const propertyId = normalizePropertyId(req.query.property);
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30d';
    const includeToday = req.query.include_today === '1';
    if (!propertyId) return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const { startDate, endDate, days } = buildDateRange(datePreset, includeToday);
    const prevStart = new Date(startDate); prevStart.setDate(prevStart.getDate() - days);
    const prevEnd   = new Date(endDate);   prevEnd.setDate(prevEnd.getDate() - days);
    const fmt = d => (typeof d === 'string' ? d : d.toISOString().slice(0,10));

    const property = `properties/${propertyId}`;

    // ---------- KPIs actuales ----------
    const kpisNow = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'purchaseRevenue' },     // ingresos
          { name: 'ecommercePurchases' },  // órdenes
          { name: 'sessions' }             // para tasa
        ]
      }
    });
    const kmNow = (i) => Number(kpisNow?.data?.rows?.[0]?.metricValues?.[i]?.value ?? 0);
    const revenue = kmNow(0);
    const purchases = kmNow(1);
    const sessions = kmNow(2);
    const purchaseConversionRate = sessions ? purchases / sessions : 0;
    const aov = purchases ? revenue / purchases : 0;

    // ---------- KPIs periodo anterior ----------
    const kpisPrev = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: fmt(prevStart), endDate: fmt(prevEnd) }],
        metrics: [
          { name: 'purchaseRevenue' },
          { name: 'ecommercePurchases' },
          { name: 'sessions' }
        ]
      }
    });
    const kmPrev = (i) => Number(kpisPrev?.data?.rows?.[0]?.metricValues?.[i]?.value ?? 0);
    const prevRevenue = kmPrev(0);
    const prevPurchases = kmPrev(1);
    const prevSessions = kmPrev(2);
    const prevPurchaseConversionRate = prevSessions ? prevPurchases / prevSessions : 0;
    const prevAov = prevPurchases ? prevRevenue / prevPurchases : 0;

    // helper delta
    const delta = (now, prev) => (prev ? (now - prev) / prev : null);

    // ---------- Tendencia diaria ----------
    const trendResp = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'purchaseRevenue' },
          { name: 'ecommercePurchases' },
          { name: 'sessions' }
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      }
    });
    const trend = (trendResp.data.rows || []).map((r) => {
      const d = r.dimensionValues?.[0]?.value || '';
      const rev = Number(r.metricValues?.[0]?.value || 0);
      const pur = Number(r.metricValues?.[1]?.value || 0);
      const ses = Number(r.metricValues?.[2]?.value || 0);
      const dateISO = d && d.length === 8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : d;
      return {
        date: dateISO,
        revenue: rev,
        purchases: pur,
        sessions: ses,
        conversionRate: ses ? pur / ses : 0,
        aov: pur ? rev / pur : 0
      };
    });

    // ---------- Embudo actual ----------
    const funnelNowResp = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            inListFilter: { values: ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'] }
          }
        }
      }
    });
    const fNow = Object.fromEntries(
      (funnelNowResp.data.rows || []).map(r => [
        r.dimensionValues?.[0]?.value,
        Number(r.metricValues?.[0]?.value || 0)
      ])
    );

    // ---------- Embudo periodo anterior ----------
    const funnelPrevResp = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: fmt(prevStart), endDate: fmt(prevEnd) }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            inListFilter: { values: ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'] }
          }
        }
      }
    });
    const fPrev = Object.fromEntries(
      (funnelPrevResp.data.rows || []).map(r => [
        r.dimensionValues?.[0]?.value,
        Number(r.metricValues?.[0]?.value || 0)
      ])
    );

    // conversión total (purchase / view_item) para resumen del embudo
    const convNow = (fNow.purchase || 0) && (fNow.view_item || 0) ? (fNow.purchase / fNow.view_item) : 0;
    const convPrev = (fPrev.purchase || 0) && (fPrev.view_item || 0) ? (fPrev.purchase / fPrev.view_item) : 0;

    res.json({
      ok: true,
      data: {
        // actuales
        revenue, purchases, purchaseConversionRate, aov,
        trend,
        funnel: {
          view_item: fNow.view_item || 0,
          add_to_cart: fNow.add_to_cart || 0,
          begin_checkout: fNow.begin_checkout || 0,
          purchase: fNow.purchase || 0,
        },

        // periodo anterior (para comparativas)
        prev: {
          revenue: prevRevenue,
          purchases: prevPurchases,
          purchaseConversionRate: prevPurchaseConversionRate,
          aov: prevAov,
          funnel: {
            view_item: fPrev.view_item || 0,
            add_to_cart: fPrev.add_to_cart || 0,
            begin_checkout: fPrev.begin_checkout || 0,
            purchase: fPrev.purchase || 0,
          },
          convTotal: convPrev, // purchase/view_item
        },

        // deltas (ahora vs. anterior)
        deltas: {
          revenue: delta(revenue, prevRevenue),
          purchases: delta(purchases, prevPurchases),
          purchaseConversionRate: delta(purchaseConversionRate, prevPurchaseConversionRate),
          aov: delta(aov, prevAov),
          funnelConversion: delta(convNow, convPrev) // útil para chip en resumen de embudo
        }
      }
    });
  } catch (e) {
    console.error('GA /sales error:', e?.response?.data || e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});



/** GET /api/google/analytics/landing-pages */
router.get('/landing-pages', requireSession, async (req, res) => {
  try {
    const property = String(req.query.property || '');
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    if (!/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(datePreset, includeToday);
    const auth = await getOAuthClientForUser(req.user._id);

    const data = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }
    });

    const rows = (data.rows || []).map(r => ({
      landingPage: r.dimensionValues?.[0]?.value || '/',
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      engagementRate: Number(r.metricValues?.[2]?.value || 0),
    }));

    res.json({ ok: true, rows });
  } catch (e) {
    console.error('GA landing pages error:', e?.response?.data || e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/** GET /api/google/analytics/funnel */
router.get('/funnel', requireSession, async (req, res) => {
  try {
    const property = String(req.query.property || '');
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    if (!/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(datePreset, includeToday);
    const auth = await getOAuthClientForUser(req.user._id);

    const data = await gaDataRunReport({
      auth, property,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', inListFilter: { values: ['view_item','add_to_cart','begin_checkout','purchase'] } }
        }
      }
    });

    const map = Object.fromEntries((data.rows || []).map(r => [
      r.dimensionValues?.[0]?.value,
      Number(r.metricValues?.[0]?.value || 0)
    ]));

    res.json({
      ok: true,
      steps: {
        view_item: map.view_item || 0,
        add_to_cart: map.add_to_cart || 0,
        begin_checkout: map.begin_checkout || 0,
        purchase: map.purchase || 0,
      }
    });
  } catch (e) {
    console.error('GA funnel error:', e?.response?.data || e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/** GET /api/google/analytics/leads */
router.get('/leads', requireSession, async (req, res) => {
  try {
    const property = String(req.query.property || '');
    const datePreset = req.query.date_preset || req.query.dateRange || 'last_30_days';
    const includeToday = req.query.include_today === '1';
    if (!/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(datePreset, includeToday);
    const auth = await getOAuthClientForUser(req.user._id);

    // Totales
    const [evt, ses] = await Promise.all([
      gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'generate_lead' } } },
        }
      }),
      gaDataRunReport({
        auth, property,
        body: { dateRanges: [{ startDate, endDate }], metrics: [{ name: 'sessions' }] }
      })
    ]);

    const leads = Number(evt.rows?.[0]?.metricValues?.[0]?.value || 0);
    const sessionsTotal = Number(ses.rows?.[0]?.metricValues?.[0]?.value || 0);
    const rate = sessionsTotal ? leads / sessionsTotal : 0;

    // === Tendencia diaria ===
    const [evtDaily, sesDaily] = await Promise.all([
      gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'generate_lead' } } },
          orderBys: [{ dimension: { dimensionName: 'date' } }]
        }
      }),
      gaDataRunReport({
        auth, property,
        body: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }]
        }
      })
    ]);

    const toISO = (yyyymmdd = '') =>
      yyyymmdd && yyyymmdd.length === 8
        ? `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`
        : yyyymmdd;

    const sesMap = new Map();
    (sesDaily.rows || []).forEach(r => {
      const d = r.dimensionValues?.[0]?.value || '';
      sesMap.set(d, Number(r.metricValues?.[0]?.value || 0));
    });

    const trend = (evtDaily.rows || []).map(r => {
      const d = r.dimensionValues?.[0]?.value || '';
      const leadsDay = Number(r.metricValues?.[0]?.value || 0);
      const sessionsDay = Number(sesMap.get(d) || 0);
      const cr = sessionsDay ? leadsDay / sessionsDay : 0;
      return { date: toISO(d), leads: leadsDay, conversionRate: cr };
    });

    res.json({ ok: true, leads, conversionRate: rate, trend });
  } catch (e) {
    console.error('GA leads error:', e?.response?.data || e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

module.exports = router;
