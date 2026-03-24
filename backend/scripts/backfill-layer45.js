const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function isSchemaDriftError(error) {
  if (!error) return false;
  if (error.code === 'P2022') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('column') && msg.includes('does not exist');
}

async function runBackfill() {
  const startedAt = Date.now();

  const ordersUpdated = await prisma.$executeRawUnsafe(`
WITH c AS (
  SELECT
    account_id,
    COALESCE(customer_id, email_hash, phone_hash) AS k,
    COUNT(*)::int AS n
  FROM orders
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND (customer_id IS NOT NULL OR email_hash IS NOT NULL OR phone_hash IS NOT NULL)
  GROUP BY account_id, COALESCE(customer_id, email_hash, phone_hash)
)
UPDATE orders o
SET orders_count = c.n
FROM c
WHERE o.account_id = c.account_id
  AND COALESCE(o.customer_id, o.email_hash, o.phone_hash) = c.k
  AND o.orders_count IS NULL;
  `);

  const sessionsUpdated = await prisma.$executeRawUnsafe(`
UPDATE sessions s
SET ga4_session_source = CONCAT(
  COALESCE(s.utm_source, '(direct)'),
  ' / ',
  COALESCE(s.utm_medium, '(none)')
)
WHERE s.ga4_session_source IS NULL
  AND s.started_at >= NOW() - INTERVAL '30 days'
  AND (s.utm_source IS NOT NULL OR s.utm_medium IS NOT NULL);
  `);

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[Backfill layer45] done in ${elapsedMs}ms (orders_updated=${ordersUpdated}, sessions_updated=${sessionsUpdated})`
  );
}

(async () => {
  try {
    await runBackfill();
  } catch (error) {
    if (isSchemaDriftError(error)) {
      console.warn('[Backfill layer45] skipped due to schema drift:', error.message || String(error));
      process.exit(0);
    }

    console.error('[Backfill layer45] failed:', error.message || String(error));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
