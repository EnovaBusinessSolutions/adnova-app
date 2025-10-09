// backend/routes/metaTable.js
'use strict';
const express = require('express');
const axios = require('axios');
const router = express.Router();

const User = require('../models/User');
let MetaAccount = null;
try { MetaAccount = require('../models/MetaAccount'); } catch (_) {}

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;

/* ------------------------- helpers ------------------------- */
const normActId = (s = '') => s.toString().replace(/^act_/, '').trim();
const toActId   = (s = '') => (s ? `act_${normActId(s)}` : '');

async function getMetaAuth(req) {
  // reutiliza tu mismo esquema de almacenamiento (MetaAccount o User)
  if (MetaAccount) {
    const doc = await MetaAccount
      .findOne({ $or: [{ userId: req.user._id }, { user: req.user._id }] })
      .select('+longLivedToken +longlivedToken +access_token +token ad_accounts adAccounts defaultAccountId objective')
      .lean();
    const token = doc?.longLivedToken || doc?.longlivedToken || doc?.access_token || doc?.token;
    const accounts = doc?.ad_accounts || doc?.adAccounts || [];
    const defaultAccountId = doc?.defaultAccountId || accounts?.[0]?.account_id || null;
    const objective = doc?.objective || 'ventas';
    return { token, defaultAccountId, objective };
  } else {
    const u = await User.findById(req.user._id).lean();
    return {
      token: u?.metaAccessToken || null,
      defaultAccountId: u?.metaDefaultAccountId || null,
      objective: u?.metaObjective || 'ventas'
    };
  }
}

function fieldsFor(level, objective) {
  // Campos comunes (Meta los entrega como strings)
  const base = [
    'account_id','account_name','campaign_id','campaign_name',
    'adset_id','adset_name','ad_id','ad_name',
    'spend','impressions','clicks','reach','frequency','cpm','cpc','ctr'
  ];

  // Métrica de resultado principal según objetivo
  if (objective === 'leads') {
    base.push('actions','cost_per_action_type');
  } else if (objective === 'alcance' || objective === 'reach') {
    // reach/frequency ya vienen, results = reach
  } else { // ventas
    base.push('purchases','purchase_roas','actions','cost_per_action_type');
    // purchases y purchase_roas vienen dentro de arrays / objetos; los normalizamos abajo
  }

  // nivel
  const breakdown = (level === 'campaign') ? 'campaign' : (level === 'adset') ? 'adset' : 'ad';
  return { base: base.join(','), breakdown };
}

function pickResultRow(row, objective) {
  const out = { results: 0, cost_per_result: null, roas: null };

  // Meta devuelve arrays en 'actions' y 'cost_per_action_type' con {action_type, value}
  const actions = row.actions || [];
  const cpat    = row.cost_per_action_type || [];

  if (objective === 'leads') {
    const lead = actions.find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
    out.results = lead ? Number(lead.value || 0) : 0;
    const cpl = cpat.find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
    out.cost_per_result = cpl ? Number(cpl.value || 0) : null;
  } else if (objective === 'alcance' || objective === 'reach') {
    out.results = Number(row.reach || 0);
    out.cost_per_result = (out.results > 0 && row.spend) ? Number(row.spend) / out.results : null;
  } else {
    // ventas
    const purchases = actions.find(a => a.action_type === 'purchase');
    out.results = purchases ? Number(purchases.value || 0) : Number(row.purchases || 0) || 0;

    // ROAS
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
    const na = Number.isFinite(va) ? va : (Date.parse(va) || 0);
    const nb = Number.isFinite(vb) ? vb : (Date.parse(vb) || 0);
    return (na - nb) * mul;
  });
}

/* --------------------------- endpoint --------------------------- */
/**
 * GET /api/meta/table
 * params:
 *  - account_id (optional, usa default si falta)
 *  - level: campaign|adset|ad
 *  - objective: ventas|alcance|leads
 *  - date_preset (ej. last_30d) o since/until (YYYY-MM-DD)
 *  - search (nombre)
 *  - sort (ej. spend:desc)
 *  - page, page_size
 */
router.get('/table', async (req, res) => {
  try {
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    const { token: storedToken, defaultAccountId, objective: storedObj } = await getMetaAuth(req);
    const token = storedToken;
    if (!token) return res.status(400).json({ error: 'no_token' });

    const accountId = normActId(req.query.account_id || defaultAccountId);
    if (!accountId) return res.status(400).json({ error: 'no_account' });

    const level = (req.query.level || 'campaign').toLowerCase();
    const objective = (req.query.objective || storedObj || 'ventas').toLowerCase();

    const date_preset = req.query.date_preset;
    const since = req.query.since;
    const until = req.query.until;

    const search = (req.query.search || '').toLowerCase();
    const sort   = req.query.sort || 'spend:desc';

    const page = Math.max(parseInt(req.query.page || '1',10), 1);
    const page_size = Math.min(Math.max(parseInt(req.query.page_size || '25',10), 1), 200);

    const { base } = fieldsFor(level, objective);

    // Llamada a insights
    const url = `${FB_GRAPH}/${toActId(accountId)}/insights`;
    const params = {
      level,
      fields: base,
      limit: 5000, // traer amplio y paginar en backend (evita múltiples rondas)
      time_increment: 1
    };
    if (date_preset) params.date_preset = date_preset;
    else if (since && until) params.time_range = JSON.stringify({ since, until });

    const { data } = await axios.get(url, { params, headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
    const raw = Array.isArray(data?.data) ? data.data : [];

    // Normalización por nivel
    const rows = raw.map(r => {
      const baseRow = {
        id: (level === 'campaign') ? r.campaign_id : (level === 'adset') ? r.adset_id : r.ad_id,
        name: (level === 'campaign') ? r.campaign_name : (level === 'adset') ? r.adset_name : r.ad_name,
        campaign_id: r.campaign_id, adset_id: r.adset_id, ad_id: r.ad_id,
        account_id: r.account_id, account_name: r.account_name,
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        reach: Number(r.reach || 0),
        frequency: Number(r.frequency || 0),
        spend: Number(r.spend || 0),
        cpm: Number(r.cpm || 0),
        cpc: Number(r.cpc || 0),
        ctr: Number(r.ctr || 0),
      };

      const resk = pickResultRow(r, objective);
      return { ...baseRow, ...resk };
    });

    // Filtro por búsqueda de nombre
    const filtered = search
      ? rows.filter(r => (r.name || '').toLowerCase().includes(search))
      : rows;

    // Orden
    const sorted = sortRows(filtered, sort);

    // Paginación
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
    console.error('meta/table error', err?.response?.data || err.message);
    res.status(500).json({ error: 'meta_table_failed', details: err?.response?.data || err.message });
  }
});

module.exports = router;
