You are building the core data pipeline for AdRay, a Shopify app that collects first-party ecommerce events, stitches attribution, and sends enriched conversion events to ad platforms via server-side APIs.

Build the complete backend system with the following spec:

---

## TECH STACK
- Node.js + Express
- PostgreSQL (Prisma ORM)
- Redis (event deduplication + session cache)
- Deployed on Railway or Render

---

## DATABASE SCHEMA

Create the following tables via Prisma schema:

### shops
- id (uuid, primary)
- shop_id (string, unique) — Shopify shop domain
- shop_domain (string)
- access_token (string) — Shopify OAuth token
- created_at, updated_at

### platform_connections
- id (uuid, primary)
- shop_id (foreign key → shops)
- platform (enum: META, GOOGLE, TIKTOK)
- access_token (string, encrypted)
- pixel_id (string) — Meta pixel ID or Google conversion action ID
- ad_account_id (string)
- status (enum: ACTIVE, DISCONNECTED, ERROR)
- created_at, updated_at

### identity_graph
- id (uuid, primary)
- shop_id (foreign key → shops)
- user_key (string, indexed) — Adray first-party persistent ID
- customer_id (string, nullable) — Shopify customer ID
- email_hash (string, nullable) — SHA-256
- phone_hash (string, nullable) — SHA-256
- fbp (string, nullable) — Meta browser cookie
- fbc (string, nullable) — Meta click cookie
- fbclid (string, nullable)
- gclid (string, nullable)
- ttclid (string, nullable)
- fingerprint_hash (string, nullable)
- confidence_score (float) — 1.0 deterministic, 0.6 fingerprint
- first_seen_at (timestamp)
- last_seen_at (timestamp)
- device_count (int, default 1)

### sessions
- id (uuid, primary)
- session_id (string, unique, indexed)
- shop_id (foreign key → shops)
- user_key (string, indexed)
- utm_source, utm_medium, utm_campaign, utm_content, utm_term (strings, nullable)
- referrer (string, nullable)
- landing_page_url (string, nullable)
- fbclid, gclid, ttclid (strings, nullable)
- fbp, fbc (strings, nullable)
- is_first_touch (boolean)
- started_at (timestamp)
- last_event_at (timestamp)

### checkout_session_map
- id (uuid, primary)
- checkout_token (string, unique, indexed) — Shopify checkout token
- shop_id (foreign key → shops)
- session_id (string, indexed)
- user_key (string, indexed)
- attribution_snapshot (jsonb) — full UTMs + click IDs at time of checkout
- event_id (string) — pre-assigned UUID for purchase dedup
- created_at (timestamp)
- expires_at (timestamp) — 30 days

### events
- id (uuid, primary)
- event_id (string, unique, indexed) — UUID for deduplication
- shop_id (foreign key → shops)
- session_id (string)
- user_key (string)
- event_name (string) — page_view, view_item, add_to_cart, begin_checkout, purchase
- page_type (string, nullable)
- page_url (string, nullable)
- product_id (string, nullable)
- variant_id (string, nullable)
- cart_id (string, nullable)
- cart_value (float, nullable)
- checkout_token (string, nullable)
- order_id (string, nullable)
- revenue (float, nullable)
- currency (string, nullable)
- items (jsonb, nullable)
- raw_payload (jsonb)
- browser_received_at (timestamp, nullable)
- server_received_at (timestamp, nullable)
- created_at (timestamp)

### orders
- id (uuid, primary)
- order_id (string, unique, indexed) — Shopify order ID
- order_number (string)
- shop_id (foreign key → shops)
- checkout_token (string, indexed)
- user_key (string, nullable)
- session_id (string, nullable)
- customer_id (string, nullable)
- email_hash (string, nullable)
- phone_hash (string, nullable)
- revenue (float)
- subtotal (float)
- discount_total (float)
- shipping_total (float)
- tax_total (float)
- currency (string)
- line_items (jsonb)
- attributed_channel (string, nullable)
- attributed_campaign (string, nullable)
- attributed_adset (string, nullable)
- attributed_ad (string, nullable)
- attributed_click_id (string, nullable)
- attribution_model (string, default 'last_touch')
- attribution_snapshot (jsonb, nullable)
- confidence_score (float, nullable)
- event_id (string, nullable) — for CAPI deduplication
- capi_sent_meta (boolean, default false)
- capi_sent_google (boolean, default false)
- capi_sent_tiktok (boolean, default false)
- capi_meta_response (jsonb, nullable)
- capi_google_response (jsonb, nullable)
- created_at (timestamp)
- shopify_created_at (timestamp)

### event_dedup
- event_id (string, primary)
- shop_id (string)
- order_id (string, nullable)
- event_name (string)
- browser_received_at (timestamp, nullable)
- server_received_at (timestamp, nullable)
- capi_sent_at (timestamp, nullable)
- dedup_status (enum: SINGLE, BROWSER_ONLY, SERVER_ONLY, DEDUPLICATED)

### merchant_snapshots
- id (uuid, primary)
- shop_id (foreign key → shops, unique)
- snapshot (jsonb) — full structured merchant state for LLM consumption
- updated_at (timestamp)

---

## API ENDPOINTS

### POST /collect
The pixel collection endpoint. Receives all browser events.

- Validate request (shop_id required)
- Read or create user_key from first-party cookie
- Set httpOnly cookie: _adray_uid, SameSite=Lax, Secure, Max-Age=63072000
- Parse event payload
- If begin_checkout: store checkout_session_map record with pre-assigned event_id
- Write to events table
- Write to sessions table (upsert)
- Upsert identity_graph record
- Return: { success: true, event_id, user_key }

### POST /webhooks/shopify/:shop_id/orders-create
Shopify orders/create webhook receiver.

- Validate Shopify HMAC signature using X-Shopify-Hmac-SHA256 header
- Parse order payload
- Check idempotency: if order_id already exists in orders table, return 200 and stop
- Look up checkout_token in checkout_session_map
- If found: retrieve session_id, user_key, attribution_snapshot
- If not found: flag as unattributed, continue
- Hash email and phone with SHA-256
- Write full order record to orders table
- Trigger enrichment: call Shopify Admin API to get full product details for line items
- Trigger attribution stitching
- Trigger CAPI fanout (async, non-blocking)
- Update merchant_snapshot
- Return 200

### POST /webhooks/shopify/:shop_id/checkouts-create
- Validate HMAC
- Store checkout_token + shop_id in checkout_session_map if not exists
- Return 200

### GET /api/pixels/:shop_id/meta
- Using stored Meta access token for this shop
- Call GET https://graph.facebook.com/v18.0/me/adspixels?fields=id,name,last_fired_time
- Return list of pixels for merchant to select from

### GET /api/conversions/:shop_id/google
- Using stored Google access token
- Call Google Ads API to list conversion actions for their account
- Return list filtered to WEBPAGE type for merchant to select from

### POST /api/connections/:shop_id
- Save platform connection (pixel_id, ad_account_id, platform)
- Encrypt access token before storing
- Send test event to verify connection
- Return connection status

---

## SERVICES

### IdentityResolutionService
resolveUserKey(shopId, cookieValue, payload):
1. If valid cookie exists → return existing user_key
2. Else if fbclid/gclid/ttclid present → create new user_key, store click_id mapping
3. Else if customer_id present → look up existing user_key for this customer
4. Else compute fingerprint hash from user_agent + ip + timezone + language
5. Look up fingerprint in identity_graph
6. If found → return existing user_key with confidence_score 0.6
7. If not found → create new user_key, store fingerprint
8. Set/refresh cookie in response

### AttributionStitchingService
stitchAttribution(order):
1. Look up checkout_token in checkout_session_map
2. If found → retrieve attribution_snapshot
3. Extract attributed channel from click IDs:
   - fbclid present → channel: 'paid_social', platform: 'facebook'
   - gclid present → channel: 'paid_search', platform: 'google'
   - ttclid present → channel: 'paid_social', platform: 'tiktok'
   - utm_source present → use utm_source/medium
   - referrer present → classify as organic/direct
   - none → unattributed
4. Set confidence_score:
   - click_id present → 1.0
   - utm only → 0.85
   - referrer only → 0.7
   - fingerprint match → 0.6
   - none → 0.0
5. Write to orders table attributed fields
6. Return attributed order

### CAPIFanoutService
sendToAllPlatforms(order):
- Run Meta, Google, TikTok sends in parallel (Promise.all)
- Each send is wrapped in try/catch — one platform failing does not block others

sendToMeta(order):
1. Get shop's Meta connection (pixel_id + access_token)
2. If not connected → skip
3. Build CAPI payload:
   {
     data: [{
       event_name: 'Purchase',
       event_id: order.event_id,
       event_time: unix timestamp,
       action_source: 'website',
       user_data: {
         em: [order.email_hash],
         ph: [order.phone_hash],
         client_ip_address: ip,
         client_user_agent: user_agent,
         fbp: order fbp cookie,
         fbc: order fbc cookie
       },
       custom_data: {
         value: order.revenue,
         currency: order.currency,
         order_id: order.order_id,
         contents: line_items mapped to Meta format
       }
     }]
   }
4. POST to https://graph.facebook.com/v18.0/{pixel_id}/events
5. Store response in orders.capi_meta_response
6. Set orders.capi_sent_meta = true
7. Update event_dedup table

sendToGoogle(order):
1. Get shop's Google connection
2. If no gclid on order → skip (Google requires gclid)
3. Build Enhanced Conversions payload with gclid + value + conversion_action_id
4. POST to Google Ads API uploadClickConversions
5. Store response, update capi_sent_google

### MerchantSnapshotService
updateSnapshot(shopId):
- Query orders table for last 30 days
- Compute:
  - total revenue, order count, AOV
  - revenue by channel (facebook, google, tiktok, email, organic, direct)
  - ROAS per channel (if spend data available)
  - funnel metrics from events table
  - pixel health: events fired vs received vs matched to orders
  - top products by revenue
  - attribution confidence distribution
  - unattributed order count + rate
- Write structured JSON to merchant_snapshots table
- This JSON is the context object passed to LLM

### ShopifyEnrichmentService
enrichOrderLineItems(lineItems, shopId):
- For each line item with variant_id
- Call Shopify Admin API: GET /admin/api/2024-01/variants/{variant_id}.json
- Return enriched items with title, image_url, vendor, product_type, tags
- Cache results in Redis for 1 hour to avoid redundant API calls

---

## SECURITY REQUIREMENTS
- Validate Shopify HMAC on every webhook — reject anything that fails
- Encrypt all platform access tokens at rest using AES-256
- SHA-256 hash all PII (email, phone) before storing or sending
- Never log raw PII
- Validate shop_id on every request matches authenticated session
- Rate limit /collect endpoint: 100 requests per minute per shop

---

## ERROR HANDLING
- All webhook handlers must return 200 even on processing errors — Shopify retries on non-200
- Log errors to a dead letter queue (simple DB table: failed_jobs) for retry
- CAPI failures are non-fatal — log and continue
- Implement exponential backoff retry for CAPI calls: 3 attempts, 1s/5s/30s delays

---

## ENVIRONMENT VARIABLES NEEDED
SHOPIFY_WEBHOOK_SECRET
META_APP_ID
META_APP_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
DATABASE_URL
REDIS_URL
ENCRYPTION_KEY

---

Build this completely. Start with the Prisma schema, then the Express app with all routes, then each service class. Use async/await throughout. Add JSDoc comments on all service methods. The code should be production-ready.