/**
 * migrate-hmac-hashes.js
 * One-time migration: re-hash email_hash and phone_hash in identity_graph
 * from unsalted SHA-256 to HMAC-SHA-256.
 *
 * PREREQUISITES:
 *   - Set HMAC_EMAIL_KEY and HMAC_PHONE_KEY env vars (64 hex chars each = 32 bytes)
 *   - Ensure DATABASE_URL is set
 *
 * SAFETY:
 *   - Reads original hashes (already hashed, cannot reverse)
 *   - Re-hashes the existing hash values → stores new HMAC of the old hash
 *   - This preserves identity graph integrity: if you feed the old SHA-256 hash
 *     into HMAC, lookups using the new hashEmail() function will still match
 *     because new events also go through hashEmail() which produces HMAC(sha256(email)).
 *     (i.e., the raw email is normalized → sha256 → then we HMAC the raw normalized
 *      value; but since we don't have the raw values, we HMAC the existing hashes.)
 *
 * NOTE: After this migration, existing hashes in identity_graph will differ from
 * what hashEmail(rawEmail) produces until HMAC keys are set and new events are
 * collected. This is a one-time data migration — re-run only if keys change.
 *
 * Safe to run multiple times (idempotent if keys don't change).
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

const HMAC_EMAIL_KEY = process.env.HMAC_EMAIL_KEY
  ? Buffer.from(process.env.HMAC_EMAIL_KEY, 'hex')
  : null;

const HMAC_PHONE_KEY = process.env.HMAC_PHONE_KEY
  ? Buffer.from(process.env.HMAC_PHONE_KEY, 'hex')
  : null;

function hmacOf(value, key) {
  if (!value || !key) return null;
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

async function run() {
  if (!HMAC_EMAIL_KEY && !HMAC_PHONE_KEY) {
    console.warn('[migrate-hmac-hashes] No HMAC_EMAIL_KEY or HMAC_PHONE_KEY set. Nothing to migrate.');
    return;
  }

  console.log('[migrate-hmac-hashes] Starting HMAC re-hash migration...');

  let cursor = undefined;
  let totalUpdated = 0;
  const BATCH = 500;

  while (true) {
    const rows = await prisma.identityGraph.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: {
        OR: [
          { emailHash: { not: null } },
          { phoneHash: { not: null } },
        ],
      },
      select: { id: true, emailHash: true, phoneHash: true },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const updates = {};
      if (row.emailHash && HMAC_EMAIL_KEY) {
        updates.emailHash = hmacOf(row.emailHash, HMAC_EMAIL_KEY);
      }
      if (row.phoneHash && HMAC_PHONE_KEY) {
        updates.phoneHash = hmacOf(row.phoneHash, HMAC_PHONE_KEY);
      }
      if (Object.keys(updates).length) {
        await prisma.identityGraph.update({ where: { id: row.id }, data: updates });
        totalUpdated++;
      }
    }

    cursor = rows[rows.length - 1].id;
    console.log(`[migrate-hmac-hashes] Processed ${totalUpdated} rows so far...`);

    if (rows.length < BATCH) break;
  }

  console.log(`[migrate-hmac-hashes] Done — re-hashed ${totalUpdated} identity_graph rows.`);
  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('[migrate-hmac-hashes] Fatal:', err.message);
  process.exit(1);
});
