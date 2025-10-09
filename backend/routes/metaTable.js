'use strict';
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();

const User = require('../models/User');
let MetaAccount = null;
try { MetaAccount = require('../models/MetaAccount'); } catch (_) {}

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';

/* ------------------------- helpers ------------------------- */
const normActId = (s = '') => s.toString().replace(/^act_/, '').trim();
const toActId   = (s = '') => (s ? `act_${normActId(s)}` : '');
const makeAppSecretProof = (accessToken) =>
  APP_SECRET ? crypto.createHmac('sha256', APP_SECRET).update(accessToken).digest('hex') : null;

async function getMetaAuth(req) {
  if (MetaAccount) {
    const doc = await MetaAccount
      .findOne({ $or: [{ userId: req.user._id }, { user: req.user._id }] })
      .select('+longLivedToken +longlivedToken +access_token +token ad_accounts adAccounts defaultAccountId objective')
      .lean();
    const token = doc?.longLivedToken || doc?.longlivedToken || doc?.access_token || doc?.token;
    const accounts = doc?.ad_accounts || doc?.adAccounts || [];
    const defaultAccountId = doc?.defaultAccountId || accounts?.[0]?.account_id || null;
    const objective = (doc?.objective || 'ventas').toLowerCase();
    return { token, defaultAccountId, objective };
  } else {
    const u = await User.findById(req.user._id).lean();
    return {
      token: u?.metaAccessToken || null,
      defaultAccountId: u?.metaDefaultAccountId || null,
      objective: (u?.metaObjective || 'ventas').toLowerCase()
    };
  }
}

/** Campos por objetivo (con modo mínimo para retry 400) */
function fieldsFor(objective, minimal = false) {
  const base = [
    'account_id','account_name',
    'campaign_id','campaign_name',
    'adset_id','adset_name',
    'ad_id','ad_name',
    'spend','impressions','clicks','reach','frequency','cpm','cpc','ctr',
    // ✅ clics de enlace válidos para insights
    'inline_link_clicks'
  ];
  if (!minimal) {
    // Para LPV/CPL/CPA necesitamos actions + cost_per_action_type
    base.push('actions','cost_per_action_type');
  }
  return base.join(',');
}

/* ------------------ util de paginación genérica ------------------ */
async function fetchAllPaged(url, baseParams, { timeout = 30000 } = {}) {
  let results = [];
  let params = { ...baseParams };
  if (!('limit' in params)) params.limit = 500;

  for (let i = 0; i < 50; i++) {
    const { data } = await axios.get(url, { params, timeout });
    const chunk = Array.isArray(data?.data) ? data.data : [];
    results = results.concat(chunk);
    const after = data?.paging?.cursors?.after;
    if (!after) break;
    params.after = after;
  }
  return results;
}

/** Insights paginados (todo el rango de una sola vez) */
async function fetchAllInsights({ accountId, token, level, objective, date_preset, since, until, minimal = false, appsecret_proof }) {
  const fields = fieldsFor(objective, minimal);
  const url = `${FB_GRAPH}/${toActId(accountId)}/insights`;
  const params = {
    level,
    fields,
    time_increment: 'all_days',
    action_report_time: 'conversion',
    access_token: token,
    ...(appsecret_proof ? { appsecret_proof } : {})
  };
  if (date_preset) params.date_preset = date_preset;
  else if (since && until) params.time_range = JSON.stringify({ since, until });
  return await fetchAllPaged(url, params);
}

/** Listado completo + estado + presupuesto + fechas por nivel */
async function fetchEntitiesWithStatus({ accountId, token, level, appsecret_proof }) {
  const edge =
    level === 'campaign' ? 'campaigns' :
    level === 'adset'    ? 'adsets'    : 'ads';

  const fields =
    level === 'campaign'
      ? 'id,name,status,effective_status,configured_status,start_time,stop_time,lifetime_budget'
      : level === 'adset'
        ? 'id,name,status,effective_status,configured_status,start_time,stop_time,daily_budget,lifetime_budget'
        : 'id,name,status,effective_status,configured_status';

  const url = `${FB_GRAPH}/${toActId(accountId)}/${edge}`;
  const params = {
    fields,
    access_token: token,
    ...(appsecret_proof ? { appsecret_proof } : {})
  };
  return await fetchAllPaged(url, params);
}

/* --------------------------- endpoint --------------------------- */
router.get('/table', async (req, res) => {
  try {
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res.status(401).json({ error: 'not_authenticated', rows: [], total: 0, page: 1, page_size: 25 });
    }

    const { token, defaultAccountId, objective: storedObj } = await getMetaAuth(req);
    if (!token) return res.status(400).json({ error: 'no_token', rows: [], total: 0, page: 1, page_size: 25 });

    const accountId = normActId(req.query.account_id || defaultAccountId);
    if (!accountId) return res.status(400).json({ error: 'no_account', rows: [], total: 0, page: 1, page_size: 25 });

    const level = (req.query.level || 'campaign').toLowerCase(); // campaign|adset|ad
    const objective = (req.query.objective || storedObj || 'ventas').toLowerCase();
    const date_preset = req.query.date_preset;
    const since = req.query.since;
    const until = req.query.until;
    const search = (req.query.search || '').toLowerCase();
    const sort   = req.query.sort || 'spend:desc';
    const page = Math.max(parseInt(req.query.page || '1',10), 1);
    const page_size = Math.min(Math.max(parseInt(req.query.page_size || '25',10), 1), 200);
    const only_active = req.query.only_active === '1' || req.query.only_active === 'true';

    const appsecret_proof = makeAppSecretProof(token);

    // 1) Universo completo de entidades con su estado/presupuesto
    const entities = await fetchEntitiesWithStatus({ accountId, token, level, appsecret_proof });

    const base = new Map();
    for (const e of entities) {
      const budget =
        e.daily_budget != null ? Number(e.daily_budget || 0) :
        e.lifetime_budget != null ? Number(e.lifetime_budget || 0) : 0;

      base.set(e.id, {
        id: e.id,
        name: e.name || '',
        campaign_id: level === 'campaign' ? e.id : undefined,
        adset_id:    level === 'adset'    ? e.id : undefined,
        ad_id:       level === 'ad'       ? e.id : undefined,
        account_id: accountId,
        account_name: undefined,
        impressions: 0, clicks: 0, reach: 0, frequency: 0,
        spend: 0, cpm: 0, cpc: 0, ctr: 0,
        link_clicks: 0,
        landing_page_views: 0,
        cost_per_lpv: null,
        results: 0,
        cost_per_result: null,
        status: e.status || null,
        effective_status: e.effective_status || null,
        budget,
        start_time: e.start_time || null,
        stop_time: e.stop_time || null,
      });
    }

    // 2) Insights (con retry minimal si un campo cae en 400)
    let raw = [];
    try {
      raw = await fetchAllInsights({ accountId, token, level, objective, date_preset, since, until, minimal: false, appsecret_proof });
    } catch (e) {
      const g = e?.response?.data;
      const status = e?.response?.status;
      const code = g?.error?.code;
      const message = g?.error?.message || e.message;
      if ((status === 400 && code === 100) || /Invalid parameter|Unknown field|Tried accessing/i.test(message || '')) {
        raw = await fetchAllInsights({ accountId, token, level, objective, date_preset, since, until, minimal: true, appsecret_proof });
      } else {
        const st = (code === 190) ? 401 : status || 400;
        return res.status(st).json({ error: message, details: g || message, rows: [], total: 0, page: 1, page_size });
      }
    }

    // 3) Merge insights -> base
    const keyFor  = (r) => (level === 'campaign') ? r.campaign_id : (level === 'adset') ? r.adset_id : r.ad_id;
    const getAction = (arr = [], types = []) =>
      Number((arr.find(a => types.includes(a?.action_type)) || {}).value || 0);

    for (const r of raw) {
      const id = keyFor(r);
      if (!id) continue;

      if (!base.has(id)) {
        base.set(id, {
          id,
          name: (level === 'campaign') ? r.campaign_name : (level === 'adset') ? r.adset_name : r.ad_name,
          campaign_id: r.campaign_id, adset_id: r.adset_id, ad_id: r.ad_id,
          account_id: r.account_id, account_name: r.account_name,
          impressions: 0, clicks: 0, reach: 0, frequency: 0,
          spend: 0, cpm: 0, cpc: 0, ctr: 0,
          link_clicks: 0, landing_page_views: 0, cost_per_lpv: null,
          results: 0, cost_per_result: null,
          status: null, effective_status: null,
          budget: 0, start_time: null, stop_time: null
        });
      }

      const cur = base.get(id);
      cur.name = cur.name || ((level === 'campaign') ? r.campaign_name : (level === 'adset') ? r.adset_name : r.ad_name);

      cur.impressions += Number(r.impressions || 0);
      cur.clicks      += Number(r.clicks || 0);
      cur.reach        = Math.max(Number(cur.reach || 0), Number(r.reach || 0));
      cur.spend       += Number(r.spend || 0);

      // ✅ usar inline_link_clicks
      cur.link_clicks += Number(r.inline_link_clicks || 0);

      // LPV desde actions
      const lpv = getAction(r.actions || [], ['landing_page_view']);
      cur.landing_page_views += lpv;

      // derivadas
      cur.cpm = cur.impressions > 0 ? (cur.spend / (cur.impressions / 1000)) : 0;
      cur.cpc = cur.clicks > 0 ? (cur.spend / cur.clicks) : 0;
      cur.ctr = cur.impressions > 0 ? ((cur.clicks / cur.impressions) * 100) : 0;
      cur.cost_per_lpv = cur.landing_page_views > 0 ? (cur.spend / cur.landing_page_views) : null;

      // resultados según objetivo
      if (objective === 'leads') {
        const leads = getAction(r.actions || [], ['lead','onsite_conversion.lead_grouped']);
        cur.results += leads;
        const cpl = getAction(r.cost_per_action_type || [], ['lead','onsite_conversion.lead_grouped']);
        cur.cost_per_result = cpl || (cur.results > 0 ? (cur.spend / cur.results) : null);
      } else if (objective === 'alcance' || objective === 'reach') {
        cur.results = Number(cur.reach || 0);
        cur.cost_per_result = cur.results > 0 ? (cur.spend / cur.results) : null;
      } else {
        const purchases = getAction(r.actions || [], ['purchase']);
        cur.results += purchases;
        const cpa = getAction(r.cost_per_action_type || [], ['purchase']);
        cur.cost_per_result = cpa || (cur.results > 0 ? (cur.spend / cur.results) : null);
      }
    }

    // 4) A arreglo + filtros
    let rowsAll = [...base.values()];
    if (only_active) rowsAll = rowsAll.filter(r => (r.effective_status || '').toUpperCase() === 'ACTIVE');
    if (search) rowsAll = rowsAll.filter(r => (r.name || '').toLowerCase().includes(search));

    // 5) Orden
    const [sField, sDir='desc'] = String(sort).split(':');
    const mul = sDir === 'asc' ? 1 : -1;
    rowsAll.sort((a, b) => {
      const va = (a[sField] ?? 0);
      const vb = (b[sField] ?? 0);
      const na = Number(va);
      const nb = Number(vb);
      return ((isNaN(na) ? 0 : na) - (isNaN(nb) ? 0 : nb)) * mul;
    });

    // 6) Paginado
    const total = rowsAll.length;
    const start = (page - 1) * page_size;
    const paged = rowsAll.slice(start, start + page_size);

    return res.json({ account_id: accountId, level, objective, total, page, page_size, rows: paged });
  } catch (err) {
    const g = err?.response?.data;
    const status = err?.response?.status || 500;
    console.error('meta/table fatal error:', g || err.message);
    return res.status(status).json({
      error: g?.error?.message || err.message || 'meta_table_failed',
      details: g || err.message,
      rows: [], total: 0, page: 1, page_size: 25
    });
  }
});

module.exports = router;
