# AdRay / Adnova - Master README (Single Source of Truth)

Last update: 2026-03-11

This file centralizes the current real status of the project based on code + docs.
It replaces fragmented planning as the practical source of truth for what exists now and what is still missing.

## 1) Product Goal
Build a platform-agnostic attribution pipeline (Shopify + WooCommerce + custom sites) that:
- receives browser events,
- stitches attribution,
- ingests purchases server-side,
- and exposes reliable dashboard metrics.

## 2) Current Architecture (as implemented)
- Main app: Node.js + Express in `backend/index.js`
- Databases:
  - PostgreSQL via Prisma (pipeline entities: accounts, events, orders, snapshots, etc.)
  - MongoDB via Mongoose (auth/users/integrations legacy + operational modules)
- Redis via ioredis (dedup/cache/queue optional optimization)
- WordPress plugin for WooCommerce: `wordpress-plugin/adnova-pixel/adnova-pixel.php`
- Deployment baseline: Render (`render.yaml`)

## 3) What is already implemented

### 3.1 Event collection pipeline
- Universal collector route:
  - `POST /collect` (mounted in `backend/index.js`)
- `collect` flow includes:
  - account auto-provision (Prisma `Account` upsert)
  - identity resolution + cookie `_adray_uid`
  - event write to Prisma `Event`
  - session upsert in Prisma `Session`
  - begin_checkout -> checkout map upsert in `CheckoutSessionMap`
  - Redis dedup best-effort
- Rate limit exists for collect:
  - 100 req/min key by `shop_id` or IP (`backend/middleware/rateLimitCollect.js`)

### 3.2 Shopify webhooks pipeline
- Raw webhook mount for HMAC-safe body:
  - `app.use("/webhooks/shopify", express.raw(...), adrayWebhookRoutes)`
- HMAC verification middleware implemented:
  - `backend/middleware/verifyShopifyWebhookHmac.js`
- Shopify routes implemented:
  - `POST /webhooks/shopify/orders-create`
  - `POST /webhooks/shopify/checkouts-create`
- Orders-create processing includes:
  - idempotency check on `order_id`
  - checkout-token lookup
  - PII hashing
  - order insert in Prisma `Order`
  - async post-order pipeline:
    - attribution stitching
    - Shopify enrichment
    - CAPI fanout
    - merchant snapshot update
    - failed job logging

### 3.3 WooCommerce pipeline (plugin + backend sync)
- WordPress plugin auto-injects pixel in frontend with domain-based account_id
- Woo purchase capture implemented with multiple fallbacks:
  - thank-you hook
  - payment/status server hooks
  - footer fallback for custom flows
  - browser-side data injection fallback
- Plugin sends:
  - `purchase` to `/collect` (server-side backup)
  - direct order sync to backend `POST /api/woo/orders-sync`
- Backend route `POST /api/woo/orders-sync` implemented and upserts `Order`

### 3.4 Attribution + snapshot services
- Identity resolution service exists (`backend/services/identityResolution.js`)
- Attribution stitching service exists (`backend/services/attributionStitching.js`)
- Merchant snapshot service exists (`backend/services/merchantSnapshot.js`)
  - calculates 30-day revenue, channel breakdown, funnel, confidence, top products, pixel health

### 3.5 Platform integration endpoints
- API routes exist for:
  - `GET /api/pixels/:account_id/meta`
  - `GET /api/conversions/:account_id/google`
  - `POST /api/connections/:account_id`
- Additional pixel selection/status APIs exist under `/api/pixels/*`

### 3.6 Prisma schema (account model migration applied in code)
- Canonical Prisma models present:
  - `Account`, `PlatformConnection`, `IdentityGraph`, `Session`, `CheckoutSessionMap`, `Event`, `Order`, `EventDedup`, `MerchantSnapshot`, `FailedJob`
- Current code uses `account_id` model (with some legacy `shop_id` fallback in collector payload)

## 4) Main gaps and risks (real current status)

### P0 - Production stability risk on /collect
- Known incident from docs: `/collect` returning 500 in production
- Most likely causes still valid:
  - Prisma schema drift in prod
  - missing env vars (`DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`)
  - runtime DB connectivity issues
  - payload shape mismatch

### P0 - Data model consistency risk
- The codebase is hybrid (Prisma + Mongo) and still partially transitional.
- Some modules use Prisma account_id model while other integrations still depend on Mongo user/account records.
- This can cause partial success in one subsystem and failure in another.

### P1 - CAPI completeness gap
- `sendToMeta` is currently placeholder in `backend/services/capiFanout.js`
- Google conversion sending path exists but depends on Mongo integration data + token quality.
- Full multi-platform robust CAPI parity is not yet complete.

### P1 - Google conversions listing gap
- `GET /api/conversions/:account_id/google` currently returns stub/empty response path in `adrayPlatforms.js`.

### P1 - Rate limit key mismatch
- Collector supports `account_id`, but rate-limit key currently prioritizes `shop_id` then IP.
- This may reduce per-account protection accuracy for non-Shopify traffic.

### P1 - Security hardening gap
- `ENCRYPTION_KEY` fallback currently generates random key if missing (safe for dev only, dangerous in prod because decryption continuity is lost on restart).

### P2 - Endpoint naming/version consistency
- Some docs reference paths like `/webhooks/shopify/orders-create` and `/webhooks/shopify/checkouts-create` (implemented), while older docs still mention parameterized variants.
- Need one canonical endpoint contract document to avoid confusion.

## 5) Environment variables (effective set)

### Core pipeline
- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_KEY`
- `SHOPIFY_API_SECRET` (or `SHOPIFY_API_SECRET_2` for webhook HMAC)

### Integrations and platform
- `META_APP_ID`
- `META_APP_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN` (for full Google Ads/CAPI flows)

### Runtime and app infra
- `MONGO_URI`
- `SESSION_SECRET`
- `APP_URL`
- Render/runtime specific values as needed

## 6) Confirmed endpoint inventory (pipeline relevant)
- `POST /collect`
- `POST /webhooks/shopify/orders-create`
- `POST /webhooks/shopify/checkouts-create`
- `POST /api/woo/orders-sync`
- `GET /api/pixels/:account_id/meta`
- `GET /api/conversions/:account_id/google`
- `POST /api/connections/:account_id`
- `GET /wp-plugin/adnova-pixel/update.json`
- `GET /wp-plugin/adnova-pixel/download`

## 7) Priority execution plan (recommended)

### Phase 1 - Stabilize ingestion (P0)
1. Fix `/collect` 500 in production first (logs + schema + env validation).
2. Verify Prisma migration status in production.
3. Send minimal synthetic collect payload and verify persistence in `events`.
4. Re-run end-to-end Woo flow from page_view -> purchase.

### Phase 2 - Close attribution/CAPI critical gaps (P1)
1. Implement real Meta CAPI in `sendToMeta`.
2. Replace Google conversions listing stub with real Google Ads API retrieval.
3. Align rate limiter key to `account_id` first (keep `shop_id` legacy fallback).
4. Remove random `ENCRYPTION_KEY` fallback behavior for production safety.

### Phase 3 - Consolidate hybrid data layer (P1/P2)
1. Define source-of-truth boundary between Prisma and Mongo for each domain.
2. Migrate integration/token lookups to one canonical pattern (prefer explicit adapter layer).
3. Add health checks that fail fast when required envs are missing.

### Phase 4 - Documentation + QA hardening (P2)
1. Keep this README as primary source and mark old planning docs as historical.
2. Add explicit runbook for incidents (`/collect`, webhook auth, snapshot lag).
3. Add integration tests for collector/webhooks/order sync/idempotency.

## 8) Definition of done for this pipeline stage
- `/collect` stable (no 500 under normal traffic window).
- Purchase from WooCommerce and Shopify persists in `orders` with attribution fields populated.
- Merchant snapshot updates without failed-job criticals.
- Meta + Google connection flows return real selectable resources (no stubs).
- CAPI fanout works with durable logging and retry policy.

## 9) Notes on previous docs
Historical files still useful for context:
- `ADRAY_PIPELINE.md`
- `ADRAY-PIXEL.md`
- `Adray-Cotizacion.md`

From now on, this `README.md` should be treated as the master operational status file.

Operational checklist for live validation:
- `docs/PIPELINE_COMPLETENESS_CHECKLIST.md`
