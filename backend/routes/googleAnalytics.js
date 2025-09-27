// backend/routes/googleAnalytics.js
'use strict';

const express = require('express');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

// fetch (Node 18+ lo trae global; si no, usamos node-fetch)
let fetchFn = global.fetch;
if (!fetchFn) {
  try { fetchFn = require('node-fetch'); } catch (_) { /* noop */ }
}
const fetch = (...args) => fetchFn(...args);

const router = express.Router();

/* ===========================
 * Modelos / Esquemas
 * =========================== */
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

      gaProperties:      { type: Array, default: [] },  // cache de propiedades GA4
      defaultPropertyId: { type: String, default: null },
    },
    { collection: 'googleaccounts' }
  );
  GoogleAccount = mongoose.models.GoogleAccount || mongoose.model('GoogleAccount', schema);
}

/* ===========================
 * Helpers
 * =========================== */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

// OAuth2 (googleapis) para Admin API (listar propiedades)
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

  // No fijes redirectUri si el refresh token se emitió con otra URI
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

// Acceso con token “puro” (para GA4 Data API vía HTTP)
async function getFreshAccessToken(googleAccountDoc) {
  const oAuth2 = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oAuth2.setCredentials({
    access_token: googleAccountDoc.accessToken,
    refresh_token: googleAccountDoc.refreshToken,
  });
  const { credentials } = await oAuth2.getAccessToken(); // refresca si expira
  if (credentials?.access_token && credentials.access_token !== googleAccountDoc.accessToken) {
    // Opcional: persistir access token actualizado
    googleAccountDoc.accessToken = credentials.access_token;
    await GoogleAccount.updateOne(
      { _id: googleAccountDoc._id },
      { $set: { accessToken: credentials.access_token } }
    ).catch(() => {});
  }
  return credentials.access_token || googleAccountDoc.accessToken;
}

// Llamada a GA4 Data API (HTTP)
async function ga4RunReport({ accessToken, propertyId, body }) {
  const cleanId = String(propertyId || '').replace(/^properties\//, '');
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${cleanId}:runReport`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`GA4 ${r.status}: ${errText}`);
  }
  return r.json();
}

// Presets -> dateRanges GA4 (hoy / ayer)
function presetToDateRanges(preset = 'last_30d', includeToday = false) {
  const map = {
    last_7d:   { startDate: '7daysAgo',  endDate: includeToday ? 'today' : 'yesterday' },
    last_14d:  { startDate: '14daysAgo', endDate: includeToday ? 'today' : 'yesterday' },
    last_28d:  { startDate: '28daysAgo', endDate: includeToday ? 'today' : 'yesterday' },
    last_30d:  { startDate: '30daysAgo', endDate: includeToday ? 'today' : 'yesterday' },
    this_month:{ startDate: '30daysAgo', endDate: 'today' },    // simple y suficiente
    last_month:{ startDate: '60daysAgo', endDate: '30daysAgo' } // simple
  };
  return [map[preset] || map.last_30d];
}

// Re-sync de propiedades y persistencia en Mongo
async function resyncAndPersistProperties(userId) {
  const auth = await getOAuthClientForUser(userId);
  const admin = google.analyticsadmin({ version: 'v1beta', auth });

  let out = [];
  let pageToken;
  try {
    do {
      const resp = await admin.properties.search({
        requestBody: { query: '' },
        pageToken,
        pageSize: 200,
      });
      (resp.data.properties || []).forEach((p) => {
        out.push({
          propertyId: p.name, // ej: "properties/420387145"
          displayName: p.displayName || p.name,
          timeZone: p.timeZone || null,
          currencyCode: p.currencyCode || null,
        });
      });
      pageToken = resp.data.nextPageToken || undefined;
    } while (pageToken);
  } catch (err) {
    const code = err?.response?.status || err?.code;
    if (code === 403) throw new Error('GA_ADMIN_FORBIDDEN');
    if (code === 400 || code === 404) throw new Error('GA_ADMIN_NOT_ENABLED');
    throw err;
  }

  // dedupe
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

/* =======================================================
 * Rutas (monta con: app.use('/api/google/analytics', router))
 * ======================================================= */

/** Listado de propiedades GA4 (DB-first con auto resync) */
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

/** Versión “sólo DB” (rápida) */
router.get('/properties/db', requireSession, async (req, res) => {
  try {
    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).lean();
    res.json({ ok: true, properties: doc?.gaProperties || [], defaultPropertyId: doc?.defaultPropertyId || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/** Overview dinámico según objetivo */
router.get('/overview', requireSession, async (req, res) => {
  try {
    const propertyId = String(req.query.property || '').replace(/^properties\//, '');
    const datePreset   = req.query.dateRange || req.query.date_preset || 'last_30d';
    const includeToday = req.query.include_today === '1';
    const objective    = String(req.query.objective || 'ventas');

    if (!propertyId) return res.status(400).json({ ok: false, error: 'Missing ?property=' });

    const googleAccount = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] });
    if (!googleAccount) return res.status(400).json({ ok: false, error: 'No Google account linked' });

    const accessToken = await getFreshAccessToken(googleAccount);
    const dateRanges  = presetToDateRanges(datePreset, includeToday);

    // Métricas base comunes
    const common = await ga4RunReport({
      accessToken,
      propertyId,
      body: {
        dateRanges,
        metrics: [
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'sessions' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
        ],
      },
    });
    const cm = (i) => Number(common?.rows?.[0]?.metricValues?.[i]?.value ?? '0');
    const base = {
      totalUsers: cm(0),
      newUsers: cm(1),
      sessions: cm(2),
      engagementRate: cm(3),        // 0..1
      avgEngagementTime: cm(4),     // seconds
    };

    const out = { ok: true, data: {} };

    if (objective === 'ventas') {
      // KPIs de Ventas + Embudo de eventos
      const sales = await ga4RunReport({
        accessToken,
        propertyId,
        body: {
          dateRanges,
          metrics: [
            { name: 'purchaseRevenue' },
            { name: 'ecommercePurchases' },
            { name: 'purchaseConversionRate' },
          ],
        },
      });
      const sm = (i) => Number(sales?.rows?.[0]?.metricValues?.[i]?.value ?? '0');
      const revenue = sm(0);
      const purchases = sm(1);
      const purchaseConversionRate = sm(2);
      const aov = purchases > 0 ? revenue / purchases : 0;

      const funnel = await ga4RunReport({
        accessToken,
        propertyId,
        body: {
          dateRanges,
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: {
              fieldName: 'eventName',
              inListFilter: { values: ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'] },
            },
          },
          limit: 50,
        },
      });
      const steps = {};
      for (const r of (funnel.rows || [])) {
        const ev = r.dimensionValues?.[0]?.value;
        const val = Number(r.metricValues?.[0]?.value ?? '0');
        if (ev) steps[ev] = val;
      }

      out.data = {
        ...base,
        revenue,
        purchases,
        aov,
        purchaseConversionRate,
        funnel: {
          view_item: steps.view_item || 0,
          add_to_cart: steps.add_to_cart || 0,
          begin_checkout: steps.begin_checkout || 0,
          purchase: steps.purchase || 0,
        },
      };
    } else if (objective === 'leads') {
      // Evento generate_lead (ajústalo si usas otro)
      const leadsRep = await ga4RunReport({
        accessToken,
        propertyId,
        body: {
          dateRanges,
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: { fieldName: 'eventName', stringFilter: { value: 'generate_lead' } },
          },
          limit: 1,
        },
      });
      const leads = Number(leadsRep?.rows?.[0]?.metricValues?.[0]?.value ?? '0');
      const leadConversionRate = base.sessions > 0 ? leads / base.sessions : 0;
      out.data = { ...base, leads, leadConversionRate };
    } else if (objective === 'adquisicion') {
      // Canales (defaultChannelGroup)
      const ch = await ga4RunReport({
        accessToken,
        propertyId,
        body: {
          dateRanges,
          dimensions: [{ name: 'defaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
          limit: 10,
        },
      });
      const channels = {};
      for (const r of (ch.rows || [])) {
        const name = r.dimensionValues?.[0]?.value || 'Other';
        const val  = Number(r.metricValues?.[0]?.value ?? '0');
        channels[name] = val;
      }
      out.data = { ...base, channels };
    } else {
      // Engagement: base ya trae engagementRate y avgEngagementTime
      out.data = { ...base };
    }

    return res.json(out);
  } catch (e) {
    console.error('GA /overview error:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/** Adquisición (tabla/donut por canales) */
router.get('/acquisition', requireSession, async (req, res) => {
  try {
    const propertyId   = String(req.query.property || '').replace(/^properties\//, '');
    const datePreset   = req.query.dateRange || req.query.date_preset || 'last_30d';
    const includeToday = req.query.include_today === '1';
    if (!propertyId) return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });

    const googleAccount = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] });
    const accessToken   = await getFreshAccessToken(googleAccount);
    const dateRanges    = presetToDateRanges(datePreset, includeToday);

    const resp = await ga4RunReport({
      accessToken,
      propertyId,
      body: {
        dateRanges,
        dimensions: [{ name: 'defaultChannelGroup' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'newUsers' }],
        orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
        limit: 25,
      },
    });

    const rows = (resp.rows || []).map((r) => ({
      channel:   r.dimensionValues?.[0]?.value || '(other)',
      users:     Number(r.metricValues?.[0]?.value || 0),
      sessions:  Number(r.metricValues?.[1]?.value || 0),
      newUsers:  Number(r.metricValues?.[2]?.value || 0),
    }));

    res.json({ ok: true, rows });
  } catch (e) {
    console.error('GA /acquisition error:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/** Landing pages (top 10) */
router.get('/landing-pages', requireSession, async (req, res) => {
  try {
    const propertyId   = String(req.query.property || '').replace(/^properties\//, '');
    const datePreset   = req.query.dateRange || req.query.date_preset || 'last_30d';
    const includeToday = req.query.include_today === '1';
    if (!propertyId) return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });

    const googleAccount = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] });
    const accessToken   = await getFreshAccessToken(googleAccount);
    const dateRanges    = presetToDateRanges(datePreset, includeToday);

    const resp = await ga4RunReport({
      accessToken,
      propertyId,
      body: {
        dateRanges,
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
        orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
        limit: 10,
      },
    });

    const rows = (resp.rows || []).map((r) => ({
      landingPage:    r.dimensionValues?.[0]?.value || '/',
      sessions:       Number(r.metricValues?.[0]?.value || 0),
      users:          Number(r.metricValues?.[1]?.value || 0),
      engagementRate: Number(r.metricValues?.[2]?.value || 0),
    }));

    res.json({ ok: true, rows });
  } catch (e) {
    console.error('GA /landing-pages error:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/** Embudo ecommerce (view_item → add_to_cart → begin_checkout → purchase) */
router.get('/funnel', requireSession, async (req, res) => {
  try {
    const propertyId   = String(req.query.property || '').replace(/^properties\//, '');
    const datePreset   = req.query.dateRange || req.query.date_preset || 'last_30d';
    const includeToday = req.query.include_today === '1';
    if (!propertyId) return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });

    const googleAccount = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] });
    const accessToken   = await getFreshAccessToken(googleAccount);
    const dateRanges    = presetToDateRanges(datePreset, includeToday);

    const resp = await ga4RunReport({
      accessToken,
      propertyId,
      body: {
        dateRanges,
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            inListFilter: { values: ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'] },
          },
        },
        limit: 50,
      },
    });

    const map = Object.fromEntries(
      (resp.rows || []).map((r) => [r.dimensionValues?.[0]?.value, Number(r.metricValues?.[0]?.value || 0)])
    );

    res.json({
      ok: true,
      steps: {
        view_item:      map['view_item'] || 0,
        add_to_cart:    map['add_to_cart'] || 0,
        begin_checkout: map['begin_checkout'] || 0,
        purchase:       map['purchase'] || 0,
      },
    });
  } catch (e) {
    console.error('GA /funnel error:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/** Leads (evento generate_lead + tasa sobre sesiones) */
router.get('/leads', requireSession, async (req, res) => {
  try {
    const propertyId   = String(req.query.property || '').replace(/^properties\//, '');
    const datePreset   = req.query.dateRange || req.query.date_preset || 'last_30d';
    const includeToday = req.query.include_today === '1';
    if (!propertyId) return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });

    const googleAccount = await GoogleAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] });
    const accessToken   = await getFreshAccessToken(googleAccount);
    const dateRanges    = presetToDateRanges(datePreset, includeToday);

    const [evt, ses] = await Promise.all([
      ga4RunReport({
        accessToken,
        propertyId,
        body: {
          dateRanges,
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: { fieldName: 'eventName', stringFilter: { value: 'generate_lead' } },
          },
          limit: 1,
        },
      }),
      ga4RunReport({
        accessToken,
        propertyId,
        body: {
          dateRanges,
          metrics: [{ name: 'sessions' }],
        },
      }),
    ]);

    const leads = Number(evt?.rows?.[0]?.metricValues?.[0]?.value || 0);
    const sessions = Number(ses?.rows?.[0]?.metricValues?.[0]?.value || 0);
    const rate = sessions ? leads / sessions : 0;

    res.json({ ok: true, leads, conversionRate: rate });
  } catch (e) {
    console.error('GA /leads error:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

module.exports = router;
