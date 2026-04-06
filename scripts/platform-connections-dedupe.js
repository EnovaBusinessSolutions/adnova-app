#!/usr/bin/env node
/*
  Diagnose and optionally deduplicate duplicate rows in platform_connections
  before enforcing unique(account_id, platform).

  Usage:
    node scripts/platform-connections-dedupe.js --check
    node scripts/platform-connections-dedupe.js --apply
*/

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function backupTableName() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `platform_connections_backup_${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

async function tableExists() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'platform_connections'
    ) AS exists;
  `);
  return Boolean(rows?.[0]?.exists);
}

async function listDuplicates() {
  return prisma.$queryRawUnsafe(`
    SELECT
      account_id,
      platform,
      COUNT(*)::int AS duplicate_count,
      ARRAY_AGG(id ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC, id DESC) AS ids
    FROM platform_connections
    GROUP BY account_id, platform
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, account_id ASC, platform ASC;
  `);
}

async function dedupe() {
  const deleteResult = await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY account_id, platform
          ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC, id DESC
        ) AS rn
      FROM platform_connections
    )
    DELETE FROM platform_connections pc
    USING ranked r
    WHERE pc.id = r.id
      AND r.rn > 1;
  `);
  return Number(deleteResult || 0);
}

async function run() {
  const apply = hasFlag("--apply");
  const check = hasFlag("--check") || !apply;

  if (!(await tableExists())) {
    console.error("Table public.platform_connections was not found.");
    console.error("Verify DATABASE_URL points to the expected Postgres database.");
    process.exitCode = 1;
    return;
  }

  const duplicatesBefore = await listDuplicates();

  if (!duplicatesBefore.length) {
    console.log("No duplicates found for (account_id, platform). Safe to run prisma push.");
    return;
  }

  console.log("Duplicate groups found:", duplicatesBefore.length);
  for (const row of duplicatesBefore) {
    console.log(`- account_id=${row.account_id} platform=${row.platform} duplicates=${row.duplicate_count} ids=${row.ids.join(",")}`);
  }

  if (check) {
    console.log("\nCheck-only mode. No data was modified.");
    console.log("Run with --apply to backup + dedupe.");
    return;
  }

  const backup = backupTableName();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TABLE ${backup} AS TABLE platform_connections;`);
    await tx.$executeRawUnsafe(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY account_id, platform
            ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC, id DESC
          ) AS rn
        FROM platform_connections
      )
      DELETE FROM platform_connections pc
      USING ranked r
      WHERE pc.id = r.id
        AND r.rn > 1;
    `);
  });

  const duplicatesAfter = await listDuplicates();

  console.log(`\nBackup created: public.${backup}`);
  if (duplicatesAfter.length === 0) {
    console.log("Dedup completed. No duplicate groups remain.");
    console.log("Next step: npm run prisma:push -- --accept-data-loss");
  } else {
    console.log("Dedup attempted, but duplicate groups still remain:", duplicatesAfter.length);
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error("Script failed:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
