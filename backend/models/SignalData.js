// backend/models/SignalData.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* =========================
 * Shared helpers
 * ========================= */
function isPlainObject(value) {
  if (value == null || typeof value !== 'object') return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function cleanUndefined(obj) {
  if (obj === undefined) return undefined;
  if (obj === null) return null;

  if (obj instanceof Date) return obj;
  if (obj instanceof Types.ObjectId) return obj;

  if (Array.isArray(obj)) {
    return obj
      .map(cleanUndefined)
      .filter((v) => v !== undefined);
  }

  if (!isPlainObject(obj)) return obj;

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleaned = cleanUndefined(v);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out;
}

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toNum(v, fallback = 0) {
  if (v == null && fallback === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function uniqStrings(arr, max = 50) {
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(arr) ? arr : []) {
    const s = safeStr(item).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }

  return out;
}

function nowDate() {
  return new Date();
}

function parseDateMs(v) {
  if (!v) return 0;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

function calcDurationMs(startedAt, finishedAt) {
  const startMs =
    startedAt instanceof Date ? startedAt.getTime() : parseDateMs(startedAt);
  const endMs =
    finishedAt instanceof Date ? finishedAt.getTime() : parseDateMs(finishedAt);

  if (!startMs || !endMs || endMs < startMs) return 0;
  return endMs - startMs;
}

function normalizeProgress(v) {
  const n = toNum(v, 0);
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.trunc(n);
}

function normalizeStatus(v) {
  const s = safeStr(v).trim().toLowerCase();
  if (s === 'processing') return 'processing';
  if (s === 'done') return 'done';
  if (s === 'error') return 'error';
  return 'idle';
}

function normalizePdfStatus(v) {
  const s = safeStr(v).trim().toLowerCase();
  if (s === 'processing') return 'processing';
  if (s === 'ready') return 'ready';
  if (s === 'failed') return 'failed';
  return 'idle';
}

function buildSourcesStatusSummary(raw = {}) {
  const src = raw || {};

  const normalizeOne = (item = {}) => ({
    connected: !!item?.connected,
    rootReady: !!item?.rootReady,
    ready: !!item?.ready,
    usable: !!item?.usable,
    snapshotId: item?.snapshotId || null,
    chunkCount: toNum(item?.chunkCount, 0),
    datasets: uniqStrings(item?.datasets || [], 25),
    missingRequired: uniqStrings(item?.missingRequired || [], 25),
    hasAnyOptional: !!item?.hasAnyOptional,
    accountId: item?.accountId || null,
    customerId: item?.customerId || null,
    propertyId: item?.propertyId || null,
    lastError: item?.lastError || null,
  });

  return {
    metaAds: normalizeOne(src?.metaAds),
    googleAds: normalizeOne(src?.googleAds),
    ga4: normalizeOne(src?.ga4),
  };
}

/* =========================
 * Sub-schemas
 * ========================= */
const SignalSourcesSchema = new Schema(
  {
    connectedSources: { type: [String], default: [] },
    usableSources: { type: [String], default: [] },
    pendingConnectedSources: { type: [String], default: [] },
    failedSources: { type: [String], default: [] },

    sourceSnapshots: { type: Schema.Types.Mixed, default: null },
    sourcesStatus: { type: Schema.Types.Mixed, default: null },

    sourcesFingerprint: { type: String, default: null, index: true },
    currentSourcesFingerprint: { type: String, default: null },
    fingerprintVersion: { type: Number, default: 1 },
  },
  { _id: false, strict: false }
);

const SignalPdfStateSchema = new Schema(
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

    storageKey: { type: String, default: null },
    localPath: { type: String, default: null },
    downloadUrl: { type: String, default: null },

    generatedAt: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },
    pageCount: { type: Number, default: null },

    renderer: { type: String, default: null },
    version: { type: Number, default: 1 },
    error: { type: String, default: null },

    pdfFingerprint: { type: String, default: null, index: true },
    currentPdfFingerprint: { type: String, default: null },

    requestedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
  },
  { _id: false, strict: false }
);

/* =========================
 * Main schema
 * ========================= */
const SignalDataSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    rootId: { type: Types.ObjectId, ref: 'McpData', default: null, index: true },

    signalRunId: { type: String, required: true, index: true },
    buildAttemptId: { type: String, default: null, index: true },

    trigger: { type: String, default: 'system' },
    reason: { type: String, default: null },
    requestedBy: { type: String, default: 'system' },

    status: {
      type: String,
      enum: ['idle', 'processing', 'done', 'error'],
      default: 'idle',
      index: true,
    },
    stage: { type: String, default: 'idle', index: true },
    progress: { type: Number, default: 0 },

    signalComplete: { type: Boolean, default: false, index: true },
    hasSignal: { type: Boolean, default: false },
    signalValidForPdf: { type: Boolean, default: false },

    signalCurrent: { type: Boolean, default: false, index: true },
    pdfCurrent: { type: Boolean, default: false, index: true },
    needsSignalRebuild: { type: Boolean, default: false, index: true },
    needsPdfRebuild: { type: Boolean, default: false, index: true },

    snapshotId: { type: String, default: null, index: true },
    contextRangeDays: { type: Number, default: null },
    storageRangeDays: { type: Number, default: null },

    usedOpenAI: { type: Boolean, default: false },
    model: { type: String, default: null },

    sources: {
      type: SignalSourcesSchema,
      default: () => ({}),
    },

    pdf: {
      type: SignalPdfStateSchema,
      default: () => ({}),
    },

    staleReason: { type: String, default: null },
    invalidatedAt: { type: Date, default: null },
    invalidationReason: { type: String, default: null },
    supersededByAttemptId: { type: String, default: null, index: true },

    error: { type: String, default: null },
    errorCode: { type: String, default: null },
    errorStage: { type: String, default: null },

    startedAt: { type: Date, default: null, index: true },
    finishedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },

    meta: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'signaldata',
    timestamps: true,
    minimize: true,
  }
);

/* =========================
 * Indexes
 * ========================= */
SignalDataSchema.index({ signalRunId: 1 }, { unique: true });
SignalDataSchema.index({ userId: 1, createdAt: -1 });
SignalDataSchema.index({ userId: 1, status: 1, createdAt: -1 });
SignalDataSchema.index({ userId: 1, buildAttemptId: 1 });
SignalDataSchema.index({ userId: 1, signalComplete: 1, createdAt: -1 });
SignalDataSchema.index({ userId: 1, signalCurrent: 1, createdAt: -1 });
SignalDataSchema.index({ userId: 1, pdfCurrent: 1, createdAt: -1 });
SignalDataSchema.index({ userId: 1, needsSignalRebuild: 1, createdAt: -1 });
SignalDataSchema.index({ userId: 1, needsPdfRebuild: 1, createdAt: -1 });
SignalDataSchema.index({ userId: 1, 'sources.sourcesFingerprint': 1 });
SignalDataSchema.index({ rootId: 1, createdAt: -1 });
SignalDataSchema.index({ 'pdf.status': 1, createdAt: -1 });

/* =========================
 * Internal normalizers
 * ========================= */
function normalizeBasePayload(payload = {}) {
  const cleaned = cleanUndefined(payload || {});
  const now = nowDate();

  const startedAt = cleaned?.startedAt
    ? new Date(cleaned.startedAt)
    : null;

  const finishedAt = cleaned?.finishedAt
    ? new Date(cleaned.finishedAt)
    : null;

  const failedAt = cleaned?.failedAt
    ? new Date(cleaned.failedAt)
    : null;

  const lastHeartbeatAt = cleaned?.lastHeartbeatAt
    ? new Date(cleaned.lastHeartbeatAt)
    : now;

  return {
    userId: cleaned.userId,
    rootId: cleaned.rootId || null,

    signalRunId: safeStr(cleaned.signalRunId).trim(),
    buildAttemptId: safeStr(cleaned.buildAttemptId).trim() || null,

    trigger: safeStr(cleaned.trigger).trim() || 'system',
    reason: safeStr(cleaned.reason).trim() || null,
    requestedBy: safeStr(cleaned.requestedBy).trim() || 'system',

    status: normalizeStatus(cleaned.status),
    stage: safeStr(cleaned.stage).trim() || 'idle',
    progress: normalizeProgress(cleaned.progress),

    signalComplete: !!cleaned.signalComplete,
    hasSignal: !!cleaned.hasSignal,
    signalValidForPdf: !!cleaned.signalValidForPdf,

    signalCurrent: !!cleaned.signalCurrent,
    pdfCurrent: !!cleaned.pdfCurrent,
    needsSignalRebuild: !!cleaned.needsSignalRebuild,
    needsPdfRebuild: !!cleaned.needsPdfRebuild,

    snapshotId: safeStr(cleaned.snapshotId).trim() || null,
    contextRangeDays: toNum(cleaned.contextRangeDays, null),
    storageRangeDays: toNum(cleaned.storageRangeDays, null),

    usedOpenAI: !!cleaned.usedOpenAI,
    model: safeStr(cleaned.model).trim() || null,

    sources: {
      connectedSources: uniqStrings(cleaned?.sources?.connectedSources || [], 25),
      usableSources: uniqStrings(cleaned?.sources?.usableSources || [], 25),
      pendingConnectedSources: uniqStrings(cleaned?.sources?.pendingConnectedSources || [], 25),
      failedSources: uniqStrings(cleaned?.sources?.failedSources || [], 25),
      sourceSnapshots: cleaned?.sources?.sourceSnapshots || null,
      sourcesStatus: buildSourcesStatusSummary(cleaned?.sources?.sourcesStatus || {}),
      sourcesFingerprint: safeStr(cleaned?.sources?.sourcesFingerprint).trim() || null,
      currentSourcesFingerprint: safeStr(cleaned?.sources?.currentSourcesFingerprint).trim() || null,
      fingerprintVersion: toNum(cleaned?.sources?.fingerprintVersion, 1) || 1,
    },

    pdf: {
      status: normalizePdfStatus(cleaned?.pdf?.status),
      stage: safeStr(cleaned?.pdf?.stage).trim() || 'idle',
      progress: normalizeProgress(cleaned?.pdf?.progress),
      fileName: cleaned?.pdf?.fileName || null,
      mimeType: cleaned?.pdf?.mimeType || 'application/pdf',
      storageKey: cleaned?.pdf?.storageKey || null,
      localPath: cleaned?.pdf?.localPath || null,
      downloadUrl: cleaned?.pdf?.downloadUrl || null,
      generatedAt: cleaned?.pdf?.generatedAt || null,
      sizeBytes: toNum(cleaned?.pdf?.sizeBytes, 0),
      pageCount: toNum(cleaned?.pdf?.pageCount, 0) || null,
      renderer: cleaned?.pdf?.renderer || null,
      version: toNum(cleaned?.pdf?.version, 1) || 1,
      error: cleaned?.pdf?.error || null,
      pdfFingerprint: safeStr(cleaned?.pdf?.pdfFingerprint).trim() || null,
      currentPdfFingerprint: safeStr(cleaned?.pdf?.currentPdfFingerprint).trim() || null,
      requestedAt: cleaned?.pdf?.requestedAt ? new Date(cleaned.pdf.requestedAt) : null,
      startedAt: cleaned?.pdf?.startedAt ? new Date(cleaned.pdf.startedAt) : null,
      finishedAt: cleaned?.pdf?.finishedAt ? new Date(cleaned.pdf.finishedAt) : null,
      failedAt: cleaned?.pdf?.failedAt ? new Date(cleaned.pdf.failedAt) : null,
    },

    staleReason: safeStr(cleaned.staleReason).trim() || null,
    invalidatedAt: cleaned?.invalidatedAt ? new Date(cleaned.invalidatedAt) : null,
    invalidationReason: safeStr(cleaned.invalidationReason).trim() || null,
    supersededByAttemptId: safeStr(cleaned.supersededByAttemptId).trim() || null,

    error: cleaned.error || null,
    errorCode: safeStr(cleaned.errorCode).trim() || null,
    errorStage: safeStr(cleaned.errorStage).trim() || null,

    startedAt,
    finishedAt,
    failedAt,
    lastHeartbeatAt,
    durationMs:
      toNum(cleaned.durationMs, 0) ||
      calcDurationMs(startedAt, finishedAt || failedAt),

    meta: cleaned.meta || null,
    updatedAt: now,
  };
}

function normalizePatchPayload(patch = {}) {
  const cleaned = cleanUndefined(patch || {});
  const out = {};

  if ('rootId' in cleaned) out.rootId = cleaned.rootId || null;
  if ('buildAttemptId' in cleaned) out.buildAttemptId = safeStr(cleaned.buildAttemptId).trim() || null;
  if ('trigger' in cleaned) out.trigger = safeStr(cleaned.trigger).trim() || 'system';
  if ('reason' in cleaned) out.reason = safeStr(cleaned.reason).trim() || null;
  if ('requestedBy' in cleaned) out.requestedBy = safeStr(cleaned.requestedBy).trim() || 'system';

  if ('status' in cleaned) out.status = normalizeStatus(cleaned.status);
  if ('stage' in cleaned) out.stage = safeStr(cleaned.stage).trim() || 'idle';
  if ('progress' in cleaned) out.progress = normalizeProgress(cleaned.progress);

  if ('signalComplete' in cleaned) out.signalComplete = !!cleaned.signalComplete;
  if ('hasSignal' in cleaned) out.hasSignal = !!cleaned.hasSignal;
  if ('signalValidForPdf' in cleaned) out.signalValidForPdf = !!cleaned.signalValidForPdf;

  if ('signalCurrent' in cleaned) out.signalCurrent = !!cleaned.signalCurrent;
  if ('pdfCurrent' in cleaned) out.pdfCurrent = !!cleaned.pdfCurrent;
  if ('needsSignalRebuild' in cleaned) out.needsSignalRebuild = !!cleaned.needsSignalRebuild;
  if ('needsPdfRebuild' in cleaned) out.needsPdfRebuild = !!cleaned.needsPdfRebuild;

  if ('snapshotId' in cleaned) out.snapshotId = safeStr(cleaned.snapshotId).trim() || null;
  if ('contextRangeDays' in cleaned) out.contextRangeDays = toNum(cleaned.contextRangeDays, null);
  if ('storageRangeDays' in cleaned) out.storageRangeDays = toNum(cleaned.storageRangeDays, null);

  if ('usedOpenAI' in cleaned) out.usedOpenAI = !!cleaned.usedOpenAI;
  if ('model' in cleaned) out.model = safeStr(cleaned.model).trim() || null;

  if ('staleReason' in cleaned) out.staleReason = safeStr(cleaned.staleReason).trim() || null;
  if ('invalidatedAt' in cleaned) out.invalidatedAt = cleaned.invalidatedAt ? new Date(cleaned.invalidatedAt) : null;
  if ('invalidationReason' in cleaned) out.invalidationReason = safeStr(cleaned.invalidationReason).trim() || null;
  if ('supersededByAttemptId' in cleaned) out.supersededByAttemptId = safeStr(cleaned.supersededByAttemptId).trim() || null;

  if ('error' in cleaned) out.error = cleaned.error || null;
  if ('errorCode' in cleaned) out.errorCode = safeStr(cleaned.errorCode).trim() || null;
  if ('errorStage' in cleaned) out.errorStage = safeStr(cleaned.errorStage).trim() || null;

  if ('startedAt' in cleaned) out.startedAt = cleaned.startedAt ? new Date(cleaned.startedAt) : null;
  if ('finishedAt' in cleaned) out.finishedAt = cleaned.finishedAt ? new Date(cleaned.finishedAt) : null;
  if ('failedAt' in cleaned) out.failedAt = cleaned.failedAt ? new Date(cleaned.failedAt) : null;

  out.lastHeartbeatAt =
    'lastHeartbeatAt' in cleaned && cleaned.lastHeartbeatAt
      ? new Date(cleaned.lastHeartbeatAt)
      : nowDate();

  if ('meta' in cleaned) out.meta = cleaned.meta || null;

  if ('sources' in cleaned) {
    const current = cleaned.sources || {};
    out.sources = {
      connectedSources: uniqStrings(current.connectedSources || [], 25),
      usableSources: uniqStrings(current.usableSources || [], 25),
      pendingConnectedSources: uniqStrings(current.pendingConnectedSources || [], 25),
      failedSources: uniqStrings(current.failedSources || [], 25),
      sourceSnapshots: current.sourceSnapshots || null,
      sourcesStatus: buildSourcesStatusSummary(current.sourcesStatus || {}),
      sourcesFingerprint: safeStr(current.sourcesFingerprint).trim() || null,
      currentSourcesFingerprint: safeStr(current.currentSourcesFingerprint).trim() || null,
      fingerprintVersion: toNum(current.fingerprintVersion, 1) || 1,
    };
  }

  if ('pdf' in cleaned) {
    const pdf = cleaned.pdf || {};
    out.pdf = {
      status: normalizePdfStatus(pdf.status),
      stage: safeStr(pdf.stage).trim() || 'idle',
      progress: normalizeProgress(pdf.progress),
      fileName: pdf.fileName || null,
      mimeType: pdf.mimeType || 'application/pdf',
      storageKey: pdf.storageKey || null,
      localPath: pdf.localPath || null,
      downloadUrl: pdf.downloadUrl || null,
      generatedAt: pdf.generatedAt || null,
      sizeBytes: toNum(pdf.sizeBytes, 0),
      pageCount: toNum(pdf.pageCount, 0) || null,
      renderer: pdf.renderer || null,
      version: toNum(pdf.version, 1) || 1,
      error: pdf.error || null,
      pdfFingerprint: safeStr(pdf.pdfFingerprint).trim() || null,
      currentPdfFingerprint: safeStr(pdf.currentPdfFingerprint).trim() || null,
      requestedAt: pdf.requestedAt ? new Date(pdf.requestedAt) : null,
      startedAt: pdf.startedAt ? new Date(pdf.startedAt) : null,
      finishedAt: pdf.finishedAt ? new Date(pdf.finishedAt) : null,
      failedAt: pdf.failedAt ? new Date(pdf.failedAt) : null,
    };
  }

  const effectiveStartedAt = out.startedAt || cleaned.startedAt || null;
  const effectiveEnd = out.finishedAt || out.failedAt;

  if ('durationMs' in cleaned) {
    out.durationMs = toNum(cleaned.durationMs, 0);
  } else if (effectiveStartedAt && effectiveEnd) {
    out.durationMs = calcDurationMs(effectiveStartedAt, effectiveEnd);
  }

  return cleanUndefined(out);
}

/* =========================
 * Statics
 * ========================= */

/**
 * Crea o actualiza un run por signalRunId.
 * Útil para sembrar el registro al iniciar el build.
 */
SignalDataSchema.statics.upsertRun = async function (payload = {}) {
  const normalized = normalizeBasePayload(payload);

  if (!normalized.userId) {
    throw new Error('SIGNALDATA_USER_ID_REQUIRED');
  }
  if (!normalized.signalRunId) {
    throw new Error('SIGNALDATA_SIGNAL_RUN_ID_REQUIRED');
  }

  return this.findOneAndUpdate(
    { signalRunId: normalized.signalRunId },
    {
      $set: normalized,
      $setOnInsert: {
        createdAt: nowDate(),
      },
    },
    { upsert: true, new: true }
  );
};

/**
 * Busca el último run del usuario.
 */
SignalDataSchema.statics.findLatestForUser = async function (userId) {
  return this.findOne({ userId })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();
};

/**
 * Busca un run por buildAttemptId.
 */
SignalDataSchema.statics.findByAttempt = async function (userId, buildAttemptId) {
  const cleanAttempt = safeStr(buildAttemptId).trim();
  if (!userId || !cleanAttempt) return null;

  return this.findOne({ userId, buildAttemptId: cleanAttempt })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();
};

/**
 * Busca un run activo reciente del usuario.
 */
SignalDataSchema.statics.findActiveRunForUser = async function (userId) {
  return this.findOne({
    userId,
    status: 'processing',
  })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();
};

/**
 * Último run completado y válido para PDF.
 */
SignalDataSchema.statics.findLatestCompletedValidRunForUser = async function (userId) {
  return this.findOne({
    userId,
    status: 'done',
    signalComplete: true,
    hasSignal: true,
    signalValidForPdf: true,
  })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();
};

/**
 * Último run current del usuario.
 */
SignalDataSchema.statics.findLatestCurrentRunForUser = async function (userId) {
  return this.findOne({
    userId,
    signalCurrent: true,
  })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();
};

/**
 * Patch genérico por signalRunId.
 */
SignalDataSchema.statics.patchRun = async function (signalRunId, patch = {}) {
  const cleanRunId = safeStr(signalRunId).trim();
  if (!cleanRunId) return null;

  const normalized = normalizePatchPayload(patch);
  normalized.updatedAt = nowDate();

  return this.findOneAndUpdate(
    { signalRunId: cleanRunId },
    { $set: normalized },
    { new: true }
  );
};

/**
 * Patch genérico por buildAttemptId.
 */
SignalDataSchema.statics.patchRunByAttempt = async function (userId, buildAttemptId, patch = {}) {
  const cleanAttempt = safeStr(buildAttemptId).trim();
  if (!userId || !cleanAttempt) return null;

  const normalized = normalizePatchPayload(patch);
  normalized.updatedAt = nowDate();

  return this.findOneAndUpdate(
    { userId, buildAttemptId: cleanAttempt },
    { $set: normalized },
    { new: true, sort: { createdAt: -1 } }
  );
};

/**
 * Marca avance normal de lifecycle.
 */
SignalDataSchema.statics.markStage = async function (
  userId,
  buildAttemptId,
  {
    rootId = undefined,
    status = 'processing',
    stage = 'idle',
    progress = 0,
    snapshotId = undefined,
    contextRangeDays = undefined,
    storageRangeDays = undefined,
    usedOpenAI = undefined,
    model = undefined,
    hasSignal = undefined,
    signalValidForPdf = undefined,
    signalCurrent = undefined,
    pdfCurrent = undefined,
    needsSignalRebuild = undefined,
    needsPdfRebuild = undefined,
    sources = undefined,
    error = undefined,
    staleReason = undefined,
    invalidationReason = undefined,
    meta = undefined,
  } = {}
) {
  return this.patchRunByAttempt(userId, buildAttemptId, {
    rootId,
    status,
    stage,
    progress,
    snapshotId,
    contextRangeDays,
    storageRangeDays,
    usedOpenAI,
    model,
    hasSignal,
    signalValidForPdf,
    signalCurrent,
    pdfCurrent,
    needsSignalRebuild,
    needsPdfRebuild,
    sources,
    error,
    staleReason,
    invalidationReason,
    meta,
    lastHeartbeatAt: nowDate(),
  });
};

/**
 * Marca run completado.
 */
SignalDataSchema.statics.completeRun = async function (
  userId,
  buildAttemptId,
  patch = {}
) {
  const finishedAt = patch?.finishedAt || nowDate();

  return this.patchRunByAttempt(userId, buildAttemptId, {
    ...patch,
    status: 'done',
    stage: patch?.stage || 'completed',
    progress: 100,
    signalComplete: true,
    hasSignal: 'hasSignal' in (patch || {}) ? !!patch.hasSignal : true,
    signalValidForPdf:
      'signalValidForPdf' in (patch || {}) ? !!patch.signalValidForPdf : true,
    signalCurrent:
      'signalCurrent' in (patch || {}) ? !!patch.signalCurrent : true,
    pdfCurrent:
      'pdfCurrent' in (patch || {}) ? !!patch.pdfCurrent : false,
    needsSignalRebuild:
      'needsSignalRebuild' in (patch || {}) ? !!patch.needsSignalRebuild : false,
    needsPdfRebuild:
      'needsPdfRebuild' in (patch || {}) ? !!patch.needsPdfRebuild : true,
    finishedAt,
    failedAt: null,
    invalidatedAt: null,
    invalidationReason: null,
    staleReason: null,
    error: null,
    errorCode: null,
    errorStage: null,
    durationMs: calcDurationMs(patch?.startedAt || null, finishedAt),
    lastHeartbeatAt: nowDate(),
  });
};

/**
 * Marca run fallido.
 */
SignalDataSchema.statics.failRun = async function (
  userId,
  buildAttemptId,
  {
    error = 'SIGNAL_BUILD_FAILED',
    errorCode = null,
    errorStage = 'failed',
    stage = 'failed',
    progress = 100,
    hasSignal = false,
    signalValidForPdf = false,
    signalCurrent = false,
    pdfCurrent = false,
    needsSignalRebuild = false,
    needsPdfRebuild = false,
    sources = undefined,
    snapshotId = undefined,
    supersededByAttemptId = undefined,
    meta = undefined,
  } = {}
) {
  const failedAt = nowDate();

  return this.patchRunByAttempt(userId, buildAttemptId, {
    status: 'error',
    stage,
    progress,
    signalComplete: false,
    hasSignal,
    signalValidForPdf,
    signalCurrent,
    pdfCurrent,
    needsSignalRebuild,
    needsPdfRebuild,
    error,
    errorCode: safeStr(errorCode).trim() || safeStr(error).trim() || null,
    errorStage: safeStr(errorStage).trim() || 'failed',
    failedAt,
    snapshotId,
    supersededByAttemptId,
    sources,
    meta,
    durationMs: 0,
    lastHeartbeatAt: nowDate(),
  });
};

/**
 * Marca run invalidado porque cambió el source fingerprint.
 * Esto NO es un error técnico; es stale semántico.
 */
SignalDataSchema.statics.invalidateRun = async function (
  userId,
  buildAttemptId,
  {
    invalidationReason = 'SOURCE_STATE_CHANGED',
    staleReason = 'SOURCE_STATE_CHANGED',
    currentSourcesFingerprint = undefined,
    currentPdfFingerprint = undefined,
    needsSignalRebuild = true,
    needsPdfRebuild = true,
    signalCurrent = false,
    pdfCurrent = false,
    meta = undefined,
  } = {}
) {
  const invalidatedAt = nowDate();

  const current = await this.findOne({ userId, buildAttemptId })
    .sort({ createdAt: -1, updatedAt: -1 });

  if (!current) return null;

  const nextSources = {
    ...(current.sources?.toObject ? current.sources.toObject() : current.sources || {}),
  };

  if (currentSourcesFingerprint !== undefined) {
    nextSources.currentSourcesFingerprint =
      safeStr(currentSourcesFingerprint).trim() || null;
  }

  const nextPdf = {
    ...(current.pdf?.toObject ? current.pdf.toObject() : current.pdf || {}),
  };

  if (currentPdfFingerprint !== undefined) {
    nextPdf.currentPdfFingerprint =
      safeStr(currentPdfFingerprint).trim() || null;
  }

  return this.findOneAndUpdate(
    { userId, buildAttemptId },
    {
      $set: {
        signalCurrent: !!signalCurrent,
        pdfCurrent: !!pdfCurrent,
        needsSignalRebuild: !!needsSignalRebuild,
        needsPdfRebuild: !!needsPdfRebuild,
        staleReason: safeStr(staleReason).trim() || null,
        invalidationReason: safeStr(invalidationReason).trim() || null,
        invalidatedAt,
        sources: nextSources,
        pdf: nextPdf,
        meta: meta === undefined ? current.meta || null : meta,
        updatedAt: invalidatedAt,
        lastHeartbeatAt: invalidatedAt,
      },
    },
    { new: true, sort: { createdAt: -1 } }
  );
};

/**
 * Invalida el último run current del usuario.
 */
SignalDataSchema.statics.invalidateLatestCurrentRunForUser = async function (
  userId,
  patch = {}
) {
  const current = await this.findOne({
    userId,
    signalCurrent: true,
  }).sort({ createdAt: -1, updatedAt: -1 });

  if (!current) return null;

  return this.invalidateRun(userId, current.buildAttemptId, patch);
};

/**
 * Actualiza estado del PDF asociado al run.
 */
SignalDataSchema.statics.markPdfState = async function (
  userId,
  buildAttemptId,
  pdfPatch = {}
) {
  const status = normalizePdfStatus(pdfPatch?.status);
  const now = nowDate();

  const current = await this.findOne({ userId, buildAttemptId })
    .sort({ createdAt: -1, updatedAt: -1 });

  if (!current) return null;

  const nextPdf = {
    ...(current.pdf?.toObject ? current.pdf.toObject() : current.pdf || {}),
    status,
    stage: safeStr(pdfPatch?.stage).trim() || current?.pdf?.stage || 'idle',
    progress: normalizeProgress(
      'progress' in (pdfPatch || {}) ? pdfPatch.progress : current?.pdf?.progress
    ),
    fileName: 'fileName' in (pdfPatch || {}) ? (pdfPatch.fileName || null) : current?.pdf?.fileName,
    mimeType: 'mimeType' in (pdfPatch || {}) ? (pdfPatch.mimeType || 'application/pdf') : (current?.pdf?.mimeType || 'application/pdf'),
    storageKey: 'storageKey' in (pdfPatch || {}) ? (pdfPatch.storageKey || null) : current?.pdf?.storageKey,
    localPath: 'localPath' in (pdfPatch || {}) ? (pdfPatch.localPath || null) : current?.pdf?.localPath,
    downloadUrl: 'downloadUrl' in (pdfPatch || {}) ? (pdfPatch.downloadUrl || null) : current?.pdf?.downloadUrl,
    generatedAt: 'generatedAt' in (pdfPatch || {}) ? (pdfPatch.generatedAt || null) : current?.pdf?.generatedAt,
    sizeBytes: 'sizeBytes' in (pdfPatch || {}) ? toNum(pdfPatch.sizeBytes, 0) : toNum(current?.pdf?.sizeBytes, 0),
    pageCount: 'pageCount' in (pdfPatch || {}) ? (toNum(pdfPatch.pageCount, 0) || null) : (toNum(current?.pdf?.pageCount, 0) || null),
    renderer: 'renderer' in (pdfPatch || {}) ? (pdfPatch.renderer || null) : current?.pdf?.renderer,
    version: 'version' in (pdfPatch || {}) ? (toNum(pdfPatch.version, 1) || 1) : (toNum(current?.pdf?.version, 1) || 1),
    error: 'error' in (pdfPatch || {}) ? (pdfPatch.error || null) : current?.pdf?.error,
    pdfFingerprint: 'pdfFingerprint' in (pdfPatch || {})
      ? (safeStr(pdfPatch.pdfFingerprint).trim() || null)
      : (current?.pdf?.pdfFingerprint || null),
    currentPdfFingerprint: 'currentPdfFingerprint' in (pdfPatch || {})
      ? (safeStr(pdfPatch.currentPdfFingerprint).trim() || null)
      : (current?.pdf?.currentPdfFingerprint || null),
    requestedAt: current?.pdf?.requestedAt || null,
    startedAt: current?.pdf?.startedAt || null,
    finishedAt: current?.pdf?.finishedAt || null,
    failedAt: current?.pdf?.failedAt || null,
  };

  const patchSet = {
    pdf: nextPdf,
    updatedAt: now,
    lastHeartbeatAt: now,
  };

  if ('pdfCurrent' in (pdfPatch || {})) {
    patchSet.pdfCurrent = !!pdfPatch.pdfCurrent;
  }
  if ('needsPdfRebuild' in (pdfPatch || {})) {
    patchSet.needsPdfRebuild = !!pdfPatch.needsPdfRebuild;
  }

  if (status === 'processing') {
    if (!nextPdf.requestedAt) nextPdf.requestedAt = now;
    if (!nextPdf.startedAt) nextPdf.startedAt = now;
    nextPdf.failedAt = null;
    patchSet.pdfCurrent = false;
  }

  if (status === 'ready') {
    nextPdf.finishedAt = now;
    nextPdf.failedAt = null;
    patchSet.pdfCurrent =
      'pdfCurrent' in (pdfPatch || {}) ? !!pdfPatch.pdfCurrent : true;
    patchSet.needsPdfRebuild =
      'needsPdfRebuild' in (pdfPatch || {}) ? !!pdfPatch.needsPdfRebuild : false;
  }

  if (status === 'failed') {
    nextPdf.failedAt = now;
    patchSet.pdfCurrent = false;
    patchSet.needsPdfRebuild = true;
  }

  return this.findOneAndUpdate(
    { userId, buildAttemptId },
    {
      $set: patchSet,
    },
    { new: true, sort: { createdAt: -1 } }
  );
};

/**
 * Marca todos los runs current viejos como no current.
 */
SignalDataSchema.statics.clearCurrentFlagsForUser = async function (
  userId,
  {
    exceptBuildAttemptId = null,
    invalidationReason = null,
    currentSourcesFingerprint = null,
    currentPdfFingerprint = null,
  } = {}
) {
  const query = { userId, $or: [{ signalCurrent: true }, { pdfCurrent: true }] };

  if (safeStr(exceptBuildAttemptId).trim()) {
    query.buildAttemptId = { $ne: safeStr(exceptBuildAttemptId).trim() };
  }

  const patch = {
    signalCurrent: false,
    pdfCurrent: false,
    needsSignalRebuild: true,
    needsPdfRebuild: true,
    invalidatedAt: nowDate(),
    lastHeartbeatAt: nowDate(),
    updatedAt: nowDate(),
  };

  if (safeStr(invalidationReason).trim()) {
    patch.invalidationReason = safeStr(invalidationReason).trim();
    patch.staleReason = safeStr(invalidationReason).trim();
  }

  if (safeStr(currentSourcesFingerprint).trim()) {
    patch['sources.currentSourcesFingerprint'] = safeStr(currentSourcesFingerprint).trim();
  }

  if (safeStr(currentPdfFingerprint).trim()) {
    patch['pdf.currentPdfFingerprint'] = safeStr(currentPdfFingerprint).trim();
  }

  return this.updateMany(query, { $set: patch });
};

module.exports = mongoose.models.SignalData || model('SignalData', SignalDataSchema);