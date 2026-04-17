'use strict';

require('dotenv').config();

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { PrismaClient } = require('@prisma/client');
const zlib = require('zlib');

const { finalKey, chunksPrefix, chunkKey, uploadFinal, deleteObject, deletePrefix, downloadChunk, listChunkKeys } = require('../utils/r2Client');
const { enqueueRecordingJob } = require('../queues/recordingQueue');

const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_NAME = process.env.RECORDING_QUEUE_NAME || 'recording-process';
const BULLMQ_PREFIX = process.env.BULLMQ_PREFIX || 'bull';
const RECORDING_RETENTION_HOURS = parseInt(process.env.RECORDING_RETENTION_HOURS || '24', 10);

if (!REDIS_URL) {
  console.error('[recordingWorker] Missing REDIS_URL');
  process.exit(1);
}

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

/* ─────────────────────────────────────────────────────────────────────────────
 * Job: recording:finalize
 * Assembles all chunks from R2, gzip-compresses, uploads final object.
 * ───────────────────────────────────────────────────────────────────────────── */
async function handleFinalize(job) {
  const { recordingId, accountId, sessionId, reason } = job.data;
  console.log(`[recordingWorker:finalize] ${recordingId} reason=${reason}`);

  const rec = await prisma.sessionRecording.findUnique({
    where: { recordingId },
    select: { r2ChunksPrefix: true, chunkCount: true, accountId: true },
  });

  if (!rec) {
    console.warn(`[recordingWorker:finalize] Recording ${recordingId} not found — skipping`);
    return;
  }

  const prefix = rec.r2ChunksPrefix || chunksPrefix(rec.accountId || accountId, recordingId);

  // List chunks from S3 directly — do NOT rely on chunkCount in DB (may be stale/zero)
  const chunkKeys = await listChunkKeys(prefix);
  console.log(`[recordingWorker:finalize] ${recordingId} — found ${chunkKeys.length} chunks in S3 under prefix: ${prefix}`);

  if (chunkKeys.length === 0) {
    console.warn(`[recordingWorker:finalize] ${recordingId} — no chunks in S3, marking ERROR`);
    await prisma.sessionRecording.update({
      where: { recordingId },
      data: { status: 'ERROR' },
    }).catch(() => {});
    return;
  }

  // Download all chunks from S3 and assemble
  const allEvents = [];
  for (const key of chunkKeys) {
    try {
      const events = await downloadChunk(key);
      allEvents.push(...events);
    } catch (err) {
      console.error(`[recordingWorker:finalize] Failed to download chunk ${key} for ${recordingId}:`, err.message);
    }
  }

  if (allEvents.length === 0) {
    await prisma.sessionRecording.update({ where: { recordingId }, data: { status: 'ERROR' } });
    return;
  }

  // Sort events by timestamp for correct playback
  allEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // Gzip compress and upload final
  const finalR2Key = finalKey(rec.accountId || accountId, recordingId);
  const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(allEvents)));
  await uploadFinal(finalR2Key, gzipped);

  // Compute duration
  let durationMs = null;
  if (allEvents.length >= 2) {
    durationMs = (allEvents[allEvents.length - 1].timestamp || 0) - (allEvents[0].timestamp || 0);
  }

  await prisma.sessionRecording.update({
    where: { recordingId },
    data: {
      status: 'READY',
      r2Key: finalR2Key,
      sizeBytes: BigInt(gzipped.length),
      durationMs,
    },
  });

  console.log(`[recordingWorker:finalize] ${recordingId} READY — ${allEvents.length} events, ${gzipped.length} bytes`);

  // Enqueue signal extraction
  await enqueueRecordingJob('recording:extract-signals', { recordingId, accountId, sessionId });
  // Enqueue outcome check (after 2h to allow purchase events to arrive)
  await enqueueRecordingJob('recording:check-outcome', { recordingId, accountId, sessionId }, { delay: 2 * 60 * 60 * 1000 });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Job: recording:check-outcome
 * Determines if the session purchased or abandoned.
 * ───────────────────────────────────────────────────────────────────────────── */
async function handleCheckOutcome(job) {
  const { recordingId, accountId, sessionId } = job.data;
  console.log(`[recordingWorker:check-outcome] ${recordingId}`);

  const purchaseEvent = await prisma.event.findFirst({
    where: { accountId, sessionId, eventName: 'purchase' },
    select: { orderId: true },
  });

  const outcome = purchaseEvent ? 'PURCHASED' : 'ABANDONED';
  await prisma.sessionRecording.update({
    where: { recordingId },
    data: {
      outcome,
      outcomeAt: new Date(),
      ...(purchaseEvent?.orderId ? { orderId: purchaseEvent.orderId } : {}),
    },
  });

  console.log(`[recordingWorker:check-outcome] ${recordingId} outcome=${outcome}`);

  // If abandoned, enqueue raw erasure check after retention period
  if (outcome === 'ABANDONED') {
    await enqueueRecordingJob('recording:erase-raw', { recordingId }, {
      delay: RECORDING_RETENTION_HOURS * 60 * 60 * 1000,
    });
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Job: recording:extract-signals
 * Downloads final recording from R2, runs behavioral signal extraction.
 * ───────────────────────────────────────────────────────────────────────────── */
async function handleExtractSignals(job) {
  const { recordingId, accountId, sessionId } = job.data;
  console.log(`[recordingWorker:extract-signals] ${recordingId}`);

  const rec = await prisma.sessionRecording.findUnique({
    where: { recordingId },
    select: { r2Key: true, cartValue: true, attributionSnapshot: true, sessionId: true },
  });

  if (!rec?.r2Key) {
    console.warn(`[recordingWorker:extract-signals] ${recordingId} has no r2Key — skipping`);
    return;
  }

  let events = [];
  try {
    events = await downloadChunk(rec.r2Key);
  } catch (err) {
    console.error(`[recordingWorker:extract-signals] Download failed for ${recordingId}:`, err.message);
    return;
  }

  let signals = {};
  try {
    const { extractSignals } = require('../services/recordingSignalExtractor');
    signals = extractSignals(events, { cartValue: rec.cartValue });
  } catch (err) {
    console.error(`[recordingWorker:extract-signals] Signal extraction failed:`, err.message);
    signals = { error: err.message };
  }

  // LLM narrative for high-risk sessions — hard 30s timeout so worker never blocks
  if (signals.riskScore >= 60) {
    try {
      const { generateNarrative } = require('../services/recordingNarrativeService');
      const attribution = rec.attributionSnapshot || {};
      const llmTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('LLM timeout after 30s')), 30_000)
      );
      const narrative = await Promise.race([
        generateNarrative({
          signals,
          cartValue: rec.cartValue,
          attributedChannel: attribution.utm_source || attribution.attributed_channel || null,
          sessionDurationMs: signals.totalDurationMs,
        }),
        llmTimeout,
      ]);
      if (narrative) Object.assign(signals, narrative);
    } catch (err) {
      console.warn(`[recordingWorker:extract-signals] LLM narrative failed (non-fatal):`, err.message);
      // Ensure deterministic archetype is always present even without LLM
      if (!signals.archetype) {
        signals.archetype = signals.abandonmentPattern || 'unknown';
        signals.narrative = null;
        signals.llmSkipped = true;
      }
    }
  }

  await prisma.sessionRecording.update({
    where: { recordingId },
    data: { behavioralSignals: signals },
  });

  // Enqueue raw erasure after retention period
  await enqueueRecordingJob('recording:erase-raw', { recordingId }, {
    delay: RECORDING_RETENTION_HOURS * 60 * 60 * 1000,
  });

  console.log(`[recordingWorker:extract-signals] ${recordingId} signals saved, riskScore=${signals.riskScore}`);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Job: recording:erase-raw
 * Deletes the raw R2 recording after retention period.
 * Keeps behavioralSignals intact.
 * ───────────────────────────────────────────────────────────────────────────── */
async function handleEraseRaw(job) {
  const { recordingId } = job.data;
  console.log(`[recordingWorker:erase-raw] ${recordingId}`);

  const rec = await prisma.sessionRecording.findUnique({
    where: { recordingId },
    select: { r2Key: true, r2ChunksPrefix: true, rawErasedAt: true, behavioralSignals: true },
  });

  if (!rec) return;
  if (rec.rawErasedAt) {
    console.log(`[recordingWorker:erase-raw] ${recordingId} already erased`);
    return;
  }

  // Only erase if signal extraction has completed (behavioralSignals must be set)
  if (!rec.behavioralSignals) {
    console.warn(`[recordingWorker:erase-raw] ${recordingId} signals not yet extracted — requeuing in 1h`);
    await enqueueRecordingJob('recording:erase-raw', { recordingId }, { delay: 60 * 60 * 1000 });
    return;
  }

  // Delete final object
  if (rec.r2Key) await deleteObject(rec.r2Key);
  // Delete all chunks
  if (rec.r2ChunksPrefix) await deletePrefix(rec.r2ChunksPrefix);

  await prisma.sessionRecording.update({
    where: { recordingId },
    data: { rawErasedAt: new Date(), r2Key: null },
  });

  console.log(`[recordingWorker:erase-raw] ${recordingId} raw recording erased`);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Worker registration
 * ───────────────────────────────────────────────────────────────────────────── */
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { name } = job;
    if (name === 'recording:finalize') return handleFinalize(job);
    if (name === 'recording:check-outcome') return handleCheckOutcome(job);
    if (name === 'recording:extract-signals') return handleExtractSignals(job);
    if (name === 'recording:erase-raw') return handleEraseRaw(job);
    console.warn(`[recordingWorker] Unknown job name: ${name}`);
  },
  {
    connection,
    prefix: BULLMQ_PREFIX,
    concurrency: 3,
  }
);

worker.on('completed', (job) => {
  console.log(`[recordingWorker] Job ${job.name} (${job.id}) completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[recordingWorker] Job ${job?.name} (${job?.id}) failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[recordingWorker] Worker error:', err.message);
});

console.log(`[recordingWorker] Started on queue "${QUEUE_NAME}" (prefix: ${BULLMQ_PREFIX})`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[recordingWorker] SIGTERM received, draining...');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
