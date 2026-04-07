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
    status: 'idle',
    stage: 'idle',
    progress: 0,
    fileName: null,
    mimeType: 'application/pdf',
    storageKey: null,
    localPath: null,
    downloadUrl: null,
    generatedAt: null,
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
  const status = safeStr(ai?.status).trim().toLowerCase();
  const stage = safeStr(ai?.stage).trim().toLowerCase();
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

  const signalComplete =
    status === 'done' &&
    stage === 'completed' &&
    encodedPayloadBuildable;

  const signalValidForPdf = signalComplete;

  return {
    signalPayload,
    encodedPayload,
    payloadBuildable,
    encodedPayloadBuildable,
    signalComplete,
    signalValidForPdf,
    signalReadyForPdf: signalValidForPdf,
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
  ], 25);

  return {
    connectedSources: connectedFinal,
    usableSources: uniqStrings(usableSources || [], 25),
    pendingConnectedSources: uniqStrings(pendingConnectedSources || [], 25),
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

async function findBestSnapshotIdForSource(userId, source, preferredSnapshotId) {
  const preferred = safeStr(preferredSnapshotId);
  const prefix = getSourceDatasetPrefix(source);

  if (preferred) {
    const preferredDocs = await findSourceChunkMeta(userId, source, preferred, prefix);
    if (preferredDocs.length > 0) return preferred;
  }

  return await findLatestSnapshotId(userId, source);
}

async function loadBestSourceState(userId, root, source, preferredSnapshotId, options = {}) {
  const { loadFullChunks = false } = options || {};

  const prefix = getSourceDatasetPrefix(source);
  const rootState = getSourceRootState(root, source);
  const connected = sourceLooksConnected(root, source);
  const rootReady = sourceLooksReady(root, source);

  const snapshotId = await findBestSnapshotIdForSource(userId, source, preferredSnapshotId);

  const chunkMeta = snapshotId
    ? await findSourceChunkMeta(userId, source, snapshotId, prefix)
    : [];

  const hasChunks = chunkMeta.length > 0;
  const usability = evaluateSourceUsability(source, chunkMeta);
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
    datasetNames: usability.datasetNames,
    missingRequired: usability.missingRequired,
    hasAnyOptional: usability.hasAnyOptional,
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

function sourceStateSummaryForStatus(state) {
  return {
    connected: !!state?.connected,
    rootReady: !!state?.rootReady,
    ready: !!state?.ready,
    usable: !!state?.usable,
    snapshotId: state?.snapshotId || null,
    chunkCount: toNum(state?.chunkCount, 0),
    datasets: Array.isArray(state?.datasetNames) ? state.datasetNames : [],
    missingRequired: Array.isArray(state?.missingRequired) ? state.missingRequired : [],
    hasAnyOptional: !!state?.hasAnyOptional,
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
    const pendingConnectedSources = candidateSources.filter((src) => {
      const s = bySource[src];
      return !!s?.connected && !s?.usable;
    });

    const shouldWaitForPendingConnectedSources =
  pendingConnectedSources.length > 0;

if (usableSources.length > 0 && !shouldWaitForPendingConnectedSources) {
  return {
    root: lastRoot,
    preferredGlobalSnapshotId: preferredGlobalSnapshotId || null,
    sourceStates: bySource,
    candidateSources,
    usableSources,
    pendingConnectedSources,
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
  const pendingConnectedSources = candidateSources.filter((src) => {
    const s = bySource[src];
    return !!s?.connected && !s?.usable;
  });

  return {
    root: fallbackRoot,
    preferredGlobalSnapshotId: safeStr(explicitSnapshotId) || safeStr(fallbackRoot?.latestSnapshotId) || null,
    sourceStates: bySource,
    candidateSources,
    usableSources,
    pendingConnectedSources,
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

  return McpData.findByIdAndUpdate(
    root._id,
    { $set: { aiContext: nextAi } },
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

  const updated = await McpData.findByIdAndUpdate(
    root._id,
    { $set: { aiContext: nextAi } },
    { new: true }
  ).lean();

  return { skipped: false, reason: null, root: updated };
}

function buildResultFromRoot(root, fallback = {}) {
  const state = root?.aiContext || {};
  const pdf = state?.pdf || {};

  const readiness = deriveSignalReadinessFromAi(
    state,
    fallback.signalPayload || null
  );

  const signalPayload = readiness.signalPayload;
  const encodedPayload = readiness.encodedPayload;
  const signalReadyForPdf = readiness.signalReadyForPdf;
  const signalComplete = readiness.signalComplete;
  const signalValidForPdf = readiness.signalValidForPdf;

  const currentSourceFingerprint =
    safeStr(state?.currentSourceFingerprint || '').trim() ||
    safeStr(fallback?.currentSourceFingerprint || '').trim() ||
    null;

  const signalSourceFingerprint =
    safeStr(state?.sourceFingerprint || '').trim() ||
    null;

  const pdfSourceFingerprint =
    safeStr(pdf?.sourceFingerprint || '').trim() ||
    null;

  const pdfReady = pdf?.status === 'ready';
  const pdfProcessing = pdf?.status === 'processing';
  const pdfFailed = pdf?.status === 'failed';
  const signalProcessing = safeStr(state?.status).trim().toLowerCase() === 'processing';
  const needSignalRebuild = !!state?.needsSignalRebuild;
  const needPdfRebuild = !!state?.needsPdfRebuild;

  const pdfAligned =
    !!pdfReady &&
    !!currentSourceFingerprint &&
    !!signalSourceFingerprint &&
    !!pdfSourceFingerprint &&
    currentSourceFingerprint === signalSourceFingerprint &&
    currentSourceFingerprint === pdfSourceFingerprint &&
    !pdf?.stale;

  const canGeneratePdf = !!signalReadyForPdf && !pdfAligned && !pdfProcessing;
  const canDownloadPdf = !!pdfAligned;
  const uiMode =
    signalProcessing ? 'signal_building' :
    pdfAligned ? 'pdf_ready' :
    pdfProcessing ? 'pdf_building' :
    safeStr(state?.status).trim().toLowerCase() === 'failed' ? 'signal_failed' :
    signalReadyForPdf ? 'signal_ready' :
    'signal_building';
  const pdfBuildState = derivePdfBuildState({
    signalProcessing,
    needSignalRebuild,
    signalReadyForPdf,
    pdfReady: pdfAligned,
    pdfProcessing,
    pdfFailed,
    needPdfRebuild,
  });

  return {
    ok: true,
    root,
    unifiedBase: state?.unifiedBase || fallback.unifiedBase || null,
    encodedPayload: encodedPayload || fallback.encodedPayload || null,
    signalPayload,
    pdf,
    data: {
      status: state?.status || fallback.status || 'idle',
      progress: toNum(state?.progress, fallback.progress || 0),
      stage: state?.stage || fallback.stage || 'idle',
      snapshotId: state?.snapshotId || fallback.snapshotId || root?.latestSnapshotId || null,
      sourceSnapshots: state?.sourceSnapshots || fallback.sourceSnapshots || null,
      contextRangeDays: toNum(state?.contextRangeDays) || fallback.contextRangeDays || null,
      storageRangeDays: toNum(state?.storageRangeDays) || fallback.storageRangeDays || null,
      usedOpenAI: !!state?.usedOpenAI,
      model: state?.model || null,
      hasEncodedPayload: !!encodedPayload,
      hasSignal: !!signalPayload,
      signalComplete,
      signalValidForPdf,
      signalReadyForPdf,
      providerAgnostic: !!encodedPayload?.providerAgnostic,

      usableSources: Array.isArray(state?.usableSources) ? state.usableSources : (fallback.usableSources || []),
      pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : (fallback.pendingConnectedSources || []),
      sources: state?.sourcesStatus || fallback.sources || null,

      sourceFingerprint: signalSourceFingerprint,
      currentSourcesSnapshot: state?.currentSourcesSnapshot || fallback?.currentSourcesSnapshot || null,
      currentSourceFingerprint,
      connectionFingerprint: safeStr(state?.connectionFingerprint || '').trim() || null,

      needsSignalRebuild: !!state?.needsSignalRebuild,
      needsPdfRebuild: !!state?.needsPdfRebuild,
      needSignalRebuild,
      needPdfRebuild,

      hasPdf: pdfAligned,
      pdfReady,
      pdfProcessing,
      pdfFailed,
      canGeneratePdf,
      canDownloadPdf,
      uiMode,
      pdfBuildState,

      pdf: {
        status: pdf?.status || 'idle',
        stage: pdf?.stage || 'idle',
        progress: toNum(pdf?.progress, 0),
        ready: pdfReady,
        fileName: pdf?.fileName || null,
        mimeType: pdf?.mimeType || 'application/pdf',
        downloadUrl: pdf?.downloadUrl || null,
        generatedAt: pdf?.generatedAt || null,
        sizeBytes: toNum(pdf?.sizeBytes, 0),
        pageCount: toNum(pdf?.pageCount, 0) || null,
        renderer: pdf?.renderer || null,
        sourceFingerprint: pdfSourceFingerprint,
        connectionFingerprint: safeStr(pdf?.connectionFingerprint || '').trim() || null,
        processingStartedAt: pdf?.processingStartedAt || null,
        processingHeartbeatAt: pdf?.processingHeartbeatAt || null,
        stale: !!pdf?.stale,
        staleReason: pdf?.staleReason || null,
        error: pdf?.error || null,
      },

      error: state?.error || null,
      buildAttemptId: state?.buildAttemptId || null,
      signalRunId: state?.signalRunId || null,
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

  return McpData.findByIdAndUpdate(
    root._id,
    {
      $set: {
        aiContext: {
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
          signal: {
            ...(prevAi?.signal || {}),
            payload: null,
            encodedPayload: null,
            unifiedBase: null,
          },
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

          pdf: emptyPdfState({
            connectionFingerprint: nextConnectionFingerprint,
            sourceFingerprint: effectiveSourceContext.fingerprint,
            stale: true,
            staleReason: safeStr(reason) || 'source_updated',
          }),

          ...extra,
        },
      },
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

  if (!forceRebuild && isRecentProcessingState(initialRoot?.aiContext)) {
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
      signal: {
        ...(currentAi?.signal || {}),
        payload: null,
        encodedPayload: null,
        unifiedBase: null,
      },
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
      usableSources: [],
      pendingConnectedSources: [],
      sourcesStatus: null,
      pdf: emptyPdfState({
        status: 'idle',
        stage: 'waiting_for_sources',
        progress: 0,
        connectionFingerprint: initialConnectionFingerprint,
        sourceFingerprint: initialEffectiveSourceContext.fingerprint,
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

  const hasAnyBuildable =
    metaChunks.length > 0 ||
    googleChunks.length > 0 ||
    ga4Chunks.length > 0;

    const sourcesStatus = {
    metaAds: sourceStateSummaryForStatus(hydratedMetaState),
    googleAds: sourceStateSummaryForStatus(hydratedGoogleState),
    ga4: sourceStateSummaryForStatus(hydratedGa4State),
  };

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
      sourcesStatus,
      usableSources,
      pendingConnectedSources,
      error: null,
      unifiedBase: null,
      encodedPayload: null,
      signalPayload: null,
      signal: {
        ...(currentAi?.signal || {}),
        payload: null,
        encodedPayload: null,
        unifiedBase: null,
      },
        pdf: emptyPdfState({
        status: 'idle',
        stage: 'idle',
        progress: 0,
        connectionFingerprint: effectiveConnectionFingerprint,
        sourceFingerprint: effectiveSourceContext.fingerprint,
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
      sourcesStatus,
      usableSources,
      pendingConnectedSources,
      error: 'MCP_CONTEXT_NO_USABLE_SOURCES',
      unifiedBase: null,
      encodedPayload: null,
      signalPayload: null,
      signal: {
        ...(currentAi?.signal || {}),
        payload: null,
        encodedPayload: null,
        unifiedBase: null,
      },
      sourceFingerprint: null,
        pdf: emptyPdfState({
        status: 'idle',
        stage: 'idle',
        progress: 0,
        connectionFingerprint: effectiveConnectionFingerprint,
        sourceFingerprint: effectiveSourceContext.fingerprint,
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
    sourcesStatus,
    usableSources,
    pendingConnectedSources,
    error: null,
    signalComplete: false,
    signalValidForPdf: false,
    signalReadyForPdf: false,
    unifiedBase: null,
    encodedPayload: null,
    signalPayload: null,
    signal: {
      ...(currentAi?.signal || {}),
      payload: null,
      encodedPayload: null,
      unifiedBase: null,
    },
    sourceFingerprint: null,
    pdf: emptyPdfState({
      status: 'idle',
      stage: 'idle',
      progress: 0,
      connectionFingerprint: effectiveConnectionFingerprint,
      sourceFingerprint: effectiveSourceContext.fingerprint,
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
    sourcesStatus,
    usableSources,
    pendingConnectedSources,
    error: null,
    encodedPayload: null,
    signalPayload: null,
    signal: {
      ...(currentAi?.signal || {}),
      payload: null,
      encodedPayload: null,
      unifiedBase: null,
    },
    sourceFingerprint: null,
    pdf: emptyPdfState({
      status: 'idle',
      stage: 'idle',
      progress: 0,
      connectionFingerprint: effectiveConnectionFingerprint,
      sourceFingerprint: effectiveSourceContext.fingerprint,
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

    sourcesStatus,
    usableSources,
    pendingConnectedSources,
    error: null,
    pdf: emptyPdfState({
      status: 'idle',
      stage: 'idle',
      progress: 0,
      sourceFingerprint: finalSourceFingerprint,
      connectionFingerprint: finalConnectionFingerprint,
      stale: true,
      staleReason: 'encoding_signal',
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
      sourcesStatus,
      usableSources,
      pendingConnectedSources,
      error: null,

      signalComplete: false,
      signalValidForPdf: false,
      signalReadyForPdf: false,

      pdf: emptyPdfState({
        status: 'idle',
        stage: 'idle',
        progress: 0,
        sourceFingerprint: finalSourceFingerprint,
        connectionFingerprint: finalConnectionFingerprint,
        stale: true,
        staleReason: 'waiting_for_valid_signal',
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
  signal: {
    ...(currentAi?.signal || {}),
    payload: signalPayload,
    encodedPayload: encodedSignalPayload,
    unifiedBase,
  },

  sourceFingerprint: finalSourceFingerprint,
  currentSourcesSnapshot: finalSourcesSnapshot,
  currentSourceFingerprint: finalSourceFingerprint,
  connectionFingerprint: finalConnectionFingerprint,

  usedOpenAI: !!encoded.usedOpenAI,
  model: encoded.model || null,
  sourcesStatus,
  usableSources,
  pendingConnectedSources,

  signalComplete: true,
  signalValidForPdf: true,
  signalReadyForPdf: true,

  needsSignalRebuild: false,
  needsPdfRebuild: true,

  staleReason: null,
  staleAt: null,
  lastInvalidatedAt: null,
  invalidatedByAttemptId: null,

  pdf: emptyPdfState({
    status: 'idle',
    stage: 'idle',
    progress: 0,
    sourceFingerprint: finalSourceFingerprint,
    connectionFingerprint: finalConnectionFingerprint,
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

  const signalLooksStaleByFingerprint =
    !!currentSourceFingerprint &&
    !!signalFingerprint &&
    currentSourceFingerprint !== signalFingerprint;

  const signalLooksStaleByConnection =
    !!signalConnectionFingerprint &&
    !!currentConnectionFingerprint &&
    signalConnectionFingerprint !== currentConnectionFingerprint;

  const signalLooksStale =
    !!signalLooksStaleByFingerprint || !!signalLooksStaleByConnection;

  if (signalLooksStale) {
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
        await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      needsPdfRebuild: true,
      pdf: {
        ...(currentAi?.pdf || emptyPdfState()),
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
         await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      needsSignalRebuild: false,
      needsPdfRebuild: false,
      pdf: {
        ...(currentAi?.pdf || emptyPdfState()),
        ...(pdfState || {}),
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
        ...(currentAi?.pdf || emptyPdfState()),
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
      ...(currentAi?.pdf || emptyPdfState()),
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

      await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      needsSignalRebuild: false,
      needsPdfRebuild: true,
      pdf: {
        ...(currentAi?.pdf || emptyPdfState()),
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
        ...(currentAi?.pdf || emptyPdfState()),
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

    return buildResultFromRoot(finalRoot || await findRoot(userId), {
      status: 'done',
      progress: 100,
      stage: 'completed',
    });
  } catch (pdfErr) {
    console.error('[mcpContextBuilder] PDF generation failed:', pdfErr?.message || pdfErr);

      const failRoot = await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      status: currentAi?.status === 'done' ? 'done' : (currentAi?.status || 'done'),
      progress: currentAi?.status === 'done' ? 100 : toNum(currentAi?.progress, 100),
      stage: currentAi?.status === 'done' ? 'completed' : (currentAi?.stage || 'completed'),
      error: null,
      needsSignalRebuild: false,
      needsPdfRebuild: true,
      pdf: {
        ...(currentAi?.pdf || emptyPdfState()),
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
  makeShareToken,
};
