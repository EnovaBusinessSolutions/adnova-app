# Attribution Panel — Fixes Pendientes

Branch: `hotfix/pixel-robust-tracking`
Fecha: 2026-04-23
Owner: Germán

Este doc cubre 4 fixes pedidos en el panel de Attribution del dashboard (`dashboard-src/src/features/attribution/`) más el backend que lo alimenta (`backend/routes/analytics.js`). Cada tarea tiene: contexto → hallazgo → plan → checklist. Se va tachando conforme se valida en UI.

---

## 1) Modelos de atribución deben cambiar los datos al alternarlos ✅

### Contexto
El nav del panel tiene un `ModelSelector` con: Last Click, First Click, Linear, Time Decay, Position. Al cambiar de modelo los números deberían moverse, pero el usuario reporta que no pasa nada claro.

### Hallazgo
- **Frontend** (`dashboard-src/src/features/attribution/components/ModelSelector.tsx:10-16`) ofrece 5 modelos.
- **Backend** (`backend/routes/analytics.js:73`) sólo acepta 5 llaves: `['first_touch', 'last_touch', 'linear', 'meta', 'google_ads']`. Cualquier valor fuera del set hace fallback a `last_touch` (ver L2256).
- Por eso `time_decay` y `position` son no-ops silenciosos — el backend regresa siempre last_touch.
- `last_touch`, `first_touch` y `linear` **sí** están implementados en `resolveConversionAttribution()` (L1991-2098) y recomputan `channelStats` + `attributedRevenue` al final del handler (L3128-3170).
- Cache key (`buildRouteCacheKey`, L98-102) incluye el query string completo, así que `attribution_model=` sí cambia la llave de cache.
- Hay un override que puede estar enmascarando el efecto: cuando `conv.source === 'orders' && conv.orderAttributedChannel !== 'unattributed'`, se construye `orderStoredAttribution` a partir de lo que ya está guardado en la tabla Order, **ignorando** el modelo seleccionado (L2729-2744). Esto hace que para tiendas WooCommerce/Shopify con orden ya enriquecida, el modelo seleccionado no tenga efecto en esos rows.

### Plan
1. Mantener los 3 modelos válidos (last/first/linear) en el front y borrar los 2 rotos (ver tarea #2).
2. Hacer que `orderStoredAttribution` respete `attributionModel`:
   - Si el modelo es `first_touch` o `linear` y existe al menos una sesión/snapshot histórico, **preferir** el cálculo basado en touchpoints por encima del snapshot pegado a la orden.
   - Dejar `orderStoredAttribution` sólo como fallback cuando no hay touchpoints (p. ej. orden de Shopify sin sesión trackeada).
3. Verificar a ojo en staging que cambiando modelo se mueve:
   - Attribution Pie Chart (`AttributionPieChart`).
   - Channel breakdown del header (KpiGrid → attributedRevenue).
   - `attributedChannel` en Conversion Paths list items.

### Checklist
- [x] Fix en `conversionsWithAttribution` (analytics.js L2746+): cuando el modelo es `first_touch` o `linear` y `attribution.isAttributed === true`, se usa el resultado del modelo y `orderStoredAttribution` queda como **fallback**. Para `last_touch` el comportamiento previo se respeta (orderStored gana) para no alterar conteos existentes.
- [x] Cache key por ruta ya incluye `attribution_model` en query string → cada modelo tiene su propia entrada de cache.
- [x] `node -c` syntax check OK.
- [x] **VALIDADO EN STAGING** (2026-04-23).

---

## 2) Eliminar los modelos Time Decay y Position ✅

### Hallazgo
- Nunca estuvieron soportados en backend (ver `ATTRIBUTION_MODELS` arriba).
- UI los ofrecía y caían silenciosamente a last_touch → confunde.

### Plan
1. Editar `dashboard-src/src/features/attribution/types/index.ts`:
   ```ts
   export type AttributionModel = 'last_touch' | 'first_touch' | 'linear';
   ```
2. Editar `ModelSelector.tsx` — borrar entradas `time_decay` y `position` del `MODEL_LABELS`.
3. Grep por `time_decay` y `position` en `dashboard-src/` para asegurar que ningún otro componente dependa de ellos (RoasComparisonChart, ExportModal, useAttributionFilters).
4. En backend no hace falta cambio, pero por claridad se puede mantener `ATTRIBUTION_MODELS` como está (acepta meta/google_ads para casos internos).

### Checklist
- [x] Borrar modelos del type.
- [x] Borrar entradas del `ModelSelector`.
- [x] Actualizar `useAttributionFilters.VALID_MODELS` y `RoasComparisonChart.MODEL_LABELS`.
- [x] `tsc --noEmit` limpio.
- [x] **VALIDADO EN STAGING** (2026-04-23): selector muestra sólo Last Click / First Click / Linear.

---

## 3) Selected Journey: mostrar campaña/ad + agrupar eventos por sesiones ✅

### Contexto
Pedido:
- Ver de qué campaña / anuncio llegó el usuario a la tienda (no sólo el canal).
- Ver los eventos **separados por sesiones**: Sesión 1 (10:00–10:15 eventos X,Y,Z), Sesión 2 (10 min después, otra pestaña/navegador, eventos A,B,C), etc. Stitching por cookie `_adray_uid`.

### Hallazgo — Campaña / Anuncio
- El backend YA calcula `attributedCampaign`, `attributedAdset`, `attributedAd`, `attributedPlatform`, `attributedClickId` por conversión (`analytics.js` L2758-2768).
- Esos campos **vienen en la response** (spread de `...conv` en `recentPurchases` L3054), pero el tipo `RecentPurchase` en `dashboard-src/src/features/attribution/types/index.ts:153-168` **no los declara** → invisible para el componente.
- `SelectedJourney.tsx` hoy muestra sólo `channelLabel(attributedChannel)` y un `utm_source` por evento, nada del campaign/adset/ad agregado.

### Hallazgo — Stitching por sesiones
- El backend YA trae eventos stitched cross-session para cada purchase (L2941-3058). La consulta usa `userKey`, `customerId`, `sessionId`, `checkoutToken`, `orderId` y expande por `identityGraph`.
- **Pero** el tipo `JourneyEvent` (types/index.ts L128-151) **no incluye `sessionId`**, aunque en la consulta prisma sí se selecciona (L2904). Hay que añadirlo al select map de journeyEvents (L3028-3051) y al tipo.
- `SelectedJourney` hoy sólo parte eventos en pre/post-purchase y los pone en una timeline plana. No agrupa por sessionId ni muestra gaps de tiempo entre sesiones.
- Para que el stitching sea impecable hay que validar que la columna `Event.userKey` siempre se setee desde `_adray_uid` en `backend/routes/collect.js`. Si hay eventos con userKey=null no se unirán al grafo.

### Plan
1. **Backend**: añadir al select de journeyEvents y al mapeo (L2891-2908 y L3028-3051):
   - `sessionId`
   - `rawPayload.utm_campaign`, `utm_content`, `utm_term`, `utm_medium` (como `utmCampaign` etc.)
   - Propagar `attributedCampaign/Adset/Ad/Platform/ClickId/Confidence` del conv al nivel top de `recentPurchases` (ya están ahí — verificar).
2. **Types**: ampliar `JourneyEvent` y `RecentPurchase`.
3. **SelectedJourney UI**:
   - Header: debajo del badge de canal, una línea con "Campaña: X · Adset: Y · Ad: Z" si hay datos.
   - Timeline agrupada por `sessionId`. Cabecera por grupo: "Sesión #n · inicio → fin · duración · landing page · UTM/referrer". Mostrar gap entre sesiones (p. ej. "+10 min después, nuevo navegador").
   - Mantener split pre/post-purchase dentro de cada sesión.
4. **Verificación stitching**:
   - Buscar eventos sin `userKey` en `collect.js` y confirmar que se setean desde `_adray_uid`.
   - En staging, simular dos sesiones distintas con misma cookie y ver si se juntan en el journey.

### Checklist
- [x] Backend: exponer `sessionId`, `userKey`, `utmMedium/Campaign/Content/Term`, `referrer`, `fbclid` en el map de `journeyEvents` (analytics.js).
- [x] Types: extender `JourneyEvent` (sessionId, userKey, utm_*, referrer, fbclid) y `RecentPurchase` (attributedPlatform/Campaign/Adset/Ad/ClickId/Confidence/Source).
- [x] UI header: badge de canal+platform + línea "campaign · adset · ad" bajo el order number.
- [x] UI timeline: `groupBySession()` agrupa eventos por `sessionId`, cada bloque trae landing page, utm_source/medium, campaign/adset/ad y gap "+Xm después · regresa" al siguiente.
- [x] Flag `conversion` en la sesión que contiene el purchase.
- [x] Stitching cross-session ya funcionaba a nivel datos: `collect.js` siempre setea `userKey` desde cookie `_adray_uid` con fallback a UUID; el backend ya unía eventos por userKey + identityGraph + customerId.
- [x] `tsc --noEmit` limpio.
- [x] **VALIDADO EN STAGING** (2026-04-23): Session N/total visible + source y conversion badge por sesión.
- [ ] **BUG DETECTADO**: para clientes repetidos (B2B), el stitching trae eventos de pedidos anteriores del mismo usuario → ver Fix #5.

---

## 4) Desglose del canal "Other" ✅

### Hallazgo
- `normalizeChannelForStats` (L1447-1459) colapsa todo lo que no sea {meta, google, tiktok, organic, unattributed} a `other`. Esto se come: `referral` (cualquier dominio no conocido — hostinger, bing, tiendanube…), `direct`, etc.
- La info se conserva en `conv.attributedPlatform` (ej. `mx.search.yahoo.com`, `hpanel.hostinger.com`, `bing.com`). Sólo no se está renderizando.
- En `HistoricalJourneys` y `SelectedJourney` se muestra sólo `channelLabel` = "Other", sin sub-label.

### Plan
1. Exponer `attributedPlatform` en el tipo `RecentPurchase` (si aún no).
2. En la UI, cuando `attributedChannel === 'other'` (o cualquiera que no esté en el set principal), mostrar un sub-label:
   - Si hay `attributedPlatform`: "Other · {platform}" (ej. "Other · Hostinger Referral", "Other · Bing").
   - Normalizar dominios comunes a etiquetas amigables (bing.com → "Bing Search", hostinger → "Hostinger Referral", yahoo → "Yahoo Search").
3. Aplicar en:
   - `HistoricalJourneys.tsx` (badge del row)
   - `SelectedJourney.tsx` (badge del header)
   - Opcional: `AttributionPieChart` — drill-down tipo tooltip que liste top platforms dentro de "Other".

### Checklist
- [x] Type: `RecentPurchase.attributedPlatform / attributedCampaign / attributedAdset / attributedAd / attributedClickId`.
- [x] Util `friendlyPlatformLabel()` + `channelDisplayLabel()` en `channelColors.ts`.
- [x] Render en HistoricalJourneys (badge truncado + tooltip) + SelectedJourney (header badge).
- [x] `tsc --noEmit` limpio.
- [x] **VALIDADO EN STAGING** (2026-04-23): badge "Other · (direct)" visible para órdenes sin utm/referrer (ver #66919).

---

## Orden de ataque sugerido

1. Tarea #2 (trivial, UI-only, 5 min) — limpia el selector.
2. Tarea #4 (bajo riesgo, solo TS + UI) — da valor inmediato en un canal ruidoso.
3. Tarea #3 (backend + UI, core feature) — requiere extender tipo y rediseñar timeline.
4. Tarea #1 (backend, cuidadoso con override de orderStoredAttribution) — al final para no romper a mitad del resto.

Cada tarea cierra con screenshot/validación del usuario antes de tachar.

---

## 5) Stitching filtra pedidos de otros órdenes del mismo cliente ⬜

### Contexto
Detectado al validar #3 en staging (2026-04-23). El pedido `#66917` (FISCAL FISCAL — B2B recurrente) aparece con **120 eventos · 75 sesiones** y múltiples `Purchase · converted` en fechas dispersas (26-27 mar). Esas sesiones y purchases **no pertenecen** al pedido #66917 sino a otros pedidos previos del mismo usuario.

### Hallazgo
En `backend/routes/analytics.js:2941-2976` (construcción de `recentPurchases`):

```js
const rawStitched = [
    ...(conv.orderId ? (eventsByOrderId.get(String(conv.orderId)) || []) : []),
    ...(conv.checkoutToken ? (eventsByCheckoutToken.get(String(conv.checkoutToken)) || []) : []),
    ...(inferredSessionId ? (eventsBySessionId.get(String(inferredSessionId)) || []) : []),
    ...(inferredUserKey ? (eventsByUserKey.get(String(inferredUserKey)) || []) : []),  // ← trae TODO el histórico
    ...(conv.customerId ? (eventsByCustomerId.get(String(conv.customerId)) || []) : []) // ← idem
];
```

La ventana temporal (`[earliestTs, latestTs]`) acota a `journeyStitchLookbackDays` que puede ser hasta 365 días (`L2279-2283`). Para un cliente que compró 50 veces en ese periodo, se traen las 50 sesiones + 50 purchases previos.

### Plan
Dos cortes combinados, ambos en `backend/routes/analytics.js` dentro del map de `recentPurchases`:

1. **Cortar por purchase anterior del mismo usuario**:
   - Construir fuera del map un índice `priorPurchaseTsByUserKey / ByCustomerId` a partir de `modeledConversions` (sorted desc por timestamp).
   - Para cada conv, buscar el purchase inmediatamente anterior del mismo `userKey`/`customerId` y calcular `boundaryTs`. Usar `effectiveEarliestTs = Math.max(earliestTs, boundaryTs + 1)`.
   - Efecto: el journey de #66917 empieza justo después del purchase #66919 (el anterior del mismo usuario), no 365 días atrás.

2. **Excluir eventos con `orderId` perteneciente a otra orden**:
   - En el `for (const ev of rawStitched)` antes del `uniqueEventsMap.set`, filtrar `ev.orderId && String(ev.orderId) !== String(conv.orderId)`.
   - Efecto: purchase events de otros pedidos del mismo cliente no se cuelan aunque caigan en la ventana.

Estos dos cortes son complementarios: (1) es la defensa primaria para page_views/add_to_carts históricos, (2) es defensa de belt-and-suspenders para purchase events concretos.

### Riesgo
- Si un cliente hace **dos pedidos el mismo día con minutos de diferencia**, el segundo pedido mostrará journey correcto (desde purchase del primero), pero el primero podría "prestar" add_to_carts realizados inmediatamente antes del segundo pedido. Aceptable — la alternativa (journey vacío) es peor.
- No afecta a clientes nuevos: `boundaryTs === null` → se mantiene el comportamiento actual.

### Checklist
- [x] Construir índice `priorPurchaseTsByUserKey/ByCustomerId` sobre `modeledConversions` (sorted asc).
- [x] Helper `priorBoundaryTs(userKey, customerId, convTs): number | null`.
- [x] Aplicar `effectiveEarliestTs = Math.max(earliestTs, boundary + 1)`.
- [x] Filtrar `ev.orderId !== conv.orderId` en el loop de `rawStitched` y en el fallback customer-id query.
- [ ] **PRUEBA PENDIENTE** en staging con #66917 (FISCAL FISCAL): debe bajar de 75 sesiones a algo razonable (~1-3) y mostrar sólo 1 Purchase.
- [ ] **PRUEBA PENDIENTE** Regresión: verificar que pedidos de clientes nuevos (1 sola compra) mantienen su journey completo.

---

## 6) Atribución extremadamente robusta — enrichment + click-ID resolution ⬜

### Contexto
Al validar Fix #3 en staging, detectamos que:
- Pedido #66924 ("Other · Fb"): muestra campaign/adset/ad completos (IDs de Meta) porque el landing URL traía `utm_campaign/content/term`.
- Pedido #66933 ("Meta"): sólo muestra `adset: /` basura. El cliente llegó con `fbclid` pero sin UTMs, y el `orderStoredAttribution` no resolvió campaña.

El dashboard debe **siempre** decir de dónde vino el cliente. Si no hay UTMs pero hay `fbclid`/`gclid`, al menos mostrar "Meta Ads · click ID: xxx…" y (para Google Ads) **resolver el nombre de campaña consultando Google Ads API directamente** con el refresh token OAuth del usuario.

### Hallazgo
Código relevante: [analytics.js:2768-2782](backend/routes/analytics.js#L2768-L2782) y la construcción de `orderStoredAttribution`. Toma campaign/adset/ad de **un solo** snapshot (`orderAttributionSnapshot`) aunque haya 4 fuentes disponibles.

Valores basura: `utm_content='/'` se pega literal como "adset: /". No hay sanitización.

Google Ads API: tiene un reporte `click_view` que permite query por gclid + fecha. Ya tenemos OAuth conectado + `googleAdsService.searchGAQLStream`. Meta NO expone fbclid→campaign públicamente — es una decisión de privacidad de Meta.

### Plan implementado

1. **Sanitización** (`sanitizeAttrValue`, `firstAttrValue` en analytics.js): tira `/`, `null`, `undefined`, `(none)`, `-`, paths cortos (`/producto/...`), strings vacíos.
2. **Enriquecimiento multi-fuente**: después de elegir el `primary`, rellenar null de `campaign/adset/ad/clickId/platform` con la primera fuente disponible entre `orderSnapshot`, `checkoutSnapshot`, `purchasePayload`, sessions ordenadas. Así si un pedido trae `fbclid` pero una sesión previa del mismo usuario traía UTMs completos, la campaña aparece.
3. **Click-ID provider**: `attributedClickIdProvider: 'meta'|'google'|'tiktok'|null` en el response. Frontend lo usa para renderizar `"Meta Ads · click ID: CjwK…"` en lugar de atribución vacía.
4. **Attribution source badge**: el SelectedJourney muestra la fuente ("click ID", "UTM", "order sync", "woo", "Google Ads lookup") como debug visible.
5. **Click-ID resolver** (`backend/services/clickIdResolver.js`):
   - **gclid → campaign/adGroup/ad name**: query `click_view` en Google Ads API usando el refresh token OAuth del usuario dueño de la shop. Cache in-memory 12h (positivos) / 30m (negativos).
   - **fbclid**: stub documentado — Meta no expone este mapeo. La solución es configurar UTMs en Ads Manager (ver "Pasos manuales" abajo).
   - **ttclid**: stub — agregar cuando se integre OAuth de TikTok.
   - Resolución en bulk, concurrency 4, timeout 6s por request → nunca bloquea el dashboard.
6. **Integración en analytics.js**: tras construir `recentPurchases`, recoger hasta 20 órdenes con clickId pero sin campaign y resolver en paralelo. Cache mantiene las resoluciones entre requests.

### Checklist
- [x] `sanitizeAttrValue` + `firstAttrValue` helpers en analytics.js.
- [x] Multi-source enrichment de campaign/adset/ad/clickId/platform tras `finalAttribution.primary`.
- [x] `attributedClickIdProvider` derivado y expuesto en response.
- [x] `RecentPurchase.attributedClickIdProvider` en el tipo TS.
- [x] `backend/services/clickIdResolver.js` nuevo: `resolveClickId` + `resolveMany` con cache + timeouts.
- [x] Integración en analytics.js (`await clickIdResolver.resolveMany(...)` después de `recentPurchases`).
- [x] UI: SelectedJourney muestra "Meta Ads · click ID: …" como fallback cuando no hay campaña.
- [x] UI: badge "attribution source: click ID / UTM / order sync / …".
- [x] `node -c` + `tsc --noEmit` limpios.
- [ ] **PRUEBA PENDIENTE**: en staging, buscar órdenes de Meta como #66933 → debería mostrar "Meta Ads · click ID: ..." en header.
- [ ] **PRUEBA PENDIENTE**: órdenes con gclid → después de ~10s el nombre de campaña de Google Ads debería aparecer (primera request resuelve + cachea; recarga muestra cached).
- [ ] **PRUEBA PENDIENTE**: confirmar que ya no aparece "adset: /" ni valores basura.

### Pasos manuales del usuario (dejar listo)

**Para Google Ads (resolución automática de gclid)**:
1. Confirmar que hay conexión OAuth activa (en Integrations → Google Ads aparece "Connected").
2. Confirmar que la env var `GOOGLE_ADS_DEVELOPER_TOKEN` está seteada en Render.com (staging + prod). Sin este token, `searchGAQLStream` falla con 401 y el resolver devuelve null silenciosamente.
3. Primera vez que abres el dashboard tras el deploy: órdenes con `gclid` sin campaign verán "Google Ads · click ID: …" por ~10s, luego recarga y deberían mostrar el nombre de la campaña. Es normal (tiempo de consulta a Google + cache fill).
4. El resolver reintenta cada 30 min los negativos y cada 12h los positivos. Si un gclid no resuelve nunca, probablemente es porque el click ocurrió hace >90 días (límite de `click_view`) o no era de una campaña propia del customer conectado.

**Para Meta Ads (fbclid no resoluble por API)**:
Meta **no expone** fbclid → campaña. La única solución robusta es forzar que el pixel reciba UTMs reales. Configurar en Ads Manager para **todos los anuncios activos**:
1. Ir a Ads Manager → seleccionar Ad → scroll a "Tracking" → "URL parameters".
2. Pegar esta plantilla:
   ```
   utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}
   ```
3. Guardar y publicar. Meta sustituye `{{campaign.name}}` etc. automáticamente al momento del click. El pixel capturará esos UTMs y el dashboard mostrará el nombre humano.
4. Efecto: nuevos clicks traen campaña correctamente en ~5 min (propagación Meta). Clicks ya existentes no cambian — esos seguirán mostrando "Meta Ads · click ID: …" que ya es mucho mejor que el vacío.
5. Documentar esto en el onboarding de nuevas cuentas (tarea follow-up fuera del scope de esta iteración).

**Para TikTok Ads**: pendiente — integración OAuth aún no conectada. Mismo patrón de UTMs manuales aplica como workaround.

### Fases futuras (no en este PR)
- Mover cache del resolver a Mongo (`ClickIdCache` collection) para sobrevivir restarts de Render.
- Correr resolver en BullMQ worker async (no in-line) para no añadir latencia al dashboard.
- Para fbclid: evaluar si Meta Marketing API agrega algún endpoint de resolución (seguimiento; hoy no hay).
- Badge/tooltip en el UI que explique al usuario el origen del click ID provider cuando el campaign name tarda en aparecer.
