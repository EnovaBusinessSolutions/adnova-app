/**
 * migrate-recordings-schema.js
 * Adds BRI columns to the existing sessions table.
 * New tables (session_recordings, abandonment_risk_scores, abandonment_cohorts)
 * are created by `prisma db push` — do NOT create them here to avoid type conflicts.
 * Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  try {
    // Add sessions columns (clarity + rrweb) — fallback in case migrate-clarity-columns.js failed
    await prisma.$executeRawUnsafe(`
      ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS clarity_session_id    TEXT,
        ADD COLUMN IF NOT EXISTS clarity_playback_url  TEXT,
        ADD COLUMN IF NOT EXISTS rrweb_recording_id    TEXT;
    `);
    console.log('[migrate-recordings-schema] OK — sessions columns ensured.');
  } catch (err) {
    console.error('[migrate-recordings-schema] ERROR (non-fatal):', err.message);
  }

  // session_recordings.device_type — belt-and-suspenders. Normally added by
  // `prisma db push`, but if that step fails or lags we still want /init to
  // work. Harmless if the table doesn't exist yet (wrapped in its own catch).
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE session_recordings
        ADD COLUMN IF NOT EXISTS device_type TEXT;
    `);
    console.log('[migrate-recordings-schema] OK — session_recordings.device_type ensured.');
  } catch (err) {
    if (String(err.message).includes('session_recordings" does not exist')) {
      console.log('[migrate-recordings-schema] session_recordings table not yet created — skipping device_type ALTER');
    } else {
      console.error('[migrate-recordings-schema] device_type ALTER ERROR (non-fatal):', err.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

run();
