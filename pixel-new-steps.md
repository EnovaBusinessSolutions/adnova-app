# Phase 3 — AI-Powered Session Intelligence at Scale

**Visión:** evolucionar de una IA que analiza UNA grabación a la vez, a una IA que entiende toda la tienda — mirando todas las grabaciones, cruzando cohortes, y dando al merchant recomendaciones estratégicas basadas en la totalidad de su data.

---

## Fundación ya entregada

- ✅ **Per-session AI**: `recordingNarrativeService.js` con narrativa + `next_best_action` estructurado, deterministic shortcuts, fallbacks, cache Redis. Distingue `PURCHASED` vs `ABANDONED` con prompts + arquetipos separados. Inyecta customer history y order context.
- ✅ **Recording stitching por usuario**: `collapseRecordingsByUser` + `adrayOpenStitchedPlayer` concatenan N grabaciones del mismo `userKey` en un timeline continuo con timestamps monotónicos.
- ✅ **Customer context en recordings list**: nombre, session count 30d, email hash.

Todo lo anterior es **entrada** para Phase 3: ahora la IA necesita RAZONAR sobre el conjunto, no solo sobre un recording a la vez.

---

## 3.1 Transcripción rrweb → texto (el unlock)

Los LLMs no pueden "ver" eventos rrweb binarios. Sin texto, no hay análisis multi-sesión posible.

### Scope
- [ ] Nuevo servicio `backend/services/rrwebTranscriber.js` que toma el array de eventos de una grabación y produce un timeline textual.
- [ ] Extraer y verbalizar:
  - Clicks (con selector CSS + texto visible del elemento clickeado)
  - Scrolls (dirección + % de página alcanzado)
  - Form interactions (qué campo, tiempo en el campo, si abandonó)
  - Navegaciones (URL prev → URL next + tiempo transcurrido)
  - Pauses / hesitaciones (>3s sin interacción) con contexto del elemento hoverado
  - Rage clicks (con selector repetido)
  - Exit intents (timestamp + contexto previo)
  - Page load / unload
- [ ] Timestamps relativos desde `t=0` para legibilidad.
- [ ] Output formato fijo:
  ```
  [t=0.0s] Load / — "Home"
  [t=2.3s] Scroll down 40%
  [t=4.1s] Click "Ver producto" (a.product-card[data-id=42])
  [t=4.8s] Load /producto/camisa-negra — "Camisa negra M"
  [t=12.4s] Hover "Agregar al carrito" (button#add-to-cart) — 8s stationary
  [t=20.7s] Click "Agregar al carrito"
  [t=22.0s] Navigation → /cart
  [t=31.2s] Exit intent detected (cursor to top)
  [t=33.5s] Close tab
  ```
- [ ] Nuevo campo Prisma: `SessionRecording.aiTranscript String? @db.Text` (serializado como texto plano para costo ↓ vs JSON).
- [ ] Worker `backend/workers/recordingTranscriberWorker.js` triggered en `recording:finalize` job (BullMQ chained). Corre después de `recordingSignalExtractor.js`.
- [ ] Re-runnable por endpoint admin `POST /api/recording/x/re-transcribe` (x-adray-internal secret).

### Criterio de éxito
- 100% de recordings READY post-Phase 3 deploy tienen `aiTranscript`.
- Transcript promedio ≤ 4KB para una sesión típica (input LLM barato).
- Un humano puede leerlo y entender qué hizo el usuario sin ver el video.

---

## 3.2 Multi-session AI Analyst

El cerebro de Phase 3. Toma un batch de transcripts + metadata y produce insights cross-session.

### Scope
- [ ] Nuevo servicio `backend/services/aiAnalyst.js` con dos entry points:
  - `runDailyAnalysis(accountId)` — batch de últimas 24h
  - `runCustomAnalysis(accountId, filters)` — por cohorte (ej: solo mobile, solo abandonos, solo high-cart-value)
- [ ] Usa modelo "large context": **Claude Opus 4.7** (hasta 1M tokens) o GPT-4.1 como fallback. NO usa Gemma (no alcanza para batch analysis).
- [ ] Input al LLM:
  - Metadata agregada: total sessions, %purchase, %abandon, avg cart, top landing pages, device split
  - Hasta 50 transcripts con su resultado (comprador/abandonador) y cart_value
  - Merchant context (industry, AOV histórico, etapa — `MerchantSnapshot`)
- [ ] Output estructurado JSON:
  ```json
  {
    "top_friction_patterns": [
      {
        "pattern": "Shipping cost revealed at checkout in mobile",
        "frequency": 0.31,
        "revenue_impact_estimate": 12450,
        "evidence_recording_ids": ["rec_abc", "rec_def", "rec_ghi"],
        "recommendation": "Mostrar envío en PDP antes de agregar al carrito"
      }
    ],
    "cohort_insights": [
      { "cohort": "mobile + new_visitor", "conv_rate": 0.08, "vs_baseline": -0.04, "takeaway": "..." }
    ],
    "top_conversion_accelerators": [ "..." ],
    "weekly_priorities": [
      { "priority": 1, "action": "...", "estimated_impact_usd": 8200 }
    ]
  }
  ```
- [ ] Nuevo modelo Prisma `AIAnalystReport`:
  ```
  id, accountId, reportType ("daily"|"weekly"|"custom"),
  scope (jsonb — filters used), findings (jsonb — output above),
  transcriptCount, tokenCostEstimate, createdAt
  ```
- [ ] Endpoint `POST /api/ai/analyst/run` autenticado (gated por MCP o session), con body `{scope: "daily"|"weekly"|"custom", filters: {...}}`.
- [ ] Rate-limit por merchant: 10 runs/día default (configurable por plan).

### Criterio de éxito
- Report produce 3–5 friction patterns accionables por semana.
- Cada pattern tiene ≥3 recording evidencias clickeables.
- Revenue impact estimates son razonables (±20% vs realidad post-fix).

---

## 3.3 AI Analyst dashboard panel

El merchant necesita un lugar donde ver los findings.

### Scope
- [ ] Nueva sección en `public/adray-analytics.html` llamada **"AI Analyst"** (arriba de Recordings list).
- [ ] Header muestra fecha del último report + botón "Re-ejecutar análisis".
- [ ] Tres tarjetas principales:
  1. **Top friction patterns** — lista rankeada con revenue impact y link a "Ver 3 grabaciones de ejemplo" (abre stitched player con esos recordings).
  2. **Cohort insights** — tabla mobile vs desktop, new vs returning, with deltas vs baseline.
  3. **Weekly priorities** — lista accionable con impacto estimado en $.
- [ ] Cada recomendación tiene botón "Copiar como ticket" (copia markdown al clipboard para pegar en Linear/Jira/Notion).
- [ ] Auto-refresh diario (polling al cargar la página si `createdAt < 24h` lo muestra, sino "regenerando…").

### Criterio de éxito
- Merchant puede ver el dashboard, entender sus top 3 problemas en < 30s.
- "Copiar como ticket" permite flujo de trabajo developer-friendly.

---

## 3.4 Session embeddings + similarity search

Necesario para "find users like this one" y para expandir cohortes en el Analyst.

### Scope
- [ ] Generar embedding de cada `aiTranscript` al finalizar (OpenAI `text-embedding-3-small`, ~$0.00002/session).
- [ ] Almacenar en Postgres con `pg_vector` (nuevo campo `SessionRecording.transcriptEmbedding vector(1536)`) o en un índice separado si no está disponible.
- [ ] Endpoint `GET /api/recording/:account_id/:recording_id/similar?limit=10` devuelve top-K vecinos por cosine similarity.
- [ ] UI: botón "Usuarios similares" en la journey card y en el player modal → abre un drawer con mini-cards.
- [ ] Usado internamente por el Analyst (3.2) para agrupar transcripts en clusters antes de enviar al LLM (reduce tokens sin perder patrones).

### Criterio de éxito
- Similarity search < 200ms en 10k recordings.
- Batch analysis reduce ~40% el costo de tokens al enviar exemplares por cluster en vez de todas las sesiones.

---

## 3.5 Vision-based analysis (reserve for high-value sessions)

Texto no captura layout, color, CTA prominence. Reserve para sesiones donde el ROI del vision call lo justifica.

### Scope
- [ ] Worker que extrae N frames de un recording rrweb en el cliente (offscreen replay → canvas → PNG) para sesiones que cumplan criterios:
  - `cartValue > $150` (configurable por merchant)
  - `outcome = ABANDONED` con `riskScore > 70`
  - VIP tier (historial ≥ 5 órdenes)
- [ ] Los frames se extraen en puntos flagged por signals: rage click zones, max-hesitation timestamps, exit intent moments.
- [ ] Upload a R2 con prefix `vision-frames/{accountId}/{recordingId}/`.
- [ ] Llamada a Claude Opus 4.7 vision o GPT-4o con los frames + el transcript como contexto → output enriquece el `next_best_action` del recording.
- [ ] Rate-limit: 5 vision analyses por día por merchant en plan default (costo ↑).

### Criterio de éxito
- Vision catches patrones que texto no: "el CTA está debajo del fold en mobile", "el precio es del mismo color que el fondo".
- Opt-in por merchant (config flag), no corre en plan free.

---

## 3.6 Reporte semanal automatizado por email

Cerrar el loop: IA analiza + merchant recibe reporte sin abrir el dashboard.

### Scope
- [ ] Cron job (BullMQ scheduled) corre lunes 9am hora del merchant.
- [ ] Llama a `runDailyAnalysis(accountId, {range:"7d"})` para cada merchant activo.
- [ ] Renderiza reporte HTML compacto:
  - Summary: total sessions, %conv, cambio vs semana previa
  - Top 3 friction patterns
  - Top 3 priority actions con impacto estimado
  - Link al dashboard para drill-down
- [ ] Envío vía Resend al owner del merchant (ya tenemos `RESEND_API_KEY`).
- [ ] Unsubscribe link por merchant (stored en MerchantSnapshot).
- [ ] Log de envíos en nuevo modelo `AIReportDelivery`.

### Criterio de éxito
- Open rate > 40%.
- Merchants reportan haber tomado ≥1 acción por email.

---

## Orden de ataque sugerido

1. **3.1 Transcripción** — unlock fundacional, sin esto nada funciona.
2. **3.2 Analyst core** — el cerebro, producir findings.
3. **3.3 Dashboard panel** — que el merchant los VEA.
4. **3.4 Embeddings** — para escalar Analyst y UX de similares.
5. **3.6 Email semanal** — win de retención del producto.
6. **3.5 Vision** — al final, es caro y opcional.

---

## Preguntas bloqueantes antes de empezar

- **Modelo LLM para Analyst**: ¿Claude Opus 4.7 (1M ctx, premium) o GPT-4.1 (cheaper, 1M ctx via batch)? Decide costo vs calidad.
- **Storage de embeddings**: ¿activamos `pg_vector` en Prisma/Render (requiere extensión) o usamos índice externo (Pinecone/Qdrant)?
- **Rate-limits por plan**: ¿cuántos Analyst runs/mes incluye cada plan? Afecta pricing y costos OpenRouter.
- **Vision analysis**: ¿opt-in pagado extra, o incluido en plan Enterprise?
- **Idioma del reporte**: confirmar si es español para todos los merchants LATAM, o detectamos por `Account.domain`/config.
