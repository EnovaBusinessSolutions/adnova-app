// backend/models/User.js
const mongoose = require('mongoose');

const normMetaId = (s = '') =>
  String(s).trim().replace(/^act_/, '').replace(/\s+/g, '');

const normGoogleId = (s = '') =>
  String(s).trim().replace(/^customers\//, '').replace(/-/g, '').replace(/\s+/g, '');

function normalizeArray(arr, normFn) {
  const out = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const n = normFn(v);
    if (n) out.add(n);
  }
  return Array.from(out);
}

const userSchema = new mongoose.Schema(
  {
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

    // Meta (OAuth atajo legado, opcional)
    metaConnected: { type: Boolean, default: false },
    metaAccessToken: { type: String },

    // === Selección de cuentas (clave para auditorías) ===
    selectedMetaAccounts: {
      type: [String],
      default: [],
      // normaliza en asignaciones directas: User.selectedMetaAccounts = [...]
      set: (arr) => normalizeArray(arr, normMetaId),
    },
    selectedGoogleAccounts: {
      type: [String],
      default: [],
      set: (arr) => normalizeArray(arr, normGoogleId),
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
    subscription: {
      status: { type: String, default: 'inactive' },
      priceId: { type: String },
      plan: { type: String, enum: ['emprendedor', 'crecimiento', 'pro', 'enterprise'] },
      currentPeriodEnd: { type: Date },
    },
  },
  { timestamps: true }
);

// Índices útiles
userSchema.index({ plan: 1 });

// Seguridad extra: normalizar y deduplicar siempre antes de save/update
userSchema.pre('save', function (next) {
  if (this.isModified('selectedMetaAccounts')) {
    this.selectedMetaAccounts = normalizeArray(this.selectedMetaAccounts, normMetaId);
  }
  if (this.isModified('selectedGoogleAccounts')) {
    this.selectedGoogleAccounts = normalizeArray(this.selectedGoogleAccounts, normGoogleId);
  }
  next();
});

// Métodos/estáticos convenientes para usar desde rutas/jobs
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

module.exports = mongoose.model('User', userSchema);
