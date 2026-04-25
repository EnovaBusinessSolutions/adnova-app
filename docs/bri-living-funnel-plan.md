# BRI — Living Funnel Plan

**Status:** planning
**Owner:** Germán
**Last updated:** 2026-04-25

---

## 1. Vision

A live, point-cloud funnel where every visiting user becomes a colored dot
classified by behavioral archetype, anchored to the funnel stage they
reached. Like the reference mockup:

```
AD EXPOSURE   (n sessions)   ●  ●  ●  ●  ●  ●  ●  ●
ENGAGED       (n sessions)   ●  ●  ●  ●  ●  ●  ●     ↓ -28%
HIGH INTENT   (n sessions)   ●  ●  ●  ●  ●  ●        ↓ -48%
CHECKOUT      (n sessions)   ●  ●  ●  ●               ↓ -61%
CONVERTED     (n sessions)   ●  ●                     ↓ -77%

Legend:
● Systematic Gift Shopper      ● Comparison Browser
● Returning Loyal              ● Price Sensitive
● Focused Researcher           ● Abandonment Risk
● Impulse Converter            ● New Visitor
```

The funnel must answer two questions at a glance:

1. **Where do users drop off?** (% lost between stages)
2. **Why do they drop off?** (which archetype concentrates the loss)

This makes BRI an actionable optimization tool, not just a session viewer.

---

## 2. Current state

What we already have (post the rrweb pipeline PRs):

| Layer | Source | Granularity |
|-------|--------|-------------|
| Recording | `SessionRecording` | rrweb chunks in R2 (24h retention) |
| Packet | `SessionPacket` | keyframes + signals + outcome (permanent) |
| Per-session AI | `SessionPacket.aiAnalysis` | archetype, narrative, NBA |
| Cross-session AI | `PersonAnalysis` | tier, LTV, retention insight |
| Live ingest | pixel → `/recording/buf` | rrweb every 4s |

What we **don't** have:

- A taxonomy of archetypes that's stable enough to plot (current LLM
  output is free-form: `vip`, `comparison_browser`, `new_convert`, etc.).
- A "funnel stage" classifier per session (we have `outcome`:
  PURCHASED/ABANDONED/STILL_BROWSING/BOUNCED — too coarse for 5-stage funnel).
- Survival of insights when raw R2 is erased (we already keep packets, so
  this is mostly OK, but we still depend on R2 for re-analysis).
- A meta-analysis layer that mines packets across an account to discover
  recurring archetype clusters and label them with merchant-specific copy
  (e.g. "abandons at shipping cost" instead of generic `price_sensitive`).
- A live, dot-per-session UI on top of the funnel.

---

## 3. Proposed pipeline

### Phase A — Ingest survives R2 erasure

**Problem:** today, when R2 retention deletes the raw recording, we can no
longer re-extract keyframes if the original packet was incomplete or the
extractor improved.

**Goal:** the packet is the durable artifact. Raw R2 is a 24h staging area
only. We should never need raw R2 to compute archetype.

**Changes:**

1. Confirm `SessionPacket.keyframes` and `SessionPacket.signals` carry
   100% of the LLM's input. Audit `sessionAnalyst.formatKeyframesForPrompt`
   — anything it reads should already live in the packet. Fix gaps.
2. Stop calling `downloadChunk` from `analyze-pending` and any new
   analysis path. The packet alone is the input.
3. When R2 erasure runs (`handleEraseRaw`), it must be safe — the packet
   already has everything. Document this invariant in code comments.

**Validation:** wipe R2 manually for a sample of READY recordings; their
existing packets keep returning correct archetypes via `analyze-pending`.

### Phase B — Stable funnel stages

**Problem:** `outcome` is one of 4 values. The reference funnel has 5
stages (AD EXPOSURE → ENGAGED → HIGH INTENT → CHECKOUT → CONVERTED).

**Proposal:** derive a `funnel_stage` field on the packet from existing
keyframes. Pure deterministic — no LLM needed at this layer.

```
funnel_stage =
  CONVERTED      if keyframe.purchase exists
  CHECKOUT       elif keyframe.checkout_entry exists
  HIGH_INTENT    elif keyframe.add_to_cart exists
  ENGAGED        elif keyframe.product_view OR keyframe.product_hover exists
                    OR session > 30s
                    OR scrolled past first viewport
  AD_EXPOSURE    otherwise
```

**Implementation:**

1. Add `funnelStage` enum column to `SessionPacket` (Prisma migration).
2. `sessionPacketBuilder.deriveFunnelStage(keyframes)` — pure function,
   unit-testable.
3. Backfill existing packets via a new `/collect/x/backfill-funnel-stage`
   endpoint. Idempotent.
4. Pipeline-stats endpoint exposes counts per stage for the funnel
   header.

### Phase C — Stable archetype taxonomy

**Problem:** the LLM emits free-text archetypes that drift across runs and
across merchants. The mockup has 8 fixed colors → we need 8 (or N) stable
slugs.

**Proposal:** two-layer architecture.

**C.1 — Per-session archetype assignment (existing, hardened):**

`sessionAnalyst.normalizeResult` already constrains archetype to a
hardcoded vocabulary (`high_intent`, `new_visitor`, `loyal_buyer`,
`abandonment_risk`, `price_sensitive`, `researcher`, `vip`,
`comparison_browser`, `new_convert`). Promote this to the canonical
ARCHETYPES enum and document it. Reject anything else from the LLM —
fall back to `unknown`.

**C.2 — Cross-account archetype discovery (NEW):**

For an account with > N packets, run a periodic clustering job that:

1. Loads all SessionPackets with `aiAnalysis` (last 30 days).
2. Encodes each packet into a behavioral feature vector:
   - signal stats (`riskScore`, `rageClickCount`, `scrollDepthMax`,
     `timeOnSite`, `cartValueAtEnd`, `hovers`, `clicks`, ...)
   - keyframe-derived features (`hadCheckout`, `hadCoupon`, `hadProductView`,
     `revisitedCart`, ...)
   - traffic-source features (paid/organic, channel)
3. K-means or HDBSCAN to find natural clusters.
4. Sends the centroid descriptions + sample packets to a meta-LLM that
   names each cluster ("cliente que abandona en costo de envío",
   "comprador de fin de semana", "visitor que solo lee reseñas", etc.)
5. Stores the cluster definition in a new `ArchetypeCluster` table:
   ```
   id, accountId, slug, displayName, description,
   centroid (vector), color, sampleSessionIds, generatedAt
   ```
6. Re-tags every packet's `aiAnalysis` with `clusterSlug` so the funnel
   knows which colored dot to draw.

**Cadence:** weekly per account, manually triggerable, rate-limited.
First run when account hits a threshold (e.g. 100 packets).

**Why two layers:** Layer C.1 gives consistent vocabulary across the whole
product. Layer C.2 gives merchant-specific insight ("YOUR users have these
8 patterns, not generic ones").

### Phase D — Coupon / friction signal extension

The user explicitly mentions "los que buscan cupones" as an interesting
segment. This isn't a current keyframe type — but it's a strong intent
signal. Add detection:

- `coupon_search`: input event whose value matches `/(cupon|coupon|descuento|promo|code)/i`
  on a checkout or cart page.
- `shipping_sticker_shock`: pause > 8s on a step that revealed a shipping
  cost > some % of cart value (requires DOM scrape of price label, may
  fall back to LLM detection from rrweb stream).
- `comparison_tab`: more than N tab_switch events with no checkout.

Add these to `keyframeExtractor.js`. Each becomes a feature for clustering.

### Phase E — Live funnel UI

**Frontend at `/dashboard/bri/funnel` (new route, sibling of current `/bri`):**

- D3 force-directed scatter or canvas point cloud.
- Y axis = funnel stage. X axis = scaled time (last seen).
- Each dot = a session. Color = cluster slug. Hover = session preview.
- Click stage = drill into a list of sessions.
- Drop-off arrows between stages with `(prev_count - curr_count) / prev_count`.
- Realtime: SSE channel that pushes new packets as they're built so dots
  appear live.

**Data feed:** new endpoint `GET /api/bri/funnel?range=24h&account=...`
returning:

```json
{
  "stages": [
    { "slug": "AD_EXPOSURE", "label": "Ad Exposure", "count": 847 },
    ...
  ],
  "clusters": [
    { "slug": "cluster_1", "label": "Systematic Gift Shopper", "color": "#4ade80" },
    ...
  ],
  "points": [
    { "sessionId": "...", "stage": "ENGAGED", "cluster": "cluster_3", "ts": "..." },
    ...
  ],
  "dropoffs": [
    { "from": "AD_EXPOSURE", "to": "ENGAGED", "pct": -0.28 },
    ...
  ]
}
```

Cap at e.g. 2000 points for perf — sample if more.

### Phase F — Order linkage (already partially built)

For PURCHASED packets:
- `SessionPacket.orderId` is already set by `attributionStitching`.
- `Person.customerIds` already aggregates across sessions.

Add to the cluster output:
- `avgOrderValue` per cluster
- `repeatPurchaseRate` per cluster
- `topProducts` per cluster (from order line items)

This makes the segmentation revenue-aware: "this cluster spends $X, this
one $Y, this one converts at Z%".

---

## 4. Data model changes

```prisma
// Phase B
model SessionPacket {
  ...existing...
  funnelStage String? @map("funnel_stage")  // AD_EXPOSURE | ENGAGED | HIGH_INTENT | CHECKOUT | CONVERTED
  clusterSlug String? @map("cluster_slug")  // FK-ish to ArchetypeCluster.slug
  @@index([accountId, funnelStage])
  @@index([accountId, clusterSlug])
}

// Phase C.2
model ArchetypeCluster {
  id           String   @id @default(uuid())
  accountId    String   @map("account_id")
  slug         String                              // e.g. "shipping_abandoner"
  displayName  String   @map("display_name")
  description  String?
  color        String                              // hex
  centroid     Json                                // feature vector
  sampleIds    String[] @map("sample_session_ids") // for UI preview
  packetCount  Int      @default(0) @map("packet_count")
  generatedAt  DateTime @default(now()) @map("generated_at")
  modelVersion String   @map("model_version")     // bumped on schema change

  account Account @relation(fields: [accountId], references: [accountId])

  @@unique([accountId, slug])
  @@index([accountId])
  @@map("archetype_clusters")
}
```

---

## 5. Build order (incremental, each ships independently)

| Step | Effort | Ship | Output |
|------|--------|------|--------|
| 1. Phase A audit + comments | S | week 1 | confidence raw can disappear |
| 2. Phase B: funnel_stage column + builder + backfill | M | week 1 | per-stage counts in pipeline-stats |
| 3. Phase B: funnel route in /bri showing the stage breakdown (no points yet) | S | week 1 | funnel rectangle with counts |
| 4. Phase D: extend keyframeExtractor with coupon/shipping/comparison signals | M | week 2 | richer feature space |
| 5. Phase C.1: lock down archetype enum, reject LLM drift | S | week 2 | stable colors |
| 6. Phase C.2: feature extractor + clustering job + ArchetypeCluster model | L | week 3 | per-account archetype map |
| 7. Phase C.2: meta-LLM cluster naming | M | week 3 | merchant-specific labels |
| 8. Phase E: live funnel UI (point cloud, drop-off arrows) | L | week 4 | the mockup |
| 9. Phase F: order linkage in cluster output | S | week 4 | revenue per cluster |

Each step is testable on its own — we should NOT wait for all of phase
C.2 before shipping the funnel rectangle from phase B. The mockup is the
end state, not the MVP.

---

## 6. Open questions

- Clustering library — bring in `ml-kmeans`, `hdbscan` via wasm, or send
  the feature vectors to OpenRouter and let an LLM cluster? Probably
  start with simple k-means in Node (no extra infra) and iterate.
- Do clusters live per-account or globally? **Per-account** — each
  merchant has its own population.
- How often to re-cluster? Weekly per account, or on demand from the
  dashboard. NOT every packet (too noisy).
- Do we expose cluster definitions to the merchant UI? Yes — they're the
  whole point. But hide the centroids (numeric internals).

---

## 7. Out of scope (for now)

- Predictive: "this user will likely abandon in 30s." Comes later, after
  we have stable clusters as ground truth.
- Real-time intervention (push coupon, etc.). Different product surface.
- Cross-merchant cluster sharing. Privacy-sensitive.
