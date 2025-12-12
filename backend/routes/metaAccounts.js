// backend/routes/metaAccounts.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// Mirror legacy en User (no romper onboarding/UI vieja)
const User = require('../models/User');

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

const MAX_BY_RULE = 3; // si hay >3 ad accounts, exigimos selección

const normActId = (s = '') => String(s || '').replace(/^act_/, '').trim();
const toActId = (s = '') => {
  const id = normActId(s);
  return id ? `act_${id}` : '';
};
const uniq = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).filter(Boolean)));

/* =========================
 * Modelo MetaAccount (fallback si no existe)
 * ========================= */
let MetaAccount;
try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema, model, Types } = mongoose;

  const AdAccountSchema = new Schema(
    {
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
    },
    { _id: false }
  );

  const schema = new Schema(
    {
      user: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

      access_token: { type: String, select: false },
      token: { type: String, select: false },
      longlivedToken: { type: String, select: false },
      accessToken: { type: String, select: false },
      longLivedToken: { type: String, select: false },

      ad_accounts: { type: [AdAccountSchema], default: [] },
      adAccounts: { type: [AdAccountSchema], default: [] },

      pages: { type: Array, default: [] },
      scopes: { type: [String], default: [] },

      // 👇 canónico (para Integraciones)
      selectedAccountIds: { type: [String], default: [] }, // sin "act_"
      defaultAccountId: { type: String },                  // sin "act_"

      objective: { type: String, enum: ['ventas', 'alcance', 'leads'], default: null },

      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'metaaccounts' }
  );

  schema.index({ user: 1 }, { unique: true, sparse: true });
  schema.index({ userId: 1 }, { unique: true, sparse: true });
  schema.pre('save', function (next) { this.updatedAt = new Date(); next(); });

  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}

/* =========================
 * Helpers de selección (canónico + legacy)
 * ========================= */
function normalizeAccounts(raw = []) {
  const arr = Array.isArray(raw) ? raw : [];
  const map = new Map();

  for (const a of arr) {
    const account_id = normActId(a?.account_id || a?.accountId || a?.id || '');
    if (!account_id) continue;

    const idAct = toActId(account_id);
    map.set(account_id, {
      id: a?.id || idAct, // preferimos act_XXXX para UI
      account_id,         // sin act_
      name: a?.name || a?.account_name || a?.business_name || 'Untitled',
      currency: a?.currency || a?.account_currency || null,
      configured_status: a?.configured_status ?? a?.account_status ?? null,
      timezone_name: a?.timezone_name || a?.timezone || null,
    });
  }

  return Array.from(map.values());
}

function getSelectedIdsDigits({ doc, user }) {
  // 1) Canónico: MetaAccount.selectedAccountIds (sin act_)
  const docSel = Array.isArray(doc?.selectedAccountIds) ? doc.selectedAccountIds : [];
  const docDigits = uniq(docSel.map(normActId).filter(Boolean));
  if (docDigits.length) return docDigits;

  // 2) Legacy: User.selectedMetaAccounts (con act_)
  const legacy = Array.isArray(user?.selectedMetaAccounts) ? user.selectedMetaAccounts : [];
  const legacyDigits = uniq(legacy.map(normActId).filter(Boolean));
  return legacyDigits;
}

async function loadMetaDoc(userId, select = '') {
  return MetaAccount
    .findOne({ $or: [{ user: userId }, { userId }] })
    .select(select || 'ad_accounts adAccounts defaultAccountId selectedAccountIds objective scopes updatedAt')
    .lean();
}

/* =========================
 * GET /api/meta/accounts
 * ========================= */
router.get('/', requireAuth, async (req, res) => {
  try {
    const doc = await loadMetaDoc(req.user._id);

    const raw = (doc?.ad_accounts || doc?.adAccounts || []);
    const ad_accounts_all = normalizeAccounts(raw);

    const availableDigits = ad_accounts_all.map(a => a.account_id);
    const selectedDigits = getSelectedIdsDigits({ doc, user: req.user });

    // Si hay >3 y no hay selección, Integraciones debe forzar selección
    const requiredSelection = availableDigits.length > MAX_BY_RULE && selectedDigits.length === 0;

    // Filtrado por selección (retrocompatible con tu comportamiento actual)
    const allow = new Set(selectedDigits.map(toActId));
    const ad_accounts = selectedDigits.length
      ? ad_accounts_all.filter(a => allow.has(a.id || toActId(a.account_id)))
      : ad_accounts_all;

    // Default (en DB guardas sin act_)
    let defaultAccountId = doc?.defaultAccountId ? normActId(doc.defaultAccountId) : null;

    // Si exige selección, forzamos default null para que UI seleccione explícitamente
    if (requiredSelection) {
      defaultAccountId = null;
    } else {
      // Si no hay default, usa el primero disponible
      if (!defaultAccountId) {
        defaultAccountId = ad_accounts_all[0]?.account_id || null;
      }

      // Si hay selección y el default quedó fuera, lo movemos al primero seleccionado
      if (selectedDigits.length && defaultAccountId && !selectedDigits.includes(defaultAccountId)) {
        defaultAccountId = selectedDigits[0];
        await MetaAccount.updateOne(
          { $or: [{ user: req.user._id }, { userId: req.user._id }] },
          { $set: { defaultAccountId, updatedAt: new Date() } }
        );
      }
    }

    // Alias simple para UIs/Onboarding
    const accounts = ad_accounts.map(a => ({
      id: a.id || toActId(a.account_id), // "act_XXXX"
      name: a.name || a.id
    }));

    return res.json({
      ok: true,

      // compat existente
      ad_accounts,
      accounts,
      total: accounts.length,
      defaultAccountId, // sin "act_"

      // extras E2E para Integraciones (no rompen)
      ad_accounts_all,                // lista completa (por si UI quiere mostrar todo + selected)
      requiredSelection,              // true/false
      reason: requiredSelection ? 'SELECTION_REQUIRED(>3_ACCOUNTS)' : null,
      selectedAccountIds: selectedDigits,          // canónico (sin act_)
      selectedMetaAccounts: selectedDigits.map(toActId), // legacy (con act_)

      objective: doc?.objective ?? null,
      scopes: Array.isArray(doc?.scopes) ? doc.scopes : [],
      updatedAt: doc?.updatedAt || null,
    });
  } catch (e) {
    console.error('meta/accounts list error:', e);
    return res.status(500).json({ ok: false, error: 'LIST_ERROR' });
  }
});

/* =========================
 * GET /api/meta/accounts/scopes
 * ========================= */
router.get('/scopes', requireAuth, async (req, res) => {
  try {
    const doc = await loadMetaDoc(req.user._id, 'scopes updatedAt defaultAccountId selectedAccountIds ad_accounts adAccounts');

    const raw = (doc?.ad_accounts || doc?.adAccounts || []);
    const ad_accounts_all = normalizeAccounts(raw);
    const selectedDigits = getSelectedIdsDigits({ doc, user: req.user });
    const requiredSelection = ad_accounts_all.length > MAX_BY_RULE && selectedDigits.length === 0;

    return res.json({
      ok: true,
      data: doc ? {
        scopes: Array.isArray(doc.scopes) ? doc.scopes : [],
        defaultAccountId: doc.defaultAccountId ? normActId(doc.defaultAccountId) : null,
        selectedAccountIds: selectedDigits,
        requiredSelection,
        updatedAt: doc.updatedAt || null,
      } : null
    });
  } catch (e) {
    console.error('meta/scopes error:', e);
    return res.status(500).json({ ok: false, error: 'SCOPES_ERROR' });
  }
});

/* =========================
 * GET /api/meta/accounts/status
 * ========================= */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const doc = await MetaAccount
      .findOne({ $or: [{ user: req.user._id }, { userId: req.user._id }] })
      .select('+access_token +token +longlivedToken objective scopes selectedAccountIds defaultAccountId ad_accounts adAccounts')
      .lean();

    const connected = !!(doc?.access_token || doc?.token || doc?.longlivedToken);
    const scopes = Array.isArray(doc?.scopes) ? doc.scopes : [];
    const hasAdsRead = scopes.includes('ads_read');

    const raw = (doc?.ad_accounts || doc?.adAccounts || []);
    const ad_accounts_all = normalizeAccounts(raw);
    const selectedDigits = getSelectedIdsDigits({ doc, user: req.user });
    const requiredSelection = ad_accounts_all.length > MAX_BY_RULE && selectedDigits.length === 0;

    return res.json({
      ok: true,
      connected,
      objective: doc?.objective || null,
      scopes,
      hasAdsRead,
      requiredSelection,
      selectedAccountIds: selectedDigits,
      defaultAccountId: doc?.defaultAccountId ? normActId(doc.defaultAccountId) : null,
    });
  } catch (e) {
    console.error('meta/accounts/status error:', e);
    return res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

/* =========================
 * POST /api/meta/accounts/objective
 * ========================= */
router.post('/objective', requireAuth, express.json(), async (req, res) => {
  try {
    const allowed = new Set(['ventas', 'alcance', 'leads']);
    const objective = String(req.body?.objective || '').toLowerCase();

    if (!allowed.has(objective)) {
      return res.status(400).json({ ok: false, error: 'INVALID_OBJECTIVE' });
    }

    const doc = await MetaAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { objective, updatedAt: new Date() } },
      { new: true, upsert: false }
    ).lean();

    if (!doc) return res.status(404).json({ ok: false, error: 'META_NOT_CONNECTED' });

    // espejo en User (no rompe)
    await User.updateOne({ _id: req.user._id }, { $set: { metaObjective: objective } });

    return res.json({ ok: true, objective });
  } catch (e) {
    console.error('meta/accounts/objective error:', e);
    return res.status(500).json({ ok: false, error: 'OBJECTIVE_SAVE_ERROR' });
  }
});

/* =========================
 * POST /api/meta/accounts/default-account
 * ========================= */
router.post('/default-account', requireAuth, express.json(), async (req, res) => {
  try {
    const accountId = normActId(req.body?.accountId || req.body?.account_id || '');
    if (!accountId) return res.status(400).json({ ok: false, error: 'INVALID_ACCOUNT' });

    const doc = await loadMetaDoc(req.user._id, 'ad_accounts adAccounts selectedAccountIds defaultAccountId');
    if (!doc) return res.status(404).json({ ok: false, error: 'META_NOT_CONNECTED' });

    const ad_accounts_all = normalizeAccounts(doc?.ad_accounts || doc?.adAccounts || []);
    const available = new Set(ad_accounts_all.map(a => a.account_id));
    if (!available.has(accountId)) {
      return res.status(400).json({ ok: false, error: 'ACCOUNT_NOT_ALLOWED' });
    }

    // Si ya hay selección, nos aseguramos que el default esté dentro.
    const selectedDigits = getSelectedIdsDigits({ doc, user: req.user });
    const nextSelectedDigits = selectedDigits.length
      ? uniq([...selectedDigits, accountId])
      : selectedDigits;

    await MetaAccount.updateOne(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      {
        $set: {
          defaultAccountId: accountId,
          ...(nextSelectedDigits.length ? { selectedAccountIds: nextSelectedDigits } : {}),
          updatedAt: new Date(),
        }
      }
    );

    // espejo legacy: User.selectedMetaAccounts (act_)
    if (nextSelectedDigits.length) {
      await User.updateOne(
        { _id: req.user._id },
        { $set: { selectedMetaAccounts: nextSelectedDigits.map(toActId) } }
      );
    }

    return res.json({ ok: true, defaultAccountId: accountId });
  } catch (e) {
    console.error('meta/default-account error:', e);
    return res.status(500).json({ ok: false, error: 'DEFAULT_ACCOUNT_SAVE_ERROR' });
  }
});

/* =========================
 * POST /api/meta/accounts/selection
 *  - Guarda canónico en MetaAccount.selectedAccountIds
 *  - Espejo legacy en User.selectedMetaAccounts
 *  - Ajusta defaultAccountId si queda fuera
 * ========================= */
router.post('/selection', requireAuth, express.json(), async (req, res) => {
  try {
    const { accountIds } = req.body;
    if (!Array.isArray(accountIds)) {
      return res.status(400).json({ ok: false, error: 'accountIds[] requerido' });
    }

    const wantedDigits = uniq(accountIds.map(normActId).filter(Boolean));
    if (!wantedDigits.length) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_ACCOUNTS' });
    }

    const doc = await loadMetaDoc(req.user._id, 'ad_accounts adAccounts defaultAccountId selectedAccountIds');
    if (!doc) return res.status(404).json({ ok: false, error: 'META_NOT_CONNECTED' });

    const ad_accounts_all = normalizeAccounts(doc?.ad_accounts || doc?.adAccounts || []);
    const available = new Set(ad_accounts_all.map(a => a.account_id));

    const selectedDigits = wantedDigits.filter(id => available.has(id));
    if (selectedDigits.length === 0) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_ACCOUNTS' });
    }

    // Default: si el actual no está en selected → toma el primero selected
    let nextDefault = doc?.defaultAccountId ? normActId(doc.defaultAccountId) : null;
    if (!nextDefault || !selectedDigits.includes(nextDefault)) {
      nextDefault = selectedDigits[0];
    }

    await MetaAccount.updateOne(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      {
        $set: {
          selectedAccountIds: selectedDigits,  // canónico (sin act_)
          defaultAccountId: nextDefault,       // canónico (sin act_)
          updatedAt: new Date(),
        }
      }
    );

    // espejo legacy en user (con act_)
    await User.updateOne(
      { _id: req.user._id },
      { $set: { selectedMetaAccounts: selectedDigits.map(toActId) } }
    );

    return res.json({
      ok: true,

      // retrocompatible
      selected: selectedDigits.map(toActId),     // act_
      defaultAccountId: nextDefault,             // sin act_

      // canónico
      selectedAccountIds: selectedDigits,
      defaultActId: toActId(nextDefault),
    });
  } catch (e) {
    console.error('meta/accounts/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
});

module.exports = router;
