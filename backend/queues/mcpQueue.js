// backend/queues/mcpQueue.js
'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';

if (!REDIS_URL) {
  console.warn('[mcpQueue] ⚠️  Missing REDIS_URL. Queue will not work.');
}

const connection = REDIS_URL ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) : null;

const mcpQueue = new Queue('mcp-collect', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 200,
  },
});

// jobId determinístico = evita spam (debounce por user+source)
function jobIdFor(userId, source) {
  return `mcp:${String(userId)}:${String(source)}`;
}

async function enqueueMcpCollect({ userId, source, rangeDays, reason }) {
  if (!connection) throw new Error('REDIS_NOT_CONFIGURED');

  return mcpQueue.add(
    'collect',
    { userId: String(userId), source, rangeDays, reason: reason || 'manual' },
    { jobId: jobIdFor(userId, source) }
  );
}

module.exports = { mcpQueue, enqueueMcpCollect };