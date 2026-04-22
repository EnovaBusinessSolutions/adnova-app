#!/usr/bin/env node
'use strict';

/**
 * Dumps the OAuth/MCP state from whichever MongoDB MONGO_URI points to.
 * Read-only — no writes, no modifications.
 *
 * Purpose: compare prod vs staging OAuth data to isolate what makes Claude.ai
 * reject the prod connector while accepting the staging one.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://.../adnova"         node backend/scripts/audit-oauth-state.js > prod.txt
 *   MONGO_URI="mongodb+srv://.../adnova_staging" node backend/scripts/audit-oauth-state.js > staging.txt
 *   diff prod.txt staging.txt
 *
 * Or just run twice and paste both outputs side by side.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('ERROR: set MONGO_URI (or MONGODB_URI) to the database to audit.');
  process.exit(1);
}

function maskUri(uri) {
  return uri.replace(/\/\/[^@]+@/, '//<credentials>@');
}

function truncate(s, n = 40) {
  if (s == null) return String(s);
  const str = String(s);
  return str.length <= n ? str : str.slice(0, n) + '…';
}

function fmtDate(d) {
  if (!d) return 'null';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString();
}

async function main() {
  console.log('='.repeat(70));
  console.log('OAuth state audit');
  console.log('DB URI:', maskUri(MONGO_URI));
  console.log('Run at:', new Date().toISOString());
  console.log('='.repeat(70));

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  console.log('Connected to database:', db.databaseName);
  console.log('');

  // ---------- oauth_clients ----------
  console.log('--- oauth_clients ---');
  const clientsCol = db.collection('oauth_clients');
  const clientsCount = await clientsCol.countDocuments();
  const clientsActive = await clientsCol.countDocuments({ active: true });
  const clientsInactive = await clientsCol.countDocuments({ active: { $ne: true } });
  console.log(`total: ${clientsCount}  active: ${clientsActive}  inactive: ${clientsInactive}`);

  const clients = await clientsCol
    .find({}, {
      projection: {
        clientId: 1,
        name: 1,
        active: 1,
        redirectUris: 1,
        redirectUriPatterns: 1,
        scopes: 1,
        grantsAllowed: 1,
        createdAt: 1,
        updatedAt: 1,
        // intentionally NOT projecting clientSecret
      },
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  for (const c of clients) {
    console.log('');
    console.log(`clientId:            ${c.clientId}`);
    console.log(`  name:              ${truncate(c.name, 60)}`);
    console.log(`  active:            ${c.active}`);
    console.log(`  redirectUris:      ${JSON.stringify(c.redirectUris || [])}`);
    console.log(`  redirectUriPats:   ${JSON.stringify(c.redirectUriPatterns || [])}`);
    console.log(`  scopes:            ${JSON.stringify(c.scopes || [])}`);
    console.log(`  grantsAllowed:     ${JSON.stringify(c.grantsAllowed || [])}`);
    console.log(`  createdAt:         ${fmtDate(c.createdAt)}`);
    console.log(`  updatedAt:         ${fmtDate(c.updatedAt)}`);
  }
  if (clients.length < clientsCount) {
    console.log(`\n(showing ${clients.length} of ${clientsCount})`);
  }

  // Breakdown by prefix — Claude uses dcr_*, seeded Custom GPT uses specific IDs.
  const prefixAgg = await clientsCol
    .aggregate([
      {
        $project: {
          prefix: {
            $cond: [
              { $regexMatch: { input: '$clientId', regex: /^dcr_/ } },
              'dcr_',
              { $substrCP: ['$clientId', 0, 12] },
            ],
          },
          active: 1,
        },
      },
      {
        $group: {
          _id: '$prefix',
          count: { $sum: 1 },
          activeCount: { $sum: { $cond: ['$active', 1, 0] } },
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray();
  console.log('\nclient_id prefix breakdown:');
  for (const p of prefixAgg) {
    console.log(`  ${p._id.padEnd(14)}  total=${p.count}  active=${p.activeCount}`);
  }

  // ---------- oauth_tokens ----------
  console.log('\n--- oauth_tokens ---');
  const tokensCol = db.collection('oauth_tokens');
  const tokensTotal = await tokensCol.countDocuments();
  const tokensActive = await tokensCol.countDocuments({
    accessTokenExpiresAt: { $gt: new Date() },
    revoked: { $ne: true },
  });
  const tokensRevoked = await tokensCol.countDocuments({ revoked: true });
  console.log(`total: ${tokensTotal}  currently valid: ${tokensActive}  revoked: ${tokensRevoked}`);

  const tokensByClient = await tokensCol
    .aggregate([
      {
        $group: {
          _id: '$clientId',
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$accessTokenExpiresAt', new Date()] },
                    { $ne: ['$revoked', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          mostRecent: { $max: '$createdAt' },
        },
      },
      { $sort: { mostRecent: -1 } },
      { $limit: 20 },
    ])
    .toArray();
  console.log('\ntoken count by clientId (top 20 by recency):');
  for (const t of tokensByClient) {
    console.log(
      `  ${String(t._id).padEnd(40)}  total=${t.total}  active=${t.active}  last=${fmtDate(t.mostRecent)}`
    );
  }

  // Show shape of most recent token doc (fields only, no secret values).
  const latest = await tokensCol.findOne({}, { sort: { createdAt: -1 } });
  if (latest) {
    const fieldList = Object.keys(latest).sort();
    console.log('\nmost recent token doc has fields:', fieldList.join(', '));
    console.log('  scopes:        ', JSON.stringify(latest.scopes || []));
    console.log('  clientId:      ', latest.clientId);
    console.log('  revoked:       ', latest.revoked);
    console.log('  createdAt:     ', fmtDate(latest.createdAt));
    console.log('  expiresAt:     ', fmtDate(latest.accessTokenExpiresAt));
  }

  // ---------- oauth_codes ----------
  console.log('\n--- oauth_codes ---');
  const codesCol = db.collection('oauth_codes');
  const codesTotal = await codesCol.countDocuments();
  const codesUnused = await codesCol.countDocuments({ used: false });
  console.log(`total: ${codesTotal}  unused: ${codesUnused}`);

  // ---------- indexes ----------
  console.log('\n--- indexes ---');
  for (const col of ['oauth_clients', 'oauth_tokens', 'oauth_codes']) {
    const idx = await db.collection(col).indexes();
    console.log(`${col}:`);
    for (const i of idx) {
      console.log(`  ${i.name.padEnd(40)} key=${JSON.stringify(i.key)}${i.unique ? ' UNIQUE' : ''}${i.sparse ? ' SPARSE' : ''}${i.expireAfterSeconds != null ? ` TTL=${i.expireAfterSeconds}s` : ''}`);
    }
  }

  // ---------- users (sanity: does the Claude-owner user exist & look normal) ----------
  console.log('\n--- users (sanity check) ---');
  const usersCol = db.collection('users');
  const usersTotal = await usersCol.countDocuments();
  console.log(`total users: ${usersTotal}`);

  // Cross-check: for each active client, is at least one valid token pointing to a real user?
  const activeClientIds = clients.filter((c) => c.active).map((c) => c.clientId);
  for (const cid of activeClientIds.slice(0, 5)) {
    const tok = await tokensCol.findOne(
      {
        clientId: cid,
        revoked: { $ne: true },
        accessTokenExpiresAt: { $gt: new Date() },
      },
      { sort: { createdAt: -1 } }
    );
    if (!tok) {
      console.log(`  clientId=${cid} → no valid token`);
      continue;
    }
    const user = tok.userId ? await usersCol.findOne({ _id: tok.userId }, { projection: { email: 1 } }) : null;
    console.log(`  clientId=${cid} → token.userId=${tok.userId}  userExists=${!!user}  email=${user?.email ? truncate(user.email, 30) : 'n/a'}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Audit complete.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
