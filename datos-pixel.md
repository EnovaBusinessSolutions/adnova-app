ADRAY Phase 1 — Data Storage Reference
March 2026 · Confidential
What to Store in Phase 1 v1.0
Everything Phase 2 identity graph resolution requires, captured from day one.
The principle: Events not stored at Phase 1 launch are permanently gone. Phase 2's identity graph
resolves backward from confirmed revenue — it needs every identifier, every session signal, and every
order anchor to have been collected from the first pixel fire. These six layers are the minimum viable
dataset for a persistent identity graph.
LAYER 1 Identity anchors
user_key
UUID, server-set cookie. Primary
identity node. Every event in the
system carries this.
email_hash
SHA-256. Captured at checkout blur
— when they type, before submit.
Cross-device anchor.
phone_hash
SHA-256. Captured at checkout.
Second deterministic cross-device
signal.
customer_id
Shopify customer ID. Deterministic.
Links authenticated sessions to
order history.
Phase 2 dependency: These four fields become the node types in the identity graph. email_hash and phone_hash
enable cross-device stitching without CNAME or browser persistence. Capture email_hash at first keystroke in checkout
— waiting for the Shopify webhook loses the session-identity link.
LAYER 2 Session events
session_id
UUID per visit. The atomic unit of
the 7-day journey story.
utm_source
UTM source parameter. Captured at
landing URL on every session start.
utm_medium
UTM medium. Stored per session,
not just per order.
utm_campaign
Campaign name. Required for
ROAS attribution by campaign.
fingerprint_hash
SHA-256 of device signals.
Probabilistic fallback when cookies
absent.
ip_hash
Hashed IP only — never raw. Cooccurrence signal for graph edges.
page_events[]
Array: view / add_to_cart /
checkout_start / purchase. With
timestamps.
session_start_at
Epoch ms. Start of visit. Time
between sessions is attribution
data.
session_end_at
Epoch ms. End of visit. Duration
signal for engagement quality.
Phase 2 dependency: fingerprint_hash is the probabilistic fallback when user_key cookie is absent (new device,
cleared browser). ip_hash enables co-occurrence matching — two sessions from the same IP in the same window are a
candidate graph edge. Store both even though V1 doesn't use them.
LAYER 3 Touchpoints — click IDs
fbclid
Meta click ID. Captured at landing
URL. Stored against user_key +
session_id.
gclid
Google click ID. Same capture
pattern as fbclid.
ttclid
TikTok click ID. Store now even
though TikTok is not a V1 source.
event_id
Server-generated UUID. Dedup key
sent to CAPI and browser pixel.
Never browser-generated.
landing_page
Full URL of first page in session.
Path + params. Not just domain.
referrer
HTTP referrer at session start.
Direct / organic / social signal.
Phase 2 dependency: All click IDs are stored against user_key — not just the converting session's click ID. Every
touchpoint's click ID becomes a graph edge. event_id must be server-generated so CAPI deduplication is reliable.
Browser-generated IDs create dedup gaps on server-only events.
LAYER 4 Order truth — Shopify webhook
order_id
Shopify order ID. Ground truth
anchor. All attribution resolves
toward this.
gross_revenue
Order total from Shopify. Not
platform-reported. The real
number.
refund_amount
From orders/updated webhook.
Applied to Real ROAS. Store as it
arrives.
chargeback_flag
Boolean from Disputes API.
Deducted from Real ROAS
calculation.
orders_count
Customer's order count at time of
purchase. Stamps new vs returning
permanently.
checkout_token
The session-to-order stitch key.
From checkouts/create. Critical —
see note.
customer_id
Shopify customer ID on the order.
Links order to identity graph node.
created_at
Webhook timestamp. Epoch ms.
The moment of confirmed revenue
truth.
Critical: orders_count must be stamped at the moment of the webhook — not computed later. A returning customer's
subsequent order that arrives after more orders will compute incorrectly if you recalculate. Stamp it once, immutably.
checkout_token mapped to session_id at checkouts/create is the single most important stitch in the
entire system. Without it the 7-day journey breaks and Phase 2 has no backward-resolution anchor.
LAYER 5 Platform signals — daily pull
meta_spend
Campaign-level daily spend from
Meta Ads API. ROAS denominator.
meta_impressions
Campaign impressions. Required
for CPM and reach analysis.
meta_reported_conv_value
Meta's reported conversion value.
The number to compare against
Real ROAS.
google_spend
Campaign-level daily spend from
Google Ads API.
google_clicks
Clicks per campaign. CPC
calculation and traffic quality
signal.
ga4_session_source
GA4 attribution source. Crossreference against pixel session
data.
Phase 2 dependency: Historical spend data is required to backfill ROAS analysis retroactively. Pull and store daily
from day one. If spend history is missing, you cannot calculate ROAS for any period before the gap — this data cannot
be reconstructed.
LAYER 6 Raw enrichment — on every event
confidence_score
0.0–1.0. Per identity link. 1.0 =
deterministic. 0.6 = fingerprint
only.
match_type
Enum: deterministic / probabilistic.
The graph must know which edges
to trust.
raw_source
Enum: pixel / webhook / api. Every
event's origin. Required for audit.
collected_at
Epoch ms. When Adray received
the event — not when it fired.
Latency signal.
Phase 2 dependency: The frontier model layer reads confidence_score and match_type to arbitrate merge conflicts.
Without these fields, every identity link is treated as equal — making false merge detection impossible. Store on every
event from day one. V1 doesn't use them. Phase 2 cannot function without them.
⚠ Single most important stitch
checkout_token → session_id must be written to the database at the moment Shopify fires checkouts/
create — not at orders/create. By the time the order webhook fires, the browser session context may be
gone. This mapping is the bridge between a browsing session and a confirmed order. Lose it and the entire
backward-resolution chain breaks. Phase 2's identity graph has no anchor without it.
ADRAY · adray.ai · Confidential Phase 1 Data Storage Reference · March 2026