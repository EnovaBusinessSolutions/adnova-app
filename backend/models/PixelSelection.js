// backend/models/PixelSelection.js
"use strict";

const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * PixelSelection
 * - Guarda selección de "pixel" para Ads:
 *   - provider=meta: Meta Pixel real (Graph API adspixels)
 *   - provider=google_ads: Google Ads Conversion Action (resourceName)
 *
 * Diseño:
 * - MAX_SELECT=1 por provider y usuario (upsert por {userId, provider})
 * - Compat: soporta userId y user (algunos modelos del repo usan uno u otro)
 */
const PixelSelectionSchema = new Schema(
  {
    // ✅ Compat: guardamos ambos (userId y user) para evitar bugs por shape distinto
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },

    provider: {
      type: String,
      required: true,
      enum: ["meta", "google_ads"],
      index: true,
    },

    // ✅ ID canónico de la selección
    // meta: pixel id (ej. "123456789")
    // google_ads: conversion action resourceName (ej. "customers/123/conversionActions/456")
    selectedId: { type: String, required: true, trim: true },

    // ✅ Nombre humano para UI (opcional pero recomendado)
    selectedName: { type: String, default: "", trim: true },

    // ✅ Contexto mínimo (no obligatorio)
    meta: {
      // meta: act_XXX (o solo digits)
      adAccountId: { type: String, default: "", trim: true },

      // google ads: customerId digits
      customerId: { type: String, default: "", trim: true },

      // debug opcional
      source: { type: String, default: "", trim: true },
    },

    // ✅ Confirmación tipo "Continue" (para que el Step se pinte connected)
    // *No reemplaza selection, solo confirma que el usuario terminó el flujo.*
    confirmedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

// ✅ Unicidad: 1 selección por usuario + provider
// Nota: usamos userId como primary; si por alguna razón se usa "user", el router debe setear userId también.
PixelSelectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

// Helper: normalizar para UI sin reventar compat
PixelSelectionSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    userId: String(this.userId || this.user || ""),
    provider: this.provider,
    selectedId: this.selectedId,
    selectedName: this.selectedName || null,
    meta: this.meta || {},
    confirmedAt: this.confirmedAt || null,
    createdAt: this.createdAt || null,
    updatedAt: this.updatedAt || null,
  };
};

module.exports =
  mongoose.models.PixelSelection ||
  mongoose.model("PixelSelection", PixelSelectionSchema);