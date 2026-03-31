// backend/routes/internalDailySignal.js
'use strict';

const express = require('express');
const router = express.Router();

const {
  runDailySignalDeliveryBatch,
  runDailySignalDeliveryForUser,
} = require('../services/dailySignalDeliveryService');

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function setNoCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
}

function requireInternalCronKey(req, res, next) {
  const expected = safeStr(process.env.DAILY_SIGNAL_CRON_KEY).trim();
  if (!expected) {
    return res.status(500).json({
      ok: false,
      error: 'DAILY_SIGNAL_CRON_KEY_NOT_CONFIGURED',
    });
  }

  const provided =
    safeStr(req.get('x-internal-cron-key')).trim() ||
    safeStr(req.get('x-cron-key')).trim() ||
    safeStr(req.query?.key).trim();

  console.log('[internalDailySignal/auth]', {
    path: req.originalUrl,
    method: req.method,
    hasExpected: !!expected,
    hasProvided: !!provided,
    expectedLength: expected ? expected.length : 0,
    providedLength: provided ? provided.length : 0,
    matches: !!provided && !!expected && provided === expected,
    providedPreview: provided ? `${provided.slice(0, 6)}...${provided.slice(-4)}` : null,
    expectedPreview: expected ? `${expected.slice(0, 6)}...${expected.slice(-4)}` : null,
  });

  if (!provided || provided !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'INVALID_INTERNAL_CRON_KEY',
    });
  }

  return next();
}

function resolveWindowMinutes(body = {}, fallback = 20) {
  const n = toInt(body?.windowMinutes, fallback);
  return Math.max(0, Math.min(180, n));
}

router.use(requireInternalCronKey);

router.get('/health', async (_req, res) => {
  setNoCacheHeaders(res);
  return res.json({
    ok: true,
    data: {
      service: 'internalDailySignal',
      configured: !!safeStr(process.env.DAILY_SIGNAL_CRON_KEY).trim(),
      now: new Date().toISOString(),
      defaultTimezone: 'America/Mexico_City',
      defaultSendHour: 5,
      defaultSendMinute: 0,
      recommendedCronTime: '05:00 America/Mexico_City',
    },
  });
});

router.post('/run', async (req, res) => {
  console.log('[internalDailySignal/run] reached', {
    method: req.method,
    url: req.originalUrl,
    body: req.body,
    contentType: req.get('content-type') || null,
  });

  try {
    const result = await runDailySignalDeliveryBatch({
      now: new Date(),
      trigger: 'cron',
      reason: 'daily_signal_cron_run',
      force: toBool(req.body?.force),
      allowRetrySameDay: toBool(req.body?.allowRetrySameDay),
      respectSchedule: 'respectSchedule' in (req.body || {})
        ? toBool(req.body?.respectSchedule)
        : true,
      windowMinutes: resolveWindowMinutes(req.body, 20),
    });

    console.log('[internalDailySignal/run] batch result', result);

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    console.error('[internalDailySignal/run] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_DAILY_SIGNAL_RUN_FAILED',
      message: err?.message || 'Unknown error',
    });
  }
});

router.post('/run-all', async (req, res) => {
  try {
    const result = await runDailySignalDeliveryBatch({
      now: new Date(),
      trigger: 'cron',
      reason: 'daily_signal_cron_run_all',
      force: toBool(req.body?.force),
      allowRetrySameDay: toBool(req.body?.allowRetrySameDay),
      respectSchedule: 'respectSchedule' in (req.body || {})
        ? toBool(req.body?.respectSchedule)
        : true,
      windowMinutes: resolveWindowMinutes(req.body, 20),
    });

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    console.error('[internalDailySignal/run-all] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_DAILY_SIGNAL_RUN_ALL_FAILED',
    });
  }
});

router.post('/run/:userId', async (req, res) => {
  try {
    const userId = safeStr(req.params?.userId).trim();
    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_USER_ID',
      });
    }

    const result = await runDailySignalDeliveryForUser(userId, {
      now: new Date(),
      trigger: 'manual_test',
      reason: 'internal_manual_test',
      force: toBool(req.body?.force),
      allowRetrySameDay: toBool(req.body?.allowRetrySameDay),
      respectSchedule: 'respectSchedule' in (req.body || {})
        ? toBool(req.body?.respectSchedule)
        : false,
      windowMinutes: resolveWindowMinutes(req.body, 20),
    });

    setNoCacheHeaders(res);

    if (!result?.ok && !result?.skipped) {
      return res.status(500).json({
        ok: false,
        error: result?.code || 'INTERNAL_DAILY_SIGNAL_USER_RUN_FAILED',
        message: result?.message || 'Failed to run daily signal for user',
        data: result,
      });
    }

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    console.error('[internalDailySignal/run/:userId] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_DAILY_SIGNAL_USER_RUN_FAILED',
    });
  }
});

module.exports = router;