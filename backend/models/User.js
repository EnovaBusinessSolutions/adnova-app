// backend/models/User.js
'use strict';

const mongoose = require('mongoose');

/* ---------------- normalizadores ---------------- */
const normMetaId = (s = '') =>
  String(s).trim().replace(/^act_/, '').replace(/\s+/g, '');

const normGoogleId = (s = '') =>
  String(s).trim().replace(/^customers\//, '').replace(/-/g, '').replace(/\s+/g, '');

// "properties/123" (o "123" → "properties/123")
const normGaPropertyId = (val = '') => {
  const v = String(val || '').trim();
  if (/^properties\/\d+$/.test(v)) return v;
  const digits = v.replace(/[^\d]/g, '');
  return digits ? `properties/${digits}` : '';
};

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

function normalizeArray(arr, normFn) {
  const out = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const n = normFn(v);
    if (n) out.add(n);
  }
  return Array.from(out);
}

function normName(v = '') {
  // ✅ normaliza whitespace (sin “poner” mayúsculas forzadas)
  return String(v || '').replace(/\s+/g, ' ').trim();
}

/* ---------------- sub-schema de suscripción (Stripe) ---------------- */
const subscriptionSchema = new mongoose.Schema(
  {
    id: { type: String }, // subscription.id de Stripe
    status: { type: String, default: 'inactive' }, // incomplete | active | trialing | ...
    priceId: { type: String },                     // price_xxx
    plan: {
      type: String,
      enum: ['emprendedor', 'crecimiento', 'pro', 'enterprise', 'gratis'],
    },
    currentPeriodEnd: { type: Date },
    cancel_at_period_end: { type: Boolean, default: false },

    // Facturapi / facturación
    lastCfdiId: { type: String },
    lastCfdiTotal: { type: Number },
    lastStripeInvoice: { type: String },
  },
  { _id: false }
);

/* ---------------- schema principal ---------------- */
const userSchema = new mongoose.Schema(
  {
    // ✅ NUEVO: nombre (para emails personalizados)
    name: { type: String, trim: true, default: '', set: normName },

    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String },

    onboardingComplete: { type: Boolean, default: false },

    // ✅ NUEVO: verificación de correo
    // - emailVerified undefined en usuarios legacy => NO bloquea login si tú lo manejas así
    emailVerified: { type: Boolean, default: false, index: true },
    verifyEmailTokenHash: { type: String, index: true },
    verifyEmailExpires: { type: Date, index: true },

    // Shopify
    shop: { type: String },
    shopifyConnected: { type: Boolean, default: false },
    shopifyAccessToken: { type: String },
    shopifyScopeHash: { type: Number },
    shopifyScopeHashUpdatedAt: { type: Number },

    // Google (OAuth atajo legado, opcional)
    googleAccessToken: { type: String },
    googleRefreshToken: { type: String },
    googleConnected: { type: Boolean, default: false },

    // ✅ Objetivo (lo usas en /api/session y lo setean rutas)
    googleObjective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    // Meta (OAuth atajo legado, opcional)
    metaConnected: { type: Boolean, default: false },
    metaAccessToken: { type: String },

    // ✅ Datos meta “legacy” que tu código puede setear/leer
    metaFbUserId: { type: String },
    metaTokenExpiresAt: { type: Date },
    metaDefaultAccountId: { type: String, set: normMetaId },
    metaScopes: { type: [String], default: [], set: normScopes },

    // ✅ Objetivo meta (lo usas en /api/session y lo setean rutas)
    metaObjective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    // === Selección de cuentas (UI / retrocompat) ===
    // Nota: aquí guardamos SIN "act_" ni "customers/" para consistencia.
    selectedMetaAccounts: {
      type: [String],
      default: [],
      set: (arr) => normalizeArray(arr, normMetaId),
    },
    selectedGoogleAccounts: {
      type: [String],
      default: [],
      set: (arr) => normalizeArray(arr, normGoogleId),
    },

    // === Preferencias de auditoría ===
    preferences: {
      googleAnalytics: {
        auditPropertyIds: {
          type: [String],
          default: [],
          set: (arr) => normalizeArray(arr, normGaPropertyId),
        },
      },
      googleAds: {
        auditAccountIds: {
          type: [String],
          default: [],
          set: (arr) => normalizeArray(arr, normGoogleId),
        },
      },
      meta: {
        auditAccountIds: {
          type: [String],
          default: [],
          set: (arr) => normalizeArray(arr, normMetaId),
        },
      },
    },

    // (LEGACY opcional) por si tuvieras código viejo leyendo esto
    // ⚠️ Nombre alineado con onboardingStatus.js → selectedGAProperties
    selectedGAProperties: {
      type: [String],
      default: [],
      set: (arr) => normalizeArray(arr, normGaPropertyId),
    },

    // Recuperación y planes
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },

    stripeCustomerId: { type: String },

    plan: {
      type: String,
      enum: ['gratis', 'emprendedor', 'crecimiento', 'pro', 'enterprise'],
      default: 'gratis',
      index: true,
    },
    planStartedAt: { type: Date, default: Date.now },

    subscription: subscriptionSchema,
  },
  { timestamps: true }
);

/* ---------------- índices útiles ---------------- */
userSchema.index({ plan: 1 });

// Opcional extra (útil si quieres limpiar tokens expirados)
userSchema.index({ verifyEmailExpires: 1 }, { sparse: true });

/* ---------------- hooks ---------------- */
userSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.name = normName(this.name);
  }

  if (this.isModified('selectedMetaAccounts')) {
    this.selectedMetaAccounts = normalizeArray(this.selectedMetaAccounts, normMetaId);
  }
  if (this.isModified('selectedGoogleAccounts')) {
    this.selectedGoogleAccounts = normalizeArray(this.selectedGoogleAccounts, normGoogleId);
  }

  // Asegura normalización de GA4 tanto en preferences como en legacy
  if (this.isModified('preferences') && this.preferences?.googleAnalytics?.auditPropertyIds) {
    this.preferences.googleAnalytics.auditPropertyIds =
      normalizeArray(this.preferences.googleAnalytics.auditPropertyIds, normGaPropertyId);
  }
  if (this.isModified('selectedGAProperties')) {
    this.selectedGAProperties = normalizeArray(this.selectedGAProperties, normGaPropertyId);
  }

  if (this.isModified('metaScopes')) {
    this.metaScopes = normScopes(this.metaScopes);
  }
  if (this.isModified('metaDefaultAccountId') && this.metaDefaultAccountId) {
    this.metaDefaultAccountId = normMetaId(this.metaDefaultAccountId);
  }

  // Si cambia el plan, actualizamos fecha de inicio
  if (this.isModified('plan')) {
    this.planStartedAt = new Date();
  }

  next();
});

/* ---------------- helpers estáticos convenientes ---------------- */
userSchema.statics.setSelectedMetaAccounts = async function (userId, ids = []) {
  const normalized = normalizeArray(ids, normMetaId);
  await this.updateOne({ _id: userId }, { $set: { selectedMetaAccounts: normalized } });
  return normalized;
};

userSchema.statics.setSelectedGoogleAccounts = async function (userId, ids = []) {
  const normalized = normalizeArray(ids, normGoogleId);
  await this.updateOne({ _id: userId }, { $set: { selectedGoogleAccounts: normalized } });
  return normalized;
};

// Guardar preferencia GA4 “oficial” que leen tus endpoints (preferences)
userSchema.statics.setGaAuditProperties = async function (userId, propertyIds = []) {
  const normalized = normalizeArray(propertyIds, normGaPropertyId);
  await this.updateOne(
    { _id: userId },
    { $set: { 'preferences.googleAnalytics.auditPropertyIds': normalized } }
  );
  return normalized;
};

// ✅ NUEVO: mantener GA4 E2E sin romper legacy (guarda en ambos)
userSchema.statics.setSelectedGA4Properties = async function (userId, propertyIds = []) {
  const normalized = normalizeArray(propertyIds, normGaPropertyId);
  await this.updateOne(
    { _id: userId },
    {
      $set: {
        selectedGAProperties: normalized,
        'preferences.googleAnalytics.auditPropertyIds': normalized,
      },
    }
  );
  return normalized;
};

module.exports = mongoose.model('User', userSchema);
