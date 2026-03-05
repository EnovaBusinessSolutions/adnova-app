// backend/workers/mcpWorker.js
'use strict';

const { Worker } = require('bullmq');
const IORedis = require('ioredis');

const { collectMeta } = require('../jobs/collect/metaCollector');
const McpData = require('../models/McpData');
const User = require('../models/User');

const REDIS_URL = process.env.REDIS_URL || '';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

function ymdUTC(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

async function resolveRangeDaysByPlan(userId, requestedDays) {
  if (requestedDays) return Number(requestedDays);
  const u = await User.findById(userId).select('plan').lean();
  const plan = String(u?.plan || 'gratis');
  // ✅ Free: 60d por tu regla
  if (plan === 'gratis') return 60;
  // Pro/enterprise: por ahora 90 (luego 365)
  if (plan === 'pro' || plan === 'enterprise') return 90;
  return 60;
}

async function runMetaJob({ userId, rangeDays }) {
  const snapshotId = `snap_${ymdUTC()}`;

  await McpData.patchRootSource(userId, 'metaAds', {
    status: 'running',
    lastError: null,
  });

  const days = await resolveRangeDaysByPlan(userId, rangeDays);

  const r = await collectMeta(userId, { rangeDays: days });
  if (!r?.ok) {
    await McpData.patchRootSource(userId, 'metaAds', {
      status: 'error',
      lastError: r?.reason || 'META_COLLECT_FAILED',
      lastSyncAt: null,
    });
    throw new Error(r?.reason || 'META_COLLECT_FAILED');
  }

  // guardar datasets
  for (const ds of r.datasets || []) {
    await McpData.upsertChunk({
      userId,
      snapshotId,
      source: ds.source,
      dataset: ds.dataset,
      range: ds.range,
      data: ds.data,
      stats: ds.stats || null,
    });
  }

  await McpData.patchRootSource(userId, 'metaAds', {
    status: 'ready',
    lastError: null,
    lastSyncAt: new Date(),
    rangeDays: days,
  });

  return { ok: true, snapshotId, saved: (r.datasets || []).length };
}

const worker = new Worker(
  'mcp-collect',
  async (job) => {
    const { userId, source, rangeDays } = job.data || {};
    if (!userId) throw new Error('MISSING_USER_ID');

    if (source === 'metaAds') return await runMetaJob({ userId, rangeDays });

    // por ahora solo Meta. Luego agregamos googleAds / ga4.
    throw new Error(`UNSUPPORTED_SOURCE:${source}`);
  },
  { connection, concurrency: 2 }
);

worker.on('completed', (job) => {
  console.log('[mcpWorker] completed', job.id, job.name);
});
worker.on('failed', (job, err) => {
  console.error('[mcpWorker] failed', job?.id, err?.message || err);
});

console.log('[mcpWorker] ✅ running');