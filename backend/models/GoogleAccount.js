'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* ----------------- helpers internos ----------------- */
const stripDashes = (s = '') => s.toString().replace(/-/g, '').trim();
const normScopes = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) {
    return Array.from(new Set(v.map(x => String(x || '').trim().toLowerCase()).filter(Boolean)));
  }
  return Array.from(
    new Set(
      String(v)
        .split(/\s+/)
        .map(x => x.trim().toLowerCase())
        .filter(Boolean)
    )
  );
};
// Forzar "properties/123..." y quitar espacios
const normPropertyId = (val) => {
  if (!val) return '';
  const v = String(val).trim();
  if (/^properties\/\d+$/.test(v)) return v;
  const onlyDigits = v.replace(/[^\d]/g, '');
  return onlyDigits ? `properties/${onlyDigits}` : '';
};

/* ----------------- subdocs ----------------- */
const CustomerSchema = new Schema(
  {
    id: { type: String, set: (v) => stripDashes(v) }, // "1234567890"
    resourceName: String,                              // "customers/1234567890"
    descriptiveName: String,
    currencyCode: String,
    timeZone: String,
  },
  { _id: false }
);

const GaPropertySchema = new Schema(
  {
    propertyId: { type: String, index: true, set: normPropertyId }, // "properties/123456789"
    displayName: String,
    timeZone: String,
    currencyCode: String,
  },
  { _id: false }
);

/* ----------------- main schema ----------------- */
const GoogleAccountSchema = new Schema(
  {
    // referencia al usuario
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    // tokens
    accessToken:  { type: String, select: false },
    refreshToken: { type: String, select: false },
    scope:        { type: [String], default: [], set: normScopes },
    expiresAt:    { type: Date },

    // Google Ads
    managerCustomerId: { type: String, set: (v) => stripDashes(v) },
    customers:         { type: [CustomerSchema], default: [] },
    defaultCustomerId: { type: String, set: (v) => stripDashes(v) },

    // GA4
    gaProperties:      { type: [GaPropertySchema], default: [] },
    defaultPropertyId: { type: String, set: normPropertyId }, // "properties/123456789"

    // preferencia de objetivo en onboarding (Ads)
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
// NOTA: idealmente 1 documento por usuario (usa uno de los dos campos user/userId)
GoogleAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
GoogleAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });
GoogleAccountSchema.index({ 'gaProperties.propertyId': 1 });

/* ----------------- virtuals / instance methods ----------------- */
GoogleAccountSchema.virtual('hasRefresh').get(function () {
  return !!this.refreshToken;
});

GoogleAccountSchema.methods.setTokens = function ({
  access_token,
  refresh_token,
  expires_at,
  scope
} = {}) {
  if (access_token  !== undefined) this.accessToken  = access_token;
  if (refresh_token !== undefined) this.refreshToken = refresh_token;
  if (expires_at    !== undefined) this.expiresAt    = expires_at instanceof Date ? expires_at : new Date(expires_at);
  if (scope         !== undefined) this.scope        = normScopes(scope);
  return this;
};

// Setear gaProperties deduplicando por propertyId
GoogleAccountSchema.methods.setGaProperties = function (list = []) {
  const normalized = (Array.isArray(list) ? list : [])
    .map(p => ({
      propertyId:  normPropertyId(p?.propertyId || p?.name || ''),
      displayName: p?.displayName || p?.name || '',
      timeZone:    p?.timeZone || null,
      currencyCode:p?.currencyCode || null,
    }))
    .filter(p => p.propertyId);

  const map = new Map();
  for (const p of normalized) map.set(p.propertyId, p);
  this.gaProperties = Array.from(map.values()).sort((a, b) =>
    a.propertyId.localeCompare(b.propertyId)
  );
  return this;
};

// CustomerId por defecto (fallback al primer customer)
GoogleAccountSchema.methods.getDefaultCustomerId = function () {
  const cid = this.defaultCustomerId || this.customers?.[0]?.id || '';
  return cid ? stripDashes(cid) : '';
};

// PropertyId por defecto (formato "properties/123")
GoogleAccountSchema.methods.getDefaultPropertyId = function () {
  return this.defaultPropertyId || this.gaProperties?.[0]?.propertyId || '';
};

// Poblar customers desde listAccessibleCustomers (array de "customers/123...")
GoogleAccountSchema.methods.setCustomersFromResourceNames = function (resourceNames = []) {
  const list = Array.isArray(resourceNames) ? resourceNames : [];
  this.customers = list.map(rn => {
    const id = String(rn || '').split('/')[1] || '';
    return { id: stripDashes(id), resourceName: rn };
  });
  if (!this.defaultCustomerId && this.customers[0]?.id) {
    this.defaultCustomerId = this.customers[0].id;
  }
  return this;
};

/* ----------------- statics ----------------- */
// Recuperar el documento incluyendo tokens (ignora select:false)
GoogleAccountSchema.statics.findWithTokens = function (query = {}) {
  return this.findOne(query).select('+accessToken +refreshToken');
};

/* ----------------- hooks ----------------- */
GoogleAccountSchema.pre('save', function(next) {
  this.updatedAt = new Date();

  // normaliza customers
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

  // normaliza y dedupe gaProperties
  if (Array.isArray(this.gaProperties)) {
    const map = new Map();
    for (const p of this.gaProperties) {
      const pid = normPropertyId(p?.propertyId);
      if (!pid) continue;
      map.set(pid, {
        propertyId:  pid,
        displayName: p?.displayName || '',
        timeZone:    p?.timeZone || null,
        currencyCode:p?.currencyCode || null,
      });
    }
    this.gaProperties = Array.from(map.values()).sort((a, b) =>
      a.propertyId.localeCompare(b.propertyId)
    );
  }

  // normaliza defaultPropertyId
  if (this.defaultPropertyId) {
    this.defaultPropertyId = normPropertyId(this.defaultPropertyId);
  }

  next();
});

module.exports = mongoose.models.GoogleAccount || model('GoogleAccount', GoogleAccountSchema);
