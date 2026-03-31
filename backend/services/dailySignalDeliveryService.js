// backend/services/dailySignalDeliveryService.js
'use strict';

const User = require('../models/User');
const SignalData = require('../models/SignalData');
const DailySignalDeliveryRun = require('../models/DailySignalDeliveryRun');

const {
  findRoot,
  rebuildUnifiedContextForUser,
  buildPdfForUser,
} = require('./mcpContextBuilder');

const {
  sendDailySignalEmail,
} = require('./dailySignalMailer');

/* =========================
 * Helpers
 * ========================= */
function safeStr(v) {
  return v == null ? '' : String(v);
}

function normEmail(v = '') {
  const s = String(v || '').trim().toLowerCase();
  return s || null;
}

function normTimezone(v = '') {
  const s = String(v || '').trim();
  return s || 'America/Mexico_City';
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fileLooksReady(pdf = {}) {
  return !!(
    pdf &&
    safeStr(pdf.status).trim() === 'ready' &&
    safeStr(pdf.localPath).trim()
  );
}

function hasExistingReadyPdf(root = null) {
  const pdf = root?.aiContext?.pdf || {};
  return !!(
    safeStr(pdf?.status).trim() === 'ready' &&
    safeStr(pdf?.localPath).trim() &&
    safeStr(pdf?.generatedAt).trim()
  );
}

function getPdfArtifactFromRoot(root = null) {
  const pdf = root?.aiContext?.pdf || {};
  return {
    fileName: pdf?.fileName || null,
    mimeType: pdf?.mimeType || 'application/pdf',
    localPath: pdf?.localPath || null,
    downloadUrl: pdf?.downloadUrl || null,
    sizeBytes: toNum(pdf?.sizeBytes, 0),
    pageCount: toNum(pdf?.pageCount, 0) || null,
    renderer: pdf?.renderer || null,
  };
}

function getZonedParts(date = new Date(), timezone = 'America/Mexico_City') {
  const d = date instanceof Date ? date : new Date(date);
  const tz = normTimezone(timezone);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  return {
    year: toNum(map.year, 0),
    month: toNum(map.month, 0),
    day: toNum(map.day, 0),
    hour: toNum(map.hour, 0),
    minute: toNum(map.minute, 0),
    timezone: tz,
  };
}

function buildDateKeyForTimezone(date = new Date(), timezone = 'America/Mexico_City') {
  const p = getZonedParts(date, timezone);
  if (!p.year || !p.month || !p.day) return null;
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function isWithinScheduleWindow({
  now = new Date(),
  timezone = 'America/Mexico_City',
  sendHour = 5,
  sendMinute = 0,
  windowMinutes = 20,
} = {}) {
  const p = getZonedParts(now, timezone);
  const currentMinutes = p.hour * 60 + p.minute;
  const scheduledMinutes = toNum(sendHour, 5) * 60 + toNum(sendMinute, 0);
  return Math.abs(currentMinutes - scheduledMinutes) <= Math.max(0, toNum(windowMinutes, 20));
}

function resolveRecipientEmail(user) {
  return (
    normEmail(user?.dailySignalDelivery?.email) ||
    normEmail(user?.email) ||
    null
  );
}

function buildRunMeta(extra = {}) {
  return {
    service: 'dailySignalDeliveryService',
    ...extra,
  };
}

async function getCurrentSignalRun(userId, buildAttemptId = null) {
  const cleanAttempt = safeStr(buildAttemptId).trim();

  try {
    if (cleanAttempt && typeof SignalData.findByAttempt === 'function') {
      const byAttempt = await SignalData.findByAttempt(userId, cleanAttempt);
      if (byAttempt) return byAttempt;
    }

    if (typeof SignalData.findCurrentRunForUser === 'function') {
      const current = await SignalData.findCurrentRunForUser(userId);
      if (current) return current;
    }

    if (typeof SignalData.findLatestForUser === 'function') {
      const latest = await SignalData.findLatestForUser(userId);
      if (latest) return latest;
    }
  } catch (err) {
    console.error('[dailySignalDeliveryService] getCurrentSignalRun warning:', err?.message || err);
  }

  return null;
}

async function markUserDeliveryStatus(userId, patch = {}) {
  if (!userId || typeof User.markDailySignalDeliveryStatus !== 'function') return null;

  try {
    return await User.markDailySignalDeliveryStatus(userId, patch);
  } catch (err) {
    console.error('[dailySignalDeliveryService] markUserDeliveryStatus warning:', err?.message || err);
    return null;
  }
}

function buildPublicResult(ok, data = {}) {
  return { ok: !!ok, ...data };
}

/* =========================
 * Eligibility / guardrails
 * ========================= */
async function getDailyDeliveryUser(userId) {
  if (!userId) return null;

  return await User.findById(userId)
    .select([
      '_id',
      'name',
      'email',
      'dailySignalDelivery',
    ].join(' '))
    .lean();
}

function evaluateUserEligibility(user, options = {}) {
  const timezone = normTimezone(user?.dailySignalDelivery?.timezone);
  const sendHour = toNum(user?.dailySignalDelivery?.sendHour, 5);
  const sendMinute = toNum(user?.dailySignalDelivery?.sendMinute, 0);
  const recipientEmail = resolveRecipientEmail(user);

  if (!user?._id) {
    return { eligible: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  if (!user?.dailySignalDelivery?.enabled) {
    return { eligible: false, code: 'DAILY_SIGNAL_DELIVERY_DISABLED', message: 'Daily delivery disabled' };
  }

  if (!recipientEmail) {
    return { eligible: false, code: 'DAILY_SIGNAL_DELIVERY_EMAIL_REQUIRED', message: 'Recipient email missing' };
  }

  if (options.respectSchedule) {
    const due = isWithinScheduleWindow({
      now: options.now || new Date(),
      timezone,
      sendHour,
      sendMinute,
      windowMinutes: options.windowMinutes,
    });

    if (!due) {
      return {
        eligible: false,
        code: 'DAILY_SIGNAL_DELIVERY_NOT_IN_SCHEDULE_WINDOW',
        message: 'Not in schedule window',
      };
    }
  }

  return {
    eligible: true,
    recipientEmail,
    timezone,
    sendHour,
    sendMinute,
  };
}

/* =========================
 * Main per-user runner
 * ========================= */
async function runDailySignalDeliveryForUser(userId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const trigger = safeStr(options.trigger).trim() || 'cron';
  const reason = safeStr(options.reason).trim() || 'daily_signal_delivery';
  const force = !!options.force;
  const allowRetrySameDay = !!options.allowRetrySameDay;

  const user = await getDailyDeliveryUser(userId);
  const eligibility = evaluateUserEligibility(user, options);

  if (!eligibility.eligible) {
    return buildPublicResult(false, {
      skipped: true,
      code: eligibility.code,
      message: eligibility.message,
      userId: safeStr(userId),
    });
  }

  const {
    recipientEmail,
    timezone,
  } = eligibility;

  const dateKey = buildDateKeyForTimezone(now, timezone);
  if (!dateKey) {
    return buildPublicResult(false, {
      skipped: true,
      code: 'DAILY_SIGNAL_DELIVERY_DATE_KEY_FAILED',
      message: 'Could not build dateKey',
      userId: safeStr(userId),
    });
  }

  const existingRun = await DailySignalDeliveryRun.findByUserAndDateKey(user._id, dateKey);

  if (!force && existingRun) {
    const existingStatus = safeStr(existingRun.status).trim();

    if (existingStatus === 'sent') {
      return buildPublicResult(true, {
        skipped: true,
        code: 'DAILY_SIGNAL_ALREADY_SENT_TODAY',
        message: 'Daily signal already sent today',
        userId: String(user._id),
        dateKey,
        run: existingRun,
      });
    }

    if (existingStatus === 'building_signal' || existingStatus === 'building_pdf' || existingStatus === 'sending_email') {
      return buildPublicResult(true, {
        skipped: true,
        code: 'DAILY_SIGNAL_RUN_ALREADY_ACTIVE',
        message: 'Daily signal delivery already active',
        userId: String(user._id),
        dateKey,
        run: existingRun,
      });
    }

    if (!allowRetrySameDay && existingStatus === 'failed') {
      return buildPublicResult(true, {
        skipped: true,
        code: 'DAILY_SIGNAL_FAILED_ALREADY_TODAY',
        message: 'Daily signal already failed today; retry disabled',
        userId: String(user._id),
        dateKey,
        run: existingRun,
      });
    }
  }

  const attemptedAt = new Date();

  let root = await findRoot(user._id);
  const existingPdf = getPdfArtifactFromRoot(root);
  const firstPdfReady = hasExistingReadyPdf(root);

  if (!firstPdfReady) {
    await DailySignalDeliveryRun.upsertForDay({
      userId: user._id,
      dateKey,
      trigger,
      reason,
      status: 'skipped',
      email: {
        to: recipientEmail,
        provider: 'resend',
      },
      pdf: existingPdf,
      attemptedAt,
      meta: buildRunMeta({
        force,
        timezone,
        scheduledHour: toNum(user?.dailySignalDelivery?.sendHour, 5),
        scheduledMinute: toNum(user?.dailySignalDelivery?.sendMinute, 0),
        skipReason: 'FIRST_PDF_NOT_READY',
      }),
    });

    await DailySignalDeliveryRun.markSkipped(user._id, dateKey, {
      attemptedAt,
      skippedAt: new Date(),
      reason: 'FIRST_PDF_NOT_READY',
      errorCode: 'FIRST_PDF_NOT_READY',
      meta: buildRunMeta({
        pdfStatus: root?.aiContext?.pdf?.status || null,
        pdfGeneratedAt: root?.aiContext?.pdf?.generatedAt || null,
      }),
    });

    await markUserDeliveryStatus(user._id, {
      status: 'scheduled',
      lastAttemptAt: attemptedAt,
      lastErrorAt: null,
      lastError: null,
    });

    return buildPublicResult(true, {
      skipped: true,
      code: 'FIRST_PDF_NOT_READY',
      message: 'User has not completed the first PDF yet',
      userId: String(user._id),
      dateKey,
    });
  }

  await DailySignalDeliveryRun.upsertForDay({
    userId: user._id,
    dateKey,
    trigger,
    reason,
    status: 'queued',
    email: {
      to: recipientEmail,
      provider: 'resend',
    },
    pdf: existingPdf,
    attemptedAt,
    meta: buildRunMeta({
      force,
      timezone,
      scheduledHour: toNum(user?.dailySignalDelivery?.sendHour, 5),
      scheduledMinute: toNum(user?.dailySignalDelivery?.sendMinute, 0),
      firstPdfReady: true,
    }),
  });

  await markUserDeliveryStatus(user._id, {
    status: 'building_signal',
    lastAttemptAt: attemptedAt,
    lastErrorAt: null,
    lastError: null,
  });

  let signalRun = null;
  let buildAttemptId = null;

  try {
    await DailySignalDeliveryRun.markStatus(user._id, dateKey, {
      status: 'building_signal',
      rootId: root?._id || null,
      snapshotId: root?.aiContext?.snapshotId || root?.latestSnapshotId || null,
      sourceFingerprint: root?.aiContext?.sourceFingerprint || null,
      connectionFingerprint: root?.aiContext?.connectionFingerprint || null,
      email: { to: recipientEmail, provider: 'resend' },
      pdf: existingPdf,
      attemptedAt,
    });

    const rebuild = await rebuildUnifiedContextForUser(user._id, {
      forceRebuild: true,
      reason,
      requestedBy: 'daily_signal_delivery_service',
      trigger,
    });

    root = rebuild?.root || await findRoot(user._id);
    const rebuildData = rebuild?.data || root?.aiContext || {};
    buildAttemptId = safeStr(root?.aiContext?.buildAttemptId || rebuildData?.buildAttemptId).trim() || null;

    signalRun = await getCurrentSignalRun(user._id, buildAttemptId);

    if (!rebuildData?.signalReadyForPdf && !root?.aiContext?.signalReadyForPdf && !root?.aiContext?.signalValidForPdf) {
      const errorCode = 'DAILY_SIGNAL_NOT_READY_FOR_PDF';

      await DailySignalDeliveryRun.markFailed(user._id, dateKey, {
        rootId: root?._id || null,
        signalRunId: signalRun?.signalRunId || null,
        buildAttemptId: buildAttemptId || null,
        snapshotId: root?.aiContext?.snapshotId || root?.latestSnapshotId || null,
        sourceFingerprint: root?.aiContext?.sourceFingerprint || null,
        connectionFingerprint: root?.aiContext?.connectionFingerprint || null,
        email: { to: recipientEmail, provider: 'resend' },
        pdf: getPdfArtifactFromRoot(root),
        attemptedAt,
        error: errorCode,
        errorCode,
        meta: buildRunMeta({
          stage: rebuildData?.stage || root?.aiContext?.stage || null,
          status: rebuildData?.status || root?.aiContext?.status || null,
        }),
      });

      await markUserDeliveryStatus(user._id, {
        status: 'failed',
        lastAttemptAt: attemptedAt,
        lastErrorAt: new Date(),
        lastError: errorCode,
      });

      return buildPublicResult(false, {
        code: errorCode,
        message: 'Signal not ready for PDF',
        userId: String(user._id),
        dateKey,
      });
    }

    await DailySignalDeliveryRun.markStatus(user._id, dateKey, {
      status: 'building_pdf',
      rootId: root?._id || null,
      signalRunId: signalRun?.signalRunId || null,
      buildAttemptId: buildAttemptId || null,
      snapshotId: root?.aiContext?.snapshotId || root?.latestSnapshotId || null,
      sourceFingerprint: root?.aiContext?.sourceFingerprint || null,
      connectionFingerprint: root?.aiContext?.connectionFingerprint || null,
      email: { to: recipientEmail, provider: 'resend' },
      pdf: getPdfArtifactFromRoot(root),
      attemptedAt,
    });

    await markUserDeliveryStatus(user._id, {
      status: 'building_pdf',
      lastAttemptAt: attemptedAt,
    });

    const pdfBuild = await buildPdfForUser(user._id);
    root = pdfBuild?.root || await findRoot(user._id);

    const pdf = root?.aiContext?.pdf || {};
    const signalPayload = root?.aiContext?.signalPayload || root?.aiContext?.encodedPayload || null;
    buildAttemptId = safeStr(root?.aiContext?.buildAttemptId || buildAttemptId).trim() || buildAttemptId;
    signalRun = signalRun || await getCurrentSignalRun(user._id, buildAttemptId);

    if (!fileLooksReady(pdf)) {
      const errorCode = 'DAILY_SIGNAL_PDF_NOT_READY';

      await DailySignalDeliveryRun.markFailed(user._id, dateKey, {
        rootId: root?._id || null,
        signalRunId: signalRun?.signalRunId || null,
        buildAttemptId: buildAttemptId || null,
        snapshotId: root?.aiContext?.snapshotId || root?.latestSnapshotId || null,
        sourceFingerprint: root?.aiContext?.sourceFingerprint || null,
        connectionFingerprint: root?.aiContext?.connectionFingerprint || null,
        email: { to: recipientEmail, provider: 'resend' },
        pdf: getPdfArtifactFromRoot(root),
        attemptedAt,
        error: errorCode,
        errorCode,
        meta: buildRunMeta({
          pdfStatus: pdf?.status || null,
          pdfStage: pdf?.stage || null,
        }),
      });

      await markUserDeliveryStatus(user._id, {
        status: 'failed',
        lastAttemptAt: attemptedAt,
        lastErrorAt: new Date(),
        lastError: errorCode,
      });

      return buildPublicResult(false, {
        code: errorCode,
        message: 'PDF not ready after build',
        userId: String(user._id),
        dateKey,
      });
    }

    await DailySignalDeliveryRun.markStatus(user._id, dateKey, {
      status: 'sending_email',
      rootId: root?._id || null,
      signalRunId: signalRun?.signalRunId || null,
      buildAttemptId: buildAttemptId || null,
      snapshotId: root?.aiContext?.snapshotId || root?.latestSnapshotId || null,
      sourceFingerprint: root?.aiContext?.sourceFingerprint || null,
      connectionFingerprint: root?.aiContext?.connectionFingerprint || null,
      email: { to: recipientEmail, provider: 'resend' },
      pdf: getPdfArtifactFromRoot(root),
      attemptedAt,
    });

    await markUserDeliveryStatus(user._id, {
      status: 'sending',
      lastAttemptAt: attemptedAt,
    });

    const mail = await sendDailySignalEmail({
      user,
      pdf,
      signalPayload,
      root,
      toEmail: recipientEmail,
      reportDate: now,
      appUrl: process.env.APP_URL || 'https://adray.ai',
      headers: {
        'X-Adray-Delivery-DateKey': dateKey,
        'X-Adray-Delivery-Trigger': trigger,
        'X-Adray-Build-Attempt-Id': buildAttemptId || '',
      },
    });

    if (!mail?.ok) {
      const errorCode = safeStr(mail?.code).trim() || 'DAILY_SIGNAL_EMAIL_SEND_FAILED';
      const errorMessage = safeStr(mail?.message).trim() || errorCode;

      await DailySignalDeliveryRun.markFailed(user._id, dateKey, {
        rootId: root?._id || null,
        signalRunId: signalRun?.signalRunId || null,
        buildAttemptId: buildAttemptId || null,
        snapshotId: root?.aiContext?.snapshotId || root?.latestSnapshotId || null,
        sourceFingerprint: root?.aiContext?.sourceFingerprint || null,
        connectionFingerprint: root?.aiContext?.connectionFingerprint || null,
        email: {
          to: recipientEmail,
          provider: 'resend',
          subject: mail?.subject || null,
          from: mail?.from || null,
        },
        pdf: getPdfArtifactFromRoot(root),
        attemptedAt,
        error: errorMessage,
        errorCode,
        meta: buildRunMeta({
          provider: 'resend',
          mailError: mail?.error || null,
        }),
      });

      await markUserDeliveryStatus(user._id, {
        status: 'failed',
        lastAttemptAt: attemptedAt,
        lastErrorAt: new Date(),
        lastError: errorMessage,
      });

      return buildPublicResult(false, {
        code: errorCode,
        message: errorMessage,
        userId: String(user._id),
        dateKey,
      });
    }

    const sentAt = new Date();

    await DailySignalDeliveryRun.markSent(user._id, dateKey, {
      rootId: root?._id || null,
      signalRunId: signalRun?.signalRunId || null,
      buildAttemptId: buildAttemptId || null,
      snapshotId: root?.aiContext?.snapshotId || root?.latestSnapshotId || null,
      sourceFingerprint: root?.aiContext?.sourceFingerprint || null,
      connectionFingerprint: root?.aiContext?.connectionFingerprint || null,
      email: {
        to: recipientEmail,
        provider: 'resend',
        messageId: mail?.messageId || null,
        from: mail?.from || null,
        subject: mail?.subject || null,
      },
      pdf: getPdfArtifactFromRoot(root),
      attemptedAt,
      sentAt,
      meta: buildRunMeta({
        provider: 'resend',
      }),
    });

    await markUserDeliveryStatus(user._id, {
      status: 'sent',
      lastAttemptAt: attemptedAt,
      lastSentAt: sentAt,
      lastErrorAt: null,
      lastError: null,
    });

    return buildPublicResult(true, {
      sent: true,
      userId: String(user._id),
      dateKey,
      rootId: root?._id ? String(root._id) : null,
      signalRunId: signalRun?.signalRunId || null,
      buildAttemptId: buildAttemptId || null,
      snapshotId: root?.aiContext?.snapshotId || root?.latestSnapshotId || null,
      recipientEmail,
      messageId: mail?.messageId || null,
      pdf: {
        fileName: root?.aiContext?.pdf?.fileName || null,
        localPath: root?.aiContext?.pdf?.localPath || null,
        sizeBytes: toNum(root?.aiContext?.pdf?.sizeBytes, 0),
      },
    });
  } catch (err) {
    const failAt = new Date();
    const errorCode = safeStr(err?.code).trim() || 'DAILY_SIGNAL_DELIVERY_FAILED';
    const errorMessage = safeStr(err?.message).trim() || errorCode;

    try {
      const freshRoot = root || await findRoot(user?._id);
      const pdf = getPdfArtifactFromRoot(freshRoot);

      signalRun = signalRun || await getCurrentSignalRun(user?._id, buildAttemptId);

      await DailySignalDeliveryRun.markFailed(user._id, dateKey, {
        rootId: freshRoot?._id || null,
        signalRunId: signalRun?.signalRunId || null,
        buildAttemptId: buildAttemptId || freshRoot?.aiContext?.buildAttemptId || null,
        snapshotId: freshRoot?.aiContext?.snapshotId || freshRoot?.latestSnapshotId || null,
        sourceFingerprint: freshRoot?.aiContext?.sourceFingerprint || null,
        connectionFingerprint: freshRoot?.aiContext?.connectionFingerprint || null,
        email: {
          to: recipientEmail,
          provider: 'resend',
        },
        pdf,
        attemptedAt,
        failedAt: failAt,
        error: errorMessage,
        errorCode,
        meta: buildRunMeta({
          stack: safeStr(err?.stack).trim() || null,
        }),
      });
    } catch (innerErr) {
      console.error('[dailySignalDeliveryService] markFailed secondary error:', innerErr?.message || innerErr);
    }

    await markUserDeliveryStatus(user._id, {
      status: 'failed',
      lastAttemptAt: attemptedAt,
      lastErrorAt: failAt,
      lastError: errorMessage,
    });

    return buildPublicResult(false, {
      code: errorCode,
      message: errorMessage,
      userId: String(user._id),
      dateKey,
    });
  }
}

/* =========================
 * Batch runner
 * ========================= */
async function runDailySignalDeliveryBatch(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const trigger = safeStr(options.trigger).trim() || 'cron';
  const reason = safeStr(options.reason).trim() || 'daily_signal_delivery_batch';

  const users = await User.find({
    'dailySignalDelivery.enabled': true,
  })
    .select([
      '_id',
      'name',
      'email',
      'dailySignalDelivery',
    ].join(' '))
    .lean();

  const results = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const result = await runDailySignalDeliveryForUser(user._id, {
      ...options,
      now,
      trigger,
      reason,
      respectSchedule: 'respectSchedule' in options ? !!options.respectSchedule : true,
    });

    results.push(result);

    if (result?.sent) sent += 1;
    else if (result?.skipped) skipped += 1;
    else failed += 1;
  }

  return {
    ok: true,
    trigger,
    reason,
    processed: users.length,
    sent,
    skipped,
    failed,
    results,
  };
}

/* =========================
 * Status helpers
 * ========================= */
async function getDailySignalDeliveryStatusForUser(userId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const user = await getDailyDeliveryUser(userId);
  if (!user) {
    return {
      ok: false,
      code: 'USER_NOT_FOUND',
    };
  }

  const timezone = normTimezone(user?.dailySignalDelivery?.timezone);
  const dateKey = buildDateKeyForTimezone(now, timezone);
  const todayRun = dateKey
    ? await DailySignalDeliveryRun.findByUserAndDateKey(user._id, dateKey)
    : null;

  return {
    ok: true,
    data: {
      enabled: !!user?.dailySignalDelivery?.enabled,
      email: resolveRecipientEmail(user),
      timezone,
      sendHour: toNum(user?.dailySignalDelivery?.sendHour, 5),
      sendMinute: toNum(user?.dailySignalDelivery?.sendMinute, 0),
      status: safeStr(user?.dailySignalDelivery?.status).trim() || 'idle',
      optedInAt: user?.dailySignalDelivery?.optedInAt || null,
      optedOutAt: user?.dailySignalDelivery?.optedOutAt || null,
      lastAttemptAt: user?.dailySignalDelivery?.lastAttemptAt || null,
      lastSentAt: user?.dailySignalDelivery?.lastSentAt || null,
      lastErrorAt: user?.dailySignalDelivery?.lastErrorAt || null,
      lastError: user?.dailySignalDelivery?.lastError || null,
      todayDateKey: dateKey,
      todayRun: todayRun || null,
    },
  };
}

module.exports = {
  buildDateKeyForTimezone,
  isWithinScheduleWindow,
  evaluateUserEligibility,
  runDailySignalDeliveryForUser,
  runDailySignalDeliveryBatch,
  getDailySignalDeliveryStatusForUser,
};