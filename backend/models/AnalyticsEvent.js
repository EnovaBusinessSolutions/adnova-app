"use strict";

const mongoose = require("mongoose");

const analyticsEventSchema = new mongoose.Schema(
  {
    // ej: "user_signed_up", "google_connected"
    name: { type: String, required: true, index: true },

    // puede ser null (landing / no logueado). Por eso NO lo hacemos required.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, default: null },

    // ✅ Fecha canónica (para filtros 7/30/90 y aggregations estables)
    ts: { type: Date, default: Date.now, index: true },

    // ✅ Útil para separar: app | landing | server | cron | backfill
    source: { type: String, default: "app", index: true },

    // ✅ Útil cuando no hay userId (atribución por sesión)
    sessionId: { type: String, default: null, index: true },

    // dedupe opcional (para evitar duplicados por retry)
    dedupeKey: { type: String, index: true, sparse: true },

    // datos extra (opcional)
    props: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    // Mantén createdAt (te sirve para auditoría), pero usamos ts como fecha canónica
    timestamps: { createdAt: true, updatedAt: false },
    collection: "analyticsevents", // ✅ nombre estable de colección
  }
);

/**
 * ✅ Índices
 * - Búsquedas comunes: name + rango por ts
 * - Timeline por usuario/sesión
 */
analyticsEventSchema.index({ name: 1, ts: -1 });
analyticsEventSchema.index({ userId: 1, ts: -1 });
analyticsEventSchema.index({ sessionId: 1, ts: -1 });

/**
 * ✅ Dedupe seguro
 * Tu trackEvent hace upsert con { name, userId, dedupeKey }.
 * Para que no reviente cuando userId sea null (o no venga), usamos un índice parcial:
 * solo aplica uniqueness cuando dedupeKey existe.
 */
analyticsEventSchema.index(
  { name: 1, userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
);

module.exports =
  mongoose.models.AnalyticsEvent || mongoose.model("AnalyticsEvent", analyticsEventSchema);
