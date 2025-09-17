'use strict';

const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');

const router = express.Router();

/* --------------------- Model (fallback) --------------------- */
let GoogleAccount;
try { GoogleAccount = require('../models/GoogleAccount'); } catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    managerCustomerId: String,
    objective: String,
    customers: Array,         // [{ id, timeZone, currencyCode, ... }]
    defaultCustomerId: String,
  }, { collection: 'googleaccounts' });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_DEVELOPER_TOKEN,
} = process.env;

/* --------------------- Auth guard --------------------- */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

/* --------------------- OAuth client ------------------- */
function oauth() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/* --------------------- Fechas (UTC) ------------------- */
const ymd = d => d.toISOString().slice(0,10);
const addDays = (d, n) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

/** Acepta:
 *  - range=30|60|90 (y include_today=0|1)
 *  - ó date_preset (last_7d, last_14d, last_28d, today, yesterday)
 */
function computeRanges(q) {
  const includeToday = String(q.include_today || '0') === '1';
  const today = new Date();
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const anchor = includeToday ? base : addDays(base, -1);

  const preset = String(q.date_preset || '').toLowerCase();
  if (preset === 'today') {
    return {
      current:  { since: ymd(anchor), until: ymd(anchor) },
      previous: { since: ymd(addDays(anchor, -1)), until: ymd(addDays(anchor, -1)) },
      is_partial: includeToday,
    };
  }
  if (preset === 'yesterday') {
    const y = addDays(anchor, -1);
    const yy = addDays(anchor, -2);
    return {
      current:  { since: ymd(y),  until: ymd(y)  },
      previous: { since: ymd(yy), until: ymd(yy) },
      is_partial: false,
    };
  }

  // range numérico (30/60/90) tiene prioridad
  let days = Number(q.range || 0);
  if (!Number.isFinite(days) || days <= 0) {
    days =
      preset === 'last_7d'  ? 7  :
      preset === 'last_14d' ? 14 :
      preset === 'last_28d' ? 28 : 30;
  }

  const currUntil = anchor;
  const currSince = addDays(currUntil, -(days - 1));
  const prevUntil = addDays(currSince, -1);
  const prevSince = addDays(prevUntil, -(days - 1));

  return {
    current:  { since: ymd(currSince), until: ymd(currUntil) },
    previous: { since: ymd(prevSince), until: ymd(prevUntil) },
    is_partial: includeToday,
  };
}

const microsToCurrency = m => {
  const n = Number(m);
  return Number.isFinite(n) ? n / 1e6 : 0;
};

async function getFreshAccessToken(gaDoc) {
  const client = oauth();
  client.setCredentials({ refresh_token: gaDoc.refreshToken, access_token: gaDoc.accessToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials.access_token || gaDoc.accessToken;
}

const customerList = doc => Array.isArray(doc?.customers) ? doc.customers : [];

function resolveCustomerId(req, doc) {
  const q = String(req.query.customer_id || '').replace(/-/g,'');
  if (q) return q;
  if (doc?.defaultCustomerId) return String(doc.defaultCustomerId).replace(/-/g,'');
  const list = customerList(doc);
  return list.length ? String(list[0].id || '').replace(/-/g,'') : '';
}

async function runGAQL({ accessToken, customerId, gaql, managerId }) {
  const { data } = await axios.post(
    `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:search`,
    { query: gaql },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': GOOGLE_DEVELOPER_TOKEN,
        ...(managerId ? { 'login-customer-id': managerId } : {}),
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );
  return data?.results || [];
}

/* ===========================================================
   GET /api/google/ads   -> shape canónico para tu frontend
   =========================================================== */
router.get('/', requireAuth, async (req, res) => {
  try {
    const gaDoc = await GoogleAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+refreshToken +accessToken objective defaultCustomerId managerCustomerId customers')
      .lean();

    if (!gaDoc?.refreshToken && !gaDoc?.accessToken) {
      return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });
    }

    const objective = String(req.query.objective || gaDoc.objective || 'ventas').toLowerCase();
    const ranges = computeRanges(req.query);

    const customerId = resolveCustomerId(req, gaDoc);
    if (!customerId) return res.status(400).json({ ok: false, error: 'NO_CUSTOMER_ID' });

    const accessToken = await getFreshAccessToken(gaDoc);

    // Campos por día
    const baseFields = `
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.all_conversions,
      metrics.all_conversions_value
    `;

    const qCurr = `
      SELECT ${baseFields}
      FROM customer
      WHERE segments.date BETWEEN '${ranges.current.since}' AND '${ranges.current.until}'
      ORDER BY segments.date
    `;
    const qPrev = `
      SELECT ${baseFields}
      FROM customer
      WHERE segments.date BETWEEN '${ranges.previous.since}' AND '${ranges.previous.until}'
      ORDER BY segments.date
    `;

    // (opcional) currency/zone
    const qMeta = `
      SELECT
        customer.currency_code,
        customer.time_zone
      FROM customer
      LIMIT 1
    `;

    const [rows, rowsPrev, metaRows] = await Promise.all([
      runGAQL({ accessToken, customerId, gaql: qCurr, managerId: gaDoc.managerCustomerId }),
      runGAQL({ accessToken, customerId, gaql: qPrev, managerId: gaDoc.managerCustomerId }),
      runGAQL({ accessToken, customerId, gaql: qMeta, managerId: gaDoc.managerCustomerId }).catch(() => []),
    ]);

    const meta0 = metaRows?.[0]?.customer || {};
    const currency = meta0?.currencyCode || customerList(gaDoc).find(c => String(c.id).replace(/-/g,'') === String(customerId))?.currencyCode || 'USD';
    const timeZone = meta0?.timeZone || customerList(gaDoc).find(c => String(c.id).replace(/-/g,'') === String(customerId))?.timeZone || 'America/Mexico_City';

    /* --------------------- Aggregates actuales --------------------- */
    let cost = 0, impressions = 0, clicks = 0, conversions = 0, conv_value = 0;

    const series = rows.map(r => {
      const _cost = microsToCurrency(r?.metrics?.costMicros);
      const _imp  = Number(r?.metrics?.impressions || 0);
      const _clk  = Number(r?.metrics?.clicks || 0);
      const _ac   = Number(r?.metrics?.allConversions || 0);
      const _av   = Number(r?.metrics?.allConversionsValue || 0);

      cost        += _cost;
      impressions += _imp;
      clicks      += _clk;
      conversions += _ac;
      conv_value  += _av;

      return {
        date: r?.segments?.date,
        impressions: _imp,
        clicks: _clk,
        cost: _cost,            // <- CANÓNICO
        conversions: _ac,
        conv_value: _av,        // <- CANÓNICO
      };
    });

    /* --------------------- Aggregates previos ---------------------- */
    let p_cost = 0, p_impr = 0, p_clicks = 0, p_convs = 0, p_convValue = 0;
    rowsPrev.forEach(r => {
      p_cost      += microsToCurrency(r?.metrics?.costMicros);
      p_impr      += Number(r?.metrics?.impressions || 0);
      p_clicks    += Number(r?.metrics?.clicks || 0);
      p_convs     += Number(r?.metrics?.allConversions || 0);
      p_convValue += Number(r?.metrics?.allConversionsValue || 0);
    });

    /* --------------------- KPIs canónicos -------------------------- */
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? cost / clicks : 0;
    const cpa = conversions > 0 ? cost / conversions : 0;
    const roas = cost > 0 ? (conv_value / cost) : 0;

    const kpis = {
      impressions,
      clicks,
      cost,
      conversions,
      conv_value,
      ctr,
      cpc,
      cpa,
      roas,
    };

    const prev = {
      impressions: p_impr,
      clicks: p_clicks,
      cost: p_cost,
      conversions: p_convs,
      conv_value: p_convValue,
      ctr: p_impr > 0 ? p_clicks / p_impr : 0,
      cpc: p_clicks > 0 ? p_cost / p_clicks : 0,
      cpa: p_convs > 0 ? p_cost / p_convs : 0,
      roas: p_cost > 0 ? p_convValue / p_cost : 0,
    };

    /* --------------------- Deltas (proporciones) ------------------- */
    const deltas = {};
    for (const [k, v] of Object.entries(kpis)) {
      const curr = Number(v);
      const old  = Number(prev?.[k]);
      if (Number.isFinite(curr) && Number.isFinite(old)) {
        deltas[k] = old !== 0 ? (curr - old) / old : (curr !== 0 ? 1 : 0);
      }
    }

    res.json({
      ok: true,
      objective,
      customer_id: customerId,
      time_zone: timeZone,
      currency,                 // <- extra útil para el front
      locale: 'es-MX',          // <- si lo prefieres, puedes inferirlo del user
      range:      ranges.current,
      prev_range: ranges.previous,
      is_partial: ranges.is_partial,
      level: 'customer',
      kpis,
      deltas,
      series,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    const detail = err?.response?.data || err.message || String(err);
    console.error('google/ads insights error:', detail);
    const status = err?.response?.status || 500;
    res.status(status).json({ ok: false, error: 'GOOGLE_ADS_ERROR', detail });
  }
});

module.exports = router;
