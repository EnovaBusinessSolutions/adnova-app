# 🧃 AdRay Pipeline — What Is This?

Imagine you have a lemonade stand. Every time someone walks by, looks at your lemonade, or buys a cup — you write it down in a notebook. That's what AdRay does for online stores!

When someone visits a Shopify store, AdRay watches what they do (looked at a product, added to cart, bought something). Then it figures out WHERE that person came from — did they click a Facebook ad? A Google ad? Did they just type the website?

Once someone buys lemonade (makes a purchase), AdRay tells Facebook and Google: "Hey! That ad you showed? It worked! Someone bought something!" This helps the store owner know which ads are actually making money.

That's it. Watch → Remember → Tell the ad companies.

---

# AdRay Pipeline — Implementation Plan

> **For AI copilots**: This document is the single source of truth. Follow steps in order. Each step lists exact file paths, what goes in them, and the patterns to follow. The codebase uses **CommonJS** (`require`/`module.exports`), **Express 5.1**, and existing MongoDB/Mongoose stays untouched — all new pipeline code uses **PostgreSQL via Prisma**.

---

## Architecture Summary

```
Browser Pixel → POST /collect → Prisma (Postgres) → events, sessions, identity_graph
                                                   ↘ checkout_session_map (on begin_checkout)

Shopify Webhook → POST /webhooks/shopify/:shop_id/orders-create
                    → orders table
                    → async: CAPI fanout (Meta, Google) + enrichment + snapshot
                    → all errors → failed_jobs table (never crash, always return 200)

Existing MongoDB ← untouched (User, Audit, MetaAccount, GoogleAccount, ShopConnections)
New PostgreSQL   ← all pipeline tables (shops, events, orders, sessions, identity_graph, etc.)
Redis            ← event dedup (24h TTL sets) + variant cache (1h TTL) + session cache
```

---

## Simplifications Applied

| Removed | Why |
|---------|-----|
| BullMQ worker process | Use in-process async (`setImmediate` + retry helper). One deployable. Add workers later if needed. |
| TikTok CAPI | Stub only. Meta + Google first. TikTok is identical pattern, add after core works. |
| Separate rate-limit Redis store | Use `express-rate-limit` with default memory store. Swap to Redis store when scaling. |
| Google CAPI full implementation | Stub with TODO. Google Enhanced Conversions requires developer token + complex auth. Meta CAPI is the priority. |
| MerchantSnapshot background job | Compute on webhook + on-demand API call. No scheduler needed. |

**Result: 14 files (10 new, 4 modified) instead of 22.**

---

## Environment Variables Required

Add these to `.env` and Render dashboard:

```
DATABASE_URL=postgresql://user:pass@host:5432/adray
REDIS_URL=redis://default:pass@host:6379
ENCRYPTION_KEY=<64-char hex string, generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
SHOPIFY_API_SECRET=<already exists, used for HMAC>
META_APP_ID=<from Meta Developer Portal>
META_APP_SECRET=<from Meta Developer Portal>
GOOGLE_CLIENT_ID=<already exists>
GOOGLE_CLIENT_SECRET=<already exists>
```

---

## File Map

```
backend/
  prisma/
    schema.prisma          ← NEW: all pipeline tables
  utils/
    prismaClient.js        ← NEW: singleton PrismaClient
    redisClient.js         ← NEW: singleton ioredis
    encryption.js          ← NEW: AES-256-GCM + SHA-256 hashing
  middleware/
    rateLimitCollect.js    ← NEW: 100 req/min per shop
  services/
    identityResolution.js  ← NEW: user_key resolution chain
    attributionStitching.js← NEW: last-touch attribution
    capiFanout.js          ← NEW: Meta CAPI + Google stub + retry
    merchantSnapshot.js    ← NEW: 30-day analytics snapshot
    shopifyEnrichment.js   ← NEW: variant enrichment w/ Redis cache
  routes/
    collect.js             ← NEW: POST /collect
    adrayWebhooks.js       ← NEW: orders-create, checkouts-create
    adrayPlatforms.js      ← NEW: pixel list, conversions, connections
  index.js                 ← MODIFY: mount routes, init Prisma
render.yaml                ← MODIFY: add prisma generate to build
package.json               ← MODIFY: add prisma, @prisma/client, express-rate-limit
ADRAY_PIPELINE.md          ← THIS FILE
```

---

## Step-by-Step Implementation

### STEP 1: Dependencies & Config

**File: `package.json`** — Add to `dependencies`:
```
"prisma": "^6.0.0",
"@prisma/client": "^6.0.0",
"express-rate-limit": "^7.0.0",
"cookie-parser": "^1.4.6"
```
Add to `scripts`:
```
"prisma:generate": "npx prisma generate --schema=backend/prisma/schema.prisma",
"prisma:migrate": "npx prisma migrate dev --schema=backend/prisma/schema.prisma",
"prisma:deploy": "npx prisma migrate deploy --schema=backend/prisma/schema.prisma"
```

**File: `render.yaml`** — Change `buildCommand` to:
```
npm install && npx prisma generate --schema=backend/prisma/schema.prisma
```

---

### STEP 2: Prisma Schema

**File: `backend/prisma/schema.prisma`** — CREATE

Datasource: `postgresql`, env `DATABASE_URL`.
Generator: `@prisma/client`.

**Tables** (all use `@id @default(uuid())` for `id` fields):

1. **`Shop`** — `id`, `shopId` (String @unique — Shopify domain), `shopDomain`, `accessToken`, `createdAt`, `updatedAt`

2. **`PlatformConnection`** — `id`, `shopId` (FK→Shop), `platform` (enum: META/GOOGLE/TIKTOK), `accessToken` (encrypted), `pixelId`, `adAccountId`, `status` (enum: ACTIVE/DISCONNECTED/ERROR), `createdAt`, `updatedAt`

3. **`IdentityGraph`** — `id`, `shopId` (FK→Shop), `userKey` (String), `customerId?`, `emailHash?`, `phoneHash?`, `fbp?`, `fbc?`, `fbclid?`, `gclid?`, `ttclid?`, `fingerprintHash?`, `confidenceScore` (Float), `firstSeenAt`, `lastSeenAt`, `deviceCount` (Int @default(1)). Index on `[shopId, userKey]`, index on `[shopId, fingerprintHash]`, index on `[shopId, customerId]`.

4. **`Session`** — `id`, `sessionId` (String @unique), `shopId` (FK→Shop), `userKey`, `utmSource?`, `utmMedium?`, `utmCampaign?`, `utmContent?`, `utmTerm?`, `referrer?`, `landingPageUrl?`, `fbclid?`, `gclid?`, `ttclid?`, `fbp?`, `fbc?`, `isFirstTouch` (Boolean), `startedAt`, `lastEventAt`

5. **`CheckoutSessionMap`** — `id`, `checkoutToken` (String @unique), `shopId` (FK→Shop), `sessionId`, `userKey`, `attributionSnapshot` (Json), `eventId` (String — pre-assigned UUID for purchase dedup), `createdAt`, `expiresAt` (30 days from creation)

6. **`Event`** — `id`, `eventId` (String @unique), `shopId` (FK→Shop), `sessionId`, `userKey`, `eventName` (String), `pageType?`, `pageUrl?`, `productId?`, `variantId?`, `cartId?`, `cartValue?` (Float), `checkoutToken?`, `orderId?`, `revenue?` (Float), `currency?`, `items?` (Json), `rawPayload` (Json), `browserReceivedAt?`, `serverReceivedAt`, `createdAt`

7. **`Order`** — `id`, `orderId` (String @unique), `orderNumber`, `shopId` (FK→Shop), `checkoutToken?`, `userKey?`, `sessionId?`, `customerId?`, `emailHash?`, `phoneHash?`, `revenue` (Float), `subtotal` (Float), `discountTotal` (Float), `shippingTotal` (Float), `taxTotal` (Float), `currency`, `lineItems` (Json), `attributedChannel?`, `attributedCampaign?`, `attributedAdset?`, `attributedAd?`, `attributedClickId?`, `attributionModel` (String @default("last_touch")), `attributionSnapshot?` (Json), `confidenceScore?` (Float), `eventId?`, `capiSentMeta` (Boolean @default(false)), `capiSentGoogle` (Boolean @default(false)), `capiSentTiktok` (Boolean @default(false)), `capiMetaResponse?` (Json), `capiGoogleResponse?` (Json), `createdAt`, `shopifyCreatedAt`

8. **`EventDedup`** — `eventId` (String @id), `shopId`, `orderId?`, `eventName`, `browserReceivedAt?`, `serverReceivedAt?`, `capiSentAt?`, `dedupStatus` (enum: SINGLE/BROWSER_ONLY/SERVER_ONLY/DEDUPLICATED)

9. **`MerchantSnapshot`** — `id`, `shopId` (FK→Shop, @unique), `snapshot` (Json), `updatedAt`

10. **`FailedJob`** — `id`, `jobType` (String), `payload` (Json), `error` (String), `attempts` (Int @default(0)), `maxAttempts` (Int @default(3)), `nextRetryAt?`, `resolvedAt?`, `createdAt`

**Enums**: `Platform`, `ConnectionStatus`, `DedupStatus`

---

### STEP 3: Utility Modules

**File: `backend/utils/prismaClient.js`** — CREATE
- `const { PrismaClient } = require('@prisma/client')`
- Singleton pattern: store on `global.__prisma` in dev to survive hot-reload
- Export single instance
- `process.on('beforeExit', () => prisma.$disconnect())`

**File: `backend/utils/redisClient.js`** — CREATE
- `const Redis = require('ioredis')` (already installed v5.6.1)
- `new Redis(process.env.REDIS_URL)` with `maxRetriesPerRequest: 3`, `lazyConnect: true`
- Export singleton
- Log connection errors, don't crash (Redis is enhancement, not critical path)

**File: `backend/utils/encryption.js`** — CREATE
- `encrypt(text)` → AES-256-GCM with `ENCRYPTION_KEY` (first 32 bytes as key). Returns `iv:authTag:ciphertext` (all hex). IV is `crypto.randomBytes(16)`.
- `decrypt(packed)` → split on `:`, decipher with same key
- `hashPII(value)` → `crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex')`. Returns hex string. Returns null if input is falsy.
- `hashFingerprint(userAgent, ip, timezone, language)` → SHA-256 of concatenated values
- All functions are synchronous, no async needed

---

### STEP 4: Middleware

**File: `backend/middleware/rateLimitCollect.js`** — CREATE
- `const rateLimit = require('express-rate-limit')`
- Export middleware: `windowMs: 60_000`, `max: 100`, `keyGenerator: (req) => req.body?.shop_id || req.ip`
- `standardHeaders: true`, `legacyHeaders: false`
- Response on limit: `{ success: false, error: 'Rate limit exceeded' }`

---

### STEP 5: Services (build in this order)

#### 5A: `backend/services/identityResolution.js` — CREATE

```
Dependencies: prismaClient, encryption (hashFingerprint, hashPII), redisClient
```

**`resolveUserKey(shopId, cookieUserKey, payload, res)`**
1. If `cookieUserKey` exists → query `IdentityGraph` where `shopId + userKey = cookieUserKey`. If found → update `lastSeenAt`, merge any new identifiers from payload, return `userKey`.
2. If `payload.fbclid || payload.gclid || payload.ttclid` → create new `userKey` (uuid), store click ID mapping in `IdentityGraph`, confidence `1.0`.
3. If `payload.customer_id` → query `IdentityGraph` where `shopId + customerId`. If found → return existing `userKey`.
4. Compute `fingerprintHash` from `payload.user_agent + payload.ip + payload.timezone + payload.language`. Query `IdentityGraph` where `shopId + fingerprintHash`. If found → return `userKey`, confidence `0.6`.
5. Else → create new `userKey` (uuid), store fingerprint, confidence `0.6`.
6. Always: set cookie `_adray_uid` on `res` — `httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 63072000000` (2 years in ms), `path: '/'`.
7. Return `{ userKey, isNew, confidenceScore }`.

**`mergeIdentifiers(existing, payload)`** — helper. Upserts new fields (emailHash, phoneHash, fbp, fbc, click IDs) into existing IdentityGraph record without overwriting non-null values.

#### 5B: `backend/services/attributionStitching.js` — CREATE

**`stitchAttribution(order, checkoutMap)`**
1. `checkoutMap` is the `CheckoutSessionMap` record (may be null).
2. If null → return `{ channel: 'unattributed', confidence: 0.0 }`.
3. Extract from `checkoutMap.attributionSnapshot`:
   - `fbclid` → `{ channel: 'paid_social', platform: 'facebook', confidence: 1.0 }`
   - `gclid` → `{ channel: 'paid_search', platform: 'google', confidence: 1.0 }`
   - `ttclid` → `{ channel: 'paid_social', platform: 'tiktok', confidence: 1.0 }`
   - `utm_source` exists → `{ channel: utm_medium || 'referral', platform: utm_source, confidence: 0.85 }`
   - `referrer` exists → classify domain: google/bing→organic_search, facebook/instagram→organic_social, else→referral. Confidence `0.7`.
   - None → `{ channel: 'direct', confidence: 0.5 }`
4. Update `order` record with attributed fields.
5. Return attribution object.

#### 5C: `backend/services/capiFanout.js` — CREATE

**`withRetry(fn, attempts = 3, delays = [1000, 5000, 30000])`** — generic retry helper with exponential backoff. On final failure, write to `FailedJob` table.

**`sendToAllPlatforms(orderId)`**
1. Fetch order from DB with full fields.
2. `Promise.allSettled([sendToMeta(order), sendToGoogle(order)])`.
3. Log results. Never throws.

**`sendToMeta(order)`**
1. Query `PlatformConnection` where `shopId + platform = META + status = ACTIVE`. If none → return skip.
2. Decrypt `accessToken`.
3. Build payload per Meta CAPI spec:
   - `event_name: 'Purchase'`
   - `event_id: order.eventId` (for browser dedup)
   - `event_time: Math.floor(order.shopifyCreatedAt / 1000)`
   - `action_source: 'website'`
   - `user_data: { em: [emailHash], ph: [phoneHash], fbp, fbc }`
   - `custom_data: { value: order.revenue, currency: order.currency, order_id: order.orderId, contents: mapped lineItems }`
4. `POST https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${token}` via axios.
5. Update order: `capiSentMeta = true`, `capiMetaResponse = response.data`.
6. Update `EventDedup` if exists.
7. Wrapped in `withRetry`.

**`sendToGoogle(order)`** — STUB. Log `"Google CAPI not yet implemented"`. Set `capiSentGoogle = false`. TODO for phase 2.

#### 5D: `backend/services/shopifyEnrichment.js` — CREATE

**`enrichOrderLineItems(lineItems, shopId)`**
1. Get shop's Shopify access token from `ShopConnections` model (existing Mongoose model) or from pipeline `Shop` table.
2. For each item with `variant_id`:
   - Check Redis: `adray:variant:${shopId}:${variantId}`. If cached → use it.
   - Else: GET `https://${shop}/admin/api/2024-07/variants/${variantId}.json` with access token.
   - Cache result in Redis with 3600s TTL.
3. Return enriched array with `title, image_url, vendor, product_type, tags`.
4. Errors are non-fatal — return original item if enrichment fails.

#### 5E: `backend/services/merchantSnapshot.js` — CREATE

**`updateSnapshot(shopId)`**
1. Query `Order` table: last 30 days, `WHERE shopId = X`.
2. Compute: `totalRevenue, orderCount, aov, revenueByChannel` (group by `attributedChannel`), `unattributedCount`, `unattributedRate`.
3. Query `Event` table: last 30 days funnel — count by `eventName` (page_view → view_item → add_to_cart → begin_checkout → purchase).
4. Compute `attributionConfidenceDistribution` — group orders by confidence buckets.
5. Top 10 products by revenue from `lineItems` JSON aggregation.
6. Upsert `MerchantSnapshot` record with full JSON.
7. Return snapshot object.

---

### STEP 6: Routes

#### 6A: `backend/routes/collect.js` — CREATE

`POST /collect`
1. Validate: `req.body.shop_id` required, else 400.
2. Verify shop exists in `Shop` table (query or create from `ShopConnections`).
3. Read cookie `_adray_uid` from `req.cookies`.
4. Call `identityResolution.resolveUserKey(shopId, cookieUserKey, req.body, res)`.
5. Generate `eventId = crypto.randomUUID()`.
6. Dedup check: `redis.set('adray:ev:' + eventId, '1', 'EX', 86400, 'NX')`. If returns null (already exists) → return `{ success: true, event_id: eventId, user_key: userKey, deduplicated: true }`.
7. Parse event data from body: `event_name, page_url, page_type, product_id, variant_id, cart_id, cart_value, checkout_token, items`.
8. If `event_name === 'begin_checkout'` AND `checkout_token` exists:
   - Build `attributionSnapshot` from current session (UTMs + click IDs).
   - Create `CheckoutSessionMap` record with pre-assigned `eventId` for future purchase dedup.
9. Write `Event` record to DB.
10. Upsert `Session` record: create if `session_id` doesn't exist, else update `lastEventAt` and merge UTMs.
11. Return `{ success: true, event_id: eventId, user_key: userKey }`.

Middleware chain: `rateLimitCollect` → `express.json()` (already global) → handler.

#### 6B: `backend/routes/adrayWebhooks.js` — CREATE

Uses existing `verifyShopifyWebhookHmac` from `backend/middleware/verifyShopifyWebhookHmac.js`. Body is raw Buffer (mounted with `express.raw` in index.js).

**`POST /webhooks/shopify/:shop_id/orders-create`**
1. Parse raw body to JSON: `JSON.parse(req.body.toString())`.
2. Idempotency: query `Order` where `orderId = payload.id`. If exists → return 200.
3. Query `CheckoutSessionMap` where `checkoutToken = payload.checkout_token`.
4. If found → extract `sessionId, userKey, attributionSnapshot, eventId`.
5. If not found → set `userKey = null, sessionId = null`, flag unattributed.
6. Hash email/phone with `hashPII`.
7. Build & insert `Order` record with all financial fields + line items.
8. Fire async (non-blocking, `setImmediate`):
   - `attributionStitching.stitchAttribution(order, checkoutMap)`
   - `shopifyEnrichment.enrichOrderLineItems(lineItems, shopId)` → update order
   - `capiFanout.sendToAllPlatforms(order.id)`
   - `merchantSnapshot.updateSnapshot(shopId)`
9. Wrap entire handler in try/catch. On error → log + write to `FailedJob`. Always return 200.

**`POST /webhooks/shopify/:shop_id/checkouts-create`**
1. Parse raw body.
2. Extract `checkout_token`.
3. Upsert `CheckoutSessionMap` if not exists (set `expiresAt` to now + 30 days).
4. Return 200.

#### 6C: `backend/routes/adrayPlatforms.js` — CREATE

All routes require `sessionGuard` (existing middleware).

**`GET /api/pixels/:shop_id/meta`**
1. Get `MetaAccount` from Mongoose (existing model) OR `PlatformConnection` from Prisma.
2. Call `GET https://graph.facebook.com/v18.0/me/adspixels?fields=id,name,last_fired_time&access_token=${token}`.
3. Return pixel list.

**`GET /api/conversions/:shop_id/google`**
1. Get Google access token (existing `GoogleAccount` model).
2. Call Google Ads API to list conversion actions.
3. Filter to `type === 'WEBPAGE'`.
4. Return list.

**`POST /api/connections/:shop_id`**
1. Body: `{ platform, accessToken, pixelId, adAccountId }`.
2. Encrypt `accessToken`.
3. Upsert `PlatformConnection` record.
4. Optional: send test event to verify.
5. Return `{ status: 'ACTIVE' }`.

---

### STEP 7: Mount in index.js

**File: `backend/index.js`** — MODIFY

**Near the top (imports section ~L1-L80):**
```
const collectRoutes = require('./routes/collect');
const adrayWebhookRoutes = require('./routes/adrayWebhooks');
const adrayPlatformRoutes = require('./routes/adrayPlatforms');
const rateLimitCollect = require('./middleware/rateLimitCollect');
const prisma = require('./utils/prismaClient');
const cookieParser = require('cookie-parser');
```
Wrap in try/catch like existing imports if applicable.

**Between L285 and L295 (BEFORE express.json):**
```
app.use("/webhooks/shopify", express.raw({ type: "*/*" }), adrayWebhookRoutes);
```

**Near L621-L656 (alongside other API routes):**
```
app.use(cookieParser());
app.use("/collect", rateLimitCollect, collectRoutes);
app.use("/api", sessionGuard, adrayPlatformRoutes);
```

**Near L309 (after mongoose.connect):**
```
prisma.$connect().then(() => console.log('✅ Prisma connected')).catch(e => console.error('❌ Prisma connection error:', e));
```

---

### STEP 8: Cookie Parsing

Check if `cookie-parser` is already installed. If not, add `cookie-parser` to dependencies and mount `app.use(require('cookie-parser')())` near other middleware. The `/collect` route needs `req.cookies._adray_uid`.

---

## Implementation Order (strict)

| # | What | Depends On | Test |
|---|------|-----------|------|
| 1 | `package.json` + `render.yaml` changes | nothing | `npm install` succeeds |
| 2 | `backend/prisma/schema.prisma` | step 1 | `npx prisma migrate dev` creates tables |
| 3 | `backend/utils/prismaClient.js` | step 2 | `node -e "require('./backend/utils/prismaClient')"` |
| 4 | `backend/utils/redisClient.js` | nothing | connection log on import |
| 5 | `backend/utils/encryption.js` | nothing | `encrypt('test')` → `decrypt(result)` === `'test'` |
| 6 | `backend/middleware/rateLimitCollect.js` | nothing | unit test |
| 7 | `backend/services/identityResolution.js` | steps 3,4,5 | mock test with fake payload |
| 8 | `backend/services/attributionStitching.js` | step 3 | unit test with mock checkout map |
| 9 | `backend/services/capiFanout.js` | steps 3,5 | mock test (skip real API calls) |
| 10 | `backend/services/shopifyEnrichment.js` | steps 3,4 | mock test |
| 11 | `backend/services/merchantSnapshot.js` | step 3 | mock test with sample orders |
| 12 | `backend/routes/collect.js` | steps 6,7 | `curl -X POST /collect` with payload |
| 13 | `backend/routes/adrayWebhooks.js` | steps 8,9,10,11 | simulate webhook with HMAC |
| 14 | `backend/routes/adrayPlatforms.js` | steps 3,5 | `curl GET /api/pixels/:id/meta` |
| 15 | `backend/index.js` modifications | steps 12,13,14 | server starts, routes respond |
| 16 | `cookie-parser` check | step 15 | - |

---

## Critical Rules for Implementation

1. **CommonJS only** — `require()` / `module.exports`. No `import/export`.
2. **Webhooks MUST return 200** — wrap handler body in try/catch, catch logs to `FailedJob`, always `res.status(200).send('OK')`.
3. **Never log PII** — use `hashPII()` before any `console.log` touching email/phone.
4. **Raw body BEFORE json parser** — webhook route mount MUST be between L285–L295 of index.js.
5. **Async fire-and-forget pattern** — use `setImmediate(() => { fn().catch(e => logToFailedJob(e)) })` for post-webhook processing.
6. **Cookie name** — `_adray_uid` exactly. httpOnly, Secure, SameSite=Lax, maxAge=63072000000.
7. **UUIDs** — use `crypto.randomUUID()` for all ID generation (built-in Node 18+).
8. **Prisma field naming** — use camelCase in schema (Prisma convention), map to snake_case DB columns with `@map`.
9. **Error → FailedJob** — any processing error writes `{ jobType, payload, error: e.message }` to `FailedJob` table for manual retry.
10. **No new npm scripts for workers** — all async work runs in-process via `setImmediate`. BullMQ upgrade is phase 2.

---

## Progress Tracker

- [x] Step 1: Dependencies
- [x] Step 2: Prisma schema
- [x] Step 3: Prisma client
- [x] Step 4: Redis client
- [x] Step 5: Encryption utils
- [x] Step 6: Rate limiter
- [x] Step 7: IdentityResolution service
- [ ] Step 8: AttributionStitching service
- [ ] Step 9: CAPIFanout service
- [ ] Step 10: ShopifyEnrichment service
- [ ] Step 11: MerchantSnapshot service
- [x] Step 12: /collect route
- [ ] Step 13: Webhook routes
- [ ] Step 14: Platform API routes
- [x] Step 15: Mount in index.js
- [x] Step 16: Cookie parser check
- [ ] Integration test: full flow
