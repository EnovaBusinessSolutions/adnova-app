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
- [ ] **PRUEBA PENDIENTE**: en staging, alternar Last/First/Linear con la misma fecha y confirmar que:
   - (a) el Pie Chart se mueve (`AttributionPieChart`).
   - (b) KPI de attributedRevenue cambia.
   - (c) En Conversion Paths los badges de canal cambian para órdenes con historial de varias sesiones.

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
- [ ] **PRUEBA PENDIENTE**: confirmar en UI que el selector sólo muestra 3 opciones (Last Click, First Click, Linear).

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
- [ ] **PRUEBA PENDIENTE**: abrir un purchase con >1 sesión en staging y verificar: (a) aparece "Session 1 / N", (b) se ve gap entre sesiones, (c) el header muestra campaign/adset/ad cuando hay UTMs.

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
- [ ] **PRUEBA PENDIENTE**: en staging, validar que pedidos de hostinger/bing/yahoo muestren su sub-label (ej. "Other · Hostinger Referral").

---

## Orden de ataque sugerido

1. Tarea #2 (trivial, UI-only, 5 min) — limpia el selector.
2. Tarea #4 (bajo riesgo, solo TS + UI) — da valor inmediato en un canal ruidoso.
3. Tarea #3 (backend + UI, core feature) — requiere extender tipo y rediseñar timeline.
4. Tarea #1 (backend, cuidadoso con override de orderStoredAttribution) — al final para no romper a mitad del resto.

Cada tarea cierra con screenshot/validación del usuario antes de tachar.
