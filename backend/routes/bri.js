'use strict';

const { Router } = require('express');
const prisma = require('../utils/prismaClient');

const router = Router();

/**
 * GET /api/bri/pipeline-stats
 * Returns counts for recordings, sessionPackets, persons, and BRI-enriched orders.
 */
router.get('/pipeline-stats', async (req, res) => {
  try {
    const [
      recCounts,
      totalPackets,
      analyzedPackets,
      personCount,
      briEnrichedCount,
    ] = await Promise.all([
      // Recordings grouped by status
      prisma.sessionRecording.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      prisma.sessionPacket.count(),
      prisma.sessionPacket.count({ where: { aiAnalyzedAt: { not: null } } }),
      prisma.person.count(),
      // Orders that had BRI sent (capiSentMeta=true is a reasonable proxy)
      prisma.order.count({ where: { capiSentMeta: true } }),
    ]);

    const recordings = { RECORDING: 0, FINALIZING: 0, READY: 0, ERROR: 0 };
    for (const r of recCounts) {
      if (r.status in recordings) recordings[r.status] = r._count.status;
    }

    return res.json({
      recordings,
      sessionPackets: {
        total: totalPackets,
        analyzed: analyzedPackets,
        pending: totalPackets - analyzedPackets,
      },
      persons: personCount,
      briEnriched: briEnrichedCount,
    });
  } catch (err) {
    console.error('[BRI] pipeline-stats error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bri/persons?limit=20
 * Returns recent Persons with their PersonAnalysis.
 */
router.get('/persons', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const persons = await prisma.person.findMany({
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
      include: { analysis: true },
    });

    return res.json(persons);
  } catch (err) {
    console.error('[BRI] persons error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bri/session-packets?limit=50
 * Returns recent SessionPackets with their AI analysis.
 */
router.get('/session-packets', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const packets = await prisma.sessionPacket.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        sessionId: true,
        accountId: true,
        visitorId: true,
        personId: true,
        outcome: true,
        orderId: true,
        cartValueAtEnd: true,
        aiAnalysis: true,
        aiAnalyzedAt: true,
        startTs: true,
        endTs: true,
        durationMs: true,
        keyframes: true,
        signals: true,
      },
    });

    return res.json(packets);
  } catch (err) {
    console.error('[BRI] session-packets error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
