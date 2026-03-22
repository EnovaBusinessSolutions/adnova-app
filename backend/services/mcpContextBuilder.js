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

function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSortObject(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableJson(value) {
  try {
    return JSON.stringify(stableSortObject(value || null));
  } catch (_) {
    return '';
  }
}

function buildSignalFingerprintFromParts({
  snapshotId = null,
  sourceSnapshots = null,
  contextRangeDays = null,
  storageRangeDays = null,
}) {
  const raw = stableJson({
    snapshotId: safeStr(snapshotId).trim() || null,
    sourceSnapshots: sourceSnapshots || null,
    contextRangeDays: toNum(contextRangeDays) || null,
    storageRangeDays: toNum(storageRangeDays) || null,
  });

  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function buildSignalFingerprint(ai) {
  return buildSignalFingerprintFromParts({
    snapshotId: ai?.snapshotId || null,
    sourceSnapshots: ai?.sourceSnapshots || null,
    contextRangeDays: ai?.contextRangeDays || null,
    storageRangeDays: ai?.storageRangeDays || null,
  });
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
    signalFingerprint: null,
    signalSnapshotId: null,
    signalSourceSnapshots: null,
    signalGeneratedAt: null,
    ...extra,
  };
}

function normalizePdfState(pdf) {
  const state = pdf || {};
  return {
    ...emptyPdfState(),
    ...state,
    status: safeStr(state?.status) || 'idle',
    stage: safeStr(state?.stage) || 'idle',
    progress: toNum(state?.progress, 0),
    sizeBytes: toNum(state?.sizeBytes, 0),
    pageCount: toNum(state?.pageCount, 0) || null,
    version: toNum(state?.version, 1) || 1,
  };
}

function isPdfCurrentForAi(ai) {
  const pdf = normalizePdfState(ai?.pdf);
  if (pdf.status !== 'ready') return false;

  const currentFingerprint = buildSignalFingerprint(ai);
  const pdfFingerprint = safeStr(pdf?.signalFingerprint).trim();

  if (!currentFingerprint || !pdfFingerprint) return false;
  return currentFingerprint === pdfFingerprint;
}

function makeBuildAttemptId() {
  return `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function parseDateMs(v) {
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

function isRecentProcessingState(ai) {
  if (!ai || ai.status !== 'processing' || !ai.buildAttemptId) return false;
  const startedMs = parseDateMs(ai.startedAt);
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

    if (usableSources.length > 0) {
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
        connected: !!(sources?.metaAds?.connected || metaState?.hasChunks),
        ready: !!(sources?.metaAds?.ready || metaState?.usable),
        usable: !!metaState?.usable,
        accountId: sources?.metaAds?.accountId || null,
        name: sources?.metaAds?.name || null,
        currency: sources?.metaAds?.currency || null,
        timezone: sources?.metaAds?.timezone || null,
        snapshotId: metaState?.snapshotId || null,
        chunkCount: toNum(metaState?.chunkCount, 0),
        storageRangeDays: toNum(sources?.metaAds?.storageRangeDays) || toNum(sources?.metaAds?.rangeDays) || storageRangeDays || null,
        contextDefaultRangeDays: toNum(sources?.metaAds?.contextDefaultRangeDays) || contextRangeDays || null,
      },
      googleAds: {
        connected: !!(sources?.googleAds?.connected || googleState?.hasChunks),
        ready: !!(sources?.googleAds?.ready || googleState?.usable),
        usable: !!googleState?.usable,
        customerId: sources?.googleAds?.customerId || sources?.googleAds?.accountId || null,
        name: sources?.googleAds?.name || null,
        currency: sources?.googleAds?.currency || null,
        timezone: sources?.googleAds?.timezone || null,
        snapshotId: googleState?.snapshotId || null,
        chunkCount: toNum(googleState?.chunkCount, 0),
        storageRangeDays: toNum(sources?.googleAds?.storageRangeDays) || toNum(sources?.googleAds?.rangeDays) || storageRangeDays || null,
        contextDefaultRangeDays: toNum(sources?.googleAds?.contextDefaultRangeDays) || contextRangeDays || null,
      },
      ga4: {
        connected: !!(sources?.ga4?.connected || ga4State?.hasChunks),
        ready: !!(sources?.ga4?.ready || ga4State?.usable),
        usable: !!ga4State?.usable,
        propertyId: sources?.ga4?.propertyId || null,
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
  const pdf = normalizePdfState(state?.pdf);
  const pdfCurrent = isPdfCurrentForAi(state);

  return {
    ok: true,
    root,
    unifiedBase: state?.unifiedBase || fallback.unifiedBase || null,
    encodedPayload: state?.encodedPayload || fallback.encodedPayload || null,
    signalPayload: state?.signalPayload || state?.encodedPayload || fallback.signalPayload || null,
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
      hasEncodedPayload: !!state?.encodedPayload,
      hasSignal: !!(state?.signalPayload || state?.encodedPayload),
      providerAgnostic: !!state?.encodedPayload?.providerAgnostic,
      usableSources: Array.isArray(state?.usableSources) ? state.usableSources : (fallback.usableSources || []),
      pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : (fallback.pendingConnectedSources || []),
      sources: state?.sourcesStatus || fallback.sources || null,

      hasPdf: pdf.status === 'ready',
      pdfCurrent,
      canDownloadPdf: pdf.status === 'ready' && pdfCurrent,
      canGeneratePdf: !!(state?.signalPayload || state?.encodedPayload) && !pdfCurrent,

      pdf: {
        status: pdf.status,
        stage: pdf.stage,
        progress: pdf.progress,
        ready: pdf.status === 'ready',
        current: pdfCurrent,
        fileName: pdf.fileName || null,
        mimeType: pdf.mimeType || 'application/pdf',
        storageKey: pdf.storageKey || null,
        localPath: pdf.localPath || null,
        downloadUrl: pdf.downloadUrl || null,
        generatedAt: pdf.generatedAt || null,
        sizeBytes: pdf.sizeBytes,
        pageCount: pdf.pageCount,
        renderer: pdf.renderer || null,
        version: pdf.version || 1,
        error: pdf.error || null,
        signalFingerprint: pdf.signalFingerprint || null,
        signalSnapshotId: pdf.signalSnapshotId || null,
        signalSourceSnapshots: pdf.signalSourceSnapshots || null,
        signalGeneratedAt: pdf.signalGeneratedAt || null,
      },

      error: state?.error || null,
      buildAttemptId: state?.buildAttemptId || null,
    },
  };
}

async function markContextStale(userId, reason = 'source_updated', extra = {}) {
  const root = await findRoot(userId);
  if (!root?._id) return null;

  const prevAi = root?.aiContext || {};

  return McpData.findByIdAndUpdate(
    root._id,
    {
      $set: {
        aiContext: {
          ...prevAi,
          status: 'idle',
          stage: 'awaiting_rebuild',
          progress: 0,
          staleReason: safeStr(reason) || 'source_updated',
          staleAt: nowIso(),
          error: null,
          pdf: emptyPdfState(),
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
  } = options || {};

  const initialRoot = await findRoot(userId);
  if (!initialRoot) {
    const err = new Error('MCP_ROOT_NOT_FOUND');
    err.code = 'MCP_ROOT_NOT_FOUND';
    throw err;
  }

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

  if (markProcessing) {
    await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      status: 'processing',
      progress: 10,
      stage: 'waiting_for_sources',
      startedAt,
      finishedAt: null,
      buildAttemptId: attemptId,
      snapshotId: currentAi?.snapshotId || preferredSnapshotId,
      sourceSnapshots: currentAi?.sourceSnapshots || null,
      contextRangeDays,
      storageRangeDays,
      error: null,
      usedOpenAI: !!currentAi?.usedOpenAI,
      model: currentAi?.model || null,
      unifiedBase: currentAi?.unifiedBase || null,
      encodedPayload: currentAi?.encodedPayload || null,
      signalPayload: currentAi?.signalPayload || null,
      usableSources: Array.isArray(currentAi?.usableSources) ? currentAi.usableSources : [],
      pendingConnectedSources: Array.isArray(currentAi?.pendingConnectedSources) ? currentAi.pendingConnectedSources : [],
      sourcesStatus: currentAi?.sourcesStatus || null,
      pdf: normalizePdfState(currentAi?.pdf),
    }));
  }

  const readyState = await waitForBuildableSources(userId, initialRoot, explicitSnapshotId, timeoutMs);
  const effectiveRoot = readyState?.root || await findRoot(userId);

  if (safeStr(effectiveRoot?.aiContext?.buildAttemptId).trim() !== attemptId) {
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

  if (!hasAnyBuildable && pendingConnectedSources.length > 0) {
    const waitResult = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
      ...(currentAi || {}),
      status: 'processing',
      progress: 20,
      stage: 'waiting_for_connected_sources',
      startedAt: currentAi?.startedAt || startedAt,
      finishedAt: null,
      buildAttemptId: attemptId,
      snapshotId: currentAi?.snapshotId || sourceSnapshots.metaAds || sourceSnapshots.googleAds || sourceSnapshots.ga4 || preferredSnapshotId || null,
      sourceSnapshots: currentAi?.sourceSnapshots || sourceSnapshots || null,
      contextRangeDays,
      storageRangeDays,
      sourcesStatus,
      usableSources,
      pendingConnectedSources,
      error: null,
      pdf: normalizePdfState(currentAi?.pdf),
    }));

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
      sourcesStatus,
      usableSources,
      pendingConnectedSources,
      error: 'MCP_CONTEXT_NO_USABLE_SOURCES',
      unifiedBase: null,
      encodedPayload: null,
      signalPayload: null,
      pdf: emptyPdfState({ status: 'idle', stage: 'idle', progress: 0 }),
    }));

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

  if (pendingConnectedSources.length > 0 && usableSources.length === 0) {
    const partialWait = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
      ...(currentAi || {}),
      status: 'processing',
      progress: 30,
      stage: 'waiting_for_connected_sources',
      startedAt: currentAi?.startedAt || startedAt,
      finishedAt: null,
      buildAttemptId: attemptId,
      snapshotId:
        currentAi?.snapshotId ||
        sourceSnapshots.metaAds ||
        sourceSnapshots.googleAds ||
        sourceSnapshots.ga4 ||
        preferredSnapshotId ||
        null,
      sourceSnapshots: currentAi?.sourceSnapshots || sourceSnapshots || null,
      contextRangeDays,
      storageRangeDays,
      sourcesStatus,
      usableSources,
      pendingConnectedSources,
      error: null,
      pdf: normalizePdfState(currentAi?.pdf),
    }));

    const finalRoot = partialWait?.root || await findRoot(userId);
    return buildResultFromRoot(finalRoot, {
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

  await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
    ...(currentAi || {}),
    status: 'processing',
    progress: 35,
    stage: 'compacting_sources',
    startedAt: currentAi?.startedAt || startedAt,
    finishedAt: null,
    buildAttemptId: attemptId,
    snapshotId:
      currentAi?.snapshotId ||
      sourceSnapshots.metaAds ||
      sourceSnapshots.googleAds ||
      sourceSnapshots.ga4 ||
      preferredSnapshotId ||
      null,
    sourceSnapshots: currentAi?.sourceSnapshots || sourceSnapshots || null,
    contextRangeDays,
    storageRangeDays,
    sourcesStatus,
    usableSources,
    pendingConnectedSources,
    error: null,
    pdf: normalizePdfState(currentAi?.pdf),
  }));

  const metaPack = buildMetaContext(metaChunks, contextRangeDays);
  const googlePack = buildGoogleAdsContext(googleChunks, contextRangeDays);
  const ga4Pack = buildGa4Context(ga4Chunks, contextRangeDays);

  const latestRootForBase = await findRoot(userId);
  if (safeStr(latestRootForBase?.aiContext?.buildAttemptId).trim() !== attemptId) {
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

  const unifiedBase = buildUnifiedBaseContext({
    root: latestRootForBase,
    contextRangeDays,
    storageRangeDays,
    sourceStates: hydratedSourceStates,
    metaPack,
    googlePack,
    ga4Pack,
  });

  const nextSignalFingerprint = buildSignalFingerprintFromParts({
    snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
    sourceSnapshots,
    contextRangeDays,
    storageRangeDays,
  });

  await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
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
    storageRangeDays,
    unifiedBase,
    sourcesStatus,
    usableSources,
    pendingConnectedSources,
    error: null,
    pdf: normalizePdfState(currentAi?.pdf),
    nextSignalFingerprint,
  }));

  const encoded = await enrichWithOpenAI(unifiedBase);
  const signalPayload = encoded.payload;

  if (!isSignalPayloadBuildableForPdf(signalPayload)) {
    await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => ({
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
      storageRangeDays,
      unifiedBase,
      encodedPayload: signalPayload,
      signalPayload,
      usedOpenAI: !!encoded.usedOpenAI,
      model: encoded.model || null,
      sourcesStatus,
      usableSources,
      pendingConnectedSources,
      error: null,
      pdf: normalizePdfState(currentAi?.pdf),
      nextSignalFingerprint,
    }));

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
      encodedPayload: signalPayload,
      signalPayload,
    });
  }

  const finalUpdate = await updateRootAiContextForAttempt(userId, attemptId, (currentAi) => {
    const existingPdf = normalizePdfState(currentAi?.pdf);
    const existingPdfFingerprint = safeStr(existingPdf?.signalFingerprint).trim();
    const preserveExistingPdf =
      existingPdf.status === 'ready' &&
      !!existingPdfFingerprint &&
      existingPdfFingerprint === nextSignalFingerprint;

    return {
      ...(currentAi || {}),
      status: 'done',
      progress: 100,
      stage: 'completed',
      startedAt: currentAi?.startedAt || startedAt,
      finishedAt: nowIso(),
      buildAttemptId: attemptId,
      snapshotId: unifiedBase?.snapshotId || preferredSnapshotId || null,
      sourceSnapshots,
      contextRangeDays,
      storageRangeDays,
      error: null,
      unifiedBase,
      encodedPayload: signalPayload,
      signalPayload,
      usedOpenAI: !!encoded.usedOpenAI,
      model: encoded.model || null,
      sourcesStatus,
      usableSources,
      pendingConnectedSources,
      pdf: preserveExistingPdf
        ? {
            ...existingPdf,
            status: 'ready',
            stage: 'ready',
            progress: 100,
          }
        : emptyPdfState({
            status: 'idle',
            stage: 'idle',
            progress: 0,
          }),
      nextSignalFingerprint: null,
    };
  });

  const freshRoot = finalUpdate?.root || await findRoot(userId);
  return buildResultFromRoot(freshRoot, {
    status: 'done',
    progress: 100,
    stage: 'completed',
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

  const ai = root?.aiContext || {};
  const signalPayload = ai?.signalPayload || ai?.encodedPayload || null;
  const pdfState = normalizePdfState(ai?.pdf);

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

  if (pdfState.status === 'ready' && isPdfCurrentForAi(ai)) {
    return buildResultFromRoot(root, {
      status: ai?.status || 'done',
      progress: toNum(ai?.progress, 100),
      stage: ai?.stage || 'completed',
    });
  }

  if (pdfState.status === 'processing') {
    return buildResultFromRoot(root, {
      status: ai?.status || 'done',
      progress: toNum(ai?.progress, 100),
      stage: ai?.stage || 'completed',
    });
  }

  await updateRootAiContext(userId, (currentAi) => ({
    ...(currentAi || {}),
    status: currentAi?.status === 'done' ? 'done' : (currentAi?.status || 'done'),
    progress: currentAi?.status === 'done' ? 100 : toNum(currentAi?.progress, 100),
    stage: currentAi?.status === 'done' ? 'completed' : (currentAi?.stage || 'completed'),
    error: currentAi?.error || null,
    pdf: {
      ...normalizePdfState(currentAi?.pdf),
      status: 'processing',
      stage: 'building_document',
      progress: 15,
      error: null,
    },
  }));

  try {
    const rootBeforePdf = await findRoot(userId);

    await updateRootAiContext(userId, (currentAi) => ({
      ...(currentAi || {}),
      pdf: {
        ...normalizePdfState(currentAi?.pdf),
        status: 'processing',
        stage: 'building_document',
        progress: 45,
        error: null,
      },
    }));

    const pdfResult = await buildSignalPdfArtifact(userId, rootBeforePdf, signalPayload);

    const finalRoot = await updateRootAiContext(userId, (currentAi) => {
      const signalFingerprint = buildSignalFingerprint(currentAi || {});
      return {
        ...(currentAi || {}),
        status: currentAi?.status === 'error' ? 'done' : (currentAi?.status || 'done'),
        progress: currentAi?.status === 'done' ? 100 : Math.max(100, toNum(currentAi?.progress, 100)),
        stage: currentAi?.stage === 'failed' ? 'completed' : (currentAi?.stage || 'completed'),
        error: null,
        pdf: {
          ...normalizePdfState(currentAi?.pdf),
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
          version: 1,
          error: null,
          signalFingerprint: signalFingerprint || null,
          signalSnapshotId: currentAi?.snapshotId || null,
          signalSourceSnapshots: currentAi?.sourceSnapshots || null,
          signalGeneratedAt: currentAi?.finishedAt || null,
        },
      };
    });

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
      pdf: {
        ...normalizePdfState(currentAi?.pdf),
        status: 'failed',
        stage: 'failed',
        progress: 100,
        generatedAt: null,
        error: pdfErr?.code || pdfErr?.message || 'SIGNAL_PDF_BUILD_FAILED',
      },
    }));

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
  buildSignalFingerprint,
  isPdfCurrentForAi,
};