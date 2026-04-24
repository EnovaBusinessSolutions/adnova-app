#!/usr/bin/env node
'use strict';

/**
 * One-shot migration: drop the legacy TTL index on
 * oauth_tokens.accessTokenExpiresAt so Mongoose can create the new TTL index
 * on oauth_tokens.refreshTokenExpiresAt at the next backend boot.
 *
 * Why: the old index deleted the whole token document 1h after creation
 * (access-token lifetime), which also wiped the refresh token and forced
 * MCP connector users (Claude.ai, ChatGPT, etc.) to re-authorize every hour.
 *
 * Idempotent: if the old index is already gone, it exits cleanly. Safe to run
 * before or after the backend redeploy — tokens are not modified, only the
 * index is dropped.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://.../adnova_staging" node backend/scripts/drop-oauth-token-access-ttl-index.js
 *   MONGO_URI="mongodb+srv://.../adnova"         node backend/scripts/drop-oauth-token-access-ttl-index.js
 *
 * Pass --dry-run to list indexes without dropping anything.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');

const LEGACY_INDEX_NAME = 'accessTokenExpiresAt_1';
const LEGACY_INDEX_KEY = { accessTokenExpiresAt: 1 };
const COLLECTION = 'oauth_tokens';

const DRY_RUN = process.argv.includes('--dry-run');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('ERROR: set MONGO_URI (or MONGODB_URI) to the database to migrate.');
  process.exit(1);
}

function maskUri(uri) {
  return uri.replace(/\/\/[^@]+@/, '//<credentials>@');
}

function indexMatchesLegacyKey(idx) {
  if (!idx || !idx.key) return false;
  const keys = Object.keys(idx.key);
  if (keys.length !== 1) return false;
  return keys[0] === 'accessTokenExpiresAt' && idx.key.accessTokenExpiresAt === 1;
}

(async () => {
  console.log(`[drop-ttl-index] connecting to ${maskUri(MONGO_URI)}${DRY_RUN ? ' (dry run)' : ''}`);
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections({ name: COLLECTION }).toArray();
    if (!collections.length) {
      console.log(`[drop-ttl-index] collection "${COLLECTION}" does not exist — nothing to do.`);
      return;
    }

    const coll = db.collection(COLLECTION);
    const indexes = await coll.indexes();

    console.log('[drop-ttl-index] current indexes:');
    for (const idx of indexes) {
      const ttl = typeof idx.expireAfterSeconds === 'number' ? ` TTL=${idx.expireAfterSeconds}s` : '';
      console.log(`  - ${idx.name}  key=${JSON.stringify(idx.key)}${ttl}`);
    }

    const legacyByName = indexes.find((i) => i.name === LEGACY_INDEX_NAME);
    const legacyByKey = indexes.find(indexMatchesLegacyKey);
    const target = legacyByName || legacyByKey;

    if (!target) {
      console.log('[drop-ttl-index] legacy index not present — nothing to do.');
      return;
    }

    const hasTtl = typeof target.expireAfterSeconds === 'number';
    console.log(
      `[drop-ttl-index] found legacy index "${target.name}" (TTL=${hasTtl ? target.expireAfterSeconds + 's' : 'none'})`
    );

    if (DRY_RUN) {
      console.log('[drop-ttl-index] --dry-run set, skipping drop.');
      return;
    }

    await coll.dropIndex(target.name);
    console.log(`[drop-ttl-index] dropped "${target.name}". Mongoose will create the refreshTokenExpiresAt TTL index on next boot.`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('[drop-ttl-index] failed:', err);
  process.exitCode = 1;
});
