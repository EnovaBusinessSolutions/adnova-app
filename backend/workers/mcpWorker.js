// backend/workers/mcpWorker.js
'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const IORedis = require('ioredis');

const { collectMeta } = require('../jobs/collect/metaCollector');
const McpData = require('../models/McpData');
const User = require('../models/User');

/* =========================
 * ENV + Connections
 * ========================= */
const MONGO_URI = process.env.MONGO_URI || '';
const REDIS_URL = process.env.REDIS_URL || '';

if (!MONGO_URI) {
  console.error('[mcpWorker] Missing MONGO_URI in environment');
  process.exit(1);
}
if (!REDIS_URL) {
  console.error('[mcpWorker] Missing REDIS_URL in environment');
  process.exit(1);
}

// Redis connection para BullMQ
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

  if (ds === 'meta.insights_summary') {
    return 1;
  }

  if (ds === 'meta.campaigns_top') {
    const top = data?.top_campaigns || {};
    return (
      (Array.isArray(top.by_spend) ? top.by_spend.length : 0) +
      (Array.isArray(top.by_purchases) ? top.by_purchases.length : 0) +
      (Array.isArray(top.by_roas) ? top.by_roas.length : 0)
    );
  }

  if (ds === 'meta.breakdowns_top') {
    return (
      (Array.isArray(data?.device_top) ? data.device_top.length : 0) +
      (Array.isArray(data?.placement_top) ? data.placement_top.length : 0)
    );
  }

  if (ds === 'meta.campaigns_daily') {
    return Array.isArray(data?.campaigns_daily) ? data.campaigns_daily.length : 0;
  }

  // fallback genérico
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
      latestSnapshotId: null, // se setea después
      coverage: {
        range,
        defaultRangeDays: days,
        granularity: ['summary', 'daily', 'campaign', 'breakdown'],
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

function summarizeDatasets(datasets) {
  const out = {};
  for (const ds of Array.isArray(datasets) ? datasets : []) {
    out[String(ds?.dataset || 'unknown')] = buildChunkStats(ds?.dataset, ds?.data, ds?.stats);
  }
  return out;
}

async function resolveRangeDaysByPlan(userId, requestedDays) {
  if (requestedDays) return Number(requestedDays);

  const u = await User.findById(userId).select('plan').lean();
  const plan = String(u?.plan || 'gratis').toLowerCase();

  // Free: 60d
  if (plan === 'gratis' || plan === 'free') return 60;

  // Pro / crecimiento / enterprise: > 60d
  if (plan === 'pro' || plan === 'crecimiento' || plan === 'growth' || plan === 'enterprise') {
    return 90;
  }

  return 60;
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

  // Guardar chunks con stats enriquecidos
  for (const ds of r.datasets || []) {
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

  // Enriquecer root con metadata real del source
  const rootMeta = extractMetaRootPatchFromResult(r, days);

  await McpData.patchRootSource(userId, 'metaAds', rootMeta.sourcePatch);

  await McpData.upsertRoot(userId, {
    latestSnapshotId: snapshotId,
    coverage: rootMeta.rootPatch.coverage,
    stats: {
      rows: Object.values(summarizeDatasets(r.datasets)).reduce((acc, s) => acc + toNum(s.rows), 0),
      bytes: Object.values(summarizeDatasets(r.datasets)).reduce((acc, s) => acc + toNum(s.bytes), 0),
    },
  });

  console.log('[mcpWorker] root enriched', {
    userId: String(userId),
    snapshotId,
    metaAds: rootMeta.metaSummary,
    datasets: summarizeDatasets(r.datasets),
  });

  return { ok: true, snapshotId, saved: (r.datasets || []).length };
}

/* =========================
 * Mongo Connect (CRÍTICO)
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
    'mcp-collect',
    async (job) => {
      const { userId, source, rangeDays } = job.data || {};

      console.log('[mcpWorker] job received', {
        id: job?.id,
        name: job?.name,
        data: job?.data || null,
      });

      if (!userId) throw new Error('MISSING_USER_ID');

      if (source === 'metaAds') {
        return await runMetaJob({ userId, rangeDays });
      }

      throw new Error(`UNSUPPORTED_SOURCE:${source}`);
    },
    { connection, concurrency: 2 }
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

  console.log('[mcpWorker] running');
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