// backend/models/DailySignalDeliveryRun.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/* =========================
 * Helpers
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

function normSimpleString(v = '') {
  const s = String(v || '').trim();
  return s || null;
}

function normEmail(v = '') {
  const s = String(v || '').trim().toLowerCase();
  return s || null;
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowDate() {
  return new Date();
}

function parseDateMs(v) {
  if (!v) return 0;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

function calcDurationMs(startedAt, endedAt) {
  const startMs =
    startedAt instanceof Date ? startedAt.getTime() : parseDateMs(startedAt);
  const endMs =
    endedAt instanceof Date ? endedAt.getTime() : parseDateMs(endedAt);

  if (!startMs || !endMs || endMs < startMs) return 0;
  return endMs - startMs;
}

function normalizeStatus(v) {
  const s = safeStr(v).trim().toLowerCase();
  const allowed = new Set([
    'queued',
    'building_signal',
    'building_pdf',
    'sending_email',
    'sent',
    'failed',
    'skipped',
  ]);
  return allowed.has(s) ? s : 'queued';
}

function normalizeTrigger(v) {
  const s = safeStr(v).trim().toLowerCase();
  const allowed = new Set(['cron', 'manual_test', 'manual', 'system']);
  return allowed.has(s) ? s : 'system';
}

function buildDateKey(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/* =========================
 * Sub-schemas
 * ========================= */
const DeliveryEmailSchema = new Schema(
  {
    to: { type: String, default: null, trim: true, lowercase: true, set: normEmail },
    provider: { type: String, default: null, trim: true, set: normSimpleString },
    messageId: { type: String, default: null, trim: true, set: normSimpleString },
    from: { type: String, default: null, trim: true, set: normSimpleString },
    subject: { type: String, default: null, trim: true },
  },
  { _id: false }
);

const DeliveryPdfSchema = new Schema(
  {
    fileName: { type: String, default: null, trim: true },
    mimeType: { type: String, default: 'application/pdf' },
    localPath: { type: String, default: null, trim: true },
    downloadUrl: { type: String, default: null, trim: true },
    sizeBytes: { type: Number, default: 0 },
    pageCount: { type: Number, default: null },
    renderer: { type: String, default: null, trim: true, set: normSimpleString },
  },
  { _id: false }
);

/* =========================
 * Main schema
 * ========================= */
const DailySignalDeliveryRunSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    rootId: { type: Types.ObjectId, ref: 'McpData', default: null, index: true },
    signalRunId: { type: String, default: null, index: true, trim: true, set: normSimpleString },
    buildAttemptId: { type: String, default: null, index: true, trim: true, set: normSimpleString },

    // YYYY-MM-DD (clave lógica de "un envío por día por usuario")
    dateKey: { type: String, required: true, index: true, trim: true },

    trigger: {
      type: String,
      enum: ['cron', 'manual_test', 'manual', 'system'],
      default: 'system',
      index: true,
    },

    reason: { type: String, default: null, trim: true, set: normSimpleString },

    status: {
      type: String,
      enum: ['queued', 'building_signal', 'building_pdf', 'sending_email', 'sent', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },

    snapshotId: { type: String, default: null, trim: true, set: normSimpleString },
    sourceFingerprint: { type: String, default: null, trim: true, set: normSimpleString },
    connectionFingerprint: { type: String, default: null, trim: true, set: normSimpleString },

    email: {
      type: DeliveryEmailSchema,
      default: () => ({}),
    },

    pdf: {
      type: DeliveryPdfSchema,
      default: () => ({}),
    },

    attemptedAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    skippedAt: { type: Date, default: null },

    error: { type: String, default: null },
    errorCode: { type: String, default: null, trim: true, set: normSimpleString },

    durationMs: { type: Number, default: 0 },

    meta: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'daily_signal_delivery_runs',
    timestamps: true,
    minimize: true,
  }
);

/* =========================
 * Indexes
 * ========================= */
DailySignalDeliveryRunSchema.index(
  { userId: 1, dateKey: 1 },
  { unique: true }
);

DailySignalDeliveryRunSchema.index({ userId: 1, createdAt: -1 });
DailySignalDeliveryRunSchema.index({ status: 1, createdAt: -1 });
DailySignalDeliveryRunSchema.index({ trigger: 1, createdAt: -1 });
DailySignalDeliveryRunSchema.index({ signalRunId: 1, createdAt: -1 });
DailySignalDeliveryRunSchema.index({ buildAttemptId: 1, createdAt: -1 });
DailySignalDeliveryRunSchema.index({ attemptedAt: -1 });
DailySignalDeliveryRunSchema.index({ sentAt: -1 });

/* =========================
 * Internal normalizers
 * ========================= */
function normalizeBasePayload(payload = {}) {
  const cleaned = cleanUndefined(payload || {});
  const attemptedAt = cleaned.attemptedAt ? new Date(cleaned.attemptedAt) : nowDate();
  const sentAt = cleaned.sentAt ? new Date(cleaned.sentAt) : null;
  const failedAt = cleaned.failedAt ? new Date(cleaned.failedAt) : null;
  const skippedAt = cleaned.skippedAt ? new Date(cleaned.skippedAt) : null;

  const endedAt = sentAt || failedAt || skippedAt || null;

  return {
    userId: cleaned.userId,
    rootId: cleaned.rootId || null,
    signalRunId: normSimpleString(cleaned.signalRunId),
    buildAttemptId: normSimpleString(cleaned.buildAttemptId),

    dateKey: normSimpleString(cleaned.dateKey) || buildDateKey(attemptedAt),
    trigger: normalizeTrigger(cleaned.trigger),
    reason: normSimpleString(cleaned.reason),

    status: normalizeStatus(cleaned.status),

    snapshotId: normSimpleString(cleaned.snapshotId),
    sourceFingerprint: normSimpleString(cleaned.sourceFingerprint),
    connectionFingerprint: normSimpleString(cleaned.connectionFingerprint),

    email: {
      to: normEmail(cleaned?.email?.to),
      provider: normSimpleString(cleaned?.email?.provider),
      messageId: normSimpleString(cleaned?.email?.messageId),
      from: normSimpleString(cleaned?.email?.from),
      subject: normSimpleString(cleaned?.email?.subject),
    },

    pdf: {
      fileName: normSimpleString(cleaned?.pdf?.fileName),
      mimeType: normSimpleString(cleaned?.pdf?.mimeType) || 'application/pdf',
      localPath: normSimpleString(cleaned?.pdf?.localPath),
      downloadUrl: normSimpleString(cleaned?.pdf?.downloadUrl),
      sizeBytes: toNum(cleaned?.pdf?.sizeBytes, 0),
      pageCount: toNum(cleaned?.pdf?.pageCount, 0) || null,
      renderer: normSimpleString(cleaned?.pdf?.renderer),
    },

    attemptedAt,
    sentAt,
    failedAt,
    skippedAt,

    error: cleaned.error || null,
    errorCode: normSimpleString(cleaned.errorCode),

    durationMs:
      toNum(cleaned.durationMs, 0) ||
      calcDurationMs(attemptedAt, endedAt),

    meta: cleaned.meta || null,
    updatedAt: nowDate(),
  };
}

function normalizePatchPayload(patch = {}) {
  const cleaned = cleanUndefined(patch || {});
  const out = {};

  if ('rootId' in cleaned) out.rootId = cleaned.rootId || null;
  if ('signalRunId' in cleaned) out.signalRunId = normSimpleString(cleaned.signalRunId);
  if ('buildAttemptId' in cleaned) out.buildAttemptId = normSimpleString(cleaned.buildAttemptId);
  if ('dateKey' in cleaned) out.dateKey = normSimpleString(cleaned.dateKey);
  if ('trigger' in cleaned) out.trigger = normalizeTrigger(cleaned.trigger);
  if ('reason' in cleaned) out.reason = normSimpleString(cleaned.reason);

  if ('status' in cleaned) out.status = normalizeStatus(cleaned.status);

  if ('snapshotId' in cleaned) out.snapshotId = normSimpleString(cleaned.snapshotId);
  if ('sourceFingerprint' in cleaned) out.sourceFingerprint = normSimpleString(cleaned.sourceFingerprint);
  if ('connectionFingerprint' in cleaned) out.connectionFingerprint = normSimpleString(cleaned.connectionFingerprint);

  if ('email' in cleaned) {
    out.email = {
      to: normEmail(cleaned?.email?.to),
      provider: normSimpleString(cleaned?.email?.provider),
      messageId: normSimpleString(cleaned?.email?.messageId),
      from: normSimpleString(cleaned?.email?.from),
      subject: normSimpleString(cleaned?.email?.subject),
    };
  }

  if ('pdf' in cleaned) {
    out.pdf = {
      fileName: normSimpleString(cleaned?.pdf?.fileName),
      mimeType: normSimpleString(cleaned?.pdf?.mimeType) || 'application/pdf',
      localPath: normSimpleString(cleaned?.pdf?.localPath),
      downloadUrl: normSimpleString(cleaned?.pdf?.downloadUrl),
      sizeBytes: toNum(cleaned?.pdf?.sizeBytes, 0),
      pageCount: toNum(cleaned?.pdf?.pageCount, 0) || null,
      renderer: normSimpleString(cleaned?.pdf?.renderer),
    };
  }

  if ('attemptedAt' in cleaned) out.attemptedAt = cleaned.attemptedAt ? new Date(cleaned.attemptedAt) : null;
  if ('sentAt' in cleaned) out.sentAt = cleaned.sentAt ? new Date(cleaned.sentAt) : null;
  if ('failedAt' in cleaned) out.failedAt = cleaned.failedAt ? new Date(cleaned.failedAt) : null;
  if ('skippedAt' in cleaned) out.skippedAt = cleaned.skippedAt ? new Date(cleaned.skippedAt) : null;

  if ('error' in cleaned) out.error = cleaned.error || null;
  if ('errorCode' in cleaned) out.errorCode = normSimpleString(cleaned.errorCode);

  if ('meta' in cleaned) out.meta = cleaned.meta || null;

  const attemptedAt = out.attemptedAt || null;
  const endedAt = out.sentAt || out.failedAt || out.skippedAt || null;

  if ('durationMs' in cleaned) {
    out.durationMs = toNum(cleaned.durationMs, 0);
  } else if (attemptedAt && endedAt) {
    out.durationMs = calcDurationMs(attemptedAt, endedAt);
  }

  out.updatedAt = nowDate();
  return cleanUndefined(out);
}

/* =========================
 * Statics
 * ========================= */

/**
 * Crea o actualiza la corrida diaria del usuario para una dateKey.
 * Garantiza una sola corrida por usuario por día.
 */
DailySignalDeliveryRunSchema.statics.upsertForDay = async function ({
  userId,
  dateKey,
  trigger = 'system',
  reason = null,
  status = 'queued',
  rootId = null,
  signalRunId = null,
  buildAttemptId = null,
  snapshotId = null,
  sourceFingerprint = null,
  connectionFingerprint = null,
  email = null,
  pdf = null,
  attemptedAt = null,
  meta = null,
} = {}) {
  const normalized = normalizeBasePayload({
    userId,
    dateKey,
    trigger,
    reason,
    status,
    rootId,
    signalRunId,
    buildAttemptId,
    snapshotId,
    sourceFingerprint,
    connectionFingerprint,
    email,
    pdf,
    attemptedAt: attemptedAt || nowDate(),
    meta,
  });

  if (!normalized.userId) {
    throw new Error('DAILY_SIGNAL_DELIVERY_USER_ID_REQUIRED');
  }

  if (!normalized.dateKey) {
    throw new Error('DAILY_SIGNAL_DELIVERY_DATE_KEY_REQUIRED');
  }

  return this.findOneAndUpdate(
    { userId: normalized.userId, dateKey: normalized.dateKey },
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
 * Busca la corrida de un usuario para un día específico.
 */
DailySignalDeliveryRunSchema.statics.findByUserAndDateKey = async function (
  userId,
  dateKey
) {
  const cleanDateKey = normSimpleString(dateKey);
  if (!userId || !cleanDateKey) return null;

  return this.findOne({ userId, dateKey: cleanDateKey })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();
};

/**
 * Busca la última corrida del usuario.
 */
DailySignalDeliveryRunSchema.statics.findLatestForUser = async function (userId) {
  if (!userId) return null;

  return this.findOne({ userId })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();
};

/**
 * Patch genérico por userId + dateKey.
 */
DailySignalDeliveryRunSchema.statics.patchByUserAndDateKey = async function (
  userId,
  dateKey,
  patch = {}
) {
  const cleanDateKey = normSimpleString(dateKey);
  if (!userId || !cleanDateKey) return null;

  const normalized = normalizePatchPayload(patch);

  return this.findOneAndUpdate(
    { userId, dateKey: cleanDateKey },
    { $set: normalized },
    { new: true }
  );
};

/**
 * Marca etapa operativa.
 */
DailySignalDeliveryRunSchema.statics.markStatus = async function (
  userId,
  dateKey,
  {
    status,
    rootId,
    signalRunId,
    buildAttemptId,
    snapshotId,
    sourceFingerprint,
    connectionFingerprint,
    email,
    pdf,
    attemptedAt,
    reason,
    meta,
  } = {}
) {
  return this.patchByUserAndDateKey(userId, dateKey, {
    status,
    rootId,
    signalRunId,
    buildAttemptId,
    snapshotId,
    sourceFingerprint,
    connectionFingerprint,
    email,
    pdf,
    attemptedAt,
    reason,
    meta,
  });
};

/**
 * Marca corrida enviada correctamente.
 */
DailySignalDeliveryRunSchema.statics.markSent = async function (
  userId,
  dateKey,
  {
    rootId,
    signalRunId,
    buildAttemptId,
    snapshotId,
    sourceFingerprint,
    connectionFingerprint,
    email,
    pdf,
    attemptedAt,
    sentAt,
    meta,
  } = {}
) {
  const finalAttemptedAt = attemptedAt ? new Date(attemptedAt) : nowDate();
  const finalSentAt = sentAt ? new Date(sentAt) : nowDate();

  return this.patchByUserAndDateKey(userId, dateKey, {
    status: 'sent',
    rootId,
    signalRunId,
    buildAttemptId,
    snapshotId,
    sourceFingerprint,
    connectionFingerprint,
    email,
    pdf,
    attemptedAt: finalAttemptedAt,
    sentAt: finalSentAt,
    failedAt: null,
    skippedAt: null,
    error: null,
    errorCode: null,
    durationMs: calcDurationMs(finalAttemptedAt, finalSentAt),
    meta,
  });
};

/**
 * Marca corrida fallida.
 */
DailySignalDeliveryRunSchema.statics.markFailed = async function (
  userId,
  dateKey,
  {
    rootId,
    signalRunId,
    buildAttemptId,
    snapshotId,
    sourceFingerprint,
    connectionFingerprint,
    email,
    pdf,
    attemptedAt,
    failedAt,
    error = 'DAILY_SIGNAL_DELIVERY_FAILED',
    errorCode = null,
    meta,
  } = {}
) {
  const finalAttemptedAt = attemptedAt ? new Date(attemptedAt) : nowDate();
  const finalFailedAt = failedAt ? new Date(failedAt) : nowDate();

  return this.patchByUserAndDateKey(userId, dateKey, {
    status: 'failed',
    rootId,
    signalRunId,
    buildAttemptId,
    snapshotId,
    sourceFingerprint,
    connectionFingerprint,
    email,
    pdf,
    attemptedAt: finalAttemptedAt,
    failedAt: finalFailedAt,
    sentAt: null,
    skippedAt: null,
    error,
    errorCode: normSimpleString(errorCode) || normSimpleString(error),
    durationMs: calcDurationMs(finalAttemptedAt, finalFailedAt),
    meta,
  });
};

/**
 * Marca corrida skippeada.
 */
DailySignalDeliveryRunSchema.statics.markSkipped = async function (
  userId,
  dateKey,
  {
    attemptedAt,
    skippedAt,
    reason = 'ALREADY_SENT_OR_NOT_ELIGIBLE',
    errorCode = 'DAILY_SIGNAL_DELIVERY_SKIPPED',
    meta,
  } = {}
) {
  const finalAttemptedAt = attemptedAt ? new Date(attemptedAt) : nowDate();
  const finalSkippedAt = skippedAt ? new Date(skippedAt) : nowDate();

  return this.patchByUserAndDateKey(userId, dateKey, {
    status: 'skipped',
    attemptedAt: finalAttemptedAt,
    skippedAt: finalSkippedAt,
    sentAt: null,
    failedAt: null,
    error: reason,
    errorCode,
    durationMs: calcDurationMs(finalAttemptedAt, finalSkippedAt),
    meta,
  });
};

module.exports =
  mongoose.models.DailySignalDeliveryRun ||
  model('DailySignalDeliveryRun', DailySignalDeliveryRunSchema);