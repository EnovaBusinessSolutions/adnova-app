// backend/routes/mcpjobs.js
'use strict';

const express = require('express');
const router = express.Router();

const { enqueueMcpCollect } = require('../queues/mcpQueue');

router.post('/collect/meta', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ ok: false, error: 'NO_SESSION' });

    const rangeDays = req.body?.rangeDays ? Number(req.body.rangeDays) : null;

    const job = await enqueueMcpCollect({
      userId,
      source: 'metaAds',
      rangeDays,
      reason: 'manual_api',
    });

    return res.json({ ok: true, jobId: job.id });
  } catch (e) {
    console.error('[mcpjobs/meta] error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'ENQUEUE_FAILED' });
  }
});

module.exports = router;