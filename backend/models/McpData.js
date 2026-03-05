// backend/models/McpData.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/**
 * McpData
 * - NO tokens
 * - SOLO marketing data (kpis, campaigns, adsets, ads, conversions, geo/device/placement, ga4 events/pages, etc.)
 * - Una sola colección con 2 kinds:
 *   - root: estado y punteros (1 por usuario)
 *   - chunk: datasets compactados (muchos por usuario)
 */

const RangeSchema = new Schema(
  {
    from: { type: String, default: null }, // "YYYY-MM-DD"
    to: { type: String, default: null },   // "YYYY-MM-DD"
    tz: { type: String, default: null },   // "America/Mexico_City"
  },
  { _id: false }
);

const SourceStateSchema = new Schema(
  {
    connected: { type: Boolean, default: false },
    ready: { type: Boolean, default: false },

    // IDs no sensibles (solo referencia)
    accountId: { type: String, default: null },   // Meta: "123" (sin act_)
    customerId: { type: String, default: null },  // Google Ads: "1234567890"
    propertyId: { type: String, default: null },  // GA4: "properties/123"

    // metadata opcional (NO sensible)
    name: { type: String, default: null },
    currency: { type: String, default: null },
    timezone: { type: String, default: null },

    // sync/status
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { _id: false }
);

const McpDataSchema = new Schema(
  {
    // owner
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    // root | chunk
    kind: { type: String, enum: ['root', 'chunk'], required: true, index: true },

    /**
     * ==========================
     * ROOT FIELDS (kind="root")
     * ==========================
     */
    sources: {
      metaAds: { type: SourceStateSchema, default: () => ({}) },
      googleAds: { type: SourceStateSchema, default: () => ({}) },
      ga4: { type: SourceStateSchema, default: () => ({}) },
    },

    coverage: {
      range: { type: RangeSchema, default: () => ({}) },
      defaultRangeDays: { type: Number, default: 30 },
      granularity: { type: [String], default: [] }, // e.g. ["daily","campaign","adset","ad","landing_page"]
    },

    latestSnapshotId: { type: String, default: null },

    /**
     * ==========================
     * CHUNK FIELDS (kind="chunk")
     * ==========================
     */
    snapshotId: { type: String, default: null, index: true },

    // "metaAds" | "googleAds" | "ga4"
    source: {
      type: String,
      enum: ['metaAds', 'googleAds', 'ga4', null],
      default: null,
      index: true,
    },

    /**
     * dataset examples:
     * - "meta.insights_daily_campaign"
     * - "meta.structure_campaigns"
     * - "meta.breakdowns_top"
     * - "google.insights_daily_campaign"
     * - "google.structure_campaigns"
     * - "ga4.kpis_daily"
     * - "ga4.landing_pages_top"
     * - "ga4.source_medium_top"
     * - "ga4.events_top"
     */
    dataset: { type: String, default: null, index: true },

    range: { type: RangeSchema, default: () => ({}) },

    // Compact payload (normalized rows, already safe)
    data: { type: Schema.Types.Mixed, default: null },

    // opcional: stats para debug
    stats: {
      rows: { type: Number, default: 0 },
      bytes: { type: Number, default: 0 },
    },
  },
  {
    collection: 'mcpdata',
    timestamps: true, // createdAt / updatedAt
  }
);

/* ---------------- Índices recomendados ---------------- */

// 1) Root lookup rápido
McpDataSchema.index({ userId: 1, kind: 1 }, { unique: true, partialFilterExpression: { kind: 'root' } });

// 2) Consultar chunks por snapshot/source/dataset
McpDataSchema.index({ userId: 1, kind: 1, snapshotId: 1 });
McpDataSchema.index({ userId: 1, kind: 1, source: 1, dataset: 1, 'range.from': 1 });

// 3) Latest chunks
McpDataSchema.index({ userId: 1, kind: 1, createdAt: -1 });

/* ---------------- Helpers estáticos ---------------- */

McpDataSchema.statics.upsertRoot = async function (userId, patch = {}) {
  const now = new Date();
  return this.findOneAndUpdate(
    { userId, kind: 'root' },
    { $set: { ...patch, kind: 'root', userId, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true, new: true }
  );
};

McpDataSchema.statics.insertChunk = async function ({
  userId,
  snapshotId,
  source,
  dataset,
  range,
  data,
  stats,
} = {}) {
  return this.create({
    userId,
    kind: 'chunk',
    snapshotId: snapshotId || null,
    source: source || null,
    dataset: dataset || null,
    range: range || {},
    data: data ?? null,
    stats: stats || {},
  });
};

module.exports = mongoose.models.McpData || model('McpData', McpDataSchema);