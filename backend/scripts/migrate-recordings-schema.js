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
  }

  // session_packets (Phase 4) — created by `prisma db push`. This belt ensures
  // the table exists and matches the schema even if prisma push failed. Safe to
  // run multiple times.
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "SessionOutcome" AS ENUM ('PURCHASED', 'ABANDONED', 'BOUNCED', 'STILL_BROWSING');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS session_packets (
        id                TEXT PRIMARY KEY,
        session_id        TEXT UNIQUE NOT NULL,
        account_id        TEXT NOT NULL,
        visitor_id        TEXT,
        person_id         TEXT,
        start_ts          TIMESTAMP(3) NOT NULL,
        end_ts            TIMESTAMP(3) NOT NULL,
        duration_ms       INTEGER NOT NULL,
        device            JSONB,
        traffic_source    JSONB,
        landing_page      TEXT,
        keyframes         JSONB NOT NULL,
        signals           JSONB NOT NULL,
        ecommerce_events  JSONB NOT NULL,
        outcome           "SessionOutcome" NOT NULL DEFAULT 'STILL_BROWSING',
        cart_value_at_end DOUBLE PRECISION,
        order_id          TEXT,
        ai_analysis       JSONB,
        ai_analyzed_at    TIMESTAMP(3),
        raw_erased_at     TIMESTAMP(3),
        created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "session_packets_account_id_person_id_idx"  ON session_packets(account_id, person_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "session_packets_account_id_start_ts_idx"   ON session_packets(account_id, start_ts);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "session_packets_account_id_outcome_idx"    ON session_packets(account_id, outcome);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "session_packets_account_id_order_id_idx"   ON session_packets(account_id, order_id);`);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE session_packets
          ADD CONSTRAINT session_packets_account_id_fkey
          FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    console.log('[migrate-recordings-schema] OK — session_packets table ensured.');
  } catch (err) {
    console.error('[migrate-recordings-schema] session_packets ensure ERROR (non-fatal):', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
