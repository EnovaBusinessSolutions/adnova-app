/**
 * migrate-recordings-schema.js
 * Idempotent migration for the BRI (Behavioral Revenue Intelligence) schema.
 * - Adds rrweb_recording_id to sessions table
 * - Creates session_recordings, abandonment_risk_scores, abandonment_cohorts tables
 * Safe to run multiple times (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  try {
    // 1. Add sessions columns (clarity + rrweb) — idempotent fallback in case migrate-clarity-columns.js failed
    await prisma.$executeRawUnsafe(`
      ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS clarity_session_id    TEXT,
        ADD COLUMN IF NOT EXISTS clarity_playback_url  TEXT,
        ADD COLUMN IF NOT EXISTS rrweb_recording_id    TEXT;
    `);

    // 2. Create recording status and outcome enums (if not exist)
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingStatus') THEN
          CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'FINALIZING', 'READY', 'ERROR');
        END IF;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingOutcome') THEN
          CREATE TYPE "RecordingOutcome" AS ENUM ('PURCHASED', 'ABANDONED', 'STILL_BROWSING');
        END IF;
      END $$;
    `);

    // 3. Create session_recordings table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS session_recordings (
        id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        recording_id        TEXT UNIQUE NOT NULL,
        account_id          TEXT NOT NULL,
        session_id          TEXT NOT NULL,
        user_key            TEXT NOT NULL,
        trigger_event       TEXT NOT NULL DEFAULT 'add_to_cart',
        trigger_at          TIMESTAMPTZ NOT NULL,
        cart_value          DOUBLE PRECISION,
        checkout_token      TEXT,
        attribution_snapshot JSONB,
        r2_key              TEXT,
        r2_chunks_prefix    TEXT,
        r2_bucket           TEXT,
        duration_ms         INTEGER,
        chunk_count         INTEGER NOT NULL DEFAULT 0,
        size_bytes          BIGINT,
        status              TEXT NOT NULL DEFAULT 'RECORDING',
        outcome             TEXT,
        outcome_at          TIMESTAMPTZ,
        order_id            TEXT,
        behavioral_signals  JSONB,
        raw_erased_at       TIMESTAMPTZ,
        masking_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_recordings_account_session
        ON session_recordings(account_id, session_id);
      CREATE INDEX IF NOT EXISTS idx_recordings_account_status
        ON session_recordings(account_id, status);
      CREATE INDEX IF NOT EXISTS idx_recordings_account_outcome
        ON session_recordings(account_id, outcome);
      CREATE INDEX IF NOT EXISTS idx_recordings_account_userkey
        ON session_recordings(account_id, user_key);
    `);

    // 4. Create abandonment_risk_scores table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS abandonment_risk_scores (
        id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        session_id     TEXT UNIQUE NOT NULL,
        account_id     TEXT NOT NULL,
        user_key       TEXT NOT NULL,
        risk_score     INTEGER NOT NULL,
        risk_factors   JSONB NOT NULL,
        cart_value     DOUBLE PRECISION,
        checkout_token TEXT,
        computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at     TIMESTAMPTZ NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_risk_scores_account_score
        ON abandonment_risk_scores(account_id, risk_score);
    `);

    // 5. Create abandonment_cohorts table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS abandonment_cohorts (
        id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        cohort_key           TEXT NOT NULL,
        account_id           TEXT NOT NULL,
        label                TEXT NOT NULL,
        session_count        INTEGER NOT NULL DEFAULT 0,
        avg_cart_value       DOUBLE PRECISION,
        common_signals       JSONB NOT NULL,
        sample_recording_ids JSONB NOT NULL,
        computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        date_range           JSONB NOT NULL,
        UNIQUE(account_id, cohort_key),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_cohorts_account_computed
        ON abandonment_cohorts(account_id, computed_at);
    `);

    console.log('[migrate-recordings-schema] OK — BRI schema ensured.');
  } catch (err) {
    console.error('[migrate-recordings-schema] ERROR:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
