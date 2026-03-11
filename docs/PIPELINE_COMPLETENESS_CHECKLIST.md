# Pipeline Completeness Checklist

Last update: 2026-03-11

This runbook validates if dashboard data is complete, or still partially powered by fallbacks.

## 1) Success Criteria
Dashboard is considered complete when all are true:
- `POST /collect` returns `2xx` consistently and persists events.
- Purchases arrive to `orders` (Woo + Shopify).
- Attribution fields in `orders` are populated for a meaningful % of orders.
- Snapshot updates in `merchant_snapshots` without critical failures.
- Meta CAPI and Google conversions endpoints are real (not placeholders/stubs).

Current code notes:
- Meta CAPI is still placeholder in [backend/services/capiFanout.js](../backend/services/capiFanout.js#L34).
- Google conversions listing endpoint still has stub behavior in [backend/routes/adrayPlatforms.js](../backend/routes/adrayPlatforms.js#L58).
- Dashboard has revenue fallback to purchase events in [backend/routes/analytics.js](../backend/routes/analytics.js#L517).

## 2) Variables to set once in terminal
Use PowerShell:

```powershell
$BASE_URL   = "https://adray-app-staging-german.onrender.com"
$ACCOUNT_ID = "your-domain.com"
```

Optional local testing:

```powershell
$BASE_URL = "http://localhost:3000"
```

## 3) API Validation (5 quick checks)

### Check 1: Minimal collect

```powershell
curl.exe -s -X POST "$BASE_URL/collect" ^
  -H "Content-Type: application/json" ^
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"platform\":\"woocommerce\",\"event_name\":\"page_view\",\"page_url\":\"https://$ACCOUNT_ID/\"}"
```

Expected:
- `success: true`
- non-empty `event_id`
- non-empty `user_key`

### Check 2: begin_checkout mapping

```powershell
$CHECKOUT_TOKEN = "chk_test_001"

curl.exe -s -X POST "$BASE_URL/collect" ^
  -H "Content-Type: application/json" ^
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"platform\":\"woocommerce\",\"event_name\":\"begin_checkout\",\"checkout_token\":\"$CHECKOUT_TOKEN\",\"page_url\":\"https://$ACCOUNT_ID/checkout\",\"utm_source\":\"google\",\"utm_medium\":\"paid_search\",\"gclid\":\"test-gclid-123\"}"
```

Expected:
- `success: true`
- event persists
- checkout token can be found in `checkout_session_map`

### Check 3: Woo order sync

```powershell
curl.exe -s -X POST "$BASE_URL/api/woo/orders-sync" ^
  -H "Content-Type: application/json" ^
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"order_id\":\"woo_test_1001\",\"order_number\":\"1001\",\"checkout_token\":\"$CHECKOUT_TOKEN\",\"revenue\":199.99,\"subtotal\":180,\"discount_total\":0,\"shipping_total\":10,\"tax_total\":9.99,\"currency\":\"MXN\",\"items\":[{\"id\":\"sku_1\",\"name\":\"Test Product\",\"quantity\":1,\"price\":199.99}],\"utm_source\":\"google\",\"utm_medium\":\"paid_search\",\"utm_campaign\":\"brand\",\"gclid\":\"test-gclid-123\"}"
```

Expected:
- `success: true`
- `attributedChannel` present (not always perfect, but should exist)

### Check 4: Dashboard analytics endpoint

```powershell
curl.exe -s "$BASE_URL/api/analytics/$ACCOUNT_ID"
```

Expected:
- response contains revenue and event stats
- no server error

### Check 5: Platform endpoints health shape

Meta pixels:

```powershell
curl.exe -s "$BASE_URL/api/pixels/$ACCOUNT_ID/meta"
```

Google conversions:

```powershell
curl.exe -s "$BASE_URL/api/conversions/$ACCOUNT_ID/google"
```

Expected:
- Meta: should return real pixel list when connected.
- Google: currently likely empty/stub until implemented.

## 4) SQL Validation (authoritative)
Run against PostgreSQL production DB.

### Query 1: Events in last 24h

```sql
SELECT count(*) AS events_24h
FROM events
WHERE account_id = 'your-domain.com'
  AND created_at >= now() - interval '24 hours';
```

### Query 2: Orders in last 24h

```sql
SELECT count(*) AS orders_24h,
       coalesce(sum(revenue), 0) AS revenue_24h
FROM orders
WHERE account_id = 'your-domain.com'
  AND created_at >= now() - interval '24 hours';
```

### Query 3: Attribution fill rate

```sql
SELECT
  count(*) AS total_orders,
  count(*) FILTER (WHERE attributed_channel IS NOT NULL) AS orders_with_channel,
  round(
    100.0 * count(*) FILTER (WHERE attributed_channel IS NOT NULL) / nullif(count(*),0),
    2
  ) AS channel_fill_pct
FROM orders
WHERE account_id = 'your-domain.com'
  AND created_at >= now() - interval '7 days';
```

### Query 4: Checkout map linkage

```sql
SELECT count(*) AS mapped_orders
FROM orders o
JOIN checkout_session_map c
  ON o.checkout_token = c.checkout_token
WHERE o.account_id = 'your-domain.com'
  AND o.created_at >= now() - interval '7 days';
```

### Query 5: Snapshot freshness

```sql
SELECT account_id, updated_at
FROM merchant_snapshots
WHERE account_id = 'your-domain.com';
```

### Query 6: Failed jobs recent

```sql
SELECT job_type, created_at, error
FROM failed_jobs
WHERE created_at >= now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 50;
```

## 5) How to score completeness quickly
- Ingestion:
  - PASS: `/collect` 2xx and events increase in DB.
  - FAIL: 5xx or no DB writes.
- Orders:
  - PASS: Woo/Shopify orders appear in `orders` table.
  - FAIL: purchases only in events fallback.
- Attribution:
  - PASS: meaningful `attributed_channel` fill rate.
  - PARTIAL: most orders unattributed.
- Snapshot:
  - PASS: `merchant_snapshots.updated_at` recent.
  - FAIL: stale snapshot + failed jobs.
- Integrations:
  - PASS: real Meta/Google resource lists.
  - PARTIAL: one or both endpoints still stub/empty.

Rule of thumb:
- 90-100%: complete
- 70-89%: usable but partial
- <70%: incomplete, fix ingestion/integration first

## 6) Immediate next engineering actions
1. Resolve any `/collect` 500 first.
2. Replace Meta CAPI placeholder in [backend/services/capiFanout.js](../backend/services/capiFanout.js).
3. Replace Google conversions stub in [backend/routes/adrayPlatforms.js](../backend/routes/adrayPlatforms.js).
4. Re-run this checklist and keep screenshots/SQL outputs as release evidence.
