# rrweb Phase — Behavioral Data Pipeline (No-Playback Architecture)

> Ref: `adray_architecture_v2.docx` + `keyframeExtractor.js`. Este documento combina la arquitectura objetivo con lo que ya existe en el repo y propone el camino de migración.

**Cambio de paradigma:** el pixel ya no graba "para reproducir" — graba para alimentar a un LLM. El frontend deja de reconstruir video; muestra análisis AI. Raw rrweb vive máximo 24h antes de borrarse.

---

## Mapeo: lo que existe hoy vs lo que pide la arquitectura

| Componente | Hoy | Arquitectura v2 | Decisión propuesta |
|---|---|---|---|
| Pixel | `public/adray-pixel.js` — graba solo tras `add_to_cart`/`begin_checkout`. Limpia sessionStorage en pagehide. | Graba desde page load, sampling fijo (`mousemove:50`, `scroll:150`, `input:'last'`). Buffer 50 eventos / 5s, `sendBeacon` on unload. | **Migrar** |
| Ingestion | `POST /collect/x/buf` — un chunk por request, escribe en R2 per-chunk | API Gateway + SQS + Lambda (batches comprimidos con pako). 1MB max, 1k rps/merchant. | **Conservar Express** (R2 ya funciona), añadir endpoint batch comprimido. AWS migration defer. |
| Processing | `recordingFinalizeWorker.js` ensambla chunks y produce el final R2; `recordingSignalExtractor.js` calcula signals | Lambda asíncrono por SQS: ensambla sesión, extrae keyframes, arma packet, borra raw. | **Conservar BullMQ** (Render), portear `keyframeExtractor.js` como siguiente paso del worker. |
| Keyframe extraction | No existe — `recordingSignalExtractor.js` calcula contadores agregados | 8+ tipos de keyframes (`scroll_stop`, `product_hover`, `rage_click`, `checkout_hesitation`, `tab_switch`, `form_interaction`, ecommerce events, `session_end`) con thresholds exactos | **Integrar** el archivo provisto — complementa (no reemplaza) al signal extractor |
| Data packet | `SessionRecording.behavioralSignals Json` — ad hoc | JSON estructurado ~10-50KB por sesión, artefacto permanente | **Nuevo modelo Prisma** `SessionPacket` |
| Identity graph | Prisma `IdentityGraph` en Postgres | Amazon Neptune Serverless ($200-1500/mo) | **Conservar Postgres** hasta volumen lo justifique |
| LLM | Gemma 3 27B via OpenRouter (`recordingNarrativeService.js`) | Gemma 4 26B MoE via API o self-host H100 | **Conservar OpenRouter**, upgrade a Gemma 4 cuando esté en el catálogo |
| Storage raw | R2 (Cloudflare) — se borra al finalizar | S3 + lifecycle 24h | **Conservar R2** — mismo API S3, sin egress fees, ya pagado |
| Frontend player | `rrweb-player` en `adray-analytics.html` — modales, playlist, stitched playback | No existe — solo análisis AI | **Eliminar** (Fase 9, al final) |
| CAPI output | `capiFanout.js` — purchase events básicos | CAPI enriquecido con clasificación BRI + suppression de organic converters | **Extender** lo que ya existe |
| Consent | `maskAllInputs: true` | API `adray('set_consent', 'granted\|denied')` + banner opcional del merchant | **Añadir** API, UI del merchant |

---

## Recomendaciones que quiero validar contigo antes de ejecutar

1. **No migrar a AWS Lambda en esta fase.** Render + BullMQ nos da lo mismo funcionalmente con menos complejidad operativa. Migrar cuando sustainemos >10 sesiones/seg — no es el caso aún.
2. **No introducir Amazon Neptune todavía.** Postgres + `pg_vector` cubre identity graph + embeddings hasta que necesitemos cross-merchant graph queries. Ahorra $200-1500/mes.
3. **R2 sobre S3.** Mismo API, no egress, ya lo usamos.
4. **Keyframes complementan signals, no los reemplazan.** Signals dan un score agregado (riskScore); keyframes narran la historia. El LLM recibe los dos.
5. **Eliminar el player al FINAL (Fase 9), no al inicio.** Riesgo: los merchants valoran ver la grabación como prueba. Antes de borrar, validamos que la narrativa AI sea buena con pilotos. Sugiero esconder el player detrás de un feature-flag para uso interno de ops.
6. **No construir el path HubSpot/lead-gen todavía** (sección 7 del docx). No hay design partner pidiéndolo; es especulativo para el target ecomm actual.
7. **Gemma 4 via OpenRouter**, no self-host. Self-host solo cuando >1M sesiones/mes (la nota del docx coincide).

---

## Fases ejecutables

### Fase 0 — Pixel: grabar cada sesión desde el inicio

**Estado actual:** `_adrayStartRecording` gated por `add_to_cart`/`begin_checkout` ([adray-pixel.js:1730-1770](public/adray-pixel.js#L1730-L1770)). En `pagehide` se llama `_adrayClearRecState()` ([adray-pixel.js:1818](public/adray-pixel.js#L1818)) — por eso Jorge tiene 6 recordings fragmentados.

**Tareas:**
- [ ] Arrancar `_adrayStartRecording({trigger:'page_load'})` inmediatamente después de que `rrweb` cargue en `_adrayLoadRrweb`, NO al interceptar `sendEvent`.
- [ ] Mantener interceptor de `add_to_cart`/`begin_checkout` solo para emitir `Custom` events dentro del stream rrweb (tags `add_to_cart`, `begin_checkout`) — el `keyframeExtractor` los lee.
- [ ] Quitar `_adrayClearRecState()` del unload handler: la misma grabación debe continuar cross-page dentro de la misma sessionStorage.
- [ ] Ajustar sampling a la arquitectura v2: `mousemove:50`, `scroll:150`, `input:'last'`, `media:800`, `mouseInteraction:true`. Confirmar `maskAllInputs:true`, `maskInputOptions: { password, email, tel }`, `blockClass:'adray-block'`, `ignoreClass:'adray-ignore'`.
- [ ] Añadir captura de `product_view` con bounding box via `IntersectionObserver` — emitir como `Custom` event con `{tag:'product_view', payload:{ element_id, bbox, product_id, name, price }}`. Es input crítico del `keyframeExtractor.hitTestProducts`.
- [ ] Añadir custom `visibility_change` event on `document.visibilitychange` para el keyframe `tab_switch`.
- [ ] Implementar consent API: `window.adray('set_consent', 'granted'|'denied')`. Si `denied`, nada de rrweb; si `granted`, grabación normal. Cookie first-party 13 meses.

**Criterio:** cada sesión del sitio genera un `recordingId` único al entrar, sobrevive navegación same-origin, y se corta sólo por: purchase, 5min inactividad, `session_end` explícito, o nueva sesión del mismo visitor.

---

### Fase 1 — Endpoint de ingest por batches comprimidos

**Estado actual:** `POST /collect/x/buf` recibe un chunk de eventos sin comprimir; escribe uno por uno en R2 ([recording.js:177-264](backend/routes/recording.js#L177-L264)).

**Tareas:**
- [ ] Nuevo endpoint `POST /ingest/v1/events` aceptando `Content-Type: application/octet-stream` (pako-deflated) o `application/json`.
- [ ] Validar `X-Merchant-ID` (existe en `Account`) + `X-Session-ID` (UUID v4).
- [ ] Rechazar >1MB payload.
- [ ] Rate limit 1000 rps/merchant (middleware ya existe en `backend/middleware/rateLimit.js` — extender).
- [ ] Escribir batch completo en R2 bajo `raw/{merchantId}/{sessionId}/{timestamp}.json.gz`.
- [ ] Enqueue BullMQ job `session-ingest:batch` con `{ merchantId, sessionId, r2Key, batchTs, events_count }`.
- [ ] Lifecycle R2: `raw/*` se borra a 24h (configurar en el bucket).
- [ ] Mantener `/collect/x/buf` deprecated durante transición; loggear uso para saber cuándo apagarlo.

---

### Fase 2 — Worker de ensamblado de sesión

**Estado actual:** `recordingFinalizeWorker.js` ensambla chunks por `recordingId` (ver `queues/recordingQueue.js`). La unidad es "recording", no "session".

**Tareas:**
- [ ] Nuevo worker `backend/workers/sessionAssemblyWorker.js`.
- [ ] Trigger de completitud: `purchase` detectado en cualquier batch, 30min sin eventos, `session_end` custom, o cron sweep.
- [ ] Lista todos los objetos `raw/{merchantId}/{sessionId}/*.json.gz`, baja, mergea por timestamp, escribe `assembled/{merchantId}/{sessionId}.json.gz` (TTL 48h).
- [ ] Valida que haya al menos un `FullSnapshot` (type=2) — si no, marca sesión como `invalid` y skip.
- [ ] Enqueue `session-process:keyframes` con el key assembled.

---

### Fase 3 — Keyframe extraction (portar `keyframeExtractor.js`)

**Estado actual:** `recordingSignalExtractor.js` calcula agregados (rage clicks, hesitation, scroll depth) pero no produce keyframes narrativos.

**Tareas:**
- [ ] Copiar `keyframeExtractor.js` provisto a `backend/services/keyframeExtractor.js` (sin modificaciones en la lógica).
- [ ] Adaptar construcción de `productIndex`: derivar de los custom events `product_view` emitidos por el pixel (no requiere catálogo pre-construido). Mantener la firma del extractor.
- [ ] Worker `backend/workers/keyframeExtractionWorker.js` consume `session-process:keyframes`, baja el assembled stream, llama `extractKeyframes(events, sessionMeta, productIndex)`.
- [ ] CORRE `recordingSignalExtractor.js` EN PARALELO sobre los mismos events — sus agregados (`riskScore`, `rageClickCount`, etc.) se guardan junto a keyframes en el packet.
- [ ] Enqueue `session-process:packet` con keyframes + signals.

---

### Fase 4 — Behavioral Data Packet

**Estado actual:** no existe como artefacto propio; `SessionRecording.behavioralSignals` es un grab-bag.

**Modelo nuevo Prisma:**
```prisma
model SessionPacket {
  id            String   @id @default(uuid())
  sessionId     String   @unique @map("session_id")
  accountId     String   @map("account_id")
  visitorId     String?  @map("visitor_id")
  personId      String?  @map("person_id")         // set after identity resolution
  startTs       DateTime @map("start_ts")
  endTs         DateTime @map("end_ts")
  durationMs    Int      @map("duration_ms")
  device        Json?                              // { type, ua, viewport }
  trafficSource Json?    @map("traffic_source")    // { utm, fbclid, gclid, referrer }
  landingPage   String?  @map("landing_page")
  keyframes     Json                               // array from keyframeExtractor
  signals       Json                               // agg counts from recordingSignalExtractor
  ecommerceEvents Json   @map("ecommerce_events")  // add_to_cart, purchase, etc.
  outcome       String                             // purchased | abandoned | bounced | still_browsing
  cartValueAtEnd Float?  @map("cart_value_at_end")
  orderId       String?  @map("order_id")
  rawErasedAt   DateTime? @map("raw_erased_at")
  createdAt     DateTime @default(now()) @map("created_at")

  account       Account  @relation(fields: [accountId], references: [accountId], onDelete: Cascade)

  @@index([accountId, personId])
  @@index([accountId, startTs])
  @@map("session_packets")
}
```

**Tareas:**
- [ ] Migración `prisma db push` (staging) + `prisma migrate` (prod).
- [ ] Worker `backend/workers/packetAssemblyWorker.js` consume `session-process:packet`, arma el JSON según el shape del docx, hace `prisma.sessionPacket.create`.
- [ ] Enqueue `session-post-packet:erase` y `session-post-packet:ai-analyze`.

---

### Fase 5 — Raw data erasure

**Tareas:**
- [ ] Worker `backend/workers/rawErasureWorker.js`: borra `raw/{merchantId}/{sessionId}/*` y `assembled/{merchantId}/{sessionId}.json.gz`.
- [ ] Setea `SessionPacket.rawErasedAt`.
- [ ] Backup: R2 lifecycle borra `raw/` automáticamente a 24h, `assembled/` a 48h.

---

### Fase 6 — Análisis AI por sesión

**Estado actual:** `recordingNarrativeService.js` toma `SessionRecording.behavioralSignals` y produce archetype + `next_best_action` (Fases 1-2 ya hechas).

**Migración:**
- [ ] Renombrar/crear `backend/services/sessionAnalyst.js` que consume `SessionPacket`.
- [ ] Resolución de identidad antes del LLM (tier 1-3):
  - Tier 1 (deterministic): match por `email_hash`, `phone_hash`, `customer_id` (Shopify/Woo) → Prisma `IdentityGraph` o `Order`
  - Tier 2 (probabilistic): fingerprint (IP hash + UA + viewport)
  - Tier 3: crear nuevo `Person` con identidad provisional
- [ ] Prompt a Gemma 4: incluye keyframes (texto compacto "t=2.3s scroll_stop 40%, t=5.1s product_hover Camisa $29"), signals, identity tier, outcome, merchant context (industry, AOV).
- [ ] Output estructurado (extensión del schema v2 que ya tenemos): `classification`, `organic_converter: bool`, `exclude_from_retargeting: bool`, `narrative`, `next_best_action`, `confidence`.
- [ ] Guardar en `SessionPacket.aiAnalysis Json` (añadir campo) o nuevo modelo `SessionAnalysis`.

---

### Fase 7 — Stitching de sesiones por usuario

**Estado actual:** stitching en el frontend por `userKey` con expansión por `customerId`/`emailHash` ([recording.js /by-user](backend/routes/recording.js)). Funciona pero es query-time.

**Migración:**
- [ ] Nuevo modelo `Person`:
  ```prisma
  model Person {
    id              String   @id @default(uuid())
    accountId       String   @map("account_id")
    emailHashes     String[] @map("email_hashes")
    phoneHashes     String[] @map("phone_hashes")
    customerIds     String[] @map("customer_ids")
    visitorIds      String[] @map("visitor_ids")
    firstSeenAt     DateTime @map("first_seen_at")
    lastSeenAt      DateTime @map("last_seen_at")
    sessionCount    Int      @default(0) @map("session_count")
    orderCount      Int      @default(0) @map("order_count")
    totalSpent      Float    @default(0) @map("total_spent")

    account Account @relation(fields: [accountId], references: [accountId], onDelete: Cascade)
    @@map("people")
  }
  ```
- [ ] El resolver de identidad (Fase 6) setea `SessionPacket.personId` y actualiza `Person` (union de identificadores, bump de contadores).
- [ ] Migración one-off: backfill `Person` desde `Order` existentes agrupando por `customerId`/`emailHash`.
- [ ] Endpoint `GET /api/people/:accountId/:personId/sessions` devuelve los packets ordenados.

---

### Fase 8 — Análisis AI por usuario (cross-session)

**Nuevo — no existe.**

**Tareas:**
- [ ] `backend/services/personAnalyst.js`: input = array de packets cronológicos de un `Person` + orders + time deltas.
- [ ] Prompt a Gemma 4 (batch, long context): producir `personProfile` estructurado:
  ```json
  {
    "tier": "vip|returning|new|at_risk",
    "behavior_summary": "…",
    "conversion_probability": 0.72,
    "preferred_channel": "email|sms|retargeting",
    "next_best_action": { type, timing_days, content, priority },
    "retention_insight": "…",
    "ltv_estimate": 450,
    "confidence": 0.8
  }
  ```
- [ ] Guardar en `PersonAnalysis { personId, analysis Json, lastSessionId, updatedAt }`.
- [ ] Trigger: cada vez que un `SessionPacket` nuevo entra con `personId` conocido → enqueue `person:re-analyze`. Rate-limit: máximo 1 re-análisis por persona por día.

---

### Fase 9 — Eliminar player + rediseñar dashboard

**Borrar de `public/adray-analytics.html`:**
- `adrayOpenPlayer`, `adrayOpenStitchedPlayer`, `adrayOpenJourneyPlayer`, `_adrayRenderPlaylistSegment`, `_adrayPlaylistNavHtml`, `_adrayShowModal` (el modal del player)
- Todos los botones "Ver grabación" en recordings list, selected journey, session detail
- Carga lazy de `rp.js` / `rp.css` en `/static/`
- `adrayOpenClarityModal` (ya deprecated, aprovechar para limpiar)

**Borrar del backend:**
- `/api/recording/:account_id/list`, `/api/recording/:account_id/:recording_id`, `/api/recording/:account_id/session/:session_id`, `/api/recording/:account_id/by-user`, `/api/recording/:account_id/:recording_id/insights`
- `backend/workers/recordingFinalizeWorker.js` (reemplazado por session assembly)
- Assets estáticos `public/static/rp.js`, `public/static/rp.css`
- Modelo Prisma `SessionRecording` → DROP en la migración (después de backfill a `SessionPacket`)

**Añadir al frontend:**
- Nueva sección **Session Timeline** que renderiza keyframes de un packet como timeline vertical (producto hover con thumbnail + nombre + precio, scroll stop con % + productos visibles, rage click con elemento, checkout hesitation con duración, etc.). Todo visual, sin reproducción.
- **Session AI card**: narrativa Gemma + `next_best_action` + classification badge.
- **Person profile view**: LTV estimate, tier badge, lista de sesiones (cada una como timeline colapsable), cross-session narrative.
- **Aggregate funnels**: % usuarios con `rage_click` en cada CTA, % con `checkout_hesitation > 60s`, etc.

**Feature flag defensivo:** `ADRAY_INTERNAL_PLAYER=true` mantiene el player oculto en el dashboard para ops cuando necesiten debug. Accesible vía URL secreta.

---

### Fase 10 — CAPI enrichment con BRI

**Estado actual:** `backend/services/capiFanout.js` manda purchase events básicos.

**Extender:**
- [ ] Inyectar `classification` + `organic_converter` + `confidence` en el payload custom del evento CAPI.
- [ ] Si `organic_converter=true` y `exclude_from_retargeting=true` → llamar a Meta Customer List API para añadir el hash a una Custom Audience de supresión (ahorra gasto de retargeting).
- [ ] Trigger: después de `PersonAnalysis` writes, si hay purchase asociado.

---

### Fase 11 — Privacy + compliance

- [ ] Verificar que **todo hash SHA-256** se hace en backend, nunca en el browser (actualmente `hashPII` en backend, check).
- [ ] Consent API en pixel (Fase 0).
- [ ] Endpoint `DELETE /api/v1/customers/:email_hash`: cascade delete `Person` + `SessionPacket`s + raw R2 si queda.
- [ ] Documentar en README + landing page los retention windows (raw 24h, assembled 48h, packet permanente, PII solo hashed).

---

## Orden de ejecución recomendado

1. **Fase 0** — pixel records always (gana rápido, valida la decisión conceptual)
2. **Fase 4** schema `SessionPacket` (desbloquea todo lo downstream)
3. **Fases 2 + 3** — assembly + keyframes (el core del pipeline)
4. **Fase 5** — raw erasure activa desde el principio (evita acumular data)
5. **Fase 6** — AI por sesión sobre packet (reemplaza gradualmente el narrative actual)
6. **Fase 7 + 8** — Person graph + cross-session AI (el producto diferenciado)
7. **Fase 1** — endpoint batch comprimido (solo si `/buf` actual no sostiene el nuevo volumen de "toda sesión")
8. **Fase 10** — CAPI enrichment (amplía valor para merchant)
9. **Fase 9** — eliminar player + rediseñar UI (al final, con AI validada)
10. **Fase 11** — audit de privacy y consent

---

## Preguntas bloqueantes antes de empezar

1. **Infra:** ¿mantenemos Render + BullMQ + R2 + Postgres, o migramos a AWS-native (Lambda + SQS + S3 + Neptune) en esta fase? Recomiendo NO migrar aún — es ~3 semanas de trabajo puro de devops que no añade capability.
2. **LLM:** ¿Gemma 4 via OpenRouter (cuando aparezca en el catálogo) o self-host en EC2/ECS H100 spot? Recomiendo OpenRouter hasta >1M sesiones/mes.
3. **Player removal:** ¿hard delete en Fase 9 o lo escondemos tras feature-flag `ADRAY_INTERNAL_PLAYER`? Recomiendo el flag — valor ops para debug AI.
4. **Identity graph:** ¿Neptune real o Postgres + pg_vector? Recomiendo Postgres (ahorra $200-1500/mes, mismo caso de uso por ahora).
5. **Consent:** ¿Adray provee el banner de consent o solo el API y el merchant implementa UI? Docs dicen "merchant responsible" — recomiendo eso: Adray da el API, merchant implementa UI (simple link en docs).
6. **Volumen esperado:** si cada page load abre grabación, ¿qué merchant nos satura R2 / LLM budget primero? Estimar antes de Fase 0 para capear sampling si hace falta.
7. **HubSpot / lead-gen path (sección 7 del docx):** ¿lo dejamos fuera de esta fase? Recomiendo sí, enfoque ecomm.
8. **Datos existentes:** ¿hacemos backfill de `SessionRecording` actuales a `SessionPacket` (reprocessing completo) o solo forward-from-deploy? Recomiendo forward-only — menos riesgo, el player removal puede esperar 30 días a que acumulemos packets nuevos.
