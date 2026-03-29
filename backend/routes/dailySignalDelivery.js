// backend/routes/dailySignalDelivery.js
'use strict';

const express = require('express');
const router = express.Router();

const User = require('../models/User');
const {
  getDailySignalDeliveryStatusForUser,
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

router.get('/status', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const status = await getDailySignalDeliveryStatusForUser(userId);
    setNoCacheHeaders(res);
    return res.json(status);
  } catch (err) {
    console.error('[dailySignalDelivery/status] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'DAILY_SIGNAL_DELIVERY_STATUS_FAILED',
    });
  }
});

router.post('/enable', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const me = await User.findById(userId)
      .select('email dailySignalDelivery')
      .lean();

    if (!me) {
      return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    }

    if (typeof User.enableDailySignalDelivery !== 'function') {
      return res.status(500).json({
        ok: false,
        error: 'DAILY_SIGNAL_DELIVERY_HELPER_MISSING',
      });
    }

    const email =
      safeStr(req.body?.email).trim() ||
      safeStr(me?.dailySignalDelivery?.email).trim() ||
      safeStr(me?.email).trim() ||
      null;

    const timezone =
      safeStr(req.body?.timezone).trim() ||
      safeStr(me?.dailySignalDelivery?.timezone).trim() ||
      'America/Mexico_City';

    const sendHour =
      req.body?.sendHour != null
        ? toInt(req.body.sendHour, 15)
        : (me?.dailySignalDelivery?.sendHour ?? 15);

    const sendMinute =
      req.body?.sendMinute != null
        ? toInt(req.body.sendMinute, 0)
        : (me?.dailySignalDelivery?.sendMinute ?? 0);

    const updated = await User.enableDailySignalDelivery(userId, {
      email,
      timezone,
      sendHour,
      sendMinute,
    });

    setNoCacheHeaders(res);

    return res.json({
      ok: true,
      data: {
        enabled: !!updated?.dailySignalDelivery?.enabled,
        email: updated?.dailySignalDelivery?.email || updated?.email || null,
        timezone: updated?.dailySignalDelivery?.timezone || 'America/Mexico_City',
        sendHour: updated?.dailySignalDelivery?.sendHour ?? 15,
        sendMinute: updated?.dailySignalDelivery?.sendMinute ?? 0,
        optedInAt: updated?.dailySignalDelivery?.optedInAt || null,
        status: updated?.dailySignalDelivery?.status || 'scheduled',
      },
    });
  } catch (err) {
    console.error('[dailySignalDelivery/enable] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'DAILY_SIGNAL_DELIVERY_ENABLE_FAILED',
    });
  }
});

router.post('/disable', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    if (typeof User.disableDailySignalDelivery !== 'function') {
      return res.status(500).json({
        ok: false,
        error: 'DAILY_SIGNAL_DELIVERY_HELPER_MISSING',
      });
    }

    const updated = await User.disableDailySignalDelivery(userId);

    setNoCacheHeaders(res);

    return res.json({
      ok: true,
      data: {
        enabled: !!updated?.dailySignalDelivery?.enabled,
        optedOutAt: updated?.dailySignalDelivery?.optedOutAt || null,
        status: updated?.dailySignalDelivery?.status || 'idle',
      },
    });
  } catch (err) {
    console.error('[dailySignalDelivery/disable] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'DAILY_SIGNAL_DELIVERY_DISABLE_FAILED',
    });
  }
});

router.post('/send-now', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const result = await runDailySignalDeliveryForUser(userId, {
      now: new Date(),
      trigger: 'manual',
      reason: 'manual_send_now',
      force: toBool(req.body?.force),
      allowRetrySameDay: toBool(req.body?.allowRetrySameDay),
      respectSchedule: false,
    });

    setNoCacheHeaders(res);

    if (!result?.ok && !result?.skipped) {
      return res.status(500).json({
        ok: false,
        error: result?.code || 'DAILY_SIGNAL_DELIVERY_SEND_NOW_FAILED',
        message: result?.message || 'Failed to send daily signal now',
        data: result,
      });
    }

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    console.error('[dailySignalDelivery/send-now] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'DAILY_SIGNAL_DELIVERY_SEND_NOW_FAILED',
    });
  }
});

module.exports = router;