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
    const createWithDevice = { ...createData, deviceType: device_type || null };
    try {
      await prisma.sessionRecording.create({ data: createWithDevice });
    } catch (createErr) {
      // P2002: unique constraint — row already exists (likely from /buf auto-create)
      if (createErr?.code === 'P2002') {
        await prisma.sessionRecording.update({
          where: { recordingId: recording_id },
          data: {
            cartValue: cart_value ? parseFloat(cart_value) : undefined,
            checkoutToken: checkout_token || undefined,
            attributionSnapshot: attributionSnapshot || undefined,
            deviceType: device_type || undefined,
          },
        }).catch((updateErr) => {
          // Tolerate missing deviceType column during deploy lag
          if (updateErr?.message?.includes('deviceType') || updateErr?.message?.includes('device_type')) {
            return prisma.sessionRecording.update({
              where: { recordingId: recording_id },
              data: {
                cartValue: cart_value ? parseFloat(cart_value) : undefined,
                checkoutToken: checkout_token || undefined,
                attributionSnapshot: attributionSnapshot || undefined,
              },
            });
          }
          throw updateErr;
        });
      } else if (createErr?.message?.includes('deviceType') || createErr?.message?.includes('device_type')) {
        // Column not deployed yet — create without it
        await prisma.sessionRecording.create({ data: createData }).catch((e2) => {
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
 * GET /api/recording/:account_id/by-user?userKey=X
 * Returns all READY recordings for a given userKey, ordered chronologically.
 * Used by Selected Journey to offer a stitched playback across the user's
 * fragmented recordings of the same purchase journey.
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/:account_id/by-user', async (req, res) => {
  try {
    const { account_id } = req.params;
    let userKey = String(req.query.userKey || '').trim();
    const recordingId = String(req.query.recordingId || '').trim();

    // If caller provided no usable userKey (or 'anonymous'), try to resolve it
    // from a known recordingId. This handles the common case where the Order
    // row has a different userKey than the recording rows (identity can shift
    // between AddToCart and checkout) — we trust the recording's key.
    if ((!userKey || userKey === 'anonymous') && recordingId) {
      const ref = await prisma.sessionRecording.findUnique({
        where: { recordingId },
        select: { userKey: true, accountId: true },
      }).catch(() => null);
      if (ref && ref.accountId === account_id && ref.userKey && ref.userKey !== 'anonymous') {
        userKey = ref.userKey;
      }
    }

    if (!userKey || userKey === 'anonymous') {
      return res.json({ ok: true, recordings: [], resolvedUserKey: null });
    }

    const recs = await prisma.sessionRecording.findMany({
      where: {
        accountId: account_id,
        userKey,
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
    return res.json({ ok: true, recordings: recs, resolvedUserKey: userKey });
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

    const recs = await prisma.sessionRecording.findMany({
      where,
      select: { recordingId: true, accountId: true, sessionId: true, r2ChunksPrefix: true, chunkCount: true },
      take: 10,
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
