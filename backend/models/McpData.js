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

const ArtifactStatusSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['idle', 'queued', 'processing', 'ready', 'failed'],
      default: 'idle',
    },
    stage: { type: String, default: 'idle' },
    progress: { type: Number, default: 0 },

    generationId: { type: String, default: null },
    sourceFingerprint: { type: String, default: null },

    // Snapshot exacto de fuentes/selecciones usadas
    sourcesSnapshot: { type: Schema.Types.Mixed, default: null },

    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    generatedAt: { type: Date, default: null },

    invalidatedAt: { type: Date, default: null },
    staleReason: { type: String, default: null },

    version: { type: Number, default: 1 },
    error: { type: String, default: null },
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

    // IDs no sensibles / selección actual
    accountId: { type: String, default: null },      // Meta
    customerId: { type: String, default: null },     // Google Ads
    propertyId: { type: String, default: null },     // GA4

    // selecciones que sí cambian la identidad del Signal
    selectedAccountId: { type: String, default: null },
    selectedPixelId: { type: String, default: null },       // Meta Pixel
    selectedCustomerId: { type: String, default: null },
    selectedConversionId: { type: String, default: null },  // Google Ads conversion
    selectedPropertyId: { type: String, default: null },

    // metadata útil para la ficha del source
    name: { type: String, default: null },
    currency: { type: String, default: null },
    timezone: { type: String, default: null },

    // sync/status
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    // policy efectiva aplicada por plan
    rangeDays: { type: Number, default: null },

    // útil para detectar cambios de selección
    selectionUpdatedAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
    disconnectedAt: { type: Date, default: null },
  },
  { _id: false }
);

const SignalArtifactSchema = new Schema(
  {
    ...ArtifactStatusSchema.obj,

    model: { type: String, default: null },
    usedOpenAI: { type: Boolean, default: false },

    // rangos efectivos usados por el signal
    contextRangeDays: { type: Number, default: null },
    storageRangeDays: { type: Number, default: null },

    snapshotId: { type: String, default: null },

    // Base compactada cross-channel antes del enriquecimiento
    unifiedBase: { type: Schema.Types.Mixed, default: null },

    // Compat legacy
    encodedPayload: { type: Schema.Types.Mixed, default: null },

    // Payload final AI-ready
    payload: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const PdfArtifactSchema = new Schema(
  {
    ...ArtifactStatusSchema.obj,

    // relación fuerte con el Signal que lo originó
    signalGenerationId: { type: String, default: null },

    fileName: { type: String, default: null },
    mimeType: { type: String, default: 'application/pdf' },

    // metadata de storage / serving
    storageKey: { type: String, default: null },
    localPath: { type: String, default: null },
    downloadUrl: { type: String, default: null },

    sizeBytes: { type: Number, default: 0 },
    pageCount: { type: Number, default: null },

    renderer: { type: String, default: null },
  },
  { _id: false }
);

/* =========================
 * AI Context sub-schema
 * ========================= */

const AiContextSchema = new Schema(
  {
    /**
     * Estado global del pipeline (compat/general)
     * NO debe usarse como única fuente de verdad de Signal/PDF.
     */
    status: {
      type: String,
      enum: ['idle', 'processing', 'done', 'error'],
      default: 'idle',
    },
    progress: { type: Number, default: 0 },
    stage: { type: String, default: 'idle' },

    // Fechas globales compat
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },

    snapshotId: { type: String, default: null },

    usedOpenAI: { type: Boolean, default: false },
    model: { type: String, default: null },

    error: { type: String, default: null },

    // rangos efectivos usados por el contexto / signal (compat)
    contextRangeDays: { type: Number, default: null },
    storageRangeDays: { type: Number, default: null },

    // identidad del contexto ACTUAL del usuario
    currentSourceFingerprint: { type: String, default: null },
    currentSourcesSnapshot: { type: Schema.Types.Mixed, default: null },
    sourcesChangedAt: { type: Date, default: null },

    // flags operativos útiles
    needsSignalRebuild: { type: Boolean, default: false },
    needsPdfRebuild: { type: Boolean, default: false },

    /**
     * Artefacto Signal formal
     */
    signal: {
      type: SignalArtifactSchema,
      default: () => ({}),
    },

    /**
     * Artefacto PDF derivado del Signal
     */
    pdf: {
      type: PdfArtifactSchema,
      default: () => ({}),
    },

    /**
     * Campos legacy / compat
     * Se conservan para no romper el sistema actual mientras migramos.
     */
    unifiedBase: { type: Schema.Types.Mixed, default: null },
    encodedPayload: { type: Schema.Types.Mixed, default: null },
    signalPayload: { type: Schema.Types.Mixed, default: null },

    // share link state (legacy / compat)
    shareToken: { type: String, default: null },
    shareEnabled: { type: Boolean, default: false },
    shareProvider: { type: String, default: null },
    shareUrl: { type: String, default: null },
    shareCreatedAt: { type: Date, default: null },
    shareLastGeneratedAt: { type: Date, default: null },
    shareRevokedAt: { type: Date, default: null },
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

// Vigencia / pipeline actual
McpDataSchema.index(
  { userId: 1, kind: 1, 'aiContext.currentSourceFingerprint': 1 },
  { partialFilterExpression: { kind: 'root' } }
);

McpDataSchema.index(
  { userId: 1, kind: 1, 'aiContext.signal.generationId': 1 },
  { partialFilterExpression: { kind: 'root' } }
);

McpDataSchema.index(
  { userId: 1, kind: 1, 'aiContext.pdf.generationId': 1 },
  { partialFilterExpression: { kind: 'root' } }
);

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

function nowIfMissing(value) {
  return value instanceof Date ? value : new Date();
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

function buildRootSetOnInsert(userId, now) {
  return {
    userId,
    kind: 'root',
    createdAt: now,
  };
}

function buildChunkUnset() {
  return {
    snapshotId: 1,
    source: 1,
    dataset: 1,
    range: 1,
    data: 1,
  };
}

function buildRootUnset() {
  return {
    sources: 1,
    coverage: 1,
    latestSnapshotId: 1,
    aiContext: 1,
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
      $setOnInsert: buildRootSetOnInsert(userId, now),
      // limpia campos chunk-only por si existían de antes
      $unset: buildChunkUnset(),
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
      $setOnInsert: buildRootSetOnInsert(userId, now),
      $set,
      // limpia campos chunk-only por si existían de antes
      $unset: buildChunkUnset(),
    },
    { upsert: true, new: true }
  );
};

/**
 * Guarda fingerprint/snapshot actual y marca rebuild si cambió
 */
McpDataSchema.statics.markSourcesState = async function (
  userId,
  {
    currentSourceFingerprint = null,
    currentSourcesSnapshot = null,
    sourcesChangedAt = null,
    needsSignalRebuild = true,
    needsPdfRebuild = true,
  } = {}
) {
  const now = new Date();

  const root = await this.findOne({ userId, kind: 'root' }).lean();
  const prevFingerprint = root?.aiContext?.currentSourceFingerprint || null;
  const changed = prevFingerprint !== currentSourceFingerprint;

  const $set = {
    updatedAt: now,
    'aiContext.currentSourceFingerprint': currentSourceFingerprint,
    'aiContext.currentSourcesSnapshot': cleanUndefined(currentSourcesSnapshot),
    'aiContext.needsSignalRebuild': !!needsSignalRebuild,
    'aiContext.needsPdfRebuild': !!needsPdfRebuild,
  };

  if (changed) {
    $set['aiContext.sourcesChangedAt'] = sourcesChangedAt || now;

    // estado global compat
    $set['aiContext.status'] = 'processing';
    $set['aiContext.stage'] = 'sources_changed';
    $set['aiContext.progress'] = 0;
    $set['aiContext.error'] = null;

    // invalidar signal actual
    $set['aiContext.signal.invalidatedAt'] = now;
    $set['aiContext.signal.staleReason'] = 'sources_changed';
    $set['aiContext.signal.status'] = 'idle';
    $set['aiContext.signal.stage'] = 'idle';
    $set['aiContext.signal.progress'] = 0;
    $set['aiContext.signal.error'] = null;

    // invalidar pdf actual
    $set['aiContext.pdf.invalidatedAt'] = now;
    $set['aiContext.pdf.staleReason'] = 'sources_changed';
    $set['aiContext.pdf.status'] = 'idle';
    $set['aiContext.pdf.stage'] = 'idle';
    $set['aiContext.pdf.progress'] = 0;
    $set['aiContext.pdf.error'] = null;
  }

  return this.findOneAndUpdate(
    { userId, kind: 'root' },
    {
      $setOnInsert: buildRootSetOnInsert(userId, now),
      $set,
      $unset: buildChunkUnset(),
    },
    { upsert: true, new: true }
  );
};

/**
 * Arranca una nueva generación de Signal
 */
McpDataSchema.statics.startSignalGeneration = async function (
  userId,
  {
    generationId,
    sourceFingerprint = null,
    sourcesSnapshot = null,
    snapshotId = null,
    model = null,
    usedOpenAI = false,
    contextRangeDays = null,
    storageRangeDays = null,
    startedAt = null,
  } = {}
) {
  const now = nowIfMissing(startedAt);

  return this.findOneAndUpdate(
    { userId, kind: 'root' },
    {
      $setOnInsert: buildRootSetOnInsert(userId, now),
      $set: {
        updatedAt: now,

        'aiContext.status': 'processing',
        'aiContext.stage': 'signal_processing',
        'aiContext.progress': 0,
        'aiContext.startedAt': now,
        'aiContext.finishedAt': null,
        'aiContext.error': null,

        'aiContext.model': model,
        'aiContext.usedOpenAI': !!usedOpenAI,
        'aiContext.snapshotId': snapshotId,
        'aiContext.contextRangeDays': contextRangeDays,
        'aiContext.storageRangeDays': storageRangeDays,

        'aiContext.needsSignalRebuild': true,

        'aiContext.signal.status': 'processing',
        'aiContext.signal.stage': 'signal_processing',
        'aiContext.signal.progress': 0,
        'aiContext.signal.generationId': generationId || null,
        'aiContext.signal.sourceFingerprint': sourceFingerprint,
        'aiContext.signal.sourcesSnapshot': cleanUndefined(sourcesSnapshot),
        'aiContext.signal.startedAt': now,
        'aiContext.signal.finishedAt': null,
        'aiContext.signal.generatedAt': null,
        'aiContext.signal.invalidatedAt': null,
        'aiContext.signal.staleReason': null,
        'aiContext.signal.error': null,
        'aiContext.signal.model': model,
        'aiContext.signal.usedOpenAI': !!usedOpenAI,
        'aiContext.signal.snapshotId': snapshotId,
        'aiContext.signal.contextRangeDays': contextRangeDays,
        'aiContext.signal.storageRangeDays': storageRangeDays,

        // al iniciar nuevo signal, el PDF actual deja de ser confiable
        'aiContext.pdf.status': 'idle',
        'aiContext.pdf.stage': 'idle',
        'aiContext.pdf.progress': 0,
        'aiContext.pdf.error': null,
        'aiContext.pdf.invalidatedAt': now,
        'aiContext.pdf.staleReason': 'waiting_for_updated_signal',
        'aiContext.needsPdfRebuild': true,
      },
      $unset: buildChunkUnset(),
    },
    { upsert: true, new: true }
  );
};

/**
 * Avanza el progreso del Signal solo si generationId coincide
 */
McpDataSchema.statics.patchSignalGeneration = async function (
  userId,
  generationId,
  patch = {}
) {
  const root = await this.findOne({ userId, kind: 'root' });
  if (!root) return null;

  const currentGenerationId = root?.aiContext?.signal?.generationId || null;
  if (!generationId || currentGenerationId !== generationId) {
    return root;
  }

  const $set = { updatedAt: new Date() };
  const cleanedPatch = cleanUndefined(patch || {});

  for (const [k, v] of Object.entries(cleanedPatch)) {
    $set[`aiContext.signal.${k}`] = v;
  }

  if (cleanedPatch.progress != null) {
    $set['aiContext.progress'] = cleanedPatch.progress;
  }
  if (cleanedPatch.stage != null) {
    $set['aiContext.stage'] = cleanedPatch.stage;
  }

  return this.findOneAndUpdate(
    { userId, kind: 'root', 'aiContext.signal.generationId': generationId },
    { $set },
    { new: true }
  );
};

/**
 * Completa una generación de Signal solo si generationId sigue vigente
 */
McpDataSchema.statics.finishSignalGeneration = async function (
  userId,
  generationId,
  {
    payload = null,
    encodedPayload = null,
    unifiedBase = null,
    sourceFingerprint = null,
    sourcesSnapshot = null,
    snapshotId = null,
    progress = 100,
    stage = 'signal_ready',
    finishedAt = null,
    version = 1,
    model = null,
    usedOpenAI = false,
    contextRangeDays = null,
    storageRangeDays = null,
  } = {}
) {
  const now = nowIfMissing(finishedAt);

  return this.findOneAndUpdate(
    { userId, kind: 'root', 'aiContext.signal.generationId': generationId },
    {
      $set: {
        updatedAt: now,

        'aiContext.status': 'done',
        'aiContext.stage': stage,
        'aiContext.progress': progress,
        'aiContext.finishedAt': now,
        'aiContext.error': null,

        'aiContext.snapshotId': snapshotId,
        'aiContext.model': model,
        'aiContext.usedOpenAI': !!usedOpenAI,
        'aiContext.contextRangeDays': contextRangeDays,
        'aiContext.storageRangeDays': storageRangeDays,

        // compat legacy
        'aiContext.unifiedBase': unifiedBase,
        'aiContext.encodedPayload': encodedPayload,
        'aiContext.signalPayload': payload,

        'aiContext.signal.status': 'ready',
        'aiContext.signal.stage': stage,
        'aiContext.signal.progress': progress,
        'aiContext.signal.finishedAt': now,
        'aiContext.signal.generatedAt': now,
        'aiContext.signal.error': null,
        'aiContext.signal.payload': payload,
        'aiContext.signal.encodedPayload': encodedPayload,
        'aiContext.signal.unifiedBase': unifiedBase,
        'aiContext.signal.sourceFingerprint': sourceFingerprint,
        'aiContext.signal.sourcesSnapshot': cleanUndefined(sourcesSnapshot),
        'aiContext.signal.snapshotId': snapshotId,
        'aiContext.signal.version': Number(version || 1),
        'aiContext.signal.model': model,
        'aiContext.signal.usedOpenAI': !!usedOpenAI,
        'aiContext.signal.contextRangeDays': contextRangeDays,
        'aiContext.signal.storageRangeDays': storageRangeDays,

        'aiContext.needsSignalRebuild': false,
        'aiContext.needsPdfRebuild': true,

        // al completar signal nuevo, el PDF aún debe regenerarse
        'aiContext.pdf.status': 'idle',
        'aiContext.pdf.stage': 'idle',
        'aiContext.pdf.progress': 0,
        'aiContext.pdf.error': null,
        'aiContext.pdf.invalidatedAt': now,
        'aiContext.pdf.staleReason': 'new_signal_ready_requires_pdf',
      },
    },
    { new: true }
  );
};

/**
 * Marca error de Signal solo si generationId sigue vigente
 */
McpDataSchema.statics.failSignalGeneration = async function (
  userId,
  generationId,
  errorMessage,
  {
    stage = 'signal_failed',
    progress = 0,
    finishedAt = null,
  } = {}
) {
  const now = nowIfMissing(finishedAt);
  const error = errorMessage == null ? 'SIGNAL_GENERATION_FAILED' : String(errorMessage);

  return this.findOneAndUpdate(
    { userId, kind: 'root', 'aiContext.signal.generationId': generationId },
    {
      $set: {
        updatedAt: now,

        'aiContext.status': 'error',
        'aiContext.stage': stage,
        'aiContext.progress': progress,
        'aiContext.finishedAt': now,
        'aiContext.error': error,
        'aiContext.needsSignalRebuild': true,

        'aiContext.signal.status': 'failed',
        'aiContext.signal.stage': stage,
        'aiContext.signal.progress': progress,
        'aiContext.signal.finishedAt': now,
        'aiContext.signal.error': error,
      },
    },
    { new: true }
  );
};

/**
 * Arranca generación PDF ligada a una generación de Signal ya lista
 */
McpDataSchema.statics.startPdfGeneration = async function (
  userId,
  {
    generationId,
    signalGenerationId = null,
    sourceFingerprint = null,
    sourcesSnapshot = null,
    startedAt = null,
    renderer = null,
  } = {}
) {
  const now = nowIfMissing(startedAt);

  return this.findOneAndUpdate(
    { userId, kind: 'root' },
    {
      $setOnInsert: buildRootSetOnInsert(userId, now),
      $set: {
        updatedAt: now,

        'aiContext.pdf.status': 'processing',
        'aiContext.pdf.stage': 'pdf_processing',
        'aiContext.pdf.progress': 0,
        'aiContext.pdf.generationId': generationId || null,
        'aiContext.pdf.signalGenerationId': signalGenerationId || null,
        'aiContext.pdf.sourceFingerprint': sourceFingerprint,
        'aiContext.pdf.sourcesSnapshot': cleanUndefined(sourcesSnapshot),
        'aiContext.pdf.startedAt': now,
        'aiContext.pdf.finishedAt': null,
        'aiContext.pdf.generatedAt': null,
        'aiContext.pdf.invalidatedAt': null,
        'aiContext.pdf.staleReason': null,
        'aiContext.pdf.error': null,
        'aiContext.pdf.renderer': renderer || null,

        'aiContext.needsPdfRebuild': true,
      },
      $unset: buildChunkUnset(),
    },
    { upsert: true, new: true }
  );
};

/**
 * Avanza progreso PDF solo si generationId coincide
 */
McpDataSchema.statics.patchPdfGeneration = async function (
  userId,
  generationId,
  patch = {}
) {
  const root = await this.findOne({ userId, kind: 'root' });
  if (!root) return null;

  const currentGenerationId = root?.aiContext?.pdf?.generationId || null;
  if (!generationId || currentGenerationId !== generationId) {
    return root;
  }

  const $set = { updatedAt: new Date() };
  const cleanedPatch = cleanUndefined(patch || {});

  for (const [k, v] of Object.entries(cleanedPatch)) {
    $set[`aiContext.pdf.${k}`] = v;
  }

  return this.findOneAndUpdate(
    { userId, kind: 'root', 'aiContext.pdf.generationId': generationId },
    { $set },
    { new: true }
  );
};

/**
 * Completa PDF solo si generationId sigue vigente
 */
McpDataSchema.statics.finishPdfGeneration = async function (
  userId,
  generationId,
  {
    signalGenerationId = null,
    sourceFingerprint = null,
    sourcesSnapshot = null,
    fileName = null,
    mimeType = 'application/pdf',
    storageKey = null,
    localPath = null,
    downloadUrl = null,
    sizeBytes = 0,
    pageCount = null,
    renderer = null,
    progress = 100,
    stage = 'pdf_ready',
    finishedAt = null,
    version = 1,
  } = {}
) {
  const now = nowIfMissing(finishedAt);

  return this.findOneAndUpdate(
    { userId, kind: 'root', 'aiContext.pdf.generationId': generationId },
    {
      $set: {
        updatedAt: now,
        'aiContext.pdf.status': 'ready',
        'aiContext.pdf.stage': stage,
        'aiContext.pdf.progress': progress,
        'aiContext.pdf.signalGenerationId': signalGenerationId || null,
        'aiContext.pdf.sourceFingerprint': sourceFingerprint,
        'aiContext.pdf.sourcesSnapshot': cleanUndefined(sourcesSnapshot),
        'aiContext.pdf.finishedAt': now,
        'aiContext.pdf.generatedAt': now,
        'aiContext.pdf.fileName': fileName,
        'aiContext.pdf.mimeType': mimeType,
        'aiContext.pdf.storageKey': storageKey,
        'aiContext.pdf.localPath': localPath,
        'aiContext.pdf.downloadUrl': downloadUrl,
        'aiContext.pdf.sizeBytes': Number(sizeBytes || 0),
        'aiContext.pdf.pageCount': pageCount == null ? null : Number(pageCount),
        'aiContext.pdf.renderer': renderer || null,
        'aiContext.pdf.version': Number(version || 1),
        'aiContext.pdf.error': null,

        'aiContext.needsPdfRebuild': false,
      },
    },
    { new: true }
  );
};

/**
 * Marca error PDF solo si generationId sigue vigente
 */
McpDataSchema.statics.failPdfGeneration = async function (
  userId,
  generationId,
  errorMessage,
  {
    stage = 'pdf_failed',
    progress = 0,
    finishedAt = null,
  } = {}
) {
  const now = nowIfMissing(finishedAt);
  const error = errorMessage == null ? 'PDF_GENERATION_FAILED' : String(errorMessage);

  return this.findOneAndUpdate(
    { userId, kind: 'root', 'aiContext.pdf.generationId': generationId },
    {
      $set: {
        updatedAt: now,
        'aiContext.pdf.status': 'failed',
        'aiContext.pdf.stage': stage,
        'aiContext.pdf.progress': progress,
        'aiContext.pdf.finishedAt': now,
        'aiContext.pdf.error': error,
        'aiContext.needsPdfRebuild': true,
      },
    },
    { new: true }
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
      $unset: buildRootUnset(),
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

/* =========================
 * Virtuals / helpers de vigencia
 * ========================= */

McpDataSchema.methods.getCurrentSourceFingerprint = function () {
  return this?.aiContext?.currentSourceFingerprint || null;
};

McpDataSchema.methods.isSignalCurrent = function () {
  const current = this?.aiContext?.currentSourceFingerprint || null;
  const signal = this?.aiContext?.signal || null;
  return !!(
    current &&
    signal &&
    signal.status === 'ready' &&
    signal.sourceFingerprint &&
    signal.sourceFingerprint === current
  );
};

McpDataSchema.methods.isPdfCurrent = function () {
  const current = this?.aiContext?.currentSourceFingerprint || null;
  const pdf = this?.aiContext?.pdf || null;
  return !!(
    current &&
    pdf &&
    pdf.status === 'ready' &&
    pdf.sourceFingerprint &&
    pdf.sourceFingerprint === current
  );
};

module.exports = mongoose.models.McpData || model('McpData', McpDataSchema);