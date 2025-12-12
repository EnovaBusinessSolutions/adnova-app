// backend/models/MetaAccount.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* ---------------- helpers ---------------- */
const normActId = (s = '') => String(s || '').trim().replace(/^act_/, '').replace(/\s+/g, '');

const normScopes = (v) => {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,\s]+/);
  return Array.from(
    new Set(
      arr
        .map(x => String(x || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
};

const normIdArr = (arr) =>
  Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map(v => normActId(v))
        .filter(Boolean)
    )
  );

function pickName(a) {
  return a?.name || a?.account_name || a?.business_name || a?.accountName || '';
}

function pickCurrency(a) {
  return a?.currency || a?.account_currency || a?.accountCurrency || null;
}

function pickTimezone(a) {
  return a?.timezone_name || a?.timezone || a?.timezoneName || null;
}

function pickStatus(a) {
  return a?.configured_status ?? a?.account_status ?? a?.accountStatus ?? null;
}

/* ---------------- subdocs ---------------- */
const AdAccountSchema = new Schema(
  {
    // Internamente guardamos sin "act_" (más fácil de comparar y persistir)
    id:                { type: String },   // "123"
    account_id:        { type: String },   // "123"
    name:              { type: String },
    account_name:      { type: String },

    account_status:    { type: Schema.Types.Mixed },
    configured_status: { type: Schema.Types.Mixed },

    currency:          { type: String },
    account_currency:  { type: String },

    timezone_name:     { type: String },
    timezone:          { type: String },
  },
  { _id: false }
);

/* ---------------- main ---------------- */
const MetaAccountSchema = new Schema(
  {
    // ref usuario
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    // tokens (varios alias por compatibilidad)
    access_token:   { type: String, select: false },
    token:          { type: String, select: false },
    longlivedToken: { type: String, select: false },
    accessToken:    { type: String, select: false },
    longLivedToken: { type: String, select: false },

    expires_at: { type: Date },
    expiresAt:  { type: Date },

    // perfil FB
    fb_user_id: { type: String },
    email:      { type: String },
    name:       { type: String },

    // objetivo (onboarding)
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    // cuentas y páginas
    ad_accounts: { type: [AdAccountSchema], default: [] }, // ✅ canónico
    adAccounts:  { type: [AdAccountSchema], default: [] }, // ✅ legacy (lo mantenemos sincronizado)
    pages:       { type: Array, default: [] },

    // selección persistente de cuentas (ids sin "act_")
    selectedAccountIds: {
      type: [String],
      default: [],
      set: normIdArr,
    },

    // scopes otorgados (guardamos en minúsculas)
    scopes: { type: [String], default: [], set: normScopes },

    // cuenta por defecto (solo dígitos, sin "act_")
    defaultAccountId: { type: String, set: (v) => normActId(v) },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'metaaccounts',
    toJSON: {
      transform(_doc, ret) {
        delete ret.access_token;
        delete ret.token;
        delete ret.longlivedToken;
        delete ret.accessToken;
        delete ret.longLivedToken;
        return ret;
      }
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.access_token;
        delete ret.token;
        delete ret.longlivedToken;
        delete ret.accessToken;
        delete ret.longLivedToken;
        return ret;
      }
    }
  }
);

/* -------------- índices -------------- */
MetaAccountSchema.index({ user: 1 },   { unique: true, sparse: true });
MetaAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });
MetaAccountSchema.index({ user: 1, selectedAccountIds: 1 });

/* -------------- virtuales -------------- */
MetaAccountSchema.virtual('accessTokenAny').get(function () {
  return (
    this.longLivedToken || this.longlivedToken ||
    this.access_token   || this.accessToken    ||
    this.token || null
  );
});

MetaAccountSchema.virtual('hasAdsRead').get(function () {
  return (this.scopes || []).includes('ads_read');
});
MetaAccountSchema.virtual('hasAdsManagement').get(function () {
  return (this.scopes || []).includes('ads_management');
});
MetaAccountSchema.virtual('hasBusinessManagement').get(function () {
  return (this.scopes || []).includes('business_management');
});

/* -------------- methods -------------- */
MetaAccountSchema.methods.setTokens = function (value) {
  // set en todos los alias para compatibilidad
  this.longLivedToken = value;
  this.longlivedToken = value;
  this.access_token   = value;
  this.accessToken    = value;
  this.token          = value;
  return this;
};

MetaAccountSchema.methods.getEffectiveToken = function () {
  return (
    this.longLivedToken || this.longlivedToken ||
    this.access_token   || this.accessToken    ||
    this.token || null
  );
};

// Unificar/normalizar arreglo de cuentas (guarda ids sin "act_")
MetaAccountSchema.methods.setAdAccounts = function (list = []) {
  const arr = Array.isArray(list) ? list : [];
  const map = new Map();

  for (const a of arr) {
    const rawId = a?.id || a?.account_id || a?.accountId || '';
    const clean = normActId(rawId);
    if (!clean) continue;

    const name = pickName(a);

    map.set(clean, {
      id: clean,
      account_id: clean,

      name,
      account_name: a?.account_name || name,

      account_status: a?.account_status ?? null,
      configured_status: a?.configured_status ?? a?.account_status ?? null,

      currency: pickCurrency(a),
      account_currency: a?.account_currency || a?.currency || null,

      timezone_name: pickTimezone(a),
      timezone: a?.timezone || a?.timezone_name || null,
    });
  }

  const canonical = Array.from(map.values());
  this.ad_accounts = canonical;

  // ✅ retrocompat: mantenemos también el legacy sincronizado
  this.adAccounts = canonical;

  // default si no existe
  if (!this.defaultAccountId && canonical[0]?.id) {
    this.defaultAccountId = canonical[0].id;
  }

  // si solo hay 1 cuenta, auto-selección (ayuda a Integraciones)
  if (canonical.length === 1 && (!Array.isArray(this.selectedAccountIds) || this.selectedAccountIds.length === 0)) {
    this.selectedAccountIds = [canonical[0].id];
  }

  return this;
};

/* -------------- statics -------------- */
MetaAccountSchema.statics.findWithTokens = function (query = {}) {
  return this.findOne(query).select(
    '+access_token +token +longlivedToken +accessToken +longLivedToken'
  );
};

MetaAccountSchema.statics.loadForUserWithTokens = function (userId) {
  return this.findOne({ $or: [{ user: userId }, { userId }] }).select(
    '+access_token +token +longlivedToken +accessToken +longLivedToken'
  );
};

// Helpers opcionales (no rompen nada si no los usas)
MetaAccountSchema.statics.setSelectedAccountsForUser = async function (userId, ids = []) {
  const selected = normIdArr(ids);
  await this.updateOne(
    { $or: [{ user: userId }, { userId }] },
    { $set: { selectedAccountIds: selected, updatedAt: new Date() } },
    { upsert: false }
  );
  return selected;
};

MetaAccountSchema.statics.setDefaultAccountForUser = async function (userId, accountId) {
  const id = normActId(accountId);
  await this.updateOne(
    { $or: [{ user: userId }, { userId }] },
    { $set: { defaultAccountId: id, updatedAt: new Date() } },
    { upsert: false }
  );
  return id;
};

/* -------------- hooks -------------- */
MetaAccountSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  // Fusiona arreglo legacy → canónico, pero SIN vaciar legacy (para no romper nada)
  const both = [
    ...(Array.isArray(this.ad_accounts) ? this.ad_accounts : []),
    ...(Array.isArray(this.adAccounts) ? this.adAccounts : []),
  ];
  if (both.length) this.setAdAccounts(both);

  // normaliza defaultAccountId
  if (this.defaultAccountId) this.defaultAccountId = normActId(this.defaultAccountId);

  // normaliza/dedup seleccionadas y filtra a ids existentes si hay cuentas
  if (Array.isArray(this.selectedAccountIds)) {
    const norm = normIdArr(this.selectedAccountIds);

    const availableArr =
      Array.isArray(this.ad_accounts) && this.ad_accounts.length
        ? this.ad_accounts
        : (Array.isArray(this.adAccounts) ? this.adAccounts : []);

    if (availableArr.length) {
      const available = new Set(availableArr.map(a => normActId(a?.id || a?.account_id || '')));
      this.selectedAccountIds = norm.filter(id => available.has(id));
    } else {
      this.selectedAccountIds = norm;
    }
  }

  // auto-default si quedó vacío y ya hay cuentas
  if (!this.defaultAccountId) {
    const first = this.ad_accounts?.[0]?.id || this.adAccounts?.[0]?.id || null;
    if (first) this.defaultAccountId = normActId(first);
  }

  // si solo hay 1 cuenta, auto-selección
  const count = Array.isArray(this.ad_accounts) ? this.ad_accounts.length : 0;
  if (count === 1 && (!this.selectedAccountIds || this.selectedAccountIds.length === 0)) {
    this.selectedAccountIds = [this.ad_accounts[0].id];
  }

  next();
});

module.exports = mongoose.models.MetaAccount || model('MetaAccount', MetaAccountSchema);
