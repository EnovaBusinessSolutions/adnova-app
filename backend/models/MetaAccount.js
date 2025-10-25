// backend/models/MetaAccount.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* ---------------- helpers ---------------- */
const normActId = (s = '') => s.toString().replace(/^act_/, '').trim();
const normScopes = (v) =>
  Array.from(
    new Set(
      (Array.isArray(v) ? v : String(v || '').split(/\s+/))
        .map(x => String(x || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
const normIdArr = (arr) =>
  Array.from(new Set(
    (Array.isArray(arr) ? arr : [])
      .map(v => normActId(v))
      .filter(Boolean)
  ));

/* ---------------- subdocs ---------------- */
const AdAccountSchema = new Schema(
  {
    id:               { type: String },   // puede venir "act_123" o "123"
    account_id:       { type: String },
    name:             { type: String },
    account_name:     { type: String },
    account_status:   { type: Schema.Types.Mixed },
    configured_status:{ type: Schema.Types.Mixed },
    currency:         { type: String },
    account_currency: { type: String },
    timezone_name:    { type: String },
    timezone:         { type: String },
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
    ad_accounts: { type: [AdAccountSchema], default: [] }, // ← canónico
    adAccounts:  { type: [AdAccountSchema], default: [] }, // ← legacy (se fusiona en pre-save)
    pages:       { type: Array, default: [] },

    // NUEVO: selección persistente de cuentas (ids sin "act_")
    selectedAccountIds: {
      type: [String],
      default: [],
      set: normIdArr,
    },

    // scopes otorgados
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
MetaAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
MetaAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });
// útil para dashboards/consultas
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

// Unificar/normalizar arreglo de cuentas
MetaAccountSchema.methods.setAdAccounts = function (list = []) {
  const arr = Array.isArray(list) ? list : [];
  const map = new Map();
  for (const a of arr) {
    const rawId = a?.id || a?.account_id || '';
    const clean = normActId(rawId);
    if (!clean) continue;
    map.set(clean, {
      id: clean,
      account_id: clean,
      name: a?.name || a?.account_name || '',
      account_name: a?.account_name || a?.name || '',
      account_status: a?.account_status ?? null,
      configured_status: a?.configured_status ?? null,
      currency: a?.currency || a?.account_currency || null,
      account_currency: a?.account_currency || a?.currency || null,
      timezone_name: a?.timezone_name || a?.timezone || null,
      timezone: a?.timezone || a?.timezone_name || null,
    });
  }
  this.ad_accounts = Array.from(map.values());
  if (!this.defaultAccountId && this.ad_accounts[0]?.id) {
    this.defaultAccountId = this.ad_accounts[0].id;
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

/* -------------- hooks -------------- */
MetaAccountSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  // fusiona arreglos legacy → canónico ad_accounts
  const both = [...(this.ad_accounts || []), ...(this.adAccounts || [])];
  if (both.length) this.setAdAccounts(both);
  this.adAccounts = []; // dejamos vacío el legacy

  // normaliza defaultAccountId
  if (this.defaultAccountId) this.defaultAccountId = normActId(this.defaultAccountId);

  // normaliza/dedup seleccionadas y, si hay cuentas cargadas, filtra a ids existentes
  if (Array.isArray(this.selectedAccountIds)) {
    const norm = normIdArr(this.selectedAccountIds);
    if (this.ad_accounts?.length) {
      const available = new Set(this.ad_accounts.map(a => a.id));
      this.selectedAccountIds = norm.filter(id => available.has(id));
    } else {
      this.selectedAccountIds = norm;
    }
  }

  next();
});

module.exports = mongoose.models.MetaAccount || model('MetaAccount', MetaAccountSchema);
