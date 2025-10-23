// backend/routes/metaAccounts.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// === NUEVO: para guardar selección en el usuario
const User = require('../models/User');

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

const normActId = (s = '') => s.toString().replace(/^act_/, '').trim();
const toActId   = (s = '') => {
  const id = normActId(s);
  return id ? `act_${id}` : '';
};

let MetaAccount;
try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema, model, Types } = mongoose;
  const AdAccountSchema = new Schema({
    id: String,
    account_id: String,
    name: String,
    account_name: String,
    account_status: Schema.Types.Mixed,
    configured_status: Schema.Types.Mixed,
    currency: String,
    account_currency: String,
    timezone_name: String,
    timezone: String,
  }, { _id: false });

  const schema = new Schema(
    {
      user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

      access_token:   { type: String, select: false },
      token:          { type: String, select: false },
      longlivedToken: { type: String, select: false },
      accessToken:    { type: String, select: false },
      longLivedToken: { type: String, select: false },

      ad_accounts: { type: [AdAccountSchema], default: [] },
      adAccounts:  { type: [AdAccountSchema], default: [] },

      pages:  { type: Array, default: [] },
      scopes: { type: [String], default: [] },

      defaultAccountId: { type: String },

      objective: { type: String, enum: ['ventas', 'alcance', 'leads'], default: null },

      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'metaaccounts' }
  );
  schema.index({ user: 1 },   { unique: true, sparse: true });
  schema.index({ userId: 1 }, { unique: true, sparse: true });
  schema.pre('save', function (next) { this.updatedAt = new Date(); next(); });

  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}


router.get('/', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('ad_accounts adAccounts defaultAccountId objective scopes updatedAt')
      .lean();

    const raw = (doc?.adAccounts || doc?.ad_accounts || []);

    // Normaliza todas las cuentas (forma consistente)
    const ad_accounts_all = raw.map(a => {
      const account_id = normActId(a.account_id || a.accountId || a.id || '');
      return {
        id: a.id || toActId(account_id), // preferimos "act_XXXX"
        account_id,                      // sin "act_"
        name: a.name || a.account_name || a.business_name || 'Untitled',
        currency: a.currency || a.account_currency || null,
        configured_status: a.configured_status || a.account_status || null,
        timezone_name: a.timezone_name || a.timezone || null,
      };
    });

    // === NUEVO: filtro por selección (si existe)
    const selected = Array.isArray(req.user?.selectedMetaAccounts)
      ? req.user.selectedMetaAccounts.map(toActId) // nos quedamos con "act_XXXX"
      : [];
    const allow = new Set(selected);

    const ad_accounts = selected.length
      ? ad_accounts_all.filter(a => allow.has(a.id || toActId(a.account_id)))
      : ad_accounts_all;

    // Recalcular default si quedó fuera del filtro
    // En DB guardas sin "act_", por eso usamos normActId/toActId según corresponda
    let defaultAccountId = doc?.defaultAccountId || ad_accounts_all[0]?.account_id || null;
    if (selected.length && defaultAccountId) {
      const defAct = toActId(defaultAccountId); // "act_XXXX"
      if (!allow.has(defAct)) {
        defaultAccountId = ad_accounts[0]?.account_id || null;
      }
    }

    // Alias simple para el onboarding
    const accounts = ad_accounts.map(a => ({
      id: a.id || toActId(a.account_id), // "act_XXXX"
      name: a.name || a.id
    }));

    return res.json({
      ok: true,
      ad_accounts,                 // compat con código existente
      accounts,                    // forma simple
      total: accounts.length,      // para onboarding
      defaultAccountId,            // sin "act_"
      objective: doc?.objective ?? null,
      scopes: Array.isArray(doc?.scopes) ? doc.scopes : [],
      updatedAt: doc?.updatedAt || null,
    });
  } catch (e) {
    console.error('meta/accounts list error:', e);
    return res.status(500).json({ ok: false, error: 'LIST_ERROR' });
  }
});

router.get('/scopes', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('scopes updatedAt defaultAccountId')
      .lean();

    return res.json({
      ok: true,
      data: doc ? {
        scopes: Array.isArray(doc.scopes) ? doc.scopes : [],
        defaultAccountId: doc.defaultAccountId || null,
        updatedAt: doc.updatedAt || null,
      } : null
    });
  } catch (e) {
    console.error('meta/scopes error:', e);
    return res.status(500).json({ ok: false, error: 'SCOPES_ERROR' });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+access_token +token +longlivedToken objective scopes')
      .lean();

    const connected = !!(doc?.access_token || doc?.token || doc?.longlivedToken);
    const scopes = Array.isArray(doc?.scopes) ? doc.scopes : [];
    const hasAdsRead = scopes.includes('ads_read');

    return res.json({
      ok: true,
      connected,
      objective: doc?.objective || null,
      scopes,
      hasAdsRead,
    });
  } catch (e) {
    console.error('meta/accounts/status error:', e);
    return res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

router.post('/objective', requireAuth, express.json(), async (req, res) => {
  try {
    const allowed = new Set(['ventas', 'alcance', 'leads']);
    const objective = String(req.body?.objective || '').toLowerCase();

    if (!allowed.has(objective)) {
      return res.status(400).json({ ok: false, error: 'INVALID_OBJECTIVE' });
    }

    const doc = await MetaAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { objective } },
      { new: true, upsert: false }
    ).lean();

    if (!doc) return res.status(404).json({ ok: false, error: 'META_NOT_CONNECTED' });

    return res.json({ ok: true, objective });
  } catch (e) {
    console.error('meta/accounts/objective error:', e);
    return res.status(500).json({ ok: false, error: 'OBJECTIVE_SAVE_ERROR' });
  }
});

router.post('/default-account', requireAuth, express.json(), async (req, res) => {
  try {
    const accountId = normActId(req.body?.accountId || req.body?.account_id || '');
    if (!accountId) return res.status(400).json({ ok: false, error: 'INVALID_ACCOUNT' });

    const doc = await MetaAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultAccountId: accountId } },
      { new: true, upsert: false }
    ).lean();

    if (!doc) return res.status(404).json({ ok: false, error: 'META_NOT_CONNECTED' });

    return res.json({ ok: true, defaultAccountId: accountId });
  } catch (e) {
    console.error('meta/default-account error:', e);
    return res.status(500).json({ ok: false, error: 'DEFAULT_ACCOUNT_SAVE_ERROR' });
  }
});

// === NUEVO: Guardar selección de cuentas para el usuario autenticado
router.post('/selection', requireAuth, express.json(), async (req, res) => {
  try {
    const { accountIds } = req.body;
    if (!Array.isArray(accountIds)) {
      return res.status(400).json({ ok: false, error: 'accountIds[] requerido' });
    }

    // Normaliza y deduplica con prefijo act_
    const wanted = [...new Set(accountIds.map(toActId).filter(Boolean))];

    // Valida que las cuentas existan para este usuario
    const doc = await MetaAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('ad_accounts adAccounts defaultAccountId')
      .lean();

    const raw = (doc?.adAccounts || doc?.ad_accounts || []);
    const allowed = new Set(
      raw.map(a => toActId(a.id || a.account_id || a.accountId))
    );

    const selected = wanted.filter(id => allowed.has(id));
    if (selected.length === 0) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_ACCOUNTS' });
    }

    // Guarda en el usuario
    await User.updateOne(
      { _id: req.user._id },
      { $set: { selectedMetaAccounts: selected } }
    );

    // Asegura default dentro de la selección
    let nextDefault = doc?.defaultAccountId ? toActId(doc.defaultAccountId) : null;
    if (!nextDefault || !selected.includes(nextDefault)) {
      nextDefault = selected[0]; // primera seleccionada
      await MetaAccount.updateOne(
        { $or: [{ user: req.user._id }, { userId: req.user._id }] },
        { $set: { defaultAccountId: normActId(nextDefault) } } // en DB guardas sin 'act_'
      );
    }

    return res.json({ ok: true, selected, defaultAccountId: nextDefault });
  } catch (e) {
    console.error('meta/accounts/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
});

module.exports = router;
