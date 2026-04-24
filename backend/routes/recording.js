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
      device_type,
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

    const createData = {
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
    };
    // Include deviceType only if the column exists — retry without it on schema mismatch.
    // Important: pass `select` to control what Prisma returns in the RETURNING
    // clause. Without an explicit select, Prisma generates RETURNING * which
    // references every column including device_type — so a plain retry without
    // deviceType in data still fails if the column itself doesn't exist.
    const createWithDevice = { ...createData, deviceType: device_type || null };
    const isSchemaColumnMissing = (e) => {
      if (!e) return false;
      if (e.code === 'P2022') return true; // Prisma: column does not exist
      const msg = e.message || '';
      return msg.includes('deviceType') || msg.includes('device_type');
    };

    try {
      await prisma.sessionRecording.create({ data: createWithDevice, select: { id: true } });
    } catch (createErr) {
      if (createErr?.code === 'P2002') {
        // Row already exists (e.g. /buf auto-created it first) — update instead.
        await prisma.sessionRecording.update({
          where: { recordingId: recording_id },
          data: {
            cartValue: cart_value ? parseFloat(cart_value) : undefined,
            checkoutToken: checkout_token || undefined,
            attributionSnapshot: attributionSnapshot || undefined,
            deviceType: device_type || undefined,
          },
          select: { id: true },
        }).catch((updateErr) => {
          if (isSchemaColumnMissing(updateErr)) {
            return prisma.sessionRecording.update({
              where: { recordingId: recording_id },
              data: {
                cartValue: cart_value ? parseFloat(cart_value) : undefined,
                checkoutToken: checkout_token || undefined,
                attributionSnapshot: attributionSnapshot || undefined,
              },
              select: { id: true },
            });
          }
          throw updateErr;
        });
      } else if (isSchemaColumnMissing(createErr)) {
        // Column not deployed yet — create without it. `select:{id:true}` keeps
        // the RETURNING clause from referencing device_type.
        console.warn('[recording/init] device_type column missing, creating without it');
        await prisma.sessionRecording.create({ data: createData, select: { id: true } }).catch((e2) => {
          if (e2?.code === 'P2002') return;
          throw e2;
        });
      } else {
        throw createErr;
      }
    }

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
      select: { r2ChunksPrefix: true, accountId: true },
    }).catch(() => null);

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
        // `select: { id: true }` keeps RETURNING minimal so a missing optional
        // column (e.g. device_type during deploy lag) doesn't break the insert.
        await prisma.sessionRecording.create({
          data: {
            recordingId: recording_id,
            accountId: account_id,
            sessionId: session_id || 'unknown',
            userKey: 'anonymous',
            triggerEvent: 'page_load',
            triggerAt: new Date(),
            r2ChunksPrefix: r2Prefix,
            r2Bucket: process.env.R2_BUCKET || 'adray-recordings',
            status: 'RECORDING',
            maskingEnabled: true,
          },
          select: { id: true },
        });
      } catch (createErr) {
        // P2002: unique constraint — row was just created by a racing request. OK to continue.
        if (createErr?.code !== 'P2002' && !createErr?.message?.includes('Unique constraint')) {
          console.error('[recording/buf] auto-create failed:', createErr.code, createErr.message);
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
 * GET /api/recording/:account_id/list
 * Returns all READY recordings for an account (most recent first).
 * Used by the dashboard Recordings panel.
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/:account_id/list', async (req, res) => {
  try {
    const { account_id } = req.params;
    const take = Math.min(Number(req.query.limit) || 50, 100);

    // Graceful fallback: if prisma db push hasn't added the `deviceType`
    // column yet (fresh deploy still in flight), retry without that field.
    let recs;
    try {
      recs = await prisma.sessionRecording.findMany({
        where: { accountId: account_id, status: 'READY', rawErasedAt: null },
        select: {
          recordingId: true, sessionId: true, status: true,
          durationMs: true, triggerAt: true, createdAt: true,
          behavioralSignals: true, outcome: true, cartValue: true,
          deviceType: true, r2Key: true, userKey: true, orderId: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
    } catch (selectErr) {
      console.error('[recording/list] select with deviceType failed, retrying without:', selectErr.message);
      recs = await prisma.sessionRecording.findMany({
        where: { accountId: account_id, status: 'READY', rawErasedAt: null },
        select: {
          recordingId: true, sessionId: true, status: true,
          durationMs: true, triggerAt: true, createdAt: true,
          behavioralSignals: true, outcome: true, cartValue: true,
          r2Key: true, userKey: true, orderId: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
    }

    // ── Enrich with customer context (Task 6) ───────────────────────────────
    // For each recording, attach: customerName, customerEmailMasked, customerId,
    // sessionCount (distinct recordings for this userKey in last 30d).
    try {
      const userKeys = Array.from(new Set(recs.map((r) => r.userKey).filter((k) => k && k !== 'anonymous')));
      const orderIds = Array.from(new Set(recs.map((r) => r.orderId).filter(Boolean)));

      // Pull orders matching either the explicit orderId or any of the userKeys,
      // most recent first so the freshest customer name wins per userKey.
      const orFilters = [];
      if (userKeys.length) orFilters.push({ userKey: { in: userKeys } });
      if (orderIds.length) orFilters.push({ orderId: { in: orderIds } });
      const relatedOrders = orFilters.length
        ? await prisma.order.findMany({
            where: { accountId: account_id, OR: orFilters },
            select: {
              orderId: true, userKey: true, customerId: true, emailHash: true,
              attributionSnapshot: true, platformCreatedAt: true,
            },
            orderBy: { platformCreatedAt: 'desc' },
            take: 500,
          }).catch(() => [])
        : [];

      const byOrderId = new Map();
      const byUserKey = new Map();
      for (const o of relatedOrders) {
        const snap = (o.attributionSnapshot && typeof o.attributionSnapshot === 'object') ? o.attributionSnapshot : {};
        const name = snap.customer_name
          || [snap.customer_first_name, snap.customer_last_name].filter(Boolean).join(' ').trim()
          || null;
        const info = {
          customerName: name || null,
          customerId: o.customerId || null,
          emailMasked: o.emailHash ? `hash:${String(o.emailHash).slice(0, 6)}…` : null,
        };
        if (o.orderId) byOrderId.set(o.orderId, info);
        if (o.userKey && !byUserKey.has(o.userKey)) byUserKey.set(o.userKey, info);
      }

      // Session counts: count distinct recordings per userKey in last 30d
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sessionCountMap = new Map();
      if (userKeys.length) {
        const counts = await prisma.sessionRecording.groupBy({
          by: ['userKey'],
          where: { accountId: account_id, userKey: { in: userKeys }, createdAt: { gte: thirtyDaysAgo } },
          _count: { sessionId: true },
        }).catch(() => []);
        for (const c of counts) sessionCountMap.set(c.userKey, c._count.sessionId);
      }

      recs = recs.map((r) => {
        const info = (r.orderId && byOrderId.get(r.orderId)) || (r.userKey && byUserKey.get(r.userKey)) || null;
        return {
          ...r,
          customerName: info?.customerName || null,
          customerId: info?.customerId || null,
          customerEmailMasked: info?.emailMasked || null,
          sessionCount30d: r.userKey && r.userKey !== 'anonymous' ? (sessionCountMap.get(r.userKey) || 1) : 1,
        };
      });
    } catch (enrichErr) {
      // Never fail the list endpoint just because enrichment failed
      console.error('[recording/list] enrichment failed:', enrichErr.message);
    }

    return res.json({ ok: true, recordings: recs });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 DEBUG: SessionPacket browsing
 *
 *   GET /api/recording/:account_id/packets/list?limit=20
 *     → latest N packets, compact summary (no keyframes body)
 *   GET /api/recording/:account_id/packets/:session_id
 *     → full packet JSON (keyframes + signals + ecommerce events)
 *   GET /api/recording/:account_id/packets/stats
 *     → count by outcome + count with AI analysis + most recent packet
 *
 * Lives inside the recording router for now; will move to its own router once
 * the player is retired (Phase 9).
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/:account_id/packets/stats', async (req, res) => {
  try {
    const { account_id } = req.params;
    const [total, byOutcome, aiAnalyzed, mostRecent] = await Promise.all([
      prisma.sessionPacket.count({ where: { accountId: account_id } }),
      prisma.sessionPacket.groupBy({
        by: ['outcome'],
        where: { accountId: account_id },
        _count: { sessionId: true },
      }),
      prisma.sessionPacket.count({ where: { accountId: account_id, aiAnalyzedAt: { not: null } } }),
      prisma.sessionPacket.findFirst({
        where: { accountId: account_id },
        orderBy: { createdAt: 'desc' },
        select: { sessionId: true, createdAt: true, outcome: true, durationMs: true, rawErasedAt: true },
      }),
    ]);
    return res.json({
      ok: true,
      accountId: account_id,
      total,
      byOutcome: Object.fromEntries(byOutcome.map((r) => [r.outcome, r._count.sessionId])),
      aiAnalyzed,
      mostRecent,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:account_id/packets/list', async (req, res) => {
  try {
    const { account_id } = req.params;
    const take = Math.min(Number(req.query.limit) || 20, 100);
    const outcome = String(req.query.outcome || '').trim();

    const where = { accountId: account_id };
    if (outcome) where.outcome = outcome;

    const packets = await prisma.sessionPacket.findMany({
      where,
      select: {
        sessionId: true, visitorId: true, personId: true, outcome: true,
        startTs: true, endTs: true, durationMs: true, landingPage: true,
        cartValueAtEnd: true, orderId: true, device: true, trafficSource: true,
        aiAnalyzedAt: true, rawErasedAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    // Attach compact keyframe + ecommerce summaries without shipping the full arrays
    const summaries = await prisma.sessionPacket.findMany({
      where: { sessionId: { in: packets.map((p) => p.sessionId) } },
      select: { sessionId: true, keyframes: true, ecommerceEvents: true, signals: true },
    });
    const byId = new Map(summaries.map((s) => [s.sessionId, s]));
    const rows = packets.map((p) => {
      const s = byId.get(p.sessionId);
      const kfs = Array.isArray(s?.keyframes) ? s.keyframes : [];
      const ees = Array.isArray(s?.ecommerceEvents) ? s.ecommerceEvents : [];
      return {
        ...p,
        keyframeCount: kfs.length,
        keyframeTypes: Array.from(new Set(kfs.map((k) => k.type))),
        ecommerceCount: ees.length,
        ecommerceTypes: Array.from(new Set(ees.map((e) => e.type))),
        riskScore: s?.signals?.riskScore ?? null,
        pattern: s?.signals?.abandonmentPattern ?? null,
      };
    });
    return res.json({ ok: true, count: rows.length, packets: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:account_id/packets/:session_id', async (req, res) => {
  try {
    const { account_id, session_id } = req.params;
    const packet = await prisma.sessionPacket.findUnique({ where: { sessionId: session_id } });
    if (!packet || packet.accountId !== account_id) {
      return res.status(404).json({ ok: false, error: 'Packet not found' });
    }
    return res.json({ ok: true, packet });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /api/recording/:account_id/by-user?userKey=X
 * Returns all READY recordings for a given userKey, ordered chronologically.
 * Used by Selected Journey to offer a stitched playback across the user's
 * fragmented recordings of the same purchase journey.
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/:account_id/by-user', async (req, res) => {
  try {
    const { account_id } = req.params;
    const queryUserKey = String(req.query.userKey || '').trim();
    const queryCustomerId = String(req.query.customerId || '').trim();
    const queryRecordingId = String(req.query.recordingId || '').trim();

    // ── 1. Build the seed userKey set ────────────────────────────────────
    const seedUserKeys = new Set();
    if (queryUserKey && queryUserKey !== 'anonymous') seedUserKeys.add(queryUserKey);

    // Also seed from the passed recordingId (trust recording's own userKey)
    if (queryRecordingId) {
      const ref = await prisma.sessionRecording.findUnique({
        where: { recordingId: queryRecordingId },
        select: { userKey: true, accountId: true, orderId: true, checkoutToken: true },
      }).catch(() => null);
      if (ref && ref.accountId === account_id) {
        if (ref.userKey && ref.userKey !== 'anonymous') seedUserKeys.add(ref.userKey);
      }
    }

    // ── 2. Find the customerId/emailHash for this person ────────────────
    // Identity can shift between AddToCart and checkout — the Order row has
    // stable identifiers (customerId, emailHash). Any Order where the user's
    // userKey appears tells us who the person is; from there we can find
    // every other userKey they've ever used.
    const customerIds = new Set();
    const emailHashes = new Set();
    if (queryCustomerId) customerIds.add(queryCustomerId);

    if (seedUserKeys.size > 0) {
      const seedOrders = await prisma.order.findMany({
        where: { accountId: account_id, userKey: { in: Array.from(seedUserKeys) } },
        select: { customerId: true, emailHash: true },
        take: 50,
      }).catch(() => []);
      for (const o of seedOrders) {
        if (o.customerId) customerIds.add(o.customerId);
        if (o.emailHash) emailHashes.add(o.emailHash);
      }
    }

    // ── 3. Expand to all userKeys this person has used ──────────────────
    const allUserKeys = new Set(seedUserKeys);
    if (customerIds.size > 0 || emailHashes.size > 0) {
      const personOr = [];
      if (customerIds.size > 0) personOr.push({ customerId: { in: Array.from(customerIds) } });
      if (emailHashes.size > 0) personOr.push({ emailHash: { in: Array.from(emailHashes) } });
      const personOrders = await prisma.order.findMany({
        where: { accountId: account_id, OR: personOr },
        select: { userKey: true },
        take: 200,
      }).catch(() => []);
      for (const o of personOrders) {
        if (o.userKey && o.userKey !== 'anonymous') allUserKeys.add(o.userKey);
      }
    }

    if (allUserKeys.size === 0) {
      return res.json({ ok: true, recordings: [], resolvedUserKeys: [], customerIdMatches: 0 });
    }

    // ── 4. Fetch all READY recordings across the unified userKey set ────
    const recs = await prisma.sessionRecording.findMany({
      where: {
        accountId: account_id,
        userKey: { in: Array.from(allUserKeys) },
        status: 'READY',
        rawErasedAt: null,
      },
      select: {
        recordingId: true, sessionId: true, durationMs: true,
        outcome: true, triggerAt: true, createdAt: true, cartValue: true,
      },
      orderBy: { triggerAt: 'asc' },
      take: 50,
    });
    return res.json({
      ok: true,
      recordings: recs,
      resolvedUserKeys: Array.from(allUserKeys),
      customerIdMatches: customerIds.size,
    });
  } catch (err) {
    console.error('[recording/by-user] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
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
        behavioralSignals: true, attributionSnapshot: true, r2Key: true,
        createdAt: true, lastChunkAt: true,
      },
    });

    if (!rec || rec.accountId !== account_id) {
      return res.status(404).json({ ok: false, error: 'Recording not found' });
    }

    // Auto-finalize: finalize when inactive >5min (arch v2). A long active
    // session (>5min old but still chunking) must NOT be killed — use
    // lastChunkAt, not createdAt.
    if (rec.status === 'RECORDING' && recordingQueue) {
      const lastActivity = rec.lastChunkAt ? new Date(rec.lastChunkAt).getTime() : new Date(rec.createdAt).getTime();
      const inactiveMs = Date.now() - lastActivity;
      if (inactiveMs > 5 * 60 * 1000) {
        console.log(`[recording GET] ${recording_id} inactive ${Math.round(inactiveMs/1000)}s — auto-finalizing`);
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
 * POST /api/recording/:account_id/:recording_id/insights
 * On-demand AI-generated key recommendation for a single recording.
 * Result is cached in Redis for 1h keyed by recordingId.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/:account_id/:recording_id/insights', async (req, res) => {
  try {
    const { account_id, recording_id } = req.params;
    // v2 schema: includes next_best_action + customer_tier + retention_insight
    const cacheKey = `adray:rec:insight:v2:${recording_id}`;

    if (redisClient) {
      const cached = await redisClient.get(cacheKey).catch(() => null);
      if (cached) {
        try { return res.json({ ok: true, cached: true, insight: JSON.parse(cached) }); } catch (_) {}
      }
    }

    let rec;
    try {
      rec = await prisma.sessionRecording.findUnique({
        where: { recordingId: recording_id },
        select: {
          accountId: true, cartValue: true, durationMs: true,
          behavioralSignals: true, deviceType: true, attributionSnapshot: true,
          outcome: true, orderId: true, userKey: true,
        },
      });
    } catch (selectErr) {
      // deviceType column may not exist during deploy lag — retry without
      console.error('[recording/insights] select with deviceType failed, retrying without:', selectErr.message);
      rec = await prisma.sessionRecording.findUnique({
        where: { recordingId: recording_id },
        select: {
          accountId: true, cartValue: true, durationMs: true,
          behavioralSignals: true, attributionSnapshot: true,
          outcome: true, orderId: true, userKey: true,
        },
      });
    }

    if (!rec || rec.accountId !== account_id) {
      return res.status(404).json({ ok: false, error: 'Recording not found' });
    }

    const { generateNarrative, buildCustomerHistory, buildOrderContext } = require('../services/recordingNarrativeService');
    const signals = rec.behavioralSignals || {};
    const attrSnap = rec.attributionSnapshot;
    const attributedChannel = (attrSnap && typeof attrSnap === 'object') ? (attrSnap.channel || attrSnap.attributedChannel || null) : null;

    // For PURCHASED recordings: fetch the current Order + the customer's prior orders
    // so the LLM can recommend a specific re-engagement action.
    let orderContext = null;
    let customerHistory = null;
    if (rec.outcome === 'PURCHASED') {
      try {
        // Current order: prefer orderId, fallback to checkoutToken
        let currentOrder = null;
        if (rec.orderId) {
          currentOrder = await prisma.order.findUnique({ where: { orderId: rec.orderId } }).catch(() => null);
        }
        if (!currentOrder && rec.userKey && rec.userKey !== 'anonymous') {
          // Latest order for this userKey as fallback
          currentOrder = await prisma.order.findFirst({
            where: { accountId: account_id, userKey: rec.userKey },
            orderBy: { platformCreatedAt: 'desc' },
          }).catch(() => null);
        }
        orderContext = buildOrderContext(currentOrder);

        // Prior orders: same userKey / customerId / emailHash, excluding the current one
        if (rec.userKey && rec.userKey !== 'anonymous') {
          const orFilters = [{ userKey: rec.userKey }];
          if (currentOrder?.customerId) orFilters.push({ customerId: currentOrder.customerId });
          if (currentOrder?.emailHash)  orFilters.push({ emailHash: currentOrder.emailHash });
          const priorOrders = await prisma.order.findMany({
            where: {
              accountId: account_id,
              OR: orFilters,
              ...(currentOrder?.orderId ? { NOT: { orderId: currentOrder.orderId } } : {}),
            },
            select: { revenue: true, platformCreatedAt: true, createdAt: true },
            orderBy: { platformCreatedAt: 'desc' },
            take: 50,
          }).catch(() => []);
          customerHistory = buildCustomerHistory(priorOrders, currentOrder?.platformCreatedAt);
        } else {
          customerHistory = buildCustomerHistory([], currentOrder?.platformCreatedAt);
        }
      } catch (ctxErr) {
        console.error('[recording/insights] purchase context build failed:', ctxErr.message);
      }
    }

    let narrative = null;
    try {
      narrative = await generateNarrative({
        signals,
        cartValue: rec.cartValue,
        attributedChannel,
        sessionDurationMs: rec.durationMs,
        outcome: rec.outcome,
        orderContext,
        customerHistory,
      });
    } catch (genErr) {
      console.error('[recording/insights] generateNarrative threw:', genErr.message);
    }

    if (!narrative) {
      // Ultimate fallback so the UI never sees a 500/503 for this endpoint
      if (rec.outcome === 'PURCHASED') {
        narrative = {
          archetype: 'new_convert',
          confidence_score: 0.3,
          friction_signals: [],
          narrative: 'No pudimos generar una recomendación detallada. Revisa la grabación y los datos del pedido para contexto.',
          recommended_action: 'Envía un welcome flow en 3-5 días con producto complementario.',
          next_best_action: { type: 'email', timing_days: 3, content: 'Welcome + cross-sell.', priority: 'medium' },
          customer_tier: null,
          retention_insight: null,
        };
      } else {
        narrative = {
          archetype: 'abandonment_risk',
          confidence_score: 0.3,
          friction_signals: [signals.abandonmentPattern || 'unknown'],
          narrative: 'No pudimos generar una recomendación detallada en este momento. Revisa la grabación para contexto manual.',
          recommended_action: signals.riskScore >= 60
            ? 'Envía un email de recuperación inmediato con el producto del carrito visible.'
            : 'Monitorea si regresa en las próximas 24h antes de tomar acción.',
          next_best_action: { type: 'email', timing_days: 1, content: 'Email de recuperación con el producto del carrito.', priority: signals.riskScore >= 60 ? 'high' : 'medium' },
          customer_tier: null,
          retention_insight: null,
        };
      }
    }

    if (redisClient) {
      await redisClient.set(cacheKey, JSON.stringify(narrative), 'EX', 60 * 60).catch(() => {});
    }

    return res.json({ ok: true, cached: false, insight: narrative });
  } catch (err) {
    console.error('[recording/insights] Error:', err.message);
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
    // Arch v2: finalize by inactivity, not by age. A recording is "complete"
    // when 5 minutes have elapsed since the last chunk arrived. `createdAt`
    // fallback covers recordings that never produced any chunk.
    const inactivityCutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    // ERROR recordings get 1 retry chance (in case failure was transient)
    const errorCutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago for ERROR

    const requestedLimit = Number(req.body?.limit) || Number(req.query?.limit) || 500;
    const take = Math.max(1, Math.min(requestedLimit, 2000));

    const stuck = await prisma.sessionRecording.findMany({
      where: {
        OR: [
          // Active recordings whose last chunk arrived >5min ago → session ended.
          { status: { in: ['RECORDING', 'FINALIZING'] }, lastChunkAt: { lt: inactivityCutoff } },
          // Recordings that never chunked (orphans) after 5min → finalize/ERROR.
          { status: { in: ['RECORDING', 'FINALIZING'] }, lastChunkAt: null, createdAt: { lt: inactivityCutoff } },
          { status: 'ERROR', chunkCount: { gt: 0 }, createdAt: { lt: errorCutoff }, rawErasedAt: null },
        ],
      },
      select: { recordingId: true, accountId: true, sessionId: true, status: true },
      take,
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
 * POST /collect/x/backfill-packets  (internal)
 * For every READY recording that doesn't yet have a SessionPacket, enqueue
 * recording:build-packet. Idempotent via upsert on sessionId.
 * Runs periodically from the server boot loop so /bri stays populated as the
 * sweep drains the RECORDING backlog.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/backfill-packets', async (req, res) => {
  const secret = req.headers['x-adray-internal'] || req.body?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  try {
    const requestedLimit = Number(req.body?.limit) || Number(req.query?.limit) || 500;
    const take = Math.max(1, Math.min(requestedLimit, 2000));

    // 1. Candidate recordings: READY, still have raw (r2Key set), with a real sessionId.
    const ready = await prisma.sessionRecording.findMany({
      where: {
        status: 'READY',
        rawErasedAt: null,
        r2Key: { not: null },
        sessionId: { not: 'unknown' },
      },
      select: { recordingId: true, accountId: true, sessionId: true },
      orderBy: { createdAt: 'desc' },
      take,
    });

    if (ready.length === 0) {
      return res.json({ ok: true, candidates: 0, alreadyHavePacket: 0, enqueued: 0 });
    }

    // 2. Which of those sessionIds already have a SessionPacket? Skip them.
    const existing = await prisma.sessionPacket.findMany({
      where: { sessionId: { in: ready.map((r) => r.sessionId) } },
      select: { sessionId: true },
    });
    const hasPacket = new Set(existing.map((p) => p.sessionId));

    const pending = ready.filter((r) => !hasPacket.has(r.sessionId));

    // 3. Enqueue build-packet for each pending recording. Idempotent via upsert
    //    in the worker — safe to run repeatedly without creating duplicates.
    let enqueued = 0;
    if (recordingQueue && pending.length > 0) {
      for (const rec of pending) {
        try {
          await recordingQueue.add(
            'recording:build-packet',
            { recordingId: rec.recordingId, accountId: rec.accountId, sessionId: rec.sessionId },
            {
              // Dedupe so repeated loops don't pile up identical jobs in Redis
              jobId: `backfill-packet:${rec.recordingId}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              removeOnFail: 50,
            }
          );
          enqueued++;
        } catch (e) {
          // BullMQ throws on duplicate jobId — that means the job is already queued/active.
          // Not an error; it's exactly the dedupe we want.
          if (!String(e?.message || '').includes('already exists')) {
            console.warn(`[recording/backfill-packets] enqueue failed for ${rec.recordingId}:`, e.message);
          }
        }
      }
    }

    console.log(`[recording/backfill-packets] candidates=${ready.length} alreadyHavePacket=${hasPacket.size} enqueued=${enqueued}`);
    return res.json({
      ok: true,
      candidates: ready.length,
      alreadyHavePacket: hasPacket.size,
      enqueued,
    });
  } catch (err) {
    console.error('[recording/backfill-packets] Error:', err.message);
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

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /collect/x/finalize-now
 * Directly finalizes stuck recordings WITHOUT going through BullMQ.
 * Useful when the worker is not consuming jobs.
 * Protected by x-adray-internal header.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/finalize-now', async (req, res) => {
  const secret = req.headers['x-adray-internal'] || req.body?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  const { listChunkKeys, downloadChunk, uploadFinal, finalKey: buildFinalKey, deleteObject, deletePrefix } = require('../utils/r2Client');
  const zlib = require('zlib');

  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const targetId = req.body?.recordingId || null;

  try {
    const where = targetId
      ? { recordingId: targetId }
      : { status: { in: ['RECORDING', 'FINALIZING', 'ERROR'] }, createdAt: { lt: cutoff }, rawErasedAt: null };

    const requestedLimit = Number(req.body?.limit) || Number(req.query?.limit) || 10;
    const take = Math.max(1, Math.min(requestedLimit, 200));

    const recs = await prisma.sessionRecording.findMany({
      where,
      select: { recordingId: true, accountId: true, sessionId: true, r2ChunksPrefix: true, chunkCount: true },
      take,
    });

    const results = [];
    for (const rec of recs) {
      const result = { recordingId: rec.recordingId, status: null, events: 0, error: null };
      try {
        const prefix = rec.r2ChunksPrefix || `recordings/${rec.accountId}/${rec.recordingId}/chunks`;
        const chunkKeys = await listChunkKeys(prefix);
        result.chunksFound = chunkKeys.length;

        if (chunkKeys.length === 0) {
          await prisma.sessionRecording.update({ where: { recordingId: rec.recordingId }, data: { status: 'ERROR' } });
          result.status = 'ERROR_no_chunks';
          results.push(result);
          continue;
        }

        const allEvents = [];
        for (const key of chunkKeys) {
          try { allEvents.push(...await downloadChunk(key)); } catch (_) {}
        }

        if (allEvents.length === 0) {
          await prisma.sessionRecording.update({ where: { recordingId: rec.recordingId }, data: { status: 'ERROR' } });
          result.status = 'ERROR_no_events';
          results.push(result);
          continue;
        }

        // rrweb requires a FullSnapshot (type 2) to replay — reject recordings missing it
        const hasFullSnapshot = allEvents.some((e) => e.type === 2);
        if (!hasFullSnapshot) {
          await prisma.sessionRecording.update({ where: { recordingId: rec.recordingId }, data: { status: 'ERROR' } });
          result.status = 'ERROR_no_fullsnapshot';
          result.eventTypeCounts = allEvents.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {});
          results.push(result);
          continue;
        }

        allEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const fKey = buildFinalKey(rec.accountId, rec.recordingId);
        const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(allEvents)));
        await uploadFinal(fKey, gzipped);

        const durationMs = allEvents.length >= 2
          ? (allEvents[allEvents.length - 1].timestamp || 0) - (allEvents[0].timestamp || 0)
          : null;

        await prisma.sessionRecording.update({
          where: { recordingId: rec.recordingId },
          data: { status: 'READY', r2Key: fKey, sizeBytes: BigInt(gzipped.length), durationMs },
        });

        // Link recording back to its session so the playback button appears
        if (rec.sessionId && rec.sessionId !== 'unknown') {
          await prisma.session.updateMany({
            where: { sessionId: rec.sessionId, accountId: rec.accountId },
            data: { rrwebRecordingId: rec.recordingId },
          }).catch(() => {});
        }

        // Clean up per-chunk R2 objects
        deletePrefix(prefix).catch(() => {});

        result.status = 'READY';
        result.events = allEvents.length;
        result.bytes = gzipped.length;
        result.durationMs = durationMs;
        result.sessionId = rec.sessionId || null;
      } catch (err) {
        result.error = err.message;
        result.status = 'FAILED';
      }
      results.push(result);
    }

    return res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /collect/x/build-packets-now  (internal)
 * Builds SessionPackets INLINE (bypassing BullMQ) for every READY recording
 * that doesn't yet have a packet. Use when the queue is backlogged and
 * recording:build-packet jobs are stuck behind a wall of finalize jobs.
 * Does NOT run analyze-session — the 15-min queue loop will pick those up
 * (or you call it again separately).
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/build-packets-now', async (req, res) => {
  const secret = req.headers['x-adray-internal'] || req.body?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  try {
    const { downloadChunk } = require('../utils/r2Client');
    const { buildSessionPacket } = require('../services/sessionPacketBuilder');
    const { extractSignals } = require('../services/recordingSignalExtractor');

    const requestedLimit = Number(req.body?.limit) || Number(req.query?.limit) || 50;
    const take = Math.max(1, Math.min(requestedLimit, 200));

    // 1. READY recordings, still have raw, real sessionId
    const ready = await prisma.sessionRecording.findMany({
      where: {
        status: 'READY',
        rawErasedAt: null,
        r2Key: { not: null },
        sessionId: { not: 'unknown' },
      },
      select: {
        recordingId: true, sessionId: true, accountId: true, userKey: true,
        cartValue: true, attributionSnapshot: true, deviceType: true, orderId: true,
        r2Key: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    // 2. Skip sessionIds that already have a packet
    const existing = await prisma.sessionPacket.findMany({
      where: { sessionId: { in: ready.map((r) => r.sessionId) } },
      select: { sessionId: true },
    });
    const hasPacket = new Set(existing.map((p) => p.sessionId));
    const pending = ready.filter((r) => !hasPacket.has(r.sessionId));

    let built = 0;
    let failed = 0;
    let orphaned = 0;
    const failures = [];

    // Mark a recording as orphaned so later runs skip it. Happens when the
    // raw blob in R2 was erased by retention / bucket cleanup but r2Key
    // stayed set in Postgres — nothing we can do, the packet is unrecoverable.
    async function markOrphan(recordingId, reason) {
      await prisma.sessionRecording.update({
        where: { recordingId },
        data: { status: 'ERROR', r2Key: null, rawErasedAt: new Date() },
      }).catch(() => {});
      orphaned++;
      failures.push({ recordingId, reason });
    }

    const isMissingKey = (err) => {
      const msg = String(err?.message || err || '').toLowerCase();
      return (
        err?.Code === 'NoSuchKey' ||
        err?.name === 'NoSuchKey' ||
        msg.includes('specified key does not exist') ||
        msg.includes('nosuchkey')
      );
    };

    // 3. Process each synchronously: download R2 → extract → upsert
    for (const rec of pending) {
      let events;
      try {
        events = await downloadChunk(rec.r2Key);
      } catch (dlErr) {
        if (isMissingKey(dlErr)) {
          await markOrphan(rec.recordingId, 'R2 blob missing — marked orphan');
        } else {
          failed++;
          failures.push({ recordingId: rec.recordingId, reason: String(dlErr.message || dlErr).slice(0, 160) });
        }
        continue;
      }

      try {
        if (!Array.isArray(events) || events.length === 0) {
          await markOrphan(rec.recordingId, 'empty events in R2');
          continue;
        }

        let signals = {};
        try {
          signals = extractSignals(events, { cartValue: rec.cartValue });
        } catch (sigErr) {
          signals = { error: String(sigErr.message || sigErr) };
        }

        const packet = buildSessionPacket({ events, recording: rec, signals });

        await prisma.sessionPacket.upsert({
          where: { sessionId: packet.sessionId },
          create: packet,
          update: {
            keyframes: packet.keyframes,
            signals: packet.signals,
            ecommerceEvents: packet.ecommerceEvents,
            outcome: packet.outcome,
            endTs: packet.endTs,
            durationMs: packet.durationMs,
            cartValueAtEnd: packet.cartValueAtEnd,
            orderId: packet.orderId,
            device: packet.device,
            trafficSource: packet.trafficSource,
            landingPage: packet.landingPage,
          },
          select: { id: true },
        });

        // Queue AI analysis so /bri eventually shows the archetype / narrative.
        // Non-blocking: if the queue is jammed the packet still exists.
        if (recordingQueue) {
          await recordingQueue.add(
            'recording:analyze-session',
            { sessionId: packet.sessionId, accountId: packet.accountId },
            {
              jobId: `analyze:${packet.sessionId}`,
              attempts: 3,
              removeOnComplete: true,
              removeOnFail: 50,
            }
          ).catch(() => {});
        }

        built++;
      } catch (err) {
        failed++;
        failures.push({ recordingId: rec.recordingId, reason: String(err.message || err).slice(0, 160) });
      }
    }

    console.log(`[recording/build-packets-now] candidates=${ready.length} alreadyHavePacket=${hasPacket.size} built=${built} orphaned=${orphaned} failed=${failed}`);
    return res.json({
      ok: true,
      candidates: ready.length,
      alreadyHavePacket: hasPacket.size,
      built,
      orphaned,
      failed,
      failures: failures.slice(0, 10),
    });
  } catch (err) {
    console.error('[recording/build-packets-now] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /collect/x/analyze-pending  (internal)
 * Runs sessionAnalyst INLINE on every SessionPacket without aiAnalysis, in
 * batches. Bypasses the BullMQ queue so /bri fills in archetypes even when
 * the worker is jammed or when analyze-session jobs were cleaned before
 * running. sessionAnalyst has a deterministic path + fallback, so this
 * works even if OPENROUTER_API_KEY is missing.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/analyze-pending', async (req, res) => {
  const secret = req.headers['x-adray-internal'] || req.body?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  try {
    const { analyzeSession } = require('../services/sessionAnalyst');
    const { buildCustomerHistory } = require('../services/recordingNarrativeService');

    const requestedLimit = Number(req.body?.limit) || Number(req.query?.limit) || 20;
    const take = Math.max(1, Math.min(requestedLimit, 50));

    const pending = await prisma.sessionPacket.findMany({
      where: { aiAnalyzedAt: null },
      orderBy: { createdAt: 'desc' },
      take,
    });

    if (pending.length === 0) {
      return res.json({ ok: true, candidates: 0, analyzed: 0, failed: 0 });
    }

    let analyzed = 0;
    let failed = 0;
    const failures = [];

    for (const packet of pending) {
      try {
        // Build customer history for this visitor so analyst has tier context
        let customerHistory = { orderCount: 0, totalSpent: 0, avgOrderValue: 0 };
        try {
          const priorOrders = await prisma.order.findMany({
            where: {
              accountId: packet.accountId,
              userKey: packet.visitorId || undefined,
              ...(packet.orderId ? { NOT: { orderId: packet.orderId } } : {}),
            },
            select: { revenue: true, platformCreatedAt: true, createdAt: true },
            orderBy: { platformCreatedAt: 'asc' },
          });
          customerHistory = buildCustomerHistory(priorOrders);
        } catch (_) {}

        // 25s budget per packet — deterministic path is instant, LLM hits this
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('analyze timeout 25s')), 25_000)
        );
        const analysis = await Promise.race([
          analyzeSession(packet, { customerHistory }),
          timeout,
        ]);

        if (!analysis) {
          failed++;
          failures.push({ sessionId: packet.sessionId, reason: 'analyst returned null' });
          continue;
        }

        await prisma.sessionPacket.update({
          where: { sessionId: packet.sessionId },
          data: { aiAnalysis: analysis, aiAnalyzedAt: new Date() },
        });
        analyzed++;
      } catch (err) {
        failed++;
        failures.push({ sessionId: packet.sessionId, reason: String(err.message || err).slice(0, 160) });
      }
    }

    console.log(`[recording/analyze-pending] candidates=${pending.length} analyzed=${analyzed} failed=${failed}`);
    return res.json({
      ok: true,
      candidates: pending.length,
      analyzed,
      failed,
      failures: failures.slice(0, 10),
    });
  } catch (err) {
    console.error('[recording/analyze-pending] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /collect/x/queue-clean  (internal)
 * Removes failed / completed jobs from BullMQ so they stop being counted.
 * Useful after a wave of orphaned recordings burned through retries and left
 * a big `failed` pile behind.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/queue-clean', async (req, res) => {
  const secret = req.headers['x-adray-internal'] || req.body?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  try {
    if (!recordingQueue) {
      return res.json({ ok: false, error: 'Queue not initialized' });
    }

    // Clean states: failed older than 0ms (all), completed older than 1h
    const [removedFailed, removedCompleted] = await Promise.all([
      recordingQueue.clean(0, 5000, 'failed').catch(() => []),
      recordingQueue.clean(60 * 60 * 1000, 5000, 'completed').catch(() => []),
    ]);

    return res.json({
      ok: true,
      removedFailed: Array.isArray(removedFailed) ? removedFailed.length : 0,
      removedCompleted: Array.isArray(removedCompleted) ? removedCompleted.length : 0,
    });
  } catch (err) {
    console.error('[recording/queue-clean] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /collect/x/loops-status  (public — read-only health info, no PII)
 * Reports the runtime state of the BRI auto-loops: when each last ran,
 * how long it took, last result summary, run/error counters, and when
 * the next tick is scheduled. Lets the dashboard prove the loops are
 * actually alive instead of just trusting hardcoded "every 10m" copy.
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/loops-status', async (_req, res) => {
  try {
    const loopsStatus = require('../utils/loopsStatus');
    return res.json({ ok: true, loops: loopsStatus.snapshot(), now: new Date() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /collect/x/queue-stats  (internal)
 * Returns BullMQ counts so we can diagnose a stuck worker without logs.
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/queue-stats', async (req, res) => {
  const secret = req.headers['x-adray-internal'] || req.query?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  try {
    if (!recordingQueue) {
      return res.json({ ok: false, error: 'Queue not initialized' });
    }

    const [waiting, active, delayed, completed, failed] = await Promise.all([
      recordingQueue.getWaitingCount(),
      recordingQueue.getActiveCount(),
      recordingQueue.getDelayedCount(),
      recordingQueue.getCompletedCount(),
      recordingQueue.getFailedCount(),
    ]);

    // Peek at the top of each state to spot stuck job types
    const [waitingSample, activeSample, failedSample] = await Promise.all([
      recordingQueue.getJobs(['waiting'], 0, 5, true).catch(() => []),
      recordingQueue.getJobs(['active'], 0, 5, true).catch(() => []),
      recordingQueue.getJobs(['failed'], 0, 5, true).catch(() => []),
    ]);

    const summarize = (j) => ({
      name: j.name,
      id: j.id,
      attemptsMade: j.attemptsMade,
      failedReason: j.failedReason ? String(j.failedReason).slice(0, 160) : null,
    });

    return res.json({
      ok: true,
      counts: { waiting, active, delayed, completed, failed },
      samples: {
        waiting: waitingSample.map(summarize),
        active: activeSample.map(summarize),
        failed: failedSample.map(summarize),
      },
    });
  } catch (err) {
    console.error('[recording/queue-stats] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /collect/x/relink-sessions
 * For all READY recordings with a valid sessionId, updates Session.rrwebRecordingId
 * so playback buttons appear on orders without needing a re-finalize.
 * Protected by x-adray-internal header.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/relink-sessions', async (req, res) => {
  const secret = req.headers['x-adray-internal'] || req.body?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  try {
    const readyRecs = await prisma.sessionRecording.findMany({
      where: { status: 'READY', rawErasedAt: null },
      select: { recordingId: true, accountId: true, sessionId: true },
      take: 500,
    });

    const linkable = readyRecs.filter((r) => r.sessionId && r.sessionId !== 'unknown');
    let linked = 0;
    for (const rec of linkable) {
      const { count } = await prisma.session.updateMany({
        where: { sessionId: rec.sessionId, accountId: rec.accountId, rrwebRecordingId: null },
        data: { rrwebRecordingId: rec.recordingId },
      }).catch(() => ({ count: 0 }));
      linked += count;
    }

    return res.json({ ok: true, readyRecordings: readyRecs.length, linkable: linkable.length, sessionsLinked: linked });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /collect/x/cleanup-broken
 * Scans READY recordings for missing FullSnapshot (type 2) and marks them ERROR.
 * Run once after deploy to purge unplayable recordings from the panel.
 * Protected by x-adray-internal header.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/cleanup-broken', async (req, res) => {
  const secret = req.headers['x-adray-internal'] || req.body?.secret;
  if (secret !== (process.env.INTERNAL_CRON_SECRET || 'adray-internal')) {
    return res.status(403).json({ ok: false });
  }

  const { downloadChunk: dl, listChunkKeys: listKeys } = require('../utils/r2Client');

  try {
    const readyRecs = await prisma.sessionRecording.findMany({
      where: { status: 'READY', rawErasedAt: null },
      select: { recordingId: true, accountId: true, r2Key: true, r2ChunksPrefix: true },
      take: 100,
    });

    let broken = 0;
    let ok = 0;
    const results = [];

    for (const rec of readyRecs) {
      try {
        // Try final key first (assembled recording)
        let events = [];
        if (rec.r2Key) {
          events = await dl(rec.r2Key).catch(() => []);
        }
        // If no final key, check chunks
        if (!events.length && rec.r2ChunksPrefix) {
          const keys = await listKeys(rec.r2ChunksPrefix).catch(() => []);
          for (const k of keys.slice(0, 3)) { // only check first 3 chunks
            const chunk = await dl(k).catch(() => []);
            events.push(...chunk);
            if (events.some((e) => e.type === 2)) break;
          }
        }
        const hasFs = events.some((e) => e.type === 2);
        if (!hasFs) {
          await prisma.sessionRecording.update({ where: { recordingId: rec.recordingId }, data: { status: 'ERROR' } });
          broken++;
          results.push({ recordingId: rec.recordingId, status: 'marked_ERROR' });
        } else {
          ok++;
        }
      } catch (_) {
        results.push({ recordingId: rec.recordingId, status: 'check_failed' });
      }
    }

    return res.json({ ok: true, checked: readyRecs.length, broken, playable: ok, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
