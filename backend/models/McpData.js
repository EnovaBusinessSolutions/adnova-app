// backend/models/McpData.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* =========================
 * Shared sub-schemas
 * ========================= */
const RangeSchema = new Schema(
  {
    from: { type: String, default: null }, // YYYY-MM-DD
    to: { type: String, default: null },   // YYYY-MM-DD
    tz: { type: String, default: null },   // America/Mexico_City
  },
  { _id: false }
);

const StatsSchema = new Schema(
  {
    rows: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
  },
  { _id: false }
);

const CoverageSchema = new Schema(
  {
    range: { type: RangeSchema, default: () => ({}) },
    defaultRangeDays: { type: Number, default: 30 },
    granularity: { type: [String], default: [] },
  },
  { _id: false }
);

const SourceStateSchema = new Schema(
  {
    connected: { type: Boolean, default: false },

    // queued | running | ready | error
    status: { type: String, default: 'queued' },

    // compat
    ready: { type: Boolean, default: false },

    // IDs no sensibles
    accountId: { type: String, default: null },   // Meta
    customerId: { type: String, default: null },  // Google Ads
    propertyId: { type: String, default: null },  // GA4

    // metadata útil para la ficha del source
    name: { type: String, default: null },
    currency: { type: String, default: null },
    timezone: { type: String, default: null },

    // sync/status
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    // policy efectiva aplicada por plan
    rangeDays: { type: Number, default: null },
  },
  { _id: false }
);

const PdfArtifactSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['idle', 'processing', 'ready', 'failed'],
      default: 'idle',
    },
    stage: { type: String, default: 'idle' },
    progress: { type: Number, default: 0 },

    fileName: { type: String, default: null },
    mimeType: { type: String, default: 'application/pdf' },

    // metadata de storage / serving
    storageKey: { type: String, default: null },
    localPath: { type: String, default: null },
    downloadUrl: { type: String, default: null },

    generatedAt: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },
    pageCount: { type: Number, default: null },

    renderer: { type: String, default: null },
    version: { type: Number, default: 1 },
    error: { type: String, default: null },
  },
  { _id: false }
);

/* =========================
 * AI Context sub-schema
 * =========================
 *
 * encodedPayload se deja como Mixed porque:
 * - es un artefacto AI-ready evolutivo
 * - puede cambiar entre fallback/OpenAI
 * - no queremos que Mongoose rompa por casts rígidos
 *
 * signalPayload se agrega como alias semántico del nuevo producto.
 * Durante la migración podemos seguir leyendo/escribiendo encodedPayload
 * y también exponer signalPayload sin romper compatibilidad.
 */
const AiContextSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['idle', 'processing', 'done', 'error'],
      default: 'idle',
    },
    progress: { type: Number, default: 0 },
    stage: { type: String, default: 'idle' },

    startedAt: { type: String, default: null },
    finishedAt: { type: String, default: null },

    snapshotId: { type: String, default: null },

    usedOpenAI: { type: Boolean, default: false },
    model: { type: String, default: null },

    error: { type: String, default: null },

    // rangos efectivos usados por el contexto / signal
    contextRangeDays: { type: Number, default: null },
    storageRangeDays: { type: Number, default: null },

    // Base compactada cross-channel antes del enriquecimiento
    unifiedBase: { type: Schema.Types.Mixed, default: null },

    // Payload final AI-ready (compat legacy)
    encodedPayload: { type: Schema.Types.Mixed, default: null },

    // Nuevo naming del producto
    signalPayload: { type: Schema.Types.Mixed, default: null },

    // Artefacto PDF generado automáticamente a partir del Signal
    pdf: {
      type: PdfArtifactSchema,
      default: () => ({}),
    },

    // share link state (legacy / compat)
    shareToken: { type: String, default: null },
    shareEnabled: { type: Boolean, default: false },
    shareProvider: { type: String, default: null },
    shareUrl: { type: String, default: null },
    shareCreatedAt: { type: String, default: null },
    shareLastGeneratedAt: { type: String, default: null },
    shareRevokedAt: { type: String, default: null },
  },
  { _id: false, strict: false }
);

/* =========================
 * Main schema
 * ========================= */
const McpDataSchema = new Schema(
  {
    // owner
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    // root | chunk
    kind: { type: String, enum: ['root', 'chunk'], required: true, index: true },

    /**
     * ==========================
     * ROOT-ONLY FIELDS
     * ==========================
     */
    sources: {
      type: new Schema(
        {
          metaAds: { type: SourceStateSchema, default: () => ({}) },
          googleAds: { type: SourceStateSchema, default: () => ({}) },
          ga4: { type: SourceStateSchema, default: () => ({}) },
        },
        { _id: false }
      ),
      default: undefined,
    },

    coverage: {
      type: CoverageSchema,
      default: undefined,
    },

    latestSnapshotId: { type: String, default: null },

    aiContext: {
      type: AiContextSchema,
      default: undefined,
    },

    /**
     * stats aplica tanto para root como para chunk:
     * - root: volumen agregado del snapshot actual
     * - chunk: volumen del dataset específico
     */
    stats: {
      type: StatsSchema,
      default: undefined,
    },

    /**
     * ==========================
     * CHUNK-ONLY FIELDS
     * ==========================
     */
    snapshotId: { type: String, default: null, index: true },

    // metaAds | googleAds | ga4
    source: {
      type: String,
      enum: ['metaAds', 'googleAds', 'ga4', null],
      default: null,
      index: true,
    },

    dataset: { type: String, default: null, index: true },

    range: {
      type: RangeSchema,
      default: undefined,
    },

    // Compact payload normalized y seguro
    data: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'mcpdata',
    timestamps: true,
    minimize: true,
  }
);

/* =========================
 * Indexes
 * ========================= */

// Root lookup rápido
McpDataSchema.index(
  { userId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { kind: 'root' } }
);

// Consultar chunks por snapshot/source/dataset
McpDataSchema.index({ userId: 1, kind: 1, snapshotId: 1 });
McpDataSchema.index({ userId: 1, kind: 1, source: 1, dataset: 1, 'range.from': 1 });

// Latest chunks
McpDataSchema.index({ userId: 1, kind: 1, createdAt: -1 });

// Evitar duplicados por dataset+range dentro de snapshot
McpDataSchema.index(
  { userId: 1, kind: 1, snapshotId: 1, source: 1, dataset: 1, 'range.from': 1, 'range.to': 1 },
  { unique: true, partialFilterExpression: { kind: 'chunk' } }
);

/* =========================
 * Helpers internos
 * ========================= */
function isPlainObject(value) {
  if (value == null || typeof value !== 'object') return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function cleanUndefined(obj) {
  if (obj === undefined) return undefined;
  if (obj === null) return null;

  // Preservar Date
  if (obj instanceof Date) return obj;

  // Preservar ObjectId
  if (obj instanceof Types.ObjectId) return obj;

  // Preservar arrays
  if (Array.isArray(obj)) {
    return obj
      .map(cleanUndefined)
      .filter((v) => v !== undefined);
  }

  // Preservar objetos no planos (Buffer, clases, etc.)
  if (!isPlainObject(obj)) return obj;

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleaned = cleanUndefined(v);
    if (cleaned !== undefined) {
      out[k] = cleaned;
    }
  }
  return out;
}

function normalizeRootPatch(userId, patch = {}) {
  const cleaned = cleanUndefined(patch || {});
  return {
    ...cleaned,
    kind: 'root',
    userId,
  };
}

function normalizeChunkPayload({
  userId,
  snapshotId,
  source,
  dataset,
  range,
  data,
  stats,
} = {}) {
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  const tz = range?.tz ?? null;

  return {
    userId,
    kind: 'chunk',
    snapshotId: snapshotId || null,
    source: source || null,
    dataset: dataset || null,
    range: { from, to, tz },
    data: data ?? null,
    stats: {
      rows: Number(stats?.rows || 0),
      bytes: Number(stats?.bytes || 0),
    },
  };
}

/* =========================
 * Statics
 * ========================= */

McpDataSchema.statics.upsertRoot = async function (userId, patch = {}) {
  const now = new Date();
  const normalized = normalizeRootPatch(userId, patch);

  return this.findOneAndUpdate(
    { userId, kind: 'root' },
    {
      $set: {
        ...normalized,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
      // limpia campos chunk-only por si existían de antes
      $unset: {
        snapshotId: 1,
        source: 1,
        dataset: 1,
        range: 1,
        data: 1,
      },
    },
    { upsert: true, new: true }
  );
};

/**
 * Patch específico de una fuente dentro del root
 */
McpDataSchema.statics.patchRootSource = async function (userId, sourceKey, patch = {}) {
  const now = new Date();
  const $set = {
    updatedAt: now,
  };

  const cleanedPatch = cleanUndefined(patch || {});
  for (const [k, v] of Object.entries(cleanedPatch)) {
    $set[`sources.${sourceKey}.${k}`] = v;
  }

  return this.findOneAndUpdate(
    { userId, kind: 'root' },
    {
      $setOnInsert: {
        userId,
        kind: 'root',
        createdAt: now,
      },
      $set,
      // limpia campos chunk-only por si existían de antes
      $unset: {
        snapshotId: 1,
        source: 1,
        dataset: 1,
        range: 1,
        data: 1,
      },
    },
    { upsert: true, new: true }
  );
};

/**
 * UPSERT chunk limpio
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
  const normalized = normalizeChunkPayload({
    userId,
    snapshotId,
    source,
    dataset,
    range,
    data,
    stats,
  });

  return this.findOneAndUpdate(
    {
      userId,
      kind: 'chunk',
      snapshotId: normalized.snapshotId,
      source: normalized.source,
      dataset: normalized.dataset,
      'range.from': normalized.range.from,
      'range.to': normalized.range.to,
    },
    {
      $set: {
        ...normalized,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
      // limpia campos root-only por si existían de antes
      $unset: {
        sources: 1,
        coverage: 1,
        latestSnapshotId: 1,
        aiContext: 1,
      },
    },
    { upsert: true, new: true }
  );
};

/**
 * Insert directo legacy/debug
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
  const normalized = normalizeChunkPayload({
    userId,
    snapshotId,
    source,
    dataset,
    range,
    data,
    stats,
  });

  return this.create(normalized);
};

module.exports = mongoose.models.McpData || model('McpData', McpDataSchema);