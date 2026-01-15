// backend/routes/cronEmails.js
'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { runDailyQuickCallJob } = require('../jobs/dailyQuickCallJob');

function safeTrim(v) {
  return String(v == null ? '' : v).trim();
}

function toBool(v) {
  const s = safeTrim(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function requireCronKey(req, res, next) {
  const key = safeTrim(req.query.key || req.headers['x-cron-key']);
  const expected = safeTrim(process.env.CRON_KEY);

  if (!expected) {
    return res.status(500).json({ ok: false, error: 'CRON_KEY_NOT_SET' });
  }
  if (!key) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }

  // ✅ comparación constante (evita timing attacks)
  try {
    const a = Buffer.from(key);
    const b = Buffer.from(expected);

    // timingSafeEqual requiere misma longitud
    const equal = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!equal) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  } catch {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }

  return next();
}

/**
 * GET /api/cron/_health?key=XXXX
 * (no ejecuta jobs, solo confirma que el cron route vive)
 */
router.get('/_health', requireCronKey, (_req, res) => {
  res.json({ ok: true, service: 'cronEmails', ts: new Date().toISOString() });
});

/**
 * GET /api/cron/daily-quick-call?key=XXXX&dry=1&operator=César&onlyVerified=1&onlyNotOnboarded=1&limit=200
 */
router.get('/daily-quick-call', requireCronKey, async (req, res) => {
  const dryRun = String(req.query.dry || '').trim() === '1';
  const operatorName = safeTrim(req.query.operator) || 'César';

  const onlyVerified = toBool(req.query.onlyVerified);
  const onlyNotOnboarded = toBool(req.query.onlyNotOnboarded);

  const limitRaw = safeTrim(req.query.limit);
  const limit = limitRaw ? Number(limitRaw) : 0;

  try {
    const out = await runDailyQuickCallJob({
      operatorName,
      dryRun,
      onlyVerified,
      onlyNotOnboarded,
      limit: Number.isFinite(limit) ? limit : 0,
    });

    return res.json(out);
  } catch (err) {
    console.error('[cronEmails] /daily-quick-call error:', err?.message || err);
    return res.status(500).json({
      ok: false,
      error: 'CRON_JOB_FAILED',
      message: err?.message || 'Unknown error',
    });
  }
});

module.exports = router;
