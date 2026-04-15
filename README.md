# AdRay / Adnova

Last update: 2026-04-13 (behavioral analytics plan + Clarity integration)

This is the only documentation file that should be treated as the source of truth for the repository. It consolidates planning files, implementation notes, operational checklist, WordPress plugin readme, Shopify review guide, and frontend README boilerplate.

---

## How agents should use this file

- Read this file first before touching any code. It contains the current project state, not just the original plan.
- `Agent-instructions.md` defines the working style and git discipline expected in this repo — read it too.
- After closing any relevant improvement: update the **Current Status** and **Next Implementation Steps** sections. Do not turn this into a changelog; keep it useful for resuming work.
- Branch in use: `german/dev`. Render auto-deploys from this branch.

---

## Product Goal

Build and run a platform-agnostic **Behavioral Revenue Intelligence (BRI)** platform for Shopify, WooCommerce, and custom ecommerce sites that:

- captures browser events and **rrweb session recordings from AddToCart onwards**,
- stitches attribution (UTM, click IDs, multi-touch models),
- processes purchases server-side,
- syncs revenue truth from ecommerce platforms,
- extracts behavioral signals (rage clicks, exit intent, shipping shock, hesitation),
- classifies abandonment archetypes with LLM (Gemma via OpenRouter),
- enriches Meta CAPI with behavioral signals (behavioral_archetype, intent_score),
- exposes reliable dashboard metrics with inline session replay,
- and prepares clean data for Meta and Google integrations.

---

## Current Architecture

- **Backend**: Node.js + Express (`backend/index.js`)
- **Relational data**: PostgreSQL via Prisma (`backend/prisma/schema.prisma`)
- **Legacy/operational models**: MongoDB via Mongoose (`backend/models/`)
- **Cache and dedup**: Redis via ioredis (`backend/utils/redisClient.js`)
- **Deployment**: Render (web service + MCP worker). Config in `render.yaml`.
- **WooCommerce distribution**: WordPress plugin under `wordpress-plugin/adnova-pixel`
- **Frontend apps**: multiple Vite + React + TypeScript + shadcn-ui + Tailwind projects (Git submodules)
- **Public analytics page**: `backend/views/adray-analytics.html` — served at `/analytics/:account_id`
- **Pixel runtime**: `public/adray-pixel.js` — loaded cross-origin by merchant sites

### Render deploy config (`render.yaml`)

Three services:

| Service | Type | Branch | Auto-deploy |
|---------|------|--------|-------------|
| `adnova-ai` | web | `german/dev` | yes |
| `adnova-ai-mcp-worker` | worker | `german/dev` | yes |
| `adnova-ai-recording-worker` | worker | `german/dev` | yes |

Web build command:
```
npm ci && npm run build:landing && npm run build:dashboard && npx prisma generate --schema=backend/prisma/schema.prisma
```

Web start command:
```
node backend/scripts/migrate-clarity-columns.js && node backend/scripts/migrate-recordings-schema.js && npm run prisma:push && node backend/scripts/backfill-clarity-urls.js && npm run db:backfill:layer45 && node backend/index.js
```

MCP worker start command:
```
npm run worker:mcp
```

Recording worker start command:
```
node backend/workers/recordingWorker.js
```

### Staging vs Production

Checklist operativa y variables por entorno: [docs/STAGING_PRODUCTION.md](docs/STAGING_PRODUCTION.md).

- **Staging URL**: `https://adray-app-staging-german.onrender.com`
- **Production URL**: `https://adray.ai`
- `APP_URL` is the key variable that controls OAuth callbacks. Define it explicitly per Render service.
- `NODE_ENV=production` must be set in all Render services (enables secure cookies).
- Cloudflare Turnstile was removed from the repo — `TURNSTILE_*` vars can be deleted from Render.

---

## BRI Environment Variables

Required for recording, LLM narratives, and secure PII hashing. Add to Render dashboard under each service.

### Opción A: AWS S3 (recomendado si ya tienes cuenta AWS)

| Variable | Default | Dónde encontrarlo |
|---|---|---|
| `S3_ACCESS_KEY_ID` | — | AWS Console → IAM → Users → Create user → Access keys |
| `S3_SECRET_ACCESS_KEY` | — | Mismo paso, se muestra solo una vez |
| `S3_REGION` | `us-east-1` | Región donde creaste el bucket |
| `S3_BUCKET` | `adray-recordings` | S3 → Create bucket → nombre `adray-recordings` |

IAM policy mínima necesaria para el user:
```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
  "Resource": ["arn:aws:s3:::adray-recordings", "arn:aws:s3:::adray-recordings/*"]
}
```

### Opción B: Cloudflare R2 (10GB gratis, egress $0)

| Variable | Default | Dónde encontrarlo |
|---|---|---|
| `R2_ENDPOINT` | — | `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | — | Cloudflare → R2 → Manage R2 API tokens → Create token |
| `R2_SECRET_ACCESS_KEY` | — | Mismo paso, solo se muestra una vez |
| `R2_BUCKET` | `adray-recordings` | Crear bucket en Cloudflare R2 |

### Otras variables BRI

| Variable | Default | Descripción |
|---|---|---|
| `OPENROUTER_API_KEY` | — | https://openrouter.ai/keys → Create key |
| `OPENROUTER_MODEL` | `google/gemma-3-27b-it` | Modelo LLM para narrativas de abandono |
| `HMAC_EMAIL_KEY` | — | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `HMAC_PHONE_KEY` | — | Igual, genera un key distinto |
| `RECORDING_QUEUE_NAME` | `recording-process` | Opcional |
| `RECORDING_RETENTION_HOURS` | `24` | Horas antes de borrar raw recording de R2/S3 |

> **Después de configurar `HMAC_EMAIL_KEY` y `HMAC_PHONE_KEY`**, ejecutar en staging:
> ```bash
> node backend/scripts/migrate-hmac-hashes.js
> ```
> Esto re-hashea los `email_hash` y `phone_hash` existentes en `identity_graph` de SHA-256 sin sal a HMAC-SHA-256.

### S3 / R2 CORS Configuration

El player inline del dashboard descarga grabaciones directamente desde S3/R2. Necesita CORS habilitado.

**AWS S3:** S3 → bucket `adray-recordings` → Permissions → Cross-origin resource sharing (CORS):
```json
[
  {
    "AllowedOrigins": ["https://adray.ai", "https://adray-app-staging-german.onrender.com"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

**Cloudflare R2:** R2 → `adray-recordings` → Settings → CORS policy → mismo JSON de arriba.

---

## Current Status

### Layer 1 Foundation: DELIVERED AND ACCEPTED (2026-03-24)

Layer 1 scope from `layer1.md` (Custom Pixel + revenue truth + stitching base + Ads connections and basic pull) was delivered according to contract. Payment checkpoint: **PASS** (staging evidence available).

Delivered:
1. Custom Pixel V1 capture and collector pipeline.
2. Revenue truth read-only sync and baseline health.
3. Session-checkout-order stitching base.
4. Pixel Health / Match Rate / onboarding validation flow.
5. Meta and Google Ads connection verification and basic pull execution with stored datasets.

Out of scope and not included (as stated in contract):
- Phase 2 advanced dedup/reconciliation/scoring/backfill.
- Full MCP server exposure for third-party AI consumers.
- Full server-side events parity rollout (Meta CAPI, Google Enhanced Conversions, TikTok Events API).

### What is working now

- Universal pixel is live and loadable cross-origin from the AdRay server.
- Pixel loading returns `200 OK`.
- Event collection flow exists at `POST /collect`.
- Identity cookie `_adray_uid` handling is implemented.
- Sessions, events, and checkout map persistence are implemented.
- Shopify webhook ingestion exists for orders and checkouts.
- WooCommerce order sync path exists through the plugin and backend sync route.
- Attribution stitching, merchant snapshot updates, and failed job logging are implemented.
- WooCommerce attribution flow validated end-to-end in staging on 2026-03-13 (checkout login stitching and attributed order persistence).
- Collector health stable (staging): `success: true`, `event_persisted: true`, `session_persisted: true`, `fallback_stored: false`.
- Meta and Google Ads daily pull validated in staging: both return `ready=true`, `chunkCount > 0`.
- Historical backfill for Layer 4 and Layer 5 session source is automated at service startup.
- `Live Feed` runs over SSE (`/api/feed/:account_id`) and displays real-time `COLLECT` + `WEBHOOK` events.
- Session Explorer panel: attribution, checkout tokens, top pages, touched products, journey map, related sessions, side-by-side comparison.
- Woo multi-touch validation: `first_touch`, `last_touch`, `linear` models work and redistribute revenue correctly.
- CSV export feature completed (2026-04-13): `GET /:account_id/export/candidates` and `POST /:account_id/export/download` produce a ZIP with `orders.csv`, `sessions.csv`, `events.csv`, `items.csv`.
- Woo customer display names improved in analytics (2026-04-13): resolved names shown instead of generic IDs.
- Render auto-deploy reconfigured (2026-04-13): `render.yaml` now builds landing, dashboard, and runs Prisma generate + push on every deploy from `german/dev`.

### Frontend note (ad blocker safety)

- Public analytics page at `public/adray-analytics.html` must avoid CSS class names that look like ad containers (`ad-panel`, `ad-control`, etc.).
- Brave Shields can apply cosmetic filtering after first paint and hide those elements.
- Safe convention: `ops-panel`, `ops-control`.

---

## Behavioral Analytics Roadmap

Goal: build the most complete behavioral + attribution + AI product for e-commerce. Own 100% of the data. No third-party data lock-in.

### Strategy

Microsoft Clarity runs today as a scaffold while the self-hosted recording infrastructure is built in parallel. When the native pipeline reaches feature parity, Clarity is turned off.

```
HOY          SEMANAS 1-2    SEMANAS 3-4    SEMANAS 5-6    SEMANAS 7-8    SEMANAS 9-10   SEMANAS 11+
────         ───────────    ───────────    ───────────    ───────────    ────────────   ──────────
Clarity      Micro-eventos  rrweb propio   Heatmaps       Behavioral     Session        ML propio
live +       en pixel       + R2 storage   propios        features +     Replay UI +    scoring
vinculado    por /collect   + chunk API    + rage/dead    AI Insights    Clarity OFF    tiempo real
a session_id                               click detect   (Claude API)   en dashboard
```

### Fase 0 — COMPLETADA (2026-04-13): Clarity live

- `data-clarity-id="PROJECT_ID"` en el script tag activa Clarity automáticamente.
- `clarity('identify', user_key, session_id)` — cada grabación vinculada al identity graph.
- Tags en Clarity: `adray_session_id`, `utm_source`, `utm_campaign`, `has_gclid`, etc.
- Evento `clarity_session_linked` llega al collector → `sessions.clarity_playback_url` guardado.
- El Session Explorer puede mostrar `▶ Ver grabación` con el playback URL de Clarity.
- Schema Prisma: `Session.claritySessionId` + `Session.clarityPlaybackUrl` añadidos.

### Fase 1 — Semanas 1-2: Micro-eventos conductuales

Extender `adray-pixel.js` con señales de intención que fluyen por `POST /collect` sin infra nueva:

| Evento | Señal |
|--------|-------|
| `scroll_depth` (25/50/75/100%) | Engagement con el contenido |
| `exit_intent` | Intención de abandonar |
| `rage_click` | Frustración / bug |
| `dead_click` | Elemento confuso |
| `tab_visibility_change` | Compara precios en otra pestaña |
| `form_field_focus/blur` | Fricción en checkout (sin capturar valores) |
| `form_field_paste` | Pegó email — señal de identidad pre-submit |
| `checkout_hesitation` | >30s parado en un paso |
| `cursor_idle` | Parálisis de decisión |

### Fase 2 — Semanas 3-4: rrweb propio + Cloudflare R2

- `rrweb` en el pixel graba DOM mutations, clics, scrolls, movimientos
- Chunks cada 5s → `POST /collect/recording/chunk` (endpoint nuevo)
- Redis acumula chunks → comprimir → subir a Cloudflare R2 (`{account_id}/{date}/{session_id}.json.gz`)
- Metadata en `session_recordings` table (Prisma)
- Costo R2: $0.015/GB/mes — a 10K sesiones/día son ~$1.80/mes

### Fase 3 — Semanas 5-6: Heatmaps propios

- Job de agregación: lee `events` (clicks con coordenadas X/Y + scrolls) por URL
- Tabla `heatmap_data`: clicks agrupados por URL + viewport + fecha
- API: `GET /api/heatmap/:account_id?url=...&days=30` → canvas overlay en dashboard
- Cuando esté listo: Clarity pierde el caso de heatmaps

### Fase 4 — Semanas 7-8: Behavioral features + AI Insights

`behavioral_features` table (una fila por sesión, lista para ML):
```
converted, funnel_depth, last_step_before_exit,
max_scroll_depth_pct, active_time_ms, page_count,
rage_click_count, exit_intent_count, checkout_hesitation_ms,
form_fields_abandoned, form_paste_count, tab_switch_count,
utm_source, attributed_channel, device_type, is_returning_user
```

AI Insights job (Claude API, cada 24h): agrupa sesiones por canal + último paso antes de salir → revenue perdido estimado → recomendaciones en lenguaje natural → guardado en `merchant_snapshots.ai_insights`.

### Fase 5 — Semanas 9-10: Session Replay propio + migración

- Integrar `rrweb-player` en `dashboard-src` como componente React
- Session Explorer muestra replay inline desde R2 (reemplaza el link de Clarity)
- Clarity se desactiva quitando `data-clarity-id` del script tag

### Fase 6 — Semanas 11+: ML propio

Con 60-90 días de `behavioral_features` acumulados:
- **Clasificador de abandono**: P(conversión) en tiempo real → intervención si score < 0.15
- **Predictor de LTV**: revenue esperado en 90 días → priorizar retargeting
- **Clustering**: segmentos conductuales → personalización por segmento

---

## Next Implementation Steps (priority, updated 2026-04-13)

1. **Live Feed polling**: add a fixed-interval refresh of online-user state in addition to event-triggered refresh.
2. **Identity resolution in Live Feed**: every live event should show resolved user identity (name, email, phone, or customer ID); explicitly indicate when no logged-in identity is available.
3. **Woo sync pagination**: remove the practical 100-order cap; implement paginated/backfill strategy for large stores with queue-safe processing.
4. **Historical Conversion Journey — real names**: show actual user names instead of generic `Woo customer #xx` wherever any identity source can resolve the profile.
5. **Selected Journey — full event timeline**: render the complete stitched event timeline for the selected user/session (not only `Ad Click` + `Purchase`).
6. **User filter UX fix**: black text on white input in Historical Conversion Journey user-filter, plus verified functional filtering behavior.
7. **Shopify pixel validation**: confirm browser event capture, checkout continuity, and purchase visibility in staging (Woo already passed this bar).
8. **Meta CAPI**: complete real purchase fanout in `backend/services/capiFanout.js` (currently placeholder).
9. **Google conversions**: replace stub in `backend/routes/adrayPlatforms.js` with validated end-to-end upload.
10. **`ENCRYPTION_KEY` fallback**: remove unsafe production fallback that regenerates on restart.
11. **Rate limit key**: confirm `account_id` is used (not legacy `shop_id`) for public non-Shopify traffic.

---

## Canonical Pipeline

```
Browser Pixel -> POST /collect -> PostgreSQL
Checkout map persists attribution snapshot at checkout time
Purchase webhooks or Woo order sync persist orders server-side
Async pipeline: attribution stitching -> order enrichment -> CAPI fanout -> snapshot update -> failed job logging
```

---

## Canonical Data Model

Prisma schema at `backend/prisma/schema.prisma`. All models use `account_id`-centric design with partial legacy `shop_id` fallback in some paths.

| Model | Table | Purpose |
|-------|-------|---------|
| `Account` | `accounts` | Merchant account, platform type |
| `PlatformConnection` | `platform_connections` | Meta/Google/TikTok OAuth tokens per account |
| `IdentityGraph` | `identity_graph` | Per-user identity node with all click IDs, hashes |
| `Session` | `sessions` | Browser visit with UTMs, referrer, landing page |
| `CheckoutSessionMap` | `checkout_session_map` | Checkout token -> session stitch key |
| `Event` | `events` | Individual browser events with full enrichment |
| `Order` | `orders` | Revenue truth with attribution, CAPI status |
| `EventDedup` | `event_dedup` | Browser + server event dedup tracking |
| `MerchantSnapshot` | `merchant_snapshots` | Aggregated revenue/channel/funnel summary |
| `FailedJob` | `failed_jobs` | Async job failures with retry state |
| `SessionRecording` | `session_recordings` | **BRI** — rrweb recording triggered from AddToCart, R2 keys, behavioral signals, LLM archetype |
| `AbandonmentRiskScore` | `abandonment_risk_scores` | **BRI** — Real-time risk score (0-100) per active checkout session |
| `AbandonmentCohort` | `abandonment_cohorts` | **BRI** — Daily-computed abandonment cohorts by friction pattern |

Key enums:
- `Platform`: `META`, `GOOGLE`, `TIKTOK`
- `ConnectionStatus`: `ACTIVE`, `DISCONNECTED`, `ERROR`
- `DedupStatus`: `SINGLE`, `BROWSER_ONLY`, `SERVER_ONLY`, `DEDUPLICATED`
- `AccountPlatform`: `SHOPIFY`, `WOOCOMMERCE`, `MAGENTO`, `CUSTOM`, `OTHER`
- `RecordingStatus`: `RECORDING`, `FINALIZING`, `READY`, `ERROR` *(BRI)*
- `RecordingOutcome`: `PURCHASED`, `ABANDONED`, `STILL_BROWSING` *(BRI)*

MongoDB models (legacy/operational, in `backend/models/`):
- `User`, `ShopConnections`, `McpData`, `MetaAccount`, `GoogleAccount`, `PixelSelection`, `AnalyticsEvent`, `Audit`, `TaxProfile`, `DailySignalDeliveryRun`

---

## Confirmed Endpoints

### Core pipeline

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/collect` | Browser event ingestion (main entry point) |
| `POST` | `/webhooks/shopify/orders-create` | Shopify order webhook |
| `POST` | `/webhooks/shopify/orders-updated` | Shopify order update webhook |
| `POST` | `/webhooks/shopify/checkouts-create` | Shopify checkout webhook (critical stitch) |
| `POST` | `/api/woo/orders-sync` | WooCommerce order sync from plugin |

### Analytics and dashboard

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/analytics/:account_id` | Main analytics payload |
| `GET` | `/api/analytics/:account_id/data-coverage?days=30` | Phase 1 field coverage audit |
| `GET` | `/api/analytics/:account_id/export/candidates` | List exportable journeys |
| `POST` | `/api/analytics/:account_id/export/download` | Download CSV ZIP (orders, sessions, events, items) |
| `GET` | `/api/feed/:account_id` | SSE Live Feed stream |
| `GET` | `/api/analytics/shops` | List authorized shops for logged-in user |

### Platform integrations

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/pixels/:account_id/meta` | Meta pixel list |
| `GET` | `/api/conversions/:account_id/google` | Google conversions (partial — stub) |
| `POST` | `/api/connections/:account_id` | Save platform connection |
| `POST` | `/api/mcpdata/collect-now` | Trigger immediate MCP pull |
| `GET` | `/api/mcpdata/meta/status` | Meta pull status |
| `GET` | `/api/mcpdata/google-ads/status` | Google Ads pull status |
| `GET` | `/api/mcpdata/ga4/status` | GA4 pull status |

### BRI: Session recording ingest (pixel-facing, no auth)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/recording/start` | Create `SessionRecording` row when AddToCart fires |
| `POST` | `/recording/chunk` | Receive rrweb event batch → write to R2 chunk + Redis index |
| `POST` | `/recording/end` | Finalize recording → enqueue BullMQ `recording:finalize` job |

### BRI: Recording API (dashboard, no auth required same as analytics)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/recording/:account_id/:recording_id` | Metadata + presigned R2 URL for inline player (TTL 15min) |
| `GET` | `/api/recording/:account_id/session/:session_id` | Recording linked to a specific session |

### WordPress plugin distribution

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/wp-plugin/adnova-pixel/update.json` | Auto-update metadata |
| `GET` | `/wp-plugin/adnova-pixel/download` | Plugin ZIP download |

---

## Service Responsibilities

### Identity resolution (`backend/services/identityResolution.js`)

Resolves a persistent `user_key` with the following priority:
1. Existing first-party cookie (`_adray_uid`).
2. Click IDs: `fbclid`, `gclid`, `ttclid`.
3. Customer ID if present.
4. Fingerprint derived from request metadata.

Upserts `identity_graph` and refreshes the `_adray_uid` cookie.

### Attribution stitching (`backend/services/attributionStitching.js`)

Looks up checkout token, retrieves attribution snapshot, classifies channel, assigns confidence:

| Signal | Confidence |
|--------|-----------|
| Click ID present | `1.0` |
| UTM only | `0.85` |
| Referrer only | `0.7` |
| Fingerprint match | `0.6` |
| No attribution signal | `0.0` |

Supported models: `first_touch`, `last_touch`, `linear`, `meta`, `google_ads`.

### CAPI fanout (`backend/services/capiFanout.js`)

**Status: placeholder — not complete for production.**

Intended design: parallel platform fanout with isolated failures. One failed platform send must not block others.

Planned:
- Meta CAPI purchase send with hashed PII, `event_id`, `fbp`, `fbc`, IP, user-agent, revenue, currency, order contents.
- Google conversions upload when `gclid` and valid conversion action are available.
- TikTok parity where relevant.

### Merchant snapshot (`backend/services/merchantSnapshot.js`)

Summarizes: total revenue, order count, AOV, revenue by channel, ROAS when spend data exists, funnel metrics, pixel health, top products, attribution confidence distribution, unattributed order count and rate.

### MCP worker (`npm run worker:mcp`)

Runs background jobs for Meta, Google Ads, and GA4 daily pull. Stores datasets as `McpData` chunks in MongoDB. Triggered via `POST /api/mcpdata/collect-now` or scheduled interval.

---

## Phase 1 Data Coverage Audit

Reference: `datos-pixel.md` (March 2026). Validate with:

```
GET /api/analytics/:account_id/data-coverage?days=30
```

### Layer 1: Identity anchors
- `user_key`: YES
- `email_hash`: PARTIAL (reliable at order/login time; checkout blur capture implemented but not guaranteed for all flows)
- `phone_hash`: PARTIAL (same as email_hash)
- `customer_id`: PARTIAL (present when included in browser or order payload)

### Layer 2: Session events
- `session_id`: YES
- `utm_source`, `utm_medium`, `utm_campaign`: YES
- `fingerprint_hash`: YES
- `ip_hash`: YES
- `page_events[]`: PARTIAL (row-by-row in `events`, not an array field in `sessions`)
- `session_start_at`: YES (`sessions.started_at`)
- `session_end_at`: PARTIAL (`sessions.last_event_at` as proxy; explicit close policy not yet implemented)

### Layer 3: Touchpoints and click IDs
- `fbclid`, `gclid`, `ttclid`: YES
- `event_id` server-generated: YES
- `landing_page`: PARTIAL (`sessions.landing_page_url` exists but depends on sender payload)
- `referrer`: YES

### Layer 4: Order truth
- `order_id`: YES
- `gross_revenue`: YES
- `refund_amount`: PARTIAL (field exists; updated from Shopify `orders-updated` and Woo sync when payloads include it)
- `chargeback_flag`: PARTIAL (field exists; webhook/order-meta heuristic, not disputes API)
- `orders_count`: PARTIAL (field exists; written when present in payload, not guaranteed for all stores)
- `checkout_token`: YES
- `customer_id` on order: YES when provided
- `created_at`: YES (`orders.platform_created_at`)

### Layer 5: Platform daily pull
- `meta_spend`, `meta_impressions`: YES (MCP chunks)
- `meta_reported_conv_value`: PARTIAL (available in MCP payloads; not a canonical DB field)
- `google_spend`, `google_clicks`: YES (MCP chunks)
- `ga4_session_source`: EXISTS as `sessions.ga4_session_source` in Prisma schema but canonical population still needs validation

### Layer 6: Raw enrichment
- `confidence_score`: YES (event-level, persisted from identity resolution)
- `match_type`: YES (event-level)
- `raw_source`: PARTIAL (in collect; webhook/api parity needs rollout)
- `collected_at`: PARTIAL (in collect; other ingestion paths need harmonization)

### Critical stitch
- `checkout_token -> session_id` at checkout time: YES for browser `begin_checkout` path (`POST /collect`)
- Shopify `checkouts/create` webhook backfills with `unknown` when browser context missing (good fallback)

---

## Security Requirements

- Validate Shopify HMAC on every webhook (`backend/middleware/verifyShopifyWebhookHmac.js`).
- Encrypt platform access tokens at rest (`ENCRYPTION_KEY` env var).
- Hash email and phone with SHA-256 before storing or sending (`backend/utils/encryption.js`).
- Never log raw PII (`backend/middleware/sanitizeLogs.js`).
- Validate account or shop identity on protected requests.
- Rate limit `POST /collect` to 100 requests per minute per merchant (`backend/middleware/rateLimitCollect.js`).

---

## Error Handling Requirements

- Shopify webhooks return `200` even when downstream processing fails.
- Failures captured in `FailedJob` for retry.
- CAPI failures are non-fatal.
- Retry policy: exponential backoff with `1s`, `5s`, `30s` delays.
- `POST /collect` has a three-level persistence fallback:
  1. Enriched write (all fields).
  2. Legacy-compatible write.
  3. Minimal write.
  4. If all three fail: store payload in `failed_jobs` as safety net (`fallback_stored: true`).

---

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
- `APP_URL` — required; determines OAuth callback URLs; must match the public URL of the Render service
- `SHOPIFY_API_KEY`
- `NODE_ENV=production` — must be set on all Render services

### Optional access control
- `ADRAY_ALLOWED_ACCOUNT_IDS` — comma-separated list; if set, restricts analytics routes to listed accounts

---

## Main Risks and Gaps

### P0
- Meta CAPI is still placeholder in `backend/services/capiFanout.js` — not sending real purchases.
- Shopify pixel validation not yet completed (WooCommerce passed; Shopify still pending).

### P1
- `ENCRYPTION_KEY` fallback is unsafe for production if it regenerates on restart.
- Rate limit key may still prioritize legacy `shop_id` instead of `account_id` for non-Shopify traffic.
- Google conversions endpoint still a stub in `backend/routes/adrayPlatforms.js`.
- `session_end_at` explicit close policy not implemented (fallback is `last_event_at`).

### P2
- `chargeback_flag` from a dedicated disputes API — currently heuristic only.
- `meta_impressions` and `meta_reported_conv_value` not yet normalized as canonical Prisma fields.
- `ga4_session_source` field exists in schema but population path needs validation.

---

## Operational Checklist

### Terminal variables (PowerShell)

```powershell
$BASE_URL   = "https://adray-app-staging-german.onrender.com"
$ACCOUNT_ID = "your-domain.com"
```

### API validation

#### Minimal collect

```powershell
curl.exe -s -X POST "$BASE_URL/collect" `
  -H "Content-Type: application/json" `
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"platform\":\"woocommerce\",\"event_name\":\"page_view\",\"page_url\":\"https://$ACCOUNT_ID/\"}"
```

Expected: `success: true`, non-empty `event_id`, non-empty `user_key`.

Healthy persistence flags:
- `event_persisted: true`
- `session_persisted: true`
- `fallback_stored: false`

If `fallback_stored: true`, inspect `failed_jobs` rows with `job_type` starting with `collect_` and run Prisma schema alignment.

#### begin_checkout mapping

```powershell
$CHECKOUT_TOKEN = "chk_test_001"
curl.exe -s -X POST "$BASE_URL/collect" `
  -H "Content-Type: application/json" `
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"platform\":\"woocommerce\",\"event_name\":\"begin_checkout\",\"checkout_token\":\"$CHECKOUT_TOKEN\",\"page_url\":\"https://$ACCOUNT_ID/checkout\",\"utm_source\":\"google\",\"utm_medium\":\"paid_search\",\"gclid\":\"test-gclid-123\"}"
```

Expected: `success: true`, checkout token in `checkout_session_map`.

#### Woo order sync

```powershell
curl.exe -s -X POST "$BASE_URL/api/woo/orders-sync" `
  -H "Content-Type: application/json" `
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"order_id\":\"woo_test_1001\",\"order_number\":\"1001\",\"checkout_token\":\"$CHECKOUT_TOKEN\",\"revenue\":199.99,\"subtotal\":180,\"discount_total\":0,\"shipping_total\":10,\"tax_total\":9.99,\"currency\":\"MXN\",\"items\":[{\"id\":\"sku_1\",\"name\":\"Test Product\",\"quantity\":1,\"price\":199.99}],\"utm_source\":\"google\",\"utm_medium\":\"paid_search\",\"utm_campaign\":\"brand\",\"gclid\":\"test-gclid-123\"}"
```

Expected: `success: true`, `attributedChannel` present.

#### Dashboard analytics endpoint

```powershell
curl.exe -s "$BASE_URL/api/analytics/$ACCOUNT_ID"
```

Expected: response contains revenue and event stats, no server error.

#### Data coverage

```powershell
curl.exe -s "$BASE_URL/api/analytics/$ACCOUNT_ID/data-coverage?days=30"
```

Expected: `missing: []` for Phase 1 completion.

#### MCP status

```powershell
curl.exe -s "$BASE_URL/api/mcpdata/meta/status"
curl.exe -s "$BASE_URL/api/mcpdata/google-ads/status"
```

Expected: `ready: true`, `chunkCount > 0`.

### SQL validation

```sql
-- Events in last 24h
SELECT count(*) AS events_24h
FROM events
WHERE account_id = 'your-domain.com'
  AND created_at >= now() - interval '24 hours';

-- Orders in last 24h
SELECT count(*) AS orders_24h, coalesce(sum(revenue), 0) AS revenue_24h
FROM orders
WHERE account_id = 'your-domain.com'
  AND created_at >= now() - interval '24 hours';

-- Attribution fill rate
SELECT
  count(*) AS total_orders,
  count(*) FILTER (WHERE attributed_channel IS NOT NULL) AS orders_with_channel,
  round(100.0 * count(*) FILTER (WHERE attributed_channel IS NOT NULL) / nullif(count(*),0), 2) AS channel_fill_pct
FROM orders
WHERE account_id = 'your-domain.com'
  AND created_at >= now() - interval '7 days';

-- Checkout map linkage
SELECT count(*) AS mapped_orders
FROM orders o
JOIN checkout_session_map c ON o.checkout_token = c.checkout_token
WHERE o.account_id = 'your-domain.com'
  AND o.created_at >= now() - interval '7 days';

-- Snapshot freshness
SELECT account_id, updated_at FROM merchant_snapshots WHERE account_id = 'your-domain.com';

-- Failed jobs recent
SELECT job_type, created_at, error FROM failed_jobs
WHERE created_at >= now() - interval '24 hours'
ORDER BY created_at DESC LIMIT 50;
```

### Operator runbook to unblock Prisma push

Run from the Render shell (or any environment pointing to staging `DATABASE_URL`):

1. `npm run db:pc:check`
2. If duplicates reported: `npm run db:pc:dedupe`
3. Re-run `npm run db:pc:check` — confirm zero duplicates
4. `npm run prisma:push -- --accept-data-loss`
5. Re-test collect and verify flags: `event_persisted: true`, `session_persisted: true`, `fallback_stored: false`

Safety note: `db:pc:dedupe` creates a backup table `platform_connections_backup_YYYYMMDD_HHMMSS` before deleting duplicates.

### Quick scoring
- `90-100%`: complete
- `70-89%`: usable but partial
- `<70%`: incomplete — fix ingestion and integration first

---

## Attribution Test Plan

### Test 1: browser signal capture

1. Open the store with `utm_source`, `utm_medium`, `utm_campaign` in the URL.
2. Visit a product page.
3. Add to cart.
4. Start checkout.
5. Complete a purchase.
6. Verify dashboard shows `view_item`, `add_to_cart`, `begin_checkout`, and attributed purchase.

### Test 2: click ID capture

1. Open store with `gclid` or `fbclid` in the URL.
2. Complete purchase flow.
3. Verify order keeps click ID in attribution data and resolves to expected paid channel.

### Test 3: Woo fallback attribution

1. Complete purchase where WooCommerce already has source metadata.
2. Verify synced order receives attribution even if browser signal is incomplete.
3. Confirm dashboard exposes Woo source label in recent purchases.

### Test 4: model comparison

1. Load same account in dashboard.
2. Switch attribution selector between `first touch`, `last touch`, `linear`.
3. Confirm channel chart and attributed revenue/order breakdown change consistently.

### Test 5: unattributed diagnosis

1. Find a recent unattributed order in dashboard or DB.
2. Check whether corresponding session exists.
3. Check whether `checkout_token` was persisted.
4. Check whether order has attribution snapshot.
5. Record failure mode before changing code.

Root cause categories:
- no browser event
- no checkout map
- missing UTMs or click IDs
- order sync arrived without attribution context
- collector persistence failure

### Test 6: Shopify pixel smoke test

1. Install custom pixel in Shopify staging store.
2. Open storefront in incognito with tagged URL (`utm_source`, `utm_medium`, `utm_campaign`).
3. Verify `page_view` reaches `POST /collect` and appears in `Live Feed`.
4. Visit product page → verify `view_item`.
5. Add to cart → verify `add_to_cart`.
6. Start checkout → verify `begin_checkout` + `checkout_token` persistence.
7. Complete purchase (if possible) → verify order appears with channel and campaign context.

### User-assisted validation URL template

```
https://your-store-domain/?utm_source=google&utm_medium=paid_search&utm_campaign=brand-test&utm_content=adset-test&utm_term=creative-test&gclid=test-gclid-123
```

Send back: exact timestamp, final URL, order number, whether dashboard showed correct channel and campaign.

---

## Latest Staging Validation Evidence

### WooCommerce (2026-03-13)

- Timestamp: `13/3/2026, 8:12:57 a.m.`
- Order: `66308`, Customer: `Germán Muñoz`, Revenue: `$374.95`
- Attribution: `Google · brand-test`, Source: `Woo Orders Sync`
- Debug: `woo=Google | utm=google | campaign=brand-test`
- Home → Tienda: order `66310`, attribution `Google · home_to_store_test` ✓
- Checkout login stitching: OK ✓
- Attribution and campaign persistence: OK ✓
- Timezone in recent purchases: OK ✓

### Collector (2026-03-23)

- Latest live tests: `success: true`, `event_persisted: true`, `session_persisted: true`, `fallback_stored: false`.
- Data coverage endpoint: stable, no `500` or degraded Prisma errors.

### MCP Ads pull (2026-03-24)

- Meta pull: `collectMeta ok=true`, datasets stored, `ready=true`, `chunkCount > 0`.
- Google Ads pull: `collectGoogle ok=true`, datasets stored, `ready=true`, `chunkCount > 0`.

---

## WordPress Plugin

### Summary

Adnova Pixel installs the tracking script automatically on WordPress and uses the detected domain as `account_id` and `site_id`.

### Behavior

- Detects site domain via `home_url()`.
- Injects `https://adray-app-staging-german.onrender.com/adray-pixel.js` into the frontend.
- Sends a verification event to `/collect` on activation.
- Supports `page_view`, `view_item`, `add_to_cart`, `begin_checkout`, `purchase`.

### WooCommerce purchase capture (plugin `v1.1.x`)

- Sends `purchase` on thank-you page with `order_id`, `revenue`, `currency`, `items`.
- Server-side fallback via `woocommerce_thankyou`.
- Footer fallback for custom themes.
- Browser-side DOM scraping fallback when `window.adnova_order_data` missing.
- WooCommerce attribution metadata from `_wc_order_attribution_*`.
- Server-side capture on `payment_complete`, `processing`, `completed`.
- Syncs Woo orders directly to backend `orders` in real time.
- Recent order backfill on activation or update.
- Auto-update from staging.
- Sends `refund_amount`, `orders_count`, `chargeback_flag`, `raw_source`, `collected_at` in sync payloads.
- Re-syncs on refund hook (`woocommerce_order_refunded`).
- Captures checkout email/phone on `blur`/`change`, sends `email_hash` and `phone_hash` in `identity_signal`.

### Woo fields still missing or partial

- `email_hash` / `phone_hash` at checkout typing-time (pre-submit): partial — reliable at order/login, not at first keystroke.
- `session_end_at` explicit close marker: partial (fallback is `last_event_at`).
- `page_events[]` session array: partial (row-by-row in `events`, not an array in `sessions`).
- `ga4_session_source` canonical field: field exists in schema; population path not fully validated.
- `chargeback_flag` from disputes API: partial (heuristic only).

### Installation

1. Compress `adnova-pixel` folder as `.zip`.
2. WordPress `Plugins > Add New > Upload Plugin`.
3. Upload and activate.

### Plugin changelog

#### `1.1.x`
- Auto-update from staging.
- Sends `refund_amount`, `orders_count`, `chargeback_flag`, `raw_source`, `collected_at`.
- Re-sync on refund.
- Checkout blur identity capture.

#### `1.0.4`
- Direct Woo order sync to backend.
- Recent order backfill on activation/update.

#### `1.0.3`
- Server-side purchase capture in payment and status hooks.
- Stronger WooCommerce source fallback fields.

#### `1.0.2`
- Sends UTM and click ID attribution from WooCommerce order metadata.

#### `1.0.1`
- Better purchase capture in custom checkouts.
- Browser-side fallback for totals and items.

#### `1.0.0`
- Initial auto-configuration by domain.

### Troubleshooting

If purchase arrives with `$0` or no items:
- Confirm thank-you page is the real `order-received` page.
- Use plugin version `1.0.1` or later.

If attribution incomplete:
- Confirm landing URLs include `utm_source`, `utm_medium`, `utm_campaign`.
- Confirm backend checkout-to-order mapping and attribution rules are functioning.

---

## Pixel Installation

### Merchant snippet (HTML `<head>`)

```html
<script src="https://adray-app-staging-german.onrender.com/adray-pixel.js"
        data-account-id="merchant-domain-or-acct-id"></script>
```

Notes:
- `data-account-id` must be a plain value without protocol or trailing slash.
- Initial `page_view` should reach `/collect` before any cart action.

---

## Shopify Embedded App

### Review requirements

Every `401` caused by an invalid Shopify session token must return:
- `X-Shopify-Retry-Invalid-Session-Request: 1`
- `X-Shopify-API-Request-Failure-Reauthorize: 1`

### Required backend files

- `middlewares/verifySessionToken.js` — JWT validation, reauthorization headers
- `backend/routes/secure.js` — protected endpoints
- `backend/index.js` — CORS, session token bypass list, secure routes mount
- `public/connector/interface.connector.js` — App Bridge, session-token retrieval

### Required env vars for Shopify embedded

```
SHOPIFY_API_KEY=<client id>
SHOPIFY_API_SECRET=<client secret>
APP_URL=https://adray.ai
SESSION_SECRET=<long random string>
```

---

## Frontend Workspaces

All frontend apps are Git submodules. Stack: Vite + TypeScript + React + shadcn-ui + Tailwind CSS.

| Submodule | Lovable project | Notes |
|-----------|----------------|-------|
| `dashboard-src` | https://lovable.dev/projects/67643995-c0b5-4b9b-bc02-dc5bf96f004b | Main dashboard; served by backend |
| `plan-src` | https://lovable.dev/projects/8450252f-ea5d-404e-9f07-f726bf2a1cba | ⚠️ repo currently inaccessible |
| `saas-landing` | https://lovable.dev/projects/d37e7296-de93-463c-b522-03cb9606122b | SaaS landing page |
| `support-src` | https://lovable.dev/projects/3ef68002-d162-44ba-8b83-a00c513b5cd9 | Support UI |
| `bookcall-src` | — | Bookcall UI |

### Dashboard serving behavior

- Backend serves `dashboard-src/dist` when it exists.
- Falls back to `public/dashboard` if `dist` does not exist.
- `dashboard-src/dist` is gitignored in the submodule.
- `render.yaml` now includes `npm run build:dashboard` in the web build command.

### Dashboard deploy workflow

```sh
# 1. Make changes inside the submodule
cd dashboard-src
git switch -c my-dashboard-branch   # if in detached HEAD
git add src/App.tsx src/components/...
git commit -m "describe change"
git push -u origin my-dashboard-branch

# 2. Update submodule pointer in root repo
cd ..
git add dashboard-src README.md
git commit -m "update dashboard submodule"
git push origin german/dev
```

### Standard local workflow for any frontend

```sh
npm i
npm run dev
```

### Rules
- Do not commit `.env`.
- Do not commit `dashboard-src/dist`.
- Commit and push submodule first, then root repo.

---

## Repo Setup

### Clone with submodules

```bash
git clone https://github.com/EnovaBusinessSolutions/adnova-app.git
cd adnova-app
git submodule update --init --recursive
```

If `plan-src` fails with `Repository not found`, skip it and continue — it is currently inaccessible.

### Restore empty submodule directories

```powershell
foreach ($sub in @("bookcall-src", "dashboard-src", "saas-landing", "support-src")) {
    Push-Location $sub
    git reset --hard HEAD
    Pop-Location
}
```

### Submodule table

| Submodule | URL |
|-----------|-----|
| `saas-landing` | https://github.com/EnovaBusinessSolutions/landingpagesaas-html.git |
| `dashboard-src` | https://github.com/EnovaBusinessSolutions/adnova-ai-dashboard-full.git |
| `support-src` | https://github.com/EnovaBusinessSolutions/adnova-ai-support |
| `bookcall-src` | https://github.com/EnovaBusinessSolutions/bookcall-adnova.git |
| `plan-src` | https://github.com/EnovaBusinessSolutions/adnova-plan-zen-1.git — ⚠️ inaccessible |

---

## Definition of Done

The system is considered production-ready when all are true:

- `POST /collect` returns `2xx` consistently and persists events.
- Purchases arrive in `orders` for WooCommerce and Shopify.
- Attribution fields in `orders` are populated for a meaningful percentage of orders.
- `merchant_snapshots` updates without critical failures.
- Meta CAPI and Google conversions endpoints are real and not placeholders.
- Dashboard reflects revenue and channel metrics without relying on fragile fallbacks.
- Shopify pixel validated end-to-end (same evidence bar as WooCommerce).

---

---

## BRI Testing Guide (updated 2026-04-14)

Checklist completa para verificar que la infraestructura de grabación funciona end-to-end después de deploy.

### Pre-requisitos antes de testear

1. Las variables de entorno BRI deben estar configuradas en Render (`R2_*`, `OPENROUTER_API_KEY`, `HMAC_*`).
2. El bucket `adray-recordings` debe existir en Cloudflare R2 con CORS habilitado para el dominio del dashboard.
3. Los tres servicios de Render deben estar corriendo: `adnova-ai`, `adnova-ai-mcp-worker`, `adnova-ai-recording-worker`.
4. El pixel debe estar cargando en la tienda de prueba (`data-account-id` configurado).

---

### Test 1 — Pixel dispara recording al hacer AddToCart

**Qué verificar:** el pixel lazy-carga rrweb y envía los chunks al backend.

1. Abre DevTools → Network en la tienda de prueba.
2. Agrega cualquier producto al carrito.
3. En Network, filtra por `/recording`:
   - Debes ver `POST /recording/start` → respuesta `{ "ok": true, "recording_id": "rec_..." }`
   - A los ~4 segundos debes ver `POST /recording/chunk` → `{ "ok": true }`
   - Los chunks deben seguir llegando cada 4s mientras navegas por el checkout.
4. En Network, filtra por `rrweb` — debes ver que `rrweb.min.js` se cargó desde `cdn.jsdelivr.net`.

**Si falla:** Revisar que `ADRAY_ENDPOINT` en el pixel apunta al servidor correcto. Verificar CORS en `/recording/*`.

---

### Test 2 — Schema migrado correctamente (tablas BRI en PostgreSQL)

**Qué verificar:** las nuevas tablas existen en la base de datos.

Conecta a la DB (Neon dashboard o psql) y ejecuta:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('session_recordings', 'abandonment_risk_scores', 'abandonment_cohorts');
-- Deben aparecer las 3 tablas

SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'rrweb_recording_id';
-- Debe aparecer 1 fila
```

**Si falla:** revisar los logs de Render para el inicio del servicio web — `migrate-recordings-schema.js` debe haber corrido sin error.

---

### Test 3 — Recording guardado en PostgreSQL

**Qué verificar:** la fila `session_recordings` se crea con status correcto.

Después de Test 1, ejecuta:

```sql
SELECT recording_id, session_id, status, chunk_count, outcome
FROM session_recordings
ORDER BY created_at DESC
LIMIT 5;
```

Esperado:
- `status = 'RECORDING'` mientras el usuario sigue navegando
- `status = 'FINALIZING'` justo después de `POST /recording/end`
- `status = 'READY'` después de que el worker procesa el job (puede tomar 10-60s)

---

### Test 4 — Chunks almacenados en Cloudflare R2

**Qué verificar:** los archivos de chunk y el objeto final existen en R2.

1. Cloudflare dashboard → R2 → `adray-recordings` → Browse.
2. Navega a `recordings/<account_id>/<recording_id>/chunks/` — deben existir archivos `000000.json.gz`, `000001.json.gz`, etc.
3. Después de que el worker finaliza: navega a `recordings/<account_id>/<YYYY-MM>/` — debe existir `<recording_id>.rrweb.gz`.

**Si los chunks no aparecen:** verificar que `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` son correctos. Revisar logs del web service.

**Si el objeto final no aparece:** revisar logs del `adnova-ai-recording-worker` en Render.

---

### Test 5 — Player inline en el Selected Journey panel

**Qué verificar:** el botón "Ver grabación" aparece y reproduce el video inline.

1. Abre el attribution dashboard (`/adray-analytics.html?shopId=<account_id>`).
2. En la sección "Historical Conversion Journeys" o "Recent Purchases", haz click en un order que tenga una grabación (`rrwebRecordingId` no nulo).
3. Debe aparecer el botón **"Ver grabación"** en morado al lado de "Download CSV".
4. Click en el botón:
   - Se carga el spinner "Cargando grabación…"
   - Se lazy-carga `rrweb-player` desde CDN
   - El player aparece inline con controles de reproducción (play, timeline, velocidad)
5. Verifica que el video muestra el DOM de la tienda desde el momento del AddToCart.

**Fallback Clarity:** si la sesión tiene `clarityPlaybackUrl` pero no `rrwebRecordingId`, debe aparecer el link "Ver grabación" morado oscuro que abre Clarity en tab nueva.

**Si el player no carga:** revisar que el bucket R2 tiene CORS habilitado para el origen del dashboard. El error más común es `Access-Control-Allow-Origin` faltante.

---

### Test 6 — Señales conductuales extraídas (behavioral signals)

**Qué verificar:** el worker extrae señales y las guarda en `behavioral_signals`.

1. Haz una sesión de prueba: agrega al carrito → llega al checkout → **simula abandono** (cierra el tab o navega a otra página).
2. Espera ~2-3 minutos (worker procesa `finalize` + `extract-signals`).
3. Consulta:

```sql
SELECT recording_id, outcome, behavioral_signals->>'riskScore' AS risk,
       behavioral_signals->>'abandonmentPattern' AS pattern,
       behavioral_signals->>'archetype' AS archetype
FROM session_recordings
WHERE outcome = 'ABANDONED'
ORDER BY created_at DESC LIMIT 5;
```

Esperado: `outcome = 'ABANDONED'`, `riskScore` entre 0-100, `pattern` = uno de los 5 patrones, y si `riskScore >= 60` debes ver `archetype` con el valor del LLM.

---

### Test 7 — Narrativa LLM generada (riskScore >= 60)

**Qué verificar:** el LLM genera un archetype + narrative en español.

1. Asegúrate de que `OPENROUTER_API_KEY` está configurado.
2. En la sesión de prueba del Test 6, navega hasta la sección de shipping/total y quédate ~10-15 segundos sin mover el mouse, luego cierra el tab.
3. Consulta:

```sql
SELECT behavioral_signals->>'archetype' AS archetype,
       behavioral_signals->>'confidence_score' AS confidence,
       behavioral_signals->>'narrative' AS narrative,
       behavioral_signals->>'recommended_action' AS action
FROM session_recordings
WHERE behavioral_signals->>'riskScore' IS NOT NULL
ORDER BY created_at DESC LIMIT 3;
```

Esperado: `archetype` = uno de los 9 valores válidos, `narrative` en español, `recommended_action` con recomendación específica.

**Si no genera narrative:** revisar logs del recording worker. Si dice `OPENROUTER_API_KEY not set`, el env var no llegó al worker service.

---

### Test 8 — Borrado automático del raw recording (24h)

**Qué verificar:** después de 24h, el raw `.rrweb.gz` en R2 se borra pero `behavioral_signals` persiste.

Este test es de larga duración. Para verificarlo manualmente antes de esperar 24h, puedes reducir `RECORDING_RETENTION_HOURS=0.1` temporalmente (6 minutos) en el Render env del worker, desplegar, esperar, y luego verificar:

```sql
SELECT recording_id, raw_erased_at, r2_key,
       (behavioral_signals IS NOT NULL) AS signals_intact
FROM session_recordings
WHERE raw_erased_at IS NOT NULL
LIMIT 5;
```

Esperado: `raw_erased_at` tiene timestamp, `r2_key = null`, `signals_intact = true`.

En R2, confirma que el archivo `recordings/<account_id>/<YYYY-MM>/<recording_id>.rrweb.gz` ya no existe.

---

### Test 9 — Fallback si R2 no está configurado

**Qué verificar:** si las vars de R2 no están, el sistema no crashea — solo no guarda grabaciones.

1. En staging, comenta temporalmente `R2_ENDPOINT` en Render.
2. Haz un AddToCart en la tienda de prueba.
3. Verifica que:
   - El `/collect` principal sigue funcionando (otros eventos no se afectan)
   - `POST /recording/start` devuelve `{ "ok": true }` (sin error)
   - `POST /recording/chunk` devuelve `{ "ok": false }` con mensaje de error pero sin `500`
   - El dashboard carga sin errores (sin el botón "Ver grabación")

---

### Test 10 — HMAC-SHA-256 en identity graph

**Qué verificar:** los nuevos eventos usan HMAC en lugar de SHA-256 para PII.

1. Configura `HMAC_EMAIL_KEY` y `HMAC_PHONE_KEY`.
2. Ejecuta la migración: `node backend/scripts/migrate-hmac-hashes.js`.
3. Verifica output: `Done — re-hashed N identity_graph rows.`
4. Haz una nueva compra de prueba con un email conocido.
5. Consulta:

```sql
SELECT email_hash FROM identity_graph
WHERE account_id = '<tu_account_id>'
ORDER BY last_seen_at DESC LIMIT 3;
```

6. Verifica localmente que el hash coincide con HMAC:
```javascript
const crypto = require('crypto');
const key = Buffer.from(process.env.HMAC_EMAIL_KEY, 'hex');
console.log(crypto.createHmac('sha256', key).update('tu@email.com'.toLowerCase().trim()).digest('hex'));
```

---

### Test 11 — Worker de recording corriendo en Render

**Qué verificar:** el tercer servicio está activo.

1. Render dashboard → Services → `adnova-ai-recording-worker` → status `Live`.
2. En los logs debe aparecer:
   ```
   [recordingWorker] Started on queue "recording-process" (prefix: bull)
   ```
3. Cuando llegue un job, los logs deben mostrar:
   ```
   [recordingWorker:finalize] rec_xxx... reason=session_end
   [recordingWorker:finalize] rec_xxx... READY — N events, X bytes
   [recordingWorker:extract-signals] rec_xxx... signals saved, riskScore=NN
   ```

---

### Qué verás en el dashboard después del deploy

| Elemento | Dónde | Cuándo aparece |
|---|---|---|
| Botón **"Ver grabación"** morado | Selected Journey panel → al lado de Download CSV | Cuando la sesión tenga una grabación con `status=READY` |
| Player rrweb inline | Dentro del Selected Journey panel | Al hacer click en el botón |
| Badge de archetype | Dentro del player (debajo del video) | Si `riskScore >= 60` y OPENROUTER_API_KEY está configurado |
| Narrative en español | Debajo del badge | Mismo caso que arriba |
| Link Clarity (fallback) | Same location | Sesiones anteriores con Clarity pero sin rrweb |
| Nuevo worker en Render | Render dashboard → Services | Después del deploy |

---

## Final Rule

Treat this `README.md` as the single source of truth for project status, roadmap, plugin behavior, Shopify embedded-app requirements, operational validation, and frontend workspace references.
