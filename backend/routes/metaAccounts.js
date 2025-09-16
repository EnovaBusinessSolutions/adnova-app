// backend/routes/metaAccounts.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

// --- auth helper ---
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

// --- util ids ---
const normActId = (s = '') => s.toString().replace(/^act_/, '').trim();
const toActId   = (s = '') => {
  const id = normActId(s);
  return id ? `act_${id}` : '';
};

// --- MetaAccount (tolerante) ---
let MetaAccount;
try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },

      access_token:   { type: String, select: false },
      token:          { type: String, select: false },
      longlivedToken: { type: String, select: false },

      // distintos nombres que podrías tener en Atlas
      ad_accounts:      Array,
      adAccounts:       Array,
      defaultAccountId: String,

      // Objetivo seleccionado en onboarding (sin default aquí)
      objective: { type: String, enum: ['ventas', 'alcance', 'leads'], default: null },
    },
    { timestamps: true, collection: 'metaaccounts' }
  );
  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}

/**
 * GET /api/meta/accounts
 * Devuelve la lista de cuentas normalizada para el dropdown del dashboard.
 * Formato: { ad_accounts: [{ id, account_id, name, currency, configured_status }], defaultAccountId, objective }
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .lean();

    const raw = (doc?.adAccounts || doc?.ad_accounts || []);
    const ad_accounts = raw.map(a => {
      const account_id = normActId(a.account_id || a.accountId || a.id || '');
      return {
        id: a.id || toActId(account_id),
        account_id,
        name: a.name || a.account_name || a.business_name || 'Untitled',
        currency: a.currency || a.account_currency || null,
        configured_status: a.configured_status || a.account_status || null,
      };
    });

    return res.json({
      ad_accounts,
      defaultAccountId: doc?.defaultAccountId || ad_accounts[0]?.account_id || null,
      objective: doc?.objective ?? null,
    });
  } catch (e) {
    console.error('meta/accounts list error:', e);
    return res.status(500).json({ ok: false, error: 'LIST_ERROR' });
  }
});

// --- STATUS: ¿está conectada la cuenta y ya hay objetivo? ---
router.get('/status', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+access_token +token +longlivedToken objective')
      .lean();

    const connected = !!(doc?.access_token || doc?.token || doc?.longlivedToken);
    const objective = doc?.objective || null;

    return res.json({ ok: true, connected, objective });
  } catch (e) {
    console.error('meta/accounts/status error:', e);
    return res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

// --- GUARDAR OBJETIVO explícito desde Onboarding (alternativo) ---
// Nota: tu onboarding usa /auth/meta/objective (en routes/meta.js). Mantener este endpoint es opcional.
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

module.exports = router;
