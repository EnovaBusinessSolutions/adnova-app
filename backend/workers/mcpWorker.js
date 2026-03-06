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
  console.error('[mcpWorker] ❌ Missing MONGO_URI in environment');
  // en Render es mejor salir para que veas el error claro
  process.exit(1);
}
if (!REDIS_URL) {
  console.error('[mcpWorker] ❌ Missing REDIS_URL in environment');
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

async function resolveRangeDaysByPlan(userId, requestedDays) {
  if (requestedDays) return Number(requestedDays);

  const u = await User.findById(userId).select('plan').lean();
  const plan = String(u?.plan || 'gratis');

  // ✅ Free: 60d
  if (plan === 'gratis') return 60;

  // Pro/enterprise: por ahora 90 (luego 365)
  if (plan === 'pro' || plan === 'enterprise') return 90;

  return 60;
}

async function runMetaJob({ userId, rangeDays }) {
  const snapshotId = `snap_${ymdUTC()}`;

  await McpData.patchRootSource(userId, 'metaAds', {
    status: 'running',
    ready: false,
    lastError: null,
  });

  const days = await resolveRangeDaysByPlan(userId, rangeDays);

  // 👇 tu collector debe regresar { ok:true, datasets:[...] }
  const r = await collectMeta(userId, { rangeDays: days });

  if (!r?.ok) {
    await McpData.patchRootSource(userId, 'metaAds', {
      status: 'error',
      ready: false,
      lastError: r?.reason || 'META_COLLECT_FAILED',
      lastSyncAt: null,
      rangeDays: days,
    });
    throw new Error(r?.reason || 'META_COLLECT_FAILED');
  }

  // Guardar datasets (upsert para evitar duplicados)
  for (const ds of r.datasets || []) {
    await McpData.upsertChunk({
      userId,
      snapshotId,
      source: ds.source,     // esperado: "metaAds"
      dataset: ds.dataset,   // e.g. "meta.insights_summary"
      range: ds.range,       // {from,to,tz}
      data: ds.data,
      stats: ds.stats || null,
    });
  }

  await McpData.patchRootSource(userId, 'metaAds', {
    status: 'ready',
    ready: true,
    lastError: null,
    lastSyncAt: new Date(),
    rangeDays: days,
  });

  // opcional: guardar latestSnapshotId en root
  await McpData.upsertRoot(userId, { latestSnapshotId: snapshotId });

  return { ok: true, snapshotId, saved: (r.datasets || []).length };
}

/* =========================
 * Mongo Connect (CRÍTICO)
 * ========================= */
async function connectMongo() {
  // evita el "buffering timed out"
  mongoose.set('bufferCommands', false);

  // conexión robusta para Render
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 20_000,
    socketTimeoutMS: 45_000,
  });

  console.log('[mcpWorker] ✅ Mongo connected');
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
      if (!userId) throw new Error('MISSING_USER_ID');

      if (source === 'metaAds') {
        return await runMetaJob({ userId, rangeDays });
      }

      // luego agregamos googleAds / ga4
      throw new Error(`UNSUPPORTED_SOURCE:${source}`);
    },
    { connection, concurrency: 2 }
  );

  worker.on('completed', (job) => {
    console.log('[mcpWorker] ✅ completed', job.id, job.name);
  });

  worker.on('failed', (job, err) => {
    console.error('[mcpWorker] ❌ failed', job?.id, err?.message || err);
  });

  console.log('[mcpWorker] ✅ running');
}

boot().catch((e) => {
  console.error('[mcpWorker] ❌ boot error:', e?.message || e);
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