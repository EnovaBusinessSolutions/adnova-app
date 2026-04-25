# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Adray** is a B2B SaaS platform for marketing attribution analytics across Shopify, WooCommerce, and custom ecommerce sites. It collects pixel events, resolves user identity, stitches sessions to orders, and surfaces channel-level ROAS in a React dashboard.

`README.md` is the authoritative source of truth for current status, known gaps, and next priorities — read it before making significant changes.

## Tech Stack

- **Backend:** Node.js + Express (port 3000), entry point `backend/index.js`
- **Primary DB:** MongoDB via Mongoose (`backend/models/`) — fuente de verdad del producto. Aquí viven User, OAuth tokens, MetaAccount, GoogleAccount, ShopConnections, AnalyticsEvent, McpData, PixelSelection, SignalData, Audit, TaxProfile, Workspace, WorkspaceMember, WorkspaceInvitation, etc.
- **Aux DB:** PostgreSQL via Prisma ORM (`backend/prisma/schema.prisma`) — usado SOLO para sub-features aisladas: session recordings (`backend/workers/recordingWorker.js`, `backend/services/personResolver.js`) y el pixel auditor (`backend/tsconfig.pixel-auditor.json`). El producto principal NO depende de Postgres. No agregar tablas nuevas a Prisma sin coordinarse con el dueño de esas sub-features.
- **Cache / Queue:** Redis + BullMQ (`backend/queues/`, `backend/workers/`)
- **Dashboard:** React 18 + TypeScript + Vite + shadcn-ui + Tailwind (`dashboard-src/`)
  - Attribution panel lives in `dashboard-src/src/features/attribution/` — fully native React (no iframe). Route: `/dashboard/attribution`.
- **Landing Page:** Next.js + React 19 + Tailwind 4 (`landing-adray/`)
- **MCP Server:** OAuth 2.0 + 8 read-only tools for AI analysis (`backend/mcp/`)

## Commands

### Install & Generate
```bash
npm install
npm run prisma:generate        # Must run after pulling schema changes
```

### Run
```bash
npm start                      # Backend on :3000
npm run dev:landing            # Landing dev server on :3010
npm run worker:mcp             # BullMQ worker (separate process)
```

### Build
```bash
npm run build                  # Full build: landing + dashboard + Prisma
npm run build:dashboard        # dashboard-src only
npm run build:landing          # landing-adray only
```

### Test
```bash
npm test                       # Jest (backend/mcp/__tests__/)
npm run test:mcp               # MCP-specific tests
npm run test:shopify-session   # Shopify session smoke test
npm run mcp:smoke:staging      # Integration test vs staging
```

### Lint
```bash
cd dashboard-src && npm run lint
cd landing-adray && npm run lint
```

### Database
```bash
npm run prisma:migrate         # Run pending migrations
npm run prisma:push            # Schema-first push (no migration file)
npm run prisma:deploy          # Deploy migrations to production
npm run db:backfill:layer45    # Backfill session source (Layer 4/5)
npm run db:pc:dedupe           # Remove duplicate platform connections
```

## Architecture

### Event Pipeline (core data flow)
1. **Pixel** (`public/adray-pixel.js`) fires from merchant storefront → `POST /collect`
2. **Collector** (`backend/routes/collect.js` + `backend/services/collectService.js`): identity resolution, session persistence, event dedup
3. **Webhooks** (`backend/routes/adrayWebhooks.js`): Shopify/WooCommerce orders and checkouts
4. **Attribution Stitching** (`backend/services/attributionStitching.js`): links checkout token → session → assigns channel + confidence score (1.0 click ID → 0.85 UTM → 0.6 fingerprint → 0.0 none)
5. **CAPI Fanout** (`backend/services/capiFanout.js`): parallel, non-blocking push to Meta CAPI and Google Conversions API
6. **Merchant Snapshot** (`backend/services/merchantSnapshot.js`): aggregates metrics into `merchant_snapshots` Prisma table
7. **Dashboard** (`dashboard-src/src/`): React app consuming backend analytics endpoints, Live Feed via SSE

### Key Service Files
| File | Role |
|------|------|
| `backend/routes/collect.js` | POST /collect — pixel ingestion, rate-limited (100 req/min/merchant) |
| `backend/routes/adrayWebhooks.js` | Shopify + WooCommerce webhook handlers |
| `backend/routes/analytics.js` | Dashboard analytics endpoints |
| `backend/services/attributionStitching.js` | Order → session attribution with confidence scoring |
| `backend/services/identityResolution.js` | User identity matching (cookie, click ID, fingerprint, customer ID) |
| `backend/services/mcpContextBuilder.js` | Builds LLM-ready context from Prisma + snapshots |
| `backend/mcp/server.js` | MCP HTTP transport + tools |
| `backend/mcp/tools/` | 8 tools: ads performance, revenue, funnel, etc. |
| `backend/workers/mcpWorker.js` | BullMQ consumer for async MCP jobs |

### Database Pattern

MongoDB (Mongoose) is the **canonical store** for the Adray product: users, OAuth tokens, platform connections (Meta, Google, Shopify), pixel events, MCP data, signal data, audits, workspaces, and workspace memberships.

PostgreSQL (Prisma) is used only for two isolated sub-features that have their own data domain: session recordings (BRI Phase 4–7 work in `backend/workers/recordingWorker.js`) and the pixel auditor (`backend/tsconfig.pixel-auditor.json`). These sub-features are owned by a separate dev and should not be modified without coordination.

When adding new product features, default to MongoDB/Mongoose unless you are extending session recordings or pixel auditor specifically.

### Identity Resolution
The `_adray_uid` cookie is the primary identity key. Fallback chain: `click_id` (URL param) → `customer_id` (from platform) → email/phone hash → browser fingerprint. Identity records live in the `IdentityGraph` Prisma table.

### MCP (Model Context Protocol)
`backend/mcp/` implements an OAuth 2.0-protected MCP server with snapshot-first caching (configurable via `MCP_SNAPSHOT_FIRST_ENABLED`). Snapshots in MongoDB reduce calls to Meta/Google APIs. The worker (`workers/mcpWorker.js`) processes jobs from `mcpQueue` asynchronously.

## Deployment

- Hosted on **Render.com** — config in `render.yaml`
- Render auto-deploys `main` branch
- `RENDER_EXTERNAL_URL` is used to auto-detect `APP_URL` for OAuth callbacks
- Staging: `https://adray-app-staging-german.onrender.com`

## Key Environment Variables

```
DATABASE_URL           # PostgreSQL (Prisma)
MONGO_URI              # MongoDB
REDIS_URL              # Redis / BullMQ
SESSION_SECRET
ENCRYPTION_KEY         # Token encryption — must be stable across restarts in prod
FACEBOOK_APP_ID / FACEBOOK_APP_SECRET
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN
SHOPIFY_API_KEY / SHOPIFY_API_SECRET / SHOPIFY_WEBHOOK_SECRET
OPENAI_API_KEY
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
RESEND_API_KEY
APP_URL
```

> `ENCRYPTION_KEY` regenerating on restart is a known P1 risk — do not introduce patterns that re-derive it at startup.

## Known Issues (P0/P1)

- `/collect` can be unstable in production — add stack trace capture before modifying that route
- Prisma + Mongo data-layer mismatch in some flows (e.g., session resolution)
- Meta CAPI implementation is a placeholder — not production-ready
- Rate limit key still uses legacy `shop_id` for non-Shopify merchants
- Export CSV endpoints (`/api/analytics/:id/export/candidates`, `/api/analytics/:id/export/download`) are not yet implemented in the backend — the Export button in the Attribution panel does client-side CSV export of in-memory data
- rrweb-player is not installed in `dashboard-src` — the Session Detail panel links to presigned URLs instead of embedding a player

## Development Guidelines

- Explore relevant code before proposing changes — the codebase is wide
- Keep `README.md` updated after relevant improvements
- Push feature branches to `german/dev` before merging to `main`
- The `dashboard-src/` and `landing-adray/` directories are independent npm workspaces — run their install/lint/build commands from within their own directories
