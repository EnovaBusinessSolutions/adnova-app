# AdRay Pipeline (Single Source of Truth)

This document replaces previous planning files and keeps only what is essential.

## Goal
Build and run a platform-agnostic attribution pipeline (Shopify + WooCommerce + custom sites) that:
- captures browser events,
- stitches attribution,
- processes purchase events server-side,
- and exposes clean dashboard metrics.

## Current Status
- Universal pixel is live and loadable cross-origin from AdRay server.
- Pixel load on merchant site returns `200 OK`.
- Browser events are reaching `POST /collect`, but current production responses show `500 Internal Server Error`.
- Account-based model is active (`accountId`), with Shopify backward compatibility.

## Active Incident: `/collect` Returns 500
Observed behavior:
- `adray-pixel.js` loads correctly (`200`).
- Browser sends `POST /collect` from merchant site.
- Backend returns `500`.

Most likely root causes (priority order):
1. Database schema mismatch in production (app code uses `account*` fields but DB still has `shop*` shape).
2. Missing/incorrect production env vars (`DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`).
3. Runtime DB connectivity or Prisma migration drift.
4. Invalid payload fields causing server-side parsing/write failure.

Immediate containment:
- Keep pixel loaded to validate traffic flow, but treat data as non-persistent until `/collect` is green.
- Do not begin attribution analysis until `/collect` has stable `2xx`.

## Core Architecture
- Browser Pixel -> `POST /collect` -> PostgreSQL (Prisma)
- Checkout map -> attribution snapshot at checkout time
- Purchase webhook -> orders table -> async pipeline
- Async pipeline:
  - attribution stitching,
  - order enrichment,
  - CAPI fanout,
  - merchant snapshot update

## Canonical Data Model (Essential)
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

## Critical Endpoints
- `POST /collect`
- `POST /webhooks/shopify/orders-create`
- `POST /webhooks/shopify/checkouts-create`
- `GET /api/pixels/:account_id/meta`
- `GET /api/conversions/:account_id/google`
- `POST /api/connections/:account_id`

## Pixel Installation (Merchant)
Use this snippet in merchant `<head>`:

```html
<script src="https://adray-app-staging-german.onrender.com/adray-pixel.js"
        data-account-id="merchant-domain-or-acct-id"></script>
```

Notes:
- `data-account-id` must be plain value (no `https://`, no trailing slash).
- Initial event `page_view` should hit `/collect` without any cart action.

## Required Environment Variables
- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_KEY`
- `SHOPIFY_API_SECRET`
- `META_APP_ID`
- `META_APP_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## What Is Working Now
- Universal pixel loading and event collection.
- Identity cookie `_adray_uid` handling.
- Event/session/checkouts persistence.
- Shopify webhook ingestion for orders/checkouts.
- Async pipeline orchestration and failed job logging.

## Open Gaps (High Priority)
1. WooCommerce purchase webhook route (server-side order ingestion).
2. Full Meta CAPI send implementation (currently partial/stubbed behavior in current stack).
3. Add missing browser fields consistently (`utm_content`, `utm_term`, `landing_page_url`, explicit `view_item`).
4. Ensure `req.ip` is passed for fingerprint confidence quality.

## Next Steps (Execution Order)
1. Resolve `/collect` 500 in production (P0).
2. Implement `POST /webhooks/woocommerce/:account_id/orders-create` with signature validation.
3. Map Woo order payload -> `Order` model and run same async pipeline used by Shopify.
4. Complete Meta CAPI production payload + response persistence + dedup updates.
5. Expand pixel payload coverage (`utm_content`, `utm_term`, `landing_page_url`, `view_item`).
6. Run end-to-end QA (page_view -> add_to_cart -> begin_checkout -> purchase -> dashboard).

## `/collect` 500 Resolution Plan (P0)
Step 1. Capture exact backend error from production logs.
- Trigger one `/collect` event from browser.
- Copy stack trace and failing line/module.

Step 2. Validate Prisma schema state in production.
- Confirm deployed Prisma client matches current `backend/prisma/schema.prisma`.
- Run migration status and apply pending migrations.

Step 3. Validate production env variables.
- Verify `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY` are set and valid.
- Restart service after env verification.

Step 4. Run a direct health test for `/collect`.
- Send minimal payload with `account_id` + `event_name` + `page_url`.
- Confirm `200` and persisted row in `events` table.

Step 5. Re-test from WooCommerce site.
- Confirm `page_view` and `add_to_cart` produce `2xx`.
- Confirm no new `500` in logs.

Step 6. Close incident and continue roadmap.
- Mark `/collect` stable after 30+ min without errors under normal traffic.

## Purchase Test Protocol (Now)
1. Open merchant site and verify `POST /collect` events in Network.
2. Add product to cart and verify `add_to_cart`.
3. Start checkout and verify `begin_checkout`.
4. Complete a purchase.
5. Verify webhook receipt and order processing logs.
6. Confirm dashboard updates (events first, then attributed order/revenue).

## Definition of Done
- Purchase from WooCommerce appears as attributed order in dashboard.
- Meta CAPI event is sent successfully with `event_id` dedup.
- Snapshot reflects latest revenue/channel metrics.
- No critical errors in `FailedJob` for purchase path.
