'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_NAME = process.env.MCP_QUEUE_NAME || 'mcp-collect';
const BULLMQ_PREFIX = process.env.BULLMQ_PREFIX || 'bull';

if (!REDIS_URL) {
  console.warn('[mcpQueue] Missing REDIS_URL. Queue will not work.');
}

const connection = REDIS_URL
  ? new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
    })
  : null;

const mcpQueue = connection
  ? new Queue(QUEUE_NAME, {
      connection,
      prefix: BULLMQ_PREFIX,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    })
  : null;

const LIVE_JOB_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized']);

function safeStr(v) {
  return v == null ? '' : String(v).trim();
}

function toNumOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanObject(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function buildCollectPayload({
  userId,
  source,
  rangeDays,
  reason,
  trigger,
  product,
  accountId,
  propertyId,
  metaAccountId,
  snapshotId,
  forceFull,
  priority,
  extra,
} = {}) {
  return cleanObject({
    userId: safeStr(userId),
    source: safeStr(source),
    rangeDays: toNumOrNull(rangeDays),
    reason: safeStr(reason) || 'manual',
    trigger: safeStr(trigger) || null,
    product: safeStr(product) || null,
    accountId: safeStr(accountId) || null,
    propertyId: safeStr(propertyId) || null,
    metaAccountId: safeStr(metaAccountId) || null,
    snapshotId: safeStr(snapshotId) || null,
    forceFull: !!forceFull,
    priority: toNumOrNull(priority),
    extra: extra && typeof extra === 'object' ? extra : null,
    enqueuedAt: new Date().toISOString(),
  });
}

function buildCollectDedupeKey(payload = {}) {
  const parts = [
    'collect',
    safeStr(payload.userId) || '-',
    safeStr(payload.source) || '-',
    safeStr(payload.product) || '-',
    safeStr(payload.accountId) || '-',
    safeStr(payload.propertyId) || '-',
    safeStr(payload.metaAccountId) || '-',
    payload.rangeDays == null ? '-' : String(payload.rangeDays),
  ];

  return parts.join(':');
}

function buildUniqueJobId(dedupeKey) {
  return `${dedupeKey}:${Date.now()}`;
}

async function getExistingLiveJobByDedupeKey(dedupeKey) {
  if (!mcpQueue || !dedupeKey) return null;

  let existingJob = null;
  try {
    existingJob = await mcpQueue.getJob(dedupeKey);
  } catch (_) {
    existingJob = null;
  }

  if (!existingJob) return null;

  let existingState = 'unknown';
  try {
    existingState = await existingJob.getState();
  } catch (_) {
    existingState = 'unknown';
  }

  if (LIVE_JOB_STATES.has(existingState)) {
    existingJob.__reusedExisting = true;
    existingJob.__dedupeKey = dedupeKey;
    existingJob.__state = existingState;
    return existingJob;
  }

  console.log('[mcpQueue] found historical job with same dedupeKey, will enqueue new one', {
    queue: QUEUE_NAME,
    prefix: BULLMQ_PREFIX,
    id: existingJob.id,
    name: existingJob.name,
    state: existingState,
    dedupeKey,
  });

  return null;
}

async function enqueueMcpCollect(input = {}) {
  if (!connection || !mcpQueue) {
    throw new Error('REDIS_NOT_CONFIGURED');
  }

  const payload = buildCollectPayload(input);

  if (!payload.userId) {
    throw new Error('MISSING_USER_ID');
  }

  if (!payload.source) {
    throw new Error('MISSING_SOURCE');
  }

  const dedupeKey = buildCollectDedupeKey(payload);

  console.log('[mcpQueue] enqueue request', {
    queue: QUEUE_NAME,
    prefix: BULLMQ_PREFIX,
    userId: payload.userId,
    source: payload.source,
    product: payload.product,
    accountId: payload.accountId,
    propertyId: payload.propertyId,
    metaAccountId: payload.metaAccountId,
    rangeDays: payload.rangeDays,
    reason: payload.reason,
    trigger: payload.trigger,
    forceFull: payload.forceFull,
    dedupeKey,
  });

  const countsBefore = await mcpQueue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
    'paused',
    'prioritized'
  );

  console.log('[mcpQueue] counts before add', countsBefore);

  const existingLiveJob = await getExistingLiveJobByDedupeKey(dedupeKey);

  if (existingLiveJob) {
    console.log('[mcpQueue] deduped live job', {
      queue: QUEUE_NAME,
      prefix: BULLMQ_PREFIX,
      id: existingLiveJob.id,
      name: existingLiveJob.name,
      state: existingLiveJob.__state || 'unknown',
      dedupeKey,
      data: existingLiveJob.data,
    });

    return existingLiveJob;
  }

  const addOptions = {
    jobId: buildUniqueJobId(dedupeKey),
  };

  if (payload.priority != null) {
    addOptions.priority = payload.priority;
  }

  const job = await mcpQueue.add('collect', payload, addOptions);

  let state = 'unknown';
  try {
    state = await job.getState();
  } catch (_) {
    // noop
  }

  const countsAfter = await mcpQueue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
    'paused',
    'prioritized'
  );

  console.log('[mcpQueue] enqueued job', {
    queue: QUEUE_NAME,
    prefix: BULLMQ_PREFIX,
    id: job.id,
    name: job.name,
    state,
    dedupeKey,
    data: payload,
  });

  console.log('[mcpQueue] counts after add', countsAfter);

  job.__reusedExisting = false;
  job.__dedupeKey = dedupeKey;

  return job;
}

async function enqueueMcpCollectBestEffort(input = {}) {
  try {
    const job = await enqueueMcpCollect(input);
    return {
      ok: true,
      jobId: job?.id || null,
      dedupeKey: job?.__dedupeKey || null,
      reusedExisting: !!job?.__reusedExisting,
    };
  } catch (err) {
    console.warn('[mcpQueue] enqueueMcpCollectBestEffort failed:', err?.message || err);
    return {
      ok: false,
      error: err?.message || 'ENQUEUE_FAILED',
    };
  }
}

async function enqueueMetaCollectBestEffort({
  userId,
  rangeDays = 60,
  reason = 'meta_connect',
  trigger = 'meta',
  metaAccountId = null,
  forceFull = false,
  extra = null,
} = {}) {
  return enqueueMcpCollectBestEffort({
    userId,
    source: 'metaAds',
    product: 'metaAds',
    metaAccountId,
    rangeDays,
    reason,
    trigger,
    forceFull,
    extra,
  });
}

async function enqueueGoogleAdsCollectBestEffort({
  userId,
  accountId = null,
  rangeDays = 60,
  reason = 'google_ads_connect',
  trigger = 'googleAds',
  forceFull = false,
  extra = null,
} = {}) {
  return enqueueMcpCollectBestEffort({
    userId,
    source: 'googleAds',
    product: 'ads',
    accountId,
    rangeDays,
    reason,
    trigger,
    forceFull,
    extra,
  });
}

async function enqueueGa4CollectBestEffort({
  userId,
  propertyId = null,
  rangeDays = 60,
  reason = 'ga4_connect',
  trigger = 'ga4',
  forceFull = false,
  extra = null,
} = {}) {
  return enqueueMcpCollectBestEffort({
    userId,
    source: 'ga4',
    product: 'ga4',
    propertyId,
    rangeDays,
    reason,
    trigger,
    forceFull,
    extra,
  });
}

module.exports = {
  QUEUE_NAME,
  BULLMQ_PREFIX,
  mcpQueue,
  enqueueMcpCollect,
  enqueueMcpCollectBestEffort,
  enqueueMetaCollectBestEffort,
  enqueueGoogleAdsCollectBestEffort,
  enqueueGa4CollectBestEffort,
};