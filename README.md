# AdRay / Adnova

Last update: 2026-04-01

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

### Staging vs producción (OAuth, Render, Cloudflare)

Checklist operativa y variables por entorno: [docs/STAGING_PRODUCTION.md](docs/STAGING_PRODUCTION.md).

## Current Status

### Frontend note

- The public analytics page at `public/adray-analytics.html` must avoid CSS class names that look like ad containers such as `ad-panel`, `ad-control`, or similar.
- Brave Shields can apply cosmetic filtering after first paint and hide those elements even when the DOM and data are correct.
- Neutral naming like `ops-panel` and `ops-control` is the current safe convention for public analytics UI blocks.

### Working now

- Universal pixel is live and loadable cross-origin from the AdRay server.
- Pixel loading returns `200 OK`.
- Event collection flow exists at `POST /collect`.
- Identity cookie `_adray_uid` handling is implemented.
- Sessions, events, and checkout map persistence are implemented.
- Shopify webhook ingestion exists for orders and checkouts.
- WooCommerce order sync path exists through the plugin and backend sync route.
- Attribution stitching, merchant snapshot updates, and failed job logging are implemented.
- WooCommerce attribution flow was validated end-to-end in staging on 2026-03-13, including checkout login stitching and attributed order persistence.

### Collector status (2026-03-23)

- Staging collector health is stable.
- Latest live tests returned `success: true`, `event_persisted: true`, `session_persisted: true`, `fallback_stored: false`.
- Data coverage endpoint is stable and no longer returning `500`/degraded Prisma errors for staging.
- Historical backfill for Layer 4 and Layer 5 session source is automated at service startup.

Current production guidance:

1. Keep monitoring `POST /collect` response flags during rollout.
2. Treat production as healthy only when the same flags above are observed in production traffic.
3. If flags regress, inspect `failed_jobs` rows with `collect_` job types first.

### Latest staging validation (2026-03-13)

Validated sample orders from manual operator tests:

- Timestamp captured in dashboard: `13/3/2026, 8:12:57 a.m.`
- Order: `66308`
- Customer: `Germán Muñoz`
- Revenue: `$374.95`
- Item summary: `ABACO x3`
- Attribution shown: `Google · brand-test`
- Source shown: `Woo Orders Sync`
- Debug shown: `woo=Google | utm=google | campaign=brand-test`
- Home -> Tienda persistence test: `13/3/2026, 8:48:58 a.m.`, order `66310`, attribution `Google · home_to_store_test`, source `Woo Orders Sync`

Validation result:

- Attribution and campaign persistence: OK.
- Woo checkout login stitching: OK.
- Homepage landing -> store navigation -> purchase attribution persistence: OK.
- End-to-end Woo flow in staging: OK.
- Live Feed now shows connected user labels when the event can be resolved against WordPress online users: OK.
- Recent purchases timezone now matches business expectation in the purchases table used by operators: OK.

Notes from this same validation:

- The recent purchases table currently applies a focused display correction for operator readability.
- Woo sync payloads were also hardened to send and parse explicit creation time metadata for later cleanup of the UI-only adjustment if it becomes unnecessary.

### Build summary (2026-03-27)

What is already built and working in the current dashboard/pipeline baseline:

- `Live Feed` runs over SSE (`/api/feed/:account_id`) and displays real-time `COLLECT` + `WEBHOOK` events.
- Collector now persists identity/session/event with stable response flags and supports fallback storage for resilience.
- Event-name normalization was hardened in collect ingestion to unify aliases (for example `added_to_cart`/`cart_add` -> `add_to_cart`).
- Pixel runtime expanded Woo add-to-cart interception coverage (REST + `wc-ajax` + form submit + click/XHR fallback paths).
- Historical profile explorer was consolidated into Attribution Journey-first UX with profile search/sort and profile-focus interactions.
- Customer name extraction and customer-id normalization were improved in backend stitching for Woo profiles and recent purchases.

### Next implementation steps (priority, 2026-03-27)

1. Make `Live Feed` refresh online-user state on a fixed interval (polling) in addition to event-triggered refresh.
2. Ensure every live event shows resolved user identity (name, email, phone, or customer id) and explicitly indicates when no logged-in identity is available.
3. Make Woo sync fully complete for the selected period (no practical 100-order cap), including paginated/backfill strategy for very large stores with queue-safe processing.
4. Ensure Historical Conversion Journey shows real user names instead of generic `Woo customer #xx` whenever any identity source can resolve the profile.
5. Ensure Selected Journey renders full stitched event timeline for the selected user/session (not only `Ad Click` + `Purchase`).
6. Fix Historical Conversion Journey user-filter input UX: black text on white input and verified functional filtering behavior.

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

## Phase 1 Data Coverage Audit (datos-pixel.md)

Reference reviewed: `datos-pixel.md` (March 2026). The list below maps requested Phase 1 fields against current implementation.

### Layer 1: Identity anchors

- `user_key`: YES. Persisted in `identity_graph`, `events`, `sessions`, and used in `orders` when available.
- `email_hash`: PARTIAL. Persisted in `identity_graph` and `orders` when payload/webhook includes email; not guaranteed from all Shopify pixel events.
- `phone_hash`: PARTIAL. Persisted in `identity_graph` and `orders` when payload/webhook includes phone; not guaranteed from all Shopify pixel events.
- `customer_id`: PARTIAL. Persisted when present in browser payload or ecommerce order payload; not guaranteed on anonymous browser events.

### Layer 2: Session events

- `session_id`: YES. Persisted in `sessions` and `events`.
- `utm_source`, `utm_medium`, `utm_campaign`: YES. Persisted in `sessions` and checkout attribution snapshots.
- `fingerprint_hash`: YES. Persisted in `identity_graph`.
- `ip_hash`: YES. Persisted as hashed value in identity/session/event write paths.
- `page_events[]`: PARTIAL. Events are persisted row-by-row in `events`, not as one array field in `sessions`.
- `session_start_at`: YES (`sessions.started_at`).
- `session_end_at`: PARTIAL (`sessions.last_event_at` works as last activity, but no explicit immutable end marker).

### Layer 3: Touchpoints and click IDs

- `fbclid`, `gclid`, `ttclid`: YES. Persisted in `identity_graph`, `sessions`, and attribution snapshots when available.
- `event_id` server-generated: YES. Generated server-side in collector/webhooks/order sync paths.
- `landing_page`: PARTIAL. Field exists (`sessions.landing_page_url`) but still depends on sender payload consistency.
- `referrer`: YES. Persisted in `sessions` and attribution snapshots when provided.

### Layer 4: Order truth

- `order_id`: YES. Stored in `orders.order_id`.
- `gross_revenue`: YES (`orders.revenue` from platform order payload).
- `refund_amount`: PARTIAL. Dedicated field now exists and is updated from Shopify `orders-updated` and Woo sync when payloads include it.
- `chargeback_flag`: PARTIAL. Dedicated field now exists and is updated from webhook payload heuristics, but still needs disputes API parity.
- `orders_count` stamp at purchase time: PARTIAL. Field now exists and is written from order payloads when present, but not guaranteed for all stores/payload variants.
- `checkout_token`: YES. Stored in `checkout_session_map` and `orders`, used as stitch key.
- `customer_id` on order: YES when provided by platform payload.
- `created_at` (platform order creation time): YES (`orders.platform_created_at`).

### Layer 5: Platform daily pull

- `meta_spend`, `meta_impressions`: YES (available in MCP adapters/chunks and channel summary paths).
- `meta_reported_conv_value`: PARTIAL (available in MCP campaign payloads as conversion value/ROAS context, not yet standardized as one canonical DB field in Prisma).
- `google_spend`, `google_clicks`: YES (available in MCP adapters/chunks and channel summary paths).
- `ga4_session_source`: NO (not found as canonical persisted field in current MCP models/routes).

### Layer 6: Raw enrichment on every event

- `confidence_score`: YES (event-level field now persisted from identity resolution output in collect path).
- `match_type` (`deterministic` / `probabilistic`): YES (event-level field now persisted in collect path).
- `raw_source` (`pixel` / `webhook` / `api`): PARTIAL (dedicated event field now exists and is written in collect; webhook/api parity still needs full rollout).
- `collected_at`: PARTIAL (dedicated event field now exists and is written in collect; other ingestion paths still need harmonization).

### Critical stitch status

- `checkout_token -> session_id` at checkout time: YES for browser `begin_checkout` path (`POST /collect`) via `checkout_session_map` upsert.
- Shopify `checkouts/create` webhook currently backfills with `unknown` session and user when browser context is missing (good fallback, but weaker than browser begin_checkout mapping).

## Confirmed Endpoints

### Core pipeline

- `POST /collect`
- `POST /webhooks/shopify/orders-create`
- `POST /webhooks/shopify/orders-updated`
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
- Rate limit key still prioritizes legacy `shop_id` instead of `account_id` in non-Shopify traffic.
- `ENCRYPTION_KEY` fallback behavior is unsafe for production if it regenerates on restart.
- Time handling is now acceptable for operator review in the recent purchases table, but the long-term cleanup is still to converge Woo source timestamps and dashboard rendering into one unambiguous policy.

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
2. Verify Google conversions listing and upload behavior with real ad accounts after latest backend changes.
3. Add missing browser fields consistently: `utm_content`, `utm_term`, `landing_page_url`, and `view_item`.
4. Finish sender coverage so pixel payloads consistently include identity and landing fields across Shopify and Woo.
5. Extend `raw_source` and `collected_at` to every ingestion path, not only collect.
6. Add disputes API parity to harden `chargeback_flag` beyond webhook heuristics.
7. Enforce immutable `orders_count` stamping policy at first order-ingestion write.
8. Define one canonical persisted field for GA4 session source/medium in MCP or analytics storage.

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
- Google conversions listing was upgraded from stub to real retrieval path in `backend/routes/adrayPlatforms.js`; pending final validation with fully connected production-like accounts.
- Dashboard still has revenue fallback to purchase events when synced orders are incomplete.
- Recent purchases timezone has already been validated visually in staging after the focused dashboard adjustment; full source-level time normalization should still be re-checked with fresh Woo orders after plugin rollout.

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
- `support-src`: `https://lovable.dev/projects/3ef68002-d162-44ba-8b83-a00c513b5cd9`

### Standard local workflow for those frontends

```sh
npm i
npm run dev
```

### Dashboard deploy workflow (`dashboard-src`)

`dashboard-src` now lives directly inside this repository. Dashboard UI changes deploy with the same branch and commit as the rest of the app.

Current serving behavior:

- Backend serves `dashboard-src/dist` when it exists.
- If `dashboard-src/dist` does not exist, backend falls back to `public/dashboard`.
- `dashboard-src/dist` should not be committed.

Recommended local smoke test before pushing:

```sh
npm --prefix dashboard-src ci
npm --prefix dashboard-src run build
npm start
```

Then open:

```text
http://localhost:3000/dashboard/attribution
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

1. Session intelligence now includes a recommended comparison shortcut plus longitudinal reading across many sessions, but still needs deeper operator workflows once real usage reveals the most valuable shortcuts.
2. Paid media resolution now tries `MetaAccount` and `GoogleAccount` ownership too, but some accounts can still miss a usable `user -> McpData` path if historical onboarding data is incomplete.
3. Shopify pixel behavior still needs the same practical validation that WooCommerce already passed: browser capture, checkout continuity, purchase visibility, and attribution persistence.

### Execution order

1. Observe how operators use the new suggested comparison and longitudinal cards, then refine the next review shortcuts around the most common decisions.
2. Keep expanding the bridge between public `account_id` and marketing snapshots so every eligible account resolves paid media automatically.
3. Start staged Shopify pixel validation to confirm collection, checkout linkage, and purchase reflection without regressing embedded-app session behavior.

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
- `Paid Media` moved above `Pixel Health` to prioritize commercial context before ingestion health.
- `Session Explorer` now includes a visual journey map plus simple behavioral patterns based on other sessions from the same `userKey`.
- `Session Explorer` now includes related-session navigation and timeline filters for faster operator review.
- `Session Explorer` now supports side-by-side comparison against another related session.
- `Session Explorer` now recommends a comparison session automatically and adds longitudinal cards that summarize recurrence, dominant time window, and historical outcome across the tracked sessions of the same user.
- Paid Media panel added with Meta, Google, and blended spend / revenue / ROAS from `McpData` snapshots when the shop is linked to a user snapshot.
- Paid Media block now degrades safely to `No vinculado` or `Sin snapshot` when the marketing mapping is missing.
- Paid Media resolution now tries multiple bridges: `ShopConnections.matchedToUserId`, `User.shop`, `MetaAccount`, `GoogleAccount`, and `PlatformConnection.adAccountId -> McpData.sources`.
- Manual Woo attribution validation completed on 2026-03-13 with successful campaign persistence (`Google · brand-test`) and checkout login stitching.
- Manual Woo validation also confirmed Home -> Tienda attribution persistence and operator-readable timezone in recent purchases.

- Layer 1 analytics now has an embedded entry point at `/dashboard/attribution`, reusing the existing `/analytics` experience inside the main dashboard shell instead of leaving it as a separate dashboard.
- Desktop and mobile dashboard navigation now expose that embedded attribution view as a full-bleed iframe inside the main shell, while store switching happens inside `backend/views/adray-analytics.html` from the top-right store chip.
- The current store selector is frontend-only on purpose: it shows the session shop plus shops already seen in the same browser via URL or local storage, not a backend catalog of every pixel-enabled store yet.

### Current development focus

- Run the pending Woo multi-touch validation after the 31-minute cooldown and record how `first_touch`, `last_touch`, and `linear` redistribute the same conversion.
- Start Shopify pixel validation in staging, beginning with browser event capture and then checkout/purchase continuity.
- Keep refining the persistent `Session Explorer` only after those platform-validation checkpoints are documented.
- If the embedded attribution view stays stable, the next optional cleanup is migrating the highest-value widgets from `backend/views/adray-analytics.html` into native `dashboard-src` components gradually instead of in one rewrite.

## Attribution Next Steps

This section is the working checklist for everything still pending to make attribution operationally trustworthy.

### P0: must close first

1. Fully stabilize `POST /collect` in production.
2. Complete and verify real Meta CAPI purchase fanout.
3. Verify Google conversion upload end-to-end with a real connected account, valid `gclid`, and valid conversion action.
4. Remove production dependence on the unsafe `ENCRYPTION_KEY` fallback.
5. Confirm rate limiting keys resolve by `account_id` for public non-Shopify traffic.
6. Complete the pending Woo multi-touch proof and archive screenshot or row-level evidence for `first_touch`, `last_touch`, and `linear`.
7. Start equivalent Shopify pixel validation so Woo and Shopify have the same minimum evidence bar.

### Attribution data validation

1. Confirm `page_view`, `view_item`, `add_to_cart`, `begin_checkout`, and `purchase` all persist for the same customer journey.
2. Confirm `checkout_token` links browser session to checkout map and finally to the synced order.
3. Confirm these fields survive into stored attribution data when present:
  - `utm_source`
  - `utm_medium`
  - `utm_campaign`
  - `utm_content`
  - `utm_term`
  - `gclid`
  - `fbclid`
  - `ttclid`
4. Confirm WooCommerce attribution metadata from `_wc_order_attribution_*` is used as fallback when browser-side signals are weak.
5. Confirm same-site referrers are not inflating non-direct attribution.
6. Review unattributed orders one by one and classify the root cause:
  - no browser event
  - no checkout map
  - missing UTMs or click IDs
  - order sync arrived without enough attribution context
  - collector persistence failure

### Attribution model validation

1. Re-run the same account with `first_touch`, `last_touch`, and `linear`.
2. Confirm channel revenue and order allocation actually changes when multiple touchpoints exist.
3. Confirm the dashboard badge, chart totals, and recent purchases are aligned to the selected model.
4. Use the already validated Home -> Tienda path as the control case, then compare against the multi-touch case.

### Evidence required before calling attribution usable

1. API evidence for `collect`, `begin_checkout`, `woo/orders-sync`, and `analytics`.
2. SQL evidence for events, orders, checkout linkage, and attribution fill rate.
3. At least one real order with click ID attribution.
4. At least one real order with UTM-only attribution.
5. At least one real order that correctly falls back to Woo source metadata.
6. A reviewed sample of unattributed orders with documented reason.
7. At least one Shopify browser session with visible pixel events from landing to checkout.
8. At least one Shopify purchase reflected end-to-end if the staging store allows completing the order.

### Manual operator checks in dashboard

1. `Recent Purchases` shows channel, platform, campaign, confidence, and debug context when available.
2. `Atribución por Canal` matches the selected attribution model.
3. Session detail shows attribution fields, checkout tokens, touched products, and landing/referrer context.
4. No channel is over-counted when the same order is viewed under different models.

## Attribution Test Plan

Use this exact sequence when validating a WooCommerce account.

### Test 1: browser signal capture

1. Open the store with a URL containing `utm_source`, `utm_medium`, and `utm_campaign`.
2. Visit at least one product page.
3. Add a product to cart.
4. Start checkout.
5. Complete a purchase.
6. Verify that the dashboard later shows the same journey with `view_item`, `add_to_cart`, `begin_checkout`, and attributed purchase context.

### Test 2: click ID capture

1. Open the store using a test URL that includes `gclid` or `fbclid`.
2. Complete the purchase flow.
3. Verify the resulting order keeps the click ID in attribution data and resolves to the expected paid channel.

### Test 3: Woo fallback attribution

1. Complete a purchase where WooCommerce already has source metadata.
2. Verify the synced order still receives attribution even if browser signal is incomplete.
3. Confirm the dashboard exposes the Woo source label in recent purchases when that fallback is used.

### Test 4: model comparison

1. Load the same account in the dashboard.
2. Switch the attribution selector between `first touch`, `last touch`, and `linear`.
3. Confirm the channel chart and attributed revenue/order breakdown change consistently.

### Test 5: unattributed diagnosis

1. Find a recent unattributed order in the dashboard or DB.
2. Check whether the corresponding session exists.
3. Check whether a `checkout_token` was persisted.
4. Check whether the order has an attribution snapshot.
5. Record the failure mode before changing code.

### Test 6: Shopify pixel smoke test

1. Install or confirm the custom pixel in the Shopify staging store.
2. Open the storefront in an incognito window with a tagged URL containing at least `utm_source`, `utm_medium`, and `utm_campaign`.
3. Verify `page_view` reaches `POST /collect` and appears in `Live Feed`.
4. Visit a product page and verify `view_item` appears.
5. Add to cart and verify `add_to_cart` appears.
6. Start checkout and verify `begin_checkout` plus `checkout_token` persistence.
7. If the store permits it, complete a test purchase and verify the order later appears in recent purchases with channel and campaign context.
8. If purchase is not possible, stop at checkout and at minimum confirm that the session and checkout linkage persisted.

## Immediate Next Tests

1. Finish the Woo multi-touch test after the 31-minute wait using the exact Meta session A and Google session B links already defined.
2. Capture the resulting order row under `last_touch`, then switch to `first_touch` and `linear` and compare channel redistribution.
3. Start the Shopify smoke test with `page_view -> view_item -> add_to_cart -> begin_checkout` before attempting purchase.
4. If Shopify events appear correctly in `Live Feed`, move to purchase validation and then compare recent purchases output against Woo behavior.

## User-Assisted Validation Steps

When asking a human operator to test attribution, use this sequence.

1. Open the store in an incognito window.
2. Use a URL like:

```text
https://your-store-domain/?utm_source=google&utm_medium=paid_search&utm_campaign=brand-test&utm_content=adset-test&utm_term=creative-test&gclid=test-gclid-123
```

3. Browse the homepage.
4. Open a product detail page.
5. Add the product to cart.
6. Start checkout.
7. Complete a purchase if the environment allows it, or stop at checkout if you are only validating signal persistence.
8. Send back:
  - the exact timestamp,
  - the final URL reached,
  - the order number if a purchase completed,
  - whether the dashboard later showed the correct channel and campaign.

If a login state is involved, repeat the same flow once logged in and once logged out so identity stitching can be compared against attribution behavior.

### Live Feed decision rule

- Keep it because it now reliably shows incoming `COLLECT` and `WEBHOOK` events in near real time.
- Revisit only if operators stop using it or if persisted activity proves more useful than live observability.

## WooCommerce Plugin Focus (Phase 1)

This section is the technical path to ship missing Phase 1 data by updating only the Woo plugin and validating DB persistence.

### Woo fields still missing or partial

- `email_hash` and `phone_hash` at checkout typing-time (pre-submit): still partial. Current flow hashes reliably at order/login time, but not at first checkout field interaction.
- `session_end_at` explicit close marker: still partial (current fallback is `sessions.last_event_at`).
- `page_events[]` session array: still partial (events are persisted row-by-row in `events`).
- `ga4_session_source` canonical field in analytics storage: still missing as dedicated persisted field.
- `chargeback_flag` from a dedicated disputes source: still partial (current signal is webhook/order-meta heuristic).

### Already implemented in plugin/backend for Woo

- Plugin now sends `refund_amount`, `orders_count`, `chargeback_flag`, `raw_source`, and `collected_at` in Woo order sync payloads.
- Plugin triggers re-sync on refund hook (`woocommerce_order_refunded`) so order lifecycle changes reach backend.
- Woo sync backend now persists those fields and parses `chargeback_flag` safely.
- Pixel now captures checkout email/phone on `blur`/`change`, sends deterministic `email_hash` and `phone_hash` in `identity_signal`, and backend identity resolution now consumes those hashes for deterministic matching.

### Technical rollout steps (plugin-only update path)

1. Publish plugin package version `1.1.8` in the plugin update endpoint used by Woo stores.
2. In Woo admin, run plugin update and confirm installed version is `1.1.8`.
3. Run Prisma migration in backend before tests so new columns exist:
  - `identity_graph.ip_hash`
  - `sessions.ip_hash`
  - `events.raw_source`, `events.match_type`, `events.confidence_score`, `events.ip_hash`, `events.collected_at`
  - `orders.refund_amount`, `orders.chargeback_flag`, `orders.orders_count`
4. Trigger one normal order and one refund in Woo staging.
5. Confirm plugin sends new payload keys by inspecting request body to `/api/woo/orders-sync`.
6. Validate DB rows for that `order_id` contain `refund_amount`, `orders_count`, and `chargeback_flag`.
7. Validate dashboard recent purchases and attribution remain stable after plugin upgrade.

### DB confirmation checklist (Woo)

1. New order row has expected values in `orders`:
  - `refund_amount` (0 for non-refunded order)
  - `orders_count` (customer order count snapshot)
  - `chargeback_flag` (false unless dispute markers detected)
2. Refunded order re-sync updates `refund_amount` > 0.
3. Events from collect still store `raw_source`, `match_type`, `confidence_score`, `ip_hash`, and `collected_at`.
4. `POST /collect` response should now be reviewed with persistence flags:
  - `event_persisted`
  - `session_persisted`
  - `fallback_stored` (true only when payload had to be stored in `failed_jobs` as safety fallback)

### Current collect resilience status (staging)

- Real-time `Live Feed` ingestion for `identity_signal` is working in staging.
- Collector fallback into `failed_jobs` remains active as a safety net, but current staging behavior shows canonical persistence working.

Latest live evidence (2026-03-22):

- Earlier validation (before schema alignment) showed degraded persistence:
  - `success: true`
  - `event_persisted: false`
  - `session_persisted: false`
  - `fallback_stored: true`
- Latest validation (after alignment) confirms healthy canonical persistence:
  - `success: true`
  - `event_persisted: true`
  - `session_persisted: true`
  - `fallback_stored: false`
- Interpretation: browser collection, realtime flow, and canonical persistence into `events`/`sessions` are now aligned in staging.

### Completion criteria for this task

1. Run one live checkout test in staging (logged-in Woo flow).
2. Confirm at least one `identity_signal` appears in `Live Feed`.
3. Confirm `POST /collect` returns:
  - `success: true`
  - `event_persisted: true`
  - `session_persisted: true`
  - `fallback_stored: false`
4. If step 3 fails, inspect `failed_jobs` rows with `job_type` starting with `collect_` and complete DB migration/alignment before re-test.

Current task state:

- Completed.
- Done: checkout identity capture + realtime feed validation + canonical DB persistence confirmation.
- Result: completion criteria satisfied with `event_persisted: true`, `session_persisted: true`, `fallback_stored: false`.

### Operator runbook to unblock Prisma push

Run from the Render shell (or any environment pointing to staging `DATABASE_URL`):

1. `npm run db:pc:check`
2. If duplicates are reported, run `npm run db:pc:dedupe`
3. Re-run `npm run db:pc:check` and confirm zero duplicates
4. Run `npm run prisma:push -- --accept-data-loss`
5. Re-test one live checkout and verify collect response flags:
  - `event_persisted: true`
  - `session_persisted: true`
  - `fallback_stored: false`

Safety note:

- `db:pc:dedupe` creates a full backup table named `platform_connections_backup_YYYYMMDD_HHMMSS` before deleting duplicates.

### Phase 1 data coverage verification (all layers)

Use this endpoint to validate field-by-field coverage against `datos-pixel.md`:

- `GET /api/analytics/:account_id/data-coverage?days=30`

Example:

- `GET /api/analytics/shogun.mx/data-coverage?days=30`

Response includes:

- `totals` (events/sessions/orders/identities/checkoutMaps)
- `layers` (Layer 1 to Layer 6 + critical stitch)
- `missing` (list of fields currently not covered in the selected window)

Interpretation rule:

- Task is complete for Phase 1 when `missing` is empty, except fields intentionally marked as not yet exposed canonically (for example `meta_impressions` if MCP/API normalization is pending).

### Latest measured coverage snapshot (staging, 2026-03-24)

Observed after deploy + live collect and Ads pull test:

- `POST /collect`: persisted correctly (`event_persisted=true`, `session_persisted=true`, `fallback_stored=false`).
- Coverage endpoint: stable and returning `success=true`.
- Layer 1, Layer 2, Layer 3, Layer 4, Layer 6, and critical stitch: operationally covered in current staging window.
- Meta pull executed successfully in staging worker (`collectMeta ok=true`, datasets stored and status ready).
- Google Ads pull executed successfully in staging worker (`collectGoogle ok=true`, datasets stored and status ready).
- `GET /api/mcpdata/meta/status` and `GET /api/mcpdata/google-ads/status` returned `ready=true` and `chunkCount>0`.
- Remaining item in coverage is API canonical exposure detail for `meta_impressions`; this does not block Layer 1 contractual acceptance because pull datasets are already present.

What this means:

- Core pixel/webhook/session/order identity infrastructure is complete for Phase 1 collection.
- Ads operational pull path is validated in staging for Meta and Google.
- Remaining hardening is implementation hygiene (for example, non-blocking root update conflict after chunk upsert) and API field normalization, not contractual Layer 1 scope gap.

### What is still required to collect 100% of datos-pixel.md

1. Enable/verify Meta Ads connector pull and persist campaign daily metrics.
2. Enable/verify Google Ads connector pull and persist campaign daily metrics.
3. Standardize one canonical storage path for `meta_impressions` and `meta_reported_conv_value` used by coverage API.
4. Run daily pull job at least once with non-empty campaign activity in the selected window.
5. Re-run coverage and confirm `missing` becomes empty.

### Layer 1 Foundation acceptance (payment checkpoint)

Scope used for acceptance is `layer1.md` (Custom Pixel + revenue truth + stitching base + Ads connections and basic pull), excluding explicit out-of-scope Phase 2 items.

Status summary (2026-03-24):

- Completed: Custom Pixel, collector, revenue truth, base stitching, onboarding/health observability.
- Completed: Ads pull operational evidence in staging (Meta + Google chunks created with `ready=true`).
- Out of scope by contract and therefore not required for this checkpoint: Phase 2 MCP server exposure, advanced dedup/scoring, server-side CAPI fanout parity.

Required evidence for Layer 1 payment checkpoint (fulfilled in staging):

1. Worker active for MCP pulls.
2. Meta account connected and selected for pilot user.
3. Google Ads account connected and selected for pilot user.
4. Pull executed with datasets/chunks created for both sources.
5. Status endpoints show `ready=true` and non-zero `chunkCount` for Meta and Google Ads.

Operational commands and endpoints:

- Trigger immediate pull for connected sources (authenticated):
  - `POST /api/mcpdata/collect-now`
  - Body example: `{ "sources": ["metaAds", "googleAds", "ga4"], "rangeDays": 60, "forceFull": true }`
- Validate source status:
  - `GET /api/mcpdata/meta/status`
  - `GET /api/mcpdata/google-ads/status`
  - `GET /api/mcpdata/ga4/status`
- Validate contractual Layer 1 coverage outcome:
  - `GET /api/analytics/:account_id/data-coverage?days=30`

Acceptance rule for Ads block (Layer 1):

- Pass when Meta and Google both show recent pull evidence (`chunkCount > 0`) and dashboard/status show connected + ready state.

### Delivery statement (ready to send)

Layer 1 Foundation was delivered according to the contracted scope in `layer1.md`.

Delivered:

1. Custom Pixel V1 capture and collector pipeline.
2. Revenue truth read-only sync and baseline health.
3. Session-checkout-order stitching base.
4. Pixel Health / Match Rate / onboarding validation flow.
5. Meta and Google Ads connection verification and basic pull execution with stored datasets.

Out of scope and not included in this acceptance (as stated in contract):

1. Phase 2 advanced dedup/reconciliation/scoring/backfill.
2. Full MCP server exposure for third-party AI consumers.
3. Full server-side events parity rollout (Meta CAPI, Google Enhanced Conversions, TikTok Events API).

Commercial checkpoint result:

- Layer 1 payment checkpoint: PASS (staging evidence available).

### Final test checklist (operator)

1. Send one live browser event and verify collect response persistence flags.
2. Trigger one purchase flow and verify order truth fields in coverage remain green.
3. Run Meta/Google daily pulls and verify non-zero platform metrics.
4. Verify `GET /api/analytics/:account_id/data-coverage?days=30` returns `missing: []`.

### Next implementation after plugin rollout

1. Introduce explicit session close policy (`session_end_at`) with inactivity timeout or checkout terminal event.
2. Add dedicated disputes integration for `chargeback_flag` instead of heuristic status/meta inference.

## Final Rule

Treat this `README.md` as the single source of truth for project status, roadmap, plugin behavior, Shopify embedded-app requirements, operational validation, and frontend workspace references.
