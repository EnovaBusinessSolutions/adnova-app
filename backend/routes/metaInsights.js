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

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function computeCompareRanges(q) {
  // Convertimos cualquier preset/range a dos time_range: actual y anterior
  const now = new Date(); now.setHours(0,0,0,0);

  // 1) Determinar días (si viene preset conocido)
  const preset = String(q.date_preset || '').toLowerCase();
  const rangeDays = (() => {
    if (q.range) return parseRangeDays(q.range);
    if (preset === 'last_90d') return 90;
    if (preset === 'last_28d') return 28;
    if (preset === 'last_14d') return 14;
    if (preset === 'last_7d')  return 7;
    if (preset === 'last_3d')  return 3;
    if (preset === 'this_month' || preset === 'last_month') {
      // usamos meses completos
      const end = new Date(now); end.setDate(1); end.setHours(0,0,0,0); // inicio de mes actual
      if (preset === 'last_month') end.setMonth(end.getMonth()); // ya es inicio de mes actual
      const start = new Date(end); start.setMonth(end.getMonth() - 1);
      const prevEnd = new Date(start); prevEnd.setDate(0); // último día del mes previo
      const prevStart = new Date(start); prevStart.setDate(1);
      return {
        current: { since: ymd(start), until: ymd(addDays(end,-1)) },
        previous:{ since: ymd(prevStart), until: ymd(prevEnd) },
        days: null,
      };
    }
    return 30; // default
  })();

  if (typeof rangeDays === 'object' && rangeDays.current) return rangeDays;

  // 2) Para presets tipo last_Xd o range días, usamos ventanas móviles de N días
  const days = typeof rangeDays === 'number' ? rangeDays : 30;
  const currUntil = now;                          // hoy
  const currSince = addDays(currUntil, -(days-1));
  const prevUntil = addDays(currSince, -1);
  const prevSince = addDays(prevUntil, -(days-1));

  return {
    current : { since: ymd(currSince), until: ymd(currUntil) },
    previous: { since: ymd(prevSince), until: ymd(prevUntil) },
    days
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

function kpisLeads({ spend, clicks, impressions, actions }) {
  const LEAD_KEYS = [
    'lead',
    'omni_lead',
    'offsite_conversion.fb_pixel_lead',
    'onsite_conversion.lead_grouped',
  ];
  const leads = sumActions(actions, LEAD_KEYS);
  const cpl = leads > 0 ? spend / leads : 0;
  const cvr = clicks > 0 ? leads / clicks : 0;
   const ctr = impressions > 0 ? clicks / impressions : 0;
   return { leads, cpl, cvr, ctr, gastoTotal: spend, clics: clicks };
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

     // Fechas actuales y periodo anterior para comparación
     const cmp = computeCompareRanges(req.query);

    // Level (account por defecto)
    const levelQ = String(req.query.level || '').toLowerCase();
    const level = ALLOWED_LEVELS.has(levelQ) ? levelQ : 'account';

    // 1) Actual
     const rows = await fetchInsights({
      accountId,
      accessToken,
      fields: INSIGHT_FIELDS,
      level,
      dateParams: {
        datePresetMode: false,
        time_range: JSON.stringify({ since: cmp.current.since, until: cmp.current.until })
      },
    });

     // 2) Periodo anterior
      const rowsPrev = await fetchInsights({
        accountId,
        accessToken,
        fields: INSIGHT_FIELDS,
        level,
        dateParams: {
        datePresetMode: false,
       time_range: JSON.stringify({ since: cmp.previous.since, until: cmp.previous.until })
      },
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

    // Agregados (previo)
    let p_spend = 0, p_impressions = 0, p_reach = 0, p_clicks = 0, p_purchases = 0, p_revenue = 0;
    rowsPrev.forEach((r) => {
      p_spend       += Number(r.spend || 0);
      p_impressions += Number(r.impressions || 0);
      p_reach       += Number(r.reach || 0);
      p_clicks      += Number(r.clicks || 0);
      p_purchases   += sumActions(r.actions, PURCHASE_KEYS);
      p_revenue     += sumActionValues(r.action_values, PURCHASE_VALUE_KEYS);
    });
    // KPIs por objetivo
    let kpis;
    if (objective === 'alcance') {
      kpis = kpisAlcance({ spend, impressions, reach, clicks });
    } else if (objective === 'leads') {
      const allActions = rows.flatMap((r) => (Array.isArray(r.actions) ? r.actions : []));
      kpis = kpisLeads({ spend, clicks, impressions, actions: allActions });
    } else {
      // ventas
      kpis = kpisVentas({ spend, clicks, impressions, revenue, purchases });
    }

    // KPIs previos (mismo builder) para calcular deltas
    let prevKpis;
    if (objective === 'alcance') {
      prevKpis = kpisAlcance({ spend: p_spend, impressions: p_impressions, reach: p_reach, clicks: p_clicks });
    } else if (objective === 'leads') {
      const prevActions = rowsPrev.flatMap((r) => (Array.isArray(r.actions) ? r.actions : []));
      prevKpis = kpisLeads({ spend: p_spend, clicks: p_clicks, impressions: p_impressions, actions: prevActions });
    } else {
      prevKpis = kpisVentas({ spend: p_spend, clicks: p_clicks, impressions: p_impressions, revenue: p_revenue, purchases: p_purchases });
    }

    // Deltas (% vs periodo anterior)
    const deltas = {};
    for (const [k, v] of Object.entries(kpis)) {
      const curr = Number(v);
      const prev = Number(prevKpis?.[k]);
      if (Number.isFinite(curr) && Number.isFinite(prev)) {
        deltas[k] = prev !== 0 ? (curr - prev) / prev : (curr !== 0 ? 1 : 0);
      }
    }
    return res.json({
      ok: true,
      objective,
      account_id: accountId,
      range: { since: cmp.current.since, until: cmp.current.until },
      prev_range: { since: cmp.previous.since, until: cmp.previous.until },
      level,
      kpis,
      deltas,
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

// Lista de Ad Accounts del usuario conectado
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const metaAcc = await MetaAccount.findOne({ user: req.user._id }).lean();
    if (!metaAcc || !Array.isArray(metaAcc.ad_accounts)) {
      return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });
    }

    const accounts = metaAcc.ad_accounts.map((a) => {
      const raw = String(a.id || a.account_id || '').replace(/^act_/, '');
      return {
        id: raw, // sin "act_"
        label: a.name || a.account_name || `act_${raw}`,
        currency: a.currency || a.account_currency || null,
        status: a.account_status ?? null,
      };
    });

    return res.json({
      ok: true,
      defaultAccountId:
        accounts.length ? accounts[0].id : null,
      accounts,
    });
  } catch (e) {
    console.error('meta/insights/accounts error:', e);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

// GET /api/meta/insights/accounts
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount.findOne({ user: req.user._id }).lean();
    if (!doc) {
      return res.status(400).json({ ok:false, error:'META_NOT_CONNECTED' });
    }
    const list = Array.isArray(doc.ad_accounts) ? doc.ad_accounts : [];
    const parsed = list.map((a) => {
      const rawId = String(a.id || a.account_id || '').replace(/^act_/, '');
      return {
        id: rawId,
        account_id: rawId,
        name: a.name || a.account_name || rawId,
      };
    });
    // default: primera cuenta
    const defaultAccountId = parsed[0]?.account_id;
    return res.json({ ok:true, accounts: parsed, defaultAccountId });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'ACCOUNTS_FAIL', detail:String(e) });
  }
});

module.exports = router;
