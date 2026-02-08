"use strict";

const mongoose = require("mongoose");

const analyticsEventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true }, // ej: "meta_connected"
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    // dedupe opcional (para evitar duplicados por retry)
    dedupeKey: { type: String, index: true, sparse: true },

    // datos extra (opcional)
    props: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Evita duplicados si mandas dedupeKey
analyticsEventSchema.index({ name: 1, userId: 1, dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
