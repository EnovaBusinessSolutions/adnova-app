// backend/routes/metaInsights.js
'use strict';

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');

const router = express.Router();

/* =========
   CONFIG
   ========= */
const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

const INSIGHT_FIELDS = [
  'date_start',
  'date_stop',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'ctr',
  'cpc',
  'actions',
  'action_values',
].join(',');

const ALLOWED_OBJECTIVES = new Set(['ventas', 'alcance', 'leads']);
const ALLOWED_LEVELS = new Set(['account', 'campaign', 'adset', 'ad']);

/* =========
   MODELO MetaAccount (fallback si no existe el require real)
   ========= */
let MetaAccount;
try {
  MetaAccount = require('../models/MetaAccount'); // usa tu modelo real si existe
} catch {
  const { Schema } = mongoose;
  const schema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User' },
      access_token: { type: String, select: false }, // muchos modelos lo ocultan
      token: { type: String, select: false },
      expires_at: Date,
      fb_user_id: String,
      name: String,
      email: String,
      ad_accounts: Array,
      pages: Array,
      scopes: [String],
      objective: String,
    },
    { timestamps: true, collection: 'metaaccounts' }
  );
  MetaAccount = mongoose.models.MetaAccount || mongoose.model('MetaAccount', schema);
}

/* =========
   UTILS
   ========= */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function appSecretProof(accessToken) {
  if (!APP_SECRET) return undefined;
  return crypto.createHmac('sha256', APP_SECRET).update(accessToken).digest('hex');
}

function parseRangeDays(rangeParam) {
  const n = Number(rangeParam);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function resolveObjective(requested, saved) {
  const rq = String(requested || '').toLowerCase();
  if (ALLOWED_OBJECTIVES.has(rq)) return rq;
  const sv = String(saved || '').toLowerCase();
  if (ALLOWED_OBJECTIVES.has(sv)) return sv;
  return 'ventas';
}

// date_preset OR range
function resolveDateParams(q) {
  const preset = String(q.date_preset || '').toLowerCase();
  if (preset) {
    const allowed = new Set([
      'today',
      'yesterday',
      'last_3d',
      'last_7d',
      'last_14d',
      'last_28d',
      'last_30d',
      'last_90d',
      'this_month',
      'last_month',
    ]);
    return { datePresetMode: true, date_preset: allowed.has(preset) ? preset : 'last_30d' };
  }
  const days = parseRangeDays(q.range);
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return {
    datePresetMode: false,
    time_range: JSON.stringify({ since: ymd(start), until: ymd(end) }),
    days,
    since: ymd(start),
    until: ymd(end),
  };
}

// Acciones helpers
function sumActions(actions, keys) {
  if (!Array.isArray(actions) || !actions.length) return 0;
  const set = new Set(keys);
  return actions.reduce((acc, a) => {
    if (!a || !set.has(String(a.action_type))) return acc;
    const v = Number(a.value);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}

function sumActionValues(actionValues, keys) {
  if (!Array.isArray(actionValues) || !actionValues.length) return 0;
  const set = new Set(keys);
  return actionValues.reduce((acc, a) => {
    if (!a || !set.has(String(a.action_type))) return acc;
    const v = Number(a.value);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/* === KPI builders === */
function kpisVentas({ spend, clicks, impressions, revenue, purchases }) {
  const roas = spend > 0 ? revenue / spend : 0;
  const cpa = purchases > 0 ? spend / purchases : 0;
  const cvr = clicks > 0 ? purchases / clicks : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const aov = purchases > 0 ? revenue / purchases : 0;

  return {
    ingresos: revenue,
    compras: purchases,
    valorPorCompra: aov,
    roas,
    cpa,
    cvr,
    revenue,
    gastoTotal: spend,
    cpc,
    clics: clicks,
    ctr,
    views: impressions,
  };
}

function kpisAlcance({ spend, impressions, reach, clicks }) {
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const frecuencia = reach > 0 ? impressions / reach : 0;
  return { reach, impressions, frecuencia, cpm, ctr, gastoTotal: spend, clics: clicks };
}

function kpisLeads({ spend, clicks, actions }) {
  const LEAD_KEYS = [
    'lead',
    'omni_lead',
    'offsite_conversion.fb_pixel_lead',
    'onsite_conversion.lead_grouped',
  ];
  const leads = sumActions(actions, LEAD_KEYS);
  const cpl = leads > 0 ? spend / leads : 0;
  const cvr = clicks > 0 ? leads / clicks : 0;
  return { leads, cpl, cvr, gastoTotal: spend, clics: clicks };
}

/* =========
   FETCH con paginación
   ========= */
async function fetchInsights({ accountId, accessToken, fields, level, dateParams }) {
  const baseUrl = `${FB_GRAPH}/act_${accountId}/insights`;
  const baseParams = {
    access_token: accessToken,
    appsecret_proof: appSecretProof(accessToken),
    fields,
    level,
    time_increment: 1,
    limit: 5000, // grande para evitar demasiadas páginas
    ...(dateParams.datePresetMode
      ? { date_preset: dateParams.date_preset }
      : { time_range: dateParams.time_range }),
  };

  const rows = [];
  let url = baseUrl;
  let params = { ...baseParams };
  let guards = 0;

  while (url && guards < 10) {
    const { data } = await axios.get(url, { params });
    if (Array.isArray(data?.data)) rows.push(...data.data);

    // siguiente página
    const next = data?.paging?.next;
    if (!next) break;
    url = next;
    params = undefined; // al usar el next, ya viene con querystring completo
    guards += 1;
  }

  return rows;
}

/* =========
   ENDPOINT PRINCIPAL
   ========= */
// ACEPTA '/api/meta/insights' (porque en index.js montaste app.use('/api/meta/insights', router))
router.get('/', requireAuth, async (req, res) => {
  try {
    // Cuenta Meta del usuario (asegurando seleccionar el token aunque el modelo lo oculte)
    const metaAcc = await MetaAccount
      .findOne({ user: req.user._id })
      .select('+access_token +token')
      .lean();

    if (!metaAcc) {
      return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });
    }

    let accessToken = metaAcc.access_token || metaAcc.token || req.user?.metaAccessToken;
    if (!accessToken) {
      return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });
    }

    // Objetivo
    const objective = resolveObjective(req.query.objective, metaAcc.objective);

    // Ad account
    let accountId =
      (req.query.account_id && String(req.query.account_id)) ||
      (Array.isArray(metaAcc.ad_accounts) &&
        metaAcc.ad_accounts.length > 0 &&
        (metaAcc.ad_accounts[0].id || metaAcc.ad_accounts[0].account_id));

    if (!accountId) {
      return res.status(400).json({ ok: false, error: 'NO_AD_ACCOUNT' });
    }
    accountId = String(accountId);
    accountId = accountId.startsWith('act_') ? accountId.slice(4) : accountId;

    // Fechas (date_preset o range)
    const dateParams = resolveDateParams(req.query);

    // Level (account por defecto)
    const levelQ = String(req.query.level || '').toLowerCase();
    const level = ALLOWED_LEVELS.has(levelQ) ? levelQ : 'account';

    // Llamada a Graph con paginación
    const rows = await fetchInsights({
      accountId,
      accessToken,
      fields: INSIGHT_FIELDS,
      level,
      dateParams,
    });

    // Agregados
    let spend = 0;
    let impressions = 0;
    let reach = 0;
    let clicks = 0;
    let purchases = 0;
    let revenue = 0;

    const PURCHASE_KEYS = [
      'purchase',
      'omni_purchase',
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.purchase',
    ];
    const PURCHASE_VALUE_KEYS = [
      'omni_purchase',
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.purchase',
    ];

    const series = rows.map((r) => {
      const daySpend = Number(r.spend || 0);
      const dayImp = Number(r.impressions || 0);
      const dayReach = Number(r.reach || 0);
      const dayClicks = Number(r.clicks || 0);

      const dayPurchases = sumActions(r.actions, PURCHASE_KEYS);
      const dayRevenue = sumActionValues(r.action_values, PURCHASE_VALUE_KEYS);

      spend += daySpend;
      impressions += dayImp;
      reach += dayReach;
      clicks += dayClicks;
      purchases += dayPurchases;
      revenue += dayRevenue;

      return {
        date: r.date_start,
        spend: daySpend,
        impressions: dayImp,
        reach: dayReach,
        clicks: dayClicks,
        purchases: dayPurchases,
        revenue: dayRevenue,
      };
    });

    // KPIs por objetivo
    let kpis;
    if (objective === 'alcance') {
      kpis = kpisAlcance({ spend, impressions, reach, clicks });
    } else if (objective === 'leads') {
      const allActions = rows.flatMap((r) => (Array.isArray(r.actions) ? r.actions : []));
      kpis = kpisLeads({ spend, clicks, actions: allActions });
    } else {
      // ventas
      kpis = kpisVentas({ spend, clicks, impressions, revenue, purchases });
    }

    return res.json({
      ok: true,
      objective,
      account_id: accountId,
      range: dateParams.datePresetMode
        ? { preset: dateParams.date_preset }
        : { days: dateParams.days, since: dateParams.since, until: dateParams.until },
      level,
      kpis,
      series,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Log útil si expira token u otro error de Graph
    const detail = err?.response?.data || err?.message || String(err);
    console.error('meta/insights error:', detail);
    const status = err?.response?.status || 500;
    return res.status(status).json({
      ok: false,
      error: 'META_INSIGHTS_ERROR',
      detail,
    });
  }
});

/* =========
   DEBUG
   ========= */
router.get('/debug', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount
      .findOne({ user: req.user._id })
      .select('+access_token +token')
      .lean();

    return res.json({
      ok: true,
      user: String(req.user?._id || ''),
      found: !!doc,
      hasAccessToken: !!(doc && (doc.access_token || doc.token)),
      adAccounts: Array.isArray(doc?.ad_accounts) ? doc.ad_accounts.length : 0,
      objective: doc?.objective || null,
      collection: MetaAccount.collection?.name || null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'DEBUG_FAIL', detail: String(e) });
  }
});

module.exports = router;
