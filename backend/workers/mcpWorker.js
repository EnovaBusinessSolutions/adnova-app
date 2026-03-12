'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const IORedis = require('ioredis');

const { collectMeta } = require('../jobs/collect/metaCollector');
const { collectGoogle } = require('../jobs/collect/googleCollector');
const { collectGA4 } = require('../jobs/collect/googleAnalyticsCollector');
const {
  rebuildUnifiedContextForUser,
} = require('../services/mcpContextBuilder');
const McpData = require('../models/McpData');
const User = require('../models/User');

/* =========================
 * ENV + Connections
 * ========================= */
const MONGO_URI = process.env.MONGO_URI || '';
const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_NAME = process.env.MCP_QUEUE_NAME || 'mcp-collect';
const BULLMQ_PREFIX = process.env.BULLMQ_PREFIX || 'bull';

const DEFAULT_STORAGE_RANGE_DAYS = clampInt(
  process.env.MCP_STORAGE_RANGE_DAYS || 730,
  30,
  3650
);

const DEFAULT_CONTEXT_RANGE_DAYS = clampInt(
  process.env.MCP_CONTEXT_RANGE_DAYS || 60,
  7,
  365
);

const WORKER_CONTEXT_REBUILD_TIMEOUT_MS = clampInt(
  process.env.MCP_WORKER_CONTEXT_REBUILD_TIMEOUT_MS || 15000,
  3000,
  120000
);

if (!MONGO_URI) {
  console.error('[mcpWorker] Missing MONGO_URI in environment');
  process.exit(1);
}
if (!REDIS_URL) {
  console.error('[mcpWorker] Missing REDIS_URL in environment');
  process.exit(1);
}

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

/* =========================
 * Helpers
 * ========================= */
function ymdUTC(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

function makeSnapshotId(d = new Date()) {
  const iso = new Date(d).toISOString().replace(/[:.]/g, '-');
  return `snap_${iso}`;
}

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeString(v) {
  return v == null ? null : String(v);
}

function estimateBytes(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj ?? null), 'utf8');
  } catch {
    return 0;
  }
}

function inferRowsFromDataset(datasetName, data) {
  const ds = String(datasetName || '');

  if (!data || typeof data !== 'object') return 0;

  /* ================= META ================= */
  if (ds === 'meta.insights_summary') {
    return 1;
  }

  if (ds === 'meta.campaigns_ranked') {
    return Array.isArray(data?.campaigns_ranked) ? data.campaigns_ranked.length : 0;
  }

  if (ds === 'meta.breakdowns_top') {
    return (
      (Array.isArray(data?.device_top) ? data.device_top.length : 0) +
      (Array.isArray(data?.placement_top) ? data.placement_top.length : 0) +
      (Array.isArray(data?.country_top) ? data.country_top.length : 0) +
      (Array.isArray(data?.region_top) ? data.region_top.length : 0) +
      (Array.isArray(data?.creative_type_top) ? data.creative_type_top.length : 0)
    );
  }

  if (ds === 'meta.optimization_signals') {
    const s = data?.optimization_signals || {};
    return (
      (Array.isArray(s.winners) ? s.winners.length : 0) +
      (Array.isArray(s.risks) ? s.risks.length : 0) +
      (Array.isArray(s.quick_wins) ? s.quick_wins.length : 0) +
      (Array.isArray(s.insights) ? s.insights.length : 0) +
      (Array.isArray(s.recommendations) ? s.recommendations.length : 0)
    );
  }

  if (ds === 'meta.daily_trends_ai') {
    return (
      (Array.isArray(data?.totals_by_day) ? data.totals_by_day.length : 0) +
      (Array.isArray(data?.campaigns_daily) ? data.campaigns_daily.length : 0)
    );
  }

  if (ds === 'meta.history.daily_account_totals') {
    return Array.isArray(data?.totals_by_day) ? data.totals_by_day.length : 0;
  }

  if (ds.startsWith('meta.history.daily_campaigns.')) {
    return Array.isArray(data?.campaigns_daily) ? data.campaigns_daily.length : 0;
  }

  /* ================= GOOGLE ADS ================= */
  if (ds === 'google.insights_summary') {
    return 1;
  }

  if (ds === 'google.campaigns_ranked') {
    return Array.isArray(data?.campaigns_ranked) ? data.campaigns_ranked.length : 0;
  }

  if (ds === 'google.breakdowns_top') {
    return (
      (Array.isArray(data?.device_top) ? data.device_top.length : 0) +
      (Array.isArray(data?.network_top) ? data.network_top.length : 0)
    );
  }

  if (ds === 'google.optimization_signals') {
    const s = data?.optimization_signals || {};
    return (
      (Array.isArray(s.winners) ? s.winners.length : 0) +
      (Array.isArray(s.risks) ? s.risks.length : 0) +
      (Array.isArray(s.quick_wins) ? s.quick_wins.length : 0) +
      (Array.isArray(s.insights) ? s.insights.length : 0) +
      (Array.isArray(s.recommendations) ? s.recommendations.length : 0)
    );
  }

  if (ds === 'google.daily_trends_ai') {
    return (
      (Array.isArray(data?.totals_by_day) ? data.totals_by_day.length : 0) +
      (Array.isArray(data?.campaigns_daily) ? data.campaigns_daily.length : 0)
    );
  }

  /* ================= GA4 ================= */
  if (ds === 'ga4.insights_summary') {
    return 1;
  }

  if (ds === 'ga4.channels_top') {
    return Array.isArray(data?.channels_top) ? data.channels_top.length : 0;
  }

  if (ds === 'ga4.devices_top') {
    return Array.isArray(data?.devices_top) ? data.devices_top.length : 0;
  }

  if (ds === 'ga4.landing_pages_top') {
    return Array.isArray(data?.landing_pages_top) ? data.landing_pages_top.length : 0;
  }

  if (ds === 'ga4.source_medium_top') {
    return Array.isArray(data?.source_medium_top) ? data.source_medium_top.length : 0;
  }

  if (ds === 'ga4.events_top') {
    return Array.isArray(data?.events_top) ? data.events_top.length : 0;
  }

  if (ds === 'ga4.optimization_signals') {
    const s = data?.optimization_signals || {};
    return (
      (Array.isArray(s.winners) ? s.winners.length : 0) +
      (Array.isArray(s.risks) ? s.risks.length : 0) +
      (Array.isArray(s.quick_wins) ? s.quick_wins.length : 0) +
      (Array.isArray(s.insights) ? s.insights.length : 0) +
      (Array.isArray(s.recommendations) ? s.recommendations.length : 0)
    );
  }

  if (ds === 'ga4.daily_trends_ai') {
    return Array.isArray(data?.totals_by_day) ? data.totals_by_day.length : 0;
  }

  let total = 0;
  for (const v of Object.values(data)) {
    if (Array.isArray(v)) total += v.length;
  }
  return total;
}

function buildChunkStats(datasetName, data, stats) {
  const rows = stats?.rows != null ? toNum(stats.rows) : inferRowsFromDataset(datasetName, data);
  const bytes = stats?.bytes != null ? toNum(stats.bytes) : estimateBytes(data);
  return { rows, bytes };
}

function summarizeDatasets(datasets) {
  const out = {};
  for (const ds of Array.isArray(datasets) ? datasets : []) {
    out[String(ds?.dataset || 'unknown')] = buildChunkStats(ds?.dataset, ds?.data, ds?.stats);
  }
  return out;
}

function buildRootStatsFromDatasetSummary(datasetSummary) {
  return {
    rows: Object.values(datasetSummary).reduce((acc, s) => acc + toNum(s.rows), 0),
    bytes: Object.values(datasetSummary).reduce((acc, s) => acc + toNum(s.bytes), 0),
  };
}

function pickCoverageRange(result, summaryDs) {
  return {
    from:
      safeString(result?.timeRange?.from) ||
      safeString(result?.timeRange?.since) ||
      safeString(result?.range?.from) ||
      safeString(summaryDs?.range?.from) ||
      null,
    to:
      safeString(result?.timeRange?.to) ||
      safeString(result?.timeRange?.until) ||
      safeString(result?.range?.to) ||
      safeString(summaryDs?.range?.to) ||
      null,
    tz:
      safeString(result?.timeRange?.tz) ||
      safeString(result?.range?.tz) ||
      safeString(summaryDs?.range?.tz) ||
      null,
  };
}

function pickStorageCoverageRange(result, summaryDs) {
  return {
    from:
      safeString(result?.storageTimeRange?.from) ||
      safeString(result?.storageTimeRange?.since) ||
      safeString(summaryDs?.data?.meta?.range?.from) ||
      safeString(summaryDs?.range?.from) ||
      null,
    to:
      safeString(result?.storageTimeRange?.to) ||
      safeString(result?.storageTimeRange?.until) ||
      safeString(summaryDs?.data?.meta?.range?.to) ||
      safeString(summaryDs?.range?.to) ||
      null,
    tz:
      safeString(result?.storageTimeRange?.tz) ||
      safeString(summaryDs?.data?.meta?.range?.tz) ||
      safeString(summaryDs?.range?.tz) ||
      null,
  };
}

function pickContextCoverageRange(result, summaryDs) {
  return {
    from:
      safeString(result?.contextTimeRange?.from) ||
      safeString(result?.contextTimeRange?.since) ||
      safeString(result?.timeRange?.from) ||
      safeString(result?.timeRange?.since) ||
      safeString(summaryDs?.range?.from) ||
      null,
    to:
      safeString(result?.contextTimeRange?.to) ||
      safeString(result?.contextTimeRange?.until) ||
      safeString(result?.timeRange?.to) ||
      safeString(result?.timeRange?.until) ||
      safeString(summaryDs?.range?.to) ||
      null,
    tz:
      safeString(result?.contextTimeRange?.tz) ||
      safeString(result?.timeRange?.tz) ||
      safeString(summaryDs?.range?.tz) ||
      null,
  };
}

function extractMetaRootPatchFromResult(r, ranges = {}) {
  const summaryDs = Array.isArray(r?.datasets)
    ? r.datasets.find((x) => x?.dataset === 'meta.insights_summary') || r.datasets[0]
    : null;

  const meta = summaryDs?.data?.meta || null;
  const accounts = Array.isArray(meta?.accounts) ? meta.accounts : [];
  const firstAccount = accounts[0] || null;

  const coverageRange = pickCoverageRange(r, summaryDs);
  const storageRange = pickStorageCoverageRange(r, summaryDs);
  const contextRange = pickContextCoverageRange(r, summaryDs);

  const storageRangeDays =
    toNum(r?.storageRangeDays) ||
    toNum(meta?.storageRangeDays) ||
    toNum(ranges?.storageRangeDays) ||
    DEFAULT_STORAGE_RANGE_DAYS;

  const contextRangeDays =
    toNum(r?.contextRangeDays) ||
    toNum(meta?.contextRangeDays) ||
    toNum(ranges?.contextRangeDays) ||
    DEFAULT_CONTEXT_RANGE_DAYS;

  const accountId =
    safeString(firstAccount?.id) ||
    (Array.isArray(r?.accountIds) && r.accountIds.length ? safeString(r.accountIds[0]) : null) ||
    safeString(r?.defaultAccountId) ||
    null;

  const name = safeString(firstAccount?.name) || null;
  const currency = safeString(firstAccount?.currency) || safeString(r?.currency) || null;
  const timezone =
    safeString(firstAccount?.timezone_name) ||
    safeString(firstAccount?.timezone) ||
    safeString(contextRange?.tz) ||
    safeString(storageRange?.tz) ||
    safeString(coverageRange?.tz) ||
    null;

  return {
    sourceName: 'metaAds',
    sourcePatch: {
      connected: true,
      status: 'ready',
      ready: true,
      lastError: null,
      lastSyncAt: new Date(),
      rangeDays: storageRangeDays,
      storageRangeDays,
      contextDefaultRangeDays: contextRangeDays,
      accountId,
      name,
      currency,
      timezone,
    },
    rootPatch: {
      latestSnapshotId: null,
      coverage: {
        range: coverageRange,
        storageRange,
        contextRange,
        defaultRangeDays: contextRangeDays,
        storageRangeDays,
        contextDefaultRangeDays: contextRangeDays,
        granularity: [
          'summary',
          'ranked_campaigns',
          'breakdown',
          'signals',
          'daily_ai',
          'history_daily_totals',
          'history_daily_campaigns',
        ],
      },
    },
    metaSummary: {
      accountId,
      name,
      currency,
      timezone,
      range: coverageRange,
      storageRange,
      contextRange,
      storageRangeDays,
      contextRangeDays,
    },
  };
}

function extractGoogleRootPatchFromResult(r, ranges = {}) {
  const summaryDs = Array.isArray(r?.datasets)
    ? r.datasets.find((x) => x?.dataset === 'google.insights_summary') || r.datasets[0]
    : null;

  const meta = summaryDs?.data?.meta || null;
  const accounts = Array.isArray(meta?.accounts) ? meta.accounts : [];
  const firstAccount = accounts[0] || null;

  const coverageRange = pickCoverageRange(r, summaryDs);
  const storageRange = pickStorageCoverageRange(r, summaryDs);
  const contextRange = pickContextCoverageRange(r, summaryDs);

  const storageRangeDays =
    toNum(r?.storageRangeDays) ||
    toNum(meta?.storageRangeDays) ||
    toNum(ranges?.storageRangeDays) ||
    DEFAULT_STORAGE_RANGE_DAYS;

  const contextRangeDays =
    toNum(r?.contextRangeDays) ||
    toNum(meta?.contextRangeDays) ||
    toNum(ranges?.contextRangeDays) ||
    DEFAULT_CONTEXT_RANGE_DAYS;

  const customerId =
    safeString(firstAccount?.id) ||
    (Array.isArray(r?.accountIds) && r.accountIds.length ? safeString(r.accountIds[0]) : null) ||
    safeString(r?.defaultCustomerId) ||
    null;

  const name = safeString(firstAccount?.name) || null;
  const currency = safeString(firstAccount?.currency) || safeString(r?.currency) || null;
  const timezone =
    safeString(firstAccount?.timezone_name) ||
    safeString(firstAccount?.timezone) ||
    safeString(r?.timeZone) ||
    safeString(contextRange?.tz) ||
    safeString(storageRange?.tz) ||
    safeString(coverageRange?.tz) ||
    null;

  return {
    sourceName: 'googleAds',
    sourcePatch: {
      connected: true,
      status: 'ready',
      ready: true,
      lastError: null,
      lastSyncAt: new Date(),
      rangeDays: storageRangeDays,
      storageRangeDays,
      contextDefaultRangeDays: contextRangeDays,
      customerId,
      accountId: customerId,
      name,
      currency,
      timezone,
    },
    rootPatch: {
      latestSnapshotId: null,
      coverage: {
        range: coverageRange,
        storageRange,
        contextRange,
        defaultRangeDays: contextRangeDays,
        storageRangeDays,
        contextDefaultRangeDays: contextRangeDays,
        granularity: ['summary', 'ranked_campaigns', 'breakdown', 'signals', 'daily_ai'],
      },
    },
    metaSummary: {
      customerId,
      name,
      currency,
      timezone,
      range: coverageRange,
      storageRange,
      contextRange,
      storageRangeDays,
      contextRangeDays,
    },
  };
}

function extractGa4RootPatchFromResult(r, ranges = {}) {
  const summaryDs = Array.isArray(r?.datasets)
    ? r.datasets.find((x) => x?.dataset === 'ga4.insights_summary') || r.datasets[0]
    : null;

  const meta = summaryDs?.data?.meta || null;
  const properties = Array.isArray(meta?.properties) ? meta.properties : [];
  const firstProperty = properties[0] || null;

  const coverageRange = pickCoverageRange(r, summaryDs);
  const storageRange = pickStorageCoverageRange(r, summaryDs);
  const contextRange = pickContextCoverageRange(r, summaryDs);

  const storageRangeDays =
    toNum(r?.storageRangeDays) ||
    toNum(meta?.storageRangeDays) ||
    toNum(ranges?.storageRangeDays) ||
    DEFAULT_STORAGE_RANGE_DAYS;

  const contextRangeDays =
    toNum(r?.contextRangeDays) ||
    toNum(meta?.contextRangeDays) ||
    toNum(ranges?.contextRangeDays) ||
    DEFAULT_CONTEXT_RANGE_DAYS;

  const propertyId =
    safeString(firstProperty?.id) ||
    (Array.isArray(r?.properties) && r.properties.length ? safeString(r.properties[0]?.id) : null) ||
    safeString(r?.defaultPropertyId) ||
    null;

  const name = safeString(firstProperty?.name) || null;
  const currency = safeString(firstProperty?.currencyCode) || null;
  const timezone =
    safeString(firstProperty?.timeZone) ||
    safeString(contextRange?.tz) ||
    safeString(storageRange?.tz) ||
    safeString(coverageRange?.tz) ||
    null;

  return {
    sourceName: 'ga4',
    sourcePatch: {
      connected: true,
      status: 'ready',
      ready: true,
      lastError: null,
      lastSyncAt: new Date(),
      rangeDays: storageRangeDays,
      storageRangeDays,
      contextDefaultRangeDays: contextRangeDays,
      propertyId,
      name,
      currency,
      timezone,
    },
    rootPatch: {
      latestSnapshotId: null,
      coverage: {
        range: coverageRange,
        storageRange,
        contextRange,
        defaultRangeDays: contextRangeDays,
        storageRangeDays,
        contextDefaultRangeDays: contextRangeDays,
        granularity: [
          'summary',
          'channels',
          'devices',
          'landing_pages',
          'source_medium',
          'events',
          'signals',
          'daily_ai',
        ],
      },
    },
    metaSummary: {
      propertyId,
      name,
      currency,
      timezone,
      range: coverageRange,
      storageRange,
      contextRange,
      storageRangeDays,
      contextRangeDays,
    },
  };
}

async function resolveContextRangeDaysByPlan(userId, requestedDays) {
  if (requestedDays) {
    return clampInt(requestedDays, 7, 365);
  }

  const envDefault = clampInt(
    process.env.MCP_CONTEXT_RANGE_DAYS || DEFAULT_CONTEXT_RANGE_DAYS,
    7,
    365
  );
  if (envDefault) return envDefault;

  const u = await User.findById(userId).select('plan').lean();
  const plan = String(u?.plan || 'gratis').toLowerCase();

  if (plan === 'gratis' || plan === 'free') return 60;
  if (plan === 'pro' || plan === 'crecimiento' || plan === 'growth' || plan === 'enterprise') {
    return 60;
  }

  return 60;
}

async function resolveStorageRangeDays(_userId, requestedDays) {
  if (requestedDays) {
    return clampInt(requestedDays, 30, 3650);
  }
  return clampInt(
    process.env.MCP_STORAGE_RANGE_DAYS || DEFAULT_STORAGE_RANGE_DAYS,
    30,
    3650
  );
}

async function saveCollectorDatasets({ userId, snapshotId, datasets }) {
  for (const ds of datasets || []) {
    const enrichedStats = buildChunkStats(ds?.dataset, ds?.data, ds?.stats);

    await McpData.upsertChunk({
      userId,
      snapshotId,
      source: ds.source,
      dataset: ds.dataset,
      range: ds.range,
      data: ds.data,
      stats: enrichedStats,
    });

    console.log('[mcpWorker] chunk upserted', {
      userId: String(userId),
      snapshotId,
      dataset: ds?.dataset,
      source: ds?.source,
      range: ds?.range || null,
      stats: enrichedStats,
    });
  }
}

async function finalizeRootFromCollector({
  userId,
  snapshotId,
  datasets,
  extractedRoot,
}) {
  const datasetSummary = summarizeDatasets(datasets);

  await McpData.patchRootSource(userId, extractedRoot.sourceName, extractedRoot.sourcePatch);

  await McpData.upsertRoot(userId, {
    latestSnapshotId: snapshotId,
    coverage: extractedRoot.rootPatch.coverage,
    stats: buildRootStatsFromDatasetSummary(datasetSummary),
  });

  console.log('[mcpWorker] root enriched', {
    userId: String(userId),
    snapshotId,
    source: extractedRoot.sourceName,
    summary: extractedRoot.metaSummary,
    datasets: datasetSummary,
  });
}

async function triggerContextRebuildBestEffort({
  userId,
  source,
  snapshotId,
  contextRangeDays,
}) {
  try {
    console.log('[mcpWorker] context rebuild:start', {
      userId: String(userId),
      source,
      snapshotId,
      contextRangeDays: contextRangeDays || null,
      timeoutMs: WORKER_CONTEXT_REBUILD_TIMEOUT_MS,
    });

    const result = await rebuildUnifiedContextForUser(userId, {
      explicitSnapshotId: snapshotId || null,
      contextRangeDays: contextRangeDays || null,
      timeoutMs: WORKER_CONTEXT_REBUILD_TIMEOUT_MS,
      reason: `${safeString(source) || 'source'}_synced`,
      requestedBy: 'mcpWorker',
    });

    console.log('[mcpWorker] context rebuild:done', {
      userId: String(userId),
      source,
      snapshotId,
      status: result?.data?.status || null,
      stage: result?.data?.stage || null,
      sourceSnapshots: result?.data?.sourceSnapshots || null,
      usableSources: result?.data?.usableSources || [],
      pendingConnectedSources: result?.data?.pendingConnectedSources || [],
    });

    return {
      ok: true,
      data: result?.data || null,
    };
  } catch (err) {
    console.warn('[mcpWorker] context rebuild failed (best effort)', {
      userId: String(userId),
      source,
      snapshotId,
      error: err?.message || err?.code || err,
      data: err?.data || null,
    });

    return {
      ok: false,
      error: err?.message || err?.code || 'CONTEXT_REBUILD_FAILED',
      data: err?.data || null,
    };
  }
}

async function runMetaJob({ userId, storageRangeDays, contextRangeDays }) {
  const snapshotId = makeSnapshotId();

  await McpData.patchRootSource(userId, 'metaAds', {
    connected: true,
    status: 'running',
    ready: false,
    lastError: null,
  });

  const storageDays = await resolveStorageRangeDays(userId, storageRangeDays);
  const contextDays = await resolveContextRangeDaysByPlan(userId, contextRangeDays);

  console.log('[mcpWorker] runMetaJob:start', {
    userId: String(userId),
    snapshotId,
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  const r = await collectMeta(userId, {
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  console.log('[mcpWorker] collectMeta:result', {
    userId: String(userId),
    ok: !!r?.ok,
    reason: r?.reason || null,
    datasetsCount: Array.isArray(r?.datasets) ? r.datasets.length : 0,
    accountIds: Array.isArray(r?.accountIds) ? r.accountIds : [],
    timeRange: r?.timeRange || null,
    storageTimeRange: r?.storageTimeRange || null,
    contextTimeRange: r?.contextTimeRange || null,
  });

  if (!r?.ok) {
    await McpData.patchRootSource(userId, 'metaAds', {
      connected: true,
      status: 'error',
      ready: false,
      lastError: r?.reason || 'META_COLLECT_FAILED',
      lastSyncAt: null,
      rangeDays: storageDays,
      storageRangeDays: storageDays,
      contextDefaultRangeDays: contextDays,
    });

    throw new Error(r?.reason || 'META_COLLECT_FAILED');
  }

  await saveCollectorDatasets({
    userId,
    snapshotId,
    datasets: r.datasets || [],
  });

  const extractedRoot = extractMetaRootPatchFromResult(r, {
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  await finalizeRootFromCollector({
    userId,
    snapshotId,
    datasets: r.datasets || [],
    extractedRoot,
  });

  const rebuild = await triggerContextRebuildBestEffort({
    userId,
    source: 'metaAds',
    snapshotId,
    contextRangeDays: contextDays,
  });

  return {
    ok: true,
    snapshotId,
    saved: (r.datasets || []).length,
    contextRebuild: rebuild,
  };
}

async function runGoogleAdsJob({ userId, storageRangeDays, contextRangeDays, accountId }) {
  const snapshotId = makeSnapshotId();

  await McpData.patchRootSource(userId, 'googleAds', {
    connected: true,
    status: 'running',
    ready: false,
    lastError: null,
  });

  const storageDays = await resolveStorageRangeDays(userId, storageRangeDays);
  const contextDays = await resolveContextRangeDaysByPlan(userId, contextRangeDays);

  console.log('[mcpWorker] runGoogleAdsJob:start', {
    userId: String(userId),
    snapshotId,
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
    accountId: safeString(accountId) || null,
  });

  const r = await collectGoogle(userId, {
    rangeDays: contextDays,
    account_id: safeString(accountId) || undefined,
  });

  console.log('[mcpWorker] collectGoogle:result', {
    userId: String(userId),
    ok: !!r?.ok,
    reason: r?.reason || null,
    datasetsCount: Array.isArray(r?.datasets) ? r.datasets.length : 0,
    accountIds: Array.isArray(r?.accountIds) ? r.accountIds : [],
    timeRange: r?.timeRange || null,
  });

  if (!r?.ok) {
    await McpData.patchRootSource(userId, 'googleAds', {
      connected: true,
      status: 'error',
      ready: false,
      lastError: r?.reason || 'GOOGLEADS_COLLECT_FAILED',
      lastSyncAt: null,
      rangeDays: storageDays,
      storageRangeDays: storageDays,
      contextDefaultRangeDays: contextDays,
    });

    throw new Error(r?.reason || 'GOOGLEADS_COLLECT_FAILED');
  }

  await saveCollectorDatasets({
    userId,
    snapshotId,
    datasets: r.datasets || [],
  });

  const extractedRoot = extractGoogleRootPatchFromResult(r, {
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  await finalizeRootFromCollector({
    userId,
    snapshotId,
    datasets: r.datasets || [],
    extractedRoot,
  });

  const rebuild = await triggerContextRebuildBestEffort({
    userId,
    source: 'googleAds',
    snapshotId,
    contextRangeDays: contextDays,
  });

  return {
    ok: true,
    snapshotId,
    saved: (r.datasets || []).length,
    contextRebuild: rebuild,
  };
}

async function runGa4Job({ userId, storageRangeDays, contextRangeDays, propertyId }) {
  const snapshotId = makeSnapshotId();

  await McpData.patchRootSource(userId, 'ga4', {
    connected: true,
    status: 'running',
    ready: false,
    lastError: null,
  });

  const storageDays = await resolveStorageRangeDays(userId, storageRangeDays);
  const contextDays = await resolveContextRangeDaysByPlan(userId, contextRangeDays);

  console.log('[mcpWorker] runGa4Job:start', {
    userId: String(userId),
    snapshotId,
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
    propertyId: safeString(propertyId) || null,
  });

  const r = await collectGA4(userId, {
    rangeDays: contextDays,
    property_id: safeString(propertyId) || undefined,
  });

  console.log('[mcpWorker] collectGA4:result', {
    userId: String(userId),
    ok: !!r?.ok,
    reason: r?.reason || null,
    datasetsCount: Array.isArray(r?.datasets) ? r.datasets.length : 0,
    properties: Array.isArray(r?.properties) ? r.properties.map((p) => p?.id) : [],
    range: r?.range || null,
  });

  if (!r?.ok) {
    await McpData.patchRootSource(userId, 'ga4', {
      connected: true,
      status: 'error',
      ready: false,
      lastError: r?.reason || 'GA4_COLLECT_FAILED',
      lastSyncAt: null,
      rangeDays: storageDays,
      storageRangeDays: storageDays,
      contextDefaultRangeDays: contextDays,
    });

    throw new Error(r?.reason || 'GA4_COLLECT_FAILED');
  }

  await saveCollectorDatasets({
    userId,
    snapshotId,
    datasets: r.datasets || [],
  });

  const extractedRoot = extractGa4RootPatchFromResult(r, {
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  await finalizeRootFromCollector({
    userId,
    snapshotId,
    datasets: r.datasets || [],
    extractedRoot,
  });

  const rebuild = await triggerContextRebuildBestEffort({
    userId,
    source: 'ga4',
    snapshotId,
    contextRangeDays: contextDays,
  });

  return {
    ok: true,
    snapshotId,
    saved: (r.datasets || []).length,
    contextRebuild: rebuild,
  };
}

/* =========================
 * Mongo Connect
 * ========================= */
async function connectMongo() {
  mongoose.set('bufferCommands', false);

  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 20_000,
    socketTimeoutMS: 45_000,
  });

  console.log('[mcpWorker] Mongo connected');
}

/* =========================
 * Boot
 * ========================= */
let worker = null;

async function boot() {
  await connectMongo();

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const {
        userId,
        source,
        rangeDays,
        contextRangeDays,
        storageRangeDays,
        accountId,
        propertyId,
      } = job.data || {};

      console.log('[mcpWorker] job received', {
        id: job?.id,
        name: job?.name,
        data: job?.data || null,
        queue: QUEUE_NAME,
        prefix: BULLMQ_PREFIX,
      });

      if (!userId) throw new Error('MISSING_USER_ID');

      const effectiveContextRangeDays = contextRangeDays || rangeDays || null;

      if (source === 'metaAds') {
        return await runMetaJob({
          userId,
          storageRangeDays,
          contextRangeDays: effectiveContextRangeDays,
        });
      }

      if (source === 'googleAds') {
        return await runGoogleAdsJob({
          userId,
          storageRangeDays,
          contextRangeDays: effectiveContextRangeDays,
          accountId,
        });
      }

      if (source === 'ga4') {
        return await runGa4Job({
          userId,
          storageRangeDays,
          contextRangeDays: effectiveContextRangeDays,
          propertyId,
        });
      }

      throw new Error(`UNSUPPORTED_SOURCE:${source}`);
    },
    {
      connection,
      prefix: BULLMQ_PREFIX,
      concurrency: 2,
    }
  );

  worker.on('active', (job) => {
    console.log('[mcpWorker] active', job.id, job.data);
  });

  worker.on('completed', (job, result) => {
    console.log('[mcpWorker] completed', job.id, result);
  });

  worker.on('failed', (job, err) => {
    console.error('[mcpWorker] failed', job?.id, err?.message || err);
  });

  worker.on('error', (err) => {
    console.error('[mcpWorker] worker error', err?.message || err);
  });

  setInterval(() => {
    console.log('[mcpWorker] heartbeat', new Date().toISOString());
  }, 15000);

  console.log('[mcpWorker] running', {
    queue: QUEUE_NAME,
    prefix: BULLMQ_PREFIX,
    defaultStorageRangeDays: DEFAULT_STORAGE_RANGE_DAYS,
    defaultContextRangeDays: DEFAULT_CONTEXT_RANGE_DAYS,
    workerContextRebuildTimeoutMs: WORKER_CONTEXT_REBUILD_TIMEOUT_MS,
  });
}

boot().catch((e) => {
  console.error('[mcpWorker] boot error:', e?.message || e);
  process.exit(1);
});

/* =========================
 * Graceful shutdown
 * ========================= */
async function shutdown() {
  try {
    console.log('[mcpWorker] shutting down...');
    if (worker) await worker.close();
    await connection.quit();
    await mongoose.disconnect();
  } catch (e) {
    console.error('[mcpWorker] shutdown error:', e?.message || e);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);