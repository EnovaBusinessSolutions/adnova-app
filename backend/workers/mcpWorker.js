'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const IORedis = require('ioredis');

const { collectMeta } = require('../jobs/collect/metaCollector');
const { collectGoogle } = require('../jobs/collect/googleCollector');
const { collectGA4 } = require('../jobs/collect/googleAnalyticsCollector');
const McpData = require('../models/McpData');
const User = require('../models/User');

/* =========================
 * ENV + Connections
 * ========================= */
const MONGO_URI = process.env.MONGO_URI || '';
const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_NAME = process.env.MCP_QUEUE_NAME || 'mcp-collect';
const BULLMQ_PREFIX = process.env.BULLMQ_PREFIX || 'bull';

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
      (Array.isArray(data?.placement_top) ? data.placement_top.length : 0)
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

function extractMetaRootPatchFromResult(r, days) {
  const summaryDs = Array.isArray(r?.datasets)
    ? r.datasets.find((x) => x?.dataset === 'meta.insights_summary') || r.datasets[0]
    : null;

  const meta = summaryDs?.data?.meta || null;
  const accounts = Array.isArray(meta?.accounts) ? meta.accounts : [];
  const firstAccount = accounts[0] || null;

  const range = r?.timeRange
    ? {
        from: safeString(r.timeRange.from) || safeString(r.timeRange.since) || null,
        to: safeString(r.timeRange.to) || safeString(r.timeRange.until) || null,
        tz: safeString(meta?.range?.tz) || safeString(summaryDs?.range?.tz) || null,
      }
    : {
        from: safeString(summaryDs?.range?.from) || null,
        to: safeString(summaryDs?.range?.to) || null,
        tz: safeString(summaryDs?.range?.tz) || null,
      };

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
    safeString(range?.tz) ||
    null;

  return {
    sourceName: 'metaAds',
    sourcePatch: {
      connected: true,
      status: 'ready',
      ready: true,
      lastError: null,
      lastSyncAt: new Date(),
      rangeDays: days,
      accountId,
      name,
      currency,
      timezone,
    },
    rootPatch: {
      latestSnapshotId: null,
      coverage: {
        range,
        defaultRangeDays: days,
        granularity: ['summary', 'ranked_campaigns', 'breakdown', 'signals', 'daily_ai'],
      },
    },
    metaSummary: {
      accountId,
      name,
      currency,
      timezone,
      range,
    },
  };
}

function extractGoogleRootPatchFromResult(r, days) {
  const summaryDs = Array.isArray(r?.datasets)
    ? r.datasets.find((x) => x?.dataset === 'google.insights_summary') || r.datasets[0]
    : null;

  const meta = summaryDs?.data?.meta || null;
  const accounts = Array.isArray(meta?.accounts) ? meta.accounts : [];
  const firstAccount = accounts[0] || null;

  const range = r?.timeRange
    ? {
        from: safeString(r.timeRange.from) || safeString(r.timeRange.since) || null,
        to: safeString(r.timeRange.to) || safeString(r.timeRange.until) || null,
        tz: safeString(meta?.range?.tz) || safeString(summaryDs?.range?.tz) || null,
      }
    : {
        from: safeString(summaryDs?.range?.from) || null,
        to: safeString(summaryDs?.range?.to) || null,
        tz: safeString(summaryDs?.range?.tz) || null,
      };

  const accountId =
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
    safeString(range?.tz) ||
    null;

  return {
    sourceName: 'googleAds',
    sourcePatch: {
      connected: true,
      status: 'ready',
      ready: true,
      lastError: null,
      lastSyncAt: new Date(),
      rangeDays: days,
      accountId,
      name,
      currency,
      timezone,
    },
    rootPatch: {
      latestSnapshotId: null,
      coverage: {
        range,
        defaultRangeDays: days,
        granularity: ['summary', 'ranked_campaigns', 'breakdown', 'signals', 'daily_ai'],
      },
    },
    metaSummary: {
      accountId,
      name,
      currency,
      timezone,
      range,
    },
  };
}

function extractGa4RootPatchFromResult(r, days) {
  const summaryDs = Array.isArray(r?.datasets)
    ? r.datasets.find((x) => x?.dataset === 'ga4.insights_summary') || r.datasets[0]
    : null;

  const meta = summaryDs?.data?.meta || null;
  const properties = Array.isArray(meta?.properties) ? meta.properties : [];
  const firstProperty = properties[0] || null;

  const range =
    r?.range
      ? {
          from: safeString(r.range.from) || null,
          to: safeString(r.range.to) || null,
          tz: safeString(r.range.tz) || safeString(meta?.range?.tz) || safeString(summaryDs?.range?.tz) || null,
        }
      : {
          from: safeString(summaryDs?.range?.from) || safeString(meta?.range?.from) || null,
          to: safeString(summaryDs?.range?.to) || safeString(meta?.range?.to) || null,
          tz: safeString(summaryDs?.range?.tz) || safeString(meta?.range?.tz) || null,
        };

  const propertyId =
    safeString(firstProperty?.id) ||
    (Array.isArray(r?.properties) && r.properties.length ? safeString(r.properties[0]?.id) : null) ||
    safeString(r?.defaultPropertyId) ||
    null;

  const name = safeString(firstProperty?.name) || null;
  const currency = safeString(firstProperty?.currencyCode) || null;
  const timezone =
    safeString(firstProperty?.timeZone) ||
    safeString(range?.tz) ||
    null;

  return {
    sourceName: 'ga4',
    sourcePatch: {
      connected: true,
      status: 'ready',
      ready: true,
      lastError: null,
      lastSyncAt: new Date(),
      rangeDays: days,
      propertyId,
      name,
      currency,
      timezone,
    },
    rootPatch: {
      latestSnapshotId: null,
      coverage: {
        range,
        defaultRangeDays: days,
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
      range,
    },
  };
}

async function resolveRangeDaysByPlan(userId, requestedDays) {
  if (requestedDays) return Number(requestedDays);

  const u = await User.findById(userId).select('plan').lean();
  const plan = String(u?.plan || 'gratis').toLowerCase();

  if (plan === 'gratis' || plan === 'free') return 60;

  if (plan === 'pro' || plan === 'crecimiento' || plan === 'growth' || plan === 'enterprise') {
    return 90;
  }

  return 60;
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

async function runMetaJob({ userId, rangeDays }) {
  const snapshotId = `snap_${ymdUTC()}`;

  await McpData.patchRootSource(userId, 'metaAds', {
    connected: true,
    status: 'running',
    ready: false,
    lastError: null,
  });

  const days = await resolveRangeDaysByPlan(userId, rangeDays);

  console.log('[mcpWorker] runMetaJob:start', {
    userId: String(userId),
    snapshotId,
    rangeDays: days,
  });

  const r = await collectMeta(userId, { rangeDays: days });

  console.log('[mcpWorker] collectMeta:result', {
    userId: String(userId),
    ok: !!r?.ok,
    reason: r?.reason || null,
    datasetsCount: Array.isArray(r?.datasets) ? r.datasets.length : 0,
    accountIds: Array.isArray(r?.accountIds) ? r.accountIds : [],
    timeRange: r?.timeRange || null,
  });

  if (!r?.ok) {
    await McpData.patchRootSource(userId, 'metaAds', {
      connected: true,
      status: 'error',
      ready: false,
      lastError: r?.reason || 'META_COLLECT_FAILED',
      lastSyncAt: null,
      rangeDays: days,
    });

    throw new Error(r?.reason || 'META_COLLECT_FAILED');
  }

  await saveCollectorDatasets({
    userId,
    snapshotId,
    datasets: r.datasets || [],
  });

  const extractedRoot = extractMetaRootPatchFromResult(r, days);

  await finalizeRootFromCollector({
    userId,
    snapshotId,
    datasets: r.datasets || [],
    extractedRoot,
  });

  return { ok: true, snapshotId, saved: (r.datasets || []).length };
}

async function runGoogleAdsJob({ userId, rangeDays, accountId }) {
  const snapshotId = `snap_${ymdUTC()}`;

  await McpData.patchRootSource(userId, 'googleAds', {
    connected: true,
    status: 'running',
    ready: false,
    lastError: null,
  });

  const days = await resolveRangeDaysByPlan(userId, rangeDays);

  console.log('[mcpWorker] runGoogleAdsJob:start', {
    userId: String(userId),
    snapshotId,
    rangeDays: days,
    accountId: safeString(accountId) || null,
  });

  const r = await collectGoogle(userId, {
    rangeDays: days,
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
      rangeDays: days,
    });

    throw new Error(r?.reason || 'GOOGLEADS_COLLECT_FAILED');
  }

  await saveCollectorDatasets({
    userId,
    snapshotId,
    datasets: r.datasets || [],
  });

  const extractedRoot = extractGoogleRootPatchFromResult(r, days);

  await finalizeRootFromCollector({
    userId,
    snapshotId,
    datasets: r.datasets || [],
    extractedRoot,
  });

  return { ok: true, snapshotId, saved: (r.datasets || []).length };
}

async function runGa4Job({ userId, rangeDays, propertyId }) {
  const snapshotId = `snap_${ymdUTC()}`;

  await McpData.patchRootSource(userId, 'ga4', {
    connected: true,
    status: 'running',
    ready: false,
    lastError: null,
  });

  const days = await resolveRangeDaysByPlan(userId, rangeDays);

  console.log('[mcpWorker] runGa4Job:start', {
    userId: String(userId),
    snapshotId,
    rangeDays: days,
    propertyId: safeString(propertyId) || null,
  });

  const r = await collectGA4(userId, {
    rangeDays: days,
    property_id: safeString(propertyId) || undefined,
  });

  console.log('[mcpWorker] collectGA4:result', {
    userId: String(userId),
    ok: !!r?.ok,
    reason: r?.reason || null,
    datasetsCount: Array.isArray(r?.datasets) ? r.datasets.length : 0,
    properties: Array.isArray(r?.properties) ? r.properties.map(p => p?.id) : [],
    range: r?.range || null,
  });

  if (!r?.ok) {
    await McpData.patchRootSource(userId, 'ga4', {
      connected: true,
      status: 'error',
      ready: false,
      lastError: r?.reason || 'GA4_COLLECT_FAILED',
      lastSyncAt: null,
      rangeDays: days,
    });

    throw new Error(r?.reason || 'GA4_COLLECT_FAILED');
  }

  await saveCollectorDatasets({
    userId,
    snapshotId,
    datasets: r.datasets || [],
  });

  const extractedRoot = extractGa4RootPatchFromResult(r, days);

  await finalizeRootFromCollector({
    userId,
    snapshotId,
    datasets: r.datasets || [],
    extractedRoot,
  });

  return { ok: true, snapshotId, saved: (r.datasets || []).length };
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
      const { userId, source, rangeDays, accountId, propertyId } = job.data || {};

      console.log('[mcpWorker] job received', {
        id: job?.id,
        name: job?.name,
        data: job?.data || null,
        queue: QUEUE_NAME,
        prefix: BULLMQ_PREFIX,
      });

      if (!userId) throw new Error('MISSING_USER_ID');

      if (source === 'metaAds') {
        return await runMetaJob({ userId, rangeDays });
      }

      if (source === 'googleAds') {
        return await runGoogleAdsJob({ userId, rangeDays, accountId });
      }

      if (source === 'ga4') {
        return await runGa4Job({ userId, rangeDays, propertyId });
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