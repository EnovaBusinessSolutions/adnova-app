// backend/routes/platformConnections.js
'use strict';

const express = require('express');
const router  = express.Router();
const prisma  = require('../utils/prismaClient');

const VALID_PLATFORMS = new Set(['META', 'GOOGLE', 'TIKTOK']);

/**
 * POST /api/platform-connections
 * Upsert a platform connection for the current merchant (session user).
 * Body: { accountId, platform, accessToken, pixelId?, adAccountId? }
 */
router.post('/', async (req, res) => {
  try {
    const body       = req.body || {};
    const accountId  = String(body.accountId  || '').trim();
    const platform   = String(body.platform   || '').toUpperCase().trim();
    const accessToken = String(body.accessToken || '').trim();
    const pixelId    = body.pixelId     ? String(body.pixelId).trim()     : null;
    const adAccountId = body.adAccountId ? String(body.adAccountId).trim() : null;

    if (!accountId)  return res.status(400).json({ ok: false, error: 'accountId required' });
    if (!VALID_PLATFORMS.has(platform)) {
      return res.status(400).json({ ok: false, error: `platform must be one of: ${[...VALID_PLATFORMS].join(', ')}` });
    }
    if (!accessToken) return res.status(400).json({ ok: false, error: 'accessToken required' });

    // Ensure Account row exists
    await prisma.account.upsert({
      where:  { accountId },
      create: { accountId, domain: accountId, platform: 'WOOCOMMERCE' },
      update: {},
    });

    const existing = await prisma.platformConnection.findFirst({
      where: { accountId, platform },
    });

    let conn;
    if (existing) {
      conn = await prisma.platformConnection.update({
        where: { id: existing.id },
        data:  { accessToken, pixelId, adAccountId, status: 'ACTIVE' },
      });
    } else {
      conn = await prisma.platformConnection.create({
        data: { accountId, platform, accessToken, pixelId, adAccountId, status: 'ACTIVE' },
      });
    }

    return res.json({ ok: true, id: conn.id, platform: conn.platform, pixelId: conn.pixelId });
  } catch (err) {
    console.error('[PlatformConnections] Error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/platform-connections?accountId=...
 * Returns all connections for an account (tokens redacted).
 */
router.get('/', async (req, res) => {
  try {
    const accountId = String(req.query.accountId || '').trim();
    if (!accountId) return res.status(400).json({ ok: false, error: 'accountId required' });

    const rows = await prisma.platformConnection.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });

    const data = rows.map((r) => ({
      id:          r.id,
      platform:    r.platform,
      pixelId:     r.pixelId,
      adAccountId: r.adAccountId,
      status:      r.status,
      createdAt:   r.createdAt,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[PlatformConnections] GET Error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

module.exports = router;
