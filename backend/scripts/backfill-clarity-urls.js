/**
 * backfill-clarity-urls.js
 * Reads all stored clarity_session_linked events and writes
 * claritySessionId + clarityPlaybackUrl back to the sessions table.
 * Safe to run multiple times (only updates rows where URL is missing).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  const events = await prisma.event.findMany({
    where: { eventName: 'clarity_session_linked' },
    select: {
      sessionId: true,
      accountId: true,
      rawPayload: true,
    },
  });

  console.log(`[backfill-clarity-urls] Found ${events.length} clarity_session_linked events`);

  let updated = 0;
  let skipped = 0;

  for (const ev of events) {
    const payload = ev.rawPayload || {};
    const clarityPlaybackUrl = String(payload.clarity_playback_url || '').trim() || null;
    const claritySessionId = String(payload.clarity_session_id || '').trim() || null;

    if (!clarityPlaybackUrl || !ev.sessionId) { skipped++; continue; }

    try {
      await prisma.session.updateMany({
        where: {
          sessionId: ev.sessionId,
          accountId: ev.accountId,
          clarityPlaybackUrl: null,   // only fill if not already set
        },
        data: {
          ...(clarityPlaybackUrl ? { clarityPlaybackUrl } : {}),
          ...(claritySessionId  ? { claritySessionId  } : {}),
        },
      });
      updated++;
    } catch (err) {
      console.error(`[backfill-clarity-urls] Error on session ${ev.sessionId}:`, err.message);
    }
  }

  console.log(`[backfill-clarity-urls] Done — updated: ${updated}, skipped: ${skipped}`);
  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('[backfill-clarity-urls] Fatal:', err.message);
  process.exit(1);
});
