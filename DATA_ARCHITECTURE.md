# Data Architecture

How Adray stores pixel/session/order data across Postgres (Neon), MongoDB, Cloudflare R2, and Redis. Read this before touching anything downstream of `/collect` or the dashboard analytics.

**Canonical rule:** Postgres (via Prisma) is the source of truth for everything in the attribution pipeline. MongoDB is auth/OAuth/MCP-cache only. R2 is temp storage for raw rrweb. Redis is queue + ephemeral state.

---

## 1. Stack at a glance

| Store | Hosted where | Access | What lives here |
|---|---|---|---|
| **PostgreSQL** | Neon Serverless | Prisma (`backend/prisma/schema.prisma`) | Accounts, sessions, events, orders, identity, recordings, session packets |
| **MongoDB** | Atlas | Mongoose (`backend/models/`) | User auth, OAuth tokens, platform connection metadata, MCP snapshots |
| **R2** | Cloudflare | `backend/utils/r2Client.js` | rrweb event chunks, final assembled rrweb streams (TTL 24h) |
| **Redis** | Upstash | `backend/utils/redisClient.js` + BullMQ | Queues (recordings, MCP), short-lived caches (insights, rate limits) |

Connection strings: `DATABASE_URL` (Postgres/Neon), `MONGO_URI`, `REDIS_URL`, R2 env vars (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`).

---

## 2. Postgres tables (canonical pipeline)

All tables in [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma). Prefix `map` names are the actual Postgres table names; Prisma model names are camelCase.

### 2.1 `accounts` — the merchant

One row per merchant (shop/domain). Everything else cascades from here.

Key fields: `accountId` (unique), `domain`, `platform` (`SHOPIFY | WOOCOMMERCE | MAGENTO | CUSTOM | OTHER`), `accessToken`.

FK target for 11 downstream tables.

### 2.2 `sessions` — visitor session

Created by the pixel on first `/collect` hit and updated on every subsequent event.

Key fields: `sessionId` (unique), `accountId`, `userKey`, UTM fields, click IDs (`fbclid`/`gclid`/`ttclid`), cookies (`fbp`/`fbc`), `landingPageUrl`, `isFirstTouch`, `startedAt`, `lastEventAt`, `rrwebRecordingId` (points to the active recording), `clarityPlaybackUrl` (legacy).

Unit: **one visit**. Multiple sessions per user over time.

### 2.3 `events` — every pixel event

Every `sendEvent` from the pixel (`page_view`, `product_view`, `add_to_cart`, `begin_checkout`, `purchase`, `form_submit`, etc.) lands here.

Key fields: `eventId` (unique — used for dedup with CAPI), `sessionId`, `userKey`, `eventName`, `pageType`, `pageUrl`, `productId`, `variantId`, `cartId`, `cartValue`, `checkoutToken`, `orderId`, `revenue`, `items Json`, `rawPayload Json`, `collectedAt`, `browserReceivedAt`, `serverReceivedAt`.

Write rate: ~10–50 events per session. Read rate: moderate (dashboard analytics, attribution stitching).

### 2.4 `orders` — completed purchases

Created/updated by Shopify/Woo webhooks.

Key fields: `orderId` (unique), `orderNumber`, `accountId`, `checkoutToken` (for stitching), `userKey`, `sessionId`, `customerId`, `emailHash`, `phoneHash`, `revenue`, `subtotal`, `discountTotal`, `shippingTotal`, `taxTotal`, `currency`, `lineItems Json`, `attributedChannel`, `attributedCampaign`, `attributionSnapshot Json`, `confidenceScore`, `capiSentMeta/Google/Tiktok`, `platformCreatedAt`.

`attributionSnapshot` is the frozen context at checkout time (UTMs, click IDs, **customer_name and other PII-friendly fields** the pixel captured). This is what `/recording/packets/list` reads for customer identity enrichment.

### 2.5 `identity_graph` — visitor→customer linking

One row per unique `userKey` per `accountId`.

Key fields: `userKey`, `customerId`, `emailHash`, `phoneHash`, `ipHash`, `fbp`/`fbc`/`fbclid`/`gclid`/`ttclid`, `fingerprintHash`, `confidenceScore`, `firstSeenAt`, `lastSeenAt`, `deviceCount`.

Resolution chain (strongest → weakest):
`click ID (1.0) → customerId (0.85) → emailHash (0.7) → fingerprint (0.6) → anonymous`

### 2.6 `checkout_session_map` — the attribution bridge

Written when `begin_checkout` or `purchase` fires. Key: `checkoutToken`. Holds the `sessionId`, `userKey`, `attributionSnapshot Json`, `eventId`, `expiresAt`.

This is the **critical table** for attribution. When an order webhook lands, we look up the `checkoutToken` here to get the session context. Without this, the order is unattributed.

### 2.7 `event_dedup` — CAPI dedup

`eventId` (PK), `accountId`, `orderId`, `eventName`, `browserReceivedAt`, `serverReceivedAt`, `capiSentAt`, `dedupStatus` (`SINGLE | BROWSER_ONLY | SERVER_ONLY | DEDUPLICATED`).

Used by `capiFanout.js` to avoid sending duplicate conversion events to Meta/Google.

### 2.8 `session_recordings` — rrweb metadata

Each row is one rrweb recording session. Physical stream lives in R2; this table has the pointer + state.

Key fields: `recordingId` (unique), `accountId`, `sessionId`, `userKey`, `triggerEvent` (`page_load` | `add_to_cart` | `begin_checkout`), `triggerAt`, `cartValue`, `checkoutToken`, `attributionSnapshot Json`, `r2Key`, `r2ChunksPrefix`, `r2Bucket`, `durationMs`, `chunkCount`, `lastChunkAt`, `sizeBytes`, `status` (`RECORDING | FINALIZING | READY | ERROR`), `outcome` (`PURCHASED | ABANDONED | STILL_BROWSING`), `outcomeAt`, `orderId`, `deviceType`, `behavioralSignals Json`, `rawErasedAt`.

Lifecycle: RECORDING → FINALIZING (on purchase or 5min inactivity) → READY (chunks assembled in R2) → raw erased at 24h.

### 2.9 `session_packets` — **Phase 4, the new artifact**

The permanent structured record per session. AI reasoning reads this, not rrweb raw.

Key fields: `sessionId` (unique), `accountId`, `visitorId`, `personId` (Phase 7, TBD), `startTs`, `endTs`, `durationMs`, `device Json`, `trafficSource Json`, `landingPage`, `keyframes Json`, `signals Json`, `ecommerceEvents Json`, `outcome` (`PURCHASED | ABANDONED | BOUNCED | STILL_BROWSING`), `cartValueAtEnd`, `orderId`, `aiAnalysis Json`, `aiAnalyzedAt`, `rawErasedAt`.

`keyframes` is the output of [`keyframeExtractor.js`](backend/services/keyframeExtractor.js) — 50–150 meaningful moments per session. `signals` is the aggregate score output of [`recordingSignalExtractor.js`](backend/services/recordingSignalExtractor.js). `ecommerceEvents` is a filtered subset of keyframes for fast analytics.

Debug endpoints (no auth, same prefix as recordings):
```
GET /api/recording/:account_id/packets/stats
GET /api/recording/:account_id/packets/list?limit=20&outcome=PURCHASED
GET /api/recording/:account_id/packets/:session_id
```

### 2.10 `abandonment_risk_scores` / `abandonment_cohorts` — legacy BRI

Risk score per session + precomputed cohorts for dashboard. Will be deprecated once Phase 6–8 AI analyses land in `session_packets.aiAnalysis`.

### 2.11 `merchant_snapshots` — dashboard cache

Precomputed aggregates (revenue by channel, ROAS, funnel) per merchant. Written by `backend/services/merchantSnapshot.js`. Read by the dashboard API.

### 2.12 `failed_jobs` — BullMQ retry graveyard

Jobs that exhausted retries. Manual inspection / re-enqueue.

---

## 3. How the data joins — follow a purchase

This is the actual query path when someone buys something on Shogun:

```
Pixel fires page_view on shogun.mx
  └─> INSERT INTO events (eventId, sessionId, userKey, accountId, ...)
  └─> UPSERT sessions (sessionId) — updates lastEventAt
  └─> UPSERT identity_graph (userKey) — bumps lastSeenAt
  └─> rrweb recording starts (Phase 0: on page load)
      └─> INSERT INTO session_recordings (recordingId, sessionId, ...)
      └─> chunks → R2 recordings/shogun.mx/YYYY-MM/{recordingId}/chunks/
      └─> UPDATE sessions SET rrwebRecordingId = ...

User adds to cart
  └─> INSERT INTO events (eventName='add_to_cart', cartValue, ...)
  └─> pixel emits Custom event (tag='add_to_cart') into rrweb stream

User begins checkout
  └─> INSERT INTO events (eventName='begin_checkout', checkoutToken, ...)
  └─> UPSERT checkout_session_map (checkoutToken → sessionId + attributionSnapshot)

User completes purchase → Shopify/Woo webhook arrives
  └─> attributionStitching.js:
       SELECT * FROM checkout_session_map WHERE checkoutToken = ?
       → grabs sessionId, userKey, attributionSnapshot
  └─> UPSERT orders (orderId, accountId, checkoutToken, sessionId, userKey,
         customerId, emailHash, attributedChannel, confidenceScore,
         attributionSnapshot)
  └─> pixel fires 'purchase' event → rrweb stops + sends /fin
  └─> recordingWorker.finalize:
       R2 chunks → R2 final assembled.rrweb.gz
       UPDATE session_recordings SET status=READY, r2Key=...
       Enqueue: recording:extract-signals, recording:build-packet, recording:check-outcome (2h delay)
  └─> recording:build-packet (Phase 4):
       download final from R2
       run keyframeExtractor + signalExtractor
       UPSERT session_packets (sessionId, keyframes, signals, outcome=PURCHASED)
  └─> recording:check-outcome (+2h):
       look up orders by sessionId → outcome=PURCHASED + orderId
       UPDATE session_recordings + UPDATE session_packets
  └─> recording:erase-raw (+24h, gated on SessionPacket existing):
       delete R2 final + chunks
       UPDATE session_recordings.rawErasedAt
       UPDATE session_packets.rawErasedAt
  └─> capiFanout.js:
       check event_dedup → if not sent, POST to Meta/Google CAPI
       UPDATE event_dedup.capiSentAt
```

---

## 4. Shared keys — how tables link

The keys that cross table boundaries. If you break one of these, attribution breaks.

| Key | Set by | Consumed by |
|---|---|---|
| `accountId` | Pixel on init, webhooks | **Every** pipeline table — FK to `accounts` |
| `sessionId` | Pixel (cookie `_adray_sid`) | `events`, `sessions`, `session_recordings`, `session_packets`, `orders`, `checkout_session_map` |
| `userKey` | Pixel (cookie `_adray_uid`) | `events`, `sessions`, `identity_graph`, `session_recordings`, `orders` |
| `checkoutToken` | Pixel on `begin_checkout`, webhook on purchase | `events`, `checkout_session_map`, `orders`, `session_recordings` — **the attribution bridge** |
| `eventId` | Pixel (UUID per event) | `events`, `event_dedup`, `orders.eventId` |
| `orderId` | Platform webhook | `orders`, `events`, `session_recordings`, `session_packets`, `event_dedup` |
| `customerId` | Platform webhook | `orders`, `identity_graph` |
| `emailHash` / `phoneHash` | Server-side SHA-256 | `orders`, `identity_graph`, `event_dedup` |
| `recordingId` | `/collect/x/init` | `session_recordings`, `sessions.rrwebRecordingId` |
| `r2Key` / `r2ChunksPrefix` | Finalize worker | `session_recordings` — points into R2 |
| `personId` | Identity resolver (Phase 7, WIP) | `session_packets` → joins cross-session history |

**PII note:** real email/phone NEVER touch Postgres. Only SHA-256 hashes. Plaintext customer name lives inside `orders.attributionSnapshot.customer_name` (Woo/Shopify give us that; not PII-sensitive like email).

---

## 5. Indexes that matter

These exist and the dashboard depends on them. Don't drop:

```
accounts (accountId)  @unique
platform_connections (accountId, platform) @unique
sessions (sessionId) @unique
events (eventId) @unique
orders (orderId) @unique
checkout_session_map (checkoutToken) @unique
session_recordings (recordingId) @unique
  + (accountId, sessionId), (accountId, status), (accountId, outcome), (accountId, userKey)
session_packets (sessionId) @unique
  + (accountId, personId), (accountId, startTs), (accountId, outcome), (accountId, orderId)
identity_graph (accountId, userKey), (accountId, fingerprintHash), (accountId, customerId)
abandonment_cohorts (accountId, cohortKey) @unique
```

---

## 6. MongoDB — what NOT to put here

Mongo is reserved for:

- **User auth** — `User`, sessions, password hashes
- **OAuth tokens** — Meta/Google/Shopify access tokens (encrypted with `ENCRYPTION_KEY`)
- **Platform integration metadata** — shop connections, refresh flags, scopes
- **MCP snapshots and cache** — precomputed LLM context blobs

Models live in `backend/models/`. Rule: if a new feature is in the attribution pipeline (event → session → order → analysis), it goes in Postgres. Only auth/OAuth/MCP-cache goes in Mongo.

Do **not** add pixel events, sessions, or packets to Mongo. See §7 in the `rrweb-phase.md` decision log for the reasoning.

---

## 7. Cloudflare R2 — raw storage (ephemeral)

Bucket: `$R2_BUCKET` (default `adray-recordings`).

```
recordings/{accountId}/{YYYY-MM}/{recordingId}/chunks/{idx}.json   ← per-chunk writes from /collect/x/buf
recordings/{accountId}/{YYYY-MM}/{recordingId}.rrweb.gz           ← final assembled stream (gzipped)
```

Lifecycle:
- Chunks accumulate while recording is active (chunked by pixel every 4s or 200KB).
- Finalize worker assembles them into one gzipped final object, then deletes chunks.
- `erase-raw` job deletes the final object **only after** both `SessionRecording.behavioralSignals` AND `SessionPacket` are written.
- Backup safety net: R2 bucket lifecycle rule deletes anything under `raw/` or `recordings/` older than 30 days regardless.

**R2 is temp.** Nothing canonical lives there. If a bucket is wiped, we lose replay ability for pre-packet sessions but all analytics/attribution stay intact.

---

## 8. Redis — queues + ephemeral state

Used for:
- **BullMQ queues** — `recordingQueue` (worker in `backend/workers/recordingWorker.js`), `mcpQueue`
- **Recording chunk index** — `adray:rec:{recordingId}:chunk_indexes` (TTL 2h) — helps finalize discover chunks fast without listing R2
- **LLM insight cache** — `adray:rec:insight:v2:{recordingId}` (TTL 1h)
- **Rate limits** — per-merchant `/collect` throttle
- **SSE live feed** — recent events buffer for the dashboard's live view

If Redis is gone, the app still works — queues just don't process and caches miss.

---

## 9. Migrations + schema sync

### Local / dev
```bash
npm run prisma:generate        # regenerate client after schema change
npm run prisma:push            # schema-first push (no migration file)
npm run prisma:migrate         # create + apply named migration
```

### Production / staging (Render)
The `startCommand` in `render.yaml` runs on every deploy:
```
node backend/scripts/migrate-clarity-columns.js
  && node backend/scripts/migrate-recordings-schema.js  ← belt-and-suspenders ALTERs
  && npm run prisma:push                                ← schema sync
  && node backend/scripts/backfill-clarity-urls.js
  && npm run db:backfill:layer45
  && node backend/index.js
```

`migrate-recordings-schema.js` exists because `prisma db push` occasionally lags or fails on Neon — that script explicitly adds the columns/tables we depend on (`sessions.rrweb_recording_id`, `session_recordings.device_type`, `session_packets` + its enum + FK + indexes) idempotently. Any new "must-exist" column for hot-path code should have a belt-and-suspenders ALTER added there.

**Never** run `prisma migrate deploy` against production without a dry run. Use `prisma db push` with `--accept-data-loss` only for additive changes.

---

## 10. Retention + erasure

| Data | Retention | Erasure trigger |
|---|---|---|
| `events`, `sessions`, `orders` | Indefinite | Manual only (customer deletion request) |
| `identity_graph` | Indefinite | GDPR erasure request → delete by emailHash cascade |
| `session_recordings` metadata | Indefinite | Kept; `r2Key`/`r2ChunksPrefix` nulled on raw erasure |
| R2 raw rrweb (chunks + final) | Max 24h post-READY | `recording:erase-raw` job (gated on packet+signals written) |
| `session_packets` | Indefinite — **the permanent AI-ready artifact** | GDPR erasure via `personId`/`emailHash` |
| Redis insight cache | 1h | TTL expiry |
| Redis chunk index | 2h | TTL expiry |
| MongoDB OAuth tokens | Until merchant disconnects | App logic on `disconnect` endpoints |

GDPR right-to-deletion: given an `emailHash`, delete → rows in `identity_graph` + `orders` + cascade to `events` + matching `session_packets` + matching R2 objects.

---

## 11. Common query patterns

### Get everything for one session
```sql
SELECT * FROM sessions WHERE session_id = ?;
SELECT * FROM events WHERE session_id = ? ORDER BY server_received_at;
SELECT * FROM session_recordings WHERE session_id = ?;
SELECT * FROM session_packets WHERE session_id = ?;
SELECT * FROM orders WHERE session_id = ?;
```

### Attribution for an order
```sql
SELECT o.*, csm.attribution_snapshot, s.utm_source, s.utm_campaign
FROM orders o
LEFT JOIN checkout_session_map csm ON o.checkout_token = csm.checkout_token
LEFT JOIN sessions s ON o.session_id = s.session_id
WHERE o.order_id = ?;
```

### All sessions for one customer (across identity drift)
```sql
WITH identities AS (
  SELECT DISTINCT user_key FROM orders
  WHERE customer_id = ? OR email_hash = ?
)
SELECT sp.*
FROM session_packets sp
WHERE sp.visitor_id IN (SELECT user_key FROM identities)
ORDER BY sp.start_ts ASC;
```

### Latest packets for AI backfill
```sql
SELECT session_id FROM session_packets
WHERE ai_analyzed_at IS NULL
ORDER BY created_at DESC
LIMIT 50;
```

---

## 12. When in doubt

- **New pipeline feature?** → Postgres + Prisma.
- **New flexible JSON field?** → `Json` column on an existing Postgres table, not a new Mongo collection.
- **Raw binary data?** → R2 with a short TTL, pointer in Postgres.
- **Auth / OAuth / MCP cache?** → Mongo, using the existing models.
- **Need to query across sessions of a person?** → Wait for Phase 7 (`personId`), then `session_packets.personId`.

Anything unclear, grep `backend/prisma/schema.prisma` + `backend/services/attributionStitching.js` — those two files answer 80% of data-layer questions.
