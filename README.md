# AdRay / Adnova

Last update: 2026-03-11

This is the only documentation file that should be treated as the source of truth for the repository. It consolidates the previous planning files, implementation notes, operational checklist, WordPress plugin readme, Shopify review guide, and frontend README boilerplate.

## Product Goal

Build and run a platform-agnostic attribution pipeline for Shopify, WooCommerce, and custom sites that:

- captures browser events,
- stitches attribution,
- processes purchases server-side,
- syncs revenue truth from ecommerce platforms,
- exposes reliable dashboard metrics,
- and prepares clean data for Meta and Google integrations.

## Current Architecture

- Main backend: Node.js + Express.
- Primary relational data layer: PostgreSQL via Prisma.
- Legacy and operational modules: MongoDB via Mongoose.
- Cache and dedup helpers: Redis via ioredis.
- Deployment baseline: Render.
- WooCommerce client distribution: WordPress plugin under `wordpress-plugin/adnova-pixel`.
- Frontend apps: multiple Vite + React + TypeScript + shadcn-ui + Tailwind projects generated from Lovable.

## Current Status

### Working now

- Universal pixel is live and loadable cross-origin from the AdRay server.
- Pixel loading returns `200 OK`.
- Event collection flow exists at `POST /collect`.
- Identity cookie `_adray_uid` handling is implemented.
- Sessions, events, and checkout map persistence are implemented.
- Shopify webhook ingestion exists for orders and checkouts.
- WooCommerce order sync path exists through the plugin and backend sync route.
- Attribution stitching, merchant snapshot updates, and failed job logging are implemented.

### Active incident

`POST /collect` has been observed returning `500 Internal Server Error` in production even while the pixel asset itself loads correctly.

Most likely root causes, in priority order:

1. Production database schema drift between deployed Prisma client and actual DB schema.
2. Missing or invalid environment variables such as `DATABASE_URL`, `REDIS_URL`, or `ENCRYPTION_KEY`.
3. Runtime DB connectivity issues.
4. Payload shape mismatches between browser sender and collector expectations.

Immediate containment:

- Keep the pixel loading to validate traffic flow.
- Treat production event flow as non-persistent until `/collect` is consistently returning `2xx`.
- Do not trust attribution analysis until collector stability is restored.

## Scope and Deliverables

### Layer 1 goal

Deliver the first complete layer for first-party event capture and attribution without requiring new Shopify scopes.

### Functional scope

- Custom Pixel for Shopify Customer Events.
- Revenue truth from Shopify orders in read-only mode.
- Session to checkout to order stitching.
- Pixel health monitoring.
- Match rate visibility.
- Meta and Google connection verification.
- Basic spend and clicks pull by day and campaign when integrations are available.

### Deliverables

- Custom Pixel V1 with installation and verification guidance.
- Collector endpoint ready to receive browser events.
- Read-only order sync with basic health metrics.
- Base attribution stitching.
- Minimal dashboard for Pixel Health, Match Rate, and Ads Health.
- Basic ad-platform pull for spend and clicks.

### Original schedule target

- Week 1: schema v0, custom pixel V1, collector base, baseline health.
- Week 2: revenue sync, stitching base, Pixel Health UI.
- Week 3: Meta and Google connection validation, Ads Health, spend and clicks pull.
- Week 4: hardening, pilot onboarding, and demo output.

## Canonical Pipeline

- Browser Pixel -> `POST /collect` -> PostgreSQL.
- Checkout map persists attribution snapshot at checkout time.
- Purchase webhooks or Woo order sync persist orders server-side.
- Async pipeline performs attribution stitching, order enrichment, CAPI fanout, snapshot update, and failed job logging.

## Canonical Data Model

The effective Prisma model set is:

- `Account`
- `PlatformConnection`
- `IdentityGraph`
- `Session`
- `CheckoutSessionMap`
- `Event`
- `Order`
- `EventDedup`
- `MerchantSnapshot`
- `FailedJob`

The original planning spec described a shop-centric version of the same pipeline with these equivalent entities:

- `shops`
- `platform_connections`
- `identity_graph`
- `sessions`
- `checkout_session_map`
- `events`
- `orders`
- `event_dedup`
- `merchant_snapshots`

The current implementation uses an `account_id`-centric model with partial legacy `shop_id` fallback in some paths.

## Confirmed Endpoints

### Core pipeline

- `POST /collect`
- `POST /webhooks/shopify/orders-create`
- `POST /webhooks/shopify/checkouts-create`
- `POST /api/woo/orders-sync`

### Platform integrations

- `GET /api/pixels/:account_id/meta`
- `GET /api/conversions/:account_id/google`
- `POST /api/connections/:account_id`

### WordPress plugin distribution

- `GET /wp-plugin/adnova-pixel/update.json`
- `GET /wp-plugin/adnova-pixel/download`

## Service Responsibilities

### Identity resolution

The collector resolves a persistent `user_key` with the following priority:

1. Existing first-party cookie.
2. Click IDs like `fbclid`, `gclid`, or `ttclid`.
3. Customer ID if present.
4. Fingerprint derived from request metadata.

It then upserts identity data and refreshes the `_adray_uid` cookie.

### Attribution stitching

The order pipeline looks up the checkout token, retrieves the attribution snapshot, classifies the channel, and assigns confidence based on the strongest available signal.

Confidence targets from the original design:

- click ID present: `1.0`
- UTM only: `0.85`
- referrer only: `0.7`
- fingerprint match: `0.6`
- no attribution signal: `0.0`

### CAPI fanout

The intended design is parallel platform fanout with isolated failures. One failed platform send must not block the others.

Planned platform behavior:

- Meta CAPI purchase send with hashed PII, `event_id`, `fbp`, `fbc`, IP, user-agent, revenue, currency, and order contents.
- Google conversions upload when `gclid` and a valid conversion action are available.
- TikTok parity where relevant.

### Merchant snapshot

The merchant snapshot is intended to summarize:

- total revenue,
- order count,
- AOV,
- revenue by channel,
- ROAS when spend data exists,
- funnel metrics,
- pixel health,
- top products,
- attribution confidence distribution,
- unattributed order count and rate.

## Security Requirements

- Validate Shopify HMAC on every webhook.
- Encrypt platform access tokens at rest.
- Hash email and phone with SHA-256 before storing or sending.
- Never log raw PII.
- Validate account or shop identity on protected requests.
- Rate limit `POST /collect` to `100` requests per minute per merchant.

## Error Handling Requirements

- Shopify webhooks should return `200` even when downstream processing fails.
- Failures should be captured in `FailedJob` for retry.
- CAPI failures are non-fatal.
- Retry policy target: exponential backoff with `1s`, `5s`, and `30s` delays.

## Environment Variables

### Core pipeline

- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_API_SECRET_2`
- `SHOPIFY_WEBHOOK_SECRET`

### Integrations

- `META_APP_ID`
- `META_APP_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`

### Runtime and app infra

- `MONGO_URI`
- `SESSION_SECRET`
- `APP_URL`
- `SHOPIFY_API_KEY`
- Render or environment-specific runtime values as needed.

## Main Risks and Gaps

### P0

- `/collect` instability in production.
- Hybrid Prisma plus Mongo data-layer transitions causing mismatched assumptions.

### P1

- Meta CAPI is still partial or placeholder in current code.
- Google conversions listing endpoint still has stub behavior.
- Rate limit key still prioritizes legacy `shop_id` instead of `account_id` in non-Shopify traffic.
- `ENCRYPTION_KEY` fallback behavior is unsafe for production if it regenerates on restart.

### P2

- Endpoint naming and historical docs previously diverged.
- Missing canonical incident playbook was creating confusion before this consolidation.

## Priority Execution Plan

### Phase 1: stabilize ingestion

1. Capture the exact production stack trace for `/collect`.
2. Confirm deployed Prisma client matches `backend/prisma/schema.prisma`.
3. Verify required environment variables are set and valid.
4. Trigger a minimal collector payload and confirm persistence in `events`.
5. Re-test live WooCommerce traffic from `page_view` through `purchase`.

### Phase 2: close pipeline gaps

1. Implement full Meta CAPI send.
2. Replace Google conversions listing stub with real Google Ads API retrieval.
3. Add missing browser fields consistently: `utm_content`, `utm_term`, `landing_page_url`, and `view_item`.
4. Ensure request IP is used for better fingerprint confidence.

### Phase 3: consolidate platform behavior

1. Define the final source of truth between Prisma and Mongo for each domain.
2. Standardize token and integration lookup paths.
3. Add startup health checks for required environment variables.

### Phase 4: QA and release hardening

1. Run end-to-end flow: `page_view -> add_to_cart -> begin_checkout -> purchase -> dashboard`.
2. Re-run operational checks and SQL validation.
3. Keep release evidence from API responses and SQL outputs.

## Definition of Done

- WooCommerce and Shopify purchases persist into `orders`.
- Orders are attributed at a meaningful rate.
- Merchant snapshot updates without critical failures.
- Meta and Google resource endpoints return real data, not placeholders.
- Meta CAPI purchase send works with `event_id` dedup.
- Dashboard reflects revenue and channel metrics without relying on fragile fallbacks.

## Operational Checklist

### Success criteria

The dashboard is considered complete when all are true:

- `POST /collect` returns `2xx` consistently and persists events.
- Purchases arrive in `orders` for WooCommerce and Shopify.
- Attribution fields in `orders` are populated for a meaningful percentage of orders.
- `merchant_snapshots` updates without critical failures.
- Meta CAPI and Google conversions endpoints are real and not placeholders.

### Known code notes

- Meta CAPI is still placeholder in `backend/services/capiFanout.js`.
- Google conversions listing still has stub behavior in `backend/routes/adrayPlatforms.js`.
- Dashboard still has revenue fallback to purchase events when synced orders are incomplete.

### Terminal variables

Use PowerShell:

```powershell
$BASE_URL   = "https://adray-app-staging-german.onrender.com"
$ACCOUNT_ID = "your-domain.com"
```

Optional local testing:

```powershell
$BASE_URL = "http://localhost:3000"
```

### API validation

#### Minimal collect

```powershell
curl.exe -s -X POST "$BASE_URL/collect" ^
  -H "Content-Type: application/json" ^
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"platform\":\"woocommerce\",\"event_name\":\"page_view\",\"page_url\":\"https://$ACCOUNT_ID/\"}"
```

Expected:

- `success: true`
- non-empty `event_id`
- non-empty `user_key`

#### begin_checkout mapping

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

#### Woo order sync

```powershell
curl.exe -s -X POST "$BASE_URL/api/woo/orders-sync" ^
  -H "Content-Type: application/json" ^
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"order_id\":\"woo_test_1001\",\"order_number\":\"1001\",\"checkout_token\":\"$CHECKOUT_TOKEN\",\"revenue\":199.99,\"subtotal\":180,\"discount_total\":0,\"shipping_total\":10,\"tax_total\":9.99,\"currency\":\"MXN\",\"items\":[{\"id\":\"sku_1\",\"name\":\"Test Product\",\"quantity\":1,\"price\":199.99}],\"utm_source\":\"google\",\"utm_medium\":\"paid_search\",\"utm_campaign\":\"brand\",\"gclid\":\"test-gclid-123\"}"
```

Expected:

- `success: true`
- `attributedChannel` present when attribution is available

#### Dashboard analytics endpoint

```powershell
curl.exe -s "$BASE_URL/api/analytics/$ACCOUNT_ID"
```

Expected:

- response contains revenue and event stats
- no server error

#### Platform endpoints health shape

Meta pixels:

```powershell
curl.exe -s "$BASE_URL/api/pixels/$ACCOUNT_ID/meta"
```

Google conversions:

```powershell
curl.exe -s "$BASE_URL/api/conversions/$ACCOUNT_ID/google"
```

Expected:

- Meta should return a real pixel list when connected.
- Google will remain partial until the stub is replaced.

### SQL validation

#### Events in last 24h

```sql
SELECT count(*) AS events_24h
FROM events
WHERE account_id = 'your-domain.com'
  AND created_at >= now() - interval '24 hours';
```

#### Orders in last 24h

```sql
SELECT count(*) AS orders_24h,
       coalesce(sum(revenue), 0) AS revenue_24h
FROM orders
WHERE account_id = 'your-domain.com'
  AND created_at >= now() - interval '24 hours';
```

#### Attribution fill rate

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

#### Checkout map linkage

```sql
SELECT count(*) AS mapped_orders
FROM orders o
JOIN checkout_session_map c
  ON o.checkout_token = c.checkout_token
WHERE o.account_id = 'your-domain.com'
  AND o.created_at >= now() - interval '7 days';
```

#### Snapshot freshness

```sql
SELECT account_id, updated_at
FROM merchant_snapshots
WHERE account_id = 'your-domain.com';
```

#### Failed jobs recent

```sql
SELECT job_type, created_at, error
FROM failed_jobs
WHERE created_at >= now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 50;
```

### Quick scoring

- `90-100%`: complete
- `70-89%`: usable but partial
- `<70%`: incomplete, fix ingestion and integration first

## Pixel Installation

### Merchant snippet

Use this in the merchant `<head>`:

```html
<script src="https://adray-app-staging-german.onrender.com/adray-pixel.js"
        data-account-id="merchant-domain-or-acct-id"></script>
```

Notes:

- `data-account-id` must be a plain value without protocol or trailing slash.
- Initial `page_view` should reach `/collect` before any cart action.

## WordPress Plugin

### Summary

Adnova Pixel installs the tracking script automatically on WordPress and uses the detected domain as `account_id` and `site_id`.

### Behavior

- Detects the site domain via `home_url()`.
- Injects `https://adray-app-staging-german.onrender.com/adray-pixel.js` into the frontend.
- Sends a verification event to `/collect` on activation.
- Supports `page_view`, `view_item`, `add_to_cart`, `begin_checkout`, and `purchase`.

### WooCommerce purchase capture in plugin `v1.1.0`

- Sends `purchase` on the thank-you page with `order_id`, `revenue`, `currency`, and `items`.
- Includes server-side fallback via `woocommerce_thankyou`.
- Includes footer fallback for custom themes or checkouts.
- Includes browser-side DOM scraping fallback when `window.adnova_order_data` is missing.
- Includes WooCommerce attribution metadata from `_wc_order_attribution_*`.
- Captures server-side on `payment_complete`, `processing`, and `completed`.
- Syncs Woo orders directly to backend `orders` in real time.
- Performs recent order backfill on activation or update.
- Supports auto-update from staging.

### Dashboard outputs expected from plugin-driven data

- total revenue,
- top products,
- pixel health,
- recent purchases with date, order, revenue, products, and source.

### Installation

1. Compress the `adnova-pixel` folder as a `.zip`.
2. Go to WordPress `Plugins > Add New > Upload Plugin`.
3. Upload the zip and activate it.
4. The pixel becomes active automatically.

### Troubleshooting

If purchase arrives with `$0` or no items:

- confirm the thank-you page is the real `order-received` page,
- confirm there is no redirect to a custom page without order data,
- use plugin version `1.0.1` or later.

If attribution looks incomplete:

- confirm landing URLs include `utm_source`, `utm_medium`, and `utm_campaign`,
- confirm backend checkout-to-order mapping and attribution rules are functioning.

### Plugin changelog

#### `1.1.0`

- Auto-update from staging.

#### `1.0.4`

- Direct Woo order sync to backend for real-time reporting.
- Recent order backfill on activation and update.

#### `1.0.3`

- Server-side purchase capture in payment and status hooks.
- Stronger WooCommerce source fallback fields.

#### `1.0.2`

- Sends UTM and click ID attribution from WooCommerce order metadata.
- Reduces unattributed cases when WooCommerce already knows the source.

#### `1.0.1`

- Better purchase capture in custom checkouts.
- Browser-side fallback for totals and items.
- Compatibility with expanded dashboard views.

#### `1.0.0`

- Initial auto-configuration by domain.

## Shopify Embedded App Review Guide

This section condenses the implementation guidance that was previously in a separate review document.

### Branching strategy

- Start from a clean `main`.
- Do not cherry-pick onto a diverged branch.
- Apply changes manually and smoke test after each one.

### Required local environment

```bash
git checkout main
git pull origin main
git checkout -b shopify-session-fix
npm install
```

Required env vars:

```text
SHOPIFY_API_KEY=<your client id>
SHOPIFY_API_SECRET=<your client secret>
APP_URL=https://adray.ai
SESSION_SECRET=<long random string>
```

### Required backend changes

1. `middlewares/verifySessionToken.js`
   - Read bearer token.
   - Validate JWT with `SHOPIFY_API_SECRET` and `SHOPIFY_API_KEY`.
   - Normalize `.myshopify.com` destination.
   - Return Shopify-required reauthorization headers on every invalid session response.

2. `backend/routes/secure.js`
   - Add protected test endpoints like `/ping` and `/audits/latest`.

3. `backend/index.js`
   - Add `verifySessionToken` and secure routes.
   - Replace the `ALLOWED_ORIGINS` CORS block so Shopify Admin, app origin, Render origin, and local origins are accepted.
   - Add an API session-token bypass list for public and webhook-like endpoints.
   - Mount `/api/secure` behind session token verification.

4. `public/connector/interface.connector.js`
   - Ensure embedded navigation, host parsing, App Bridge readiness, and session-token retrieval support both modern and legacy Shopify flows.

### Review requirement to remember

Every `401` caused by an invalid Shopify session token must return these headers:

- `X-Shopify-Retry-Invalid-Session-Request: 1`
- `X-Shopify-API-Request-Failure-Reauthorize: 1`

## Frontend Workspaces

These folders are standalone frontend workspaces generated from Lovable. Their README files were boilerplate, so the useful retained information is listed here.

### Shared stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

### Lovable project URLs

- `dashboard-src`: `https://lovable.dev/projects/67643995-c0b5-4b9b-bc02-dc5bf96f004b`
- `plan-src`: `https://lovable.dev/projects/8450252f-ea5d-404e-9f07-f726bf2a1cba`
- `saas-landing`: `https://lovable.dev/projects/d37e7296-de93-463c-b522-03cb9606122b`
- `support-src`: `https://lovable.dev/projects/3ef68002-d162-44ba-8b83-a00c513b5cd9`

### Standard local workflow for those frontends

```sh
npm i
npm run dev
```

## Immediate Engineering Actions

1. Resolve `/collect` `500` first.
2. Replace Meta CAPI placeholder.
3. Replace Google conversions stub.
4. Re-run API and SQL checklist.
5. Keep evidence for release validation.

## Dashboard Completion Plan

Current dashboard status from live review:

- Core summary cards are rendering.
- Attribution by channel is rendering.
- Daily revenue trend is rendering.
- Pixel Health is rendering.
- Recent purchases are rendering.
- `Live Feed` is now working correctly in real time after SSE hardening.
- Visual confirmation received for:
  - `View Item` card,
  - `Data Quality` block,
  - `Integration Health` block.
- UX confirmation received for:
  - desktop carousel shows 4 metrics at a time and arrows navigate correctly,
  - mobile and tablet carousel layout does not break,
  - new `Live Feed` events show `Sesion: ...` when `sessionId` is present,
  - clicking a `Live Feed` item with `sessionId` opens session detail,
  - session detail shows summary, funnel, timeline, and linked orders when they exist,
  - events without `sessionId` render as `Sin sessionId` without breaking the dashboard.

### Missing or incomplete data for a complete dashboard

1. Session intelligence is already richer and no longer depends on a blocking modal, but it can still evolve into a stronger explorer with cross-session comparison and filters.
2. Paid media resolution now tries multiple bridges, but some accounts can still miss a usable `user -> McpData` path if they were never linked cleanly in onboarding.

### Execution order

1. Strengthen the session explorer with filters, navigation, and comparison workflows.
2. Keep expanding the bridge between public `account_id` and marketing snapshots so every eligible account resolves paid media automatically.

### Completed dashboard steps

- `Live Feed` SSE fixed and validated.
- `Sessions` and `Conversion Rate` added to the UI.
- `view_item` added as a visible funnel step.
- Data quality indicators added for revenue source, fallback mode, and snapshot freshness.
- Attribution detail expanded in recent purchases with campaign and click ID when available.
- Integration Health added for Meta, Google, and TikTok from `PlatformConnection` status.
- Metric cards converted into a carousel with 4 visible cards on desktop.
- `Live Feed` linked to `sessionId` with clickable session drill-down.
- Session detail converted from modal into a persistent `Session Explorer` panel inside the dashboard.
- Session detail enriched with attribution, checkout tokens, top pages, and touched products.
- Paid Media panel added with Meta, Google, and blended spend / revenue / ROAS from `McpData` snapshots when the shop is linked to a user snapshot.
- Paid Media block now degrades safely to `No vinculado` or `Sin snapshot` when the marketing mapping is missing.
- Paid Media resolution now tries multiple bridges: `ShopConnections.matchedToUserId`, `User.shop`, and `PlatformConnection.adAccountId -> McpData.sources`.

### Current development focus

- Strengthen the persistent `Session Explorer` with better navigation and analytical workflows.
- Continue improving session-level understanding of what a user did during a visit, including funnel steps, attribution, and path quality.
- Automatic resolution of paid media snapshots for all eligible accounts, not only already-linked Shopify shops.

### Live Feed decision rule

- Keep it because it now reliably shows incoming `COLLECT` and `WEBHOOK` events in near real time.
- Revisit only if operators stop using it or if persisted activity proves more useful than live observability.

## Final Rule

Treat this `README.md` as the single source of truth for project status, roadmap, plugin behavior, Shopify embedded-app requirements, operational validation, and frontend workspace references.
