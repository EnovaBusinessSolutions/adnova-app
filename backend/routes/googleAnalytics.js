// backend/routes/googleAnalytics.js
'use strict';

const express = require('express');
const { google } = require('googleapis');
const mongoose = require('mongoose');

const router = express.Router();

// Modelos
const User = require('../models/User');
let GoogleAccount;
try { GoogleAccount = require('../models/GoogleAccount'); }
catch (_) {
  const schema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    scope: [String]
  }, { collection: 'googleaccounts' });
  GoogleAccount = mongoose.models.GoogleAccount || mongoose.model('GoogleAccount', schema);
}

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

/* ----------------------------- helpers ----------------------------- */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok:false, error: 'UNAUTHORIZED' });
}

async function getOAuthClientForUser(userId) {
  const ga = await GoogleAccount.findOne({
    $or: [{ user: userId }, { userId }]
  }).select('+refreshToken +accessToken').lean();

  if (!ga?.refreshToken) {
    const err = new Error('NO_REFRESH_TOKEN');
    err.code = 'NO_REFRESH_TOKEN';
    throw err;
  }

  const oAuth2Client = new google.auth.OAuth2({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: 'postmessage',
  });

  oAuth2Client.setCredentials({
    refresh_token: ga.refreshToken,
    access_token: ga.accessToken || undefined,
  });

  try { await oAuth2Client.getAccessToken(); } catch {}
  return oAuth2Client;
}

function buildDateRange(preset = 'last_30_days') {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  const map = { last_7_days: 7, last_14_days: 14, last_30_days: 30, last_90_days: 90 };
  const days = map[preset] || 30;
  start.setDate(end.getDate() - (days - 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end), days };
}
const pctDelta = (c, p) => {
  const C = Number(c) || 0, P = Number(p) || 0;
  if (!P && !C) return 0;
  if (!P) return 1;
  return (C - P) / P;
};

/* =======================
 * Listar propiedades GA4
 * ======================= */
router.get('/api/google/analytics/properties', requireSession, async (req, res) => {
  try {
    const auth = await getOAuthClientForUser(req.user._id);
    const admin = google.analyticsadmin({ version: 'v1beta', auth });

    const accResp = await admin.accounts.list({ pageSize: 200 });
    const accounts = accResp.data.accounts || [];

    const properties = [];
    for (const acc of accounts) {
      try {
        const props = await admin.properties.list({
          filter: `parent:accounts/${acc.name.split('/')[1]}`,
          pageSize: 200,
        });
        (props.data.properties || []).forEach((p) => {
          properties.push({
            name: p.name, // "properties/123"
            propertyId: p.name.split('/')[1],
            displayName: p.displayName,
            timeZone: p.timeZone,
            currencyCode: p.currencyCode,
          });
        });
      } catch {}
    }

    res.json({ ok: true, accounts: accounts.map(a => ({ name:a.name, displayName:a.displayName })), properties });
  } catch (e) {
    const code = e?.code || e?.response?.status || 500;
    res.status(code === 'NO_REFRESH_TOKEN' ? 401 : 500).json({ ok:false, error: e.message || String(e) });
  }
});

/* =========================
 * Overview KPIs + tendencia
 * ========================= */
router.get('/api/google/analytics/overview', requireSession, async (req, res) => {
  try {
    const property = req.query.property; // "properties/123456789"
    const dateRange = req.query.dateRange || 'last_30_days';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok:false, error:'PROPERTY_REQUIRED' });
    }

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const { startDate, endDate, days } = buildDateRange(dateRange);
    const prevStart = new Date(startDate);
    prevStart.setDate(prevStart.getDate() - days);
    const prevEnd = new Date(endDate);
    prevEnd.setDate(prevEnd.getDate() - days);
    const fmt = (d) => (typeof d === 'string' ? d : d.toISOString().slice(0,10));

    // KPIs
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
          { name: 'purchases' },
          { name: 'averageSessionDuration' },
          { name: 'engagementRate' }
        ]
      }
    });

    const r = kpiResp.data;
    const rowNow  = r?.rows?.[0]?.metricValues || [];
    const rowPrev = r?.rows?.[1]?.metricValues || [];
    const V = (arr, i) => Number(arr?.[i]?.value || 0);

    const usersNow   = V(rowNow,0), usersPrev   = V(rowPrev,0);
    const sessionsNow= V(rowNow,1), sessionsPrev= V(rowPrev,1);
    const newNow     = V(rowNow,2), newPrev     = V(rowPrev,2);
    const convNow    = V(rowNow,3), convPrev    = V(rowPrev,3);
    const revNow     = V(rowNow,4), revPrev     = V(rowPrev,4);
    const purNow     = V(rowNow,5), purPrev     = V(rowPrev,5);
    const durNow     = V(rowNow,6), durPrev     = V(rowPrev,6);
    const engNow     = V(rowNow,7), engPrev     = V(rowPrev,7);

    const pcrNow  = sessionsNow ? purNow / sessionsNow : 0;
    const pcrPrev = sessionsPrev ? purPrev / sessionsPrev : 0;
    const aovNow  = purNow ? revNow / purNow : 0;
    const aovPrev = purPrev ? revPrev / purPrev : 0;

    // Tendencia (ahora incluye engagementRate)
const trendResp = await dataApi.properties.runReport({
  property,
  requestBody: {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'engagementRate' } // NUEVO
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }]
  }
});
const trend = (trendResp.data.rows || []).map((row) => ({
  date: row.dimensionValues?.[0]?.value,
  users: Number(row.metricValues?.[0]?.value || 0),
  sessions: Number(row.metricValues?.[1]?.value || 0),
  conversions: Number(row.metricValues?.[2]?.value || 0),
  revenue: Number(row.metricValues?.[3]?.value || 0),
  engagementRate: Number(row.metricValues?.[4]?.value || 0), // NUEVO
}));


    res.json({
      ok: true,
      kpis: {
        revenue: revNow,
        purchases: purNow,
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
        purchases: pctDelta(purNow, purPrev),
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
    res.status(code === 'NO_REFRESH_TOKEN' ? 401 : 500).json({ ok:false, error: e.message || String(e) });
  }
});

/* ======================
 * Adquisición: canales
 * ====================== */
router.get('/api/google/analytics/acquisition', requireSession, async (req, res) => {
  try {
    const property = req.query.property;
    const dateRange = req.query.dateRange || 'last_30_days';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok:false, error:'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(dateRange);

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const resp = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'newUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 25
      }
    });

    const rows = (resp.data.rows || []).map(r => ({
      channel: r.dimensionValues?.[0]?.value || '(other)',
      users: Number(r.metricValues?.[0]?.value || 0),
      sessions: Number(r.metricValues?.[1]?.value || 0),
      newUsers: Number(r.metricValues?.[2]?.value || 0),
    }));

    res.json({ ok:true, rows });
  } catch (e) {
    console.error('GA acquisition error:', e?.response?.data || e.message || e);
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

/* =========================
 * Landing pages (top 10)
 * ========================= */
router.get('/api/google/analytics/landing-pages', requireSession, async (req, res) => {
  try {
    const property = req.query.property;
    const dateRange = req.query.dateRange || 'last_30_days';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok:false, error:'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(dateRange);

    const auth = await getOAuthClientForUser(req.user._id);
    const dataApi = google.analyticsdata({ version: 'v1beta', auth });

    const resp = await dataApi.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      }
    });

    const rows = (resp.data.rows || []).map(r => ({
      landingPage: r.dimensionValues?.[0]?.value || '/',
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      engagementRate: Number(r.metricValues?.[2]?.value || 0),
    }));

    res.json({ ok:true, rows });
  } catch (e) {
    console.error('GA landing pages error:', e?.response?.data || e.message || e);
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

/* ======================
 * Embudo ecommerce (4)
 * ====================== */
router.get('/api/google/analytics/funnel', requireSession, async (req, res) => {
  try {
    const property = req.query.property;
    const dateRange = req.query.dateRange || 'last_30_days';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok:false, error:'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(dateRange);

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
            inListFilter: { values: ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'] }
          }
        }
      }
    });

    const map = Object.fromEntries(
      (resp.data.rows || []).map(r => [r.dimensionValues?.[0]?.value, Number(r.metricValues?.[0]?.value || 0)])
    );

    res.json({
      ok: true,
      steps: {
        view_item: map['view_item'] || 0,
        add_to_cart: map['add_to_cart'] || 0,
        begin_checkout: map['begin_checkout'] || 0,
        purchase: map['purchase'] || 0
      }
    });
  } catch (e) {
    console.error('GA funnel error:', e?.response?.data || e.message || e);
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

/* ======================
 * Leads (generate_lead)
 * ====================== */
router.get('/api/google/analytics/leads', requireSession, async (req, res) => {
  try {
    const property = req.query.property;
    const dateRange = req.query.dateRange || 'last_30_days';
    if (!property || !/^properties\/\d+$/.test(property)) {
      return res.status(400).json({ ok:false, error:'PROPERTY_REQUIRED' });
    }
    const { startDate, endDate } = buildDateRange(dateRange);

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
              stringFilter: { matchType: 'EXACT', value: 'generate_lead' }
            }
          }
        }
      }),
      dataApi.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: 'sessions' }]
        }
      })
    ]);

    const leads = Number(evt.data?.rows?.[0]?.metricValues?.[0]?.value || 0);
    const sessions = Number(ses.data?.rows?.[0]?.metricValues?.[0]?.value || 0);
    const rate = sessions ? leads / sessions : 0;

    res.json({ ok:true, leads, conversionRate: rate });
  } catch (e) {
    console.error('GA leads error:', e?.response?.data || e.message || e);
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

module.exports = router;
