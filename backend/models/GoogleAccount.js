'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* ----------------- helpers ----------------- */
const stripDashes = (s = '') => s.toString().replace(/-/g, '').trim();
const normScopes = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) {
    return Array.from(
      new Set(v.map(x => String(x || '').trim().toLowerCase()).filter(Boolean))
    );
  }
  // Google OAuth suele devolver un string con scopes separados por espacio
  return Array.from(
    new Set(
      String(v)
        .split(/\s+/)
        .map(x => x.trim().toLowerCase())
        .filter(Boolean)
    )
  );
};

/* ----------------- subdoc: customer ----------------- */
const CustomerSchema = new Schema(
  {
    id: {
      type: String,
      set: (v) => stripDashes(v),             // 1234567890 (sin guiones)
    },
    resourceName: String,                      // customers/1234567890
    descriptiveName: String,                   // Nombre visible
    currencyCode: String,                      // e.g. MXN
    timeZone: String,                          // e.g. America/Mexico_City
  },
  { _id: false }
);

/* ----------------- main schema ----------------- */
const GoogleAccountSchema = new Schema(
  {
    // referencia al usuario (acepta user o userId)
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    // OAuth tokens
    accessToken:  { type: String, select: false },
    refreshToken: { type: String, select: false },
    scope:        {
      type: [String],
      default: [],
      set: normScopes,                        // normaliza/define scopes
    },
    expiresAt:    { type: Date },

    // MCC opcional para cabecera login-customer-id
    managerCustomerId: {
      type: String,
      set: (v) => stripDashes(v),
    },

    // cuentas accesibles y selección por defecto
    customers:         { type: [CustomerSchema], default: [] },
    defaultCustomerId: {
      type: String,                           // “1234567890” (sin guiones)
      set: (v) => stripDashes(v),
    },

    // objetivo del onboarding
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'googleaccounts',
    toJSON: {
      transform(_doc, ret) {
        delete ret.accessToken;
        delete ret.refreshToken;
        return ret;
      }
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.accessToken;
        delete ret.refreshToken;
        return ret;
      }
    }
  }
);

/* ----------------- índices ----------------- */
GoogleAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
GoogleAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });

/* ----------------- virtuales & métodos ----------------- */
// ¿Hay refresh token disponible?
GoogleAccountSchema.virtual('hasRefresh').get(function () {
  return !!this.refreshToken;
});

// Helper para setear tokens y expiración + scopes de una vez
GoogleAccountSchema.methods.setTokens = function ({
  access_token,
  refresh_token,
  expires_at,
  scope
} = {}) {
  if (access_token !== undefined) this.accessToken = access_token;
  if (refresh_token !== undefined) this.refreshToken = refresh_token;
  if (expires_at !== undefined)    this.expiresAt   = expires_at instanceof Date ? expires_at : new Date(expires_at);
  if (scope !== undefined)         this.scope       = normScopes(scope);
  return this;
};

/* ----------------- hooks ----------------- */
GoogleAccountSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  // normaliza ids de customers si vinieron con guiones
  if (Array.isArray(this.customers)) {
    this.customers = this.customers.map(c => ({
      ...c,
      id: stripDashes(c?.id),
      resourceName: c?.resourceName,
      descriptiveName: c?.descriptiveName,
      currencyCode: c?.currencyCode,
      timeZone: c?.timeZone,
    }));
  }
  next();
});

/* ----------------- export ----------------- */
module.exports =
  mongoose.models.GoogleAccount || model('GoogleAccount', GoogleAccountSchema);
