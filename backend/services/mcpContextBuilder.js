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

const DEFAULT_CONTEXT_RANGE_DAYS = clampInt(process.env.MCP_CONTEXT_RANGE_DAYS || 60, 7, 365);
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
  const signalPayload = encoded.payload;
  const encodedSignalPayload = encodeSignalPayload({
    signalPayload,
    unifiedBase,
    root: encodingResult?.root || latestRootForBase || initialRoot || null,
    user: null,
  });
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
