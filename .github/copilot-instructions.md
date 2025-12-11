# Adnova AI - Copilot Instructions

## Project Overview

Adnova AI is a SaaS platform for e-commerce advertising audit and analytics. It integrates **Google Ads**, **Meta Ads**, **Google Analytics (GA4)**, and **Shopify** to generate AI-powered audit reports for digital marketing campaigns.

## Architecture

### Backend (`backend/`)
- **Entry point**: `backend/index.js` - Express 5 server with Passport sessions, MongoDB, and multi-tenant auth
- **Auth flow**: `backend/auth.js` uses Passport Google OAuth + email/password with `bcrypt`
- **Two Shopify integrations**:
  - `routes/shopify.js` - SAAS flow (user connects their store via onboarding)
  - `routes/shopifyConnector/` - Embedded app flow (installed from Shopify Admin)

### Data Models (`backend/models/`)
- `User.js` - Master user record with subscription info and account linking flags
- `GoogleAccount.js`, `MetaAccount.js`, `ShopConnections.js` - OAuth tokens and ad account metadata per user
- `Audit.js` - Stores AI-generated audit results with issues, KPIs, and snapshots

### Audit Pipeline (`backend/jobs/`)
```
auditJob.js (orchestrator)
├── collect/googleCollector.js      # Fetches Google Ads data
├── collect/metaCollector.js        # Fetches Meta Ads data
├── collect/shopifyCollector.js     # Fetches Shopify orders/products
├── collect/googleAnalyticsCollector.js  # Fetches GA4 data
└── llm/generateAudit.js            # OpenAI GPT-4o-mini analysis
```
Key function: `runAuditFor(userId, types, options)` in `auditJob.js`

### Frontend Structure
- `public/` - Static HTML/CSS/JS for landing, login, onboarding
- `dashboard-src/` - Separate build (Vite/React) deployed to `public/dashboard/`
- `frontend/` - Shopify connector UI, builds to `public/connector/interface.bundle.js`

## Key Patterns

### ID Normalization
All ad platform IDs are normalized before storage/comparison:
```javascript
// Google: strip "customers/" prefix and dashes
normGoogle = (s) => String(s).replace(/^customers\//, '').replace(/-/g, '');

// Meta: strip "act_" prefix
normMeta = (s) => String(s).replace(/^act_/, '');

// GA4: ensure "properties/123" format
normGaPropertyId = (val) => /^properties\/\d+$/.test(val) ? val : `properties/${digits}`;
```

### Auth Middleware
Use these guards from `backend/index.js`:
- `sessionGuard` - Returns 401 JSON for API routes
- `ensureAuthenticated` - Redirects to `/login` for page routes
- `ensureNotOnboarded` - Redirects completed users to `/dashboard`

### Audit Severity & Areas
Issues use Spanish severity levels normalized in `Audit.js`:
- Severity: `alta` | `media` | `baja` (accepts `high`/`medium`/`low` on input)
- Areas: `setup` | `performance` | `creative` | `tracking` | `budget` | `bidding` | `otros`

### CSP Contexts
Two Content Security Policy configs in `middlewares/csp.js`:
- `publicCSP` - Standard pages (landing, dashboard)
- `shopifyCSP` - Embedded Shopify app (allows iframe from `admin.shopify.com`)

## Development Commands

```bash
npm start                # Run backend (backend/index.js)
npm run build:dashboard  # Build dashboard-src → dashboard-src/dist
npm run build            # Alias for build:dashboard
```

For local development with dashboard hot-reload, run the dashboard-src dev server separately.

## Environment Variables

Required for core functionality:
- `MONGO_URI` - MongoDB Atlas connection
- `SESSION_SECRET` - Express session secret
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - Google OAuth
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES` - Shopify OAuth
- `OPENAI_API_KEY` - For audit generation (`gpt-4o-mini` default)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` - Billing

## Code Conventions

- Use `'use strict';` at top of all backend files
- Logger: Import from `backend/utils/logger.js` - auto-sanitizes sensitive data
- Spanish comments/variable names common (e.g., `resumen`, `auditoría`)
- Webhook routes need raw body parsing BEFORE `express.json()` middleware
- Plan tiers: `gratis` | `emprendedor` | `crecimiento` | `pro`

## API Route Structure

```
/api/audits/*           - Audit CRUD and runner
/api/google/ads/*       - Google Ads insights
/api/google/analytics/* - GA4 data
/api/meta/*             - Meta Ads data and accounts
/api/shopify/*          - Shopify SAAS integration
/connector/*            - Shopify embedded app (separate CSP)
/auth/google/*          - Google OAuth flow
/auth/meta/*            - Meta OAuth flow
```

## Testing Audits Locally

To test the audit pipeline, you need:
1. A user with connected accounts in `GoogleAccount`/`MetaAccount`/`ShopConnections`
2. Valid OAuth tokens (refresh if expired)
3. Call `POST /api/audits/start` with session auth
