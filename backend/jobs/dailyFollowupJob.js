// backend/jobs/dailyFollowupJob.js
'use strict';

const cron = require('node-cron');
const mongoose = require('mongoose');
const User = require('../models/User');
const { sendDailyFollowupCallEmail } = require('../services/emailService');

const DEBUG = process.env.DEBUG_FOLLOWUP === 'true';

const TZ = process.env.FOLLOWUP_CRON_TZ || 'America/Mexico_City';
const CRON_EXPR = process.env.FOLLOWUP_CRON || '0 8 * * *';
const BATCH_SIZE = Number(process.env.FOLLOWUP_BATCH_SIZE || 1500);
const MIN_MS_BETWEEN_EMAILS = Number(process.env.FOLLOWUP_THROTTLE_MS || 60);

/**
 * Guardaremos metadata en cada user:
 * user.followup = { lastSentAt: Date, unsubscribed: boolean }
 */

let JobLock;
try {
  JobLock = require('../models/JobLock');
} catch {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      key: { type: String, unique: true, index: true },
      acquiredAt: Date,
      expiresAt: Date,
    },
    { collection: 'joblocks' }
  );
  JobLock = mongoose.models.JobLock || model('JobLock', schema);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startOfToday(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `daily_followup:${yyyy}-${mm}-${dd}`;
}

async function acquireDailyLock() {
  const key = dayKey();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2h

  try {
    const doc = await JobLock.findOneAndUpdate(
      {
        key,
        $or: [{ expiresAt: { $lt: now } }, { expiresAt: { $exists: false } }, { expiresAt: null }],
      },
      { $set: { acquiredAt: now, expiresAt } },
      { upsert: true, new: true }
    ).lean();

    return !!doc;
  } catch (e) {
    if (DEBUG) console.log('[followup] lock not acquired:', e?.message || e);
    return false;
  }
}

async function runFollowupOnce() {
  if (process.env.FOLLOWUP_ENABLED !== 'true') {
    if (DEBUG) console.log('[followup] FOLLOWUP_ENABLED != true, skipping.');
    return;
  }

  const locked = await acquireDailyLock();
  if (!locked) {
    if (DEBUG) console.log('[followup] Another instance already ran today, skipping.');
    return;
  }

  const today0 = startOfToday(new Date());

  // ✅ TODOS LOS USUARIOS
  // Filtros recomendados:
  // - email válido
  // - opcional: verifiedEmail true (si existe)
  // - no unsubscribed
  // - no enviado hoy
  const query = {
    email: { $exists: true, $type: 'string', $ne: '' },
    $or: [
      { 'followup.unsubscribed': { $exists: false } },
      { 'followup.unsubscribed': false },
    ],
    $or: [
      { 'followup.lastSentAt': { $exists: false } },
      { 'followup.lastSentAt': null },
      { 'followup.lastSentAt': { $lt: today0 } },
    ],
  };

  // Si tienes campo "verifiedEmail" o "we"/"verified", puedes activar esto:
  // query.verifiedEmail = true;

  const users = await User.find(query)
    .select('email name fullName firstName nombre businessName companyName followup')
    .limit(BATCH_SIZE)
    .lean();

  if (DEBUG) console.log('[followup] candidates:', users.length);

  let sent = 0;
  let failed = 0;

  for (const u of users) {
    const to = String(u?.email || '').trim().toLowerCase();
    if (!to || !to.includes('@')) continue;

    // ✅ dedupe por usuario (atomic)
    const updated = await User.updateOne(
      {
        _id: u._id,
        $or: [
          { 'followup.lastSentAt': { $exists: false } },
          { 'followup.lastSentAt': null },
          { 'followup.lastSentAt': { $lt: today0 } },
        ],
      },
      { $set: { 'followup.lastSentAt': new Date() } },
      { strict: false }
    );

    if (!updated?.modifiedCount) continue;

    const name =
      u.name || u.fullName || u.firstName || u.nombre || u.businessName || u.companyName || '';

    try {
      await sendDailyFollowupCallEmail({ toEmail: to, name });
      sent++;
    } catch (e) {
      failed++;
      if (DEBUG) console.error('[followup] send error:', to, e?.message || e);
    }

    if (MIN_MS_BETWEEN_EMAILS > 0) await sleep(MIN_MS_BETWEEN_EMAILS);
  }

  if (DEBUG) console.log('[followup] done:', { sent, failed });
}

function initDailyFollowup() {
  if (process.env.NODE_ENV === 'test') return;

  cron.schedule(CRON_EXPR, () => {
    runFollowupOnce().catch((e) => console.error('[followup] job error:', e));
  }, { timezone: TZ });

  if (DEBUG) console.log('[followup] scheduled:', { CRON_EXPR, TZ });
}

module.exports = { initDailyFollowup, runFollowupOnce };
