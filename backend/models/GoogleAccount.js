'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

const CustomerSchema = new Schema(
  {
    id: String,                    // 1234567890 (sin guiones)
    resourceName: String,          // customers/1234567890
    descriptiveName: String,       // Nombre visible de la cuenta
    currencyCode: String,          // e.g. MXN
    timeZone: String,              // e.g. America/Mexico_City
  },
  { _id: false }
);

const GoogleAccountSchema = new Schema(
  {
    // referencia al usuario
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    // OAuth tokens (refresh_token es lo importante)
    accessToken:  { type: String, select: false },
    refreshToken: { type: String, select: false },
    scope:        { type: [String], default: [] },
    expiresAt:    { type: Date },

    // MCC opcional para cabecera login-customer-id
    managerCustomerId: { type: String },

    // cuentas accesibles y selección por defecto
    customers:         { type: [CustomerSchema], default: [] },
    defaultCustomerId: { type: String }, // “1234567890”

    // objetivo del onboarding
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null, // mostrará el paso de objetivo si está vacío
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'googleaccounts' }
);

GoogleAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
GoogleAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });

GoogleAccountSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports =
  mongoose.models.GoogleAccount || model('GoogleAccount', GoogleAccountSchema);
