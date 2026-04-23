'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_NAME = process.env.RECORDING_QUEUE_NAME || 'recording-process';
const BULLMQ_PREFIX = process.env.BULLMQ_PREFIX || 'bull';

if (!REDIS_URL) {
  console.warn('[recordingQueue] Missing REDIS_URL. Recording queue will not work.');
}

const connection = REDIS_URL
  ? (() => {
      const c = new IORedis(REDIS_URL, {
        maxRetriesPerRequest: null,
        retryStrategy: (times) => times >= 3 ? null : Math.min(times * 1000, 5000),
      });
      let _logged = false;
      c.on('error', (err) => {
        if (!_logged) { console.warn('[recordingQueue] Redis unavailable:', err.message); _logged = true; }
      });
      return c;
    })()
  : null;

const recordingQueue = connection
  ? new Queue(QUEUE_NAME, {
      connection,
      prefix: BULLMQ_PREFIX,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    })
  : null;

function getRecordingQueue() {
  return recordingQueue;
}

async function enqueueRecordingJob(jobName, payload, opts = {}) {
  if (!recordingQueue) {
    console.warn(`[recordingQueue] Queue unavailable — cannot enqueue ${jobName}`);
    return null;
  }
  return recordingQueue.add(jobName, payload, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 200,
    ...opts,
  });
}

module.exports = { QUEUE_NAME, BULLMQ_PREFIX, recordingQueue, getRecordingQueue, enqueueRecordingJob };
