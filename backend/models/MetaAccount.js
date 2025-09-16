// backend/models/MetaAccount.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/**
 * Subdocumento para Ad Accounts
 * Acepta tanto campos normalizados como los que devuelve Graph (por compatibilidad).
 */
const AdAccountSchema = new Schema(
  {
    // IDs: a veces llega "act_123..." y/o "123..."
    id:            { type: String },
    account_id:    { type: String },

    // Nombres / estado / moneda
    name:               { type: String },
    account_name:       { type: String },
    account_status:     { type: Schema.Types.Mixed },
    configured_status:  { type: Schema.Types.Mixed },

    currency:           { type: String },
    account_currency:   { type: String },

    // Zona horaria
    timezone_name: { type: String },
    timezone:      { type: String },
  },
  { _id: false }
);

/**
 * MetaAccount
 * Tolerante a diferentes nombres que ya puedas tener en Atlas.
 * - user o userId (acepta ambos)
 * - access_token | token | longlivedToken | accessToken | longLivedToken
 * - ad_accounts o adAccounts
 */
const MetaAccountSchema = new Schema(
  {
    // Referencia a usuario (cualquiera de los dos; índices sparse + unique)
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    // Tokens (ocultos por defecto)
    access_token:   { type: String, select: false },
    token:          { type: String, select: false },
    longlivedToken: { type: String, select: false }, // snake-style
    accessToken:    { type: String, select: false }, // camel
    longLivedToken: { type: String, select: false }, // camel

    // Expiraciones posibles (cubriendo tus nombres)
    expires_at: { type: Date },
    expiresAt:  { type: Date },

    // Datos del owner de Meta (opcionales)
    fb_user_id: { type: String },
    email:      { type: String },
    name:       { type: String },

    // Objetivo elegido en el onboarding (sin default para que el UI pida elegirlo)
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    // Cuentas publicitarias y páginas
    ad_accounts: { type: [AdAccountSchema], default: [] }, // snake
    adAccounts:  { type: [AdAccountSchema], default: [] }, // camel
    pages:       { type: Array, default: [] },
    scopes:      { type: [String], default: [] },

    // Cuenta por defecto (guardar SIN "act_")
    defaultAccountId: { type: String },

    // Timestamps manuales por compatibilidad
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'metaaccounts',
  }
);

/* Índices únicos y esparsos para user / userId */
MetaAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
MetaAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });

/* Mantener updatedAt en cada save */
MetaAccountSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

/* Exportar de forma segura si el modelo ya existe (evita OverwriteModelError) */
module.exports =
  mongoose.models.MetaAccount || model('MetaAccount', MetaAccountSchema);
