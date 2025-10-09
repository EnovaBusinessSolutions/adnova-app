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

/** Campos por objetivo (con modo mínimo para fallback de errores 400) */
function fieldsFor(objective, minimal = false) {
  const base = [
    'account_id','account_name',
    'campaign_id','campaign_name',
    'adset_id','adset_name',
    'ad_id','ad_name',
    'spend','impressions','clicks','reach','frequency','cpm','cpc','ctr'
  ];
  if (!minimal) {
    if (objective === 'leads') {
      base.push('actions','cost_per_action_type');
    } else if (objective === 'ventas') {
      // 'purchase_roas' suele causar 400; lo omitimos
      base.push('actions','cost_per_action_type');
    }
  }
  return base.join(',');
}

/** Llamada a /insights con parámetros correctos */
async function fetchInsights({ accountId, token, level, objective, date_preset, since, until, minimal = false, appsecret_proof }) {
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

  const { data } = await axios.get(url, { params, timeout: 25000 });
  return Array.isArray(data?.data) ? data.data : [];
}

/** === 1a: mapa de estados por entidad (campaña/adset/ad) ===
 * Devuelve { [id]: { status, effective_status, configured_status } }
 */
async function fetchStatusMap({ accountId, token, level, appsecret_proof }) {
  const endpoint =
    level === 'campaign' ? 'campaigns' :
    level === 'adset'    ? 'adsets'    : 'ads';

  const fields =
    level === 'campaign'
      ? 'id,status,effective_status,configured_status,start_time,stop_time'
      : level === 'adset'
        ? 'id,status,effective_status,daily_budget,lifetime_budget'
        : 'id,status,effective_status';

  const url = `${FB_GRAPH}/${toActId(accountId)}/${endpoint}`;
  const params = {
    fields,
    limit: 5000,
    access_token: token,
    ...(appsecret_proof ? { appsecret_proof } : {})
  };

  const { data } = await axios.get(url, { params, timeout: 25000 });
  const list = Array.isArray(data?.data) ? data.data : [];

  const map = {};
  for (const it of list) {
    const id = it?.id;
    if (!id) continue;
    map[id] = {
      status: it.status || null,
      effective_status: it.effective_status || null,
      configured_status: it.configured_status || null
    };
  }
  return map;
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

    // 1er intento: set completo
    let raw = [];
    try {
      raw = await fetchInsights({ accountId, token, level, objective, date_preset, since, until, minimal: false, appsecret_proof });
    } catch (e) {
      const g = e?.response?.data;
      const status = e?.response?.status;
      const code = g?.error?.code;
      const message = g?.error?.message || e.message;

      // Si es 400 (#100) por campo inválido, reintenta con set mínimo
      if ((status === 400 && code === 100) || /Invalid parameter|Unknown field|Tried accessing/i.test(message || '')) {
        try {
          raw = await fetchInsights({ accountId, token, level, objective, date_preset, since, until, minimal: true, appsecret_proof });
        } catch (e2) {
          const g2 = e2?.response?.data;
          const msg2 = g2?.error?.message || e2.message;
          const st2 = e2?.response?.status || 400;
          console.error('meta/table retry(minimal) error:', g2 || msg2);
          return res.status(st2).json({
            error: msg2, details: g2 || msg2,
            total: 0, page: 1, page_size: page_size, rows: []
          });
        }
      } else {
        // Otros errores (190 token inválido, 10 permissions, etc.)
        const st = (code === 190) ? 401 : status || 400;
        console.error('meta/table error:', g || message);
        return res.status(st).json({
          error: message, details: g || message,
          total: 0, page: 1, page_size: page_size, rows: []
        });
      }
    }

    // === 1b: leer mapa de estados para el nivel actual ===
    const statusMap = await fetchStatusMap({ accountId, token, level, appsecret_proof });

    // ---- Agrupar por entidad y normalizar ----
    const keyFor  = (r) => (level === 'campaign') ? r.campaign_id : (level === 'adset') ? r.adset_id : r.ad_id;
    const nameFor = (r) => (level === 'campaign') ? r.campaign_name : (level === 'adset') ? r.adset_name : r.ad_name;

    const map = new Map();
    for (const r of raw) {
      const k = keyFor(r); if (!k) continue;
      const cur = map.get(k) || {
        id: k, name: nameFor(r),
        campaign_id: r.campaign_id, adset_id: r.adset_id, ad_id: r.ad_id,
        account_id: r.account_id, account_name: r.account_name,
        impressions: 0, clicks: 0, reach: 0, frequency: 0, spend: 0,
        actions: [], cost_per_action_type: []
      };
      cur.impressions += Number(r.impressions || 0);
      cur.clicks      += Number(r.clicks || 0);
      cur.reach        = Math.max(Number(cur.reach || 0), Number(r.reach || 0)); // aprox reach único
      cur.spend       += Number(r.spend || 0);
      if (Array.isArray(r.actions)) cur.actions = cur.actions.concat(r.actions);
      if (Array.isArray(r.cost_per_action_type)) cur.cost_per_action_type = cur.cost_per_action_type.concat(r.cost_per_action_type);
      map.set(k, cur);
    }

    let rowsAll = [...map.values()].map(r => {
      const impressions = r.impressions;
      const clicks = r.clicks;
      const spend = r.spend;
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpm = impressions > 0 ? (spend / (impressions / 1000)) : 0;
      const cpc = clicks > 0 ? (spend / clicks) : 0;

      let results = 0, cost_per_result = null, roas = null;
      if (objective === 'leads') {
        const leads = (r.actions || []).find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
        results = leads ? Number(leads.value || 0) : 0;
        const cpl = (r.cost_per_action_type || []).find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
        cost_per_result = cpl ? Number(cpl.value || 0) : (results > 0 ? spend / results : null);
      } else if (objective === 'alcance' || objective === 'reach') {
        results = Number(r.reach || 0);
        cost_per_result = results > 0 ? spend / results : null;
      } else {
        const purchases = (r.actions || []).find(a => a.action_type === 'purchase');
        results = purchases ? Number(purchases.value || 0) : 0;
        const cpa = (r.cost_per_action_type || []).find(a => a.action_type === 'purchase');
        cost_per_result = cpa ? Number(cpa.value || 0) : (results > 0 ? spend / results : null);
        // roas: null (no pedimos purchase_roas para evitar 400)
      }

      const st = statusMap[r.id] || {};
      return {
        id: r.id, name: r.name,
        campaign_id: r.campaign_id, adset_id: r.adset_id, ad_id: r.ad_id,
        account_id: r.account_id, account_name: r.account_name,
        impressions, clicks, reach: r.reach, frequency: r.frequency,
        spend, cpm, cpc, ctr,
        results, cost_per_result, roas,
        status: st.status || null,
        effective_status: st.effective_status || null
      };
    });

    // === 1c: filtro "solo activos" por effective_status === 'ACTIVE'
    if (only_active) {
      rowsAll = rowsAll.filter(r => (r.effective_status || '').toUpperCase() === 'ACTIVE');
    }

    // Filtro por búsqueda, orden y paginación
    const rowsWork = search ? rowsAll.filter(r => (r.name || '').toLowerCase().includes(search)) : rowsAll;
    const [sField, sDir='desc'] = String(sort).split(':');
    const mul = sDir === 'asc' ? 1 : -1;
    rowsWork.sort((a,b)=> (Number(a[sField]) - Number(b[sField])) * mul);

    const total = rowsWork.length;
    const start = (page - 1) * page_size;
    const paged = rowsWork.slice(start, start + page_size);

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
