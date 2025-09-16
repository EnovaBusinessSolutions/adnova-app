// backend/routes/metaInsights.js
'use strict';

const express  = require('express');
const axios    = require('axios');
const crypto   = require('crypto');
const mongoose = require('mongoose');

const router = express.Router();

/* =========
   CONFIG
   ========= */
const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

// Campos diarios que pedimos a Insights
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
const ALLOWED_LEVELS     = new Set(['account', 'campaign', 'adset', 'ad']);

/* =========
   MODELO MetaAccount (tolerante a tus campos reales)
   ========= */
let MetaAccount;
try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema } = mongoose;
  const schema = new Schema(
    {
      // Proyectos pueden guardar "user" o "userId"
      user:      { type: Schema.Types.ObjectId, ref: 'User' },
      userId:    { type: Schema.Types.ObjectId, ref: 'User' },

      // Token en snake o camel
      access_token:   { type: String, select: false },
      token:          { type: String, select: false },
      longlivedToken: { type: String, select: false },
      accessToken:    { type: String, select: false },
      longLivedToken: { type: String, select: false },

      // Cuentas en snake o camel
      ad_accounts:      Array,
      adAccounts:       Array,
      defaultAccountId: String,

      pages:            Array,
      scopes:           [String],
      objective:        String, // 'ventas' | 'alcance' | 'leads'
      email:            String,
      name:             String,
      expiresAt:        Date,
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
  // YYYY-MM-DD (UTC)
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  x.setUTCHours(0,0,0,0);
  return x;
}

/** Devuelve timezone_name de la Ad Account si está guardado; si no, fallback */
function getAccountTimezone(metaAcc, rawAccountId) {
  try {
    const arr = normalizeAccountsList(metaAcc);
    const found = arr.find(a => {
      const id = String(a?.id || a?.account_id || '').replace(/^act_/, '');
      return id === rawAccountId;
    });
    const tz = found?.timezone_name || found?.timezone || null;
    return tz || 'America/Mexico_City'; // fallback seguro
  } catch {
    return 'America/Mexico_City';
  }
}

/**
 * Inicio de día (00:00) en una zona horaria dada,
 * devuelto como Date en UTC que representa ese instante.
 */
function startOfDayTZ(timeZone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(date);
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const y = Number(obj.year);
  const m = Number(obj.month);
  const d = Number(obj.day);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

/** YYYY-MM-DD -> Date(00:00 TZ) en UTC; null si inválido */
function parseISODateInTZ(s, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3], 0, 0, 0));
  // normalizamos a 00:00 de esa fecha en la TZ objetivo
  return startOfDayTZ(timeZone, d);
}

/**
 * Convierte preset/range/day + include_today en dos time_range (actual y anterior),
 * usando la zona horaria de la cuenta.
 */
function computeCompareRangesTZ(q, timeZone) {
  const preset       = String(q.date_preset || '').toLowerCase();
  const includeToday = String(q.include_today || '0') === '1';
  const dayParam     = q.day ? parseISODateInTZ(q.day, timeZone) : null;

  // Día exacto por parámetro explícito (day=YYYY-MM-DD)
  if (dayParam) {
    const curr = { since: ymd(dayParam), until: ymd(dayParam) };
    const prev = { since: ymd(addDays(dayParam, -1)), until: ymd(addDays(dayParam, -1)) };
    return { current: curr, previous: prev, days: 1, is_partial: false };
  }

  // Presets de día
  if (preset === 'today') {
    const today00 = startOfDayTZ(timeZone, new Date());
    const curr = { since: ymd(today00), until: ymd(today00) };
    const prev = { since: ymd(addDays(today00, -1)), until: ymd(addDays(today00, -1)) };
    return { current: curr, previous: prev, days: 1, is_partial: true };
  }
  if (preset === 'yesterday') {
    const y00 = addDays(startOfDayTZ(timeZone, new Date()), -1);
    const curr = { since: ymd(y00), until: ymd(y00) };
    const prev = { since: ymd(addDays(y00, -1)), until: ymd(addDays(y00, -1)) };
    return { current: curr, previous: prev, days: 1, is_partial: false };
  }

  // Meses completos
  if (preset === 'this_month' || preset === 'last_month') {
    const today00 = startOfDayTZ(timeZone, new Date());
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year:'numeric', month:'2-digit' });
    const parts = fmt.formatToParts(today00);
    const obj   = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const y     = Number(obj.year);
    const m     = Number(obj.month);
    const startThisMonth = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    const startNextMonth = new Date(Date.UTC(y, m, 1, 0, 0, 0));
    const endThisMonth   = addDays(startNextMonth, -1);

    if (preset === 'this_month') {
      const curr = {
        since: ymd(startThisMonth),
        until: ymd(includeToday ? today00 : addDays(today00, -1))
      };
      const prevStart = new Date(Date.UTC(y, m - 2, 1, 0, 0, 0));
      const prevEnd   = addDays(startThisMonth, -1);
      const prev = { since: ymd(prevStart), until: ymd(prevEnd) };
      return { current: curr, previous: prev, days: null, is_partial: includeToday };
    } else {
      const curr = { since: ymd(startThisMonth), until: ymd(endThisMonth) };
      const prevStart = new Date(Date.UTC(y, m - 2, 1, 0, 0, 0));
      const prevEnd   = addDays(startThisMonth, -1);
      const prev = { since: ymd(prevStart), until: ymd(prevEnd) };
      return { current: curr, previous: prev, days: null, is_partial: false };
    }
  }

  // Ventanas deslizantes: last_Xd o range
  const days = (() => {
    if (q.range) return parseRangeDays(q.range);
    if (preset === 'last_90d') return 90;
    if (preset === 'last_60d') return 60;
    if (preset === 'last_28d') return 28;
    if (preset === 'last_14d') return 14;
    if (preset === 'last_7d')  return 7;
    if (preset === 'last_3d')  return 3;
    if (!preset || preset === 'last_30d') return 30;
    return 30;
  })();

  const anchor = includeToday
    ? startOfDayTZ(timeZone, new Date())               // hoy 00:00 TZ
    : addDays(startOfDayTZ(timeZone, new Date()), -1); // ayer 00:00 TZ

  const currUntil = anchor;
  const currSince = addDays(currUntil, -(days - 1));
  const prevUntil = addDays(currSince, -1);
  const prevSince = addDays(prevUntil, -(days - 1));

  return {
    current : { since: ymd(currSince), until: ymd(currUntil) },
    previous: { since: ymd(prevSince), until: ymd(prevUntil) },
    days,
    is_partial: includeToday
  };
}

/* =========
   Acciones helpers / prioridad para evitar doble conteo
   ========= */

// Prioridades para NO duplicar compras/ingresos
const PURCHASE_COUNT_PRIORITIES = [
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase',
  'purchase',
];

const PURCHASE_VALUE_PRIORITIES = [
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase',
  'purchase',
];

// Prioridades para leads
const LEAD_PRIORITIES = [
  'omni_lead',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb.pixel_lead',
  'onsite_conversion.lead_grouped',
  'lead',
];

// Devuelve el primer valor != 0 según prioridad
function pickFirstByPriority(items, priorities) {
  if (!Array.isArray(items)) return 0;
  for (const key of priorities) {
    const it = items.find(a => String(a?.action_type) === key);
    const v = Number(it?.value);
    if (Number.isFinite(v) && v !== 0) return v;
  }
  return 0;
}

/* === KPI builders === */
function kpisVentas({ spend, clicks, impressions, revenue, purchases }) {
  const roas = spend > 0 ? revenue / spend : 0;
  const cpa  = purchases > 0 ? spend / purchases : 0;
  const cvr  = clicks > 0 ? purchases / clicks : 0;
  const cpc  = clicks > 0 ? spend / clicks : 0;
  const ctr  = impressions > 0 ? clicks / impressions : 0;
  const aov  = purchases > 0 ? revenue / purchases : 0;

  return {
    ingresos: revenue,
    compras: purchases,
    valorPorCompra: aov,
    roas,
    cpa,
    cvr,
    ctr,
    gastoTotal: spend,
    cpc,
    clics: clicks,
    views: impressions,
    revenue, // compat. con gráfica
  };
}

function kpisAlcance({ spend, impressions, reach, clicks }) {
  const cpm        = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const ctr        = impressions > 0 ? clicks / impressions : 0;
  const frecuencia = reach > 0 ? impressions / reach : 0;
  return {
    reach,
    impressions,
    frecuencia,
    cpm,
    ctr,
    gastoTotal: spend,
    clics: clicks,
  };
}

function kpisLeads({ spend, clicks, impressions, leadsCount }) {
  const leads = Number(leadsCount || 0);
  const cpl   = leads > 0 ? spend / leads : 0;
  const cvr   = clicks > 0 ? leads / clicks : 0;
  const ctr   = impressions > 0 ? clicks / impressions : 0;
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
    limit: 5000,
    use_unified_attribution_setting: true,
    action_report_time: 'conversion',
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
    const next = data?.paging?.next;
    if (!next) break;
    url = next;
    params = undefined; // el "next" ya trae el querystring completo
    guards += 1;
  }

  return rows;
}

/* =========
   Helpers de MetaAccount
   ========= */
async function loadMetaAccount(userId){
  return await MetaAccount
    .findOne({ $or: [{ user: userId }, { userId }] })
    .select('+access_token +token +longlivedToken +accessToken +longLivedToken')
    .lean();
}

function normalizeAccountsList(metaAcc) {
  if (Array.isArray(metaAcc?.ad_accounts)) return metaAcc.ad_accounts;
  if (Array.isArray(metaAcc?.adAccounts))  return metaAcc.adAccounts;
  return [];
}

function resolveAccessToken(metaAcc, reqUser){
  return (
    metaAcc?.access_token ||
    metaAcc?.token ||
    metaAcc?.longlivedToken ||
    metaAcc?.accessToken ||
    metaAcc?.longLivedToken ||
    reqUser?.metaAccessToken ||
    null
  );
}

function resolveAccountId(req, metaAcc){
  const q = req.query?.account_id && String(req.query.account_id);
  const fromDefault = metaAcc?.defaultAccountId;
  const list = normalizeAccountsList(metaAcc);
  const fromList = list.length
    ? String(list[0].id || list[0].account_id || '').replace(/^act_/, '')
    : null;

  return (q || fromDefault || fromList || '').replace(/^act_/, '');
}

/* =========
   ENDPOINT PRINCIPAL
   ========= */
router.get('/', requireAuth, async (req, res) => {
  try {
    // Cuenta Meta del usuario (tolerante a user/userId y a distintos nombres de token)
    const metaAcc = await loadMetaAccount(req.user._id);
    if (!metaAcc) {
      return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });
    }

    const accessToken = resolveAccessToken(metaAcc, req.user);
    if (!accessToken) {
      return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });
    }

    // Objetivo
    const rq = String(req.query.objective || '').toLowerCase();
    const sv = String(metaAcc.objective || '').toLowerCase();
    const objective = ALLOWED_OBJECTIVES.has(rq) ? rq : (ALLOWED_OBJECTIVES.has(sv) ? sv : 'ventas');

    // Ad account (query -> defaultAccountId -> primer elemento del arreglo)
    const accountId = resolveAccountId(req, metaAcc);
    if (!accountId) {
      return res.status(400).json({ ok: false, error: 'NO_AD_ACCOUNT' });
    }

    // Zona horaria de la cuenta (o fallback)
    const timeZone = getAccountTimezone(metaAcc, accountId);

    // Rango actual y anterior (TZ-aware, con include_today opcional + day/yesterday)
    const cmp = computeCompareRangesTZ(req.query, timeZone);

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

    // Agregados actual
    let spend = 0, impressions = 0, reach = 0, clicks = 0, purchases = 0, revenue = 0, leadsCount = 0;

    const series = rows.map((r) => {
      const daySpend      = Number(r.spend || 0);
      const dayImp        = Number(r.impressions || 0);
      const dayReach      = Number(r.reach || 0);
      const dayClicks     = Number(r.clicks || 0);

      // ¡Sin doble conteo!
      const dayPurchases  = pickFirstByPriority(r.actions,       PURCHASE_COUNT_PRIORITIES);
      const dayRevenue    = pickFirstByPriority(r.action_values, PURCHASE_VALUE_PRIORITIES);
      const dayLeads      = pickFirstByPriority(r.actions,       LEAD_PRIORITIES);

      spend       += daySpend;
      impressions += dayImp;
      reach       += dayReach;
      clicks      += dayClicks;
      purchases   += dayPurchases;
      revenue     += dayRevenue;
      leadsCount  += dayLeads;

      return {
        date: r.date_start,
        spend: daySpend,
        impressions: dayImp,
        reach: dayReach,
        clicks: dayClicks,
        purchases: dayPurchases,
        revenue: dayRevenue,
        leads: dayLeads,
      };
    });

    // Agregados previo
    let p_spend = 0, p_impressions = 0, p_reach = 0, p_clicks = 0, p_purchases = 0, p_revenue = 0, p_leads = 0;
    rowsPrev.forEach((r) => {
      p_spend       += Number(r.spend || 0);
      p_impressions += Number(r.impressions || 0);
      p_reach       += Number(r.reach || 0);
      p_clicks      += Number(r.clicks || 0);

      // ¡Sin doble conteo!
      p_purchases   += pickFirstByPriority(r.actions,       PURCHASE_COUNT_PRIORITIES);
      p_revenue     += pickFirstByPriority(r.action_values, PURCHASE_VALUE_PRIORITIES);
      p_leads       += pickFirstByPriority(r.actions,       LEAD_PRIORITIES);
    });

    // KPIs actual
    let kpis;
    if (objective === 'alcance') {
      kpis = kpisAlcance({ spend, impressions, reach, clicks });
    } else if (objective === 'leads') {
      kpis = kpisLeads({ spend, clicks, impressions, leadsCount });
    } else {
      kpis = kpisVentas({ spend, clicks, impressions, revenue, purchases });
    }

    // KPIs previos
    let prevKpis;
    if (objective === 'alcance') {
      prevKpis = kpisAlcance({ spend: p_spend, impressions: p_impressions, reach: p_reach, clicks: p_clicks });
    } else if (objective === 'leads') {
      prevKpis = kpisLeads({ spend: p_spend, clicks: p_clicks, impressions: p_impressions, leadsCount: p_leads });
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
      time_zone: timeZone,
      range:      { since: cmp.current.since,  until: cmp.current.until },
      prev_range: { since: cmp.previous.since, until: cmp.previous.until },
      is_partial: !!cmp.is_partial,
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
    return res.status(status).json({ ok: false, error: 'META_INSIGHTS_ERROR', detail });
  }
});

/* =========
   ACCOUNTS (normalizado: id + name)
   ========= */
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const doc = await loadMetaAccount(req.user._id);
    if (!doc) return res.status(400).json({ ok:false, error:'META_NOT_CONNECTED' });

    const list = normalizeAccountsList(doc);
    const accounts = list.map((a) => {
      const raw = String(a.id || a.account_id || '').replace(/^act_/, '');
      return {
        id: raw,
        name: a.name || a.account_name || raw,
        currency: a.currency || a.account_currency || null,
        status: a.account_status ?? null,
        timezone_name: a.timezone_name || a.timezone || null,
      };
    });

    return res.json({
      ok: true,
      accounts,
      defaultAccountId: doc.defaultAccountId || accounts[0]?.id || null,
    });
  } catch (e) {
    console.error('meta/insights/accounts error:', e);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

module.exports = router;
