// backend/routes/metaAccounts.js
'use strict';

const express  = require('express');
const axios    = require('axios');
const crypto   = require('crypto');
const mongoose = require('mongoose');

const router = express.Router();

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

/* ========== Modelo MetaAccount tolerante ========== */
let MetaAccount;
try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema } = mongoose;
  const schema = new Schema(
    {
      user:      { type: Schema.Types.ObjectId, ref: 'User' },
      userId:    { type: Schema.Types.ObjectId, ref: 'User' },

      access_token:   { type: String, select: false },
      token:          { type: String, select: false },
      longlivedToken: { type: String, select: false },
      accessToken:    { type: String, select: false },
      longLivedToken: { type: String, select: false },

      ad_accounts:      Array,
      adAccounts:       Array,
      defaultAccountId: String,

      expiresAt: Date,
      objective: String,
    },
    { timestamps: true, collection: 'metaaccounts' }
  );
  MetaAccount = mongoose.models.MetaAccount || mongoose.model('MetaAccount', schema);
}

/* ========== Utils ========== */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function appSecretProof(accessToken) {
  if (!APP_SECRET) return undefined;
  return crypto.createHmac('sha256', APP_SECRET).update(accessToken).digest('hex');
}

async function loadMetaAccount(userId){
  return await MetaAccount
    .findOne({ $or: [{ user: userId }, { userId }] })
    .select('+access_token +token +longlivedToken +accessToken +longLivedToken')
    .lean();
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

function normalizeAccountsList(metaAcc) {
  if (Array.isArray(metaAcc?.ad_accounts)) return metaAcc.ad_accounts;
  if (Array.isArray(metaAcc?.adAccounts))  return metaAcc.adAccounts;
  return [];
}

function normalizeAdAccount(a) {
  // Lo dejamos con llaves estables para el front
  const raw = String(a?.id || a?.account_id || '').replace(/^act_/, '');
  return {
    id: raw,
    name: a?.name || a?.account_name || raw,
    currency: a?.currency || a?.account_currency || null,
    status: a?.account_status ?? null,
    timezone_name: a?.timezone_name || a?.timezone || null,
  };
}

/* ========== GET /api/meta/accounts ==========
   Devuelve lo que hay en BD (sin ir a Graph) */
router.get('/', requireAuth, async (req, res) => {
  try {
    const doc = await loadMetaAccount(req.user._id);
    if (!doc) return res.json({ ok: true, connected: false, accounts: [], defaultAccountId: null });

    const list = normalizeAccountsList(doc).map(normalizeAdAccount);
    const defaultAccountId = doc.defaultAccountId || list[0]?.id || null;

    return res.json({
      ok: true,
      connected: !!resolveAccessToken(doc, req.user),
      accounts: list,
      defaultAccountId,
      objective: doc.objective || 'ventas'
    });
  } catch (e) {
    console.error('meta/accounts list error:', e);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

/* ========== POST /api/meta/accounts/refresh ==========
   Consulta /me/adaccounts en Graph y guarda en BD */
router.post('/refresh', requireAuth, async (req, res) => {
  try {
    let doc = await MetaAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+access_token +token +longlivedToken +accessToken +longLivedToken');

    if (!doc) return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });

    const accessToken = resolveAccessToken(doc.toObject ? doc.toObject() : doc, req.user);
    if (!accessToken) return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });

    const params = {
      access_token: accessToken,
      appsecret_proof: appSecretProof(accessToken),
      fields: [
        'id',
        'name',
        'account_status',
        'currency',
        'account_currency',
        'timezone_name',
      ].join(','),
      limit: 200
    };

    const res1 = await axios.get(`${FB_GRAPH}/me/adaccounts`, { params });
    const data = Array.isArray(res1?.data?.data) ? res1.data.data : [];
    const clean = data.map(normalizeAdAccount);

    // Guarda en cualquiera de los dos campos que uses
    if (Array.isArray(doc.ad_accounts)) doc.ad_accounts = clean;
    else doc.ad_accounts = clean; // preferimos ad_accounts
    doc.adAccounts = clean;

    if (!doc.defaultAccountId && clean[0]?.id) {
      doc.defaultAccountId = clean[0].id;
    }

    await doc.save();

    return res.json({
      ok: true,
      accounts: clean,
      defaultAccountId: doc.defaultAccountId || clean[0]?.id || null
    });
  } catch (e) {
    const detail = e?.response?.data || e?.message || String(e);
    console.error('meta/accounts refresh error:', detail);
    const status = e?.response?.status || 500;
    return res.status(status).json({ ok: false, error: 'REFRESH_ERROR', detail });
  }
});

/* ========== POST /api/meta/accounts/default ==========
   body: { accountId } para fijar default */
router.post('/default', requireAuth, async (req, res) => {
  try {
    const { accountId } = req.body || {};
    if (!accountId) return res.status(400).json({ ok: false, error: 'MISSING_ACCOUNT_ID' });

    const doc = await MetaAccount.findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] });
    if (!doc) return res.status(400).json({ ok: false, error: 'META_NOT_CONNECTED' });

    doc.defaultAccountId = String(accountId).replace(/^act_/, '');
    await doc.save();

    return res.json({ ok: true, defaultAccountId: doc.defaultAccountId });
  } catch (e) {
    console.error('meta/accounts default error:', e);
    return res.status(500).json({ ok: false, error: 'DEFAULT_SET_ERROR' });
  }
});

/* ========== GET /api/meta/accounts/status ==========
   Estado mínimo para UI */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const doc = await loadMetaAccount(req.user._id);
    if (!doc) return res.json({ ok: true, connected: false });

    return res.json({
      ok: true,
      connected: !!resolveAccessToken(doc, req.user),
      defaultAccountId: doc.defaultAccountId || null,
      expiresAt: doc.expiresAt || null
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

module.exports = router;
