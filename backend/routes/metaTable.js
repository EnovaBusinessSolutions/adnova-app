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

function fieldsFor(objective) {
  const base = [
    'account_id','account_name',
    'campaign_id','campaign_name',
    'adset_id','adset_name',
    'ad_id','ad_name',
    'spend','impressions','clicks','reach','frequency','cpm','cpc','ctr'
  ];

  if (objective === 'leads') {
    base.push('actions','cost_per_action_type');
  } else if (objective === 'ventas') {
    base.push('actions','cost_per_action_type','purchase_roas');
  }
  return base.join(',');
}

// agrega arrays de acciones por tipo
function mergeActions(dstArr = [], srcArr = []) {
  const map = new Map();
  [...dstArr, ...srcArr].forEach(a => {
    if (!a || !a.action_type) return;
    const prev = map.get(a.action_type) || 0;
    map.set(a.action_type, prev + Number(a.value || 0));
  });
  return [...map.entries()].map(([action_type, value]) => ({ action_type, value }));
}
function mergeCPAT(dstArr = [], srcArr = [], spend = 0) {
  // promedia ponderado por resultados si es posible; fallback: último
  const map = new Map();
  [...dstArr, ...srcArr].forEach(a => {
    if (!a || !a.action_type) return;
    map.set(a.action_type, Number(a.value || 0));
  });
  return [...map.entries()].map(([action_type, value]) => ({ action_type, value }));
}

function pickResultRow(row, objective) {
  const out = { results: 0, cost_per_result: null, roas: null };

  const actions = row.actions || [];
  const cpat    = row.cost_per_action_type || [];

  if (objective === 'leads') {
    const lead = actions.find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
    out.results = lead ? Number(lead.value || 0) : 0;
    const cpl = cpat.find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
    out.cost_per_result = cpl ? Number(cpl.value || 0) :
      (out.results > 0 && row.spend ? Number(row.spend) / out.results : null);
  } else if (objective === 'alcance' || objective === 'reach') {
    out.results = Number(row.reach || 0);
    out.cost_per_result = (out.results > 0 && row.spend) ? Number(row.spend) / out.results : null;
  } else { // ventas
    const purchases = actions.find(a => a.action_type === 'purchase');
    out.results = purchases ? Number(purchases.value || 0) : 0;
    if (Array.isArray(row.purchase_roas) && row.purchase_roas[0]?.value) {
      out.roas = Number(row.purchase_roas[0].value);
    }
    const cpa = cpat.find(a => a.action_type === 'purchase');
    out.cost_per_result = cpa ? Number(cpa.value || 0) :
      (out.results > 0 && row.spend ? Number(row.spend) / out.results : null);
  }
  return out;
}

function sortRows(rows, sort) {
  if (!sort) return rows;
  const [field, dir='desc'] = String(sort).split(':');
  const mul = dir.toLowerCase() === 'asc' ? 1 : -1;
  return rows.sort((a,b) => {
    const va = a[field]; const vb = b[field];
    const na = Number(va); const nb = Number(vb);
    return ((isNaN(na)?0:na) - (isNaN(nb)?0:nb)) * mul;
  });
}

/* --------------------------- endpoint --------------------------- */
router.get('/table', async (req, res) => {
  try {
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    const { token, defaultAccountId, objective: storedObj } = await getMetaAuth(req);
    if (!token) return res.status(400).json({ error: 'no_token' });

    const accountId = normActId(req.query.account_id || defaultAccountId);
    if (!accountId) return res.status(400).json({ error: 'no_account' });

    const level = (req.query.level || 'campaign').toLowerCase(); // campaign|adset|ad
    const objective = (req.query.objective || storedObj || 'ventas').toLowerCase();
    const date_preset = req.query.date_preset;
    const since = req.query.since;
    const until = req.query.until;
    const search = (req.query.search || '').toLowerCase();
    const sort   = req.query.sort || 'spend:desc';
    const page = Math.max(parseInt(req.query.page || '1',10), 1);
    const page_size = Math.min(Math.max(parseInt(req.query.page_size || '25',10), 1), 200);

    const fields = fieldsFor(objective);
    const url = `${FB_GRAPH}/${toActId(accountId)}/insights`;
    const appsecret_proof = makeAppSecretProof(token);

    const params = {
      level,
      fields,
      // queremos totales del rango, no por día:
      time_increment: 0,
      access_token: token,
      ...(appsecret_proof ? { appsecret_proof } : {})
    };
    if (date_preset) params.date_preset = date_preset;
    else if (since && until) params.time_range = JSON.stringify({ since, until });

    const { data } = await axios.get(url, { params, timeout: 25000 });
    const raw = Array.isArray(data?.data) ? data.data : [];

    // Agrupar por entidad (en caso de que Meta devuelva múltiples filas)
    const keyFor = (r) => (level === 'campaign') ? r.campaign_id : (level === 'adset') ? r.adset_id : r.ad_id;
    const nameFor = (r) => (level === 'campaign') ? r.campaign_name : (level === 'adset') ? r.adset_name : r.ad_name;

    const map = new Map();
    for (const r of raw) {
      const k = keyFor(r);
      if (!k) continue;
      const cur = map.get(k) || {
        id: k,
        name: nameFor(r),
        campaign_id: r.campaign_id, adset_id: r.adset_id, ad_id: r.ad_id,
        account_id: r.account_id, account_name: r.account_name,
        impressions: 0, clicks: 0, reach: 0, frequency: 0,
        spend: 0, cpm: 0, cpc: 0, ctr: 0,
        actions: [], cost_per_action_type: [], purchase_roas: []
      };
      cur.impressions += Number(r.impressions || 0);
      cur.clicks      += Number(r.clicks || 0);
      cur.reach        = Math.max(Number(cur.reach || 0), Number(r.reach || 0)); // reach único aprox
      cur.spend       += Number(r.spend || 0);

      // recalcular métricas derivadas al final
      cur.actions = mergeActions(cur.actions, r.actions || []);
      cur.cost_per_action_type = mergeCPAT(cur.cost_per_action_type, r.cost_per_action_type || []);
      if (Array.isArray(r.purchase_roas) && r.purchase_roas.length) {
        cur.purchase_roas = [{ value: Number(r.purchase_roas[0].value || 0) }]; // aprox: última
      }
      map.set(k, cur);
    }

    const rows = [...map.values()].map(r => {
      // derivadas
      r.cpm = r.impressions > 0 ? (r.spend / (r.impressions / 1000)) : 0;
      r.cpc = r.clicks > 0 ? (r.spend / r.clicks) : 0;
      r.ctr = r.impressions > 0 ? ((r.clicks / r.impressions) * 100) : 0;

      const resk = pickResultRow(r, objective);
      return { 
        id: r.id, name: r.name,
        campaign_id: r.campaign_id, adset_id: r.adset_id, ad_id: r.ad_id,
        account_id: r.account_id, account_name: r.account_name,
        impressions: r.impressions, clicks: r.clicks, reach: r.reach,
        frequency: r.frequency, // mantener si lo necesitas más adelante
        spend: r.spend, cpm: r.cpm, cpc: r.cpc, ctr: r.ctr,
        results: resk.results, cost_per_result: resk.cost_per_result, roas: resk.roas
      };
    });

    const filtered = search
      ? rows.filter(r => (r.name || '').toLowerCase().includes(search))
      : rows;

    const sorted = sortRows(filtered, sort);
    const total = sorted.length;
    const start = (page - 1) * page_size;
    const paged = sorted.slice(start, start + page_size);

    res.json({
      account_id: accountId,
      level,
      objective,
      total,
      page,
      page_size,
      rows: paged
    });
  } catch (err) {
    console.error('meta/table error:', err?.response?.data || err.message);
    const status = err?.response?.status || 500;
    return res.status(status).json({
      error: 'meta_table_failed',
      details: err?.response?.data || err.message,
      rows: [], total: 0, page: 1, page_size: 25
    });
  }
});

module.exports = router;
