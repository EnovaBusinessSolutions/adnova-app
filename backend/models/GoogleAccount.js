'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* ----------------- helpers internos ----------------- */
const stripDashes = (s = '') => s.toString().replace(/-/g, '').trim();

const normCustomerId = (v = '') =>
  stripDashes(String(v).replace(/^customers\//, '').trim());

const normIdArr = (arr) =>
  Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map(normCustomerId)
        .filter(Boolean)
    )
  );

// scopes pueden venir separados por espacios o comas
const normScopes = (v) => {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,\s]+/);
  return Array.from(
    new Set(
      arr
        .map(x => String(x || '').trim().toLowerCase())
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

const normPropertyArr = (arr) =>
  Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map(normPropertyId)
        .filter(Boolean)
    )
  );

/* Scopes que nos interesan */
const ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GA_READ   = 'https://www.googleapis.com/auth/analytics.readonly';

/* ----------------- subdocs ----------------- */
const CustomerSchema = new Schema(
  {
    id: { type: String, set: (v) => normCustomerId(v) },   // "1234567890"
    resourceName: String,                                  // "customers/1234567890"
    descriptiveName: String,
    currencyCode: String,
    timeZone: String,
    status: String,
  },
  { _id: false }
);

const AdAccountSchema = new Schema(
  {
    id: { type: String, set: (v) => normCustomerId(v) },   // "1234567890"
    name: String,
    currencyCode: String,
    timeZone: String,
    status: String,
  },
  { _id: false }
);

const GaPropertySchema = new Schema(
  {
    propertyId:  { type: String, index: true, set: normPropertyId }, // "properties/123456789"
    displayName: String,
    timeZone:    String,
    currencyCode:String,
  },
  { _id: false }
);

/* ----------------- main schema ----------------- */
const GoogleAccountSchema = new Schema(
  {
    // referencia al usuario
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    // ✅ email del perfil (lo setea googleConnect.js)
    email: { type: String, index: true },

    // tokens (GENERAL) — hoy lo usa Ads (y legacy)
    accessToken:  { type: String, select: false },
    refreshToken: { type: String, select: false },
    scope:        { type: [String], default: [], set: normScopes },
    expiresAt:    { type: Date },

    // ✅ NUEVO: tokens GA4 SEPARADOS (para botón GA4)
    // (aditivo: no afecta el flujo actual de Ads)
    ga4AccessToken:  { type: String, select: false },
    ga4RefreshToken: { type: String, select: false },
    ga4Scope:        { type: [String], default: [], set: normScopes },
    ga4ExpiresAt:    { type: Date },
    ga4ConnectedAt:  { type: Date },

    // Google Ads
    managerCustomerId: { type: String, set: (v) => normCustomerId(v) }, // opcional
    loginCustomerId:   { type: String, set: (v) => normCustomerId(v) }, // MCC usado en headers
    customers:         { type: [CustomerSchema], default: [] },
    ad_accounts:       { type: [AdAccountSchema], default: [] },        // enriquecidas
    defaultCustomerId: { type: String, set: (v) => normCustomerId(v) },

    // ✅ Selección persistente (ids “123…”)
    selectedCustomerIds: {
      type: [String],
      default: [],
      set: normIdArr,
    },

    // GA4
    gaProperties:      { type: [GaPropertySchema], default: [] },
    defaultPropertyId: { type: String, set: normPropertyId }, // "properties/123456789"

    // ✅ NUEVO (lo usa onboardingStatus.js): selección GA4 “oficial”
    selectedPropertyIds: {
      type: [String],
      default: [],
      set: normPropertyArr,
    },

    // ✅ LEGACY (lo setea googleConnect.js hoy): mantener para no romper
    // (guardamos 1 sola como string, pero internamente la sincronizamos con selectedPropertyIds)
    selectedGaPropertyId: { type: String, set: normPropertyId },

    // preferencia de objetivo en onboarding (Ads)
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    // ✅ Logs de discovery (los usa googleConnect.js / status)
    lastAdsDiscoveryError: { type: String, default: null },
    lastAdsDiscoveryLog:   { type: Schema.Types.Mixed, default: null, select: false },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'googleaccounts',
    toJSON: {
      transform(_doc, ret) {
        delete ret.accessToken;
        delete ret.refreshToken;
        delete ret.ga4AccessToken;
        delete ret.ga4RefreshToken;
        return ret;
      }
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.accessToken;
        delete ret.refreshToken;
        delete ret.ga4AccessToken;
        delete ret.ga4RefreshToken;
        return ret;
      }
    }
  }
);

/* ----------------- índices ----------------- */
// Ideal: 1 documento por usuario (usa ambos campos user/userId con el mismo _id)
GoogleAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
GoogleAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });
GoogleAccountSchema.index({ 'gaProperties.propertyId': 1 });
GoogleAccountSchema.index({ user: 1, selectedCustomerIds: 1 });
GoogleAccountSchema.index({ user: 1, selectedPropertyIds: 1 });

/* ----------------- virtuals / instance methods ----------------- */
GoogleAccountSchema.virtual('hasRefresh').get(function () {
  return !!this.refreshToken;
});

GoogleAccountSchema.virtual('hasAdsScope').get(function () {
  return (this.scope || []).includes(ADS_SCOPE);
});
GoogleAccountSchema.virtual('hasGaScope').get(function () {
  return (this.scope || []).includes(GA_READ);
});

GoogleAccountSchema.methods.needsReauth = function () {
  if (!this.expiresAt) return false; // si usamos refreshToken nos da igual
  return Date.now() > new Date(this.expiresAt).getTime() - 60_000; // 1 minuto de colchón
};

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
  return cid ? normCustomerId(cid) : '';
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
    return { id: normCustomerId(id), resourceName: rn };
  });
  if (!this.defaultCustomerId && this.customers[0]?.id) {
    this.defaultCustomerId = this.customers[0].id;
  }
  return this;
};

// Setear ad_accounts con normalización/dedupe
GoogleAccountSchema.methods.setAdAccounts = function (arr = []) {
  const list = Array.isArray(arr) ? arr : [];
  const map = new Map();
  for (const a of list) {
    const id = normCustomerId(a?.id);
    if (!id) continue;
    map.set(id, {
      id,
      name: a?.name || a?.descriptiveName || `Cuenta ${id}`,
      currencyCode: a?.currencyCode || a?.currency || null,
      timeZone: a?.timeZone || a?.timezone || null,
      status: a?.status || null,
    });
  }
  this.ad_accounts = Array.from(map.values());
  return this;
};

/* ----------------- statics ----------------- */
GoogleAccountSchema.statics.findWithTokens = function (query = {}) {
  return this.findOne(query).select('+accessToken +refreshToken');
};
GoogleAccountSchema.statics.loadForUserWithTokens = function (userId) {
  return this.findOne({ $or: [{ user: userId }, { userId }] }).select('+accessToken +refreshToken');
};

/* ----------------- hooks ----------------- */
GoogleAccountSchema.pre('save', function(next) {
  this.updatedAt = new Date();

  // normaliza customers
  if (Array.isArray(this.customers)) {
    this.customers = this.customers.map(c => ({
      ...c,
      id: normCustomerId(c?.id),
      resourceName: c?.resourceName,
      descriptiveName: c?.descriptiveName,
      currencyCode: c?.currencyCode,
      timeZone: c?.timeZone,
      status: c?.status,
    }));
  }

  // normaliza ad_accounts
  if (Array.isArray(this.ad_accounts)) {
    const map = new Map();
    for (const a of this.ad_accounts) {
      const id = normCustomerId(a?.id);
      if (!id) continue;
      map.set(id, {
        id,
        name: a?.name || a?.descriptiveName || `Cuenta ${id}`,
        currencyCode: a?.currencyCode || a?.currency || null,
        timeZone: a?.timeZone || a?.timezone || null,
        status: a?.status || null,
      });
    }
    this.ad_accounts = Array.from(map.values());
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

  // normaliza IDs por si entran con guiones o formatos raros
  if (this.defaultCustomerId) this.defaultCustomerId = normCustomerId(this.defaultCustomerId);
  if (this.managerCustomerId) this.managerCustomerId = normCustomerId(this.managerCustomerId);
  if (this.loginCustomerId)   this.loginCustomerId   = normCustomerId(this.loginCustomerId);
  if (this.defaultPropertyId) this.defaultPropertyId = normPropertyId(this.defaultPropertyId);

  // ---------- selección Ads: dedupe + filtrar a lo disponible ----------
  if (Array.isArray(this.selectedCustomerIds)) {
    const norm = normIdArr(this.selectedCustomerIds);

    // disponible puede venir por customers o por ad_accounts
    const available = new Set([
      ...(Array.isArray(this.customers) ? this.customers.map(c => c.id) : []),
      ...(Array.isArray(this.ad_accounts) ? this.ad_accounts.map(a => a.id) : []),
    ].filter(Boolean));

    // si no tenemos catálogo aún, NO recortamos (para no perder selección por carrera)
    this.selectedCustomerIds = available.size ? norm.filter(id => available.has(id)) : norm;
  }

  // ---------- selección GA4: mantener consistencia ----------
  // 1) normaliza arrays
  if (Array.isArray(this.selectedPropertyIds)) {
    const norm = normPropertyArr(this.selectedPropertyIds);

    const available = new Set(
      (Array.isArray(this.gaProperties) ? this.gaProperties : [])
        .map(p => p.propertyId)
        .filter(Boolean)
    );

    // si no hay catálogo, NO recortamos (evita carreras)
    this.selectedPropertyIds = available.size ? norm.filter(pid => available.has(pid)) : norm;
  } else {
    this.selectedPropertyIds = [];
  }

  // 2) si llega legacy selectedGaPropertyId, lo reflejamos en selectedPropertyIds si no hay nada
  if (this.selectedGaPropertyId) {
    this.selectedGaPropertyId = normPropertyId(this.selectedGaPropertyId);
    if (!this.selectedPropertyIds?.length) {
      this.selectedPropertyIds = [this.selectedGaPropertyId];
    }
  }

  // 3) si llega selectedPropertyIds y no hay legacy, lo rellenamos (1ro)
  if (this.selectedPropertyIds?.length && !this.selectedGaPropertyId) {
    this.selectedGaPropertyId = this.selectedPropertyIds[0];
  }

  next();
});

module.exports = mongoose.models.GoogleAccount || model('GoogleAccount', GoogleAccountSchema);
