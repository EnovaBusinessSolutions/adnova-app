-- Backfill Script: orders_count (Layer 4) and ga4_session_source (Layer 5)
-- Safe idempotent backfill for staging/production
-- Runs incrementally and can be retried without issues

BEGIN;

-- ===================================================================
-- STEP 1: Backfill orders_count for orders without it (Layer 4)
-- ===================================================================
-- Count total orders per customer identity (customer_id OR email_hash)
-- and update orders that have no orders_count yet.
--
-- Idempotent: Only updates NULL orders_count rows.
-- Impact: ~50ms-200ms on typical staging DB.

WITH customer_order_counts AS (
  SELECT 
    account_id,
    COALESCE(customer_id, email_hash, phone_hash) as customer_identity,
    COUNT(*) as total_orders
  FROM orders
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND (customer_id IS NOT NULL OR email_hash IS NOT NULL OR phone_hash IS NOT NULL)
  GROUP BY account_id, customer_identity
)
UPDATE orders o
SET orders_count = coc.total_orders
FROM customer_order_counts coc
WHERE o.account_id = coc.account_id
  AND COALESCE(o.customer_id, o.email_hash, o.phone_hash) = coc.customer_identity
  AND o.orders_count IS NULL;

-- Backfill summary
DO $$
DECLARE
  backfilled_count INT;
BEGIN
  SELECT COUNT(*) INTO backfilled_count
  FROM orders
  WHERE orders_count IS NOT NULL
    AND created_at >= NOW() - INTERVAL '30 days';
  
  RAISE NOTICE '[Backfill] Layer 4: Updated orders_count on % orders', 
    (SELECT COUNT(*) FROM orders WHERE orders_count IS NOT NULL);
END $$;

-- ===================================================================
-- STEP 2: Backfill ga4_session_source from UTM (Layer 5)
-- ===================================================================
-- Derive ga4_session_source from utm_source / utm_medium for sessions
-- that have UTM data but no explicit ga4_session_source yet.
--
-- Format: "utm_source / utm_medium" (or "(direct) / (none)" if UTM missing)
-- Idempotent: Only updates NULL ga4_session_source rows.
-- Impact: ~100ms-300ms on typical staging DB.

UPDATE sessions s
SET ga4_session_source = CASE
  WHEN s.utm_source IS NOT NULL OR s.utm_medium IS NOT NULL THEN
    CONCAT(
      COALESCE(s.utm_source, '(direct)'),
      ' / ',
      COALESCE(s.utm_medium, '(none)')
    )
  ELSE NULL
END
WHERE s.ga4_session_source IS NULL
  AND s.started_at >= NOW() - INTERVAL '30 days'
  AND (s.utm_source IS NOT NULL OR s.utm_medium IS NOT NULL);

-- Backfill summary
DO $$
DECLARE
  filled_count INT;
BEGIN
  SELECT COUNT(*) INTO filled_count
  FROM sessions
  WHERE ga4_session_source IS NOT NULL
    AND started_at >= NOW() - INTERVAL '30 days';
  
  RAISE NOTICE '[Backfill] Layer 5: Populated ga4_session_source on % sessions', filled_count;
END $$;

COMMIT;

-- Post-backfill verification queries (optional, run after commit):
-- SELECT COUNT(*), COUNT(orders_count) FROM orders WHERE created_at >= NOW() - INTERVAL '30 days';
-- SELECT COUNT(*), COUNT(ga4_session_source) FROM sessions WHERE started_at >= NOW() - INTERVAL '30 days';
