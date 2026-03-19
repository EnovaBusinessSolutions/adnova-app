// backend/services/mcpContextBuilder.js
'use strict';

const crypto = require('crypto');

const McpData = require('../models/McpData');
const User = require('../models/User');

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

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toNum(v, fallback = 0) {
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

function nowDate() {
  return new Date();
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

function parseDateMs(v) {
  if (v instanceof Date) return v.getTime();
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

function makeGenerationId(prefix = 'gen') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashFingerprint(payload) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex');
}

function pickFirstNonEmpty(...values) {
  for (const v of values) {
    const s = safeStr(v).trim();
    if (s) return s;
  }
  return null;
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

function getSignalPayloadFromAi(ai) {
  return ai?.signal?.payload || ai?.signalPayload || ai?.encodedPayload || null;
}

function getSignalFingerprintFromAi(ai) {
  return safeStr(ai?.signal?.sourceFingerprint).trim() || null;
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

function isRootSignalCurrent(root) {
  const ai = root?.aiContext || {};
  const currentFp = safeStr(ai?.currentSourceFingerprint).trim();
  const signalFp = getSignalFingerprintFromAi(ai);

  return !!(
    currentFp &&
    signalFp &&
    ai?.signal?.status === 'ready' &&
    currentFp === signalFp &&
    ai?.needsSignalRebuild !== true
  );
}

function isRootPdfCurrent(root) {
  const ai = root?.aiContext || {};
  const currentFp = safeStr(ai?.currentSourceFingerprint).trim();
  const pdfFp = safeStr(ai?.pdf?.sourceFingerprint).trim();

  return !!(
    currentFp &&
    pdfFp &&
    ai?.pdf?.status === 'ready' &&
    currentFp === pdfFp &&
    isRootSignalCurrent(root) &&
    ai?.needsPdfRebuild !== true
  );
}

function isRecentSignalProcessingState(ai) {
  if (!ai) return false;
  if (ai?.signal?.status !== 'processing') return false;
  if (!safeStr(ai?.signal?.generationId).trim()) return false;

  const startedMs = parseDateMs(ai?.signal?.startedAt || ai?.startedAt);
  if (!startedMs) return false;

  return (Date.now() - startedMs) <= BUILD_ACTIVE_GUARD_MS;
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
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return latestChunk?.snapshotId || null;
}

async function findSourceChunks(userId, source, snapshotId, datasetPrefix) {
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
    const preferredDocs = await findSourceChunks(userId, source, preferred, prefix);
    if (preferredDocs.length > 0) return preferred;
  }

  return await findLatestSnapshotId(userId, source);
}

async function loadBestSourceState(userId, root, source, preferredSnapshotId) {
  const prefix = getSourceDatasetPrefix(source);
  const rootState = getSourceRootState(root, source);
  const connected = sourceLooksConnected(root, source);
  const rootReady = sourceLooksReady(root, source);

  const snapshotId = await findBestSnapshotIdForSource(userId, source, preferredSnapshotId);
  const chunks = snapshotId
    ? await findSourceChunks(userId, source, snapshotId, prefix)
    : [];

  const hasChunks = chunks.length > 0;
  const usability = evaluateSourceUsability(source, chunks);
  const usable = !!usability.usable;
  const ready = rootReady || usable;

  return {
    source,
    preferredSnapshotId: preferredSnapshotId || null,
    snapshotId: snapshotId || null,
    chunks,
    chunkCount: chunks.length,
    hasChunks,
    connected,
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
  const rootState = state?.rootState || {};

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

    selectedAccountId: pickFirstNonEmpty(rootState?.selectedAccountId, rootState?.accountId),
    selectedPixelId: pickFirstNonEmpty(rootState?.selectedPixelId),
    selectedCustomerId: pickFirstNonEmpty(rootState?.selectedCustomerId, rootState?.customerId, rootState?.accountId),
    selectedConversionId: pickFirstNonEmpty(rootState?.selectedConversionId),
    selectedPropertyId: pickFirstNonEmpty(rootState?.selectedPropertyId, rootState?.propertyId),
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
      sourceNames.map((src) => loadBestSourceState(userId, lastRoot, src, preferredGlobalSnapshotId))
    );

    const bySource = Object.fromEntries(sourceStatesArr.map((x) => [x.source, x]));
    const candidateSources = getCandidateSources(lastRoot, bySource);

    const usableSources = candidateSources.filter((src) => !!bySource[src]?.usable);
    const pendingConnectedSources = candidateSources.filter((src) => {
      const s = bySource[src];
      return !!s?.connected && !s?.usable;
    });

    if (usableSources.length > 0 && pendingConnectedSources.length === 0) {
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
        safeStr(explicitSnapshotId) || safeStr(fallbackRoot?.latestSnapshotId) || ''
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

function buildCurrentSourcesSnapshot(root, sourceStates) {
  const metaRoot = root?.sources?.metaAds || {};
  const googleRoot = root?.sources?.googleAds || {};
  const ga4Root = root?.sources?.ga4 || {};

  const metaState = sourceStates?.metaAds || {};
  const googleState = sourceStates?.googleAds || {};
  const ga4State = sourceStates?.ga4 || {};

  const metaActive = !!(metaRoot?.connected || metaState?.hasChunks || metaState?.usable);
  const googleActive = !!(googleRoot?.connected || googleState?.hasChunks || googleState?.usable);
  const ga4Active = !!(ga4Root?.connected || ga4State?.hasChunks || ga4State?.usable);

  return {
    metaAds: {
      active: metaActive,
      connected: !!metaRoot?.connected,
      usable: !!metaState?.usable,
      ready: !!metaState?.ready,
      snapshotId: metaState?.snapshotId || null,
      selectedAccountId: pickFirstNonEmpty(metaRoot?.selectedAccountId, metaRoot?.accountId),
      selectedPixelId: pickFirstNonEmpty(metaRoot?.selectedPixelId),
      accountId: pickFirstNonEmpty(metaRoot?.accountId),
      name: pickFirstNonEmpty(metaRoot?.name),
    },
    googleAds: {
      active: googleActive,
      connected: !!googleRoot?.connected,
      usable: !!googleState?.usable,
      ready: !!googleState?.ready,
      snapshotId: googleState?.snapshotId || null,
      selectedCustomerId: pickFirstNonEmpty(googleRoot?.selectedCustomerId, googleRoot?.customerId, googleRoot?.accountId),
      selectedConversionId: pickFirstNonEmpty(googleRoot?.selectedConversionId),
      customerId: pickFirstNonEmpty(googleRoot?.customerId, googleRoot?.accountId),
      name: pickFirstNonEmpty(googleRoot?.name),
    },
    ga4: {
      active: ga4Active,
      connected: !!ga4Root?.connected,
      usable: !!ga4State?.usable,
      ready: !!ga4State?.ready,
      snapshotId: ga4State?.snapshotId || null,
      selectedPropertyId: pickFirstNonEmpty(ga4Root?.selectedPropertyId, ga4Root?.propertyId),
      propertyId: pickFirstNonEmpty(ga4Root?.propertyId),
      name: pickFirstNonEmpty(ga4Root?.name),
    },
  };
}

function buildCurrentSourceFingerprint(currentSourcesSnapshot) {
  const snap = currentSourcesSnapshot || {};
  const normalized = {
    metaAds: snap?.metaAds?.active ? {
      active: true,
      selectedAccountId: snap?.metaAds?.selectedAccountId || null,
      selectedPixelId: snap?.metaAds?.selectedPixelId || null,
      snapshotId: snap?.metaAds?.snapshotId || null,
    } : { active: false },

    googleAds: snap?.googleAds?.active ? {
      active: true,
      selectedCustomerId: snap?.googleAds?.selectedCustomerId || null,
      selectedConversionId: snap?.googleAds?.selectedConversionId || null,
      snapshotId: snap?.googleAds?.snapshotId || null,
    } : { active: false },

    ga4: snap?.ga4?.active ? {
      active: true,
      selectedPropertyId: snap?.ga4?.selectedPropertyId || null,
      snapshotId: snap?.ga4?.snapshotId || null,
    } : { active: false },
  };

  return hashFingerprint(normalized);
}

function buildUnifiedBaseContext({
  root,
  contextRangeDays,
  storageRangeDays,
  sourceStates,
  metaPack,
  googlePack,
  ga4Pack,
  currentSourcesSnapshot,
  currentSourceFingerprint,
}) {
  const sources = root?.sources || {};
  const metaState = sourceStates?.metaAds || null;
  const googleState = sourceStates?.googleAds || null;
  const ga4State = sourceStates?.ga4 || null;

  const sourceSnapshots = {
    metaAds: metaState?.snapshotId || null,
    googleAds: googleState?.snapshotId || null,
    ga4: ga4State?.snapshotId || null,
  };

  return {
    schema: 'adray.unified.context.v3',
    generatedAt: nowIso(),
    snapshotId:
      sourceSnapshots.metaAds ||
      sourceSnapshots.googleAds ||
      sourceSnapshots.ga4 ||
      safeStr(root?.latestSnapshotId) ||
      null,
    sourceSnapshots,
    currentSourceFingerprint: currentSourceFingerprint || null,
    currentSourcesSnapshot: currentSourcesSnapshot || null,
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
        connected: !!sources?.metaAds?.connected,
        ready: !!(sources?.metaAds?.ready || metaState?.usable),
        usable: !!metaState?.usable,
        accountId: pickFirstNonEmpty(sources?.metaAds?.selectedAccountId, sources?.metaAds?.accountId),
        selectedPixelId: pickFirstNonEmpty(sources?.metaAds?.selectedPixelId),
        name: sources?.metaAds?.name || null,
        currency: sources?.metaAds?.currency || null,
        timezone: sources?.metaAds?.timezone || null,
        snapshotId: metaState?.snapshotId || null,
        chunkCount: toNum(metaState?.chunkCount, 0),
        storageRangeDays: toNum(sources?.metaAds?.storageRangeDays) || toNum(sources?.metaAds?.rangeDays) || storageRangeDays || null,
        contextDefaultRangeDays: toNum(sources?.metaAds?.contextDefaultRangeDays) || contextRangeDays || null,
      },
      googleAds: {
        connected: !!sources?.googleAds?.connected,
        ready: !!(sources?.googleAds?.ready || googleState?.usable),
        usable: !!googleState?.usable,
        customerId: pickFirstNonEmpty(sources?.googleAds?.selectedCustomerId, sources?.googleAds?.customerId, sources?.googleAds?.accountId),
        selectedConversionId: pickFirstNonEmpty(sources?.googleAds?.selectedConversionId),
        name: sources?.googleAds?.name || null,
        currency: sources?.googleAds?.currency || null,
        timezone: sources?.googleAds?.timezone || null,
        snapshotId: googleState?.snapshotId || null,
        chunkCount: toNum(googleState?.chunkCount, 0),
        storageRangeDays: toNum(sources?.googleAds?.storageRangeDays) || toNum(sources?.googleAds?.rangeDays) || storageRangeDays || null,
        contextDefaultRangeDays: toNum(sources?.googleAds?.contextDefaultRangeDays) || contextRangeDays || null,
      },
      ga4: {
        connected: !!sources?.ga4?.connected,
        ready: !!(sources?.ga4?.ready || ga4State?.usable),
        usable: !!ga4State?.usable,
        propertyId: pickFirstNonEmpty(sources?.ga4?.selectedPropertyId, sources?.ga4?.propertyId),
        name: sources?.ga4?.name || null,
        currency: sources?.ga4?.currency || null,
        timezone: sources?.ga4?.timezone || null,
        snapshotId: ga4State?.snapshotId || null,
        chunkCount: toNum(ga4State?.chunkCount, 0),
        storageRangeDays: toNum(sources?.ga4?.storageRangeDays) || toNum(sources?.ga4?.rangeDays) || storageRangeDays || null,
        contextDefaultRangeDays: toNum(sources?.ga4?.contextDefaultRangeDays) || contextRangeDays || null,
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
    schema: base?.schema || 'adray.unified.context.v3',
    snapshotId: base?.snapshotId || null,
    sourceSnapshots: base?.sourceSnapshots || null,
    currentSourceFingerprint: base?.currentSourceFingerprint || null,
    currentSourcesSnapshot: base?.currentSourcesSnapshot || null,
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
        currentSourceFingerprint: base?.currentSourceFingerprint || null,
        currentSourcesSnapshot: base?.currentSourcesSnapshot || null,
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

async function buildSignalPdfArtifact(userId, root, signalPayload) {
  const user = await User.findById(userId)
    .select('name companyName workspaceName businessName email')
    .lean()
    .catch(() => null);

  return generateSignalPdfForUser({
    userId,
    root,
    signalPayload,
    user,
  });
}

async function findRoot(userId) {
  const docs = await McpData.find({ userId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return docs.find(isRootDoc) || null;
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

function buildResultFromRoot(root, fallback = {}) {
  const ai = root?.aiContext || {};
  const signal = ai?.signal || {};
  const pdf = ai?.pdf || {};
  const currentSourceFingerprint = safeStr(ai?.currentSourceFingerprint).trim() || null;
  const signalPayload = getSignalPayloadFromAi(ai);
  const signalCurrent = isRootSignalCurrent(root);
  const pdfCurrent = isRootPdfCurrent(root);

  return {
    ok: true,
    root,
    unifiedBase: ai?.signal?.unifiedBase || ai?.unifiedBase || fallback.unifiedBase || null,
    encodedPayload: ai?.signal?.encodedPayload || ai?.encodedPayload || fallback.encodedPayload || null,
    signalPayload: signalPayload || fallback.signalPayload || null,
    pdf,
    data: {
      status: ai?.status || fallback.status || 'idle',
      progress: toNum(ai?.progress, fallback.progress || 0),
      stage: ai?.stage || fallback.stage || 'idle',

      snapshotId:
        ai?.signal?.snapshotId ||
        ai?.snapshotId ||
        fallback.snapshotId ||
        root?.latestSnapshotId ||
        null,

      sourceSnapshots:
        ai?.sourceSnapshots ||
        fallback.sourceSnapshots ||
        null,

      currentSourceFingerprint,
      currentSourcesSnapshot: ai?.currentSourcesSnapshot || null,

      contextRangeDays:
        toNum(ai?.signal?.contextRangeDays) ||
        toNum(ai?.contextRangeDays) ||
        fallback.contextRangeDays ||
        null,

      storageRangeDays:
        toNum(ai?.signal?.storageRangeDays) ||
        toNum(ai?.storageRangeDays) ||
        fallback.storageRangeDays ||
        null,

      usedOpenAI: !!(ai?.signal?.usedOpenAI || ai?.usedOpenAI),
      model: ai?.signal?.model || ai?.model || null,

      hasEncodedPayload: !!(ai?.signal?.encodedPayload || ai?.encodedPayload),
      hasSignal: !!signalPayload,
      signal: {
        status: signal?.status || 'idle',
        stage: signal?.stage || 'idle',
        progress: toNum(signal?.progress, 0),
        ready: signal?.status === 'ready',
        generationId: signal?.generationId || null,
        sourceFingerprint: signal?.sourceFingerprint || null,
        generatedAt: signal?.generatedAt || null,
        startedAt: signal?.startedAt || null,
        finishedAt: signal?.finishedAt || null,
        error: signal?.error || null,
        isCurrent: signalCurrent,
      },

      providerAgnostic: !!(signalPayload?.providerAgnostic || ai?.encodedPayload?.providerAgnostic),

      usableSources: Array.isArray(ai?.usableSources) ? ai.usableSources : (fallback.usableSources || []),
      pendingConnectedSources: Array.isArray(ai?.pendingConnectedSources) ? ai.pendingConnectedSources : (fallback.pendingConnectedSources || []),
      sources: ai?.sourcesStatus || fallback.sources || null,

      hasPdf: pdf?.status === 'ready',
      pdf: {
        status: pdf?.status || 'idle',
        stage: pdf?.stage || 'idle',
        progress: toNum(pdf?.progress, 0),
        ready: pdf?.status === 'ready',
        generationId: pdf?.generationId || null,
        signalGenerationId: pdf?.signalGenerationId || null,
        sourceFingerprint: pdf?.sourceFingerprint || null,
        generatedAt: pdf?.generatedAt || null,
        fileName: pdf?.fileName || null,
        mimeType: pdf?.mimeType || 'application/pdf',
        downloadUrl: pdf?.downloadUrl || null,
        sizeBytes: toNum(pdf?.sizeBytes, 0),
        pageCount: toNum(pdf?.pageCount, 0) || null,
        renderer: pdf?.renderer || null,
        error: pdf?.error || null,
        isCurrent: pdfCurrent,
      },

      needsSignalRebuild: ai?.needsSignalRebuild === true,
      needsPdfRebuild: ai?.needsPdfRebuild === true,

      canGeneratePdf: signalCurrent && !pdfCurrent && signal?.status === 'ready',
      canDownloadPdf: pdfCurrent,

      error: ai?.error || null,
    },
  };
}

async function markContextStale(userId, reason = 'source_updated', extra = {}) {
  const root = await findRoot(userId);
  if (!root?._id) return null;

  const now = nowDate();

  return McpData.findByIdAndUpdate(
    root._id,
    {
      $set: {
        'aiContext.status': 'idle',
        'aiContext.stage': 'awaiting_rebuild',
        'aiContext.progress': 0,
        'aiContext.error': null,
        'aiContext.needsSignalRebuild': true,
        'aiContext.needsPdfRebuild': true,

        'aiContext.signal.status': 'idle',
        'aiContext.signal.stage': 'awaiting_rebuild',
        'aiContext.signal.progress': 0,
        'aiContext.signal.invalidatedAt': now,
        'aiContext.signal.staleReason': safeStr(reason) || 'source_updated',
        'aiContext.signal.error': null,

        'aiContext.pdf.status': 'idle',
        'aiContext.pdf.stage': 'awaiting_rebuild',
        'aiContext.pdf.progress': 0,
        'aiContext.pdf.invalidatedAt': now,
        'aiContext.pdf.staleReason': safeStr(reason) || 'source_updated',
        'aiContext.pdf.error': null,

        ...extra,
      },
    },
    { new: true }
  ).lean();
}

function hasLiveSourceFingerprintChanged(root, nextFingerprint) {
  const ai = root?.aiContext || {};
  const currentStored = safeStr(ai?.currentSourceFingerprint).trim() || null;
  const signalFp = safeStr(ai?.signal?.sourceFingerprint).trim() || null;
  const pdfFp = safeStr(ai?.pdf?.sourceFingerprint).trim() || null;
  const next = safeStr(nextFingerprint).trim() || null;

  if (!next) return false;
  if (!currentStored) return true;
  if (currentStored !== next) return true;
  if (signalFp && signalFp !== next) return true;
  if (pdfFp && pdfFp !== next) return true;

  return false;
}

function debugFingerprintLog({
  userId,
  label,
  root,
  currentSourcesSnapshot,
  currentSourceFingerprint,
  sourceSnapshots,
  usableSources,
  pendingConnectedSources,
}) {
  try {
    const ai = root?.aiContext || {};
    console.log('[mcpContextBuilder] fingerprint', {
      label,
      userId: String(userId),
      storedCurrentSourceFingerprint: ai?.currentSourceFingerprint || null,
      signalSourceFingerprint: ai?.signal?.sourceFingerprint || null,
      pdfSourceFingerprint: ai?.pdf?.sourceFingerprint || null,
      nextCurrentSourceFingerprint: currentSourceFingerprint || null,
      currentSourcesSnapshot,
      sourceSnapshots,
      usableSources,
      pendingConnectedSources,
      rootSources: root?.sources || null,
      signalStatus: ai?.signal?.status || null,
      pdfStatus: ai?.pdf?.status || null,
      needsSignalRebuild: ai?.needsSignalRebuild === true,
      needsPdfRebuild: ai?.needsPdfRebuild === true,
    });
  } catch (_) {
    // noop
  }
}

async function buildUnifiedContextForUser(userId, options = {}) {
  const {
    explicitSnapshotId = null,
    contextRangeDays: requestedContextRangeDays = null,
    timeoutMs = BUILD_WAIT_TIMEOUT_MS,
    forceRebuild = false,
  } = options || {};

  const initialRoot = await findRoot(userId);
  if (!initialRoot) {
    const err = new Error('MCP_ROOT_NOT_FOUND');
    err.code = 'MCP_ROOT_NOT_FOUND';
    throw err;
  }

  const contextRangeDays = resolveRequestedContextRangeDays(initialRoot, requestedContextRangeDays);
  const storageRangeDays = getStorageRangeDaysFromRoot(initialRoot);

  const preferredSnapshotId =
    safeStr(explicitSnapshotId) ||
    safeStr(initialRoot?.latestSnapshotId) ||
    null;

  const readyState = await waitForBuildableSources(userId, initialRoot, explicitSnapshotId, timeoutMs);
  const effectiveRoot = readyState?.root || await findRoot(userId);

  const sourceStates = readyState?.sourceStates || {};
  const metaState = sourceStates?.metaAds || null;
  const googleState = sourceStates?.googleAds || null;
  const ga4State = sourceStates?.ga4 || null;

  const sourceSnapshots = {
    metaAds: metaState?.snapshotId || null,
    googleAds: googleState?.snapshotId || null,
    ga4: ga4State?.snapshotId || null,
  };

  const metaChunks = metaState?.chunks || [];
  const googleChunks = googleState?.chunks || [];
  const ga4Chunks = ga4State?.chunks || [];

  const usableSources = readyState?.usableSources || [];
  const pendingConnectedSources = readyState?.pendingConnectedSources || [];

  const hasAnyBuildable =
    metaChunks.length > 0 ||
    googleChunks.length > 0 ||
    ga4Chunks.length > 0;

  const sourcesStatus = {
    metaAds: sourceStateSummaryForStatus(metaState),
    googleAds: sourceStateSummaryForStatus(googleState),
    ga4: sourceStateSummaryForStatus(ga4State),
  };

  const currentSourcesSnapshot = buildCurrentSourcesSnapshot(effectiveRoot, sourceStates);
  const currentSourceFingerprint = buildCurrentSourceFingerprint(currentSourcesSnapshot);
  const liveFingerprintChanged = hasLiveSourceFingerprintChanged(effectiveRoot, currentSourceFingerprint);

  debugFingerprintLog({
    userId,
    label: 'pre_build_decision',
    root: effectiveRoot,
    currentSourcesSnapshot,
    currentSourceFingerprint,
    sourceSnapshots,
    usableSources,
    pendingConnectedSources,
  });

  await McpData.markSourcesState(userId, {
    currentSourceFingerprint,
    currentSourcesSnapshot,
    sourcesChangedAt: liveFingerprintChanged ? nowDate() : (effectiveRoot?.aiContext?.sourcesChangedAt || nowDate()),
    needsSignalRebuild: liveFingerprintChanged ? true : !!effectiveRoot?.aiContext?.needsSignalRebuild,
    needsPdfRebuild: liveFingerprintChanged ? true : !!effectiveRoot?.aiContext?.needsPdfRebuild,
  });

  await updateRootContextState(userId, {
    'aiContext.sourceSnapshots': sourceSnapshots,
    'aiContext.contextRangeDays': contextRangeDays,
    'aiContext.storageRangeDays': storageRangeDays,
    'aiContext.sourcesStatus': sourcesStatus,
    'aiContext.usableSources': usableSources,
    'aiContext.pendingConnectedSources': pendingConnectedSources,
  });

  const freshRootAfterSourceMark = await findRoot(userId);

  debugFingerprintLog({
    userId,
    label: 'after_mark_sources_state',
    root: freshRootAfterSourceMark,
    currentSourcesSnapshot,
    currentSourceFingerprint,
    sourceSnapshots,
    usableSources,
    pendingConnectedSources,
  });

  if (!forceRebuild && isRootSignalCurrent(freshRootAfterSourceMark)) {
    return buildResultFromRoot(freshRootAfterSourceMark, {
      status: freshRootAfterSourceMark?.aiContext?.status || 'done',
      progress: toNum(freshRootAfterSourceMark?.aiContext?.progress, 100),
      stage: freshRootAfterSourceMark?.aiContext?.stage || 'completed',
    });
  }

  if (!forceRebuild && isRecentSignalProcessingState(freshRootAfterSourceMark?.aiContext)) {
    return buildResultFromRoot(freshRootAfterSourceMark, {
      status: freshRootAfterSourceMark?.aiContext?.status || 'processing',
      progress: toNum(freshRootAfterSourceMark?.aiContext?.progress, 10),
      stage: freshRootAfterSourceMark?.aiContext?.stage || 'waiting_for_sources',
    });
  }

  if (!hasAnyBuildable && pendingConnectedSources.length > 0) {
    const waitRoot = await updateRootContextState(userId, {
      'aiContext.status': 'processing',
      'aiContext.stage': 'waiting_for_connected_sources',
      'aiContext.progress': 20,
      'aiContext.error': null,
      'aiContext.needsSignalRebuild': true,
      'aiContext.needsPdfRebuild': true,
    });

    return buildResultFromRoot(waitRoot || await findRoot(userId), {
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
    await updateRootContextState(userId, {
      'aiContext.status': 'error',
      'aiContext.stage': 'failed',
      'aiContext.progress': 100,
      'aiContext.finishedAt': nowDate(),
      'aiContext.error': 'MCP_CONTEXT_NO_USABLE_SOURCES',
      'aiContext.needsSignalRebuild': true,
      'aiContext.needsPdfRebuild': true,
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
    const partialWaitRoot = await updateRootContextState(userId, {
      'aiContext.status': 'processing',
      'aiContext.stage': 'waiting_for_connected_sources',
      'aiContext.progress': 30,
      'aiContext.error': null,
      'aiContext.needsSignalRebuild': true,
      'aiContext.needsPdfRebuild': true,
    });

    return buildResultFromRoot(partialWaitRoot || await findRoot(userId), {
      status: 'processing',
      progress: 30,
      stage: 'waiting_for_connected_sources',
      sourceSnapshots,
      contextRangeDays,
      storageRangeDays,
      usableSources,
      pendingConnectedSources,
      sources: sourcesStatus,
    });
  }

  const signalGenerationId = makeGenerationId('sig');

  await McpData.startSignalGeneration(userId, {
    generationId: signalGenerationId,
    sourceFingerprint: currentSourceFingerprint,
    sourcesSnapshot: currentSourcesSnapshot,
    snapshotId:
      sourceSnapshots.metaAds ||
      sourceSnapshots.googleAds ||
      sourceSnapshots.ga4 ||
      preferredSnapshotId ||
      null,
    model: null,
    usedOpenAI: false,
    contextRangeDays,
    storageRangeDays,
    startedAt: nowDate(),
  });

  await updateRootContextState(userId, {
    'aiContext.sourceSnapshots': sourceSnapshots,
    'aiContext.sourcesStatus': sourcesStatus,
    'aiContext.usableSources': usableSources,
    'aiContext.pendingConnectedSources': pendingConnectedSources,
  });

  await McpData.patchSignalGeneration(userId, signalGenerationId, {
    progress: 35,
    stage: 'compacting_sources',
  });

  const metaPack = buildMetaContext(metaChunks, contextRangeDays);
  const googlePack = buildGoogleAdsContext(googleChunks, contextRangeDays);
  const ga4Pack = buildGa4Context(ga4Chunks, contextRangeDays);

  const latestRootForBase = await findRoot(userId);
  if (!latestRootForBase) {
    const err = new Error('MCP_ROOT_NOT_FOUND_AFTER_SIGNAL_START');
    err.code = 'MCP_ROOT_NOT_FOUND_AFTER_SIGNAL_START';
    throw err;
  }

  if (safeStr(latestRootForBase?.aiContext?.signal?.generationId).trim() !== signalGenerationId) {
    return buildResultFromRoot(latestRootForBase, {
      status: latestRootForBase?.aiContext?.status || 'processing',
      progress: toNum(latestRootForBase?.aiContext?.progress, 35),
      stage: latestRootForBase?.aiContext?.stage || 'compacting_sources',
    });
  }

  const unifiedBase = buildUnifiedBaseContext({
    root: latestRootForBase,
    contextRangeDays,
    storageRangeDays,
    sourceStates,
    metaPack,
    googlePack,
    ga4Pack,
    currentSourcesSnapshot,
    currentSourceFingerprint,
  });

  await updateRootContextState(userId, {
    'aiContext.unifiedBase': unifiedBase,
    'aiContext.sourceSnapshots': sourceSnapshots,
  });

  await McpData.patchSignalGeneration(userId, signalGenerationId, {
    progress: 65,
    stage: 'encoding_signal',
    unifiedBase,
    sourcesSnapshot: currentSourcesSnapshot,
    sourceFingerprint: currentSourceFingerprint,
  });

  const encoded = await enrichWithOpenAI(unifiedBase);
  const signalPayload = encoded.payload;

  if (!isSignalPayloadBuildableForPdf(signalPayload)) {
    await updateRootContextState(userId, {
      'aiContext.unifiedBase': unifiedBase,
      'aiContext.encodedPayload': signalPayload,
      'aiContext.signalPayload': signalPayload,
      'aiContext.usedOpenAI': !!encoded.usedOpenAI,
      'aiContext.model': encoded.model || null,
    });

    await McpData.failSignalGeneration(
      userId,
      signalGenerationId,
      'MCP_SIGNAL_NOT_VALID_FOR_PDF',
      {
        stage: 'waiting_for_valid_signal',
        progress: 72,
        finishedAt: nowDate(),
      }
    );

    const finalRoot = await findRoot(userId);
    return buildResultFromRoot(finalRoot, {
      status: 'error',
      progress: 72,
      stage: 'waiting_for_valid_signal',
      sourceSnapshots,
      contextRangeDays,
      storageRangeDays,
      usableSources,
      pendingConnectedSources,
      sources: sourcesStatus,
      unifiedBase,
      encodedPayload: signalPayload,
      signalPayload,
    });
  }

  const finishedSignalRoot = await McpData.finishSignalGeneration(userId, signalGenerationId, {
    payload: signalPayload,
    encodedPayload: signalPayload,
    unifiedBase,
    sourceFingerprint: currentSourceFingerprint,
    sourcesSnapshot: currentSourcesSnapshot,
    snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
    progress: 100,
    stage: 'signal_ready',
    finishedAt: nowDate(),
    version: 1,
    model: encoded.model || null,
    usedOpenAI: !!encoded.usedOpenAI,
    contextRangeDays,
    storageRangeDays,
  });

  await updateRootContextState(userId, {
    'aiContext.sourceSnapshots': sourceSnapshots,
    'aiContext.sourcesStatus': sourcesStatus,
    'aiContext.usableSources': usableSources,
    'aiContext.pendingConnectedSources': pendingConnectedSources,
  });

  const finalRoot = finishedSignalRoot || await findRoot(userId);

  debugFingerprintLog({
    userId,
    label: 'signal_finished',
    root: finalRoot,
    currentSourcesSnapshot,
    currentSourceFingerprint,
    sourceSnapshots,
    usableSources,
    pendingConnectedSources,
  });

  return buildResultFromRoot(finalRoot, {
    status: 'done',
    progress: 100,
    stage: 'signal_ready',
    sourceSnapshots,
    contextRangeDays,
    storageRangeDays,
    usableSources,
    pendingConnectedSources,
    sources: sourcesStatus,
    unifiedBase,
    encodedPayload: signalPayload,
    signalPayload,
  });
}

async function buildPdfForUser(userId) {
  const root = await findRoot(userId);
  if (!root) {
    const err = new Error('MCP_ROOT_NOT_FOUND');
    err.code = 'MCP_ROOT_NOT_FOUND';
    throw err;
  }

  if (!isRootSignalCurrent(root)) {
    const err = new Error('MCP_SIGNAL_STALE_OR_NOT_READY');
    err.code = 'MCP_SIGNAL_STALE_OR_NOT_READY';
    throw err;
  }

  if (isRootPdfCurrent(root)) {
    return buildResultFromRoot(root, {
      status: root?.aiContext?.status || 'done',
      progress: toNum(root?.aiContext?.progress, 100),
      stage: root?.aiContext?.stage || 'signal_ready',
    });
  }

  const ai = root?.aiContext || {};
  const signalPayload = getSignalPayloadFromAi(ai);

  if (!signalPayload) {
    const err = new Error('MCP_CONTEXT_NOT_READY');
    err.code = 'MCP_CONTEXT_NOT_READY';
    throw err;
  }

  if (!isSignalPayloadBuildableForPdf(signalPayload)) {
    const err = new Error('MCP_SIGNAL_NOT_VALID_FOR_PDF');
    err.code = 'MCP_SIGNAL_NOT_VALID_FOR_PDF';
    throw err;
  }

  const pdfGenerationId = makeGenerationId('pdf');

  await McpData.startPdfGeneration(userId, {
    generationId: pdfGenerationId,
    signalGenerationId: ai?.signal?.generationId || null,
    sourceFingerprint: ai?.currentSourceFingerprint || ai?.signal?.sourceFingerprint || null,
    sourcesSnapshot: ai?.currentSourcesSnapshot || ai?.signal?.sourcesSnapshot || null,
    startedAt: nowDate(),
    renderer: null,
  });

  try {
    await McpData.patchPdfGeneration(userId, pdfGenerationId, {
      progress: 45,
      stage: 'building_document',
    });

    const rootBeforePdf = await findRoot(userId);
    if (!rootBeforePdf) {
      const err = new Error('MCP_ROOT_NOT_FOUND_BEFORE_PDF');
      err.code = 'MCP_ROOT_NOT_FOUND_BEFORE_PDF';
      throw err;
    }

    if (!isRootSignalCurrent(rootBeforePdf)) {
      const err = new Error('MCP_SIGNAL_STALE_DURING_PDF_BUILD');
      err.code = 'MCP_SIGNAL_STALE_DURING_PDF_BUILD';
      throw err;
    }

    const pdfResult = await buildSignalPdfArtifact(userId, rootBeforePdf, signalPayload);

    const finishedPdfRoot = await McpData.finishPdfGeneration(userId, pdfGenerationId, {
      signalGenerationId: rootBeforePdf?.aiContext?.signal?.generationId || null,
      sourceFingerprint: rootBeforePdf?.aiContext?.currentSourceFingerprint || null,
      sourcesSnapshot: rootBeforePdf?.aiContext?.currentSourcesSnapshot || null,
      fileName: pdfResult?.fileName || null,
      mimeType: pdfResult?.mimeType || 'application/pdf',
      storageKey: pdfResult?.storageKey || null,
      localPath: pdfResult?.localPath || null,
      downloadUrl: pdfResult?.downloadUrl || null,
      sizeBytes: toNum(pdfResult?.sizeBytes, 0),
      pageCount: toNum(pdfResult?.pageCount, 0) || null,
      renderer: pdfResult?.renderer || null,
      progress: 100,
      stage: 'pdf_ready',
      finishedAt: nowDate(),
      version: 1,
    });

    return buildResultFromRoot(finishedPdfRoot || await findRoot(userId), {
      status: 'done',
      progress: 100,
      stage: 'pdf_ready',
    });
  } catch (pdfErr) {
    console.error('[mcpContextBuilder] PDF generation failed:', pdfErr?.message || pdfErr);

    await McpData.failPdfGeneration(
      userId,
      pdfGenerationId,
      pdfErr?.code || pdfErr?.message || 'SIGNAL_PDF_BUILD_FAILED',
      {
        stage: 'pdf_failed',
        progress: 100,
        finishedAt: nowDate(),
      }
    );

    const err = new Error(pdfErr?.code || pdfErr?.message || 'SIGNAL_PDF_BUILD_FAILED');
    err.code = pdfErr?.code || 'SIGNAL_PDF_BUILD_FAILED';
    err.root = await findRoot(userId);
    throw err;
  }
}

async function rebuildUnifiedContextForUser(userId, options = {}) {
  await markContextStale(userId, options?.reason || 'source_updated', {
    'aiContext.rebuildRequestedAt': nowDate(),
    'aiContext.rebuildRequestedBy': safeStr(options?.requestedBy) || 'system',
  });

  return buildUnifiedContextForUser(userId, {
    explicitSnapshotId: options?.explicitSnapshotId || null,
    contextRangeDays: options?.contextRangeDays || null,
    timeoutMs: options?.timeoutMs || BUILD_WAIT_TIMEOUT_MS,
    forceRebuild: !!options?.forceRebuild || true,
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
  updateRootAiContext,
  markContextStale,
  buildUnifiedContextForUser,
  buildPdfForUser,
  rebuildUnifiedContextForUser,
  sourceStateSummaryForStatus,
  makeShareToken,
};