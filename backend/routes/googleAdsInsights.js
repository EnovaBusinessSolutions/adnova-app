'use strict';

const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');

const router = express.Router();

/* =========================
 * Modelo GoogleAccount (fallback)
 * ========================= */
let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      accessToken: { type: String, select: false },
      refreshToken: { type: String, select: false },
      managerCustomerId: String,
      objective: String,
      customers: Array,
      defaultCustomerId: String,
    },
    { collection: 'googleaccounts', timestamps: true }
  );
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* =========================
 * ENV
 * ========================= */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
} = process.env;

/* =========================
 * Auth middleware
 * ========================= */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

/* =========================
 * OAuth helper
 * ========================= */
function oauth() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/* =========================
 * Date utils
 * ========================= */
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

function computeRanges(q) {
  const includeToday = String(q.include_today || '0') === '1';
  const compareMode = String(q.compare_mode || 'prev_period');

  const today = new Date();
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const anchor = includeToday ? base : addDays(base, -1);

  if (compareMode === 'prev_month') {
    const firstOfThisMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const current = { since: ymd(firstOfThisMonth), until: ymd(anchor) };

    const firstOfPrevMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1));
    const lastOfPrevMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 0));
    const previous = { since: ymd(firstOfPrevMonth), until: ymd(lastOfPrevMonth) };

    return { current, previous, is_partial: includeToday };
  }

  const preset = String(q.date_preset || '').toLowerCase();
  if (preset === 'today') {
    return {
      current: { since: ymd(anchor), until: ymd(anchor) },
      previous: { since: ymd(addDays(anchor, -1)), until: ymd(addDays(anchor, -1)) },
      is_partial: includeToday,
    };
  }
  if (preset === 'yesterday') {
    const y = addDays(anchor, -1);
    const yy = addDays(anchor, -2);
    return {
      current: { since: ymd(y), until: ymd(y) },
      previous: { since: ymd(yy), until: ymd(yy) },
      is_partial: false,
    };
  }

  let days = Number(q.range || 0);
  if (!Number.isFinite(days) || days <= 0) {
    days = preset === 'last_7d' ? 7 : preset === 'last_14d' ? 14 : preset === 'last_28d' ? 28 : 30;
  }

  const currUntil = anchor;
  const currSince = addDays(currUntil, -(days - 1));
  const prevUntil = addDays(currSince, -1);
  const prevSince = addDays(prevUntil, -(days - 1));

  return {
    current: { since: ymd(currSince), until: ymd(currUntil) },
    previous: { since: ymd(prevSince), until: ymd(prevUntil) },
    is_partial: includeToday,
  };
}

/* =========================
 * Google Ads helpers
 * ========================= */
const microsToCurrency = (m) => {
  const n = Number(m);
  return Number.isFinite(n) ? n / 1e6 : 0;
};

async function getFreshAccessToken(gaDoc) {
  // Si ya tenemos accessToken reciente, úsalo
  if (gaDoc.accessToken && gaDoc.accessToken.length > 10) return gaDoc.accessToken;

  const client = oauth();
  client.setCredentials({
    refresh_token: gaDoc.refreshToken || undefined,
    access_token: gaDoc.accessToken || undefined,
  });

  // Intenta primero getAccessToken (refresca si es necesario)
  try {
    const t = await client.getAccessToken();
    if (t?.token) return t.token;
  } catch {}

  // Fallback explícito (algunas versiones): refreshAccessToken
  try {
    const { credentials } = await client.refreshAccessToken();
    return credentials.access_token || gaDoc.accessToken;
  } catch (_) {
    // Si no hay refresh token, intenta devolver el accessToken actual si existe
    if (gaDoc.accessToken) return gaDoc.accessToken;
    throw new Error('NO_ACCESS_OR_REFRESH_TOKEN');
  }
}

const customerList = (doc) => (Array.isArray(doc?.customers) ? doc.customers : []);

function resolveCustomerId(req, doc) {
  const q = String(req.query.account_id || req.query.customer_id || '')
    .replace(/^customers\//, '')
    .replace(/-/g, '')
    .trim();
  if (q) return q;

  if (doc?.defaultCustomerId) return String(doc.defaultCustomerId).replace(/-/g, '').trim();
  const list = customerList(doc);
  return list.length ? String(list[0].id || '').replace(/-/g, '').trim() : '';
}

function buildHeaders(accessToken, managerId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  const loginId = String(managerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '')
    .replace(/-/g, '')
    .trim();
  if (loginId) headers['login-customer-id'] = loginId;
  return headers;
}

async function runGAQL({ accessToken, customerId, gaql, managerId }) {
  const { data } = await axios.post(
    `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:search`,
    { query: gaql },
    { headers: buildHeaders(accessToken, managerId), timeout: 30000 }
  );
  return data?.results || [];
}

async function listAccessibleCustomers(accessToken, managerId) {
  const { data } = await axios.get(
    `https://googleads.googleapis.com/v16/customers:listAccessibleCustomers`,
    { headers: buildHeaders(accessToken, managerId), timeout: 20000 }
  );
  return (data?.resourceNames || []).map((rn) => rn.split('/')[1]).filter(Boolean);
}

/* =========================
 * Insights endpoint
 * ========================= */
router.get('/', requireAuth, async (req, res) => {
  try {
    const gaDoc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+refreshToken +accessToken objective defaultCustomerId managerCustomerId customers')
      .lean();

    if (!gaDoc?.refreshToken && !gaDoc?.accessToken) {
      return res.status(400).json({ ok: false, error: 'GOOGLE_NOT_CONNECTED' });
    }

    const rawObjective = String(req.query.objective || gaDoc.objective || 'ventas').toLowerCase();
    const objective = ['ventas', 'alcance', 'leads'].includes(rawObjective) ? rawObjective : 'ventas';

    const ranges = computeRanges(req.query);

    const customerId = resolveCustomerId(req, gaDoc);
    if (!customerId) return res.status(400).json({ ok: false, error: 'NO_CUSTOMER_ID' });

    const accessToken = await getFreshAccessToken(gaDoc);
    const managerId = gaDoc?.managerCustomerId;

    function buildGaqlByObjective(obj, since, until) {
      const FIELDS_COMMON = `
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      `;

      if (obj === 'leads') {
        const LEAD_CATS = `
          segments.conversion_action_category IN (
            LEAD, SUBMIT_LEAD_FORM, SIGN_UP, REQUEST_QUOTE, BOOK_APPOINTMENT, CONTACT
          )
        `;
        return `
          SELECT
            ${FIELDS_COMMON},
            metrics.conversions,
            metrics.conversions_value
          FROM customer
          WHERE ${LEAD_CATS}
            AND segments.date BETWEEN '${since}' AND '${until}'
          ORDER BY segments.date
        `;
      }

      if (obj === 'alcance') {
        return `
          SELECT
            ${FIELDS_COMMON}
          FROM customer
          WHERE segments.date BETWEEN '${since}' AND '${until}'
          ORDER BY segments.date
        `;
      }

      const SALES_CAT = `segments.conversion_action_category = PURCHASE`;
      return `
        SELECT
          ${FIELDS_COMMON},
          metrics.conversions,
          metrics.conversions_value
        FROM customer
        WHERE ${SALES_CAT}
          AND segments.date BETWEEN '${since}' AND '${until}'
        ORDER BY segments.date
      `;
    }

    const qCurr = buildGaqlByObjective(objective, ranges.current.since, ranges.current.until);
    const qPrev = buildGaqlByObjective(objective, ranges.previous.since, ranges.previous.until);

    const qMeta = `
      SELECT
        customer.currency_code,
        customer.time_zone
      FROM customer
      LIMIT 1
    `;

    const [rows, rowsPrev, metaRows] = await Promise.all([
      runGAQL({ accessToken, customerId, gaql: qCurr, managerId }),
      runGAQL({ accessToken, customerId, gaql: qPrev, managerId }),
      runGAQL({ accessToken, customerId, gaql: qMeta, managerId }).catch(() => []),
    ]);

    const meta0 = metaRows?.[0]?.customer || {};
    const currency =
      meta0?.currencyCode ||
      customerList(gaDoc).find((c) => String(c.id).replace(/-/g, '') === String(customerId))?.currencyCode ||
      'USD';
    const timeZone =
      meta0?.timeZone ||
      customerList(gaDoc).find((c) => String(c.id).replace(/-/g, '') === String(customerId))?.timeZone ||
      'America/Mexico_City';

    let cost = 0, impressions = 0, clicks = 0, conversions = 0, conv_value = 0;

    const series = rows.map((r) => {
      const _cost = microsToCurrency(r?.metrics?.costMicros);
      const _imp  = Number(r?.metrics?.impressions || 0);
      const _clk  = Number(r?.metrics?.clicks || 0);
      const _ac   = Number(r?.metrics?.conversions || 0);
      const _av   = Number(r?.metrics?.conversionsValue || 0);

      cost += _cost; impressions += _imp; clicks += _clk; conversions += _ac; conv_value += _av;

      return { date: r?.segments?.date, impressions: _imp, clicks: _clk, cost: _cost, conversions: _ac, conv_value: _av };
    });

    let p_cost = 0, p_impr = 0, p_clicks = 0, p_convs = 0, p_convValue = 0;
    rowsPrev.forEach((r) => {
      p_cost      += microsToCurrency(r?.metrics?.costMicros);
      p_impr      += Number(r?.metrics?.impressions || 0);
      p_clicks    += Number(r?.metrics?.clicks || 0);
      p_convs     += Number(r?.metrics?.conversions || 0);
      p_convValue += Number(r?.metrics?.conversionsValue || 0);
    });

    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? cost / clicks : 0;
    const roas = cost > 0 ? conv_value / cost : 0;
    const cpa  = conversions > 0 ? cost / conversions : 0;
    const cpm  = impressions > 0 ? cost / (impressions / 1000) : 0;
    const cvr  = clicks > 0 ? conversions / clicks : 0;

    let kpis;
    if (objective === 'alcance') {
      kpis = { impressions, clicks, ctr, cpc, cost, cpm };
    } else if (objective === 'leads') {
      kpis = { conversions, cpa, ctr, cpc, clicks, cost, cvr };
    } else {
      kpis = { conv_value, conversions, roas, cpa, ctr, cpc, clicks, cost };
    }

    let prev;
    if (objective === 'alcance') {
      prev = {
        impressions: p_impr, clicks: p_clicks, cost: p_cost,
        ctr: p_impr > 0 ? p_clicks / p_impr : 0,
        cpc: p_clicks > 0 ? p_cost / p_clicks : 0,
        cpm: p_impr > 0 ? p_cost / (p_impr / 1000) : 0,
      };
    } else if (objective === 'leads') {
      prev = {
        conversions: p_convs, cpa: p_convs > 0 ? p_cost / p_convs : 0,
        ctr: p_impr > 0 ? p_clicks / p_impr : 0,
        cpc: p_clicks > 0 ? p_cost / p_clicks : 0,
        clicks: p_clicks, cost: p_cost, cvr: p_clicks > 0 ? p_convs / p_clicks : 0,
      };
    } else {
      prev = {
        conv_value: p_convValue, conversions: p_convs, roas: p_cost > 0 ? p_convValue / p_cost : 0,
        cpa: p_convs > 0 ? p_cost / p_convs : 0,
        ctr: p_impr > 0 ? p_clicks / p_impr : 0,
        cpc: p_clicks > 0 ? p_cost / p_clicks : 0,
        clicks: p_clicks, cost: p_cost,
      };
    }

    const deltas = {};
    for (const [k, v] of Object.entries(kpis)) {
      const curr = Number(v);
      const old  = Number(prev?.[k]);
      if (Number.isFinite(curr) && Number.isFinite(old)) {
        deltas[k] = old !== 0 ? (curr - old) / old : curr !== 0 ? 1 : 0;
      }
    }

    res.json({
      ok: true,
      objective,
      customer_id: customerId,
      time_zone: timeZone,
      currency,
      locale: 'es-MX',
      range: ranges.current,
      prev_range: ranges.previous,
      is_partial: ranges.is_partial,
      level: 'customer',
      kpis, deltas, series,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || err.message || String(err);
    console.error('google/ads insights error:', detail);
    res.status(status).json({ ok: false, error: 'GOOGLE_ADS_ERROR', detail });
  }
});

/* =========================
 * Accounts endpoint (para dropdown)
 * ========================= */
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+refreshToken +accessToken managerCustomerId defaultCustomerId customers')
      .lean();

    if (!ga || (!ga.refreshToken && !ga.accessToken)) {
      return res.json({ ok: true, accounts: [], defaultCustomerId: null });
    }

    let metas = Array.isArray(ga.customers) ? ga.customers : [];

    if (!metas.length) {
      try {
        const accessToken = await getFreshAccessToken(ga);
        let ids = [];
        try {
          ids = await listAccessibleCustomers(accessToken, ga.managerCustomerId);
        } catch {
          ids = (ga.customers || []).map((c) => String(c.id));
        }

        metas = [];
        for (const id of ids) {
          try {
            const rows = await runGAQL({
              accessToken,
              customerId: id.replace(/^customers\//, '').replace(/-/g, ''),
              managerId: ga.managerCustomerId,
              gaql: `
                SELECT
                  customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status
                FROM customer
                LIMIT 1
              `
            });
            const r = rows?.[0];
            metas.push({
              id: id.replace(/^customers\//, '').replace(/-/g, ''),
              descriptiveName: r?.customer?.descriptiveName || `Customer ${id}`,
              currencyCode: r?.customer?.currencyCode || null,
              timeZone: r?.customer?.timeZone || null,
              status: r?.customer?.status || null,
            });
          } catch {
            metas.push({ id: id.replace(/^customers\//, '').replace(/-/g, ''), descriptiveName: `Customer ${id}` });
          }
        }

        await GoogleAccount.updateOne(
          { $or: [{ user: req.user._id }, { userId: req.user._id }] },
          { $set: { customers: metas } }
        );
      } catch (_) {}
    }

    const accounts = (metas || [])
      .map((a) => ({
        id: String(a.id || '').replace(/^customers\//, '').replace(/-/g, '').trim(),
        name: a.name || a.descriptiveName || null,
        currency: a.currency || a.currencyCode || null,
        timezone: a.timezone || a.timeZone || null,
        status: a.status || null,
      }))
      .filter((a) => a.id);

    const defaultCustomerId = (ga.defaultCustomerId || accounts[0]?.id || null);

    return res.json({ ok: true, accounts, defaultCustomerId });
  } catch (err) {
    console.error('google/ads/accounts error:', err?.response?.data || err);
    res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

/* =========================
 * Customers (sin agregado de meta en DB)
 * ========================= */
router.get('/customers', requireAuth, async (req, res) => {
  try {
    const ga = await GoogleAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+refreshToken +accessToken managerCustomerId defaultCustomerId customers')
      .lean();

    if (!ga || (!ga.refreshToken && !ga.accessToken)) {
      return res.json({ ok: true, connected: false, customers: [] });
    }

    const accessToken = await getFreshAccessToken(ga);

    let ids = [];
    try {
      ids = await listAccessibleCustomers(accessToken, ga.managerCustomerId);
    } catch {
      ids = (ga.customers || []).map((c) => String(c.id));
    }

    const metas = [];
    for (const id of ids) {
      try {
        const rows = await runGAQL({
          accessToken,
          customerId: id.replace(/^customers\//, '').replace(/-/g, ''),
          managerId: ga.managerCustomerId,
          gaql: `
            SELECT
              customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone
            FROM customer
            LIMIT 1
          `
        });
        const r = rows?.[0];
        metas.push({
          id: id.replace(/^customers\//, '').replace(/-/g, ''),
          descriptiveName: r?.customer?.descriptiveName || `Customer ${id}`,
          currencyCode: r?.customer?.currencyCode || null,
          timeZone: r?.customer?.timeZone || null,
        });
      } catch {
        metas.push({ id: id.replace(/^customers\//, '').replace(/-/g, ''), descriptiveName: `Customer ${id}` });
      }
    }

    await GoogleAccount.updateOne(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { customers: metas } }
    );

    res.json({
      ok: true,
      connected: true,
      defaultCustomerId: ga.defaultCustomerId || null,
      customers: metas
    });
  } catch (err) {
    console.error('google/ads/customers error:', err?.response?.data || err);
    res.status(500).json({ ok: false, error: 'CUSTOMERS_ERROR' });
  }
});

/* =========================
 * Set default
 * ========================= */
router.post('/default', requireAuth, express.json(), async (req, res) => {
  try {
    const customerId = String(req.body?.customerId || '').replace(/^customers\//, '').replace(/-/g, '').trim();
    if (!customerId) return res.status(400).json({ ok: false, error: 'CUSTOMER_REQUIRED' });

    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultCustomerId: customerId } },
      { upsert: true }
    );
    res.json({ ok: true, defaultCustomerId: customerId });
  } catch (err) {
    console.error('google/ads/default error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_ERROR' });
  }
});

module.exports = router;
