// backend/queues/mcpQueue.js
'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_NAME = 'mcp-collect';

if (!REDIS_URL) {
  console.warn('[mcpQueue] Missing REDIS_URL. Queue will not work.');
}

const connection = REDIS_URL
  ? new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
    })
  : null;

const mcpQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 200,
  },
});

async function enqueueMcpCollect({ userId, source, rangeDays, reason }) {
  if (!connection) throw new Error('REDIS_NOT_CONFIGURED');

  const payload = {
    userId: String(userId),
    source: String(source || ''),
    rangeDays: rangeDays == null ? null : Number(rangeDays),
    reason: reason || 'manual',
    enqueuedAt: new Date().toISOString(),
  };

  console.log('[mcpQueue] enqueue request', {
    queue: QUEUE_NAME,
    userId: payload.userId,
    source: payload.source,
    rangeDays: payload.rangeDays,
    reason: payload.reason,
  });

  const countsBefore = await mcpQueue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
    'paused'
  );

  console.log('[mcpQueue] counts before add', countsBefore);

  // ✅ Sin jobId para evitar bloqueo por IDs custom inválidos o reciclados
  const job = await mcpQueue.add('collect', payload);

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
    'paused'
  );

  console.log('[mcpQueue] enqueued job', {
    queue: QUEUE_NAME,
    id: job.id,
    name: job.name,
    state,
    data: payload,
  });

  console.log('[mcpQueue] counts after add', countsAfter);

  return job;
}

module.exports = { mcpQueue, enqueueMcpCollect };