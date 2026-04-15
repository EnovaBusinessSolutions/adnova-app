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
    // Do not exit(1) — allow startup chain to continue to prisma:push
  } finally {
    await prisma.$disconnect();
  }
}

run();
