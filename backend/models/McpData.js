// backend/models/McpData.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;
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

    // ✅ NUEVO: status pro para cola/worker
    // queued | running | ready | error
    status: { type: String, default: 'queued' },

    // compat (si lo usabas)
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

    // opcional: policy aplicada por plan
    rangeDays: { type: Number, default: null },
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
McpDataSchema.index(
  { userId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { kind: 'root' } }
);

// 2) Consultar chunks por snapshot/source/dataset
McpDataSchema.index({ userId: 1, kind: 1, snapshotId: 1 });
McpDataSchema.index({ userId: 1, kind: 1, source: 1, dataset: 1, 'range.from': 1 });

// 3) Latest chunks
McpDataSchema.index({ userId: 1, kind: 1, createdAt: -1 });

// ✅ 4) CRÍTICO: evitar duplicados por dataset+range dentro de snapshot
McpDataSchema.index(
  { userId: 1, kind: 1, snapshotId: 1, source: 1, dataset: 1, 'range.from': 1, 'range.to': 1 },
  { unique: true, partialFilterExpression: { kind: 'chunk' } }
);

/* ---------------- Helpers estáticos ---------------- */

McpDataSchema.statics.upsertRoot = async function (userId, patch = {}) {
  const now = new Date();
  return this.findOneAndUpdate(
    { userId, kind: 'root' },
    {
      $set: { ...patch, kind: 'root', userId, updatedAt: now },
      $setOnInsert: { createdAt: now }
    },
    { upsert: true, new: true }
  );
};

/**
 * ✅ Patch específico de una fuente en root:
 * - patchRootSource(userId, 'metaAds', { status:'running', lastError:null, ready:false })
 */
McpDataSchema.statics.patchRootSource = async function (userId, sourceKey, patch = {}) {
  const now = new Date();
  const $set = {};

  for (const [k, v] of Object.entries(patch || {})) {
    $set[`sources.${sourceKey}.${k}`] = v;
  }
  $set.updatedAt = now;

  return this.findOneAndUpdate(
    { userId, kind: 'root' },
    { $setOnInsert: { userId, kind: 'root', createdAt: now }, $set },
    { upsert: true, new: true }
  );
};

/**
 * ✅ UPSERT chunk (para que jobs no dupliquen)
 */
McpDataSchema.statics.upsertChunk = async function ({
  userId,
  snapshotId,
  source,
  dataset,
  range,
  data,
  stats,
} = {}) {
  const now = new Date();
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  const tz = range?.tz ?? null;

  return this.findOneAndUpdate(
    {
      userId,
      kind: 'chunk',
      snapshotId: snapshotId || null,
      source: source || null,
      dataset: dataset || null,
      'range.from': from,
      'range.to': to,
    },
    {
      $set: {
        userId,
        kind: 'chunk',
        snapshotId: snapshotId || null,
        source: source || null,
        dataset: dataset || null,
        range: { from, to, tz },
        data: data ?? null,
        stats: stats || {},
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, new: true }
  );
};

/**
 * (LEGACY) Insert directo (solo si lo quieres seguir usando para debug)
 */
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