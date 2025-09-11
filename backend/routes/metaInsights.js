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

/* =========
   Fechas consistentes (excluyendo HOY)
   ========= */
function startOfDayUTC(d) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function addDaysUTC(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function toYMD(d) { return d.toISOString().slice(0,10); }

function presetDays(preset) {
  const map = {
    last_3d: 3,
    last_7d: 7,
    last_14d: 14,
    last_28d: 28,
    last_30d: 30,
    last_90d: 90,
  };
  return map[preset] || 30;
}

/** Últimos N días **excluyendo hoy** */
function makeLastNDaysRange(n) {
  const today = startOfDayUTC(new Date());
  const until = addDaysUTC(today, -1);              // ayer
  const since = addDaysUTC(until, -(n - 1));        // N días atrás
  return { since: toYMD(since), until: toYMD(until) };
}

/** Convierte query (preset o range) en dos ventanas: actual y anterior (mismo tamaño). */
function buildCompareWindows(q) {
  const preset = String(q.date_preset || '').toLowerCase();

  // Presets tipo "this_month" y "last_month"
  if (preset === 'this_month' || preset === 'last_month') {
    const today = startOfDayUTC(new Date());
    const firstOfThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const firstOfPrev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const endOfPrev   = addDaysUTC(firstOfThis, -1);

    if (preset === 'last_month') {
      // Mes anterior completo
      const prevStart = firstOfPrev;
      const prevEnd   = endOfPrev;
      // Para "actual", usamos el mes anterior al mes anterior (para la comparación)
      const prevPrevStart = new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth() - 1, 1));
      const prevPrevEnd   = addDaysUTC(firstOfPrev, -1);

      return {
        current : { since: toYMD(prevStart), until: toYMD(prevEnd) },
        previous: { since: toYMD(prevPrevStart), until: toYMD(prevPrevEnd) },
        days: null,
      };
    }

    // this_month: del 1 al día de ayer (excluyendo hoy)
    const thisMonthRange = { since: toYMD(firstOfThis), until: toYMD(addDaysUTC(today, -1)) };
    // ventana anterior de mismo número de días
    const days = Math.max(1, Math.floor((Date.parse(thisMonthRange.until) - Date.parse(thisMonthRange.since)) / 86400000) + 1);
    const prevEnd = addDaysUTC(new Date(thisMonthRange.since), -1);
    const prevStart = addDaysUTC(prevEnd, -(days - 1));
    return {
      current : thisMonthRange,
      previous: { since: toYMD(prevStart), until: toYMD(prevEnd) },
      days,
    };
  }

  // Presets tipo last_Xd o query param ?range=N
  const n = q.range ? parseRangeDays(q.range) : presetDays(preset || 'last_30d');
  const curr = makeLastNDaysRange(n);
  const prevEnd = addDaysUTC(new Date(curr.since), -1);
  const prevStart = addDaysUTC(prevEnd, -(n - 1));
  return {
    current : curr,
    previous: { since: toYMD(prevStart), until: toYMD(prevEnd) },
    days: n,
  };
}

/* =========
   Acciones helpers
   ========= */
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

    // Ventanas de comparación (excluyendo HOY)
    const win = buildCompareWindows(req.query);

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
        time_range: JSON.stringify({ since: win.current.since, until: win.current.until }),
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
        time_range: JSON.stringify({ since: win.previous.since, until: win.previous.until }),
      },
    });

    // Agregados actuales
    let spend = 0, impressions = 0, reach = 0, clicks = 0, purchases = 0, revenue = 0;

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

    // KPIs actuales
    let kpis;
    if (objective === 'alcance') {
      kpis = kpisAlcance({ spend, impressions, reach, clicks });
    } else if (objective === 'leads') {
      const allActions = rows.flatMap((r) => (Array.isArray(r.actions) ? r.actions : []));
      kpis = kpisLeads({ spend, clicks, impressions, actions: allActions });
    } else {
      kpis = kpisVentas({ spend, clicks, impressions, revenue, purchases });
    }

    // Agregados previos
    let p_spend = 0, p_impressions = 0, p_reach = 0, p_clicks = 0, p_purchases = 0, p_revenue = 0;
    rowsPrev.forEach((r) => {
      p_spend       += Number(r.spend || 0);
      p_impressions += Number(r.impressions || 0);
      p_reach       += Number(r.reach || 0);
      p_clicks      += Number(r.clicks || 0);
      p_purchases   += sumActions(r.actions, PURCHASE_KEYS);
      p_revenue     += sumActionValues(r.action_values, PURCHASE_VALUE_KEYS);
    });

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
    const pct = (cur, prev) => (Number.isFinite(prev) && prev !== 0) ? (cur - prev) / prev : null;
    let deltas = {};
    if (objective === 'alcance') {
      deltas = {
        reach:      pct(kpis.reach,       prevKpis.reach),
        impressions:pct(kpis.impressions, prevKpis.impressions),
        frecuencia: pct(kpis.frecuencia,  prevKpis.frecuencia),
        cpm:        pct(kpis.cpm,         prevKpis.cpm),
        ctr:        pct(kpis.ctr,         prevKpis.ctr),
        gastoTotal: pct(kpis.gastoTotal,  prevKpis.gastoTotal),
        clics:      pct(kpis.clics,       prevKpis.clics),
      };
    } else if (objective === 'leads') {
      deltas = {
        leads:      pct(kpis.leads,       prevKpis.leads),
        cpl:        pct(kpis.cpl,         prevKpis.cpl),
        cvr:        pct(kpis.cvr,         prevKpis.cvr),
        ctr:        pct(kpis.ctr,         prevKpis.ctr),
        gastoTotal: pct(kpis.gastoTotal,  prevKpis.gastoTotal),
        clics:      pct(kpis.clics,       prevKpis.clics),
      };
    } else {
      deltas = {
        revenue:    pct(kpis.revenue,     prevKpis.revenue),
        compras:    pct(kpis.compras,     prevKpis.compras),
        roas:       pct(kpis.roas,        prevKpis.roas),
        cpa:        pct(kpis.cpa,         prevKpis.cpa),
        cvr:        pct(kpis.cvr,         prevKpis.cvr),
        gastoTotal: pct(kpis.gastoTotal,  prevKpis.gastoTotal),
        cpc:        pct(kpis.cpc,         prevKpis.cpc),
        clics:      pct(kpis.clics,       prevKpis.clics),
        ctr:        pct(kpis.ctr,         prevKpis.ctr),
      };
    }
    // Limpia nulls
    Object.keys(deltas).forEach(k => { if (deltas[k] === null) delete deltas[k]; });

    return res.json({
      ok: true,
      objective,
      account_id: accountId,
      range: { since: win.current.since, until: win.current.until },
      prev_range: { since: win.previous.since, until: win.previous.until },
      level,
      kpis,
      deltas,
      series,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
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

/* =========
   Accounts (unificado)
   ========= */
// GET /api/meta/insights/accounts
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount.findOne({ user: req.user._id }).lean();
    if (!doc || !Array.isArray(doc.ad_accounts)) {
      return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });
    }
    const accounts = doc.ad_accounts.map((a) => {
      const raw = String(a.id || a.account_id || '').replace(/^act_/, '');
      return {
        id: raw,
        name: a.name || a.account_name || raw,
      };
    });
    return res.json({
      ok: true,
      accounts,
      defaultAccountId: accounts[0]?.id ?? null,
    });
  } catch (e) {
    console.error('meta/insights/accounts error:', e);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

module.exports = router;
