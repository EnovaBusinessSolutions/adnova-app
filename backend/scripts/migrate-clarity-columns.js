/**
 * migrate-clarity-columns.js
 * Adds clarity_session_id and clarity_playback_url to the sessions table
 * if they don't exist. Safe to run multiple times (idempotent).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS clarity_session_id  TEXT,
        ADD COLUMN IF NOT EXISTS clarity_playback_url TEXT;
    `);
    console.log('[migrate-clarity-columns] OK — columns ensured.');
  } catch (err) {
    console.error('[migrate-clarity-columns] ERROR (non-fatal):', err.message);
    // Do not exit(1) — allow the startup chain to continue to prisma:push
  } finally {
    await prisma.$disconnect();
  }
}

run();
