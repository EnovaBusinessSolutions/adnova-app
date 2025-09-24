// backend/models/MetaAccount.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* ---------- Helpers ---------- */
const normActId = (s = '') => s.toString().replace(/^act_/, '').trim();
const normScopes = (v) =>
  Array.from(new Set((Array.isArray(v) ? v : [])
    .map(x => String(x || '').trim().toLowerCase())
    .filter(Boolean)));

/* ---------- Subdocumento: Ad Account ---------- */
const AdAccountSchema = new Schema(
  {
    id:              { type: String },               // puede venir act_123
    account_id:      { type: String },               // 123
    name:            { type: String },
    account_name:    { type: String },
    account_status:  { type: Schema.Types.Mixed },
    configured_status:{ type: Schema.Types.Mixed },
    currency:        { type: String },
    account_currency:{ type: String },
    timezone_name:   { type: String },
    timezone:        { type: String },
  },
  { _id: false }
);

/* ---------- Modelo principal ---------- */
const MetaAccountSchema = new Schema(
  {
    // Usuario (permite user o userId)
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    // Tokens (quedan ocultos por defecto)
    access_token:   { type: String, select: false },
    token:          { type: String, select: false },
    longlivedToken: { type: String, select: false }, // snake
    accessToken:    { type: String, select: false }, // camel
    longLivedToken: { type: String, select: false }, // camel

    // Expiración
    expires_at: { type: Date },
    expiresAt:  { type: Date },

    // Info del owner
    fb_user_id: { type: String },
    email:      { type: String },
    name:       { type: String },

    // Objetivo onboarding
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    // Cuentas / páginas
    ad_accounts: { type: [AdAccountSchema], default: [] }, // snake
    adAccounts:  { type: [AdAccountSchema], default: [] }, // camel
    pages:       { type: Array, default: [] },

    // Scopes concedidos (normalizados)
    scopes:      { type: [String], default: [], set: normScopes },

    // Cuenta por defecto (guardar sin act_)
    defaultAccountId: {
      type: String,
      set: (v) => normActId(v),
    },

    // Timestamps manuales por compatibilidad
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'metaaccounts',
    toJSON: {
      transform(_doc, ret) {
        // Ocultar campos sensibles si por alguna razón vinieran seleccionados
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

/* ---------- Índices ---------- */
MetaAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
MetaAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });

/* ---------- Virtuals & Methods ---------- */
// Virtual: obtener “algún” token disponible
MetaAccountSchema.virtual('accessTokenAny').get(function () {
  return this.longLivedToken || this.longlivedToken || this.access_token || this.accessToken || this.token || null;
});

// Método helper para setear todos los tokens de una
MetaAccountSchema.methods.setTokens = function (value) {
  this.longLivedToken = value;
  this.longlivedToken = value;
  this.access_token   = value;
  this.accessToken    = value;
  this.token          = value;
  return this;
};

/* ---------- Hooks ---------- */
MetaAccountSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

/* ---------- Export ---------- */
module.exports = mongoose.models.MetaAccount || model('MetaAccount', MetaAccountSchema);
