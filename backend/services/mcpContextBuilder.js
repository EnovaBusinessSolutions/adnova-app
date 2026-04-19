// backend/services/mcpContextBuilder.js
'use strict';

const crypto = require('crypto');

const McpData = require('../models/McpData');
const User = require('../models/User');
const SignalData = require('../models/SignalData');

const {
  formatMetaForLlm,
  formatMetaForLlmMini,
} = require('../jobs/transform/metaLlmFormatter');

const {
  formatGoogleAdsForLlm,
  formatGoogleAdsForLlmMini,
} = require('../jobs/transform/googleAdsLlmFormatter');

const {
  formatGa4ForLlm,
  formatGa4ForLlmMini,
} = require('../jobs/transform/ga4LlmFormatter');

const {
  generateSignalPdfForUser,
} = require('./signalPdfBuilder');

const {
  encodeSignalPayload,
  isEncodedSignalPayloadBuildableForPdf,
} = require('./signalEncoder');
const {
  logMcpContext,
  summarizeSourcesStatus,
  toErrorMeta,
} = require('../utils/mcpContextLog');

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {
  OpenAI = null;
}

let prisma = null;
try {
  prisma = require('../utils/prismaClient');
} catch (_) {
  // Prisma no disponible — campos Tier 3/4 quedarán null
}

const DEFAULT_CONTEXT_RANGE_DAYS = clampInt(process.env.MCP_CONTEXT_RANGE_DAYS || 30, 7, 365);
const BUILD_WAIT_TIMEOUT_MS = clampInt(process.env.MCP_CONTEXT_BUILD_WAIT_TIMEOUT_MS || 120000, 5000, 300000);
const BUILD_WAIT_POLL_MS = clampInt(process.env.MCP_CONTEXT_BUILD_WAIT_POLL_MS || 1500, 300, 5000);
const BUILD_ACTIVE_GUARD_MS = clampInt(process.env.MCP_CONTEXT_BUILD_ACTIVE_GUARD_MS || 180000, 15000, 900000);
const PDF_ACTIVE_GUARD_MS = clampInt(process.env.MCP_CONTEXT_PDF_ACTIVE_GUARD_MS || 180000, 15000, 900000);

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toNum(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function nowIso() {
  return new Date().toISOString();
}

function compactArray(arr, max = 10) {
  return Array.isArray(arr) ? arr.slice(0, Math.max(0, max)) : [];
}

function uniqStrings(arr, max = 20) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRootDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;

  if (doc.isRoot === true) return true;
  if (doc.kind === 'root') return true;
  if (doc.type === 'root') return true;
  if (doc.docType === 'root') return true;
  if (doc.latestSnapshotId && !doc.dataset) return true;

  return false;
}

function isChunkDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (isRootDoc(doc)) return false;
  return !!doc.dataset;
}

function resolveRequestedContextRangeDays(root, requested) {
  const explicit = clampInt(requested, 0, 365);
  if (explicit > 0) return explicit;

  const fromRoot =
    toNum(root?.coverage?.contextDefaultRangeDays) ||
    toNum(root?.coverage?.defaultRangeDays) ||
    toNum(root?.sources?.metaAds?.contextDefaultRangeDays) ||
    toNum(root?.sources?.googleAds?.contextDefaultRangeDays) ||
    toNum(root?.sources?.ga4?.contextDefaultRangeDays);

  if (fromRoot > 0) return clampInt(fromRoot, 7, 365);
  return DEFAULT_CONTEXT_RANGE_DAYS;
}

function getStorageRangeDaysFromRoot(root) {
  const n =
    toNum(root?.coverage?.storageRangeDays) ||
    toNum(root?.sources?.metaAds?.storageRangeDays) ||
    toNum(root?.sources?.googleAds?.storageRangeDays) ||
    toNum(root?.sources?.ga4?.storageRangeDays) ||
    toNum(root?.sources?.metaAds?.rangeDays) ||
    toNum(root?.sources?.googleAds?.rangeDays) ||
    toNum(root?.sources?.ga4?.rangeDays);

  return n > 0 ? n : null;
}

function emptyPdfState(extra = {}) {
  return {
    generationId: null,
    signalGenerationId: null,
    status: 'idle',
    stage: 'idle',
    progress: 0,
    fileName: null,
    mimeType: 'application/pdf',
    storageKey: null,
    localPath: null,
    downloadUrl: null,
    generatedAt: null,
    invalidatedAt: null,
    sizeBytes: 0,
    pageCount: null,
    renderer: null,
    version: 1,
    error: null,
    sourceFingerprint: null,
    connectionFingerprint: null,
    processingStartedAt: null,
    processingHeartbeatAt: null,
    stale: false,
    staleReason: null,
    ...extra,
  };
}

function emptySignalState(extra = {}) {
  return {
    generationId: null,
    status: 'idle',
    stage: 'idle',
    progress: 0,
    sourceFingerprint: null,
    sourcesSnapshot: null,
    startedAt: null,
    finishedAt: null,
    generatedAt: null,
    invalidatedAt: null,
    staleReason: null,
    version: 1,
    error: null,
    model: null,
    usedOpenAI: false,
    contextRangeDays: null,
    storageRangeDays: null,
    snapshotId: null,
    unifiedBase: null,
    encodedPayload: null,
    payload: null,
    schemaName: null,
    schemaVersion: null,
    payloadSections: [],
    payloadStats: null,
    payloadHealth: null,
    ...extra,
  };
}

function mergeSignalState(currentAi = {}, patch = {}) {
  return emptySignalState({
    ...(currentAi?.signal || {}),
    ...patch,
  });
}

function mergePdfState(currentAi = {}, patch = {}) {
  return emptyPdfState({
    ...(currentAi?.pdf || {}),
    ...patch,
  });
}

function normalizeSignalArtifactForPersistence(signal = {}, fallbackAi = {}) {
  const nextSignal = emptySignalState(signal || {});
  const nextGeneratedAt = nextSignal.generatedAt || nextSignal.finishedAt || null;
  const nextFinishedAt =
    nextSignal.finishedAt ||
    nextSignal.generatedAt ||
    fallbackAi?.finishedAt ||
    null;

  return {
    ...nextSignal,
    generatedAt: nextGeneratedAt,
    finishedAt: nextSignal.status === 'ready' ? nextFinishedAt : (nextSignal.finishedAt || null),
  };
}

function normalizePdfArtifactForPersistence(pdf = {}) {
  const nextPdf = emptyPdfState(pdf || {});
  const nextGeneratedAt = nextPdf.generatedAt || nextPdf.finishedAt || null;
  const nextFinishedAt = nextPdf.finishedAt || nextPdf.generatedAt || null;
  const nextProcessingStartedAt =
    nextPdf.processingStartedAt ||
    nextPdf.startedAt ||
    null;
  const nextProcessingHeartbeatAt =
    nextPdf.processingHeartbeatAt ||
    nextProcessingStartedAt ||
    null;

  return {
    ...nextPdf,
    generatedAt: nextGeneratedAt,
    finishedAt: nextFinishedAt,
    processingStartedAt: nextProcessingStartedAt,
    processingHeartbeatAt: nextProcessingHeartbeatAt,
  };
}

function deriveLegacyCompatFromFormalArtifacts(ai = {}) {
  const signal = normalizeSignalArtifactForPersistence(ai?.signal || {}, ai);
  const pdf = normalizePdfArtifactForPersistence(ai?.pdf || {});
  const signalStage = safeStr(signal?.stage).trim();
  const aiStage = safeStr(ai?.stage).trim();
  const signalPayload = signal?.payload || null;
  const encodedPayload = signal?.encodedPayload || null;
  const payloadBuildable = isSignalPayloadBuildableForPdf(signalPayload);
  const encodedPayloadBuildable = isEncodedSignalPayloadBuildableForPdf(encodedPayload);
  const hasAnySignalPayload = !!(signalPayload || encodedPayload);
  const signalComplete = signal.status === 'ready' && hasAnySignalPayload;
  const signalValidForPdf =
    signal.status === 'ready' &&
    (payloadBuildable || encodedPayloadBuildable);
  const signalReadyForPdf = signalComplete && signalValidForPdf;

  let status = 'idle';
  if (signal.status === 'processing' || signal.status === 'queued') {
    status = 'processing';
  } else if (signal.status === 'ready') {
    status = 'done';
  } else if (signal.status === 'failed' || signal.status === 'error') {
    status = 'error';
  }

  return {
    signal,
    pdf,
    status,
    stage:
      (signalStage && signalStage !== 'idle'
        ? signalStage
        : (aiStage || signalStage)) || 'idle',
    progress: toNum(signal?.progress, ai?.progress || 0),
    startedAt: signal?.startedAt || ai?.startedAt || null,
    finishedAt:
      signal.status === 'ready' || signal.status === 'failed'
        ? (signal?.finishedAt || signal?.generatedAt || ai?.finishedAt || null)
        : null,
    snapshotId: signal?.snapshotId || ai?.snapshotId || null,
    contextRangeDays:
      toNum(signal?.contextRangeDays) ||
      toNum(ai?.contextRangeDays) ||
      null,
    storageRangeDays:
      toNum(signal?.storageRangeDays) ||
      toNum(ai?.storageRangeDays) ||
      null,
    unifiedBase:
      signal?.unifiedBase !== undefined
        ? signal.unifiedBase
        : (ai?.unifiedBase || null),
    encodedPayload:
      signal?.encodedPayload !== undefined
        ? signal.encodedPayload
        : (ai?.encodedPayload || null),
    signalPayload:
      signal?.payload !== undefined
        ? signal.payload
        : (ai?.signalPayload || null),
    usedOpenAI:
      signal?.usedOpenAI != null
        ? !!signal.usedOpenAI
        : !!ai?.usedOpenAI,
    model: signal?.model || ai?.model || null,
    sourceFingerprint: signal?.sourceFingerprint || ai?.sourceFingerprint || null,
    signalComplete,
    signalValidForPdf,
    signalReadyForPdf,
  };
}

function harmonizeAiContextForPersistence(nextAi = {}) {
  const compat = deriveLegacyCompatFromFormalArtifacts(nextAi);
  const sourcesStatus = nextAi?.sourcesStatus || null;
  const usableSources = uniqStringsSafe([
    ...(Array.isArray(nextAi?.usableSources) ? nextAi.usableSources : []),
    ...deriveSourceNamesByFlagFromState(sourcesStatus, 'usable'),
  ]);
  const pendingConnectedSources = uniqStringsSafe([
    ...(Array.isArray(nextAi?.pendingConnectedSources) ? nextAi.pendingConnectedSources : []),
    ...deriveSourceNamesByFlagFromState(sourcesStatus, 'pending'),
    ...Object.entries(sourcesStatus || {})
      .filter(([, sourceState]) => {
        if (!sourceState?.connected) return false;
        return !!sourceState?.blocksBuild;
      })
      .map(([name]) => name),
  ]);
  const degradedConnectedSources = uniqStringsSafe([
    ...(Array.isArray(nextAi?.degradedConnectedSources) ? nextAi.degradedConnectedSources : []),
    ...Object.entries(sourcesStatus || {})
      .filter(([, sourceState]) => !!sourceState?.degradedButBuildable)
      .map(([name]) => name),
  ]);
  const failedSources = uniqStringsSafe([
    ...(Array.isArray(nextAi?.failedSources) ? nextAi.failedSources : []),
    ...deriveSourceNamesWithErrorFromState(sourcesStatus),
  ]);

  return {
    ...nextAi,
    status: compat.status,
    stage: compat.stage,
    progress: compat.progress,
    startedAt: compat.startedAt,
    finishedAt: compat.finishedAt,
    snapshotId: compat.snapshotId,
    contextRangeDays: compat.contextRangeDays,
    storageRangeDays: compat.storageRangeDays,
    unifiedBase: compat.unifiedBase,
    encodedPayload: compat.encodedPayload,
    signalPayload: compat.signalPayload,
    usedOpenAI: compat.usedOpenAI,
    model: compat.model,
    sourceFingerprint: compat.sourceFingerprint,
    signalComplete: compat.signalComplete,
    signalValidForPdf: compat.signalValidForPdf,
    signalReadyForPdf: compat.signalReadyForPdf,
    usableSources,
    pendingConnectedSources,
    degradedConnectedSources,
    failedSources,
    signal: compat.signal,
    pdf: compat.pdf,
  };
}

function deriveFailedSources(sourcesStatus = null) {
  return uniqStrings(
    Object.entries(sourcesStatus || {})
      .filter(([, state]) => !!state?.lastError)
      .map(([sourceName]) => sourceName),
    25
  );
}

function buildAiSourceCollections({
  sourcesStatus = null,
  usableSources = [],
  pendingConnectedSources = [],
  degradedConnectedSources = [],
} = {}) {
  return {
    sourcesStatus: sourcesStatus || null,
    usableSources: uniqStrings(usableSources || [], 25),
    pendingConnectedSources: uniqStrings(pendingConnectedSources || [], 25),
    degradedConnectedSources: uniqStrings(degradedConnectedSources || [], 25),
    failedSources: deriveFailedSources(sourcesStatus),
  };
}

function makePdfGenerationId(buildAttemptId) {
  const clean = safeStr(buildAttemptId).trim();
  return clean ? `${clean}:pdf` : makeBuildAttemptId();
}

function makeBuildAttemptId() {
  return `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function parseDateMs(v) {
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

function stableSerialize(value) {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function normalizeSourceConnectionIdentity(root, source) {
  const s = getSourceRootState(root, source);

  if (source === 'metaAds') {
    return {
      connected: !!s?.connected,
      accountId: safeStr(s?.accountId || '').trim() || null,
    };
  }

  if (source === 'googleAds') {
    return {
      connected: !!s?.connected,
      customerId: safeStr(s?.customerId || s?.accountId || '').trim() || null,
    };
  }

  if (source === 'ga4') {
    return {
      connected: !!s?.connected,
      propertyId: safeStr(s?.propertyId || '').trim() || null,
    };
  }

  return {
    connected: !!s?.connected,
  };
}

function buildConnectionStateSummary(root) {
  return {
    metaAds: normalizeSourceConnectionIdentity(root, 'metaAds'),
    googleAds: normalizeSourceConnectionIdentity(root, 'googleAds'),
    ga4: normalizeSourceConnectionIdentity(root, 'ga4'),
  };
}

function buildConnectionFingerprint(root) {
  return stableHash({
    version: 1,
    sources: buildConnectionStateSummary(root),
  });
}

function normalizeEffectiveSourceState({
  root,
  source,
  sourceState = null,
  sourceSnapshotId = null,
  unifiedBase = null,
} = {}) {
  const rootState = getSourceRootState(root || {}, source) || {};
  const baseState = unifiedBase?.sources?.[source] || {};
  const state = sourceState || null;

  const connected = !!(
    baseState?.connected ??
    state?.connected ??
    rootState?.connected ??
    false
  );

  const ready = !!(
    baseState?.ready ??
    state?.ready ??
    rootState?.ready ??
    false
  );

  const usable = !!(
    baseState?.usable ??
    state?.usable ??
    false
  );

  const snapshotId =
    safeStr(
      sourceSnapshotId ||
      baseState?.snapshotId ||
      state?.snapshotId ||
      ''
    ).trim() || null;

  const chunkCount =
    toNum(baseState?.chunkCount, NaN) ||
    toNum(state?.chunkCount, 0) ||
    0;

  const out = {
    connected,
    ready,
    usable,
    snapshotId,
    chunkCount,
  };

  if (source === 'metaAds') {
    out.accountId =
      safeStr(
        baseState?.accountId ||
        rootState?.accountId ||
        ''
      ).trim() || null;
  } else if (source === 'googleAds') {
    out.customerId =
      safeStr(
        baseState?.customerId ||
        baseState?.accountId ||
        rootState?.customerId ||
        rootState?.accountId ||
        ''
      ).trim() || null;
  } else if (source === 'ga4') {
    out.propertyId =
      safeStr(
        baseState?.propertyId ||
        rootState?.propertyId ||
        ''
      ).trim() || null;
  }

  return out;
}

function buildEffectiveSourcesSnapshot({
  root,
  sourceStates,
  sourceSnapshots,
  contextRangeDays,
  storageRangeDays,
  unifiedBase,
} = {}) {
  const sourceNames = ['metaAds', 'googleAds', 'ga4'];

  const snapshot = {
    version: 2,
    contextRangeDays: toNum(contextRangeDays, 0) || null,
    storageRangeDays: toNum(storageRangeDays, 0) || null,
    sources: {},
  };

  for (const source of sourceNames) {
    snapshot.sources[source] = normalizeEffectiveSourceState({
      root,
      source,
      sourceState: sourceStates?.[source] || null,
      sourceSnapshotId: sourceSnapshots?.[source] || null,
      unifiedBase,
    });
  }

  return snapshot;
}

function buildEffectiveSourceFingerprint(args = {}) {
  return stableHash(buildEffectiveSourcesSnapshot(args));
}

function buildEffectiveSourceContext(args = {}) {
  const snapshot = buildEffectiveSourcesSnapshot(args);
  return {
    snapshot,
    fingerprint: stableHash(snapshot),
  };
}

function buildArtifactFingerprintPayload({
  root,
  sourceStates,
  sourceSnapshots,
  contextRangeDays,
  storageRangeDays,
  unifiedBase,
} = {}) {
  const sourceNames = ['metaAds', 'googleAds', 'ga4'];
  const out = {
    version: 1,
    contextRangeDays: toNum(contextRangeDays, 0) || null,
    storageRangeDays: toNum(storageRangeDays, 0) || null,
    sources: {},
    sourceSnapshots: sourceSnapshots || null,
  };

  for (const source of sourceNames) {
    const state = sourceStates?.[source];
    const fromBase = unifiedBase?.sources?.[source];
    const identity = normalizeSourceConnectionIdentity(root || {}, source);

    out.sources[source] = {
      connected: !!(fromBase?.connected ?? state?.connected ?? identity?.connected),
      ready: !!(fromBase?.ready ?? state?.ready ?? identity?.ready),
      usable: !!(fromBase?.usable ?? state?.usable ?? false),
      snapshotId:
        safeStr(fromBase?.snapshotId || state?.snapshotId || sourceSnapshots?.[source] || '').trim() || null,
      chunkCount:
        toNum(fromBase?.chunkCount, NaN) ||
        toNum(state?.chunkCount, 0) ||
        0,
      identity,
    };
  }

  return out;
}

function buildArtifactFingerprint(args = {}) {
  return stableHash(buildArtifactFingerprintPayload(args));
}

function deriveSignalFingerprintFromAi(ai = {}) {
  const explicit = safeStr(ai?.sourceFingerprint).trim();
  if (explicit) return explicit;

  const currentExplicit = safeStr(ai?.currentSourceFingerprint).trim();
  if (currentExplicit) return currentExplicit;

  if (ai?.currentSourcesSnapshot && typeof ai.currentSourcesSnapshot === 'object') {
    try {
      return stableHash(ai.currentSourcesSnapshot);
    } catch (_) {
      return '';
    }
  }

  if (ai?.unifiedBase && typeof ai.unifiedBase === 'object') {
    try {
      return buildEffectiveSourceFingerprint({
        root: { sources: ai?.unifiedBase?.sources || {} },
        sourceStates: null,
        sourceSnapshots: ai?.sourceSnapshots || ai?.unifiedBase?.sourceSnapshots || null,
        contextRangeDays: ai?.contextRangeDays || ai?.unifiedBase?.contextWindow?.rangeDays || null,
        storageRangeDays: ai?.storageRangeDays || ai?.unifiedBase?.contextWindow?.storageRangeDays || null,
        unifiedBase: ai?.unifiedBase,
      });
    } catch (_) {
      return '';
    }
  }

  return '';
}

function deriveConnectionFingerprintFromAi(ai = {}) {
  return safeStr(ai?.connectionFingerprint).trim() || '';
}

function derivePdfFingerprint(pdf = {}) {
  return safeStr(pdf?.sourceFingerprint).trim() || '';
}

function pdfMatchesSignal(pdf = {}, ai = {}) {
  const pdfFingerprint = derivePdfFingerprint(pdf);
  const signalFingerprint = deriveSignalFingerprintFromAi(ai);

  if (!signalFingerprint) return false;
  if (!pdfFingerprint) return false;

  return pdfFingerprint === signalFingerprint;
}

function isRecentProcessingState(ai) {
  if (!ai || ai.status !== 'processing' || !ai.buildAttemptId) return false;
  const startedMs = parseDateMs(ai.startedAt);
  if (!startedMs) return false;
  return (Date.now() - startedMs) <= BUILD_ACTIVE_GUARD_MS;
}

function isRecentPdfProcessingState(pdf) {
  if (!pdf || safeStr(pdf?.status) !== 'processing') return false;

  const startedMs =
    parseDateMs(pdf?.processingHeartbeatAt) ||
    parseDateMs(pdf?.processingStartedAt) ||
    parseDateMs(pdf?.generatedAt);

  if (!startedMs) return false;
  return (Date.now() - startedMs) <= PDF_ACTIVE_GUARD_MS;
}

function pdfFileExists(pdf) {
  const localPath = safeStr(pdf?.localPath).trim();
  if (!localPath) return false;
  try {
    return require('fs').existsSync(localPath);
  } catch (_) {
    return false;
  }
}

function getAllowedDatasetsForSource(source) {
  if (source === 'metaAds') {
    return new Set([
      'meta.insights_summary',
      'meta.campaigns_ranked',
      'meta.breakdowns_top',
      'meta.optimization_signals',
      'meta.daily_trends_ai',
    ]);
  }

  if (source === 'googleAds') {
    return new Set([
      'google.insights_summary',
      'google.campaigns_ranked',
      'google.breakdowns_top',
      'google.optimization_signals',
      'google.daily_trends_ai',
    ]);
  }

  if (source === 'ga4') {
    return new Set([
      'ga4.insights_summary',
      'ga4.channels_top',
      'ga4.devices_top',
      'ga4.landing_pages_top',
      'ga4.source_medium_top',
      'ga4.events_top',
      'ga4.optimization_signals',
      'ga4.daily_trends_ai',
    ]);
  }

  return null;
}

function getRequiredDatasetsForSource(source) {
  if (source === 'metaAds') {
    return {
      allOf: ['meta.insights_summary', 'meta.campaigns_ranked'],
      anyOf: ['meta.optimization_signals', 'meta.breakdowns_top', 'meta.daily_trends_ai'],
    };
  }

  if (source === 'googleAds') {
    return {
      allOf: ['google.insights_summary', 'google.campaigns_ranked'],
      anyOf: ['google.optimization_signals', 'google.breakdowns_top', 'google.daily_trends_ai'],
    };
  }

  if (source === 'ga4') {
    return {
      allOf: ['ga4.insights_summary'],
      anyOf: ['ga4.channels_top', 'ga4.landing_pages_top', 'ga4.source_medium_top', 'ga4.events_top'],
    };
  }

  return {
    allOf: [],
    anyOf: [],
  };
}

function getSourceDatasetPrefix(source) {
  if (source === 'metaAds') return 'meta.';
  if (source === 'googleAds') return 'google.';
  if (source === 'ga4') return 'ga4.';
  return '';
}

function getSourceRootState(root, source) {
  return root?.sources?.[source] || {};
}

function sourceLooksConnected(root, source) {
  const s = getSourceRootState(root, source);
  return !!s?.connected;
}

function sourceLooksReady(root, source) {
  const s = getSourceRootState(root, source);
  return !!s?.ready || String(s?.status || '').toLowerCase() === 'ready';
}

function getDatasetsPresent(chunks) {
  return new Set(
    (Array.isArray(chunks) ? chunks : [])
      .map((doc) => safeStr(doc?.dataset).trim())
      .filter(Boolean)
  );
}

function evaluateSourceUsability(source, chunks) {
  const datasetNames = getDatasetsPresent(chunks);
  const rules = getRequiredDatasetsForSource(source);
  const allOf = Array.isArray(rules?.allOf) ? rules.allOf : [];
  const anyOf = Array.isArray(rules?.anyOf) ? rules.anyOf : [];

  const missingRequired = allOf.filter((name) => !datasetNames.has(name));
  const hasAnyOptional = anyOf.length === 0 ? true : anyOf.some((name) => datasetNames.has(name));

  const hasChunks = Array.isArray(chunks) && chunks.length > 0;
  const usable = hasChunks && missingRequired.length === 0 && hasAnyOptional;

  return {
    usable,
    hasChunks,
    datasetNames: Array.from(datasetNames),
    missingRequired,
    hasAnyOptional,
  };
}

function isSignalPayloadBuildableForPdf(signalPayload) {
  if (!signalPayload || typeof signalPayload !== 'object') return false;

  const summary = signalPayload?.summary || {};
  const block =
    safeStr(signalPayload?.llm_context_block).trim() ||
    safeStr(signalPayload?.llm_context_block_mini).trim();

  const executive = safeStr(summary?.executive_summary).trim();
  const business = safeStr(summary?.business_state).trim();

  if (!block || block.length < 80) return false;
  if (!executive && !business) return false;

  return true;
}

function deriveSignalReadinessFromAi(ai = {}, fallbackSignalPayload = null) {
  const signalStatus = safeStr(ai?.signal?.status).trim().toLowerCase();
  const legacyStatus = safeStr(ai?.status).trim().toLowerCase();
  const legacyStage = safeStr(ai?.stage).trim().toLowerCase();
  const signalPayload =
    ai?.signal?.payload ||
    ai?.signalPayload ||
    fallbackSignalPayload ||
    null;
  const encodedPayload =
    ai?.signal?.encodedPayload ||
    ai?.encodedPayload ||
    null;
  const payloadBuildable = isSignalPayloadBuildableForPdf(signalPayload);
  const encodedPayloadBuildable = isEncodedSignalPayloadBuildableForPdf(encodedPayload);
  const hasBuildablePayload = encodedPayloadBuildable || payloadBuildable;
  const hasAnySignalPayload = !!(encodedPayload || signalPayload);

  const formalSignalComplete =
    signalStatus === 'ready' &&
    hasAnySignalPayload;

  const legacySignalComplete =
    legacyStatus === 'done' &&
    legacyStage === 'completed' &&
    hasAnySignalPayload;

  const signalComplete = formalSignalComplete || legacySignalComplete;

  const signalValidForPdf =
    typeof ai?.signalValidForPdf === 'boolean'
      ? ai.signalValidForPdf
      : (
        (formalSignalComplete || legacySignalComplete) &&
        hasBuildablePayload
      );

  const signalReadyForPdf =
    formalSignalComplete &&
    signalValidForPdf &&
    hasBuildablePayload;

  return {
    signalPayload,
    encodedPayload,
    payloadBuildable,
    encodedPayloadBuildable,
    signalComplete,
    signalValidForPdf,
    signalReadyForPdf,
  };
}

function derivePdfBuildState({
  signalProcessing,
  needSignalRebuild,
  signalReadyForPdf,
  pdfReady,
  pdfProcessing,
  pdfFailed,
  needPdfRebuild,
}) {
  if (signalProcessing) return 'signal_building';
  if (needSignalRebuild) return 'signal_rebuild_required';
  if (!signalReadyForPdf) return 'signal_not_ready';
  if (pdfReady) return 'pdf_ready';
  if (pdfProcessing) return 'pdf_processing';
  if (pdfFailed) return 'pdf_failed';
  if (needPdfRebuild) return 'pdf_rebuild_required';
  return 'pdf_buildable';
}

function buildSignalSourcesPayload({
  sourcesStatus = null,
  sourceSnapshots = null,
  usableSources = [],
  pendingConnectedSources = [],
  degradedConnectedSources = [],
} = {}) {
  const connectedSources = [];
  const failedSources = [];

  const bySource = sourcesStatus || {};
  for (const [sourceName, state] of Object.entries(bySource)) {
    if (state?.connected) connectedSources.push(sourceName);
    if (state?.lastError) failedSources.push(sourceName);
  }

  const connectedFinal = uniqStrings([
    ...connectedSources,
    ...usableSources,
    ...pendingConnectedSources,
    ...degradedConnectedSources,
  ], 25);

  return {
    connectedSources: connectedFinal,
    usableSources: uniqStrings(usableSources || [], 25),
    pendingConnectedSources: uniqStrings(pendingConnectedSources || [], 25),
    degradedConnectedSources: uniqStrings(degradedConnectedSources || [], 25),
    failedSources: uniqStrings(failedSources || [], 25),
    sourceSnapshots: sourceSnapshots || null,
    sourcesStatus: sourcesStatus || null,
  };
}

async function safeSignalRunUpsert(payload = {}) {
  try {
    return await SignalData.upsertRun(payload);
  } catch (err) {
    console.error('[mcpContextBuilder] SignalData.upsertRun failed:', err?.message || err);
    return null;
  }
}

async function safeSignalRunMarkStage(userId, buildAttemptId, patch = {}) {
  try {
    return await SignalData.markStage(userId, buildAttemptId, patch);
  } catch (err) {
    console.error('[mcpContextBuilder] SignalData.markStage failed:', err?.message || err);
    return null;
  }
}

async function safeSignalRunComplete(userId, buildAttemptId, patch = {}) {
  try {
    return await SignalData.completeRun(userId, buildAttemptId, patch);
  } catch (err) {
    console.error('[mcpContextBuilder] SignalData.completeRun failed:', err?.message || err);
    return null;
  }
}

async function safeSignalRunFail(userId, buildAttemptId, patch = {}) {
  try {
    return await SignalData.failRun(userId, buildAttemptId, patch);
  } catch (err) {
    console.error('[mcpContextBuilder] SignalData.failRun failed:', err?.message || err);
    return null;
  }
}

async function safeSignalPdfState(userId, buildAttemptId, pdfPatch = {}) {
  try {
    return await SignalData.markPdfState(userId, buildAttemptId, pdfPatch);
  } catch (err) {
    console.error('[mcpContextBuilder] SignalData.markPdfState failed:', err?.message || err);
    return null;
  }
}

async function safeSupersedeOtherProcessingRuns(userId, currentAttemptId, extra = {}) {
  const cleanAttemptId = safeStr(currentAttemptId).trim();
  if (!userId || !cleanAttemptId) return null;

  try {
    return await SignalData.updateMany(
      {
        userId,
        buildAttemptId: { $ne: cleanAttemptId },
        status: 'processing',
      },
      {
        $set: {
          status: 'error',
          stage: 'failed',
          failedAt: new Date(),
          lastHeartbeatAt: new Date(),
          error: 'ATTEMPT_SUPERSEDED',
          errorCode: 'ATTEMPT_SUPERSEDED',
          errorStage: 'failed',
          signalComplete: false,
          signalValidForPdf: false,
          hasSignal: false,
          isCurrent: false,
          supersededAt: new Date(),
          supersededByAttemptId: cleanAttemptId,
          ...extra,
        },
      }
    );
  } catch (err) {
    console.error('[mcpContextBuilder] SignalData.updateMany supersede failed:', err?.message || err);
    return null;
  }
}

async function resolveSignalBuildAttemptId(userId, ai = {}) {
  const attemptId = safeStr(ai?.buildAttemptId).trim();
  if (attemptId) return attemptId;

  try {
    const current = await SignalData.findCurrentRunForUser(userId);
    if (current?.buildAttemptId) {
      return safeStr(current.buildAttemptId).trim() || null;
    }

    const latest = await SignalData.findLatestForUser(userId);
    return safeStr(latest?.buildAttemptId || latest?.signalRunId).trim() || null;
  } catch (_) {
    return null;
  }
}

async function findLatestSnapshotId(userId, source = 'metaAds') {
  const datasetPrefix =
    source === 'googleAds' ? '^google\\.' :
    source === 'ga4' ? '^ga4\\.' :
    '^meta\\.';

  const latestChunk = await McpData.findOne({
    userId,
    kind: 'chunk',
    source,
    dataset: { $regex: datasetPrefix },
  })
    .select({ snapshotId: 1, updatedAt: 1, createdAt: 1 })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return latestChunk?.snapshotId || null;
}

async function findSourceChunkMeta(userId, source, snapshotId, datasetPrefix) {
  const query = {
    userId,
    kind: 'chunk',
    source,
    dataset: { $regex: `^${datasetPrefix.replace('.', '\\.')}` },
  };

  if (snapshotId) query.snapshotId = snapshotId;

  const docs = await McpData.find(query)
    .select({
      _id: 1,
      snapshotId: 1,
      source: 1,
      dataset: 1,
      range: 1,
      stats: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .sort({ createdAt: 1, updatedAt: 1 })
    .lean();

  const allowed = getAllowedDatasetsForSource(source);
  return docs
    .filter(isChunkDoc)
    .filter((doc) => !allowed || allowed.has(String(doc?.dataset || '')));
}

async function findSourceChunksFull(userId, source, snapshotId, datasetPrefix) {
  const query = {
    userId,
    kind: 'chunk',
    source,
    dataset: { $regex: `^${datasetPrefix.replace('.', '\\.')}` },
  };

  if (snapshotId) query.snapshotId = snapshotId;

  const docs = await McpData.find(query)
    .sort({ createdAt: 1, updatedAt: 1 })
    .lean();

  const allowed = getAllowedDatasetsForSource(source);
  return docs
    .filter(isChunkDoc)
    .filter((doc) => !allowed || allowed.has(String(doc?.dataset || '')));
}

async function listRecentSnapshotIdsForSource(userId, source, datasetPrefix, limit = 8) {
  const docs = await McpData.find({
    userId,
    kind: 'chunk',
    source,
    dataset: { $regex: `^${datasetPrefix.replace('.', '\\.')}` },
  })
    .select({ snapshotId: 1, updatedAt: 1, createdAt: 1 })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const out = [];
  const seen = new Set();

  for (const doc of docs) {
    const snapshotId = safeStr(doc?.snapshotId).trim();
    if (!snapshotId || seen.has(snapshotId)) continue;
    seen.add(snapshotId);
    out.push(snapshotId);
    if (out.length >= limit) break;
  }

  return out;
}

async function findBestSnapshotStateForSource(userId, source, preferredSnapshotId) {
  const preferred = safeStr(preferredSnapshotId).trim();
  const prefix = getSourceDatasetPrefix(source);
  const recentSnapshotIds = await listRecentSnapshotIdsForSource(userId, source, prefix);
  const candidateSnapshotIds = uniqStrings([
    preferred,
    ...recentSnapshotIds,
  ], 12);

  let fallback = null;

  for (const snapshotId of candidateSnapshotIds) {
    const chunkMeta = await findSourceChunkMeta(userId, source, snapshotId, prefix);
    if (!chunkMeta.length) continue;

    const usability = evaluateSourceUsability(source, chunkMeta);
    if (!fallback) {
      fallback = {
        snapshotId,
        chunkMeta,
        usability,
        selectionReason: snapshotId === preferred ? 'preferred_with_chunks' : 'latest_with_chunks',
      };
    }

    if (usability.usable) {
      return {
        snapshotId,
        chunkMeta,
        usability,
        selectionReason: snapshotId === preferred ? 'preferred_usable' : 'latest_usable',
      };
    }
  }

  if (fallback) return fallback;

  const latestSnapshotId = await findLatestSnapshotId(userId, source);
  if (!latestSnapshotId) {
    return {
      snapshotId: null,
      chunkMeta: [],
      usability: evaluateSourceUsability(source, []),
      selectionReason: 'none',
    };
  }

  const chunkMeta = await findSourceChunkMeta(userId, source, latestSnapshotId, prefix);
  return {
    snapshotId: latestSnapshotId,
    chunkMeta,
    usability: evaluateSourceUsability(source, chunkMeta),
    selectionReason: 'latest_fallback',
  };
}

async function loadBestSourceState(userId, root, source, preferredSnapshotId, options = {}) {
  const { loadFullChunks = false } = options || {};

  const prefix = getSourceDatasetPrefix(source);
  const rootState = getSourceRootState(root, source);
  const connected = sourceLooksConnected(root, source);
  const rootReady = sourceLooksReady(root, source);

  const bestSnapshot = await findBestSnapshotStateForSource(userId, source, preferredSnapshotId);
  const snapshotId = bestSnapshot?.snapshotId || null;
  const chunkMeta = Array.isArray(bestSnapshot?.chunkMeta) ? bestSnapshot.chunkMeta : [];
  const hasChunks = chunkMeta.length > 0;
  const usability = bestSnapshot?.usability || evaluateSourceUsability(source, chunkMeta);
  const usable = !!usability.usable;
  const ready = rootReady || usable;

  const fullChunks =
    loadFullChunks && snapshotId && usable
      ? await findSourceChunksFull(userId, source, snapshotId, prefix)
      : [];

  return {
    source,
    preferredSnapshotId: preferredSnapshotId || null,
    snapshotId: snapshotId || null,
    chunks: fullChunks,
    chunkMeta,
    chunkCount: chunkMeta.length,
    hasChunks,
    connected: connected || hasChunks,
    rootReady,
    ready,
    usable,
    rootState,
    snapshotSelectionReason: bestSnapshot?.selectionReason || null,
    datasetNames: usability.datasetNames,
    missingRequired: usability.missingRequired,
    hasAnyOptional: usability.hasAnyOptional,
    hasUsablePartialData: !!usability.hasChunks,
  };
}

function classifySourceBuildState(state, { hasAnyUsableSources = false } = {}) {
  const connected = !!state?.connected;
  const usable = !!state?.usable;
  const failed = !!state?.rootState?.lastError;
  const hasChunks = !!state?.hasChunks || toNum(state?.chunkCount, 0) > 0;

  if (failed) {
    return {
      readinessCategory: 'failed',
      pending: false,
      failed: true,
      degradedButBuildable: false,
      blocksBuild: false,
      degradeReason: null,
    };
  }

  if (usable) {
    return {
      readinessCategory: 'usable',
      pending: false,
      failed: false,
      degradedButBuildable: false,
      blocksBuild: false,
      degradeReason: null,
    };
  }

  if (connected && hasAnyUsableSources) {
    return {
      readinessCategory: 'degraded_but_buildable',
      pending: false,
      failed: false,
      degradedButBuildable: true,
      blocksBuild: false,
      degradeReason: hasChunks ? 'partial_data_available' : 'other_sources_are_buildable',
    };
  }

  if (connected) {
    return {
      readinessCategory: 'pending',
      pending: true,
      failed: false,
      degradedButBuildable: false,
      blocksBuild: true,
      degradeReason: null,
    };
  }

  return {
    readinessCategory: 'idle',
    pending: false,
    failed: false,
    degradedButBuildable: false,
    blocksBuild: false,
    degradeReason: null,
  };
}

function getCandidateSources(root, sourceStatesByName) {
  const allSources = ['metaAds', 'googleAds', 'ga4'];
  const set = new Set();

  for (const src of allSources) {
    if (sourceLooksConnected(root, src)) set.add(src);
    if (sourceStatesByName?.[src]?.hasChunks) set.add(src);
  }

  return Array.from(set);
}

function sourceStateSummaryForStatus(state, options = {}) {
  const blockingReasons = [];
  const missingRequired = Array.isArray(state?.missingRequired) ? state.missingRequired : [];
  const hasAnyOptional = !!state?.hasAnyOptional;
  const chunkCount = toNum(state?.chunkCount, 0);
  const connected = !!state?.connected;
  const usable = !!state?.usable;
  const classification = classifySourceBuildState(state, options);

  if (classification.pending && chunkCount === 0) {
    blockingReasons.push('waiting_for_first_chunk');
  }
  if (missingRequired.length > 0) {
    blockingReasons.push('missing_required_datasets');
  }
  if ((classification.pending || classification.degradedButBuildable) && !hasAnyOptional) {
    blockingReasons.push('missing_optional_dataset_family');
  }
  if (state?.rootState?.lastError) {
    blockingReasons.push('source_error');
  }
  if (classification.degradedButBuildable) {
    blockingReasons.push('degraded_but_buildable');
  }

  let pendingReason = null;
  if (state?.rootState?.lastError) pendingReason = 'source_error';
  else if (missingRequired.length > 0) pendingReason = 'missing_required_datasets';
  else if ((classification.pending || classification.degradedButBuildable) && !hasAnyOptional) pendingReason = 'missing_optional_dataset_family';
  else if (classification.pending && chunkCount === 0) pendingReason = 'waiting_for_first_chunk';
  else if (classification.degradedButBuildable) pendingReason = classification.degradeReason || 'degraded_but_buildable';

  return {
    connected,
    rootReady: !!state?.rootReady,
    ready: !!state?.ready,
    usable,
    snapshotId: state?.snapshotId || null,
    chunkCount,
    datasets: Array.isArray(state?.datasetNames) ? state.datasetNames : [],
    missingRequired,
    hasAnyOptional,
    lastError: state?.rootState?.lastError || null,
    pendingReason,
    blockingReasons,
    readinessCategory: classification.readinessCategory,
    pending: classification.pending,
    failed: classification.failed,
    degradedButBuildable: classification.degradedButBuildable,
    blocksBuild: classification.blocksBuild,
  };
}

async function waitForBuildableSources(userId, root, explicitSnapshotId, timeoutMs = BUILD_WAIT_TIMEOUT_MS) {
  const started = Date.now();
  const preferredGlobalSnapshotId =
    safeStr(explicitSnapshotId) ||
    safeStr(root?.latestSnapshotId) ||
    '';

  while (Date.now() - started <= timeoutMs) {
    const lastRoot = await findRoot(userId);
    const sourceNames = ['metaAds', 'googleAds', 'ga4'];

    const sourceStatesArr = await Promise.all(
      sourceNames.map((src) =>
        loadBestSourceState(userId, lastRoot, src, preferredGlobalSnapshotId, { loadFullChunks: false })
      )
    );

    const bySource = Object.fromEntries(sourceStatesArr.map((x) => [x.source, x]));
    const candidateSources = getCandidateSources(lastRoot, bySource);

    const usableSources = candidateSources.filter((src) => !!bySource[src]?.usable);
    const hasAnyUsableSources = usableSources.length > 0;
    const classifiedBySource = Object.fromEntries(
      candidateSources.map((src) => [
        src,
        classifySourceBuildState(bySource[src], { hasAnyUsableSources }),
      ])
    );
    const pendingConnectedSources = candidateSources.filter((src) => !!classifiedBySource[src]?.pending);
    const degradedConnectedSources = candidateSources.filter((src) => !!classifiedBySource[src]?.degradedButBuildable);

    const shouldWaitForPendingConnectedSources =
  pendingConnectedSources.length > 0;

if (usableSources.length > 0 && !shouldWaitForPendingConnectedSources) {
  return {
    root: lastRoot,
    preferredGlobalSnapshotId: preferredGlobalSnapshotId || null,
    sourceStates: bySource,
    classifiedBySource,
    candidateSources,
    usableSources,
    pendingConnectedSources,
    degradedConnectedSources,
    timedOut: false,
  };
}

    await sleep(BUILD_WAIT_POLL_MS);
  }

  const fallbackRoot = await findRoot(userId);
  const sourceNames = ['metaAds', 'googleAds', 'ga4'];

  const fallbackStatesArr = await Promise.all(
    sourceNames.map((src) =>
      loadBestSourceState(
        userId,
        fallbackRoot,
        src,
        safeStr(explicitSnapshotId) || safeStr(fallbackRoot?.latestSnapshotId) || '',
        { loadFullChunks: false }
      )
    )
  );

  const bySource = Object.fromEntries(fallbackStatesArr.map((x) => [x.source, x]));
  const candidateSources = getCandidateSources(fallbackRoot, bySource);
  const usableSources = candidateSources.filter((src) => !!bySource[src]?.usable);
  const hasAnyUsableSources = usableSources.length > 0;
  const classifiedBySource = Object.fromEntries(
    candidateSources.map((src) => [
      src,
      classifySourceBuildState(bySource[src], { hasAnyUsableSources }),
    ])
  );
  const pendingConnectedSources = candidateSources.filter((src) => !!classifiedBySource[src]?.pending);
  const degradedConnectedSources = candidateSources.filter((src) => !!classifiedBySource[src]?.degradedButBuildable);

  return {
    root: fallbackRoot,
    preferredGlobalSnapshotId: safeStr(explicitSnapshotId) || safeStr(fallbackRoot?.latestSnapshotId) || null,
    sourceStates: bySource,
    classifiedBySource,
    candidateSources,
    usableSources,
    pendingConnectedSources,
    degradedConnectedSources,
    timedOut: true,
  };
}

function buildMetaContext(chunks, contextRangeDays) {
  if (!chunks?.length) return null;

  return {
    dailyDataset: chunks.find((chunk) => chunk?.dataset === 'meta.daily_trends_ai') || null,
    rankedDataset: chunks.find((chunk) => chunk?.dataset === 'meta.campaigns_ranked') || null,
    adSetsDataset: chunks.find((c) => c?.dataset === 'meta.ad_sets') || null,
    adsDataset: chunks.find((c) => c?.dataset === 'meta.ads') || null,
    adsDailyDataset: chunks.find((c) => c?.dataset === 'meta.ads_daily') || null,
    chunks,
    full: formatMetaForLlm({
      datasets: chunks,
      contextRangeDays,
      topCampaigns: 12,
      topBreakdowns: 5,
      topTrendCampaigns: 5,
    }),
    mini: formatMetaForLlmMini({
      datasets: chunks,
      contextRangeDays,
      topCampaigns: 6,
    }),
  };
}

function buildGoogleAdsContext(chunks, contextRangeDays) {
  if (!chunks?.length) return null;

  return {
    dailyDataset: chunks.find((chunk) => chunk?.dataset === 'google.daily_trends_ai') || null,
    rankedDataset: chunks.find((chunk) => chunk?.dataset === 'google.campaigns_ranked') || null,
    adsDailyDataset: chunks.find((c) => c?.dataset === 'google.ads_daily') || null,
    chunks,
    full: formatGoogleAdsForLlm({
      datasets: chunks,
      contextRangeDays,
      topCampaigns: 12,
      topBreakdowns: 5,
      topTrendCampaigns: 5,
    }),
    mini: formatGoogleAdsForLlmMini({
      datasets: chunks,
      contextRangeDays,
      topCampaigns: 6,
    }),
  };
}

function buildGa4Context(chunks, contextRangeDays) {
  if (!chunks?.length) return null;

  return {
    dailyDataset: chunks.find((chunk) => chunk?.dataset === 'ga4.daily_trends_ai') || null,
    landingPagesChunks: chunks.filter((c) => c?.dataset?.startsWith('ga4.history.landing_pages.')) || [],
    full: formatGa4ForLlm({
      datasets: chunks,
      contextRangeDays,
      topChannels: 8,
      topDevices: 6,
      topLandingPages: 8,
      topSourceMedium: 10,
      topEvents: 10,
      topTrendDays: clampInt(contextRangeDays || DEFAULT_CONTEXT_RANGE_DAYS, 7, 120),
    }),
    mini: formatGa4ForLlmMini({
      datasets: chunks,
      contextRangeDays,
      topChannels: 5,
      topDevices: 4,
      topLandingPages: 5,
      topEvents: 6,
    }),
  };
}

function buildUnifiedBaseContext({
  root,
  contextRangeDays,
  storageRangeDays,
  sourceStates,
  metaPack,
  googlePack,
  ga4Pack,
}) {
  const sources = root?.sources || {};

  const metaState = sourceStates?.metaAds || null;
  const googleState = sourceStates?.googleAds || null;
  const ga4State = sourceStates?.ga4 || null;

  const metaRootState = metaState?.rootState || sources?.metaAds || {};
  const googleRootState = googleState?.rootState || sources?.googleAds || {};
  const ga4RootState = ga4State?.rootState || sources?.ga4 || {};

  const sourceSnapshots = {
    metaAds: metaState?.snapshotId || null,
    googleAds: googleState?.snapshotId || null,
    ga4: ga4State?.snapshotId || null,
  };

  return {
    schema: 'adray.unified.context.v2',
    generatedAt: nowIso(),
    snapshotId:
      sourceSnapshots.metaAds ||
      sourceSnapshots.googleAds ||
      sourceSnapshots.ga4 ||
      safeStr(root?.latestSnapshotId) ||
      null,
    sourceSnapshots,
    coverage: root?.coverage || null,
    contextPolicy: {
      mode: 'working_window_on_long_term_storage',
      reasoningRangeDays: contextRangeDays || DEFAULT_CONTEXT_RANGE_DAYS,
      storageRangeDays: storageRangeDays || null,
      note: 'The encoded context is optimized for recent decision-making while long-term historical data remains stored in MCP.',
    },
    contextWindow: {
      rangeDays: contextRangeDays || DEFAULT_CONTEXT_RANGE_DAYS,
      storageRangeDays: storageRangeDays || null,
      builtAt: nowIso(),
    },
    sources: {
      metaAds: {
        connected: !!(metaRootState?.connected || metaState?.hasChunks),
        ready: !!(metaRootState?.ready || metaState?.usable),
        usable: !!metaState?.usable,
        accountId: metaRootState?.accountId || null,
        name: metaRootState?.name || null,
        currency: metaRootState?.currency || null,
        timezone: metaRootState?.timezone || null,
        snapshotId: metaState?.snapshotId || null,
        chunkCount: toNum(metaState?.chunkCount, 0),
        storageRangeDays:
          toNum(metaRootState?.storageRangeDays, 0) ||
          toNum(metaRootState?.rangeDays, 0) ||
          storageRangeDays ||
          null,
        contextDefaultRangeDays:
          toNum(metaRootState?.contextDefaultRangeDays, 0) ||
          contextRangeDays ||
          null,
      },

      googleAds: {
        connected: !!(googleRootState?.connected || googleState?.hasChunks),
        ready: !!(googleRootState?.ready || googleState?.usable),
        usable: !!googleState?.usable,
        customerId: googleRootState?.customerId || googleRootState?.accountId || null,
        name: googleRootState?.name || null,
        currency: googleRootState?.currency || null,
        timezone: googleRootState?.timezone || null,
        snapshotId: googleState?.snapshotId || null,
        chunkCount: toNum(googleState?.chunkCount, 0),
        storageRangeDays:
          toNum(googleRootState?.storageRangeDays, 0) ||
          toNum(googleRootState?.rangeDays, 0) ||
          storageRangeDays ||
          null,
        contextDefaultRangeDays:
          toNum(googleRootState?.contextDefaultRangeDays, 0) ||
          contextRangeDays ||
          null,
      },

      ga4: {
        connected: !!(ga4RootState?.connected || ga4State?.hasChunks),
        ready: !!(ga4RootState?.ready || ga4State?.usable),
        usable: !!ga4State?.usable,
        propertyId: ga4RootState?.propertyId || null,
        name: ga4RootState?.name || null,
        currency: ga4RootState?.currency || null,
        timezone: ga4RootState?.timezone || null,
        snapshotId: ga4State?.snapshotId || null,
        chunkCount: toNum(ga4State?.chunkCount, 0),
        storageRangeDays:
          toNum(ga4RootState?.storageRangeDays, 0) ||
          toNum(ga4RootState?.rangeDays, 0) ||
          storageRangeDays ||
          null,
        contextDefaultRangeDays:
          toNum(ga4RootState?.contextDefaultRangeDays, 0) ||
          contextRangeDays ||
          null,
      },
    },
    inputs: {
      meta: metaPack ? { full: metaPack.full, mini: metaPack.mini } : null,
      googleAds: googlePack ? { full: googlePack.full, mini: googlePack.mini } : null,
      ga4: ga4Pack ? { full: ga4Pack.full, mini: ga4Pack.mini } : null,
    },
  };
}

function isIsoDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(safeStr(value).trim());
}

function pickWorkspaceName({ signalPayload, unifiedBase, root }) {
  return (
    safeStr(signalPayload?.workspaceName).trim() ||
    safeStr(root?.workspaceName).trim() ||
    safeStr(unifiedBase?.sources?.metaAds?.name).trim() ||
    safeStr(unifiedBase?.sources?.googleAds?.name).trim() ||
    safeStr(unifiedBase?.sources?.ga4?.name).trim() ||
    'Adray Workspace'
  );
}

function collectStructuredSourceFlags(unifiedBase) {
  const sources = unifiedBase?.sources || {};
  const out = {
    meta: {
      connected: !!sources?.metaAds?.connected,
      usable: !!sources?.metaAds?.usable,
      currency: safeStr(sources?.metaAds?.currency).trim() || null,
      timezone: safeStr(sources?.metaAds?.timezone).trim() || null,
      snapshotId: safeStr(sources?.metaAds?.snapshotId).trim() || null,
    },
    google: {
      connected: !!sources?.googleAds?.connected,
      usable: !!sources?.googleAds?.usable,
      currency: safeStr(sources?.googleAds?.currency).trim() || null,
      timezone: safeStr(sources?.googleAds?.timezone).trim() || null,
      snapshotId: safeStr(sources?.googleAds?.snapshotId).trim() || null,
    },
    ga4: {
      connected: !!sources?.ga4?.connected,
      usable: !!sources?.ga4?.usable,
      currency: safeStr(sources?.ga4?.currency).trim() || null,
      timezone: safeStr(sources?.ga4?.timezone).trim() || null,
      snapshotId: safeStr(sources?.ga4?.snapshotId).trim() || null,
    },
  };

  return out;
}

function pickStableValue(values = []) {
  const unique = uniqStrings(values.filter(Boolean), 10);
  return unique.length === 1 ? unique[0] : null;
}

function deriveCapabilityTier(usablePlatforms = [], { pixelActive = false, ordersTracked = false } = {}) {
  const usable = uniqStrings(usablePlatforms, 10);
  const hasAds = usable.includes('meta') || usable.includes('google');
  const hasGa4 = usable.includes('ga4');

  if (hasAds && hasGa4 && pixelActive && ordersTracked) return 4;
  if (hasAds && hasGa4) return 3;
  if (usable.length >= 2) return 2;
  if (usable.length === 1) return 1;
  return null;
}

function extractHistoryTotals(chunks, datasetPrefix) {
  // Lee todos los chunks cuyo dataset empieza con datasetPrefix
  // Ej: 'meta.history.daily_account_totals'
  // Retorna array plano de rows { date, kpis: {...} }
  const historyChunks = (Array.isArray(chunks) ? chunks : [])
    .filter((c) => safeStr(c?.dataset).startsWith(datasetPrefix));

  const allRows = [];
  for (const chunk of historyChunks) {
    const rows = Array.isArray(chunk?.data?.totals_by_day) ? chunk.data.totals_by_day : [];
    for (const row of rows) {
      if (isIsoDay(row?.date)) allRows.push(row);
    }
  }
  return allRows;
}

async function fetchDailyPixelStats(accountId, since, until) {
  // Retorna Map<date_string, { sessions, new_users, add_to_cart, checkout_starts, purchases_pixel }>
  // since y until son strings 'YYYY-MM-DD'
  if (!prisma || !accountId) return new Map();

  try {
    const from = new Date(since + 'T00:00:00Z');
    const to = new Date(until + 'T23:59:59Z');

    // Agrupar eventos por tipo y día usando findMany + reduce
    // (groupBy de Prisma no soporta truncar por día directamente)
    const events = await prisma.event.findMany({
      where: {
        accountId,
        createdAt: { gte: from, lte: to },
        eventName: {
          in: ['page_view', 'add_to_cart', 'begin_checkout', 'purchase', 'session_start'],
        },
      },
      select: {
        eventName: true,
        sessionId: true,
        createdAt: true,
      },
    });

    // Agrupar por día
    const byDay = new Map();
    for (const ev of events) {
      const day = ev.createdAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) {
        byDay.set(day, {
          sessions: new Set(),
          add_to_cart: 0,
          checkout_starts: 0,
          purchases_pixel: 0,
        });
      }
      const d = byDay.get(day);
      if (ev.eventName === 'page_view' || ev.eventName === 'session_start') {
        d.sessions.add(ev.sessionId);
      }
      if (ev.eventName === 'add_to_cart') d.add_to_cart++;
      if (ev.eventName === 'begin_checkout') d.checkout_starts++;
      if (ev.eventName === 'purchase') d.purchases_pixel++;
    }

    // Convertir Sets a counts
    const result = new Map();
    for (const [day, d] of byDay.entries()) {
      const sessions = d.sessions.size;
      result.set(day, {
        sessions,
        add_to_cart_count: d.add_to_cart,
        checkout_starts: d.checkout_starts,
        purchases_pixel: d.purchases_pixel,
        landing_page_cvr: sessions > 0 && d.checkout_starts > 0
          ? round2((d.checkout_starts / sessions) * 100) : null,
        cart_abandonment_rate: d.add_to_cart > 0 && d.checkout_starts >= 0
          ? round2(((d.add_to_cart - d.checkout_starts) / d.add_to_cart) * 100) : null,
      });
    }

    return result;
  } catch (e) {
    return new Map();
  }
}

async function fetchDailyOrderStats(accountId, since, until) {
  // Retorna Map<'YYYY-MM-DD', { orders, revenue }>
  if (!prisma || !accountId) return new Map();

  try {
    const from = new Date(since + 'T00:00:00Z');
    const to = new Date(until + 'T23:59:59Z');

    const orders = await prisma.order.findMany({
      where: {
        accountId,
        platformCreatedAt: { gte: from, lte: to },
      },
      select: {
        revenue: true,
        platformCreatedAt: true,
      },
    });

    const byDay = new Map();
    for (const order of orders) {
      const day = order.platformCreatedAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { orders: 0, revenue: 0 });
      const d = byDay.get(day);
      d.orders++;
      d.revenue += toNum(order.revenue);
    }

    const result = new Map();
    for (const [day, d] of byDay.entries()) {
      result.set(day, {
        orders: d.orders,
        revenue: round2(d.revenue),
      });
    }

    return result;
  } catch (e) {
    return new Map();
  }
}

function generateDateRange(days = 30) {
  // Genera array de strings YYYY-MM-DD para los últimos N días (hoy inclusive)
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function buildMetaDailyRows(metaPack, pixelStatsByDay = new Map(), orderStatsByDay = new Map()) {
  const activeTotals = Array.isArray(metaPack?.dailyDataset?.data?.totals_by_day)
    ? metaPack.dailyDataset.data.totals_by_day
    : [];

  const historyTotals = extractHistoryTotals(
    metaPack?.chunks,
    'meta.history.daily_account_totals'
  );

  // Merge: activo tiene prioridad. Deduplicar por fecha.
  const byDate = new Map();
  for (const row of [...historyTotals, ...activeTotals]) {
    if (isIsoDay(row?.date)) byDate.set(row.date, row);
  }

  const allDates = generateDateRange(30);
  const completeRows = allDates.map(date => {
    if (!byDate.has(date)) {
      return {
        date, platform: 'meta',
        spend: null, impressions: null, clicks: null,
        ctr: null, cpc: null, cpm: null,
        conversions: null, conversion_value: null, roas_platform: null,
        sessions: null, users: null, engagement_rate: null, ga4_revenue: null,
        blended_spend: null, blended_ctr: null, blended_cpc: null, platform_spend_share: null,
        add_to_cart_count: null, checkout_starts: null, landing_page_cvr: null, cart_abandonment_rate: null,
        orders: null, revenue: null, roas_reconciled: null, ncac: null, mer: null,
      };
    }
    const row = byDate.get(date);
    const spend = toNum(row?.kpis?.spend, null);
    const impressions = toNum(row?.kpis?.impressions, null);
    const clicks = toNum(row?.kpis?.clicks, null);
    const purchases = toNum(row?.kpis?.purchases, null);
    const purchaseValue = toNum(row?.kpis?.purchase_value, null);
    const pixel = pixelStatsByDay.get(row.date) || null;
    const orderData = orderStatsByDay.get(row.date) || null;
    return {
      date: row.date,
      platform: 'meta',
      spend: spend == null ? null : round2(spend),
      impressions: impressions == null ? null : round2(impressions),
      clicks: clicks == null ? null : round2(clicks),
      ctr: impressions > 0 ? round2((clicks / impressions) * 100) : null,
      cpc: clicks > 0 ? round2(spend / clicks) : null,
      cpm: impressions > 0 ? round2((spend / impressions) * 1000) : null,
      conversions: purchases == null ? null : round2(purchases),
      conversion_value: purchaseValue == null ? null : round2(purchaseValue),
      roas_platform: spend > 0 ? round2(purchaseValue / spend) : null,
      sessions: pixel?.sessions ?? null,
      users: null,
      engagement_rate: null,
      ga4_revenue: null,
      blended_spend: null,
      blended_ctr: null,
      blended_cpc: null,
      platform_spend_share: null,
      add_to_cart_count: pixel?.add_to_cart_count ?? null,
      checkout_starts: pixel?.checkout_starts ?? null,
      landing_page_cvr: pixel?.landing_page_cvr ?? null,
      cart_abandonment_rate: pixel?.cart_abandonment_rate ?? null,
      orders: orderData?.orders ?? null,
      revenue: orderData?.revenue ?? null,
      roas_reconciled: spend > 0 && orderData?.revenue != null
        ? round2(orderData.revenue / spend) : null,
      ncac: null,
      mer: null,
    };
  });
  return completeRows;
}

function buildGoogleDailyRows(googlePack, pixelStatsByDay = new Map(), orderStatsByDay = new Map()) {
  const activeTotals = Array.isArray(googlePack?.dailyDataset?.data?.totals_by_day)
    ? googlePack.dailyDataset.data.totals_by_day
    : [];

  const historyTotals = extractHistoryTotals(
    googlePack?.chunks,
    'google.history.daily_account_totals'
  );

  // Merge: activo tiene prioridad. Deduplicar por fecha.
  const byDate = new Map();
  for (const row of [...historyTotals, ...activeTotals]) {
    if (isIsoDay(row?.date)) byDate.set(row.date, row);
  }

  const allDates = generateDateRange(30);
  const completeRows = allDates.map(date => {
    if (!byDate.has(date)) {
      return {
        date, platform: 'google',
        spend: null, impressions: null, clicks: null,
        ctr: null, cpc: null, cpm: null,
        conversions: null, conversion_value: null, roas_platform: null,
        sessions: null, users: null, engagement_rate: null, ga4_revenue: null,
        blended_spend: null, blended_ctr: null, blended_cpc: null, platform_spend_share: null,
        add_to_cart_count: null, checkout_starts: null, landing_page_cvr: null, cart_abandonment_rate: null,
        orders: null, revenue: null, roas_reconciled: null, ncac: null, mer: null,
      };
    }
    const row = byDate.get(date);
    const spend = toNum(row?.kpis?.spend, null);
    const impressions = toNum(row?.kpis?.impressions, null);
    const clicks = toNum(row?.kpis?.clicks, null);
    const conversions = toNum(row?.kpis?.conversions, null);
    const conversionValue = toNum(row?.kpis?.conversion_value, null);
    const pixel = pixelStatsByDay.get(row.date) || null;
    const orderData = orderStatsByDay.get(row.date) || null;
    return {
      date: row.date,
      platform: 'google',
      spend: spend == null ? null : round2(spend),
      impressions: impressions == null ? null : round2(impressions),
      clicks: clicks == null ? null : round2(clicks),
      ctr: impressions > 0 ? round2((clicks / impressions) * 100) : null,
      cpc: clicks > 0 ? round2(spend / clicks) : null,
      cpm: impressions > 0 ? round2((spend / impressions) * 1000) : null,
      conversions: conversions == null ? null : round2(conversions),
      conversion_value: conversionValue == null ? null : round2(conversionValue),
      roas_platform: spend > 0 ? round2(conversionValue / spend) : null,
      sessions: pixel?.sessions ?? null,
      users: null,
      engagement_rate: null,
      ga4_revenue: null,
      blended_spend: null,
      blended_ctr: null,
      blended_cpc: null,
      platform_spend_share: null,
      add_to_cart_count: pixel?.add_to_cart_count ?? null,
      checkout_starts: pixel?.checkout_starts ?? null,
      landing_page_cvr: pixel?.landing_page_cvr ?? null,
      cart_abandonment_rate: pixel?.cart_abandonment_rate ?? null,
      orders: orderData?.orders ?? null,
      revenue: orderData?.revenue ?? null,
      roas_reconciled: spend > 0 && orderData?.revenue != null
        ? round2(orderData.revenue / spend) : null,
      ncac: null,
      mer: null,
    };
  });
  return completeRows;
}

function buildGa4DailyRows(ga4Pack, pixelStatsByDay = new Map(), orderStatsByDay = new Map()) {
  const rawTotals = Array.isArray(ga4Pack?.dailyDataset?.data?.totals_by_day)
    ? ga4Pack.dailyDataset.data.totals_by_day
    : [];

  const byDate = new Map();
  for (const row of rawTotals) {
    if (isIsoDay(row?.date)) byDate.set(row.date, row);
  }

  const allDates = generateDateRange(30);
  const completeRows = allDates.map(date => {
    if (!byDate.has(date)) {
      return {
        date, platform: 'ga4',
        spend: null, impressions: null, clicks: null,
        ctr: null, cpc: null, cpm: null,
        conversions: null, conversion_value: null, roas_platform: null,
        sessions: null, users: null, engagement_rate: null, ga4_revenue: null,
        blended_spend: null, blended_ctr: null, blended_cpc: null, platform_spend_share: null,
        add_to_cart_count: null, checkout_starts: null, landing_page_cvr: null, cart_abandonment_rate: null,
        orders: null, revenue: null, roas_reconciled: null, ncac: null, mer: null,
      };
    }
    const row = byDate.get(date);
    const sessions = toNum(row?.kpis?.sessions, null);
    const users = toNum(row?.kpis?.users, null);
    const conversions = toNum(row?.kpis?.conversions, null);
    const ga4Rev = toNum(row?.kpis?.revenue, null);
    const engagementRate = toNum(row?.kpis?.engagementRate, null);
    const pixel = pixelStatsByDay.get(row.date) || null;
    const orderData = orderStatsByDay.get(row.date) || null;
    return {
      date: row.date,
      platform: 'ga4',
      spend: null,
      impressions: null,
      clicks: null,
      ctr: null,
      cpc: null,
      cpm: null,
      conversions: conversions == null ? null : round2(conversions),
      conversion_value: null,
      roas_platform: null,
      sessions: sessions == null ? null : round2(sessions),
      users: users == null ? null : round2(users),
      engagement_rate: engagementRate == null ? null : round2(engagementRate),
      ga4_revenue: ga4Rev == null ? null : round2(ga4Rev),
      blended_spend: null,
      blended_ctr: null,
      blended_cpc: null,
      platform_spend_share: null,
      add_to_cart_count: pixel?.add_to_cart_count ?? null,
      checkout_starts: pixel?.checkout_starts ?? null,
      landing_page_cvr: pixel?.landing_page_cvr ?? null,
      cart_abandonment_rate: pixel?.cart_abandonment_rate ?? null,
      orders: orderData?.orders ?? null,
      revenue: orderData?.revenue ?? null,
      roas_reconciled: null,
      ncac: null,
      mer: null,
    };
  });
  return completeRows;
}

function buildBlendedDailyRows(dailyRows, usablePlatforms) {
  if (!Array.isArray(dailyRows) || uniqStrings(usablePlatforms, 10).length < 2) return [];

  const byDate = new Map();
  for (const row of dailyRows) {
    if (!isIsoDay(row?.date)) continue;
    if (safeStr(row?.platform).trim() === 'blended') continue;
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }

  const out = [];

  for (const [date, rows] of Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const adsRows = rows.filter((row) => row.platform === 'meta' || row.platform === 'google');
    const totalSpend = adsRows.reduce((sum, row) => sum + toNum(row?.spend), 0);
    const totalImpressions = adsRows.reduce((sum, row) => sum + toNum(row?.impressions), 0);
    const totalClicks = adsRows.reduce((sum, row) => sum + toNum(row?.clicks), 0);
    const totalSessions = rows.reduce((sum, row) => sum + toNum(row?.sessions), 0);
    const totalUsers = rows.reduce((sum, row) => sum + toNum(row?.users), 0);

    const spendShare = totalSpend > 0
      ? rows.reduce((acc, row) => {
        if (row.platform === 'blended') return acc;
        const spend = toNum(row?.spend, null);
        acc[row.platform] = spend == null ? null : round2(spend / totalSpend);
        return acc;
      }, {})
      : null;

    out.push({
      date,
      platform: 'blended',
      spend: null,
      impressions: totalImpressions > 0 ? round2(totalImpressions) : null,
      clicks: totalClicks > 0 ? round2(totalClicks) : null,
      ctr: null,
      cpc: null,
      cpm: null,
      conversions: null,
      conversion_value: null,
      roas_platform: null,
      sessions: totalSessions > 0 ? round2(totalSessions) : null,
      users: totalUsers > 0 ? round2(totalUsers) : null,
      engagement_rate: null,
      ga4_revenue: null,
      blended_spend: adsRows.length > 0 ? round2(totalSpend) : null,
      blended_ctr: totalImpressions > 0 ? round2((totalClicks / totalImpressions) * 100) : null,
      blended_cpc: totalClicks > 0 ? round2(totalSpend / totalClicks) : null,
      platform_spend_share: spendShare,
    });
  }

  return out;
}

function normalizePctDelta(current, previous) {
  const cur = Number(current);
  const prev = Number(previous);

  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev <= 0) return null;

  return round2(((cur - prev) / prev) * 100);
}

function aggregateCampaignWindow(rows, fromDate, toDate, platform) {
  const windowRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const date = safeStr(row?.date).trim();
    if (!isIsoDay(date)) return false;
    if (fromDate && date < fromDate) return false;
    if (toDate && date > toDate) return false;
    return true;
  });

  if (windowRows.length === 0) return null;

  const spend = windowRows.reduce((sum, row) => sum + toNum(row?.kpis?.spend), 0);
  const impressions = windowRows.reduce((sum, row) => sum + toNum(row?.kpis?.impressions), 0);
  const clicks = windowRows.reduce((sum, row) => sum + toNum(row?.kpis?.clicks), 0);
  const conversions = platform === 'meta'
    ? windowRows.reduce((sum, row) => sum + toNum(row?.kpis?.purchases), 0)
    : windowRows.reduce((sum, row) => sum + toNum(row?.kpis?.conversions), 0);
  const conversionValue = platform === 'meta'
    ? windowRows.reduce((sum, row) => sum + toNum(row?.kpis?.purchase_value), 0)
    : windowRows.reduce((sum, row) => sum + toNum(row?.kpis?.conversion_value), 0);

  return {
    spend: round2(spend),
    impressions: round2(impressions),
    clicks: round2(clicks),
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : null,
    cpc: clicks > 0 ? round2(spend / clicks) : null,
    cpm: impressions > 0 ? round2((spend / impressions) * 1000) : null,
    conversions: round2(conversions),
    conversion_value: round2(conversionValue),
    roas_platform: spend > 0 ? round2(conversionValue / spend) : null,
  };
}

function getContextWindowEnd(unifiedBase, metaPack, googlePack) {
  const candidates = [
    metaPack?.dailyDataset?.data?.meta?.range?.to,
    googlePack?.dailyDataset?.data?.meta?.range?.to,
    unifiedBase?.inputs?.meta?.full?.meta?.range?.to,
    unifiedBase?.inputs?.googleAds?.full?.meta?.range?.to,
  ];

  for (const value of candidates) {
    if (isIsoDay(value)) return value;
  }

  return null;
}

function addDaysIso(date, deltaDays) {
  if (!isIsoDay(date)) return null;
  const utc = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(utc.getTime())) return null;
  utc.setUTCDate(utc.getUTCDate() + Number(deltaDays || 0));
  return utc.toISOString().slice(0, 10);
}

function aggregateCampaignRowsById(campaignRows = []) {
  const grouped = new Map();

  for (const row of Array.isArray(campaignRows) ? campaignRows : []) {
    const campaignId = safeStr(row?.campaign_id).trim();
    const campaignName = safeStr(row?.campaign_name || row?.name).trim();
    if (!campaignId && !campaignName) continue;

    const key = campaignId || `name:${campaignName.toLowerCase()}`;
    const existing = grouped.get(key) || [];
    existing.push(row);
    grouped.set(key, existing);
  }

  return grouped;
}

function deriveBudgetMeta(platform, campaign) {
  if (platform !== 'meta') {
    return {
      budget_type: null,
      budget_amount: null,
    };
  }

  const dailyBudget = toNum(campaign?.budget?.daily, null);
  const lifetimeBudget = toNum(campaign?.budget?.lifetime, null);

  if (dailyBudget != null) {
    return {
      budget_type: 'daily',
      budget_amount: round2(dailyBudget),
    };
  }

  if (lifetimeBudget != null) {
    return {
      budget_type: 'lifetime',
      budget_amount: round2(lifetimeBudget),
    };
  }

  return {
    budget_type: null,
    budget_amount: null,
  };
}

function buildCampaignRecord({
  platform,
  campaign,
  campaignDailyRows,
  contextEnd,
  all60Fallback,
}) {
  const budgetMeta = deriveBudgetMeta(platform, campaign);

  const last7 = contextEnd
    ? aggregateCampaignWindow(campaignDailyRows, addDaysIso(contextEnd, -6), contextEnd, platform)
    : null;
  const prev7 = contextEnd
    ? aggregateCampaignWindow(campaignDailyRows, addDaysIso(contextEnd, -13), addDaysIso(contextEnd, -7), platform)
    : null;
  const last30 = contextEnd
    ? aggregateCampaignWindow(campaignDailyRows, addDaysIso(contextEnd, -29), contextEnd, platform)
    : null;
  const prev30 = contextEnd
    ? aggregateCampaignWindow(campaignDailyRows, addDaysIso(contextEnd, -59), addDaysIso(contextEnd, -30), platform)
    : null;

  return {
    campaign_id: safeStr(campaign?.campaign_id).trim() || null,
    campaign_name: safeStr(campaign?.campaign_name || campaign?.name).trim() || null,
    platform,
    objective: safeStr(campaign?.objective_norm || campaign?.objective).trim() || null,
    status: safeStr(campaign?.status).trim() || null,
    budget_type: budgetMeta.budget_type,
    budget_amount: budgetMeta.budget_amount,
    last_7: last7,
    last_30: last30,
    all_60: all60Fallback,
    wow_spend_pct: last7 && prev7 ? normalizePctDelta(last7.spend, prev7.spend) : null,
    wow_roas_pct:
      last7?.roas_platform != null && prev7?.roas_platform != null
        ? normalizePctDelta(last7.roas_platform, prev7.roas_platform)
        : null,
    mom_spend_pct: last30 && prev30 ? normalizePctDelta(last30.spend, prev30.spend) : null,
    mom_roas_pct:
      last30?.roas_platform != null && prev30?.roas_platform != null
        ? normalizePctDelta(last30.roas_platform, prev30.roas_platform)
        : null,
    efficiency_rank_7d: null,
    spend_share_pct: null,
    anomaly_flag: null,
  };
}

function buildMetaCampaigns(metaPack, contextEnd) {
  const rankedCampaigns = Array.isArray(metaPack?.rankedDataset?.data?.campaigns_ranked)
    ? metaPack.rankedDataset.data.campaigns_ranked
    : [];
  const campaignRowsById = aggregateCampaignRowsById(metaPack?.dailyDataset?.data?.campaigns_daily || []);

  return rankedCampaigns
    .map((campaign) => {
      const key =
        safeStr(campaign?.campaign_id).trim() ||
        `name:${safeStr(campaign?.name).trim().toLowerCase()}`;
      const campaignDailyRows = campaignRowsById.get(key) || [];

      const all60Fallback = {
        spend: round2(campaign?.kpis?.spend),
        impressions: round2(campaign?.kpis?.impressions),
        clicks: round2(campaign?.kpis?.clicks),
        ctr: round2(campaign?.kpis?.ctr),
        cpc: round2(campaign?.kpis?.cpc),
        cpm: round2(campaign?.kpis?.cpm),
        conversions: round2(campaign?.kpis?.purchases),
        conversion_value: round2(campaign?.kpis?.purchase_value),
        roas_platform: round2(campaign?.kpis?.roas),
      };

      return buildCampaignRecord({
        platform: 'meta',
        campaign,
        campaignDailyRows,
        contextEnd,
        all60Fallback,
      });
    })
    .filter((campaign) => campaign.campaign_id || campaign.campaign_name);
}

function buildGoogleCampaigns(googlePack, contextEnd) {
  const rankedCampaigns = Array.isArray(googlePack?.rankedDataset?.data?.campaigns_ranked)
    ? googlePack.rankedDataset.data.campaigns_ranked
    : [];
  const campaignRowsById = aggregateCampaignRowsById(googlePack?.dailyDataset?.data?.campaigns_daily || []);

  return rankedCampaigns
    .map((campaign) => {
      const key =
        safeStr(campaign?.campaign_id).trim() ||
        `name:${safeStr(campaign?.name).trim().toLowerCase()}`;
      const campaignDailyRows = campaignRowsById.get(key) || [];

      const all60Fallback = {
        spend: round2(campaign?.kpis?.spend),
        impressions: round2(campaign?.kpis?.impressions),
        clicks: round2(campaign?.kpis?.clicks),
        ctr: round2(campaign?.kpis?.ctr),
        cpc: round2(campaign?.kpis?.cpc),
        cpm: round2(campaign?.kpis?.cpm),
        conversions: round2(campaign?.kpis?.conversions),
        conversion_value: round2(campaign?.kpis?.conversion_value),
        roas_platform: round2(campaign?.kpis?.roas),
      };

      return buildCampaignRecord({
        platform: 'google',
        campaign,
        campaignDailyRows,
        contextEnd,
        all60Fallback,
      });
    })
    .filter((campaign) => campaign.campaign_id || campaign.campaign_name);
}

function applyCampaignDerivedFields(campaigns) {
  const next = Array.isArray(campaigns)
    ? campaigns.map((campaign) => ({ ...campaign }))
    : [];

  for (const platform of ['meta', 'google']) {
    const platformRows = next.filter((campaign) => campaign.platform === platform);
    const totalSpend = platformRows.reduce((sum, campaign) => sum + toNum(campaign?.all_60?.spend), 0);

    const rankedForEfficiency = platformRows
      .filter((campaign) => toNum(campaign?.last_7?.spend) > 0 && campaign?.last_7?.roas_platform != null)
      .slice()
      .sort((a, b) => {
        const roasDiff = toNum(b?.last_7?.roas_platform) - toNum(a?.last_7?.roas_platform);
        if (Math.abs(roasDiff) > 0.0001) return roasDiff;
        return toNum(b?.last_7?.spend) - toNum(a?.last_7?.spend);
      });

    const rankMap = new Map(
      rankedForEfficiency.map((campaign, index) => [campaign.campaign_id || campaign.campaign_name, index + 1])
    );

    for (const campaign of platformRows) {
      const key = campaign.campaign_id || campaign.campaign_name;
      campaign.efficiency_rank_7d = rankMap.get(key) || null;
      campaign.spend_share_pct =
        totalSpend > 0 && campaign?.all_60?.spend != null
          ? round2((campaign.all_60.spend / totalSpend) * 100)
          : null;
    }
  }

  return next;
}

function buildAdsDailySchema({ metaPack, googlePack }) {
  const DAYS = 30;
  const dateRange = generateDateRange(DAYS);
  const result = [];

  const processPlatform = (pack, platform) => {
    const rawRows = Array.isArray(pack?.adsDailyDataset?.data?.ads_daily)
      ? pack.adsDailyDataset.data.ads_daily
      : [];
    if (rawRows.length === 0) return;

    const byId = new Map();
    for (const row of rawRows) {
      const adId = safeStr(row?.ad_id).trim() || safeStr(row?.ad_name).trim();
      if (!adId) continue;
      if (!byId.has(adId)) {
        byId.set(adId, {
          ad_id: safeStr(row.ad_id).trim() || null,
          ad_name: safeStr(row.ad_name).trim() || null,
          adset_id: safeStr(row.adset_id || row.ad_group_id).trim() || null,
          campaign_id: safeStr(row.campaign_id).trim() || null,
          platform,
          days: new Map(),
        });
      }
      const dateKey = safeStr(row?.date).trim();
      if (isIsoDay(dateKey)) byId.get(adId).days.set(dateKey, row);
    }

    for (const [, entry] of byId) {
      const days = dateRange.map((date) => {
        const row = entry.days.get(date);
        if (!row) {
          return { date, spend: null, impressions: null, clicks: null, ctr: null, cpc: null, conversions: null, conversion_value: null, roas: null };
        }
        const spend = toNum(row.spend, null);
        const impressions = toNum(row.impressions, null);
        const clicks = toNum(row.clicks, null);
        const conversions = toNum(row.conversions, null);
        const conversionValue = toNum(row.conversion_value, null);
        return {
          date,
          spend: spend != null ? round2(spend) : null,
          impressions,
          clicks,
          ctr: impressions > 0 && clicks != null ? round2((clicks / impressions) * 100) : null,
          cpc: clicks > 0 && spend != null ? round2(spend / clicks) : null,
          conversions,
          conversion_value: conversionValue != null ? round2(conversionValue) : null,
          roas: spend > 0 && conversionValue != null ? round2(conversionValue / spend) : null,
        };
      });
      result.push({
        ad_id: entry.ad_id,
        ad_name: entry.ad_name,
        adset_id: entry.adset_id,
        campaign_id: entry.campaign_id,
        platform: entry.platform,
        days,
      });
    }
  };

  processPlatform(metaPack, 'meta');
  processPlatform(googlePack, 'google');

  return result;
}

function buildLandingPagesDailySchema({ ga4Pack }) {
  const DAYS = 30;
  const dateRange = generateDateRange(DAYS);
  const minDate = dateRange[0];

  const landingChunks = Array.isArray(ga4Pack?.landingPagesChunks)
    ? ga4Pack.landingPagesChunks
    : [];

  if (landingChunks.length === 0) return [];

  const allRows = [];
  for (const chunk of landingChunks) {
    const rows = Array.isArray(chunk?.data?.landing_pages_daily)
      ? chunk.data.landing_pages_daily
      : [];
    for (const row of rows) {
      if (!isIsoDay(row?.date) || row.date < minDate) continue;
      allRows.push(row);
    }
  }

  if (allRows.length === 0) return [];

  const byPage = new Map();
  for (const row of allRows) {
    const page = safeStr(row?.page).trim();
    if (!page) continue;
    if (!byPage.has(page)) byPage.set(page, { totalSessions: 0, days: new Map() });
    byPage.get(page).totalSessions += toNum(row.sessions, 0);
    byPage.get(page).days.set(safeStr(row.date).trim(), row);
  }

  const top25 = [...byPage.entries()]
    .sort((a, b) => b[1].totalSessions - a[1].totalSessions)
    .slice(0, 25);

  return top25.map(([page, entry]) => ({
    page,
    platform: 'ga4',
    days: dateRange.map((date) => {
      const row = entry.days.get(date);
      if (!row) {
        return { date, sessions: null, conversions: null, revenue: null, engagement_rate: null };
      }
      return {
        date,
        sessions: toNum(row.sessions, null) != null ? round2(toNum(row.sessions)) : null,
        conversions: toNum(row.conversions, null) != null ? round2(toNum(row.conversions)) : null,
        revenue: toNum(row.revenue, null) != null ? round2(toNum(row.revenue)) : null,
        engagement_rate: toNum(row.engagementRate, null) != null ? round2(toNum(row.engagementRate)) : null,
      };
    }),
  }));
}

function buildCampaignsDailySchema({ metaPack, googlePack }) {
  const DAYS = 30;
  const dateRange = generateDateRange(DAYS);

  const result = [];

  const processPlatform = (pack, platform) => {
    const rawRows = Array.isArray(pack?.dailyDataset?.data?.campaigns_daily)
      ? pack.dailyDataset.data.campaigns_daily
      : [];

    if (rawRows.length === 0) return;

    const byId = new Map();
    for (const row of rawRows) {
      const cid = safeStr(row?.campaign_id).trim() || safeStr(row?.campaign_name).trim();
      if (!cid) continue;
      if (!byId.has(cid)) {
        byId.set(cid, {
          campaign_id: safeStr(row.campaign_id).trim() || null,
          campaign_name: safeStr(row.campaign_name || row.name).trim() || null,
          platform,
          days: new Map(),
        });
      }
      const dateKey = safeStr(row?.date).trim();
      if (!isIsoDay(dateKey)) continue;
      byId.get(cid).days.set(dateKey, row);
    }

    for (const [, entry] of byId) {
      const days = dateRange.map((date) => {
        const row = entry.days.get(date);
        if (!row) {
          return {
            date,
            spend: null,
            impressions: null,
            clicks: null,
            ctr: null,
            cpc: null,
            cpm: null,
            conversions: null,
            conversion_value: null,
            roas: null,
          };
        }
        const spend = toNum(row.kpis?.spend, null);
        const impressions = toNum(row.kpis?.impressions, null);
        const clicks = toNum(row.kpis?.clicks, null);
        const conversions =
          platform === 'meta'
            ? toNum(row.kpis?.purchases ?? row.kpis?.conversions, null)
            : toNum(row.kpis?.conversions, null);
        const conversionValue =
          platform === 'meta'
            ? toNum(row.kpis?.purchase_value ?? row.kpis?.conversion_value, null)
            : toNum(row.kpis?.conversion_value, null);

        return {
          date,
          spend: spend != null ? round2(spend) : null,
          impressions: impressions != null ? round2(impressions) : null,
          clicks: clicks != null ? round2(clicks) : null,
          ctr:
            impressions != null && impressions > 0 && clicks != null
              ? round2((clicks / impressions) * 100)
              : null,
          cpc: clicks != null && clicks > 0 && spend != null ? round2(spend / clicks) : null,
          cpm:
            impressions != null && impressions > 0 && spend != null
              ? round2((spend / impressions) * 1000)
              : null,
          conversions: conversions != null ? round2(conversions) : null,
          conversion_value: conversionValue != null ? round2(conversionValue) : null,
          roas:
            spend != null && spend > 0 && conversionValue != null
              ? round2(conversionValue / spend)
              : null,
        };
      });

      result.push({
        campaign_id: entry.campaign_id,
        campaign_name: entry.campaign_name,
        platform: entry.platform,
        days,
      });
    }
  };

  processPlatform(metaPack, 'meta');
  processPlatform(googlePack, 'google');

  return result;
}

function buildCampaignsSchema({ metaPack, googlePack, unifiedBase }) {
  const contextEnd = getContextWindowEnd(unifiedBase, metaPack, googlePack);
  const campaigns = [
    ...(metaPack?.rankedDataset ? buildMetaCampaigns(metaPack, contextEnd) : []),
    ...(googlePack?.rankedDataset ? buildGoogleCampaigns(googlePack, contextEnd) : []),
  ];

  return applyCampaignDerivedFields(campaigns)
    .sort((a, b) => {
      const spendDiff = toNum(b?.all_60?.spend) - toNum(a?.all_60?.spend);
      if (Math.abs(spendDiff) > 0.0001) return spendDiff;
      return safeStr(a?.campaign_name).localeCompare(safeStr(b?.campaign_name));
    });
}

function buildStructuredAttribution({ usablePlatforms, pixelStatsByDay, orderStatsByDay }) {
  const usable = uniqStrings(usablePlatforms, 10);
  const hasAds = usable.includes('meta') || usable.includes('google');
  const hasGa4 = usable.includes('ga4');
  const pixelActive = pixelStatsByDay instanceof Map && pixelStatsByDay.size > 0;
  const ordersTracked = orderStatsByDay instanceof Map && orderStatsByDay.size > 0;

  const tier = deriveCapabilityTier(usablePlatforms, { pixelActive, ordersTracked });

  let mode;
  let confidenceNote;
  let missingForUpgrade = [];

  if (tier === 4) {
    mode = 'first_party';
    confidenceNote = 'Full first-party attribution available. Pixel events and platform orders are being tracked alongside ad platform data and GA4. Highest confidence for ROAS and attribution questions.';
  } else if (tier === 3) {
    mode = 'cross_channel';
    confidenceNote = 'Cross-channel attribution available via ads platform + GA4. Revenue figures come from ad platforms. For first-party attribution, connect the Adray pixel and enable order tracking.';
    if (!pixelActive) missingForUpgrade.push('adray_pixel');
    if (!ordersTracked) missingForUpgrade.push('order_tracking');
  } else if (tier === 2) {
    mode = 'platform_only';
    confidenceNote = 'Two ad platforms connected but no GA4. Attribution relies entirely on platform-reported conversions. Connect GA4 for cross-channel visibility.';
    if (!hasGa4) missingForUpgrade.push('ga4');
    if (!pixelActive) missingForUpgrade.push('adray_pixel');
    if (!ordersTracked) missingForUpgrade.push('order_tracking');
  } else if (tier === 1) {
    mode = 'platform_only';
    confidenceNote = 'Single platform connected. Attribution is limited to platform-reported data only. Connect additional platforms and GA4 for a more complete picture.';
    if (!hasGa4) missingForUpgrade.push('ga4');
    if (!pixelActive) missingForUpgrade.push('adray_pixel');
    if (!ordersTracked) missingForUpgrade.push('order_tracking');
  } else {
    mode = 'none';
    confidenceNote = 'No usable data sources connected. Attribution is not available.';
    missingForUpgrade = ['meta_or_google_ads', 'ga4', 'adray_pixel', 'order_tracking'];
  }

  return {
    mode,
    capability_tier: tier,
    pixel_active: pixelActive,
    orders_tracked: ordersTracked,
    has_ads_data: hasAds,
    has_ga4_data: hasGa4,
    confidence_note: confidenceNote,
    missing_for_upgrade: missingForUpgrade,
  };
}

function buildStructuredBenchmarks({ metaPack, googlePack, ga4Pack }) {
  function mkKpi(current, prior) {
    const c = toNum(current, null);
    const p = toNum(prior, null);
    let pct = null;
    if (c != null && p != null && p !== 0) {
      pct = round2(((c - p) / Math.abs(p)) * 100);
    }
    let trend = null;
    if (pct != null) {
      if (pct > 1) trend = 'up';
      else if (pct < -1) trend = 'down';
      else trend = 'flat';
    }
    return {
      current_value: c != null ? round2(c) : null,
      prior_value: p != null ? round2(p) : null,
      pct_change: pct,
      trend,
    };
  }

  // --- META ---
  const metaCurrent = metaPack?.mini?.headline_kpis || {};
  const metaPrior   = metaPack?.full?.executive_summary?.comparison_windows?.prev_30_days || {};
  const metaBenchmarks = {
    roas:             mkKpi(metaCurrent.roas,             metaPrior.roas),
    cpa:              mkKpi(metaCurrent.cpa,              metaPrior.cpa),
    spend:            mkKpi(metaCurrent.spend,            metaPrior.spend),
    purchases:        mkKpi(metaCurrent.purchases,        metaPrior.purchases),
    purchase_value:   mkKpi(metaCurrent.purchase_value,   metaPrior.purchase_value),
    ctr:              mkKpi(metaCurrent.ctr,              metaPrior.ctr),
    cpc:              mkKpi(metaCurrent.cpc,              metaPrior.cpc),
    cpm:              mkKpi(metaCurrent.cpm,              metaPrior.cpm),
    conversion_rate:  mkKpi(metaCurrent.conversion_rate,  metaPrior.conversion_rate),
    frequency:        mkKpi(metaCurrent.frequency,        null),
  };

  // --- GOOGLE ---
  const googleCurrent = googlePack?.mini?.headline_kpis || {};
  const googlePrior   = googlePack?.full?.executive_summary?.comparison_windows?.prev_30_days || {};
  const googleBenchmarks = {
    roas:             mkKpi(googleCurrent.roas,             googlePrior.roas),
    cpa:              mkKpi(googleCurrent.cpa,              googlePrior.cpa),
    spend:            mkKpi(googleCurrent.spend,            googlePrior.spend),
    conversions:      mkKpi(googleCurrent.conversions,      googlePrior.conversions),
    conversion_value: mkKpi(googleCurrent.conversion_value, googlePrior.conversion_value),
    ctr:              mkKpi(googleCurrent.ctr,              googlePrior.ctr),
    cpc:              mkKpi(googleCurrent.cpc,              googlePrior.cpc),
    cpm:              mkKpi(googleCurrent.cpm,              googlePrior.cpm),
    conversion_rate:  mkKpi(googleCurrent.conversion_rate,  googlePrior.conversion_rate),
  };

  // --- GA4 ---
  const ga4Current = ga4Pack?.mini?.headline_kpis
    || ga4Pack?.mini?.data?.headline_kpis
    || {};
  const ga4Prior = ga4Pack?.full?.executive_summary?.comparison_windows?.prev_30_days
    || ga4Pack?.full?.data?.executive_summary?.comparison_windows?.prev_30_days
    || {};
  const ga4Benchmarks = {
    revenue:              mkKpi(ga4Current.revenue,              ga4Prior.revenue),
    sessions:             mkKpi(ga4Current.sessions,             ga4Prior.sessions),
    conversions:          mkKpi(ga4Current.conversions,          ga4Prior.conversions),
    conversion_rate:      mkKpi(ga4Current.conversion_rate,      ga4Prior.conversion_rate),
    avg_session_duration: mkKpi(ga4Current.avg_session_duration, ga4Prior.avg_session_duration),
    bounce_rate:          mkKpi(ga4Current.bounce_rate,          ga4Prior.bounce_rate),
  };

  // --- OVERVIEW ---
  const adsPlatforms = [
    metaCurrent.roas != null ? { platform: 'meta', roas: round2(metaCurrent.roas) } : null,
    googleCurrent.roas != null ? { platform: 'google', roas: round2(googleCurrent.roas) } : null,
  ].filter(Boolean);
  const topAdsPlatformByRoas = adsPlatforms
    .slice()
    .sort((a, b) => toNum(b?.roas, -Infinity) - toNum(a?.roas, -Infinity))[0] || null;

  return {
    overview: {
      ads_platforms_present: adsPlatforms.map((r) => r.platform),
      top_ads_platform_by_roas: topAdsPlatformByRoas?.platform || null,
      ga4_revenue: ga4Current.revenue != null ? round2(ga4Current.revenue) : null,
    },
    meta:   Object.keys(metaBenchmarks).length > 0   ? metaBenchmarks   : null,
    google: Object.keys(googleBenchmarks).length > 0 ? googleBenchmarks : null,
    ga4:    Object.keys(ga4Benchmarks).length > 0    ? ga4Benchmarks    : null,
  };
}

function buildStructuredPlacements({ metaPack, googlePack }) {
  const placements = [];

  const pushRows = ({ rows, platform }) => {
    const normalized = compactArray(rows || [], 8);
    const totalSpend = normalized.reduce((sum, row) => sum + toNum(row?.spend), 0);
    const platformAvgRoas =
      normalized.length > 0
        ? normalized.reduce((sum, row) => sum + toNum(row?.roas), 0) / normalized.length
        : null;

    for (const row of normalized) {
      const placementName = safeStr(row?.key).trim();
      if (!placementName) continue;

      placements.push({
        platform,
        placement: placementName,
        last_7_spend: row?.spend != null ? round2(row.spend) : null,
        last_7_impressions: row?.impressions != null ? round2(row.impressions) : null,
        last_7_ctr: row?.ctr != null ? round2(row.ctr) : null,
        last_7_cpc: row?.cpc != null ? round2(row.cpc) : null,
        last_7_roas: row?.roas != null ? round2(row.roas) : null,
        last_30_spend: null,
        last_30_roas: null,
        spend_share_pct: totalSpend > 0 && row?.spend != null ? round2((row.spend / totalSpend) * 100) : null,
        roas_vs_platform_avg:
          platformAvgRoas != null && row?.roas != null
            ? round2(row.roas - platformAvgRoas)
            : null,
      });
    }
  };

  pushRows({
    rows: metaPack?.full?.breakdowns?.placement_top || metaPack?.mini?.top_placements || [],
    platform: 'meta',
  });
  pushRows({
    rows: googlePack?.full?.breakdowns?.network_top || googlePack?.mini?.top_networks || [],
    platform: 'google',
  });

  return placements;
}

function buildStructuredDevices({ metaPack, googlePack, ga4Pack }) {
  const devices = [];

  const pushAdRows = ({ rows, platform }) => {
    const normalized = compactArray(rows || [], 8);
    const totalSpend = normalized.reduce((sum, row) => sum + toNum(row?.spend), 0);

    for (const row of normalized) {
      const deviceType = safeStr(row?.key).trim();
      if (!deviceType) continue;

      devices.push({
        platform,
        device_type: deviceType,
        last_7_spend: row?.spend != null ? round2(row.spend) : null,
        last_7_impressions: row?.impressions != null ? round2(row.impressions) : null,
        last_7_clicks: row?.clicks != null ? round2(row.clicks) : null,
        last_7_ctr: row?.ctr != null ? round2(row.ctr) : null,
        last_7_conversions:
          row?.conversions != null
            ? round2(row.conversions)
            : row?.purchases != null
              ? round2(row.purchases)
              : null,
        last_7_roas: row?.roas != null ? round2(row.roas) : null,
        last_30_spend: null,
        last_30_roas: null,
        spend_share_pct: totalSpend > 0 && row?.spend != null ? round2((row.spend / totalSpend) * 100) : null,
      });
    }
  };

  const pushGa4Rows = (rows) => {
    for (const row of compactArray(rows || [], 8)) {
      const deviceType = safeStr(row?.device).trim();
      if (!deviceType) continue;

      devices.push({
        platform: 'ga4',
        device_type: deviceType,
        last_7_spend: null,
        last_7_impressions: null,
        last_7_clicks: null,
        last_7_ctr: null,
        last_7_conversions: row?.conversions != null ? round2(row.conversions) : null,
        last_7_roas: null,
        last_30_spend: null,
        last_30_roas: null,
        spend_share_pct: null,
      });
    }
  };

  pushAdRows({
    rows: metaPack?.full?.breakdowns?.device_top || metaPack?.mini?.top_devices || [],
    platform: 'meta',
  });
  pushAdRows({
    rows: googlePack?.full?.breakdowns?.device_top || googlePack?.mini?.top_devices || [],
    platform: 'google',
  });
  pushGa4Rows(ga4Pack?.mini?.data?.top_devices || ga4Pack?.mini?.top_devices || []);

  return devices;
}

function buildStructuredGa4Web({ ga4Pack }) {
  const ga4Data = ga4Pack?.mini?.data || ga4Pack?.full?.ga4 || null;
  if (!ga4Data) return {};

  return {
    top_channels: compactArray(ga4Data?.top_channels || [], 6).map((row) => ({
      channel: safeStr(row?.channel).trim() || null,
      sessions: row?.sessions != null ? round2(row.sessions) : null,
      conversions: row?.conversions != null ? round2(row.conversions) : null,
      revenue: row?.revenue != null ? round2(row.revenue) : null,
      engagement_rate: row?.engagementRate != null ? round2(row.engagementRate) : null,
    })).filter((row) => row.channel),
    top_source_medium: compactArray(ga4Data?.top_source_medium || [], 6).map((row) => ({
      source: safeStr(row?.source).trim() || null,
      medium: safeStr(row?.medium).trim() || null,
      sessions: row?.sessions != null ? round2(row.sessions) : null,
      conversions: row?.conversions != null ? round2(row.conversions) : null,
      revenue: row?.revenue != null ? round2(row.revenue) : null,
    })).filter((row) => row.source || row.medium),
    top_landing_pages: compactArray(ga4Data?.top_landing_pages || [], 6).map((row) => ({
      page: safeStr(row?.page).trim() || null,
      sessions: row?.sessions != null ? round2(row.sessions) : null,
      conversions: row?.conversions != null ? round2(row.conversions) : null,
      revenue: row?.revenue != null ? round2(row.revenue) : null,
      engagement_rate: row?.engagementRate != null ? round2(row.engagementRate) : null,
    })).filter((row) => row.page),
    top_events: compactArray(ga4Data?.top_events || [], 6).map((row) => ({
      event_name: safeStr(row?.event).trim() || null,
      count: row?.eventCount != null ? round2(row.eventCount) : null,
      revenue: row?.revenue != null ? round2(row.revenue) : null,
    })).filter((row) => row.event_name),
  };
}

function buildStructuredCrossChannel({ metaPack, googlePack, ga4Pack, usablePlatforms }) {
  if (uniqStrings(usablePlatforms, 10).length < 2) return {};

  const platformMix = [];
  const pushMixRow = (platform, kpis = {}, revenueField = null, conversionsField = null) => {
    if (!kpis || typeof kpis !== 'object') return;

    platformMix.push({
      platform,
      spend: kpis?.spend != null ? round2(kpis.spend) : null,
      conversions:
        conversionsField && kpis?.[conversionsField] != null
          ? round2(kpis[conversionsField])
          : null,
      revenue:
        revenueField && kpis?.[revenueField] != null
          ? round2(kpis[revenueField])
          : null,
      roas:
        kpis?.roas != null
          ? round2(kpis.roas)
          : null,
    });
  };

  pushMixRow('meta', metaPack?.mini?.headline_kpis || null, 'purchase_value', 'purchases');
  pushMixRow('google', googlePack?.mini?.headline_kpis || null, 'conversion_value', 'conversions');
  pushMixRow('ga4', ga4Pack?.mini?.data?.headline_kpis || ga4Pack?.mini?.headline_kpis || null, 'revenue', 'conversions');

  const adsPlatforms = platformMix.filter((row) => row.platform === 'meta' || row.platform === 'google');
  const comparableAdsPlatforms = adsPlatforms.filter((row) => row.roas != null && row.spend != null);
  const bestPlatformForScale = comparableAdsPlatforms.length >= 2
    ? comparableAdsPlatforms
      .slice()
      .sort((a, b) => toNum(b?.roas, -Infinity) - toNum(a?.roas, -Infinity))[0] || null
    : null;
  const weakestPlatform = comparableAdsPlatforms.length >= 2
    ? comparableAdsPlatforms
      .slice()
      .sort((a, b) => toNum(a?.roas, Infinity) - toNum(b?.roas, Infinity))[0] || null
    : null;

  const observations = [];
  if (bestPlatformForScale?.platform && bestPlatformForScale?.roas != null && weakestPlatform?.platform) {
    observations.push(`${bestPlatformForScale.platform} lidera eficiencia de escala con ROAS ${bestPlatformForScale.roas}.`);
  }
  if (weakestPlatform?.platform && weakestPlatform?.roas != null && weakestPlatform.platform !== bestPlatformForScale?.platform) {
    observations.push(`${weakestPlatform.platform} queda rezagado en eficiencia relativa con ROAS ${weakestPlatform.roas}.`);
  }
  const ga4Revenue = platformMix.find((row) => row.platform === 'ga4' && row.revenue != null);
  if (ga4Revenue?.revenue != null) {
    observations.push(`GA4 registra revenue web de ${ga4Revenue.revenue}.`);
  }

  return {
    platform_mix: platformMix.filter((row) => row.platform && (
      row.spend != null ||
      row.conversions != null ||
      row.revenue != null ||
      row.roas != null
    )),
    best_platform_for_scale: bestPlatformForScale ? bestPlatformForScale.platform : null,
    weakest_platform: weakestPlatform ? weakestPlatform.platform : null,
    cross_source_observations: uniqStrings(observations, 6),
  };
}

function buildStructuredAdSets({ metaPack }) {
  const raw = Array.isArray(metaPack?.adSetsDataset?.data?.ad_sets)
    ? metaPack.adSetsDataset.data.ad_sets
    : [];
  return raw.slice(0, 200);
}

function buildStructuredAds({ metaPack }) {
  const raw = Array.isArray(metaPack?.adsDataset?.data?.ads)
    ? metaPack.adsDataset.data.ads
    : [];
  return raw.slice(0, 300);
}

function isStructuredSectionShallow(section, value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== 'object') return false;

  const keys = Object.keys(value);
  if (keys.length === 0) return true;
  if (section === 'benchmarks') {
    const detailKeys = keys.filter((key) => key !== 'overview');
    const populatedDetails = detailKeys.filter((key) => value?.[key] && Object.keys(value[key] || {}).length > 0);
    return populatedDetails.length <= 1;
  }
  if (section === 'cross_channel') {
    return !Array.isArray(value?.platform_mix) || value.platform_mix.length < 2;
  }
  if (section === 'ga4_web') {
    const total =
      (Array.isArray(value?.top_channels) ? value.top_channels.length : 0) +
      (Array.isArray(value?.top_source_medium) ? value.top_source_medium.length : 0) +
      (Array.isArray(value?.top_landing_pages) ? value.top_landing_pages.length : 0) +
      (Array.isArray(value?.top_events) ? value.top_events.length : 0);
    return total < 2;
  }

  return false;
}

function buildStructuredPayloadHealth({
  connectedPlatforms = [],
  usablePlatforms = [],
  structuredSignal = {},
}) {
  const sectionNames = [
    'meta',
    'daily_index',
    'campaigns',
    'anomalies',
    'benchmarks',
    'placements',
    'devices',
    'ga4_web',
    'cross_channel',
    'ad_sets',
    'ads',
    'payload_stats',
  ];

  const sectionsPresent = [];
  const sectionsEmpty = [];
  const sectionsPartial = [];

  for (const section of sectionNames) {
    const value = structuredSignal?.[section];
    const isArray = Array.isArray(value);
    const isObject = !!value && typeof value === 'object' && !isArray;
    const hasData =
      isArray ? value.length > 0 :
        isObject ? Object.keys(value).length > 0 : value != null;

    if (hasData) {
      sectionsPresent.push(section);
      if (isStructuredSectionShallow(section, value)) {
        sectionsPartial.push(section);
      }
    } else {
      sectionsEmpty.push(section);
    }
  }

  const missingExpectedSections = [];
  const notes = [];
  const connected = uniqStrings(connectedPlatforms, 10);
  const usable = uniqStrings(usablePlatforms, 10);

  if (structuredSignal?.ad_sets && structuredSignal.ad_sets.length === 0) {
    missingExpectedSections.push('ad_sets');
    notes.push('ad_sets unavailable: no safe row-level ad set data in current builder inputs');
  }
  if (structuredSignal?.ads && structuredSignal.ads.length === 0) {
    missingExpectedSections.push('ads');
    notes.push('ads unavailable: no safe ad-level identifiers in current source payload');
  }
  if (usable.length < 2) {
    if (structuredSignal?.cross_channel) {
      missingExpectedSections.push('cross_channel');
    }
    notes.push('cross_channel limited: only one usable platform');
  } else if (sectionsPartial.includes('cross_channel')) {
    notes.push('cross_channel partial: comparable ads metrics are limited');
  }
  if (connected.length > usable.length) {
    notes.push('some connected platforms are not yet usable for a complete structured signal');
  }

  return {
    usable_platforms: usable,
    connected_platforms: connected,
    sections_present: sectionsPresent,
    sections_empty: sectionsEmpty,
    sections_partial: sectionsPartial,
    missing_expected_sections: uniqStrings(missingExpectedSections, 20),
    notes: uniqStrings(notes, 10),
    has_partial_data:
      connected.length > usable.length ||
      sectionsEmpty.length > 0 ||
      sectionsPartial.length > 0,
  };
}

function buildStructuredNarrativeSignals(structuredSignal = {}) {
  const anomalies = compactArray(structuredSignal?.anomalies || [], 8);
  const campaigns = compactArray(structuredSignal?.campaigns || [], 4);
  const placements = compactArray(structuredSignal?.placements || [], 3);
  const devices = compactArray(structuredSignal?.devices || [], 3);
  const healthNotes = uniqStrings(structuredSignal?.payload_health?.notes || [], 6);

  return {
    performance_drivers: uniqStrings([
      ...campaigns
        .filter((item) => item?.efficiency_rank_7d != null && item.efficiency_rank_7d <= 2)
        .map((item) => `${item?.platform || 'unknown'} structured campaign driver: ${item?.campaign_name || item?.campaign_id || 'unknown'} with 7d ROAS ${item?.last_7?.roas_platform ?? 'n/a'}`),
      ...placements
        .filter((item) => item?.last_7_roas != null && item.last_7_roas > 1)
        .map((item) => `${item?.platform || 'unknown'} placement driver: ${item?.placement || 'unknown'} with ROAS ${item?.last_7_roas}`),
    ], 6),
    conversion_bottlenecks: uniqStrings([
      ...anomalies
        .filter((item) => item?.direction === 'down' || item?.direction === 'risk')
        .map((item) => item?.plain_english),
      ...devices
        .filter((item) => item?.last_7_roas != null && item.last_7_roas < 1)
        .map((item) => `${item?.platform || 'unknown'} device bottleneck: ${item?.device_type || 'unknown'} with ROAS ${item?.last_7_roas}`),
    ], 8),
    scaling_opportunities: uniqStrings([
      ...anomalies
        .filter((item) => item?.direction === 'up' || item?.direction === 'opportunity')
        .map((item) => item?.plain_english),
    ], 6),
    risk_flags: uniqStrings([
      ...anomalies
        .filter((item) => item?.direction === 'down' || item?.direction === 'risk')
        .map((item) => item?.plain_english),
      ...healthNotes,
    ], 8),
    priority_actions: healthNotes,
  };
}

function buildCampaignAnomalyKey(campaign = {}) {
  return safeStr(campaign?.campaign_id).trim() || safeStr(campaign?.campaign_name).trim().toLowerCase();
}

function getPriorWeekTotals(chunks, platform) {
  // Lee meta.history.daily_account_totals o google.history.daily_account_totals
  // Suma los KPIs de los 7 días anteriores a "hoy - 7 días"
  // Retorna { spend, roas, cpa, conversions } o null si no hay datos
  const datasetPrefix = platform === 'google'
    ? 'google.history.daily_account_totals'
    : 'meta.history.daily_account_totals';
  const historyRows = extractHistoryTotals(chunks, datasetPrefix);
  if (!historyRows.length) return null;

  const today = new Date();
  const priorEndDate = new Date(today);
  priorEndDate.setDate(today.getDate() - 7);
  const priorStartDate = new Date(today);
  priorStartDate.setDate(today.getDate() - 14);

  const priorEndStr = priorEndDate.toISOString().slice(0, 10);
  const priorStartStr = priorStartDate.toISOString().slice(0, 10);

  const priorRows = historyRows.filter((r) => r.date >= priorStartStr && r.date <= priorEndStr);
  if (!priorRows.length) return null;

  let spend = 0;
  let purchaseValue = 0;
  let conversions = 0;
  for (const r of priorRows) {
    spend += toNum(r.kpis?.spend, 0);
    purchaseValue += toNum(r.kpis?.purchase_value ?? r.kpis?.conversion_value, 0);
    conversions += toNum(r.kpis?.purchases ?? r.kpis?.conversions, 0);
  }

  return {
    spend: round2(spend),
    roas: spend > 0 ? round2(purchaseValue / spend) : null,
    cpa: conversions > 0 ? round2(spend / conversions) : null,
    conversions: round2(conversions),
  };
}

function buildCampaignPriorWeekMap(chunks, datasetPrefix) {
  // Builds a Map<campaign_id, { spend, roas, cpa, conversions }> for the 7 days ending "today - 8"
  // Uses meta.history.daily_campaigns.* or google.history.daily_campaigns.* chunks
  const campaignChunks = (Array.isArray(chunks) ? chunks : [])
    .filter((c) => safeStr(c?.dataset).startsWith(datasetPrefix));
  if (!campaignChunks.length) return new Map();

  const today = new Date();
  const priorEndDate = new Date(today);
  priorEndDate.setDate(today.getDate() - 7);
  const priorStartDate = new Date(today);
  priorStartDate.setDate(today.getDate() - 14);

  const priorEndStr = priorEndDate.toISOString().slice(0, 10);
  const priorStartStr = priorStartDate.toISOString().slice(0, 10);

  const byId = new Map();
  for (const chunk of campaignChunks) {
    const rows = Array.isArray(chunk?.data?.campaigns_daily) ? chunk.data.campaigns_daily : [];
    for (const row of rows) {
      if (!isIsoDay(row?.date) || row.date < priorStartStr || row.date > priorEndStr) continue;
      const cid = safeStr(row?.campaign_id).trim();
      if (!cid) continue;
      if (!byId.has(cid)) byId.set(cid, { spend: 0, purchaseValue: 0, conversions: 0 });
      const agg = byId.get(cid);
      agg.spend += toNum(row.kpis?.spend, 0);
      agg.purchaseValue += toNum(row.kpis?.purchase_value ?? row.kpis?.conversion_value, 0);
      agg.conversions += toNum(row.kpis?.purchases ?? row.kpis?.conversions, 0);
    }
  }

  const result = new Map();
  for (const [cid, agg] of byId.entries()) {
    const { spend, purchaseValue, conversions } = agg;
    result.set(cid, {
      spend: round2(spend),
      roas: spend > 0 ? round2(purchaseValue / spend) : null,
      cpa: conversions > 0 ? round2(spend / conversions) : null,
      conversions: round2(conversions),
    });
  }
  return result;
}

function buildStructuredAnomalies({ metaPack, googlePack, ga4Pack }) {
  const out = [];
  const pushAnomaly = (item) => {
    if (!item?.entity_name || !item?.platform || !item?.anomaly_type) return;
    out.push({
      rank: out.length + 1,
      magnitude_pct: null,
      prior_value: null,
      current_value: null,
      estimated_impact: null,
      period: null,
      ...item,
    });
  };

  // Build per-campaign prior-week maps for WoW comparison
  const metaCampaignPriorMap = buildCampaignPriorWeekMap(
    metaPack?.chunks,
    'meta.history.daily_campaigns.'
  );
  const googleCampaignPriorMap = buildCampaignPriorWeekMap(
    googlePack?.chunks,
    'google.history.daily_campaigns.'
  );

  const pushCampaignAnomalies = ({ rows, platform, anomalyType, direction }) => {
    const priorMap = platform === 'google' ? googleCampaignPriorMap : metaCampaignPriorMap;
    for (const row of compactArray(rows || [], 6)) {
      const campaignName = safeStr(row?.campaign_name || row?.name).trim();
      if (!campaignName) continue;

      const roas = toNum(row?.kpis?.roas, null);
      const cpa = toNum(row?.kpis?.cpa, null);
      const spend = toNum(row?.kpis?.spend, null);
      const conversions = toNum(row?.kpis?.conversions, row?.kpis?.purchases);
      const conversionValue = toNum(row?.kpis?.conversion_value, row?.kpis?.purchase_value);
      const metric =
        roas != null ? 'roas_platform' :
          cpa != null ? 'cpa' :
            spend != null ? 'spend' :
              conversions != null ? 'conversions' :
                conversionValue != null ? 'conversion_value' : null;
      const currentValue =
        metric === 'roas_platform' ? round2(roas) :
          metric === 'cpa' ? round2(cpa) :
            metric === 'spend' ? round2(spend) :
              metric === 'conversions' ? round2(conversions) :
                metric === 'conversion_value' ? round2(conversionValue) : null;

      const cid = safeStr(row?.campaign_id).trim();
      const priorData = (cid && priorMap.has(cid)) ? priorMap.get(cid) : null;
      const priorValue =
        priorData == null ? null :
          metric === 'roas_platform' ? priorData.roas :
            metric === 'cpa' ? priorData.cpa :
              metric === 'spend' ? priorData.spend :
                metric === 'conversions' ? priorData.conversions :
                  null;
      const magnitudePct =
        priorValue != null && currentValue != null && priorValue !== 0
          ? round2(((currentValue - priorValue) / Math.abs(priorValue)) * 100)
          : null;
      const estimatedImpactUsd =
        magnitudePct != null && priorData?.spend != null
          ? round2((Math.abs(magnitudePct) / 100) * priorData.spend)
          : (spend != null ? round2(spend) : null);

      pushAnomaly({
        entity_type: 'campaign',
        entity_name: campaignName,
        campaign_id: cid || null,
        platform,
        metric,
        direction,
        current_value: currentValue,
        prior_value: priorValue,
        magnitude_pct: magnitudePct,
        estimated_impact: estimatedImpactUsd,
        anomaly_type: anomalyType,
        plain_english:
          safeStr(row?.label).trim() ||
          `${platform} campaign "${campaignName}" flagged as ${anomalyType.replace(/_/g, ' ')}.`,
      });
    }
  };

  pushCampaignAnomalies({
    rows: metaPack?.mini?.active_risks || metaPack?.mini?.risks || [],
    platform: 'meta',
    anomalyType: 'campaign_risk',
    direction: 'down',
  });
  pushCampaignAnomalies({
    rows: googlePack?.mini?.active_risks || googlePack?.mini?.risks || [],
    platform: 'google',
    anomalyType: 'campaign_risk',
    direction: 'down',
  });

  const pushDeltaAnomaly = ({ platform, deltas, metricKey, metricName, directionPositive = 'up', directionNegative = 'down', entityName }) => {
    const value = toNum(deltas?.[metricKey], null);
    if (value == null || Math.abs(value) < 15) return;
    pushAnomaly({
      entity_type: 'account',
      entity_name: entityName,
      platform,
      metric: metricName,
      direction: value >= 0 ? directionPositive : directionNegative,
      magnitude_pct: round2(Math.abs(value)),
      anomaly_type: `${metricName}_delta`,
      period: metricKey.includes('30') ? 'last_30_vs_prev_30' : 'last_7_vs_prev_7',
      plain_english: `${platform} ${metricName} changed ${round2(value)}% in the current comparison window.`,
    });
  };

  pushDeltaAnomaly({
    platform: 'meta',
    deltas: metaPack?.mini?.last7_vs_prev7 || null,
    metricKey: 'roas_pct',
    metricName: 'roas_platform',
    entityName: 'Meta account',
  });
  pushDeltaAnomaly({
    platform: 'meta',
    deltas: metaPack?.mini?.last7_vs_prev7 || null,
    metricKey: 'cpa_pct',
    metricName: 'cpa',
    directionPositive: 'risk',
    directionNegative: 'opportunity',
    entityName: 'Meta account',
  });
  pushDeltaAnomaly({
    platform: 'google',
    deltas: googlePack?.mini?.last7_vs_prev7 || null,
    metricKey: 'roas_pct',
    metricName: 'roas_platform',
    entityName: 'Google account',
  });
  pushDeltaAnomaly({
    platform: 'google',
    deltas: googlePack?.mini?.last7_vs_prev7 || null,
    metricKey: 'cpa_pct',
    metricName: 'cpa',
    directionPositive: 'risk',
    directionNegative: 'opportunity',
    entityName: 'Google account',
  });

  const pushConcentrationAnomaly = ({ platform, rows, label }) => {
    const topRows = compactArray(rows || [], 3);
    const totalSpend = topRows.reduce((sum, row) => sum + toNum(row?.spend), 0);
    const lead = topRows[0] || null;
    if (!lead?.key || totalSpend <= 0) return;
    const share = round2((toNum(lead?.spend) / totalSpend) * 100);
    if (share < 60) return;

    pushAnomaly({
      entity_type: label,
      entity_name: safeStr(lead?.key).trim(),
      platform,
      metric: 'spend_share_pct',
      direction: 'risk',
      magnitude_pct: share,
      current_value: share,
      estimated_impact: toNum(lead?.spend, null) != null ? round2(lead.spend) : null,
      anomaly_type: `${label}_spend_concentration`,
      plain_english: `${platform} depends heavily on ${safeStr(lead?.key).trim()} with ${share}% of tracked spend in this breakdown.`,
    });
  };

  pushConcentrationAnomaly({
    platform: 'meta',
    rows: metaPack?.full?.breakdowns?.placement_top || metaPack?.mini?.top_placements || [],
    label: 'placement',
  });

  const pushEfficiencyMismatch = ({ platform, rows, label, conversionField = 'purchases' }) => {
    for (const row of compactArray(rows || [], 6)) {
      const ctr = toNum(row?.ctr, null);
      const roas = toNum(row?.roas, null);
      const conversions = toNum(row?.[conversionField], row?.conversions);
      if (ctr == null || ctr < 2 || roas == null || roas > 1 || conversions == null || conversions > 0) continue;

      pushAnomaly({
        entity_type: label,
        entity_name: safeStr(row?.key).trim(),
        platform,
        metric: 'ctr',
        direction: 'risk',
        current_value: round2(ctr),
        anomaly_type: `${label}_high_ctr_weak_conversion`,
        plain_english: `${platform} ${label} "${safeStr(row?.key).trim()}" has strong CTR but weak conversion efficiency.`,
      });
    }
  };

  pushEfficiencyMismatch({
    platform: 'meta',
    rows: metaPack?.full?.breakdowns?.placement_top || metaPack?.mini?.top_placements || [],
    label: 'placement',
    conversionField: 'purchases',
  });
  pushEfficiencyMismatch({
    platform: 'meta',
    rows: metaPack?.full?.breakdowns?.device_top || metaPack?.mini?.top_devices || [],
    label: 'device',
    conversionField: 'purchases',
  });
  pushEfficiencyMismatch({
    platform: 'google',
    rows: googlePack?.full?.breakdowns?.device_top || googlePack?.mini?.top_devices || [],
    label: 'device',
    conversionField: 'conversions',
  });

  const pushReactivationOpportunity = ({ platform, rows }) => {
    for (const row of compactArray(rows || [], 4)) {
      const campaignName = safeStr(row?.campaign_name || row?.name).trim();
      if (!campaignName) continue;
      pushAnomaly({
        entity_type: 'campaign',
        entity_name: campaignName,
        campaign_id: safeStr(row?.campaign_id).trim() || null,
        platform,
        metric: 'roas_platform',
        direction: 'opportunity',
        current_value: row?.kpis?.roas != null ? round2(row.kpis.roas) : null,
        estimated_impact: row?.kpis?.spend != null ? round2(row.kpis.spend) : null,
        anomaly_type: 'paused_winner_reactivation',
        plain_english: `${platform} paused winner "${campaignName}" looks like a reactivation opportunity.`,
      });
    }
  };

  pushReactivationOpportunity({ platform: 'meta', rows: metaPack?.mini?.paused_winners || [] });
  pushReactivationOpportunity({ platform: 'google', rows: googlePack?.mini?.paused_winners || [] });

  const ga4Signals = ga4Pack?.mini?.data?.optimization_signals || ga4Pack?.mini?.optimization_signals || {};
  const pushGa4Anomalies = ({ rows, anomalyType, direction }) => {
    for (const row of compactArray(rows || [], 6)) {
      const entityName = safeStr(row?.label).trim();
      if (!entityName) continue;

      const sessions = toNum(row?.sessions, null);
      const conversions = toNum(row?.conversions, null);
      const revenue = toNum(row?.revenue, null);
      const engagementRate = toNum(row?.engagementRate, null);
      const metric =
        sessions != null ? 'sessions' :
          conversions != null ? 'conversions' :
            revenue != null ? 'revenue' :
              engagementRate != null ? 'engagement_rate' : null;
      const currentValue =
        metric === 'sessions' ? round2(sessions) :
          metric === 'conversions' ? round2(conversions) :
            metric === 'revenue' ? round2(revenue) :
              metric === 'engagement_rate' ? round2(engagementRate) : null;

      pushAnomaly({
        entity_type: safeStr(row?.type).trim() || 'ga4_signal',
        entity_name: entityName,
        platform: 'ga4',
        metric,
        direction,
        current_value: currentValue,
        estimated_impact: revenue != null ? round2(revenue) : null,
        anomaly_type: anomalyType,
        plain_english:
          `${safeStr(row?.type).trim() || 'GA4'} signal "${entityName}" flagged as ${anomalyType.replace(/_/g, ' ')}.`,
      });
    }
  };

  pushGa4Anomalies({
    rows: ga4Signals?.risks || [],
    anomalyType: 'optimization_risk',
    direction: 'down',
  });
  pushGa4Anomalies({
    rows: ga4Signals?.quick_wins || [],
    anomalyType: 'optimization_opportunity',
    direction: 'up',
  });

  return compactArray(out, 12);
}

function applyCampaignAnomalyFlags(campaigns, anomalies) {
  const flagged = new Set(
    compactArray(anomalies || [], 200)
      .filter((item) => item?.entity_type === 'campaign')
      .map((item) => safeStr(item?.campaign_id).trim() || safeStr(item?.entity_name).trim().toLowerCase())
      .filter(Boolean)
  );

  return compactArray(campaigns || [], 500).map((campaign) => ({
    ...campaign,
    anomaly_flag: flagged.has(buildCampaignAnomalyKey(campaign)),
  }));
}

async function buildStructuredSignalSchema({
  signalPayload,
  unifiedBase,
  root,
  metaPack,
  googlePack,
  ga4Pack,
  sourceFingerprint = null,
  connectionFingerprint = null,
}) {
  const sourceFlags = collectStructuredSourceFlags(unifiedBase);
  const connectedPlatforms = Object.entries(sourceFlags)
    .filter(([, state]) => !!state?.connected)
    .map(([platform]) => platform);
  const usablePlatforms = Object.entries(sourceFlags)
    .filter(([, state]) => !!state?.usable)
    .map(([platform]) => platform);

  // Determinar rango para queries Prisma
  const accountId = safeStr(
    unifiedBase?.accountId || unifiedBase?.account_id || ''
  ).trim() || null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const since = cutoff.toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  const [pixelStatsByDay, orderStatsByDay] = accountId
    ? await Promise.all([
        fetchDailyPixelStats(accountId, since, until),
        fetchDailyOrderStats(accountId, since, until),
      ])
    : [new Map(), new Map()];

  const dailyRows = [
    ...(sourceFlags.meta.usable
      ? buildMetaDailyRows(metaPack, pixelStatsByDay, orderStatsByDay) : []),
    ...(sourceFlags.google.usable
      ? buildGoogleDailyRows(googlePack, pixelStatsByDay, orderStatsByDay) : []),
    ...(sourceFlags.ga4.usable
      ? buildGa4DailyRows(ga4Pack, pixelStatsByDay, orderStatsByDay) : []),
  ];

  const blendedRows = buildBlendedDailyRows(dailyRows, usablePlatforms);
  const orderedPlatforms = ['meta', 'google', 'ga4', 'blended'];
  const dailyIndex = [...dailyRows, ...blendedRows].sort((a, b) => {
    const dateCompare = safeStr(a?.date).localeCompare(safeStr(b?.date));
    if (dateCompare !== 0) return dateCompare;
    return orderedPlatforms.indexOf(a?.platform) - orderedPlatforms.indexOf(b?.platform);
  });

  const uniqueDates = uniqStrings(
    dailyRows
      .map((row) => safeStr(row?.date).trim())
      .filter(Boolean),
    1000
  ).sort((a, b) => a.localeCompare(b));

  const accountCurrency = pickStableValue(
    usablePlatforms.map((platform) => sourceFlags?.[platform]?.currency)
  );
  const timezone = pickStableValue(
    usablePlatforms.map((platform) => sourceFlags?.[platform]?.timezone)
  );

  const sourceSnapshots = {
    meta: sourceFlags.meta.snapshotId,
    google: sourceFlags.google.snapshotId,
    ga4: sourceFlags.ga4.snapshotId,
  };

  const attribution = buildStructuredAttribution({ usablePlatforms, pixelStatsByDay, orderStatsByDay });

  const campaigns = buildCampaignsSchema({
    metaPack,
    googlePack,
    unifiedBase,
  });
  const anomalies = buildStructuredAnomalies({ metaPack, googlePack, ga4Pack });
  const flaggedCampaigns = applyCampaignAnomalyFlags(campaigns, anomalies);
  const benchmarks = buildStructuredBenchmarks({ metaPack, googlePack, ga4Pack });
  const placements = buildStructuredPlacements({ metaPack, googlePack });
  const devices = buildStructuredDevices({ metaPack, googlePack, ga4Pack });
  const ga4Web = buildStructuredGa4Web({ ga4Pack });
  const crossChannel = buildStructuredCrossChannel({ metaPack, googlePack, ga4Pack, usablePlatforms });
  const adSets = buildStructuredAdSets({ metaPack });
  const ads = buildStructuredAds({ metaPack });
  const campaignsDaily = buildCampaignsDailySchema({ metaPack, googlePack });
  const adsDaily = buildAdsDailySchema({ metaPack, googlePack });
  const landingPagesDaily = buildLandingPagesDailySchema({ ga4Pack });
  const usableSourcesCount = usablePlatforms.length;
  const payloadStats = {
    daily_index_rows: dailyIndex.length,
    campaigns_count: flaggedCampaigns.length,
    anomalies_count: anomalies.length,
    usable_sources_count: usableSourcesCount,
    placements_count: placements.length,
    devices_count: devices.length,
    ga4_top_channels_count: Array.isArray(ga4Web?.top_channels) ? ga4Web.top_channels.length : 0,
    ga4_top_landing_pages_count: Array.isArray(ga4Web?.top_landing_pages) ? ga4Web.top_landing_pages.length : 0,
    cross_channel_platforms_count: Array.isArray(crossChannel?.platform_mix) ? crossChannel.platform_mix.length : 0,
    ad_sets_count: adSets.length,
    ads_count: ads.length,
    campaigns_daily_count: campaignsDaily.length,
    ads_daily_count: adsDaily.length,
    landing_pages_daily_count: landingPagesDaily.length,
  };
  const payloadHealth = buildStructuredPayloadHealth({
    connectedPlatforms,
    usablePlatforms,
    structuredSignal: {
      meta: {
        connected_sources: connectedPlatforms,
        usable_sources: usablePlatforms,
      },
      daily_index: dailyIndex,
      attribution,
      campaigns: flaggedCampaigns,
      anomalies,
      benchmarks,
      placements,
      devices,
      ga4_web: ga4Web,
      cross_channel: crossChannel,
      ad_sets: adSets,
      ads,
      campaigns_daily: campaignsDaily,
      ads_daily: adsDaily,
      landing_pages_daily: landingPagesDaily,
      payload_stats: payloadStats,
    },
  });

  // Fase 4 — valores derivados para meta object
  const totalSpend30d = round2(
    dailyIndex.reduce((sum, row) => sum + toNum(row?.meta_spend ?? row?.spend, 0), 0)
  );
  const totalRevenue30dPlatform = round2(
    dailyIndex.reduce((sum, row) => sum + toNum(row?.meta_conversion_value ?? row?.conversion_value, 0), 0)
  );
  const activeCampaignsCount = flaggedCampaigns.filter((c) => {
    const s = safeStr(c?.status).toLowerCase();
    return s === 'active' || s === 'enabled' || s === 'on';
  }).length;

  return {
    schema: 'adray.signal.granular.v1',
    meta: {
      workspace_name: pickWorkspaceName({ signalPayload, unifiedBase, root }),
      snapshot_generated_at:
        safeStr(signalPayload?.generatedAt).trim() ||
        safeStr(unifiedBase?.generatedAt).trim() ||
        nowIso(),
      data_window_start: uniqueDates[0] || null,
      data_window_end: uniqueDates[uniqueDates.length - 1] || null,
      days_of_data: uniqueDates.length > 0 ? uniqueDates.length : null,
      connected_sources: connectedPlatforms,
      capability_tier: attribution.capability_tier,
      account_currency: accountCurrency,
      timezone,
      snapshot_id: safeStr(unifiedBase?.snapshotId).trim() || null,
      source_fingerprint: safeStr(sourceFingerprint).trim() || null,
      connection_fingerprint: safeStr(connectionFingerprint).trim() || null,
      source_snapshots: sourceSnapshots,
      usable_sources: usablePlatforms,
      usable_sources_count: usableSourcesCount,
      schema_name: 'adray.signal.granular',
      schema_version: 'v1',
      pixel_connected: connectedPlatforms.includes('pixel'),
      shopify_connected: connectedPlatforms.includes('shopify'),
      total_spend_30d: totalSpend30d,
      total_revenue_30d_platform: totalRevenue30dPlatform,
      active_campaigns_count: activeCampaignsCount,
      anomaly_count: anomalies.length,
    },
    daily_index: dailyIndex,
    attribution,
    campaigns: flaggedCampaigns,
    anomalies,
    benchmarks,
    placements,
    devices,
    ga4_web: ga4Web,
    cross_channel: crossChannel,
    ad_sets: adSets,
    ads,
    campaigns_daily: campaignsDaily,
    ads_daily: adsDaily,
    landing_pages_daily: landingPagesDaily,
    payload_stats: payloadStats,
    payload_health: payloadHealth,
  };
}

async function appendStructuredSignalSchema({
  signalPayload,
  unifiedBase,
  root,
  metaPack,
  googlePack,
  ga4Pack,
  sourceFingerprint = null,
  connectionFingerprint = null,
}) {
  const basePayload = signalPayload && typeof signalPayload === 'object'
    ? JSON.parse(JSON.stringify(signalPayload))
    : {};

  const structured = await buildStructuredSignalSchema({
    signalPayload: basePayload,
    unifiedBase,
    root,
    metaPack,
    googlePack,
    ga4Pack,
    sourceFingerprint,
    connectionFingerprint,
  });
  const structuredNarrative = buildStructuredNarrativeSignals(structured);

  return {
    ...basePayload,
    performance_drivers: uniqStrings([
      ...(basePayload?.performance_drivers || []),
      ...(structuredNarrative.performance_drivers || []),
    ], 12),
    conversion_bottlenecks: uniqStrings([
      ...(basePayload?.conversion_bottlenecks || []),
      ...(structuredNarrative.conversion_bottlenecks || []),
    ], 12),
    scaling_opportunities: uniqStrings([
      ...(basePayload?.scaling_opportunities || []),
      ...(structuredNarrative.scaling_opportunities || []),
    ], 12),
    risk_flags: uniqStrings([
      ...(basePayload?.risk_flags || []),
      ...(structuredNarrative.risk_flags || []),
    ], 12),
    prompt_hints: uniqStrings([
      ...(basePayload?.prompt_hints || []),
      ...(structured?.payload_health?.notes || []),
    ], 20),
    summary: {
      ...(basePayload?.summary || {}),
      priority_actions: uniqStrings([
        ...((basePayload?.summary && Array.isArray(basePayload.summary.priority_actions))
          ? basePayload.summary.priority_actions
          : []),
        ...(structuredNarrative.priority_actions || []),
      ], 14),
    },
    structured_signal: {
      schema: structured.schema,
      meta: structured.meta,
      daily_index: structured.daily_index,
      campaigns: structured.campaigns,
      anomalies: structured.anomalies,
      benchmarks: structured.benchmarks,
      placements: structured.placements,
      devices: structured.devices,
      ga4_web: structured.ga4_web,
      cross_channel: structured.cross_channel,
      ad_sets: structured.ad_sets,
      ads: structured.ads,
      campaigns_daily: structured.campaigns_daily || [],
      ads_daily: structured.ads_daily || [],
      landing_pages_daily: structured.landing_pages_daily || [],
      payload_stats: structured.payload_stats,
      payload_health: structured.payload_health,
    },
  };
}

function buildMetaNarrative(metaFull, metaMini) {
  const mini = metaMini || {};
  const full = metaFull || {};
  const bestActive = mini?.best_active_by_roas || null;

  const lines = [];

  if (mini?.headline_kpis) {
    lines.push(
      `Meta Ads: spend ${mini.headline_kpis.spend ?? 'n/a'}, purchases ${mini.headline_kpis.purchases ?? 'n/a'}, purchase value ${mini.headline_kpis.purchase_value ?? 'n/a'}, ROAS ${mini.headline_kpis.roas ?? 'n/a'}, CPA ${mini.headline_kpis.cpa ?? 'n/a'}.`
    );
  }

  if (bestActive?.campaign_name) {
    lines.push(
      `Best active Meta campaign by ROAS: "${bestActive.campaign_name}" with ROAS ${bestActive?.kpis?.roas ?? 'n/a'}, purchases ${bestActive?.kpis?.purchases ?? 'n/a'}, purchase value ${bestActive?.kpis?.purchase_value ?? 'n/a'}, spend ${bestActive?.kpis?.spend ?? 'n/a'}.`
    );
  }

  const activeTop = compactArray(mini?.active_campaigns_top || [], 3);
  for (const c of activeTop) {
    if (!c?.campaign_name) continue;
    lines.push(
      `Meta active campaign: "${c.campaign_name}" | status ${c?.status || 'n/a'} | objective ${c?.objective_norm || c?.objective || 'n/a'} | ROAS ${c?.kpis?.roas ?? 'n/a'} | purchases ${c?.kpis?.purchases ?? 'n/a'} | purchase value ${c?.kpis?.purchase_value ?? 'n/a'} | spend ${c?.kpis?.spend ?? 'n/a'}.`
    );
  }

  const risks = compactArray(mini?.active_risks || mini?.risks || [], 3);
  for (const r of risks) {
    if (!r?.campaign_name) continue;
    lines.push(
      `Meta active risk campaign: "${r.campaign_name}" | status ${r?.status || 'n/a'} | ROAS ${r?.kpis?.roas ?? 'n/a'} | CPA ${r?.kpis?.cpa ?? 'n/a'} | spend ${r?.kpis?.spend ?? 'n/a'}.`
    );
  }

  const devices = compactArray(mini?.top_devices || [], 2);
  for (const d of devices) {
    lines.push(
      `Meta device segment: ${d?.key || d?.device || 'n/a'} | spend ${d?.spend ?? 'n/a'} | purchases ${d?.purchases ?? 'n/a'} | ROAS ${d?.roas ?? 'n/a'}.`
    );
  }

  const placements = compactArray(mini?.top_placements || [], 2);
  for (const p of placements) {
    lines.push(
      `Meta placement segment: ${p?.key || 'n/a'} | spend ${p?.spend ?? 'n/a'} | purchases ${p?.purchases ?? 'n/a'} | ROAS ${p?.roas ?? 'n/a'}.`
    );
  }

  lines.push(...compactArray(full?.priority_summary?.positives || mini?.priority_summary?.positives || [], 3).map((x) => `Meta positive: ${x}`));
  lines.push(...compactArray(full?.priority_summary?.negatives || mini?.priority_summary?.negatives || [], 3).map((x) => `Meta risk: ${x}`));
  lines.push(...compactArray(full?.priority_summary?.actions || mini?.priority_summary?.actions || [], 4).map((x) => `Meta action: ${x}`));

  return lines;
}

function buildGoogleNarrative(googleFull, googleMini) {
  const mini = googleMini || {};
  const full = googleFull || {};
  const bestActive = mini?.best_active_by_roas || null;

  const lines = [];

  if (mini?.headline_kpis) {
    lines.push(
      `Google Ads: spend ${mini.headline_kpis.spend ?? 'n/a'}, conversions ${mini.headline_kpis.conversions ?? 'n/a'}, conversion value ${mini.headline_kpis.conversion_value ?? 'n/a'}, ROAS ${mini.headline_kpis.roas ?? 'n/a'}, CPA ${mini.headline_kpis.cpa ?? 'n/a'}.`
    );
  }

  if (bestActive?.campaign_name) {
    lines.push(
      `Best active Google Ads campaign by ROAS: "${bestActive.campaign_name}" with ROAS ${bestActive?.kpis?.roas ?? 'n/a'}, conversions ${bestActive?.kpis?.conversions ?? 'n/a'}, conversion value ${bestActive?.kpis?.conversion_value ?? 'n/a'}, spend ${bestActive?.kpis?.spend ?? 'n/a'}.`
    );
  }

  const activeTop = compactArray(mini?.active_campaigns_top || [], 3);
  for (const c of activeTop) {
    if (!c?.campaign_name) continue;
    lines.push(
      `Google active campaign: "${c.campaign_name}" | status ${c?.status || 'n/a'} | objective ${c?.objective_norm || c?.objective || 'n/a'} | channel ${c?.channel_type || 'n/a'} | ROAS ${c?.kpis?.roas ?? 'n/a'} | conversions ${c?.kpis?.conversions ?? 'n/a'} | conversion value ${c?.kpis?.conversion_value ?? 'n/a'} | spend ${c?.kpis?.spend ?? 'n/a'}.`
    );
  }

  const risks = compactArray(mini?.active_risks || mini?.risks || [], 3);
  for (const r of risks) {
    if (!r?.campaign_name) continue;
    lines.push(
      `Google active risk campaign: "${r.campaign_name}" | status ${r?.status || 'n/a'} | ROAS ${r?.kpis?.roas ?? 'n/a'} | CPA ${r?.kpis?.cpa ?? 'n/a'} | spend ${r?.kpis?.spend ?? 'n/a'}.`
    );
  }

  const devices = compactArray(mini?.top_devices || [], 2);
  for (const d of devices) {
    lines.push(
      `Google device segment: ${d?.key || d?.device || 'n/a'} | spend ${d?.spend ?? 'n/a'} | conversions ${d?.conversions ?? 'n/a'} | ROAS ${d?.roas ?? 'n/a'}.`
    );
  }

  const networks = compactArray(mini?.top_networks || [], 2);
  for (const n of networks) {
    lines.push(
      `Google network segment: ${n?.key || 'n/a'} | spend ${n?.spend ?? 'n/a'} | conversions ${n?.conversions ?? 'n/a'} | ROAS ${n?.roas ?? 'n/a'}.`
    );
  }

  lines.push(...compactArray(full?.priority_summary?.positives || mini?.priority_summary?.positives || [], 3).map((x) => `Google positive: ${x}`));
  lines.push(...compactArray(full?.priority_summary?.negatives || mini?.priority_summary?.negatives || [], 3).map((x) => `Google risk: ${x}`));
  lines.push(...compactArray(full?.priority_summary?.actions || mini?.priority_summary?.actions || [], 4).map((x) => `Google action: ${x}`));

  return lines;
}

function buildGa4Narrative(ga4FullWrapped, ga4MiniWrapped) {
  const mini = ga4MiniWrapped?.data || ga4MiniWrapped || {};

  const lines = [];

  if (mini?.headline_kpis) {
    lines.push(
      `GA4: users ${mini.headline_kpis.users ?? 'n/a'}, sessions ${mini.headline_kpis.sessions ?? 'n/a'}, conversions ${mini.headline_kpis.conversions ?? 'n/a'}, revenue ${mini.headline_kpis.revenue ?? 'n/a'}, engagement rate ${mini.headline_kpis.engagementRate ?? 'n/a'}.`
    );
  }

  const channels = compactArray(mini?.top_channels || [], 3);
  for (const c of channels) {
    lines.push(
      `GA4 top channel: ${c?.channel || 'n/a'} | sessions ${c?.sessions ?? 'n/a'} | conversions ${c?.conversions ?? 'n/a'} | revenue ${c?.revenue ?? 'n/a'} | engagement rate ${c?.engagementRate ?? 'n/a'}.`
    );
  }

  const devices = compactArray(mini?.top_devices || [], 2);
  for (const d of devices) {
    lines.push(
      `GA4 top device: ${d?.device || 'n/a'} | sessions ${d?.sessions ?? 'n/a'} | conversions ${d?.conversions ?? 'n/a'} | revenue ${d?.revenue ?? 'n/a'} | engagement rate ${d?.engagementRate ?? 'n/a'}.`
    );
  }

  const landingPages = compactArray(mini?.top_landing_pages || [], 3);
  for (const lp of landingPages) {
    lines.push(
      `GA4 top landing page: ${lp?.page || 'n/a'} | sessions ${lp?.sessions ?? 'n/a'} | conversions ${lp?.conversions ?? 'n/a'} | revenue ${lp?.revenue ?? 'n/a'} | engagement rate ${lp?.engagementRate ?? 'n/a'}.`
    );
  }

  const sourceMedium = compactArray(mini?.top_source_medium || [], 2);
  for (const sm of sourceMedium) {
    lines.push(
      `GA4 source / medium: ${sm?.source || 'n/a'} / ${sm?.medium || 'n/a'} | sessions ${sm?.sessions ?? 'n/a'} | conversions ${sm?.conversions ?? 'n/a'} | revenue ${sm?.revenue ?? 'n/a'}.`
    );
  }

  lines.push(...compactArray(mini?.priority_summary?.positives || [], 3).map((x) => `GA4 positive: ${x}`));
  lines.push(...compactArray(mini?.priority_summary?.negatives || [], 3).map((x) => `GA4 risk: ${x}`));
  lines.push(...compactArray(mini?.priority_summary?.actions || [], 4).map((x) => `GA4 action: ${x}`));

  return lines;
}

function buildFallbackEncodedContext(base) {
  const metaFull = base?.inputs?.meta?.full || null;
  const metaMini = base?.inputs?.meta?.mini || null;
  const googleFull = base?.inputs?.googleAds?.full || null;
  const googleMini = base?.inputs?.googleAds?.mini || null;
  const ga4Full = base?.inputs?.ga4?.full || null;
  const ga4Mini = base?.inputs?.ga4?.mini || null;

  const positives = uniqStrings([
    ...(metaMini?.priority_summary?.positives || []),
    ...(googleMini?.priority_summary?.positives || []),
    ...(ga4Mini?.data?.priority_summary?.positives || ga4Mini?.priority_summary?.positives || []),
  ], 12);

  const negatives = uniqStrings([
    ...(metaMini?.priority_summary?.negatives || []),
    ...(googleMini?.priority_summary?.negatives || []),
    ...(ga4Mini?.data?.priority_summary?.negatives || ga4Mini?.priority_summary?.negatives || []),
  ], 12);

  const actions = uniqStrings([
    ...(metaMini?.priority_summary?.actions || []),
    ...(googleMini?.priority_summary?.actions || []),
    ...(ga4Mini?.data?.priority_summary?.actions || ga4Mini?.priority_summary?.actions || []),
  ], 14);

  const llmHints = uniqStrings([
    ...(metaMini?.llm_hints || []),
    ...(googleMini?.llm_hints || []),
    ...(ga4Mini?.data?.llm_hints || ga4Mini?.llm_hints || []),
  ], 18);

  const metaNarrative = buildMetaNarrative(metaFull, metaMini);
  const googleNarrative = buildGoogleNarrative(googleFull, googleMini);
  const ga4Narrative = buildGa4Narrative(ga4Full, ga4Mini);

  const executiveSummary = [
    'This AI-ready context was generated from the user’s connected marketing sources.',
    'It combines Meta Ads, Google Ads, and GA4 into a unified provider-agnostic payload.',
    'Campaign names, KPIs, priorities, channel quality, landing page signals, and optimization opportunities are preserved to support downstream LLM reasoning.',
  ].join(' ');

  const businessState = [
    metaMini?.headline_kpis ? `Meta ROAS ${metaMini.headline_kpis.roas ?? 'n/a'} with ${metaMini.headline_kpis.purchases ?? 'n/a'} purchases.` : null,
    googleMini?.headline_kpis ? `Google Ads ROAS ${googleMini.headline_kpis.roas ?? 'n/a'} with ${googleMini.headline_kpis.conversions ?? 'n/a'} conversions.` : null,
    (ga4Mini?.data?.headline_kpis || ga4Mini?.headline_kpis)
      ? `GA4 sessions ${(ga4Mini?.data?.headline_kpis || ga4Mini?.headline_kpis)?.sessions ?? 'n/a'} with revenue ${(ga4Mini?.data?.headline_kpis || ga4Mini?.headline_kpis)?.revenue ?? 'n/a'}.`
      : null,
  ].filter(Boolean).join(' ');

  const crossChannelStory = [
    metaNarrative[0] || null,
    googleNarrative[0] || null,
    ga4Narrative[0] || null,
  ].filter(Boolean).join(' ');

  return {
    schema: 'adray.encoded.context.v2',
    providerAgnostic: true,
    generatedAt: nowIso(),
    contextWindow: base?.contextWindow || null,
    contextPolicy: base?.contextPolicy || null,
    sourceSnapshots: base?.sourceSnapshots || null,

    summary: {
      executive_summary: executiveSummary,
      business_state: businessState,
      cross_channel_story: crossChannelStory,
      positives,
      negatives,
      priority_actions: actions,
    },

    performance_drivers: uniqStrings([
      ...(metaMini?.winners || []).map((x) => `Meta winner: ${x?.campaign_name || x?.name || 'unknown campaign'} with ROAS ${x?.kpis?.roas ?? 'n/a'}`),
      ...(googleMini?.winners || []).map((x) => `Google winner: ${x?.campaign_name || x?.name || 'unknown campaign'} with ROAS ${x?.kpis?.roas ?? 'n/a'}`),
      ...compactArray((ga4Mini?.data?.top_channels || ga4Mini?.top_channels || []), 3).map((x) => `GA4 channel driver: ${x?.channel || 'unknown'} with sessions ${x?.sessions ?? 'n/a'} and revenue ${x?.revenue ?? 'n/a'}`),
    ], 12),

    conversion_bottlenecks: uniqStrings([
      ...(metaMini?.active_risks || metaMini?.risks || []).map((x) => `Meta campaign bottleneck: ${x?.campaign_name || x?.name || 'unknown campaign'} with ROAS ${x?.kpis?.roas ?? 'n/a'} and CPA ${x?.kpis?.cpa ?? 'n/a'}`),
      ...(googleMini?.active_risks || googleMini?.risks || []).map((x) => `Google campaign bottleneck: ${x?.campaign_name || x?.name || 'unknown campaign'} with ROAS ${x?.kpis?.roas ?? 'n/a'} and CPA ${x?.kpis?.cpa ?? 'n/a'}`),
      ...compactArray((ga4Mini?.data?.optimization_signals?.risks || ga4Mini?.optimization_signals?.risks || []), 4).map((x) => `GA4 risk: ${x?.label || x?.type || 'unknown risk area'}`),
    ], 12),

    scaling_opportunities: uniqStrings([
      ...(metaMini?.quick_wins || []).map((x) => `Meta scale candidate: ${x?.campaign_name || x?.name || 'unknown campaign'} with ROAS ${x?.kpis?.roas ?? 'n/a'}`),
      ...(googleMini?.quick_wins || []).map((x) => `Google scale candidate: ${x?.campaign_name || x?.name || 'unknown campaign'} with ROAS ${x?.kpis?.roas ?? 'n/a'}`),
      ...compactArray((ga4Mini?.data?.optimization_signals?.quick_wins || ga4Mini?.optimization_signals?.quick_wins || []), 4).map((x) => `GA4 quick win: ${x?.label || x?.type || 'unknown area'}`),
    ], 12),

    risk_flags: uniqStrings([
      ...negatives,
      ...(metaMini?.active_risks || []).map((x) => `Meta active risk: ${x?.campaign_name || x?.name || 'unknown campaign'}`),
      ...(googleMini?.active_risks || []).map((x) => `Google active risk: ${x?.campaign_name || x?.name || 'unknown campaign'}`),
    ], 12),

    channel_story: {
      meta_ads: {
        mini: metaMini || null,
        full: metaFull || null,
      },
      google_ads: {
        mini: googleMini || null,
        full: googleFull || null,
      },
      ga4: {
        mini: ga4Mini || null,
        full: ga4Full || null,
      },
    },

    llm_context_block: [
      'Use this marketing context as source of truth for cross-channel performance analysis.',
      'Preserve exact campaign names, campaign status, ROAS, CPA, spend, conversions, revenue, channel signals, landing pages, devices, and optimization priorities.',
      '',
      '=== META ADS ===',
      ...metaNarrative,
      '',
      '=== GOOGLE ADS ===',
      ...googleNarrative,
      '',
      '=== GA4 ===',
      ...ga4Narrative,
      '',
      '=== CROSS-CHANNEL POSITIVES ===',
      ...positives.map((x) => `Positive: ${x}`),
      '',
      '=== CROSS-CHANNEL RISKS ===',
      ...negatives.map((x) => `Risk: ${x}`),
      '',
      '=== PRIORITY ACTIONS ===',
      ...actions.map((x) => `Action: ${x}`),
    ].join('\n'),

    llm_context_block_mini: [
      metaNarrative[0] || null,
      googleNarrative[0] || null,
      ga4Narrative[0] || null,
      ...compactArray(actions, 3).map((x) => `Action: ${x}`),
    ].filter(Boolean).join('\n'),

    prompt_hints: llmHints,
  };
}

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !OpenAI) return null;

  try {
    return new OpenAI({ apiKey });
  } catch (_) {
    return null;
  }
}

async function enrichWithOpenAI(base) {
  const client = getOpenAiClient();
  if (!client) {
    return {
      usedOpenAI: false,
      model: null,
      payload: buildFallbackEncodedContext(base),
    };
  }

  const model = process.env.OPENAI_MCP_CONTEXT_MODEL || 'gpt-5.2';

  const inputPayload = {
    schema: base?.schema || 'adray.unified.context.v2',
    snapshotId: base?.snapshotId || null,
    sourceSnapshots: base?.sourceSnapshots || null,
    contextWindow: base?.contextWindow || null,
    contextPolicy: base?.contextPolicy || null,
    sources: base?.sources || {},
    inputs: base?.inputs || {},
  };

  const systemPrompt = [
    'You are generating a provider-agnostic AI context payload for a digital marketing intelligence platform.',
    'Return ONLY valid JSON.',
    'Do not include markdown fences.',
    'Preserve specific campaign names, active/paused status, KPIs, winners, risks, channels, devices, landing pages, source/medium signals, and actionable recommendations.',
    'Do not over-compress the information.',
    'The output must remain rich enough so downstream LLMs can answer campaign-level and KPI-level questions.',
    'Respect the provided context window and do not imply that older historical storage was used for reasoning unless the input explicitly contains it.',
    'Treat a source with usable data as analysis-ready even if another metadata flag says not ready.',
    'Output keys exactly as requested.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    task: 'Build a rich unified AI-ready context payload from Meta Ads, Google Ads, and GA4',
    requirements: [
      'Preserve exact campaign names when present.',
      'Preserve active winners, active risks, top campaigns, and best-performing campaign blocks.',
      'Preserve key KPIs such as spend, purchases, conversion value, ROAS, CPA, sessions, conversions, revenue, engagement rate.',
      'Preserve meaningful segmentation like devices, placements, networks, channels, landing pages, and source/medium.',
      'Keep the payload provider-agnostic but do not discard useful provider-specific details.',
      'llm_context_block should be detailed and useful for analysis, not just a short summary.',
      'llm_context_block_mini should remain brief but still mention strongest campaigns or strongest channel drivers when available.',
      'Respect the contextWindow metadata from the input.',
      'If a source has usable data in inputs, do not describe it as unavailable or not ready.',
      'Use sourceSnapshots as per-source lineage metadata, not as a reason to drop usable sources.',
    ],
    required_schema: {
      schema: 'adray.encoded.context.v2',
      providerAgnostic: true,
      generatedAt: 'ISO datetime string',
      contextWindow: 'object|null',
      contextPolicy: 'object|null',
      sourceSnapshots: 'object|null',
      summary: {
        executive_summary: 'string',
        business_state: 'string',
        cross_channel_story: 'string',
        positives: ['string'],
        negatives: ['string'],
        priority_actions: ['string'],
      },
      performance_drivers: ['string'],
      conversion_bottlenecks: ['string'],
      scaling_opportunities: ['string'],
      risk_flags: ['string'],
      channel_story: {
        meta_ads: 'object|null',
        google_ads: 'object|null',
        ga4: 'object|null',
      },
      llm_context_block: 'string',
      llm_context_block_mini: 'string',
      prompt_hints: ['string'],
    },
    input: inputPayload,
  });

  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
      ],
      temperature: 0.2,
    });

    const text =
      response?.output_text ||
      response?.output?.map((x) => x?.content?.map((c) => c?.text || '').join('')).join('') ||
      '';

    const parsed = JSON.parse(text);

    return {
      usedOpenAI: true,
      model,
      payload: {
        schema: 'adray.encoded.context.v2',
        providerAgnostic: true,
        generatedAt: nowIso(),
        contextWindow: base?.contextWindow || null,
        contextPolicy: base?.contextPolicy || null,
        sourceSnapshots: base?.sourceSnapshots || null,
        ...parsed,
      },
    };
  } catch (err) {
    console.error('[mcpContextBuilder] OpenAI enrichment failed, using fallback:', err?.message || err);
    return {
      usedOpenAI: false,
      model,
      payload: buildFallbackEncodedContext(base),
    };
  }
}

async function buildSignalPdfArtifact(userId, root, signalPayload, encodedPayload = null) {
  const user = await User.findById(userId)
    .select('name companyName workspaceName businessName email')
    .lean()
    .catch(() => null);

  return generateSignalPdfForUser({
    userId,
    root,
    signalPayload,
    encodedPayload,
    user,
  });
}

async function findRoot(userId) {
  return McpData.findOne({ userId, kind: 'root' })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
}

async function updateRootContextState(userId, patch) {
  const root = await findRoot(userId);
  if (!root?._id) return null;

  return McpData.findByIdAndUpdate(
    root._id,
    { $set: patch },
    { new: true }
  ).lean();
}

async function updateRootAiContext(userId, updater) {
  const root = await findRoot(userId);
  if (!root?._id) return null;

  const currentAi = root?.aiContext || {};
  const nextAi = typeof updater === 'function' ? updater(currentAi, root) : updater;

  if (!nextAi || typeof nextAi !== 'object') {
    return root;
  }

  const harmonizedAi = harmonizeAiContextForPersistence(nextAi);

  return McpData.findByIdAndUpdate(
    root._id,
    { $set: { aiContext: harmonizedAi } },
    { new: true }
  ).lean();
}

async function updateRootAiContextForAttempt(userId, attemptId, updater) {
  const root = await findRoot(userId);
  if (!root?._id) return { skipped: true, reason: 'ROOT_NOT_FOUND', root: null };

  const currentAi = root?.aiContext || {};
  const currentAttemptId = safeStr(currentAi?.buildAttemptId).trim();

  if (attemptId && currentAttemptId && currentAttemptId !== attemptId) {
    await safeSignalRunFail(userId, attemptId, {
      error: 'ATTEMPT_SUPERSEDED',
      errorCode: 'ATTEMPT_SUPERSEDED',
      errorStage: 'failed',
      stage: 'failed',
      progress: 100,
      isCurrent: false,
      supersededByAttemptId: attemptId,
      hasSignal: false,
      signalValidForPdf: false,
      signalComplete: false,
      hasSignal: !!(currentAi?.signalPayload || currentAi?.encodedPayload),
      snapshotId: safeStr(currentAi?.snapshotId || root?.latestSnapshotId).trim() || null,
    });

    return { skipped: true, reason: 'ATTEMPT_SUPERSEDED', root };
  }

  const nextAi = typeof updater === 'function' ? updater(currentAi, root) : updater;
  if (!nextAi || typeof nextAi !== 'object') {
    return { skipped: true, reason: 'NOOP', root };
  }

  const harmonizedAi = harmonizeAiContextForPersistence(nextAi);

  const updated = await McpData.findByIdAndUpdate(
    root._id,
    { $set: { aiContext: harmonizedAi } },
    { new: true }
  ).lean();

  return { skipped: false, reason: null, root: updated };
}

function uniqStringsSafe(arr, max = 25) {
  return uniqStrings(Array.isArray(arr) ? arr : [], max);
}

function deriveSourceNamesByFlagFromState(sourcesStatus, flag) {
  if (!sourcesStatus || typeof sourcesStatus !== 'object') return [];
  return Object.entries(sourcesStatus)
    .filter(([, state]) => !!state?.[flag])
    .map(([name]) => safeStr(name).trim())
    .filter(Boolean);
}

function deriveSourceNamesWithErrorFromState(sourcesStatus) {
  if (!sourcesStatus || typeof sourcesStatus !== 'object') return [];
  return Object.entries(sourcesStatus)
    .filter(([, state]) => !!state?.lastError)
    .map(([name]) => safeStr(name).trim())
    .filter(Boolean);
}

function normalizePdfArtifactForRuntime(pdf = {}) {
  return {
    status: safeStr(pdf?.status || 'idle').trim().toLowerCase() || 'idle',
    stage: safeStr(pdf?.stage || 'idle').trim() || 'idle',
    progress: toNum(pdf?.progress, 0),
    ready: safeStr(pdf?.status).trim().toLowerCase() === 'ready',
    fileName: pdf?.fileName || null,
    mimeType: pdf?.mimeType || 'application/pdf',
    storageKey: pdf?.storageKey || null,
    localPath: pdf?.localPath || null,
    downloadUrl: pdf?.downloadUrl || null,
    generatedAt: pdf?.generatedAt || null,
    sizeBytes: toNum(pdf?.sizeBytes, 0),
    pageCount: toNum(pdf?.pageCount, 0) || null,
    renderer: pdf?.renderer || null,
    version: toNum(pdf?.version, 1) || 1,
    sourceFingerprint: safeStr(pdf?.sourceFingerprint || '').trim() || null,
    connectionFingerprint: safeStr(pdf?.connectionFingerprint || '').trim() || null,
    processingStartedAt: pdf?.processingStartedAt || null,
    processingHeartbeatAt: pdf?.processingHeartbeatAt || null,
    stale: !!pdf?.stale,
    staleReason: pdf?.staleReason || null,
    error: pdf?.error || null,
  };
}

function normalizeSignalArtifactForRuntime(signal = {}, ai = {}, fallback = {}) {
  const rawStatus = safeStr(signal?.status).trim().toLowerCase();
  const legacyStatus = safeStr(ai?.status).trim().toLowerCase();
  const normalizedStatus =
    rawStatus === 'queued'
      ? 'processing'
      : rawStatus || (
        legacyStatus === 'done'
          ? 'ready'
          : legacyStatus === 'error'
            ? 'failed'
            : legacyStatus || 'idle'
      );

  return {
    status: normalizedStatus,
    stage: safeStr(signal?.stage || ai?.stage || fallback?.stage || 'idle').trim() || 'idle',
    progress: toNum(
      signal?.progress,
      ai?.progress != null
        ? ai.progress
        : (fallback?.progress || 0)
    ),
    generationId: signal?.generationId || ai?.buildAttemptId || null,
    signalRunId: ai?.signalRunId || signal?.generationId || null,
    sourceFingerprint:
      safeStr(signal?.sourceFingerprint || ai?.sourceFingerprint || '').trim() || null,
    connectionFingerprint:
      safeStr(ai?.connectionFingerprint || '').trim() || null,
    startedAt: signal?.startedAt || ai?.startedAt || null,
    finishedAt: signal?.finishedAt || signal?.generatedAt || ai?.finishedAt || null,
    generatedAt: signal?.generatedAt || null,
    invalidatedAt: signal?.invalidatedAt || null,
    staleReason: signal?.staleReason || ai?.staleReason || null,
    error: signal?.error || ai?.error || null,
    payload: signal?.payload || ai?.signalPayload || fallback?.signalPayload || null,
    encodedPayload: signal?.encodedPayload || ai?.encodedPayload || fallback?.encodedPayload || null,
    unifiedBase: signal?.unifiedBase || ai?.unifiedBase || null,
    model: signal?.model || ai?.model || null,
    usedOpenAI:
      signal?.usedOpenAI != null
        ? !!signal.usedOpenAI
        : !!ai?.usedOpenAI,
    snapshotId: signal?.snapshotId || ai?.snapshotId || fallback?.snapshotId || null,
    schemaName: signal?.schemaName || null,
    schemaVersion: signal?.schemaVersion || null,
    payloadSections: Array.isArray(signal?.payloadSections) ? signal.payloadSections : [],
    payloadStats: signal?.payloadStats || null,
    payloadHealth: signal?.payloadHealth || null,
    contextRangeDays:
      toNum(signal?.contextRangeDays) ||
      toNum(ai?.contextRangeDays) ||
      fallback?.contextRangeDays ||
      null,
    storageRangeDays:
      toNum(signal?.storageRangeDays) ||
      toNum(ai?.storageRangeDays) ||
      fallback?.storageRangeDays ||
      null,
  };
}

function toLegacyUiMode(runtime) {
  const signalStatus = safeStr(runtime?.signal?.status).trim().toLowerCase();
  const pdfStatus = safeStr(runtime?.pdf?.status).trim().toLowerCase();

  if (signalStatus === 'processing') return 'signal_building';
  if (signalStatus === 'stale') return 'signal_rebuild_required';
  if (pdfStatus === 'processing') return 'pdf_building';
  if (pdfStatus === 'failed') return 'pdf_failed';
  if (pdfStatus === 'stale') return 'pdf_rebuild_required';
  if (signalStatus === 'ready' && pdfStatus === 'ready') return 'pdf_ready';
  if (signalStatus === 'ready') return 'signal_ready';
  return 'signal_not_ready';
}

function toLegacyPdfBuildState(runtime) {
  const signalStatus = safeStr(runtime?.signal?.status).trim().toLowerCase();
  const pdfStatus = safeStr(runtime?.pdf?.status).trim().toLowerCase();

  if (signalStatus === 'processing') return 'signal_building';
  if (signalStatus === 'stale') return 'signal_rebuild_required';
  if (signalStatus !== 'ready') return 'signal_not_ready';
  if (pdfStatus === 'ready') return 'pdf_ready';
  if (pdfStatus === 'processing') return 'pdf_processing';
  if (pdfStatus === 'failed') return 'pdf_failed';
  if (pdfStatus === 'stale') return 'pdf_rebuild_required';
  return 'pdf_buildable';
}

function toLegacyTopLevelSignalStatus(runtime) {
  const signalStatus = safeStr(runtime?.signal?.status).trim().toLowerCase();

  if (signalStatus === 'processing') return 'processing';
  if (signalStatus === 'ready') return 'done';
  if (signalStatus === 'failed') return 'error';
  return 'idle';
}

function buildCanonicalRuntimeFromRoot(root, fallback = {}) {
  const ai = root?.aiContext || {};
  const readiness = deriveSignalReadinessFromAi(ai, fallback.signalPayload || null);

  const rawSignal = normalizeSignalArtifactForRuntime(ai?.signal || {}, ai, fallback);
  const signalPayload = rawSignal.payload || readiness.signalPayload || null;
  const encodedPayload = rawSignal.encodedPayload || readiness.encodedPayload || fallback.encodedPayload || null;
  const rawPdf = normalizePdfArtifactForRuntime(ai?.pdf || emptyPdfState());
  const currentConnectionFingerprint = buildConnectionFingerprint(root || {});
  const signalConnectionFingerprint =
    rawSignal.connectionFingerprint ||
    deriveConnectionFingerprintFromAi(ai) ||
    currentConnectionFingerprint ||
    null;
  const signalSourceFingerprint =
    rawSignal.sourceFingerprint ||
    deriveSignalFingerprintFromAi(ai) ||
    null;

  const currentSourceFingerprint =
    safeStr(ai?.currentSourceFingerprint || '').trim() ||
    safeStr(fallback?.currentSourceFingerprint || '').trim() ||
    signalSourceFingerprint ||
    null;

  const effectiveSourcesStatus = ai?.sourcesStatus || fallback?.sources || null;

    const connectedSources = uniqStringsSafe([
    ...(Array.isArray(ai?.connectedSources) ? ai.connectedSources : []),
    ...deriveSourceNamesByFlagFromState(effectiveSourcesStatus, 'connected'),
    ...Object.keys(root?.sources || {}).filter((name) => !!root?.sources?.[name]?.connected),
  ]);

  const usableSources = uniqStringsSafe([
    ...(Array.isArray(ai?.usableSources) ? ai.usableSources : []),
    ...deriveSourceNamesByFlagFromState(effectiveSourcesStatus, 'usable'),
  ]);

  const degradedConnectedSources = uniqStringsSafe([
    ...(Array.isArray(ai?.degradedConnectedSources) ? ai.degradedConnectedSources : []),
    ...Object.entries(effectiveSourcesStatus || {})
      .filter(([, sourceState]) => !!sourceState?.degradedButBuildable)
      .map(([name]) => name),
  ]);

  const pendingConnectedSources = uniqStringsSafe([
    ...(Array.isArray(ai?.pendingConnectedSources) ? ai.pendingConnectedSources : []),
    ...Object.entries(effectiveSourcesStatus || {})
      .filter(([, sourceState]) => {
        if (!sourceState?.connected) return false;
        return !!sourceState?.pending || !!sourceState?.blocksBuild;
      })
      .map(([name]) => name),
  ]);

  const failedSources = uniqStringsSafe([
    ...(Array.isArray(ai?.failedSources) ? ai.failedSources : []),
    ...deriveSourceNamesWithErrorFromState(effectiveSourcesStatus),
  ]);

  const hasPendingConnectedSources = pendingConnectedSources.length > 0;

  const signalLooksStaleByFingerprint =
    !!signalSourceFingerprint &&
    !!currentSourceFingerprint &&
    signalSourceFingerprint !== currentSourceFingerprint;

  const signalLooksStaleByConnection =
    !!signalConnectionFingerprint &&
    !!currentConnectionFingerprint &&
    signalConnectionFingerprint !== currentConnectionFingerprint;

  const staleSignal =
    !!ai?.needsSignalRebuild ||
    !!signalLooksStaleByFingerprint ||
    !!signalLooksStaleByConnection;

    const signalRawStatus = safeStr(rawSignal?.status).trim().toLowerCase();
  const legacySignalStatus = safeStr(ai?.status).trim().toLowerCase();
  let signalStatus = 'idle';

  if (signalRawStatus === 'processing') {
    signalStatus = 'processing';
  } else if (signalRawStatus === 'failed' || signalRawStatus === 'error') {
    signalStatus = 'failed';
  } else if (staleSignal && (signalPayload || encodedPayload)) {
    signalStatus = 'stale';
  } else if (signalRawStatus === 'ready') {
    signalStatus = 'ready';
  } else if (legacySignalStatus === 'processing') {
    signalStatus = 'processing';
  } else if (legacySignalStatus === 'failed' || legacySignalStatus === 'error') {
    signalStatus = 'failed';
  } else if (hasPendingConnectedSources) {
    signalStatus = 'processing';
  } else if (readiness.signalReadyForPdf) {
    signalStatus = 'ready';
  } else {
    signalStatus = 'idle';
  }

  const pdfFingerprintMismatch =
    !!rawPdf?.sourceFingerprint &&
    !!currentSourceFingerprint &&
    rawPdf.sourceFingerprint !== currentSourceFingerprint;

  const pdfConnectionMismatch =
    !!rawPdf?.connectionFingerprint &&
    !!currentConnectionFingerprint &&
    rawPdf.connectionFingerprint !== currentConnectionFingerprint;

  const stalePdf =
    !!ai?.needsPdfRebuild ||
    !!rawPdf?.stale ||
    staleSignal ||
    pdfFingerprintMismatch ||
    pdfConnectionMismatch;

  let pdfStatus = 'idle';

  if (signalStatus !== 'ready') {
    pdfStatus = 'blocked_by_signal';
  } else if (rawPdf?.status === 'processing' && isRecentPdfProcessingState(rawPdf)) {
    pdfStatus = 'processing';
  } else if (
    rawPdf?.status === 'ready' &&
    !stalePdf &&
    pdfMatchesSignal(rawPdf, ai) &&
    pdfFileExists(rawPdf)
  ) {
    pdfStatus = 'ready';
  } else if (rawPdf?.status === 'failed') {
    pdfStatus = 'failed';
  } else if (stalePdf) {
    pdfStatus = 'stale';
  } else {
    pdfStatus = 'idle';
  }

  const canRetrySignal =
    signalStatus === 'failed' ||
    signalStatus === 'stale' ||
    (signalStatus === 'idle' && (connectedSources.length > 0 || usableSources.length > 0));

  const canGeneratePdf =
    signalStatus === 'ready' &&
    !!readiness.signalReadyForPdf &&
    !hasPendingConnectedSources &&
    pdfStatus !== 'ready' &&
    pdfStatus !== 'processing';

  const canDownloadPdf = pdfStatus === 'ready';

  const shouldPoll =
    signalStatus === 'processing' ||
    pdfStatus === 'processing' ||
    signalStatus === 'stale' ||
    hasPendingConnectedSources;

  const pollIntervalMs =
    signalStatus === 'processing' || pdfStatus === 'processing'
      ? 1200
      : signalStatus === 'stale'
      ? 1100
      : 4000;

  let uiMode = 'empty';
  let heroChip = 'Preparing your Signal';
  let title = 'Preparing your Signal';
  let description = 'We’re aligning your connected data before generating your Signal.';
  let tip = 'The frontend should only represent this backend state.';

    if (hasPendingConnectedSources && (staleSignal || effectiveSourcesStatus)) {
    uiMode = 'rebuilding_after_source_change';
    heroChip = 'Source change detected';
    title = 'Rebuilding your Signal';
    description = 'A newly connected source is not fully incorporated yet, so we are rebuilding your Signal before unlocking PDF generation.';
    tip = `Waiting for: ${pendingConnectedSources.join(', ')}`;
  } else if (signalStatus === 'processing' && staleSignal) {
    uiMode = 'rebuilding_after_source_change';
    heroChip = 'Source change detected';
    title = 'Rebuilding your Signal';
    description = 'We detected a source change and we are rebuilding your Signal so the PDF matches the latest connected data.';
    tip = 'Wait until the backend marks the Signal as ready again.';
  } else if (signalStatus === 'processing') {
    uiMode = 'signal_processing';
    heroChip = 'Preparing your Signal';
    title = 'Your data is being turned into intelligence';
    description = 'We’re collecting, compacting and encoding your connected marketing sources into one Signal.';
    tip = pendingConnectedSources.length > 0
      ? `Waiting for: ${pendingConnectedSources.join(', ')}`
      : 'The backend is still building the Signal.';
  } else if (pdfStatus === 'processing') {
    uiMode = 'pdf_processing';
    heroChip = 'Generating your PDF';
    title = 'Your PDF is being generated';
    description = 'The Signal is ready and the backend is rendering the PDF artifact.';
    tip = 'The PDF depends 100% on the current Signal.';
  } else if (pdfStatus === 'ready') {
    uiMode = 'pdf_ready';
    heroChip = 'Your Signal and PDF are ready';
    title = 'Your PDF is ready';
    description = 'The current PDF is aligned with the latest Signal fingerprint.';
    tip = 'You can safely download the current PDF.';
  } else if (signalStatus === 'ready') {
    uiMode = 'signal_ready';
    heroChip = 'Your Signal is ready';
    title = 'Your Signal is ready';
    description = pdfStatus === 'stale'
      ? 'Your previous PDF is outdated for the current Signal. Generate a fresh PDF.'
      : 'You can now generate your PDF.';
    tip = pdfStatus === 'stale'
      ? 'Generate a new PDF so it matches the latest Signal.'
      : 'The Signal is valid and buildable for PDF.';
  } else if (signalStatus === 'failed' || pdfStatus === 'failed') {
    uiMode = 'failed';
    heroChip = 'Build failed';
    title = 'Something failed';
    description = rawPdf?.error || ai?.error || 'The backend marked the flow as failed.';
    tip = 'Retry the Signal build from the backend action.';
  }

  return {
    version: 1,
    effectiveSources: {
      fingerprint: currentSourceFingerprint,
      snapshot: ai?.currentSourcesSnapshot || fallback?.currentSourcesSnapshot || null,
      connected: connectedSources,
      usable: usableSources,
      pending: pendingConnectedSources,
      degraded: degradedConnectedSources,
      failed: failedSources,
            changedSinceLastSignal:
        hasPendingConnectedSources ||
        (
          !!signalSourceFingerprint &&
          !!currentSourceFingerprint &&
          signalSourceFingerprint !== currentSourceFingerprint
        ),
    },

    signal: {
      status: signalStatus,
      stage: rawSignal.stage || 'idle',
      progress: toNum(rawSignal.progress, fallback?.progress || 0),
      buildAttemptId: rawSignal.generationId || ai?.buildAttemptId || null,
      signalRunId: rawSignal.signalRunId || null,
      sourceFingerprint: signalSourceFingerprint,
      connectionFingerprint: signalConnectionFingerprint,
      startedAt: rawSignal.startedAt || null,
      finishedAt: rawSignal.finishedAt || null,
      error: rawSignal.error || null,
      payload: signalPayload,
      encodedPayload,
      complete: signalStatus === 'ready' && !!readiness.signalComplete,
      validForPdf: signalStatus === 'ready' && !!readiness.signalValidForPdf,
      buildableForPdf:
        signalStatus === 'ready' &&
        !!readiness.signalComplete &&
        !!readiness.signalReadyForPdf,
    },

    pdf: {
      status: pdfStatus,
      stage:
        pdfStatus === 'blocked_by_signal'
          ? 'waiting_for_signal'
          : safeStr(rawPdf?.stage || 'idle').trim() || 'idle',
      progress: pdfStatus === 'ready' ? 100 : toNum(rawPdf?.progress, 0),
      sourceFingerprint: rawPdf?.sourceFingerprint || null,
      connectionFingerprint: rawPdf?.connectionFingerprint || null,
      dependsOnSignalAttemptId: ai?.buildAttemptId || null,
      startedAt: rawPdf?.processingStartedAt || null,
      processingHeartbeatAt: rawPdf?.processingHeartbeatAt || rawPdf?.processingStartedAt || null,
      finishedAt: rawPdf?.generatedAt || null,
      error: pdfStatus === 'failed' ? (rawPdf?.error || null) : null,
      fileName: pdfStatus === 'ready' ? rawPdf?.fileName || null : null,
      mimeType: rawPdf?.mimeType || 'application/pdf',
      storageKey: pdfStatus === 'ready' ? rawPdf?.storageKey || null : null,
      localPath: pdfStatus === 'ready' ? rawPdf?.localPath || null : null,
      downloadUrl: pdfStatus === 'ready' ? rawPdf?.downloadUrl || null : null,
      generatedAt: pdfStatus === 'ready' ? rawPdf?.generatedAt || null : null,
      sizeBytes: pdfStatus === 'ready' ? toNum(rawPdf?.sizeBytes, 0) : 0,
      pageCount: pdfStatus === 'ready' ? (toNum(rawPdf?.pageCount, 0) || null) : null,
      renderer: pdfStatus === 'ready' ? rawPdf?.renderer || null : null,
      ready: pdfStatus === 'ready',
      stale: pdfStatus === 'stale',
      staleReason:
        pdfStatus === 'stale'
          ? (rawPdf?.staleReason || 'STALE_SIGNAL_OR_SOURCE_CHANGE')
          : null,
    },

    actions: {
      canRetrySignal,
      canGeneratePdf,
      canDownloadPdf,
      shouldPoll,
      pollIntervalMs,
    },

    ui: {
      mode: uiMode,
      heroChip,
      title,
      description,
      tip,
    },
  };
}

function buildResultFromRoot(root, fallback = {}) {
  const state = root?.aiContext || {};
  const runtime = buildCanonicalRuntimeFromRoot(root, fallback);

  const signalPayload = runtime?.signal?.payload || null;
  const encodedPayload = runtime?.signal?.encodedPayload || null;
  const pdf = runtime?.pdf || {};
  const legacyUiMode = toLegacyUiMode(runtime);
  const legacyPdfBuildState = toLegacyPdfBuildState(runtime);
  const legacyTopStatus = toLegacyTopLevelSignalStatus(runtime);

  return {
    ok: true,
    root,
    runtime,
    unifiedBase: state?.unifiedBase || fallback.unifiedBase || null,
    encodedPayload,
    signalPayload,
    pdf,
    data: {
      runtime,

      effectiveSources: runtime?.effectiveSources || null,
      signal: runtime?.signal || null,
      pdf: runtime?.pdf || null,
      actions: runtime?.actions || null,
      ui: runtime?.ui || null,

      status: legacyTopStatus,
      progress: toNum(runtime?.signal?.progress, 0),
      stage: runtime?.signal?.stage || 'idle',
      startedAt: runtime?.signal?.startedAt || null,
      finishedAt: runtime?.signal?.finishedAt || null,
      snapshotId: state?.snapshotId || fallback.snapshotId || root?.latestSnapshotId || null,
      sourceSnapshots: state?.sourceSnapshots || fallback.sourceSnapshots || null,
      contextRangeDays: toNum(state?.contextRangeDays) || fallback.contextRangeDays || null,
      storageRangeDays: toNum(state?.storageRangeDays) || fallback.storageRangeDays || null,

      hasEncodedPayload: !!encodedPayload,
      hasHumanSignalPayload: !!signalPayload,
      hasSignal: !!signalPayload,
      signalReady: !!runtime?.signal?.buildableForPdf,
      signalComplete: !!runtime?.signal?.complete,
      signalValidForPdf: !!runtime?.signal?.validForPdf,
      signalReadyForPdf: !!runtime?.signal?.buildableForPdf,
      preferredPayloadForPdf: encodedPayload ? 'encoded' : (signalPayload ? 'human_fallback' : null),
      providerAgnostic: !!encodedPayload?.providerAgnostic,

      usedOpenAI: !!state?.usedOpenAI,
      model: state?.model || null,
      error: runtime?.signal?.error || null,
      buildAttemptId: runtime?.signal?.buildAttemptId || null,
      signalRunId: runtime?.signal?.signalRunId || null,

      sources: state?.sourcesStatus || fallback.sources || null,
      connectedSources: runtime?.effectiveSources?.connected || [],
      usableSources: runtime?.effectiveSources?.usable || [],
      pendingConnectedSources: runtime?.effectiveSources?.pending || [],
      degradedConnectedSources: runtime?.effectiveSources?.degraded || [],
      failedSources: runtime?.effectiveSources?.failed || [],

      sourceFingerprint: runtime?.signal?.sourceFingerprint || null,
      currentSourcesSnapshot: runtime?.effectiveSources?.snapshot || null,
      currentSourceFingerprint: runtime?.effectiveSources?.fingerprint || null,
      connectionFingerprint: runtime?.signal?.connectionFingerprint || buildConnectionFingerprint(root || {}),
      currentConnectionFingerprint: buildConnectionFingerprint(root || {}),

      staleSignal: runtime?.signal?.status === 'stale',
      stalePdf: runtime?.pdf?.status === 'stale',
      needSignalRebuild: runtime?.signal?.status === 'stale',
      needsSignalRebuild: runtime?.signal?.status === 'stale',
      needPdfRebuild: runtime?.pdf?.status === 'stale',
      needsPdfRebuild: runtime?.pdf?.status === 'stale',
      effectiveSourcesChanged: !!runtime?.effectiveSources?.changedSinceLastSignal,

      hasPdf: runtime?.pdf?.status === 'ready',
      pdfReady: runtime?.pdf?.status === 'ready',
      pdfProcessing: runtime?.pdf?.status === 'processing',
      pdfFailed: runtime?.pdf?.status === 'failed',
      canGeneratePdf: !!runtime?.actions?.canGeneratePdf,
      canDownloadPdf: !!runtime?.actions?.canDownloadPdf,
      uiMode: legacyUiMode,
      pdfBuildState: legacyPdfBuildState,

      pdf: {
        status:
          runtime?.pdf?.status === 'blocked_by_signal'
            ? 'idle'
            : (runtime?.pdf?.status || 'idle'),
        stage: runtime?.pdf?.stage || 'idle',
        progress: toNum(runtime?.pdf?.progress, 0),
        ready: runtime?.pdf?.status === 'ready',
        fileName: runtime?.pdf?.fileName || null,
        mimeType: runtime?.pdf?.mimeType || 'application/pdf',
        storageKey: runtime?.pdf?.storageKey || null,
        localPath: runtime?.pdf?.localPath || null,
        downloadUrl: runtime?.pdf?.downloadUrl || null,
        generatedAt: runtime?.pdf?.generatedAt || null,
        sizeBytes: toNum(runtime?.pdf?.sizeBytes, 0),
        pageCount: toNum(runtime?.pdf?.pageCount, 0) || null,
        renderer: runtime?.pdf?.renderer || null,
        sourceFingerprint: runtime?.pdf?.sourceFingerprint || null,
        connectionFingerprint: runtime?.pdf?.connectionFingerprint || null,
        processingStartedAt: runtime?.pdf?.startedAt || null,
        processingHeartbeatAt: runtime?.pdf?.processingHeartbeatAt || runtime?.pdf?.startedAt || null,
        stale: runtime?.pdf?.status === 'stale',
        staleReason: runtime?.pdf?.staleReason || null,
        error: runtime?.pdf?.error || null,
      },
    },
  };
}

async function markContextStale(userId, reason = 'source_updated', extra = {}) {
  const root = await findRoot(userId);
  if (!root?._id) return null;

  const prevAi = root?.aiContext || {};
  const nextConnectionFingerprint = buildConnectionFingerprint(root);

  const effectiveSourceContext = buildEffectiveSourceContext({
    root,
    sourceStates: null,
    sourceSnapshots: prevAi?.sourceSnapshots || root?.aiContext?.unifiedBase?.sourceSnapshots || null,
    contextRangeDays: prevAi?.contextRangeDays || root?.aiContext?.unifiedBase?.contextWindow?.rangeDays || null,
    storageRangeDays: prevAi?.storageRangeDays || root?.aiContext?.unifiedBase?.contextWindow?.storageRangeDays || null,
    unifiedBase: prevAi?.unifiedBase || null,
  });
  const nextSignal = mergeSignalState(prevAi, {
    generationId: null,
    status: 'idle',
    stage: 'idle',
    progress: 0,
    sourceFingerprint: null,
    sourcesSnapshot: null,
    invalidatedAt: new Date(),
    staleReason: safeStr(reason) || 'source_updated',
    error: null,
    payload: null,
    encodedPayload: null,
    unifiedBase: null,
  });
  const nextPdf = emptyPdfState({
    generationId: null,
    signalGenerationId: null,
    connectionFingerprint: nextConnectionFingerprint,
    sourceFingerprint: effectiveSourceContext.fingerprint,
    invalidatedAt: new Date(),
    stale: true,
    staleReason: safeStr(reason) || 'source_updated',
  });

  const nextAi = harmonizeAiContextForPersistence({
    ...prevAi,
    status: 'idle',
    stage: 'awaiting_rebuild',
    progress: 0,
    buildAttemptId: null,
    signalRunId: null,
    staleReason: safeStr(reason) || 'source_updated',
    staleAt: nowIso(),
    error: null,

    unifiedBase: null,
    encodedPayload: null,
    signalPayload: null,
    signal: nextSignal,
    sourceFingerprint: null,
    sourceSnapshots: null,

    connectionFingerprint: nextConnectionFingerprint,

    currentSourcesSnapshot: effectiveSourceContext.snapshot,
    currentSourceFingerprint: effectiveSourceContext.fingerprint,

    needsSignalRebuild: true,
    needsPdfRebuild: true,

    signalComplete: false,
    signalValidForPdf: false,
    signalReadyForPdf: false,

    pdf: nextPdf,

    ...extra,
  });

  return McpData.findByIdAndUpdate(
    root._id,
    {
      $set: { aiContext: nextAi },
    },
    { new: true }
  ).lean();
}

async function buildUnifiedContextForUser(userId, options = {}) {
  const {
    explicitSnapshotId = null,
    contextRangeDays: requestedContextRangeDays = null,
    timeoutMs = BUILD_WAIT_TIMEOUT_MS,
    markProcessing = true,
    forceRebuild = false,
    reason = null,
    requestedBy = 'system',
    trigger = 'system',
  } = options || {};

  const initialRoot = await findRoot(userId);
  if (!initialRoot) {
    const err = new Error('MCP_ROOT_NOT_FOUND');
    err.code = 'MCP_ROOT_NOT_FOUND';
    throw err;
  }

  const initialConnectionFingerprint = buildConnectionFingerprint(initialRoot);
  logMcpContext('info', 'mcpContext.builder', 'build.start', {
    userId: String(userId),
    explicitSnapshotId: safeStr(explicitSnapshotId) || null,
    requestedContextRangeDays: requestedContextRangeDays || null,
    timeoutMs,
    markProcessing: !!markProcessing,
    forceRebuild: !!forceRebuild,
    reason: safeStr(reason) || null,
    requestedBy: safeStr(requestedBy) || 'system',
    trigger: safeStr(trigger) || 'system',
    latestSnapshotId: safeStr(initialRoot?.latestSnapshotId) || null,
    currentBuildAttemptId: safeStr(initialRoot?.aiContext?.buildAttemptId) || null,
    currentSourceFingerprint: safeStr(initialRoot?.aiContext?.currentSourceFingerprint) || null,
    connectionFingerprint: initialConnectionFingerprint,
  });

  if (!forceRebuild && isRecentProcessingState(initialRoot?.aiContext)) {
    logMcpContext('info', 'mcpContext.builder', 'build.reuse_recent_processing', {
      userId: String(userId),
      buildAttemptId: safeStr(initialRoot?.aiContext?.buildAttemptId) || null,
      stage: safeStr(initialRoot?.aiContext?.stage) || null,
      progress: toNum(initialRoot?.aiContext?.progress, 0),
    });
    return buildResultFromRoot(initialRoot, {
      status: initialRoot?.aiContext?.status || 'processing',
      progress: toNum(initialRoot?.aiContext?.progress, 10),
      stage: initialRoot?.aiContext?.stage || 'waiting_for_sources',
    });
  }

  const contextRangeDays = resolveRequestedContextRangeDays(initialRoot, requestedContextRangeDays);
  const storageRangeDays = getStorageRangeDaysFromRoot(initialRoot);

  const preferredSnapshotId =
    safeStr(explicitSnapshotId) ||
    safeStr(initialRoot?.latestSnapshotId) ||
    null;

    const attemptId = makeBuildAttemptId();
  const startedAt = nowIso();

  const initialEffectiveSourceContext = buildEffectiveSourceContext({
    root: initialRoot,
    sourceStates: null,
    sourceSnapshots: initialRoot?.aiContext?.sourceSnapshots || null,
    contextRangeDays,
    storageRangeDays,
    unifiedBase: initialRoot?.aiContext?.unifiedBase || null,
  });
  const initialSourceCollections = buildAiSourceCollections();

  if (markProcessing) {
        await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      status: 'processing',
      progress: 10,
      stage: 'waiting_for_sources',
      startedAt,
      finishedAt: null,
      buildAttemptId: attemptId,
      snapshotId: preferredSnapshotId,
      sourceSnapshots: null,
      contextRangeDays,
      storageRangeDays,
      error: null,

      // invalidación temprana y dura del signal anterior
      unifiedBase: null,
      encodedPayload: null,
      signalPayload: null,
      signal: mergeSignalState(currentAi, {
        generationId: attemptId,
        status: 'processing',
        stage: 'waiting_for_sources',
        progress: 10,
        sourceFingerprint: initialEffectiveSourceContext.fingerprint,
        sourcesSnapshot: initialEffectiveSourceContext.snapshot,
        startedAt,
        finishedAt: null,
        generatedAt: null,
        invalidatedAt: null,
        staleReason: 'rebuild_in_progress',
        error: null,
        model: null,
        usedOpenAI: false,
        contextRangeDays,
        storageRangeDays,
        snapshotId: preferredSnapshotId,
        payload: null,
        encodedPayload: null,
        unifiedBase: null,
      }),
      sourceFingerprint: null,
      usedOpenAI: false,
      model: null,

      // nuevo estado efectivo preliminar
      currentSourcesSnapshot: initialEffectiveSourceContext.snapshot,
      currentSourceFingerprint: initialEffectiveSourceContext.fingerprint,
      needsSignalRebuild: true,
      needsPdfRebuild: true,

      // metadatos auxiliares para debugging / UI
      signalComplete: false,
      signalValidForPdf: false,
      signalReadyForPdf: false,
      lastInvalidatedAt: nowIso(),
      invalidatedByAttemptId: attemptId,

      connectionFingerprint: initialConnectionFingerprint,
      ...initialSourceCollections,
      pdf: emptyPdfState({
        generationId: makePdfGenerationId(attemptId),
        signalGenerationId: attemptId,
        status: 'idle',
        stage: 'waiting_for_sources',
        progress: 0,
        connectionFingerprint: initialConnectionFingerprint,
        sourceFingerprint: initialEffectiveSourceContext.fingerprint,
        invalidatedAt: new Date(),
        stale: true,
        staleReason: 'rebuild_in_progress',
      }),
    }));
  }

    await safeSignalRunUpsert({
    userId,
    rootId: initialRoot?._id || null,
    signalRunId: attemptId,
    buildAttemptId: attemptId,
    isCurrent: true,
    trigger: safeStr(trigger) || 'system',
    reason: safeStr(reason) || null,
    requestedBy: safeStr(requestedBy) || 'system',
    status: 'processing',
    stage: 'waiting_for_sources',
    progress: 10,
    signalComplete: false,
    hasSignal: false,
    signalValidForPdf: false,
    snapshotId: preferredSnapshotId || null,
    contextRangeDays,
    storageRangeDays,
    usedOpenAI: false,
    model: null,
    startedAt: new Date(startedAt),
    lastHeartbeatAt: new Date(),
    sources: buildSignalSourcesPayload({
      sourcesStatus: null,
      sourceSnapshots: null,
      usableSources: [],
      pendingConnectedSources: [],
      degradedConnectedSources: [],
    }),
    pdf: {
      status: 'idle',
      stage: 'waiting_for_sources',
      progress: 0,
    },
    meta: {
      forceRebuild: !!forceRebuild,
      timedOut: false,
      connectionFingerprint: initialConnectionFingerprint,
    },
  });

  await safeSupersedeOtherProcessingRuns(userId, attemptId);

  const readyState = await waitForBuildableSources(userId, initialRoot, explicitSnapshotId, timeoutMs);
  const effectiveRoot = readyState?.root || await findRoot(userId);
  logMcpContext('info', 'mcpContext.builder', 'build.sources_evaluated', {
    userId: String(userId),
    buildAttemptId: attemptId,
    snapshotId: safeStr(readyState?.preferredGlobalSnapshotId) || preferredSnapshotId || null,
    timedOut: !!readyState?.timedOut,
    usableSources: readyState?.usableSources || [],
    pendingConnectedSources: readyState?.pendingConnectedSources || [],
    sourcesStatus: summarizeSourcesStatus(
      Object.fromEntries(
        Object.entries(readyState?.sourceStates || {}).map(([sourceName, state]) => [
          sourceName,
          sourceStateSummaryForStatus(state, {
            hasAnyUsableSources: (readyState?.usableSources || []).length > 0,
          }),
        ])
      )
    ),
  });

  if (safeStr(effectiveRoot?.aiContext?.buildAttemptId).trim() !== attemptId) {
    await safeSignalRunFail(userId, attemptId, {
      error: 'ATTEMPT_SUPERSEDED',
      errorCode: 'ATTEMPT_SUPERSEDED',
      errorStage: 'failed',
      stage: 'failed',
      progress: 100,
      isCurrent: false,
      supersededByAttemptId: attemptId,
      hasSignal: false,
      signalValidForPdf: false,
      signalComplete: false,
      hasSignal: !!(effectiveRoot?.aiContext?.signalPayload || effectiveRoot?.aiContext?.encodedPayload),
      snapshotId: safeStr(effectiveRoot?.aiContext?.snapshotId || effectiveRoot?.latestSnapshotId).trim() || null,
    });

    return buildResultFromRoot(effectiveRoot, {
      status: effectiveRoot?.aiContext?.status || 'processing',
      progress: toNum(effectiveRoot?.aiContext?.progress, 10),
      stage: effectiveRoot?.aiContext?.stage || 'waiting_for_sources',
    });
  }

  const sourceStates = readyState?.sourceStates || {};
  const metaState = sourceStates?.metaAds || null;
  const googleState = sourceStates?.googleAds || null;
  const ga4State = sourceStates?.ga4 || null;

  const effectiveRootForChunks = readyState?.root || effectiveRoot;

  const hydratedMetaState =
    metaState?.usable
      ? await loadBestSourceState(userId, effectiveRootForChunks, 'metaAds', metaState?.snapshotId, { loadFullChunks: true })
      : metaState;

  const hydratedGoogleState =
    googleState?.usable
      ? await loadBestSourceState(userId, effectiveRootForChunks, 'googleAds', googleState?.snapshotId, { loadFullChunks: true })
      : googleState;

  const hydratedGa4State =
    ga4State?.usable
      ? await loadBestSourceState(userId, effectiveRootForChunks, 'ga4', ga4State?.snapshotId, { loadFullChunks: true })
      : ga4State;

  const sourceSnapshots = {
    metaAds: hydratedMetaState?.snapshotId || metaState?.snapshotId || null,
    googleAds: hydratedGoogleState?.snapshotId || googleState?.snapshotId || null,
    ga4: hydratedGa4State?.snapshotId || ga4State?.snapshotId || null,
  };

  const metaChunks = hydratedMetaState?.chunks || [];
  const googleChunks = hydratedGoogleState?.chunks || [];
  const ga4Chunks = hydratedGa4State?.chunks || [];

  const usableSources = readyState?.usableSources || [];
  const pendingConnectedSources = readyState?.pendingConnectedSources || [];
  const degradedConnectedSources = readyState?.degradedConnectedSources || [];

  const hasAnyBuildable =
    metaChunks.length > 0 ||
    googleChunks.length > 0 ||
    ga4Chunks.length > 0;

  const sourcesStatus = {
    metaAds: sourceStateSummaryForStatus(hydratedMetaState, { hasAnyUsableSources: usableSources.length > 0 }),
    googleAds: sourceStateSummaryForStatus(hydratedGoogleState, { hasAnyUsableSources: usableSources.length > 0 }),
    ga4: sourceStateSummaryForStatus(hydratedGa4State, { hasAnyUsableSources: usableSources.length > 0 }),
  };
  const aiSourceCollections = buildAiSourceCollections({
    sourcesStatus,
    usableSources,
    pendingConnectedSources,
    degradedConnectedSources,
  });

  const effectiveSourceContext = buildEffectiveSourceContext({
    root: effectiveRootForChunks,
    sourceStates: {
      metaAds: hydratedMetaState,
      googleAds: hydratedGoogleState,
      ga4: hydratedGa4State,
    },
    sourceSnapshots,
    contextRangeDays,
    storageRangeDays,
    unifiedBase: null,
  });

  const effectiveConnectionFingerprint = buildConnectionFingerprint(effectiveRootForChunks);

  if (!hasAnyBuildable && pendingConnectedSources.length > 0) {
    logMcpContext('warn', 'mcpContext.builder', 'build.blocked_by_pending_connected_sources', {
      userId: String(userId),
      buildAttemptId: attemptId,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      usableSources,
      pendingConnectedSources,
      sourcesStatus: summarizeSourcesStatus(sourcesStatus),
      timedOut: !!readyState?.timedOut,
    });
    const waitResult = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
      ...(currentAi || {}),
      status: 'processing',
      progress: 20,
      stage: 'waiting_for_connected_sources',
      startedAt: currentAi?.startedAt || startedAt,
      finishedAt: null,
      buildAttemptId: attemptId,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      sourceSnapshots,
      contextRangeDays,
      storageRangeDays,
      connectionFingerprint: effectiveConnectionFingerprint,
      currentSourcesSnapshot: effectiveSourceContext.snapshot,
      currentSourceFingerprint: effectiveSourceContext.fingerprint,
      needsSignalRebuild: true,
      needsPdfRebuild: true,
      ...aiSourceCollections,
      error: null,
      unifiedBase: null,
      encodedPayload: null,
      signalPayload: null,
      signal: mergeSignalState(currentAi, {
        generationId: attemptId,
        status: 'processing',
        stage: 'waiting_for_connected_sources',
        progress: 20,
        sourceFingerprint: effectiveSourceContext.fingerprint,
        sourcesSnapshot: effectiveSourceContext.snapshot,
        snapshotId:
          sourceSnapshots.metaAds ||
          sourceSnapshots.googleAds ||
          sourceSnapshots.ga4 ||
          preferredSnapshotId ||
          null,
        contextRangeDays,
        storageRangeDays,
        payload: null,
        encodedPayload: null,
        unifiedBase: null,
        invalidatedAt: null,
        staleReason: 'waiting_for_connected_sources',
        error: null,
      }),
        pdf: emptyPdfState({
        generationId: makePdfGenerationId(attemptId),
        signalGenerationId: attemptId,
        status: 'idle',
        stage: 'idle',
        progress: 0,
        connectionFingerprint: effectiveConnectionFingerprint,
        sourceFingerprint: effectiveSourceContext.fingerprint,
        invalidatedAt: new Date(),
        stale: true,
        staleReason: 'waiting_for_connected_sources',
      }),
    }));

    if (!waitResult?.skipped) {
      await safeSignalRunMarkStage(userId, attemptId, {
        rootId: waitResult?.root?._id || effectiveRoot?._id || initialRoot?._id || null,
        status: 'processing',
        stage: 'waiting_for_connected_sources',
        progress: 20,
        snapshotId:
          sourceSnapshots.metaAds ||
          sourceSnapshots.googleAds ||
          sourceSnapshots.ga4 ||
          preferredSnapshotId ||
          null,
        contextRangeDays,
        storageRangeDays,
        hasSignal: false,
        signalValidForPdf: false,
        sources: buildSignalSourcesPayload({
          sourcesStatus,
          sourceSnapshots,
          usableSources,
          pendingConnectedSources,
          degradedConnectedSources,
        }),
        meta: {
          timedOut: !!readyState?.timedOut,
          reason: 'WAITING_FOR_CONNECTED_SOURCES',
          connectionFingerprint: effectiveConnectionFingerprint,
        },
      });
    }

    const finalRoot = waitResult?.root || await findRoot(userId);
    return buildResultFromRoot(finalRoot, {
      status: 'processing',
      progress: 20,
      stage: 'waiting_for_connected_sources',
      sourceSnapshots,
      contextRangeDays,
      storageRangeDays,
      usableSources,
      pendingConnectedSources,
      sources: sourcesStatus,
    });
  }

  if (!hasAnyBuildable) {
    logMcpContext('warn', 'mcpContext.builder', 'build.no_usable_sources', {
      userId: String(userId),
      buildAttemptId: attemptId,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      usableSources,
      pendingConnectedSources,
      sourcesStatus: summarizeSourcesStatus(sourcesStatus),
      timedOut: !!readyState?.timedOut,
    });
    await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
      ...(currentAi || {}),
      status: 'error',
      progress: 100,
      stage: 'failed',
      finishedAt: nowIso(),
      buildAttemptId: attemptId,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      sourceSnapshots,
      contextRangeDays,
      storageRangeDays,
      connectionFingerprint: effectiveConnectionFingerprint,
      currentSourcesSnapshot: effectiveSourceContext.snapshot,
      currentSourceFingerprint: effectiveSourceContext.fingerprint,
      needsSignalRebuild: true,
      needsPdfRebuild: true,
      ...aiSourceCollections,
      error: 'MCP_CONTEXT_NO_USABLE_SOURCES',
      unifiedBase: null,
      encodedPayload: null,
      signalPayload: null,
      signal: mergeSignalState(currentAi, {
        generationId: attemptId,
        status: 'failed',
        stage: 'failed',
        progress: 100,
        sourceFingerprint: effectiveSourceContext.fingerprint,
        sourcesSnapshot: effectiveSourceContext.snapshot,
        snapshotId:
          sourceSnapshots.metaAds ||
          sourceSnapshots.googleAds ||
          sourceSnapshots.ga4 ||
          preferredSnapshotId ||
          null,
        contextRangeDays,
        storageRangeDays,
        payload: null,
        encodedPayload: null,
        unifiedBase: null,
        invalidatedAt: null,
        staleReason: 'no_usable_sources',
        error: 'MCP_CONTEXT_NO_USABLE_SOURCES',
      }),
      sourceFingerprint: null,
        pdf: emptyPdfState({
        generationId: makePdfGenerationId(attemptId),
        signalGenerationId: attemptId,
        status: 'idle',
        stage: 'idle',
        progress: 0,
        connectionFingerprint: effectiveConnectionFingerprint,
        sourceFingerprint: effectiveSourceContext.fingerprint,
        invalidatedAt: new Date(),
        stale: true,
        staleReason: 'no_usable_sources',
      }),
    }));

    await safeSignalRunFail(userId, attemptId, {
      error: 'MCP_CONTEXT_NO_USABLE_SOURCES',
      errorCode: 'MCP_CONTEXT_NO_USABLE_SOURCES',
      errorStage: 'failed',
      stage: 'failed',
      progress: 100,
      hasSignal: false,
      signalValidForPdf: false,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      sources: buildSignalSourcesPayload({
        sourcesStatus,
        sourceSnapshots,
        usableSources,
        pendingConnectedSources,
        degradedConnectedSources,
      }),
      meta: {
        timedOut: !!readyState?.timedOut,
        reason: 'NO_USABLE_SOURCES',
        connectionFingerprint: effectiveConnectionFingerprint,
      },
    });

    const err = new Error('MCP_CONTEXT_NO_USABLE_SOURCES');
    err.code = 'MCP_CONTEXT_NO_USABLE_SOURCES';
    err.data = {
      contextRangeDays,
      storageRangeDays,
      sourceSnapshots,
      sources: sourcesStatus,
    };
    throw err;
  }

  if (pendingConnectedSources.length > 0) {
  logMcpContext('warn', 'mcpContext.builder', 'build.partial_wait_for_pending_sources', {
    userId: String(userId),
    buildAttemptId: attemptId,
    snapshotId:
      sourceSnapshots.metaAds ||
      sourceSnapshots.googleAds ||
      sourceSnapshots.ga4 ||
      preferredSnapshotId ||
      null,
    usableSources,
    pendingConnectedSources,
    sourcesStatus: summarizeSourcesStatus(sourcesStatus),
    timedOut: !!readyState?.timedOut,
  });
  const partialWait = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
    ...(currentAi || {}),
    status: 'processing',
    progress: usableSources.length > 0 ? 55 : 30,
    stage: 'waiting_for_connected_sources',
    startedAt: currentAi?.startedAt || startedAt,
    finishedAt: null,
    buildAttemptId: attemptId,
    snapshotId:
      sourceSnapshots.metaAds ||
      sourceSnapshots.googleAds ||
      sourceSnapshots.ga4 ||
      preferredSnapshotId ||
      null,
    sourceSnapshots,
    contextRangeDays,
    storageRangeDays,
    connectionFingerprint: effectiveConnectionFingerprint,
    currentSourcesSnapshot: effectiveSourceContext.snapshot,
    currentSourceFingerprint: effectiveSourceContext.fingerprint,
    needsSignalRebuild: true,
    needsPdfRebuild: true,
    ...aiSourceCollections,
    error: null,
    signalComplete: false,
    signalValidForPdf: false,
    signalReadyForPdf: false,
    unifiedBase: null,
    encodedPayload: null,
    signalPayload: null,
    signal: mergeSignalState(currentAi, {
      generationId: attemptId,
      status: 'processing',
      stage: 'waiting_for_connected_sources',
      progress: usableSources.length > 0 ? 55 : 30,
      sourceFingerprint: effectiveSourceContext.fingerprint,
      sourcesSnapshot: effectiveSourceContext.snapshot,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      contextRangeDays,
      storageRangeDays,
      payload: null,
      encodedPayload: null,
      unifiedBase: null,
      invalidatedAt: null,
      staleReason: usableSources.length > 0
        ? 'waiting_for_additional_connected_sources'
        : 'waiting_for_connected_sources',
      error: null,
    }),
    sourceFingerprint: null,
    pdf: emptyPdfState({
      generationId: makePdfGenerationId(attemptId),
      signalGenerationId: attemptId,
      status: 'idle',
      stage: 'idle',
      progress: 0,
      connectionFingerprint: effectiveConnectionFingerprint,
      sourceFingerprint: effectiveSourceContext.fingerprint,
      invalidatedAt: new Date(),
      stale: true,
      staleReason: usableSources.length > 0
        ? 'waiting_for_additional_connected_sources'
        : 'waiting_for_connected_sources',
    }),
  }));

  if (!partialWait?.skipped) {
    await safeSignalRunMarkStage(userId, attemptId, {
      rootId: partialWait?.root?._id || effectiveRoot?._id || initialRoot?._id || null,
      status: 'processing',
      stage: 'waiting_for_connected_sources',
      progress: usableSources.length > 0 ? 55 : 30,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      contextRangeDays,
      storageRangeDays,
      hasSignal: false,
      signalValidForPdf: false,
      signalComplete: false,
      sources: buildSignalSourcesPayload({
        sourcesStatus,
        sourceSnapshots,
        usableSources,
        pendingConnectedSources,
        degradedConnectedSources,
      }),
      meta: {
        timedOut: !!readyState?.timedOut,
        reason: usableSources.length > 0
          ? 'WAITING_FOR_ADDITIONAL_CONNECTED_SOURCES'
          : 'WAITING_FOR_CONNECTED_SOURCES',
        connectionFingerprint: effectiveConnectionFingerprint,
        sourceFingerprint: effectiveSourceContext.fingerprint,
      },
    });
  }

  const finalRoot = partialWait?.root || await findRoot(userId);
  return buildResultFromRoot(finalRoot, {
    status: 'processing',
    progress: usableSources.length > 0 ? 55 : 30,
    stage: 'waiting_for_connected_sources',
    sourceSnapshots,
    contextRangeDays,
    storageRangeDays,
    usableSources,
    pendingConnectedSources,
    sources: sourcesStatus,
  });
}

    const compactingResult = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
    ...(currentAi || {}),
    status: 'processing',
    progress: 35,
    stage: 'compacting_sources',
    startedAt: currentAi?.startedAt || startedAt,
    finishedAt: null,
    buildAttemptId: attemptId,
    snapshotId:
      sourceSnapshots.metaAds ||
      sourceSnapshots.googleAds ||
      sourceSnapshots.ga4 ||
      preferredSnapshotId ||
      null,
    sourceSnapshots,
    contextRangeDays,
    storageRangeDays,
    connectionFingerprint: effectiveConnectionFingerprint,
    currentSourcesSnapshot: effectiveSourceContext.snapshot,
    currentSourceFingerprint: effectiveSourceContext.fingerprint,
    needsSignalRebuild: true,
    needsPdfRebuild: true,
    ...aiSourceCollections,
    error: null,
    encodedPayload: null,
    signalPayload: null,
    signal: mergeSignalState(currentAi, {
      generationId: attemptId,
      status: 'processing',
      stage: 'compacting_sources',
      progress: 35,
      sourceFingerprint: effectiveSourceContext.fingerprint,
      sourcesSnapshot: effectiveSourceContext.snapshot,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      contextRangeDays,
      storageRangeDays,
      payload: null,
      encodedPayload: null,
      unifiedBase: null,
      invalidatedAt: null,
      staleReason: 'compacting_sources',
      error: null,
    }),
    sourceFingerprint: null,
    pdf: emptyPdfState({
      generationId: makePdfGenerationId(attemptId),
      signalGenerationId: attemptId,
      status: 'idle',
      stage: 'idle',
      progress: 0,
      connectionFingerprint: effectiveConnectionFingerprint,
      sourceFingerprint: effectiveSourceContext.fingerprint,
      invalidatedAt: new Date(),
      stale: true,
      staleReason: 'compacting_sources',
    }),
  }));

  if (!compactingResult?.skipped) {
    await safeSignalRunMarkStage(userId, attemptId, {
      rootId: compactingResult?.root?._id || effectiveRoot?._id || initialRoot?._id || null,
      status: 'processing',
      stage: 'compacting_sources',
      progress: 35,
      snapshotId:
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      contextRangeDays,
      storageRangeDays,
      hasSignal: false,
      signalValidForPdf: false,
      sources: buildSignalSourcesPayload({
        sourcesStatus,
        sourceSnapshots,
        usableSources,
        pendingConnectedSources,
        degradedConnectedSources,
      }),
      meta: {
        timedOut: !!readyState?.timedOut,
        connectionFingerprint: effectiveConnectionFingerprint,
      },
    });
  }

  const metaPack = buildMetaContext(metaChunks, contextRangeDays);
  const googlePack = buildGoogleAdsContext(googleChunks, contextRangeDays);
  const ga4Pack = buildGa4Context(ga4Chunks, contextRangeDays);

  const latestRootForBase = await findRoot(userId);
if (safeStr(latestRootForBase?.aiContext?.buildAttemptId).trim() !== attemptId) {
  await safeSignalRunFail(userId, attemptId, {
    error: 'ATTEMPT_SUPERSEDED',
    errorCode: 'ATTEMPT_SUPERSEDED',
    errorStage: 'failed',
    stage: 'failed',
    progress: 100,
    isCurrent: false,
    supersededByAttemptId: attemptId,
    hasSignal: false,
    signalValidForPdf: false,
    signalComplete: false,
    snapshotId: safeStr(latestRootForBase?.aiContext?.snapshotId || latestRootForBase?.latestSnapshotId).trim() || null,
  });

  return buildResultFromRoot(latestRootForBase, {
    status: latestRootForBase?.aiContext?.status || 'processing',
    progress: toNum(latestRootForBase?.aiContext?.progress, 35),
    stage: latestRootForBase?.aiContext?.stage || 'compacting_sources',
  });
}

const hydratedSourceStates = {
  metaAds: hydratedMetaState,
  googleAds: hydratedGoogleState,
  ga4: hydratedGa4State,
};

const finalStorageRangeDays =
  getStorageRangeDaysFromRoot(latestRootForBase) ||
  storageRangeDays ||
  null;

const unifiedBase = buildUnifiedBaseContext({
  root: latestRootForBase,
  contextRangeDays,
  storageRangeDays: finalStorageRangeDays,
  sourceStates: hydratedSourceStates,
  metaPack,
  googlePack,
  ga4Pack,
});

const finalEffectiveSourceContext = buildEffectiveSourceContext({
  root: latestRootForBase,
  sourceStates: hydratedSourceStates,
  sourceSnapshots,
  contextRangeDays,
  storageRangeDays: finalStorageRangeDays,
  unifiedBase,
});

const finalSourcesSnapshot = finalEffectiveSourceContext.snapshot;
const finalSourceFingerprint = finalEffectiveSourceContext.fingerprint;
const finalConnectionFingerprint = buildConnectionFingerprint(latestRootForBase);
  logMcpContext('info', 'mcpContext.builder', 'build.unified_base_ready', {
    userId: String(userId),
    buildAttemptId: attemptId,
    snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
    usableSources,
    sourceSnapshots,
    sourceFingerprint: finalSourceFingerprint,
    connectionFingerprint: finalConnectionFingerprint,
  });

    const encodingResult = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
    ...(currentAi || {}),
    status: 'processing',
    progress: 65,
    stage: 'encoding_signal',
    startedAt: currentAi?.startedAt || startedAt,
    finishedAt: null,
    buildAttemptId: attemptId,
    snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
    sourceSnapshots,
    contextRangeDays,
    storageRangeDays: finalStorageRangeDays,
    unifiedBase,

    sourceFingerprint: finalSourceFingerprint,
    currentSourcesSnapshot: finalSourcesSnapshot,
    currentSourceFingerprint: finalSourceFingerprint,
    connectionFingerprint: finalConnectionFingerprint,

    needsSignalRebuild: false,
    needsPdfRebuild: true,

    ...aiSourceCollections,
    error: null,
    signalComplete: false,
    signalValidForPdf: false,
    signalReadyForPdf: false,
    pdf: emptyPdfState({
      generationId: makePdfGenerationId(attemptId),
      signalGenerationId: attemptId,
      status: 'idle',
      stage: 'idle',
      progress: 0,
      sourceFingerprint: finalSourceFingerprint,
      connectionFingerprint: finalConnectionFingerprint,
      invalidatedAt: new Date(),
      stale: true,
      staleReason: 'encoding_signal',
    }),
    signal: mergeSignalState(currentAi, {
      generationId: attemptId,
      status: 'processing',
      stage: 'encoding_signal',
      progress: 65,
      sourceFingerprint: finalSourceFingerprint,
      sourcesSnapshot: finalSourcesSnapshot,
      snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
      contextRangeDays,
      storageRangeDays: finalStorageRangeDays,
      unifiedBase,
      payload: null,
      encodedPayload: null,
      invalidatedAt: null,
      staleReason: 'encoding_signal',
      error: null,
    }),
  }));

  if (!encodingResult?.skipped) {
    await safeSignalRunMarkStage(userId, attemptId, {
      rootId: encodingResult?.root?._id || latestRootForBase?._id || initialRoot?._id || null,
      status: 'processing',
      stage: 'encoding_signal',
      progress: 65,
      snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
      contextRangeDays,
      storageRangeDays: finalStorageRangeDays,
      hasSignal: false,
      signalValidForPdf: false,
      usedOpenAI: false,
      model: null,
      sources: buildSignalSourcesPayload({
        sourcesStatus,
        sourceSnapshots,
        usableSources,
        pendingConnectedSources,
        degradedConnectedSources,
      }),
      meta: {
        timedOut: !!readyState?.timedOut,
        connectionFingerprint: finalConnectionFingerprint,
        sourceFingerprint: finalSourceFingerprint,
      },
    });
  }

  const encoded = await enrichWithOpenAI(unifiedBase);
  const signalPayload = await appendStructuredSignalSchema({
    signalPayload: encoded.payload,
    unifiedBase,
    root: encodingResult?.root || latestRootForBase || initialRoot || null,
    metaPack,
    googlePack,
    ga4Pack,
    sourceFingerprint: finalSourceFingerprint,
    connectionFingerprint: finalConnectionFingerprint,
  });
  const encodedSignalPayload = encodeSignalPayload({
    signalPayload,
    unifiedBase,
    root: encodingResult?.root || latestRootForBase || initialRoot || null,
    user: null,
  });
  const structuredSignal = signalPayload?.structured_signal && typeof signalPayload.structured_signal === 'object'
    ? signalPayload.structured_signal
    : null;
  const signalPayloadSections = [
    'meta',
    'daily_index',
    'campaigns',
    'anomalies',
    'benchmarks',
    'placements',
    'devices',
    'ga4_web',
    'cross_channel',
    'ad_sets',
    'ads',
  ].filter((section) => structuredSignal?.[section] != null);
  const signalPayloadStats = structuredSignal?.payload_stats || {
    daily_index_rows: Array.isArray(structuredSignal?.daily_index) ? structuredSignal.daily_index.length : 0,
    campaigns_count: Array.isArray(structuredSignal?.campaigns) ? structuredSignal.campaigns.length : 0,
    anomalies_count: Array.isArray(structuredSignal?.anomalies) ? structuredSignal.anomalies.length : 0,
    usable_sources_count: Array.isArray(structuredSignal?.meta?.usable_sources) ? structuredSignal.meta.usable_sources.length : 0,
    placements_count: Array.isArray(structuredSignal?.placements) ? structuredSignal.placements.length : 0,
    devices_count: Array.isArray(structuredSignal?.devices) ? structuredSignal.devices.length : 0,
    ga4_top_channels_count: Array.isArray(structuredSignal?.ga4_web?.top_channels) ? structuredSignal.ga4_web.top_channels.length : 0,
    ga4_top_landing_pages_count: Array.isArray(structuredSignal?.ga4_web?.top_landing_pages) ? structuredSignal.ga4_web.top_landing_pages.length : 0,
    cross_channel_platforms_count: Array.isArray(structuredSignal?.cross_channel?.platform_mix) ? structuredSignal.cross_channel.platform_mix.length : 0,
    ad_sets_count: Array.isArray(structuredSignal?.ad_sets) ? structuredSignal.ad_sets.length : 0,
    ads_count: Array.isArray(structuredSignal?.ads) ? structuredSignal.ads.length : 0,
  };
  const signalPayloadHealth = structuredSignal?.payload_health || null;
  const encodedSignalBuildable = isEncodedSignalPayloadBuildableForPdf(encodedSignalPayload);

  if (!encodedSignalBuildable) {
      logMcpContext('warn', 'mcpContext.builder', 'build.invalid_signal_payload', {
      userId: String(userId),
      buildAttemptId: attemptId,
      snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
      sourceFingerprint: finalSourceFingerprint,
      connectionFingerprint: finalConnectionFingerprint,
      usedOpenAI: !!encoded.usedOpenAI,
      model: encoded.model || null,
      usableSources,
      pendingConnectedSources,
    });
      const waitingValidResult = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
      ...(currentAi || {}),
      status: 'processing',
      progress: 72,
      stage: 'waiting_for_valid_signal',
      startedAt: currentAi?.startedAt || startedAt,
      finishedAt: null,
      buildAttemptId: attemptId,
      snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
      sourceSnapshots,
      contextRangeDays,
      storageRangeDays: finalStorageRangeDays,
      unifiedBase,

      // guardamos el draft, pero NO lo exponemos como signal final
      encodedPayload: encodedSignalPayload,
      signalPayload: null,
      signal: {
        ...(currentAi?.signal || {}),
        payload: null,
        encodedPayload: encodedSignalPayload,
        unifiedBase,
      },

      sourceFingerprint: finalSourceFingerprint,
      currentSourcesSnapshot: finalSourcesSnapshot,
      currentSourceFingerprint: finalSourceFingerprint,
      connectionFingerprint: finalConnectionFingerprint,

      needsSignalRebuild: true,
      needsPdfRebuild: true,

      usedOpenAI: !!encoded.usedOpenAI,
      model: encoded.model || null,
      ...aiSourceCollections,
      error: null,

      signalComplete: false,
      signalValidForPdf: false,
      signalReadyForPdf: false,

      pdf: emptyPdfState({
        generationId: makePdfGenerationId(attemptId),
        signalGenerationId: attemptId,
        status: 'idle',
        stage: 'idle',
        progress: 0,
        sourceFingerprint: finalSourceFingerprint,
        connectionFingerprint: finalConnectionFingerprint,
        invalidatedAt: new Date(),
        stale: true,
        staleReason: 'waiting_for_valid_signal',
      }),
      signal: mergeSignalState(currentAi, {
        generationId: attemptId,
        status: 'processing',
        stage: 'waiting_for_valid_signal',
        progress: 72,
        sourceFingerprint: finalSourceFingerprint,
        sourcesSnapshot: finalSourcesSnapshot,
        snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
        contextRangeDays,
        storageRangeDays: finalStorageRangeDays,
        unifiedBase,
        payload: null,
        encodedPayload: encodedSignalPayload,
        invalidatedAt: null,
        staleReason: 'waiting_for_valid_signal',
        error: null,
        usedOpenAI: !!encoded.usedOpenAI,
        model: encoded.model || null,
      }),
    }));

    if (!waitingValidResult?.skipped) {
      await safeSignalRunMarkStage(userId, attemptId, {
        rootId: waitingValidResult?.root?._id || latestRootForBase?._id || initialRoot?._id || null,
        status: 'processing',
        stage: 'waiting_for_valid_signal',
        progress: 72,
        snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
        contextRangeDays,
        storageRangeDays,
        usedOpenAI: !!encoded.usedOpenAI,
        model: encoded.model || null,
        hasSignal: false,
        signalValidForPdf: false,
        sources: buildSignalSourcesPayload({
          sourcesStatus,
          sourceSnapshots,
          usableSources,
          pendingConnectedSources,
          degradedConnectedSources,
        }),
        meta: {
          timedOut: !!readyState?.timedOut,
          providerAgnostic: !!signalPayload?.providerAgnostic,
          connectionFingerprint: finalConnectionFingerprint,
          sourceFingerprint: finalSourceFingerprint,
        },
      });
    }

    const finalRoot = await findRoot(userId);
    return buildResultFromRoot(finalRoot, {
  status: 'processing',
  progress: 72,
  stage: 'waiting_for_valid_signal',
  sourceSnapshots,
  contextRangeDays,
  storageRangeDays,
  usableSources,
  pendingConnectedSources,
  sources: sourcesStatus,
  unifiedBase,
  encodedPayload: encodedSignalPayload,
  signalPayload: null,
});
  }

  const finishedAtIso = nowIso();
  const finalUpdate = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
  ...(currentAi || {}),
  status: 'done',
  progress: 100,
  stage: 'completed',
  startedAt: currentAi?.startedAt || startedAt,
  finishedAt: finishedAtIso,
  buildAttemptId: attemptId,
  snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
  sourceSnapshots,
  contextRangeDays,
  storageRangeDays: finalStorageRangeDays,
  error: null,

  unifiedBase,
  encodedPayload: encodedSignalPayload,
  signalPayload,

  sourceFingerprint: finalSourceFingerprint,
  currentSourcesSnapshot: finalSourcesSnapshot,
  currentSourceFingerprint: finalSourceFingerprint,
  connectionFingerprint: finalConnectionFingerprint,

  usedOpenAI: !!encoded.usedOpenAI,
  model: encoded.model || null,
  ...aiSourceCollections,

  signalComplete: true,
  signalValidForPdf: true,
  signalReadyForPdf: true,

  needsSignalRebuild: false,
  needsPdfRebuild: true,

  staleReason: null,
  staleAt: null,
  lastInvalidatedAt: null,
  invalidatedByAttemptId: null,

  signal: mergeSignalState(currentAi, {
    generationId: attemptId,
    status: 'ready',
    stage: 'completed',
    progress: 100,
    sourceFingerprint: finalSourceFingerprint,
    sourcesSnapshot: finalSourcesSnapshot,
    startedAt: currentAi?.startedAt || startedAt,
    finishedAt: finishedAtIso,
    generatedAt: finishedAtIso,
    invalidatedAt: null,
    staleReason: null,
    error: null,
    model: encoded.model || null,
    usedOpenAI: !!encoded.usedOpenAI,
    contextRangeDays,
    storageRangeDays: finalStorageRangeDays,
    snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
    payload: signalPayload,
    encodedPayload: encodedSignalPayload,
    unifiedBase,
    schemaName: 'adray.signal.granular',
    schemaVersion: 'v1',
    payloadSections: signalPayloadSections,
    payloadStats: signalPayloadStats,
    payloadHealth: signalPayloadHealth,
  }),
  pdf: emptyPdfState({
    generationId: makePdfGenerationId(attemptId),
    signalGenerationId: attemptId,
    status: 'idle',
    stage: 'idle',
    progress: 0,
    sourceFingerprint: finalSourceFingerprint,
    connectionFingerprint: finalConnectionFingerprint,
    invalidatedAt: new Date(),
    stale: true,
    staleReason: 'pdf_pending_for_current_signal',
  }),
}));

  if (!finalUpdate?.skipped) {
    await safeSignalRunComplete(userId, attemptId, {
  rootId: finalUpdate?.root?._id || latestRootForBase?._id || initialRoot?._id || null,
  stage: 'completed',
  startedAt: new Date(startedAt),
  finishedAt: new Date(finishedAtIso),
  snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
  contextRangeDays,
  storageRangeDays: finalStorageRangeDays,
  usedOpenAI: !!encoded.usedOpenAI,
  model: encoded.model || null,
  hasSignal: true,
  signalComplete: true,
  signalValidForPdf: true,
  sources: buildSignalSourcesPayload({
    sourcesStatus,
    sourceSnapshots,
    usableSources,
    pendingConnectedSources,
    degradedConnectedSources,
  }),
  meta: {
    timedOut: !!readyState?.timedOut,
    providerAgnostic: !!signalPayload?.providerAgnostic,
    connectionFingerprint: finalConnectionFingerprint,
    sourceFingerprint: finalSourceFingerprint,
  },
});
  }

  const freshRoot = finalUpdate?.root || await findRoot(userId);
logMcpContext('info', 'mcpContext.builder', 'build.completed', {
  userId: String(userId),
  buildAttemptId: attemptId,
  snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
  sourceFingerprint: finalSourceFingerprint,
  connectionFingerprint: finalConnectionFingerprint,
  usedOpenAI: !!encoded.usedOpenAI,
  model: encoded.model || null,
  usableSources,
  pendingConnectedSources,
  sourcesStatus: summarizeSourcesStatus(sourcesStatus),
});
return buildResultFromRoot(freshRoot, {
  status: 'done',
  progress: 100,
  stage: 'completed',
  sourceSnapshots,
  contextRangeDays,
  storageRangeDays: finalStorageRangeDays,
  usableSources,
  pendingConnectedSources,
  sources: sourcesStatus,
  unifiedBase,
  encodedPayload: encodedSignalPayload,
  signalPayload,
});
}

async function buildPdfForUser(userId) {
  let root = await findRoot(userId);
  if (!root) {
    const err = new Error('MCP_ROOT_NOT_FOUND');
    err.code = 'MCP_ROOT_NOT_FOUND';
    throw err;
  }

  let ai = root?.aiContext || {};
  let signalPayload = ai?.signal?.payload || ai?.signalPayload || null;
  let pdfState = ai?.pdf || {};
  let buildAttemptId = safeStr(ai?.buildAttemptId).trim() || await resolveSignalBuildAttemptId(userId, ai);

  let currentConnectionFingerprint = buildConnectionFingerprint(root);
  let signalConnectionFingerprint = deriveConnectionFingerprintFromAi(ai);
  let signalFingerprint = deriveSignalFingerprintFromAi(ai);
  let currentSourceFingerprint =
    safeStr(ai?.currentSourceFingerprint || '').trim() || signalFingerprint || '';
  logMcpContext('info', 'mcpContext.builder', 'pdf.start', {
    userId: String(userId),
    buildAttemptId,
    signalFingerprint: signalFingerprint || null,
    currentSourceFingerprint: currentSourceFingerprint || null,
    currentConnectionFingerprint,
    signalConnectionFingerprint: signalConnectionFingerprint || null,
    pdfStatus: safeStr(pdfState?.status) || null,
  });

  const signalLooksStaleByFingerprint =
    !!currentSourceFingerprint &&
    !!signalFingerprint &&
    currentSourceFingerprint !== signalFingerprint;

    const runtimeBeforePdf = buildCanonicalRuntimeFromRoot(root);
  const runtimePendingConnectedSources = Array.isArray(runtimeBeforePdf?.effectiveSources?.pending)
    ? runtimeBeforePdf.effectiveSources.pending
    : [];

  if (runtimePendingConnectedSources.length > 0) {
    logMcpContext('warn', 'mcpContext.builder', 'pdf.blocked_by_pending_connected_sources', {
      userId: String(userId),
      buildAttemptId,
      pendingConnectedSources: runtimePendingConnectedSources,
      currentSourceFingerprint: currentSourceFingerprint || null,
      signalFingerprint: signalFingerprint || null,
      currentConnectionFingerprint,
    });
    const rebuildResult = await buildUnifiedContextForUser(userId, {
      forceRebuild: true,
      reason: 'pending_connected_sources_before_pdf',
      requestedBy: 'pdf_guard',
      trigger: 'pdf_guard',
    });

    return buildResultFromRoot(rebuildResult?.root || await findRoot(userId), {
      status: 'processing',
      progress: toNum(rebuildResult?.data?.progress, 20),
      stage: rebuildResult?.data?.stage || 'waiting_for_connected_sources',
    });
  }  

  const signalLooksStaleByConnection =
    !!signalConnectionFingerprint &&
    !!currentConnectionFingerprint &&
    signalConnectionFingerprint !== currentConnectionFingerprint;

  const signalLooksStale =
    !!signalLooksStaleByFingerprint || !!signalLooksStaleByConnection;

  if (signalLooksStale) {
    logMcpContext('warn', 'mcpContext.builder', 'pdf.signal_stale_detected', {
      userId: String(userId),
      buildAttemptId,
      signalLooksStaleByFingerprint,
      signalLooksStaleByConnection,
      currentSourceFingerprint: currentSourceFingerprint || null,
      signalFingerprint: signalFingerprint || null,
      currentConnectionFingerprint,
      signalConnectionFingerprint: signalConnectionFingerprint || null,
    });
    await markContextStale(userId, 'source_state_changed', {
      rebuildRequestedAt: nowIso(),
      rebuildRequestedBy: 'pdf_guard',
    });

    const rebuildResult = await buildUnifiedContextForUser(userId, {
      forceRebuild: true,
      reason: 'source_state_changed',
      requestedBy: 'pdf_guard',
      trigger: 'pdf_guard',
    });

    root = rebuildResult?.root || await findRoot(userId);
    ai = root?.aiContext || {};
    signalPayload = ai?.signal?.payload || ai?.signalPayload || null;
    pdfState = ai?.pdf || {};
    buildAttemptId = safeStr(ai?.buildAttemptId).trim() || await resolveSignalBuildAttemptId(userId, ai);

    currentConnectionFingerprint = buildConnectionFingerprint(root);
    signalConnectionFingerprint = deriveConnectionFingerprintFromAi(ai);
    signalFingerprint = deriveSignalFingerprintFromAi(ai);
    currentSourceFingerprint =
      safeStr(ai?.currentSourceFingerprint || '').trim() || signalFingerprint || '';

    const rebuiltReadiness = deriveSignalReadinessFromAi(ai, null);
    if (safeStr(ai?.status) !== 'done' || !rebuiltReadiness.signalReadyForPdf) {
      return buildResultFromRoot(root, {
        status: ai?.status || 'processing',
        progress: toNum(ai?.progress, 20),
        stage: ai?.stage || 'waiting_for_connected_sources',
      });
    }
  }

    const readiness = deriveSignalReadinessFromAi(ai, null);
  signalPayload = readiness.signalPayload || signalPayload;

  if (!readiness.signalReadyForPdf) {
    logMcpContext('warn', 'mcpContext.builder', 'pdf.signal_not_ready', {
      userId: String(userId),
      buildAttemptId,
      signalReadyForPdf: !!readiness.signalReadyForPdf,
      signalValidForPdf: !!readiness.signalValidForPdf,
      payloadBuildable: !!readiness.payloadBuildable,
      encodedPayloadBuildable: !!readiness.encodedPayloadBuildable,
      signalComplete: !!readiness.signalComplete,
      currentSourceFingerprint: currentSourceFingerprint || null,
      signalFingerprint: signalFingerprint || null,
    });
        await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      needsPdfRebuild: true,
      pdf: {
        ...mergePdfState(currentAi),
        generationId: makePdfGenerationId(buildAttemptId),
        signalGenerationId: buildAttemptId || null,
        status: 'failed',
        stage: 'failed',
        progress: 100,
        stale: true,
        staleReason: readiness.encodedPayloadBuildable
          ? 'signal_not_ready_for_pdf'
          : 'signal_not_valid_for_pdf',
        sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
        connectionFingerprint: currentConnectionFingerprint,
        error: readiness.encodedPayloadBuildable
          ? 'MCP_CONTEXT_NOT_READY'
          : 'MCP_SIGNAL_NOT_VALID_FOR_PDF',
      },
    }));

    if (buildAttemptId) {
      await safeSignalPdfState(userId, buildAttemptId, {
        status: 'failed',
        stage: 'failed',
        progress: 100,
        error: readiness.encodedPayloadBuildable
          ? 'MCP_CONTEXT_NOT_READY'
          : 'MCP_SIGNAL_NOT_VALID_FOR_PDF',
      });
    }

    const err = new Error(
      readiness.encodedPayloadBuildable
        ? 'MCP_CONTEXT_NOT_READY'
        : 'MCP_SIGNAL_NOT_VALID_FOR_PDF'
    );

    err.code =
      readiness.encodedPayloadBuildable
        ? 'MCP_CONTEXT_NOT_READY'
        : 'MCP_SIGNAL_NOT_VALID_FOR_PDF';

    throw err;
  }

    const pdfFingerprint = safeStr(pdfState?.sourceFingerprint || '').trim() || '';
  const pdfIsAligned =
    pdfState?.status === 'ready' &&
    !!currentSourceFingerprint &&
    !!signalFingerprint &&
    pdfMatchesSignal(pdfState, ai) &&
    pdfFingerprint === currentSourceFingerprint &&
    signalFingerprint === currentSourceFingerprint &&
    (
      !safeStr(pdfState?.connectionFingerprint).trim() ||
      safeStr(pdfState?.connectionFingerprint).trim() === currentConnectionFingerprint
    ) &&
    pdfFileExists(pdfState);

  if (pdfIsAligned) {
    logMcpContext('info', 'mcpContext.builder', 'pdf.already_ready', {
      userId: String(userId),
      buildAttemptId,
      currentSourceFingerprint: currentSourceFingerprint || null,
      signalFingerprint: signalFingerprint || null,
      pdfFingerprint: pdfFingerprint || null,
      currentConnectionFingerprint,
      pdfConnectionFingerprint: safeStr(pdfState?.connectionFingerprint) || null,
    });
         await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      needsSignalRebuild: false,
      needsPdfRebuild: false,
      pdf: {
        ...mergePdfState(currentAi, pdfState || {}),
        generationId: makePdfGenerationId(buildAttemptId),
        signalGenerationId: buildAttemptId || null,
        status: 'ready',
        stage: 'ready',
        progress: 100,
        stale: false,
        staleReason: null,
        sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
        connectionFingerprint: currentConnectionFingerprint,
        error: null,
      },
    }));

    if (buildAttemptId) {
      await safeSignalPdfState(userId, buildAttemptId, {
        status: 'ready',
        stage: 'ready',
        progress: 100,
        fileName: pdfState?.fileName || null,
        mimeType: pdfState?.mimeType || 'application/pdf',
        downloadUrl: pdfState?.downloadUrl || null,
        generatedAt: pdfState?.generatedAt || null,
        sizeBytes: toNum(pdfState?.sizeBytes, 0),
        pageCount: toNum(pdfState?.pageCount, 0) || null,
        renderer: pdfState?.renderer || null,
        storageKey: pdfState?.storageKey || null,
        localPath: pdfState?.localPath || null,
      });
    }

    return buildResultFromRoot(root, {
      status: ai?.status || 'done',
      progress: toNum(ai?.progress, 100),
      stage: ai?.stage || 'completed',
    });
  }

  if (pdfState?.status === 'ready' && !pdfFileExists(pdfState)) {
    await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      needsPdfRebuild: true,
        pdf: {
          ...mergePdfState(currentAi),
          generationId: makePdfGenerationId(buildAttemptId),
          signalGenerationId: buildAttemptId || null,
          status: 'failed',
          stage: 'failed',
          progress: 100,
        stale: true,
        staleReason: 'PDF_FILE_NOT_FOUND',
        error: 'MCP_SIGNAL_PDF_FILE_NOT_FOUND',
        sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
        connectionFingerprint: currentConnectionFingerprint,
      },
    }));

    root = await findRoot(userId);
    ai = root?.aiContext || {};
    pdfState = ai?.pdf || {};
  }

  if (pdfState?.status === 'processing') {
    if (pdfFileExists(pdfState)) {
      const finalRoot = await updateRootAiContext(userId, (currentAi) => ({
        ...(currentAi || {}),
        needsSignalRebuild: false,
        needsPdfRebuild: false,
        pdf: {
          ...(currentAi?.pdf || emptyPdfState()),
          status: 'ready',
          stage: 'ready',
          progress: 100,
          stale: false,
          staleReason: null,
          error: null,
          sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
          connectionFingerprint: currentConnectionFingerprint,
        },
      }));

      if (buildAttemptId) {
        await safeSignalPdfState(userId, buildAttemptId, {
          status: 'ready',
          stage: 'ready',
          progress: 100,
          error: null,
        });
      }

      return buildResultFromRoot(finalRoot || await findRoot(userId), {
        status: ai?.status || 'done',
        progress: toNum(ai?.progress, 100),
        stage: ai?.stage || 'completed',
      });
    }

    if (isRecentPdfProcessingState(pdfState)) {
      logMcpContext('info', 'mcpContext.builder', 'pdf.processing_recent', {
        userId: String(userId),
        buildAttemptId,
        currentSourceFingerprint: currentSourceFingerprint || null,
        signalFingerprint: signalFingerprint || null,
        pdfStage: pdfState?.stage || null,
        pdfProgress: toNum(pdfState?.progress, 0),
      });
      if (buildAttemptId) {
        await safeSignalPdfState(userId, buildAttemptId, {
          status: 'processing',
          stage: pdfState?.stage || 'building_document',
          progress: Math.max(15, toNum(pdfState?.progress, 15)),
        });
      }

      return buildResultFromRoot(root, {
        status: ai?.status || 'done',
        progress: toNum(ai?.progress, 100),
        stage: ai?.stage || 'completed',
      });
    }

    await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      needsPdfRebuild: true,
      pdf: {
        ...(currentAi?.pdf || emptyPdfState()),
        status: 'failed',
        stage: 'failed',
        progress: 100,
        stale: true,
        staleReason: 'PROCESSING_STALE',
        error: 'SIGNAL_PDF_PROCESSING_STALE',
        sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
        connectionFingerprint: currentConnectionFingerprint,
      },
    }));

    if (buildAttemptId) {
      await safeSignalPdfState(userId, buildAttemptId, {
        status: 'failed',
        stage: 'failed',
        progress: 100,
        error: 'SIGNAL_PDF_PROCESSING_STALE',
      });
    }

    root = await findRoot(userId);
    ai = root?.aiContext || {};
    pdfState = ai?.pdf || {};
    logMcpContext('warn', 'mcpContext.builder', 'pdf.processing_stale', {
      userId: String(userId),
      buildAttemptId,
      currentSourceFingerprint: currentSourceFingerprint || null,
      signalFingerprint: signalFingerprint || null,
      currentConnectionFingerprint,
    });
  }

    await updateRootAiContext(userId, (currentAi) => ({
    ...(currentAi || {}),
    status: currentAi?.status === 'done' ? 'done' : (currentAi?.status || 'done'),
    progress: currentAi?.status === 'done' ? 100 : toNum(currentAi?.progress, 100),
    stage: currentAi?.status === 'done' ? 'completed' : (currentAi?.stage || 'completed'),
    error: currentAi?.error || null,
    needsSignalRebuild: false,
    needsPdfRebuild: true,
    pdf: {
      ...mergePdfState(currentAi),
      generationId: makePdfGenerationId(buildAttemptId),
      signalGenerationId: buildAttemptId || null,
      status: 'processing',
      stage: 'building_document',
      progress: 15,
      error: null,
      stale: false,
      staleReason: null,
      processingStartedAt: nowIso(),
      processingHeartbeatAt: nowIso(),
      sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
      connectionFingerprint: currentConnectionFingerprint,
    },
  }));

  if (buildAttemptId) {
    await safeSignalPdfState(userId, buildAttemptId, {
      status: 'processing',
      stage: 'building_document',
      progress: 15,
      error: null,
    });
  }

  try {
    const rootBeforePdf = await findRoot(userId);
    logMcpContext('info', 'mcpContext.builder', 'pdf.rendering_started', {
      userId: String(userId),
      buildAttemptId,
      currentSourceFingerprint: currentSourceFingerprint || null,
      signalFingerprint: signalFingerprint || null,
      currentConnectionFingerprint,
    });

      await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      needsSignalRebuild: false,
      needsPdfRebuild: true,
      pdf: {
        ...mergePdfState(currentAi),
        generationId: makePdfGenerationId(buildAttemptId),
        signalGenerationId: buildAttemptId || null,
        status: 'processing',
        stage: 'building_document',
        progress: 45,
        error: null,
        stale: false,
        staleReason: null,
        processingStartedAt: currentAi?.pdf?.processingStartedAt || nowIso(),
        processingHeartbeatAt: nowIso(),
        sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
        connectionFingerprint: currentConnectionFingerprint,
      },
    }));

    if (buildAttemptId) {
      await safeSignalPdfState(userId, buildAttemptId, {
        status: 'processing',
        stage: 'building_document',
        progress: 45,
        error: null,
      });
    }

    const pdfResult = await buildSignalPdfArtifact(
      userId,
      rootBeforePdf,
      signalPayload,
      readiness.encodedPayload || rootBeforePdf?.aiContext?.signal?.encodedPayload || rootBeforePdf?.aiContext?.encodedPayload || null
    );

      const finalRoot = await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      status: currentAi?.status === 'error' ? 'done' : (currentAi?.status || 'done'),
      progress: currentAi?.status === 'done' ? 100 : Math.max(100, toNum(currentAi?.progress, 100)),
      stage: currentAi?.stage === 'failed' ? 'completed' : (currentAi?.stage || 'completed'),
      error: null,
      needsSignalRebuild: false,
      needsPdfRebuild: false,
      pdf: {
        ...mergePdfState(currentAi),
        generationId: makePdfGenerationId(buildAttemptId),
        signalGenerationId: buildAttemptId || null,
        status: 'ready',
        stage: 'ready',
        progress: 100,
        fileName: pdfResult?.fileName || null,
        mimeType: pdfResult?.mimeType || 'application/pdf',
        storageKey: pdfResult?.storageKey || null,
        localPath: pdfResult?.localPath || null,
        downloadUrl: pdfResult?.downloadUrl || null,
        generatedAt: pdfResult?.generatedAt || nowIso(),
        sizeBytes: toNum(pdfResult?.sizeBytes, 0),
        pageCount: toNum(pdfResult?.pageCount, 0) || null,
        renderer: pdfResult?.renderer || null,
        version: Math.max(1, toNum(currentAi?.pdf?.version, 0) + 1),
        sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
        connectionFingerprint: currentConnectionFingerprint,
        processingStartedAt: currentAi?.pdf?.processingStartedAt || nowIso(),
        processingHeartbeatAt: nowIso(),
        stale: false,
        staleReason: null,
        error: null,
      },
    }));

    if (buildAttemptId) {
      await safeSignalPdfState(userId, buildAttemptId, {
        status: 'ready',
        stage: 'ready',
        progress: 100,
        fileName: pdfResult?.fileName || null,
        mimeType: pdfResult?.mimeType || 'application/pdf',
        storageKey: pdfResult?.storageKey || null,
        localPath: pdfResult?.localPath || null,
        downloadUrl: pdfResult?.downloadUrl || null,
        generatedAt: pdfResult?.generatedAt || nowIso(),
        sizeBytes: toNum(pdfResult?.sizeBytes, 0),
        pageCount: toNum(pdfResult?.pageCount, 0) || null,
        renderer: pdfResult?.renderer || null,
        error: null,
      });
    }

    logMcpContext('info', 'mcpContext.builder', 'pdf.completed', {
      userId: String(userId),
      buildAttemptId,
      currentSourceFingerprint: currentSourceFingerprint || null,
      signalFingerprint: signalFingerprint || null,
      currentConnectionFingerprint,
      fileName: pdfResult?.fileName || null,
      sizeBytes: toNum(pdfResult?.sizeBytes, 0),
      pageCount: toNum(pdfResult?.pageCount, 0) || null,
      renderer: pdfResult?.renderer || null,
    });
    return buildResultFromRoot(finalRoot || await findRoot(userId), {
      status: 'done',
      progress: 100,
      stage: 'completed',
    });
  } catch (pdfErr) {
    console.error('[mcpContextBuilder] PDF generation failed:', pdfErr?.message || pdfErr);
    logMcpContext('error', 'mcpContext.builder', 'pdf.failed', {
      userId: String(userId),
      buildAttemptId,
      currentSourceFingerprint: currentSourceFingerprint || null,
      signalFingerprint: signalFingerprint || null,
      currentConnectionFingerprint,
      error: toErrorMeta(pdfErr),
    });

      const failRoot = await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      status: currentAi?.status === 'done' ? 'done' : (currentAi?.status || 'done'),
      progress: currentAi?.status === 'done' ? 100 : toNum(currentAi?.progress, 100),
      stage: currentAi?.status === 'done' ? 'completed' : (currentAi?.stage || 'completed'),
      error: null,
      needsSignalRebuild: false,
      needsPdfRebuild: true,
      pdf: {
        ...mergePdfState(currentAi),
        generationId: makePdfGenerationId(buildAttemptId),
        signalGenerationId: buildAttemptId || null,
        status: 'failed',
        stage: 'failed',
        progress: 100,
        generatedAt: null,
        sourceFingerprint: currentSourceFingerprint || signalFingerprint || null,
        connectionFingerprint: currentConnectionFingerprint,
        processingHeartbeatAt: nowIso(),
        stale: false,
        staleReason: null,
        error: pdfErr?.code || pdfErr?.message || 'SIGNAL_PDF_BUILD_FAILED',
      },
    }));

    if (buildAttemptId) {
      await safeSignalPdfState(userId, buildAttemptId, {
        status: 'failed',
        stage: 'failed',
        progress: 100,
        error: pdfErr?.code || pdfErr?.message || 'SIGNAL_PDF_BUILD_FAILED',
      });
    }

    const err = new Error(pdfErr?.code || pdfErr?.message || 'SIGNAL_PDF_BUILD_FAILED');
    err.code = pdfErr?.code || 'SIGNAL_PDF_BUILD_FAILED';
    err.root = failRoot || null;
    throw err;
  }
}

async function rebuildUnifiedContextForUser(userId, options = {}) {
  await markContextStale(userId, options?.reason || 'source_updated', {
    rebuildRequestedAt: nowIso(),
    rebuildRequestedBy: safeStr(options?.requestedBy) || 'system',
  });

  return buildUnifiedContextForUser(userId, {
    explicitSnapshotId: options?.explicitSnapshotId || null,
    contextRangeDays: options?.contextRangeDays || null,
    timeoutMs: options?.timeoutMs || BUILD_WAIT_TIMEOUT_MS,
    markProcessing: true,
    forceRebuild: !!options?.forceRebuild,
    reason: options?.reason || 'source_updated',
    requestedBy: safeStr(options?.requestedBy) || 'system',
    trigger: safeStr(options?.trigger) || 'system',
  });
}

function makeShareToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  DEFAULT_CONTEXT_RANGE_DAYS,
  BUILD_WAIT_TIMEOUT_MS,
  BUILD_WAIT_POLL_MS,
  findRoot,
  updateRootContextState,
  markContextStale,
  buildUnifiedContextForUser,
  buildPdfForUser,
  rebuildUnifiedContextForUser,
  sourceStateSummaryForStatus,
  buildCanonicalRuntimeFromRoot,
  buildResultFromRoot,
  makeShareToken,
};
