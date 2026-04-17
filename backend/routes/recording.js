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
  console.log('[recording] Queue initialized:', !!recordingQueue);
} catch (err) {
  console.error('[recording] Queue init failed:', err.message);
}

// Redis TTL for chunk index list (2 hours)
const CHUNK_INDEX_TTL = 2 * 60 * 60;

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /recording/start
 * Creates a SessionRecording row. Called by the pixel when add_to_cart fires.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/init', async (req, res) => {
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

    // Verify account exists (prevent FK violation for unknown/non-onboarded accounts)
    const accountExists = await prisma.account.findUnique({
      where: { accountId: account_id },
      select: { accountId: true },
    }).catch(() => null);

    if (!accountExists) {
      return res.status(404).json({ ok: false, error: 'Account not found' });
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

    // Link session → recording (session row may not exist yet if /collect is still processing)
    const linked = await prisma.session.updateMany({
      where: { sessionId: session_id, accountId: account_id },
      data: { rrwebRecordingId: recording_id },
    }).catch(() => ({ count: 0 }));

    // If session didn't exist yet, retry once after a short delay
    if (!linked.count) {
      setTimeout(async () => {
        await prisma.session.updateMany({
          where: { sessionId: session_id, accountId: account_id },
          data: { rrwebRecordingId: recording_id },
        }).catch(() => {});
      }, 3000);
    }

    return res.json({ ok: true, recording_id });
  } catch (err) {
    console.error('[recording/start] Error:', err.message, err.stack);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /recording/chunk
 * Receives a batch of rrweb events. Stores chunk in R2 AND indexes in Redis.
 * Redis = fast index, R2 = durable storage.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/buf', async (req, res) => {
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

    // Fetch the recording to get r2ChunksPrefix — auto-create if /init hasn't arrived yet (race condition)
    let rec = await prisma.sessionRecording.findUnique({
      where: { recordingId: recording_id },
      select: { r2ChunksPrefix: true, accountId: true, chunkCount: true },
    });

    if (!rec) {
      // /init may still be in-flight — check if account exists then auto-create
      const accountExists = await prisma.account.findUnique({
        where: { accountId: account_id }, select: { accountId: true },
      }).catch(() => null);

      if (!accountExists) {
        return res.status(404).json({ ok: false, error: 'Account not found' });
      }

      const r2Prefix = chunksPrefix(account_id, recording_id);
      try {
        await prisma.sessionRecording.create({
          data: {
            recordingId: recording_id,
            accountId: account_id,
            sessionId: session_id || 'unknown',
            userKey: 'anonymous',
            triggerEvent: 'add_to_cart',
            triggerAt: new Date(),
            r2ChunksPrefix: r2Prefix,
            r2Bucket: process.env.R2_BUCKET || 'adray-recordings',
            status: 'RECORDING',
            maskingEnabled: true,
          },
        });
      } catch (createErr) {
        if (!createErr.message?.includes('Unique constraint')) {
          console.error('[recording/buf] auto-create failed:', createErr.message);
          return res.status(503).json({ ok: false, error: 'Could not initialize recording' });
        }
      }
      rec = { r2ChunksPrefix: r2Prefix, accountId: account_id };
      console.log(`[recording/buf] auto-created recording ${recording_id} for account ${account_id}`);
    }

    const prefix = rec.r2ChunksPrefix || chunksPrefix(account_id, recording_id);

    // Upload chunk to R2 — await so pixel gets a real failure signal and can retry
    try {
      await uploadChunk(prefix, idx, events);
    } catch (r2Err) {
      console.error(`[recording/chunk] R2 upload failed for ${recording_id}:${idx}:`, r2Err.message);
      return res.status(503).json({ ok: false, error: 'Storage unavailable — please retry' });
    }

    // Append chunk index to Redis list (fast index for worker) — best-effort
    if (redisClient) {
      const listKey = `adray:rec:${recording_id}:chunk_indexes`;
      await redisClient.rpush(listKey, String(idx)).catch(() => {});
      await redisClient.expire(listKey, CHUNK_INDEX_TTL).catch(() => {});
    }

    // Increment chunk count + update last_chunk_at for stuck-recording detection
    await prisma.sessionRecording.update({
      where: { recordingId: recording_id },
      data: { chunkCount: { increment: 1 }, lastChunkAt: new Date() },
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    console.error('[recording/chunk] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /recording/end
 * Signals recording end. Enqueues finalize job.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/fin', async (req, res) => {
  try {
    const { account_id, recording_id, session_id, reason, final_chunk_index } = req.body || {};
    console.log(`[recording/fin] recordingId=${recording_id} reason=${reason} queue=${!!recordingQueue}`);

    if (!recording_id) {
      return res.status(400).json({ ok: false, error: 'Missing recording_id' });
    }

    await prisma.sessionRecording.updateMany({
      where: { recordingId: recording_id },
      data: { status: 'FINALIZING' },
    }).catch((e) => console.error('[recording/fin] updateMany error:', e.message));

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
      select: {
        recordingId: true, sessionId: true, accountId: true, status: true,
        outcome: true, cartValue: true, durationMs: true, triggerAt: true,
        behavioralSignals: true, attributionSnapshot: true, r2Key: true, createdAt: true,
      },
    });

    if (!rec || rec.accountId !== account_id) {
      return res.status(404).json({ ok: false, error: 'Recording not found' });
    }

    // Auto-finalize: if stuck in RECORDING for >5 min, enqueue finalize job
    if (rec.status === 'RECORDING' && recordingQueue) {
      const ageMs = Date.now() - new Date(rec.createdAt).getTime();
      if (ageMs > 5 * 60 * 1000) {
        console.log(`[recording GET] ${recording_id} stuck in RECORDING for ${Math.round(ageMs/1000)}s — auto-finalizing`);
        recordingQueue.add('recording:finalize', {
          recordingId: recording_id,
          accountId: account_id,
          sessionId: rec.sessionId,
          reason: 'auto_finalize',
        }, { attempts: 3 }).catch((e) => console.error('[recording GET] auto-finalize enqueue error:', e.message));
        await prisma.sessionRecording.update({
          where: { recordingId: recording_id },
          data: { status: 'FINALIZING' },
        }).catch(() => {});
      }
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

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /recording/sweep  (internal — called by cron)
 * Finds recordings stuck in RECORDING/FINALIZING and re-enqueues finalize.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/sweep', async (req, res) => {
  // Simple secret check so it's not publicly abusable
  const secret = req.headers['x-adray-internal'] || req.body?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    // ERROR recordings get 1 retry chance (in case failure was transient)
    const errorCutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago for ERROR

    const stuck = await prisma.sessionRecording.findMany({
      where: {
        OR: [
          { status: { in: ['RECORDING', 'FINALIZING'] }, createdAt: { lt: cutoff } },
          { status: 'ERROR', chunkCount: { gt: 0 }, createdAt: { lt: errorCutoff }, rawErasedAt: null },
        ],
      },
      select: { recordingId: true, accountId: true, sessionId: true, status: true },
      take: 50,
    });

    let enqueued = 0;
    for (const rec of stuck) {
      if (recordingQueue) {
        // Remove any previously failed job with the same dedupe ID so we can re-enqueue
        const dedupId = `sweep:${rec.recordingId}`;
        try {
          const existing = await recordingQueue.getJob(dedupId);
          if (existing) {
            const state = await existing.getState();
            if (state === 'failed' || state === 'completed') await existing.remove();
          }
        } catch (_) {}

        await recordingQueue.add('recording:finalize', {
          recordingId: rec.recordingId,
          accountId: rec.accountId,
          sessionId: rec.sessionId,
          reason: 'sweep',
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: true,
          jobId: dedupId,
        }).catch(() => {});

        await prisma.sessionRecording.update({
          where: { recordingId: rec.recordingId },
          data: { status: 'FINALIZING' },
        }).catch(() => {});
        enqueued++;
      }
    }

    console.log(`[recording/sweep] Enqueued ${enqueued}/${stuck.length} stuck recordings`);
    return res.json({ ok: true, swept: enqueued, recordingIds: stuck.map(r => r.recordingId) });
  } catch (err) {
    console.error('[recording/sweep] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /collect/x/health
 * Pipeline diagnostic — no auth required, safe to hit from browser.
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/health', async (req, res) => {
  const { uploadChunk: testUpload, getPresignedUrl: testPresign } = require('../utils/r2Client');
  const redisClient = require('../utils/redisClient');

  const checks = {};

  // R2 storage
  try {
    await testUpload('_health_check', 999999, [{ t: Date.now() }]);
    checks.r2 = { ok: true };
  } catch (e) {
    checks.r2 = { ok: false, error: e.message };
  }

  // Redis
  try {
    if (redisClient) {
      await redisClient.ping();
      checks.redis = { ok: true };
    } else {
      checks.redis = { ok: false, error: 'redisClient not initialized' };
    }
  } catch (e) {
    checks.redis = { ok: false, error: e.message };
  }

  // Postgres
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = { ok: true };
  } catch (e) {
    checks.postgres = { ok: false, error: e.message };
  }

  // Queue
  let queueOk = false;
  try {
    const { getRecordingQueue } = require('../queues/recordingQueue');
    const q = getRecordingQueue();
    queueOk = !!q;
  } catch (_) {}
  checks.queue = { ok: queueOk };

  // Recent recordings
  try {
    const recent = await prisma.sessionRecording.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { recordingId: true, accountId: true, status: true, chunkCount: true, createdAt: true },
    });
    checks.recentRecordings = recent;
  } catch (e) {
    checks.recentRecordings = { error: e.message };
  }

  const allOk = checks.r2?.ok && checks.redis?.ok && checks.postgres?.ok && checks.queue?.ok;
  return res.status(allOk ? 200 : 503).json({ ok: allOk, checks });
});

module.exports = router;
