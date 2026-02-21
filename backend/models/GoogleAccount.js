'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* ----------------- helpers internos ----------------- */
const stripDashes = (s = '') => s.toString().replace(/-/g, '').trim();

const normCustomerId = (v = '') =>
  stripDashes(String(v).replace(/^customers\//, '').trim());

const normIdArr = (arr) =>
  Array.from(
    new Set((Array.isArray(arr) ? arr : []).map(normCustomerId).filter(Boolean))
  );

// scopes pueden venir separados por espacios o comas
const normScopes = (v) => {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,\s]+/);
  return Array.from(
    new Set(
      arr
        .map((x) => String(x || '').trim())
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
    new Set((Array.isArray(arr) ? arr : []).map(normPropertyId).filter(Boolean))
  );

/* Scopes que nos interesan */
const ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GA_READ = 'https://www.googleapis.com/auth/analytics.readonly';

/* ----------------- subdocs ----------------- */
const CustomerSchema = new Schema(
  {
    id: { type: String, set: (v) => normCustomerId(v) }, // "1234567890"
    resourceName: String, // "customers/1234567890"
    descriptiveName: String,
    currencyCode: String,
    timeZone: String,
    status: String,
  },
  { _id: false }
);

const AdAccountSchema = new Schema(
  {
    id: { type: String, set: (v) => normCustomerId(v) }, // "1234567890"
    name: String,
    currencyCode: String,
    timeZone: String,
    status: String,
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
    user: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    // email del perfil (lo setea googleConnect.js)
    email: { type: String, index: true, default: null },

    /* =========================
     * Tokens ADS (default / legacy)
     * ========================= */
    accessToken: { type: String, select: false, default: null },
    refreshToken: { type: String, select: false, default: null },
    scope: { type: [String], default: [], set: normScopes },
    expiresAt: { type: Date, default: null },

    /* =========================
     * Tokens GA4 (separados)
     * ========================= */
    ga4AccessToken: { type: String, select: false, default: null },
    ga4RefreshToken: { type: String, select: false, default: null },
    ga4Scope: { type: [String], default: [], set: normScopes },
    ga4ExpiresAt: { type: Date, default: null },
    ga4ConnectedAt: { type: Date, default: null },

    /* =========================
     * Flags explícitos por producto (CRÍTICO para E2E)
     * ========================= */
    connectedAds: { type: Boolean, default: false },
    connectedGa4: { type: Boolean, default: false },

    /* =========================
     * Google Ads
     * ========================= */
    managerCustomerId: { type: String, set: (v) => normCustomerId(v), default: null },
    loginCustomerId: { type: String, set: (v) => normCustomerId(v), default: null },
    customers: { type: [CustomerSchema], default: [] },
    ad_accounts: { type: [AdAccountSchema], default: [] },
    defaultCustomerId: { type: String, set: (v) => normCustomerId(v), default: null },

    selectedCustomerIds: {
      type: [String],
      default: [],
      set: normIdArr,
    },

    /* =========================
     * GA4
     * ========================= */
    gaProperties: { type: [GaPropertySchema], default: [] },
    defaultPropertyId: { type: String, set: normPropertyId, default: null },

    selectedPropertyIds: {
      type: [String],
      default: [],
      set: normPropertyArr,
    },

    // legacy (no romper)
    selectedGaPropertyId: { type: String, set: normPropertyId, default: null },

    /* =========================
     * Preferencias / logs
     * ========================= */
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    lastAdsDiscoveryError: { type: String, default: null },
    lastAdsDiscoveryLog: { type: Schema.Types.Mixed, default: null, select: false },

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
      },
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.accessToken;
        delete ret.refreshToken;
        delete ret.ga4AccessToken;
        delete ret.ga4RefreshToken;
        return ret;
      },
    },
  }
);

/* ----------------- índices ----------------- */
GoogleAccountSchema.index({ user: 1 }, { unique: true, sparse: true });
GoogleAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });
GoogleAccountSchema.index({ 'gaProperties.propertyId': 1 });
GoogleAccountSchema.index({ user: 1, selectedCustomerIds: 1 });
GoogleAccountSchema.index({ user: 1, selectedPropertyIds: 1 });

/* ----------------- virtuals / instance methods ----------------- */
GoogleAccountSchema.virtual('hasRefresh').get(function () {
  return !!(this.refreshToken || this.ga4RefreshToken);
});

GoogleAccountSchema.virtual('hasAdsScope').get(function () {
  const s = Array.isArray(this.scope) ? this.scope : [];
  return s.includes(ADS_SCOPE);
});

GoogleAccountSchema.virtual('hasGaScope').get(function () {
  const s1 = Array.isArray(this.scope) ? this.scope : [];
  const s2 = Array.isArray(this.ga4Scope) ? this.ga4Scope : [];
  return s1.includes(GA_READ) || s2.includes(GA_READ);
});

GoogleAccountSchema.methods.needsReauth = function () {
  // Si tenemos refreshToken, expiración no es crítica
  if (this.refreshToken || this.ga4RefreshToken) return false;
  if (!this.expiresAt && !this.ga4ExpiresAt) return false;

  const now = Date.now();
  const a = this.expiresAt ? new Date(this.expiresAt).getTime() : null;
  const g = this.ga4ExpiresAt ? new Date(this.ga4ExpiresAt).getTime() : null;

  const soon = (t) => (typeof t === 'number' ? now > t - 60_000 : false);
  return soon(a) || soon(g);
};

/**
 * Tokens ADS (legacy)
 */
GoogleAccountSchema.methods.setTokens = function ({
  access_token,
  refresh_token,
  expires_at,
  scope,
} = {}) {
  if (access_token !== undefined) this.accessToken = access_token;
  if (refresh_token !== undefined) this.refreshToken = refresh_token;
  if (expires_at !== undefined)
    this.expiresAt = expires_at instanceof Date ? expires_at : new Date(expires_at);
  if (scope !== undefined) this.scope = normScopes(scope);
  return this;
};

/**
 * Tokens GA4 (separado)
 */
GoogleAccountSchema.methods.setGa4Tokens = function ({
  access_token,
  refresh_token,
  expires_at,
  scope,
} = {}) {
  if (access_token !== undefined) this.ga4AccessToken = access_token;
  if (refresh_token !== undefined) this.ga4RefreshToken = refresh_token;
  if (expires_at !== undefined)
    this.ga4ExpiresAt = expires_at instanceof Date ? expires_at : new Date(expires_at);
  if (scope !== undefined) this.ga4Scope = normScopes(scope);
  if (refresh_token || access_token) this.ga4ConnectedAt = new Date();
  return this;
};

// Setear gaProperties deduplicando por propertyId
GoogleAccountSchema.methods.setGaProperties = function (list = []) {
  const normalized = (Array.isArray(list) ? list : [])
    .map((p) => ({
      propertyId: normPropertyId(p?.propertyId || p?.name || ''),
      displayName: p?.displayName || p?.name || '',
      timeZone: p?.timeZone || null,
      currencyCode: p?.currencyCode || null,
    }))
    .filter((p) => p.propertyId);

  const map = new Map();
  for (const p of normalized) map.set(p.propertyId, p);
  this.gaProperties = Array.from(map.values()).sort((a, b) =>
    a.propertyId.localeCompare(b.propertyId)
  );
  return this;
};

GoogleAccountSchema.methods.getDefaultCustomerId = function () {
  const cid = this.defaultCustomerId || this.customers?.[0]?.id || '';
  return cid ? normCustomerId(cid) : '';
};

GoogleAccountSchema.methods.getDefaultPropertyId = function () {
  return this.defaultPropertyId || this.gaProperties?.[0]?.propertyId || '';
};

GoogleAccountSchema.methods.setCustomersFromResourceNames = function (resourceNames = []) {
  const list = Array.isArray(resourceNames) ? resourceNames : [];
  this.customers = list.map((rn) => {
    const id = String(rn || '').split('/')[1] || '';
    return { id: normCustomerId(id), resourceName: rn };
  });
  if (!this.defaultCustomerId && this.customers[0]?.id) {
    this.defaultCustomerId = this.customers[0].id;
  }
  return this;
};

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
  return this.findOne(query).select(
    '+accessToken +refreshToken +ga4AccessToken +ga4RefreshToken'
  );
};

GoogleAccountSchema.statics.loadForUserWithTokens = function (userId) {
  return this.findOne({ $or: [{ user: userId }, { userId }] }).select(
    '+accessToken +refreshToken +ga4AccessToken +ga4RefreshToken'
  );
};

/* ----------------- hooks ----------------- */
GoogleAccountSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  // normaliza customers
  if (Array.isArray(this.customers)) {
    this.customers = this.customers.map((c) => ({
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
        propertyId: pid,
        displayName: p?.displayName || '',
        timeZone: p?.timeZone || null,
        currencyCode: p?.currencyCode || null,
      });
    }
    this.gaProperties = Array.from(map.values()).sort((a, b) =>
      a.propertyId.localeCompare(b.propertyId)
    );
  }

  // normaliza IDs
  if (this.defaultCustomerId) this.defaultCustomerId = normCustomerId(this.defaultCustomerId);
  if (this.managerCustomerId) this.managerCustomerId = normCustomerId(this.managerCustomerId);
  if (this.loginCustomerId) this.loginCustomerId = normCustomerId(this.loginCustomerId);
  if (this.defaultPropertyId) this.defaultPropertyId = normPropertyId(this.defaultPropertyId);

  // ---------- selección Ads: dedupe + filtrar a lo disponible ----------
  if (Array.isArray(this.selectedCustomerIds)) {
    const norm = normIdArr(this.selectedCustomerIds);

    const available = new Set(
      [
        ...(Array.isArray(this.customers) ? this.customers.map((c) => c.id) : []),
        ...(Array.isArray(this.ad_accounts) ? this.ad_accounts.map((a) => a.id) : []),
      ].filter(Boolean)
    );

    this.selectedCustomerIds = available.size ? norm.filter((id) => available.has(id)) : norm;
  }

  // ---------- selección GA4: mantener consistencia ----------
  if (Array.isArray(this.selectedPropertyIds)) {
    const norm = normPropertyArr(this.selectedPropertyIds);

    const available = new Set(
      (Array.isArray(this.gaProperties) ? this.gaProperties : [])
        .map((p) => p.propertyId)
        .filter(Boolean)
    );

    this.selectedPropertyIds = available.size ? norm.filter((pid) => available.has(pid)) : norm;
  } else {
    this.selectedPropertyIds = [];
  }

  // legacy mirror
  if (this.selectedGaPropertyId) {
    this.selectedGaPropertyId = normPropertyId(this.selectedGaPropertyId);
    if (!this.selectedPropertyIds?.length) this.selectedPropertyIds = [this.selectedGaPropertyId];
  }
  if (this.selectedPropertyIds?.length && !this.selectedGaPropertyId) {
    this.selectedGaPropertyId = this.selectedPropertyIds[0];
  }

  next();
});

module.exports = mongoose.models.GoogleAccount || model('GoogleAccount', GoogleAccountSchema);