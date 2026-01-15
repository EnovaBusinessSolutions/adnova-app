// backend/jobs/dailyQuickCallJob.js
'use strict';

const User = require('../models/User');

// ✅ OJO: el nombre real del service nuevo
const { sendDailyFollowupCallEmail } = require('../services/emailService');

/**
 * Helpers de fecha (día local del servidor)
 * Si prefieres forzar TZ, pon TZ=America/Mexico_City en Render.
 */
function startOfDayLocal(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return startOfDayLocal(a).getTime() === startOfDayLocal(b).getTime();
}

function dateKeyLocal(d = new Date()) {
  // YYYY-MM-DD (local)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Job:
 * - evita enviar 2 veces el mismo día (por Mongo + por emailService dedupe)
 * - soporta dryRun
 * - guarda last sent en User.dailyQuickCallSentAt
 *
 * Opcionales:
 * - query extra (para filtrar solo ciertos usuarios)
 */
async function runDailyQuickCallJob({
  operatorName = 'César',
  dryRun = false,

  // ✅ opcional: filtrar a quién sí enviar
  onlyVerified = false,
  onlyNotOnboarded = false,

  // ✅ opcional: limitar por batch
  limit = 0,
} = {}) {
  const today = new Date();
  const dayKey = dateKeyLocal(today);

  // Base query: usuarios con email válido
  const query = {
    email: { $type: 'string', $ne: '' },
  };

  // Opcionales “pro” (no rompen si el schema no tiene campos, Mongo solo no los matchea)
  if (onlyVerified) query.emailVerified = true;
  if (onlyNotOnboarded) query.onboardingComplete = { $ne: true };

  let q = User.find(query)
    .select('_id name email dailyQuickCallSentAt emailVerified onboardingComplete')
    .lean();

  if (limit && Number(limit) > 0) q = q.limit(Number(limit));

  const cursor = q.cursor();

  let total = 0;
  let sent = 0;
  let skippedToday = 0;
  let skippedInvalid = 0;
  let skippedServiceDedupe = 0;
  let errors = 0;

  for await (const u of cursor) {
    total += 1;

    const last = u.dailyQuickCallSentAt ? new Date(u.dailyQuickCallSentAt) : null;
    if (last && isSameDay(last, today)) {
      skippedToday += 1;
      continue;
    }

    const to = String(u.email || '').trim().toLowerCase();
    if (!to) {
      skippedInvalid += 1;
      continue;
    }

    try {
      if (dryRun) {
        sent += 1;
        continue;
      }

      const r = await sendDailyFollowupCallEmail({
        toEmail: to,
        name: u.name || '',
        operatorName,

        // ✅ dedupeKey consistente por día
        // (emailService también dedupea por day key)
        dateKey: dayKey,
      });

      // Si el service decidió no mandar por dedupe, no marcamos DB
      if (r?.ok && r?.skipped) {
        skippedServiceDedupe += 1;
        continue;
      }

      if (r?.ok) {
        sent += 1;

        // ✅ marcar en User (no rompe aunque schema no tenga el campo)
        await User.updateOne(
          { _id: u._id },
          { $set: { dailyQuickCallSentAt: new Date() } },
          { strict: false }
        );
      } else {
        errors += 1;
      }
    } catch (e) {
      errors += 1;
      // seguimos con el siguiente usuario
    }
  }

  return {
    ok: true,
    dryRun,
    total,
    sent,
    skippedToday,
    skippedInvalid,
    skippedServiceDedupe,
    errors,
    filters: { onlyVerified, onlyNotOnboarded, limit: Number(limit) || 0 },
    dayKey,
  };
}

module.exports = { runDailyQuickCallJob };
