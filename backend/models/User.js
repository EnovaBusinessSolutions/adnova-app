// backend/models/User.js
'use strict';

const mongoose = require('mongoose');

/* ---------------- normalizadores ---------------- */
const normMetaId = (s = '') =>
  String(s).trim().replace(/^act_/, '').replace(/\s+/g, '');

const normGoogleId = (s = '') =>
  String(s).trim().replace(/^customers\//, '').replace(/-/g, '').replace(/\s+/g, '');

// "properties/123" (o "123" -> "properties/123")
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
        .map((x) => String(x || '').trim().toLowerCase())
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
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function normUrl(v = '') {
  const s = String(v || '').trim();
  return s || null;
}

function normSimpleString(v = '') {
  const s = String(v || '').trim();
  return s || null;
}

function normEmail(v = '') {
  const s = String(v || '').trim().toLowerCase();
  return s || null;
}

function normTimezone(v = '') {
  const s = String(v || '').trim();
  return s || 'America/Mexico_City';
}

function normDailyStatus(v = '') {
  const s = String(v || '').trim().toLowerCase();
  const allowed = new Set([
    'idle',
    'scheduled',
    'building_signal',
    'building_pdf',
    'sending',
    'sent',
    'failed',
  ]);
  return allowed.has(s) ? s : 'idle';
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

/* ---------------- sub-schema de suscripción (Stripe) ---------------- */
const subscriptionSchema = new mongoose.Schema(
  {
    id: { type: String },
    status: { type: String, default: 'inactive' },
    priceId: { type: String },
    plan: {
      type: String,
      enum: ['emprendedor', 'crecimiento', 'pro', 'enterprise', 'gratis'],
    },
    currentPeriodEnd: { type: Date },
    cancel_at_period_end: { type: Boolean, default: false },

    lastCfdiId: { type: String },
    lastCfdiTotal: { type: Number },
    lastStripeInvoice: { type: String },
  },
  { _id: false }
);

/* ---------------- sub-schema de delivery diario Signal/PDF ---------------- */
const dailySignalDeliverySchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false, index: true },

    email: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      set: normEmail,
    },

    timezone: {
      type: String,
      default: 'America/Mexico_City',
      trim: true,
      set: normTimezone,
    },

    sendHour: {
      type: Number,
      default: 5,
      min: 0,
      max: 23,
      set: (v) => clampInt(v, 0, 23, 5),
    },

    sendMinute: {
      type: Number,
      default: 0,
      min: 0,
      max: 59,
      set: (v) => clampInt(v, 0, 59, 0),
    },

    optedInAt: { type: Date, default: null },
    optedOutAt: { type: Date, default: null },

    lastAttemptAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: null },
    lastErrorAt: { type: Date, default: null },

    lastError: {
      type: String,
      default: null,
      set: normSimpleString,
    },

    status: {
      type: String,
      enum: ['idle', 'scheduled', 'building_signal', 'building_pdf', 'sending', 'sent', 'failed'],
      default: 'idle',
      set: normDailyStatus,
    },
  },
  { _id: false }
);

/* ---------------- schema principal ---------------- */
const userSchema = new mongoose.Schema(
  {
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

    googleId: { type: String, index: true, sparse: true },

    welcomeEmailSent: { type: Boolean, default: false, index: true },
    welcomeEmailSentAt: { type: Date, default: null },

    onboardingComplete: { type: Boolean, default: false },

    emailVerified: { type: Boolean, default: false, index: true },
    verifyEmailTokenHash: { type: String, index: true },
    verifyEmailExpires: { type: Date, index: true },

    /**
     * ============================
     * Analítica (conveniencia)
     * ============================
     */
    lastLoginAt: { type: Date, default: null, index: true },
    lastLoginMethod: {
      type: String,
      enum: ['google', 'password', 'magic_link', 'other', null],
      default: null,
      index: true,
    },

    // Shopify
    shop: { type: String },
    shopifyConnected: { type: Boolean, default: false },
    shopifyAccessToken: { type: String },
    shopifyScopeHash: { type: Number },
    shopifyScopeHashUpdatedAt: { type: Number },

    // Google
    googleAccessToken: { type: String },
    googleRefreshToken: { type: String },
    googleConnected: { type: Boolean, default: false },

    googleObjective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    // Meta
    metaConnected: { type: Boolean, default: false },
    metaAccessToken: { type: String },

    metaFbUserId: { type: String },
    metaTokenExpiresAt: { type: Date },
    metaDefaultAccountId: { type: String, set: normMetaId },
    metaScopes: { type: [String], default: [], set: normScopes },

    metaObjective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    // === Selección de cuentas ===
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

    // (LEGACY) seleccionado GA4
    selectedGAProperties: {
      type: [String],
      default: [],
      set: (arr) => normalizeArray(arr, normGaPropertyId),
    },

    // === MCP Share Link (link único estable por usuario) ===
    mcpShareToken: {
      type: String,
      default: null,
      index: true,
      sparse: true,
      trim: true,
      set: normSimpleString,
    },
    mcpShareEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    mcpShareProvider: {
      type: String,
      enum: ['chatgpt', 'claude', 'gemini'],
      default: 'chatgpt',
    },

    // Link bonito / estable que ve el usuario
    mcpShareShortUrl: {
      type: String,
      default: null,
      trim: true,
      set: normUrl,
    },

    // Link real/versionado que consume el LLM
    mcpShareVersionedUrl: {
      type: String,
      default: null,
      trim: true,
      set: normUrl,
    },

    // Versión técnica del link versionado (snapshotId, generatedAt, etc.)
    mcpShareVersion: {
      type: String,
      default: null,
      trim: true,
      set: normSimpleString,
    },

    // Snapshot actualmente asociado a la URL versionada
    mcpShareSnapshotId: {
      type: String,
      default: null,
      trim: true,
      set: normSimpleString,
    },

    mcpShareCreatedAt: {
      type: Date,
      default: null,
    },
    mcpShareRevokedAt: {
      type: Date,
      default: null,
    },
    mcpShareLastGeneratedAt: {
      type: Date,
      default: null,
    },

    // === Daily Signal Delivery ===
    dailySignalDelivery: {
      type: dailySignalDeliverySchema,
      default: () => ({}),
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
userSchema.index({ verifyEmailExpires: 1 }, { sparse: true });
userSchema.index({ welcomeEmailSent: 1, createdAt: -1 });

// MCP link único por usuario
userSchema.index({ mcpShareToken: 1 }, { sparse: true });
userSchema.index({ mcpShareEnabled: 1, mcpShareToken: 1 }, { sparse: true });
userSchema.index({ mcpShareEnabled: 1, mcpShareProvider: 1 }, { sparse: true });

// Daily Signal Delivery
userSchema.index({ 'dailySignalDelivery.enabled': 1 });
userSchema.index({
  'dailySignalDelivery.enabled': 1,
  'dailySignalDelivery.sendHour': 1,
  'dailySignalDelivery.sendMinute': 1,
});

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

  if (this.isModified('preferences') && this.preferences?.googleAnalytics?.auditPropertyIds) {
    this.preferences.googleAnalytics.auditPropertyIds = normalizeArray(
      this.preferences.googleAnalytics.auditPropertyIds,
      normGaPropertyId
    );
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

  if (this.isModified('mcpShareToken')) {
    this.mcpShareToken = normSimpleString(this.mcpShareToken);
  }

  if (this.isModified('mcpShareShortUrl')) {
    this.mcpShareShortUrl = normUrl(this.mcpShareShortUrl);
  }

  if (this.isModified('mcpShareVersionedUrl')) {
    this.mcpShareVersionedUrl = normUrl(this.mcpShareVersionedUrl);
  }

  if (this.isModified('mcpShareVersion')) {
    this.mcpShareVersion = normSimpleString(this.mcpShareVersion);
  }

  if (this.isModified('mcpShareSnapshotId')) {
    this.mcpShareSnapshotId = normSimpleString(this.mcpShareSnapshotId);
  }

  if (this.isModified('dailySignalDelivery')) {
    if (!this.dailySignalDelivery) {
      this.dailySignalDelivery = {};
    }

    if ('email' in this.dailySignalDelivery) {
      this.dailySignalDelivery.email = normEmail(this.dailySignalDelivery.email);
    }

    if ('timezone' in this.dailySignalDelivery) {
      this.dailySignalDelivery.timezone = normTimezone(this.dailySignalDelivery.timezone);
    }

    if ('sendHour' in this.dailySignalDelivery) {
      this.dailySignalDelivery.sendHour = clampInt(this.dailySignalDelivery.sendHour, 0, 23, 5);
    }

    if ('sendMinute' in this.dailySignalDelivery) {
      this.dailySignalDelivery.sendMinute = clampInt(this.dailySignalDelivery.sendMinute, 0, 59, 0);
    }

    if ('lastError' in this.dailySignalDelivery) {
      this.dailySignalDelivery.lastError = normSimpleString(this.dailySignalDelivery.lastError);
    }

    if ('status' in this.dailySignalDelivery) {
      this.dailySignalDelivery.status = normDailyStatus(this.dailySignalDelivery.status);
    }
  }

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

userSchema.statics.setGaAuditProperties = async function (userId, propertyIds = []) {
  const normalized = normalizeArray(propertyIds, normGaPropertyId);
  await this.updateOne(
    { _id: userId },
    { $set: { 'preferences.googleAnalytics.auditPropertyIds': normalized } }
  );
  return normalized;
};

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

userSchema.statics.enableDailySignalDelivery = async function (
  userId,
  {
    email = null,
    timezone = 'America/Mexico_City',
    sendHour = 5,
    sendMinute = 0,
  } = {}
) {
  const now = new Date();

  const current = await this.findById(userId)
    .select('email dailySignalDelivery')
    .lean();

  if (!current?._id) return null;

  const existingOptedInAt = current?.dailySignalDelivery?.optedInAt || null;
  const resolvedEmail =
    normEmail(email) ||
    normEmail(current?.dailySignalDelivery?.email) ||
    normEmail(current?.email) ||
    null;

  return this.findByIdAndUpdate(
    userId,
    {
      $set: {
        'dailySignalDelivery.enabled': true,
        'dailySignalDelivery.email': resolvedEmail,
        'dailySignalDelivery.timezone': normTimezone(timezone),
        'dailySignalDelivery.sendHour': clampInt(sendHour, 0, 23, 5),
        'dailySignalDelivery.sendMinute': clampInt(sendMinute, 0, 59, 0),
        'dailySignalDelivery.optedInAt': existingOptedInAt || now,
        'dailySignalDelivery.optedOutAt': null,
        'dailySignalDelivery.lastError': null,
        'dailySignalDelivery.lastErrorAt': null,
        'dailySignalDelivery.status': 'scheduled',
      },
    },
    { new: true }
  );
};

userSchema.statics.disableDailySignalDelivery = async function (userId) {
  const now = new Date();

  return this.findByIdAndUpdate(
    userId,
    {
      $set: {
        'dailySignalDelivery.enabled': false,
        'dailySignalDelivery.optedOutAt': now,
        'dailySignalDelivery.status': 'idle',
      },
    },
    { new: true }
  );
};

userSchema.statics.markDailySignalDeliveryStatus = async function (
  userId,
  {
    status = 'idle',
    lastAttemptAt,
    lastSentAt,
    lastErrorAt,
    lastError,
  } = {}
) {
  const $set = {
    'dailySignalDelivery.status': normDailyStatus(status),
  };

  if (lastAttemptAt !== undefined) $set['dailySignalDelivery.lastAttemptAt'] = lastAttemptAt || null;
  if (lastSentAt !== undefined) $set['dailySignalDelivery.lastSentAt'] = lastSentAt || null;
  if (lastErrorAt !== undefined) $set['dailySignalDelivery.lastErrorAt'] = lastErrorAt || null;
  if (lastError !== undefined) $set['dailySignalDelivery.lastError'] = normSimpleString(lastError);

  return this.findByIdAndUpdate(
    userId,
    { $set },
    { new: true }
  );
};

module.exports = mongoose.model('User', userSchema);