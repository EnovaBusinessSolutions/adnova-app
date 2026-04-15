'use strict';

/**
 * recording.js
 * Routes for rrweb session recording ingest and retrieval.
 *
 * Public (pixel-facing, no auth):
 *   POST /recording/start   — create a SessionRecording row
 *   POST /recording/chunk   — append events to Redis + R2 per-chunk
 *   POST /recording/end     — enqueue finalize BullMQ job
 *
 * Authenticated (dashboard):
 *   GET /api/recording/:account_id/:recording_id   — metadata + presigned URL
 *   GET /api/recording/:account_id/session/:session_id — recording for a session
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const redisClient = require('../utils/redisClient');
const { finalKey, chunksPrefix, uploadChunk, getPresignedUrl } = require('../utils/r2Client');

// BullMQ recording queue (graceful if not configured)
let recordingQueue = null;
try {
  const { getRecordingQueue } = require('../queues/recordingQueue');
  recordingQueue = getRecordingQueue();
} catch (_) {
  // Queue not yet created — jobs will be enqueued once worker is deployed
}

// Redis TTL for chunk index list (2 hours)
const CHUNK_INDEX_TTL = 2 * 60 * 60;

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /recording/start
 * Creates a SessionRecording row. Called by the pixel when add_to_cart fires.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/start', async (req, res) => {
  try {
    const {
      account_id,
      recording_id,
      session_id,
      browser_id,
      trigger_event = 'add_to_cart',
      cart_value,
      checkout_token,
      timestamp,
    } = req.body || {};

    if (!account_id || !recording_id || !session_id) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    // Resolve user_key from session
    let userKey = 'anonymous';
    try {
      const sess = await prisma.session.findUnique({
        where: { sessionId: session_id },
        select: { userKey: true },
      });
      if (sess?.userKey) userKey = sess.userKey;
    } catch (_) {}

    // Try to copy attribution snapshot from checkout_session_map if available
    let attributionSnapshot = null;
    if (checkout_token) {
      try {
        const csm = await prisma.checkoutSessionMap.findUnique({
          where: { checkoutToken: checkout_token },
          select: { attributionSnapshot: true },
        });
        attributionSnapshot = csm?.attributionSnapshot || null;
      } catch (_) {}
    }

    const triggerAt = timestamp ? new Date(timestamp) : new Date();
    const r2Prefix = chunksPrefix(account_id, recording_id);

    await prisma.sessionRecording.create({
      data: {
        recordingId: recording_id,
        accountId: account_id,
        sessionId: session_id,
        userKey,
        triggerEvent: trigger_event,
        triggerAt,
        cartValue: cart_value ? parseFloat(cart_value) : null,
        checkoutToken: checkout_token || null,
        attributionSnapshot,
        r2ChunksPrefix: r2Prefix,
        r2Bucket: process.env.R2_BUCKET || 'adray-recordings',
        status: 'RECORDING',
        maskingEnabled: true,
      },
    });

    // Link session → recording
    await prisma.session.updateMany({
      where: { sessionId: session_id, accountId: account_id },
      data: { rrwebRecordingId: recording_id },
    }).catch(() => {});

    return res.json({ ok: true, recording_id });
  } catch (err) {
    console.error('[recording/start] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /recording/chunk
 * Receives a batch of rrweb events. Stores chunk in R2 AND indexes in Redis.
 * Redis = fast index, R2 = durable storage.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/chunk', async (req, res) => {
  try {
    const {
      account_id,
      recording_id,
      session_id,
      chunk_index,
      events,
    } = req.body || {};

    if (!account_id || !recording_id || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    const idx = parseInt(chunk_index, 10) || 0;

    // Fetch the recording to get r2ChunksPrefix
    const rec = await prisma.sessionRecording.findUnique({
      where: { recordingId: recording_id },
      select: { r2ChunksPrefix: true, accountId: true, chunkCount: true },
    });

    if (!rec) {
      // Recording not found — create a minimal one so chunks are not lost
      return res.status(404).json({ ok: false, error: 'Recording not found — send /start first' });
    }

    const prefix = rec.r2ChunksPrefix || chunksPrefix(account_id, recording_id);

    // Upload chunk to R2 (durable)
    uploadChunk(prefix, idx, events).catch((err) =>
      console.error(`[recording/chunk] R2 upload failed for ${recording_id}:${idx}:`, err.message)
    );

    // Append chunk index to Redis list (fast index for worker)
    if (redisClient) {
      const listKey = `adray:rec:${recording_id}:chunk_indexes`;
      await redisClient.rpush(listKey, String(idx));
      await redisClient.expire(listKey, CHUNK_INDEX_TTL);
    }

    // Increment chunk count
    await prisma.sessionRecording.update({
      where: { recordingId: recording_id },
      data: { chunkCount: { increment: 1 } },
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    console.error('[recording/chunk] Error:', err.message);
    // Return 200 even on error to avoid retries flooding the server
    return res.json({ ok: false, error: 'Internal error' });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /recording/end
 * Signals recording end. Enqueues finalize job.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/end', async (req, res) => {
  try {
    const { account_id, recording_id, session_id, reason, final_chunk_index } = req.body || {};

    if (!recording_id) {
      return res.status(400).json({ ok: false, error: 'Missing recording_id' });
    }

    await prisma.sessionRecording.updateMany({
      where: { recordingId: recording_id },
      data: { status: 'FINALIZING' },
    }).catch(() => {});

    // Enqueue finalize job
    if (recordingQueue) {
      await recordingQueue.add('recording:finalize', {
        recordingId: recording_id,
        accountId: account_id,
        sessionId: session_id,
        reason: reason || 'session_end',
        finalChunkIndex: final_chunk_index,
      }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      }).catch((err) => console.error('[recording/end] Enqueue error:', err.message));
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[recording/end] Error:', err.message);
    return res.json({ ok: false, error: 'Internal error' });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /api/recording/:account_id/:recording_id
 * Returns recording metadata + presigned R2 URL for dashboard playback.
 * Requires session auth (enforced by sessionGuard in index.js).
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/:account_id/:recording_id', async (req, res) => {
  try {
    const { account_id, recording_id } = req.params;

    const rec = await prisma.sessionRecording.findUnique({
      where: { recordingId: recording_id },
    });

    if (!rec || rec.accountId !== account_id) {
      return res.status(404).json({ ok: false, error: 'Recording not found' });
    }

    let presignedUrl = null;
    if (rec.r2Key && rec.status === 'READY') {
      presignedUrl = await getPresignedUrl(rec.r2Key, 900).catch(() => null);
    }

    return res.json({
      ok: true,
      recording: {
        recordingId: rec.recordingId,
        sessionId: rec.sessionId,
        status: rec.status,
        outcome: rec.outcome,
        cartValue: rec.cartValue,
        durationMs: rec.durationMs,
        triggerAt: rec.triggerAt,
        behavioralSignals: rec.behavioralSignals,
        attributionSnapshot: rec.attributionSnapshot,
      },
      presignedUrl,
      sessionId: rec.sessionId,
    });
  } catch (err) {
    console.error('[recording GET] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /api/recording/:account_id/session/:session_id
 * Returns the recording linked to a session.
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/:account_id/session/:session_id', async (req, res) => {
  try {
    const { account_id, session_id } = req.params;

    const rec = await prisma.sessionRecording.findFirst({
      where: { accountId: account_id, sessionId: session_id },
      orderBy: { createdAt: 'desc' },
    });

    if (!rec) {
      return res.json({ ok: true, recording: null, presignedUrl: null });
    }

    let presignedUrl = null;
    if (rec.r2Key && rec.status === 'READY') {
      presignedUrl = await getPresignedUrl(rec.r2Key, 900).catch(() => null);
    }

    return res.json({
      ok: true,
      recording: {
        recordingId: rec.recordingId,
        sessionId: rec.sessionId,
        status: rec.status,
        outcome: rec.outcome,
        cartValue: rec.cartValue,
        durationMs: rec.durationMs,
        triggerAt: rec.triggerAt,
        behavioralSignals: rec.behavioralSignals,
      },
      presignedUrl,
    });
  } catch (err) {
    console.error('[recording/session GET] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
