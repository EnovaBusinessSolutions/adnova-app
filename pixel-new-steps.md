# Pixel New Steps — Dashboard + Recording Improvements

Tareas pendientes. No cerrar hasta completar todas y recibir confirmación de pruebas.

---

## 1. Recording lifecycle — extender cobertura al checkout

### Estado actual
- **Start**: `_adrayStartRecording` sólo se dispara cuando `sendEvent('add_to_cart')` pasa por el interceptor ([adray-pixel.js:1869-1877](public/adray-pixel.js#L1869-L1877)).
- **Stop**: se detiene con `sendEvent('purchase')` (outcome=PURCHASED) o con `pagehide`/`beforeunload` (outcome queda pendiente, worker lo marca ABANDONED si no llega purchase en TTL).
- **Cross-page**: ya persiste `recordingId` + `chunkIndex` en `sessionStorage`, de modo que debería resumir en la siguiente página — **pero sólo si esa página dispara un `add_to_cart` otra vez**. En una navegación directa a `/checkout` sin AddToCart, no se reanuda.
- **Checkout externo (Shopify)**: el pixel no se inyecta en `checkout.shopify.com`, por eso no captura el checkout hosted. En WooCommerce same-domain sí debería poder.

### Por qué el usuario no ve el checkout
1. El pixel sólo arranca/reanuda ante `add_to_cart`. Páginas de checkout no disparan ese evento.
2. Aún con `sessionStorage` persistido, `_adrayStartRecording` no se vuelve a llamar en la página de checkout.

### Plan
- [ ] Al **inicio de cada page load** del pixel, si hay `adray_rec_id` en `sessionStorage` → auto-resumir recording (`_adrayLoadRrweb` + `_adrayStartRecording` con el mismo id). Así se cubre checkout same-domain.
- [ ] Interceptar `begin_checkout` como segundo punto de arranque (por si el usuario entra a checkout vía botón sin haber ejecutado add_to_cart en esta sesión).
- [ ] Ajustar backend: `triggerEvent` puede ser `add_to_cart` o `begin_checkout` o `resumed`; outcome sigue igual (PURCHASED / ABANDONED / STILL_BROWSING).
- [ ] Documentar en comentario del pixel que checkout externo (Shopify hosted) queda fuera de alcance — limitación conocida.

---

## 2. Panel "Insights" — rename + métricas + IA (LA PARTE IMPORTANTE)

### Estado actual
- Panel dice "ABANDONMENT RISK SCORE" con 3 campos: Score, Nivel, Patrón ([adray-analytics.html](public/adray-analytics.html) — buscar "ABANDONMENT RISK SCORE").
- Datos vienen de `SessionRecording.behavioralSignals` (extraído por [recordingSignalExtractor.js](backend/services/recordingSignalExtractor.js)).
- Ya existe enriquecimiento LLM en [recordingNarrativeService.js](backend/services/recordingNarrativeService.js) usando OpenRouter (`google/gemma-3-27b-it`) que genera archetype + narrative + recommended_action, pero sólo se ejecuta si `riskScore >= 60`.

### Métricas ya capturadas (Clarity-style)
| Métrica | Campo | Capturado |
|---|---|---|
| Rage clicks | `rageClickCount`, `rageClicks[]` | ✅ |
| Exit intents | `exitIntentCount`, `exitIntents[]` | ✅ |
| Form friction/abandonment | `formAbandonCount` | ✅ |
| Hesitation zones | `hesitationCount`, `hesitationZones[]`, `maxHesitationMs`, `totalHesitationMs` | ✅ |
| Shipping shock | `shippingShockLikelihood`, `scrolledToShipping` | ✅ |
| Duración total | `totalDurationMs` | ✅ |
| Pattern (archetype) | `abandonmentPattern` | ✅ |
| LLM narrative | `narrative`, `recommended_action`, `friction_signals` | ✅ (si score≥60) |

### Faltan (para paridad Clarity)
- [ ] **Dead clicks** (clicks en elementos no-interactivos) — enriquecer `recordingSignalExtractor.js`
- [ ] **Excessive scroll** (ida y vuelta repetida en misma zona)
- [ ] **Quick-backs** (navegación atrás < 3s)
- [ ] **JS errors durante la sesión** (captar con `window.onerror` en pixel y enviar junto con chunks)
- [ ] **Scroll depth** (% máximo scrolleado en la página)
- [ ] **Device type** (mobile/tablet/desktop — derivar de userAgent en ingest; útil también para punto 5)

### Propuesta de panel nuevo "Insights"
Header: `INSIGHTS` (remove "Abandonment Risk Score")

```
INSIGHTS                                      Score: 72/100 · Alto
├── Session overview
│   ├── Duration: 4m 32s
│   ├── Device: Mobile (iPhone)
│   └── Landing: /producto/xyz
├── Behavioral signals (flexbox de pills, solo si el contador > 0)
│   ├── 🖱  Rage clicks: 3
│   ├── 🚪  Exit intents: 2
│   ├── 📝  Form abandons: 1 (checkout → dirección)
│   ├── ⏱  Max hesitation: 18s (en "cupón")
│   ├── 📜  Scroll depth: 87%
│   ├── 💀  Dead clicks: 2
│   └── 📱  Quick back: 1
├── Pattern detected
│   └── Shipping shock — high_value_hesitation
└── 🤖 Key recommendation (IA)
    └── "El usuario escaló rápidamente hasta shipping en mobile pero
         se detuvo 18s en el selector de cupón. Considera mover el
         campo de cupón a un expandible colapsado por default."
    [Ver recording ▶]  [Compartir con equipo]
```

### Robustecer la IA (key recommendation)
- [ ] Bajar el threshold de invocación LLM de `riskScore >= 60` a **siempre** (al menos para dashboard — cost control via Redis cache por `recordingId`).
- [ ] Ampliar prompt con: métricas raw + timeline textual de los 10 eventos rrweb más significativos (clicks, submits, rage zones) + contexto de merchant (industry, AOV).
- [ ] Output estructurado JSON con campos: `headline`, `why` (por qué pasó), `recommendation` (qué hacer), `priority` (low/med/high), `confidence`.
- [ ] Tarjeta en UI con un solo párrafo conciso, pero click → expande a `why` + `recommendation` detallados.
- [ ] Fallback sin LLM si la llamada falla: generar recomendación reglas-based desde `abandonmentPattern`.

### Tareas punto 2
- [ ] Backend: endpoint `GET /api/recording/:account_id/:recording_id/insights` que regresa JSON unificado (métricas + narrative + recommendation). Cachea en Redis 1h por `recordingId`.
- [ ] Backend: ampliar `recordingSignalExtractor.js` con dead clicks, scroll depth, quick back.
- [ ] Backend: derivar `deviceType` en `/init` desde userAgent. Guardar en `SessionRecording.deviceType` (nuevo campo Prisma).
- [ ] Backend: refactor `recordingNarrativeService.js` — prompt más rico, invocar siempre, cache Redis.
- [ ] Frontend: nuevo componente `Insights` en `adray-analytics.html` reemplazando panel actual de risk score.

---

## 3. Historical Conversion Journeys — nombres + filtro

### Estado actual
- Panel existe en [adray-analytics.html:3161](public/adray-analytics.html#L3161).
- Algunos usuarios muestran nombre (Jorge Adrian, Haydee Rojas) pero no todos.
- Input de búsqueda no filtra.

### Hipótesis
- Los nombres provienen de `customerId`/email match contra plataforma (Woo/Shopify). Si no hay match, queda como email o anon.
- El filtro probablemente sólo compara contra el campo displayed; si el user record no tiene nombre, el filtro no lo encuentra.

### Plan
- [ ] Investigar cómo se construye la lista (qué endpoint, qué campos vienen).
- [ ] Asegurar que el fallback label incluya: nombre > email > phone hash mask > "Anonymous #N".
- [ ] Hacer que el input filtre también por email (no sólo por nombre).
- [ ] Si users no aparecen del todo → debuggear el join Session→Order→Customer.

---

## 4. Remove Clarity session link chips

- [ ] Eliminar botón "Clarity" en [adray-analytics.html:5835-5840](public/adray-analytics.html#L5835-L5840) (`clarityPlaybackUrl` chip en purchases).
- [ ] Eliminar mismo link en [adray-analytics.html:7853-7858](public/adray-analytics.html#L7853-L7858) (dentro de session detail).
- [ ] Remover función `adrayOpenClarityModal` si no queda ningún caller.

---

## 5. Recordings list — filtros + layout compacto

### Filtros requeridos
- [ ] **Outcome**: PURCHASED / ABANDONED / STILL_BROWSING / ALL
- [ ] **Device**: Mobile / Tablet / Desktop / ALL (depende de añadir `deviceType` del punto 2)
- [ ] **Duración**: < 30s / 30s-2min / > 2min / ALL
- [ ] **Risk level**: Low / Medium / High (basado en `riskScore`)

### Layout
- [ ] Mover duración a la misma línea que fecha+hora para compactar la card:
  ```
  19 Apr 2026 · 08:47   ⏱ 243s
  [▶ Ver grabación]
  ```
- [ ] Backend: extender `GET /api/recording/:account_id/list` con query params `?outcome=&device=&min_duration=&max_duration=&risk=`.

---

## Orden de ataque propuesto

1. **Punto 4** (quick win, 5 min)
2. **Punto 5 layout** (quick win visual, 15 min)
3. **Punto 1** (recording lifecycle — core fix)
4. **Punto 3** (journeys debugging — depende de ver la data)
5. **Punto 5 filtros** (depende de deviceType del punto 2)
6. **Punto 2** (Insights + IA — el más grande, lo dejo al final con approach ya validado)

---

## Phase 2: Re-engagement & Customer Context

Tareas enfocadas en evolucionar desde "abandonment intelligence" a "repeat purchase intelligence". Las grabaciones capturan compras completadas, no abandonos, así que el análisis y recomendaciones deben enfocarse en re-engagement.

### 6. Contextualizar grabaciones con sesión y usuario

- [ ] En la lista de grabaciones (`adray-analytics.html`), cada card debe mostrar:
  - [ ] Nombre del cliente (si aplica)
  - [ ] Email o customer ID visible
  - [ ] Sesión origen (relacionar `SessionRecording.sessionId` → `Session.userKey` → customer profile)
  - [ ] Si hay múltiples sesiones del mismo usuario, mostrar "3 sesiones en los últimos 30 días"
- [ ] Backend: enriquecer respuesta de `GET /api/recording/:account_id/list` con customer name, email, session count por user.

---

### 7. Adaptar tooltip de Insights para compras (no abandonos)

- [ ] El tooltip "Insights" dentro del panel de "Selected Journey" actualmente habla sobre abandonment patterns, pero esos son pedidos YA REALIZADOS.
- [ ] Cambiar el narrative/recommendation para contextos de compra completada:
  - En lugar de "shipping shock → ofrecer envío gratis": "usuario alcanzó al checkout a pesar de shipping shock → oportunidad de free shipping en siguiente compra"
  - En lugar de "rage clicks en búsqueda": "el usuario tuvo friction en product discovery pero convirtió → optimizar búsqueda para que convierta MÁS rápido"
  - En lugar de "hesitation en selector de cupón": "conversión a pesar de UX friction → cupón es barrera pero NO dealbreaker"
- [ ] Backend: endpoint `/api/recording/:account_id/:recording_id/insights` debe detectar si outcome=PURCHASED e invocar LLM con prompt diferente orientado a "cómo retener + re-activar" en lugar de "cómo recuperar abandono".

---

### 8. IA recommendations enfocadas en re-engagement

- [ ] Las recomendaciones (key recommendation en card + "Generar con IA" button) deben incorporar:
  - [ ] Contexto de compra: monto, productos, categorías, frecuencia de compra previas
  - [ ] Behavioral data: duración sesión, dispositivo, qué página visitó antes de checkout
  - [ ] Clarity session insights si disponible (qué buscó, qué dudó)
  - [ ] Recording friction signals (qué los hizo dudar pero igual compraron)
  - [ ] Purchase history: ¿es cliente nuevo o repeat? ¿Cuánto gastó antes? ¿Cuál es el AOV trend?
- [ ] Output LLM: "key recommendation" debe ser acción específica de re-engagement (ej: "Enviar email en 3 días con producto complementario al que compró porque su hesitation en XYZ indica interés en [categoria]")
- [ ] Backend: ampliar `recordingNarrativeService.js` para:
  - [ ] Aceptar parámetro `outcome` (PURCHASED vs ABANDONED) para cambiar el prompt
  - [ ] Fetchear Order details si `outcome=PURCHASED` (revenue, products, customer history)
  - [ ] Inyectar purchase context en el prompt de Gemma
  - [ ] Retornar `nextBestAction` estructurado (type: "email" | "coupon" | "retargeting", parameters: {...})

---

## Preguntas bloqueantes para el usuario

- **Punto 2**: ¿Te parece bien el diseño propuesto de panel Insights (header + overview + signals pills + pattern + IA card)? ¿Alguna métrica adicional que consideres crítica? ¿Siempre invocamos LLM o sólo cuando el usuario hace click en "generar insight" (menor costo)?
- **Punto 1**: ¿El merchant usa checkout hosted de Shopify o WooCommerce same-domain? Confirmar para saber si vale la pena documentar limitación o ampliarla con inyección en checkout externo.
