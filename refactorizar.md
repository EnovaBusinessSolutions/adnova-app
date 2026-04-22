# Brief técnico — Refactor del panel Attribution a React nativo

**Para:** German (dev frontend Adray)
**De:** Jose
**Objetivo:** reemplazar `public/adray-analytics.html` (iframe HTML standalone) por un panel React nativo dentro de `dashboard-src/`, consistente con el resto del dashboard.
**Duración estimada:** 3–4 semanas en fases mergeables.
**Modo:** no destructivo — el iframe actual sigue operativo hasta que el v2 esté completo y validado.

---

## 1. Contexto y motivación

El panel `/dashboard/attribution` se renderiza hoy vía un `<iframe>` (`dashboard-src/src/pages/AttributionEmbed.tsx`) que carga `public/adray-analytics.html`. Ese HTML standalone tiene hoy **~11,100 líneas** que incluyen su propio `<style>` block, Tailwind CDN, Chart.js CDN, Font Awesome y ~1,400 funciones JS inline.

Esa decisión fue razonable en su momento (el panel existió antes de que el dashboard React estuviera maduro), pero hoy acumula deuda técnica que vamos a pagar en cada iteración futura:

- **Dos sistemas de CSS paralelos.** El dashboard usa variables `--adray-*` en `dashboard-src/src/index.css`, shadcn-ui (`Card`, `Button`, `HoverCard`, `Tooltip`), Tailwind configurado en `dashboard-src/tailwind.config.ts`. El iframe usa variables `--dash-*`, clases custom (`.dashboard-hero`, `.ops-panel`, `.analytics-loader-*`), Tailwind vía CDN (sin tree-shaking), y no puede consumir ningún componente de shadcn. Cada cambio de sistema de diseño hay que hacerlo dos veces.
- **Dos contextos de scroll.** El sticky del header dentro del iframe tiene bugs de comportamiento no triviales (promoción a capa de composición, `will-change`, `backdrop-filter`) que no existirían en un componente React puro.
- **Sin reutilización.** Selectores, cards, tooltips, modales, hover cards — todo está reimplementado desde cero dentro del HTML en vez de consumir lo que ya existe en `dashboard-src/src/components/ui/`.
- **Sin tipado.** TypeScript cubre el 100% del dashboard excepto este panel.
- **Sin hot reload** durante desarrollo — hay que refrescar el iframe manualmente para ver cambios.
- **Responsive a mano** con media queries custom en vez de `sm:` `md:` `lg:` de Tailwind.
- **Backend serving overhead**: el backend tiene que servir el `.html` estático + coordinar con el React app, en vez de que todo viva en el bundle React.

Este refactor elimina toda esa duplicación.

---

## 2. Scope funcional — qué hay que portar

Todo lo que está visible hoy en `/dashboard/attribution` en staging (`https://adray-app-staging-german.onrender.com/dashboard/attribution`) debe seguir funcionando idéntico en el v2. Inventario de secciones (en orden de aparición en la UI):

**Header / controles (`.dashboard-hero`)**
- Selector Store (shop switcher con lista autorizada + persistencia en localStorage + sincronización con URL)
- Selector Range (7 / 14 / 30 / 90 days + custom)
- Selector Start / End (date inputs)
- Selector Model (LastClick / FirstClick / Linear / TimeDecay / Position)
- Botón Refresh (revalida datos)
- Botón Export data (abre export modal)

**Core KPIs (Metric Cards)**
- Total Revenue
- Total Orders
- Orders Atribuidos (Attributed Orders)
- Sessions
- Conversion Rate
- Page Views
- View Item
- Add To Cart
- Begin Checkout
- Purchase Events
- Unattributed Orders
- Unattributed Revenue
- Meta Ads (spend + ROAS)
- Google Ads (spend + ROAS)
- TikTok Ads (spend + ROAS)

**Top Row**
- Live Feed (SSE real-time de eventos del pixel, con pausa/reanudar + Load More)
- Recommendations / Conversion Paths (filtros All / Meta / Google / TikTok / Organic)
  - Historical Conversion Journeys (lista paginada con búsqueda por user + Load More)
  - Selected Journey panel (detalle del journey elegido: UTM URL history + Download CSV + toggle Condensed/Full + lista de events con sesiones)

**Charts Row**
- Attribution breakdown chart (Chart.js bar/line — migrar a `recharts` que ya usa el dashboard)
- Attribution pie chart (Chart.js pie — migrar a `recharts`)
- Trend chart

**Session Detail Panel** (`#session-detail-panel`, lateral, hidden por defecto)
- Información de la sesión seleccionada
- Session compare panel (comparar 2 sesiones)
- Integración con rrweb para replay de sesión (ya existe `backend/api/recording/...`)

**Support Grid (fila inferior)**
- Pixel Health Panel
- Paid Media Panel (Meta + Google + TikTok ad accounts)
- Top Products Panel
- Data Enrichment Panel + Data Enrichment Modal

**User Explorer Panel** (secundario)
- Lista de usuarios conectados / online (wordpress-users-online endpoint)
- Session explorer

**Export Modal**
- Selector de candidatos (fecha, tipo de evento)
- Descarga CSV

**Tooltip global custom**
- Hay un `<div id="adray-global-tooltip">` que captura hovers con `data-tooltip="..."` en todo el panel. Migrar a `Tooltip` de shadcn.

---

## 3. Inventario técnico

### Endpoints backend que usa hoy
```
GET  /api/session
GET  /api/analytics/shops
GET  /api/analytics/${shopId}                             (query params: range, model, start, end, etc.)
GET  /api/analytics/${shopId}/export/candidates?...
POST /api/analytics/${shopId}/export/download
GET  /api/analytics/${shopId}/session-explorer?limit=...
GET  /api/analytics/${shopId}/sessions/${sessionId}
GET  /api/analytics/${shopId}/wordpress-users-online?...
GET  /api/recording/${shopId}/list?limit=...
GET  /api/recording/${shopId}/${recordingId}
GET  /api/recording/${shopId}/${recordingId}/insights
GET  /api/recording/${shopId}/by-user?...
GET  /api/meta/insights/accounts                          (+ POST .../selection)
GET  /api/google/ads/insights/accounts                    (+ POST .../selection)
EventSource /api/feed/${shopId}                           (SSE)
```

Ninguno cambia. El refactor solo consume los mismos endpoints desde React. Cualquier ajuste de shape va a backend antes.

### Librerías externas cargadas vía CDN hoy
- Tailwind CSS (CDN)
- Chart.js (CDN)
- Font Awesome (CDN)
- Google Fonts — Inter
- `@font-face` Ulm Grotesk (ya eliminada en FASE 2, pero el archivo `public/fonts/UlmGrotesk-Bold.otf` sigue en el repo — se borra al final del refactor)

En React todas quedan como dependencias de `dashboard-src/package.json` — Tailwind ya está, Chart.js se sustituye por `recharts` (ya instalado), Font Awesome se sustituye por `lucide-react` (ya instalado), Inter se sirve vía Google Fonts link en el `index.html` del dashboard (ya está).

### Estado y sincronización
- Shop ID: persiste en `localStorage` con key `adray_analytics_shop` + sincroniza con URL param `?shop=...`.
- Shop changes se comunican al parent React via `postMessage({ type: "adray:analytics:shop-changed", shop })` — en el v2 esto desaparece porque ya no hay parent/child, todo vive en el mismo contexto React.
- Date range / model / range preset: hoy en JS vars — migrar a `useState` o a URL params (preferible URL params para que la vista sea compartible).

### Live Feed (SSE)
- Endpoint: `EventSource('/api/feed/${shopId}')`
- Eventos: cada evento trae un payload (page view, viewed product, add to cart, etc.)
- UI mantiene buffer con Load More y posibilidad de pausar.
- En React: hook custom `useLiveFeed(shopId)` que retorna `{ events, paused, togglePause, loadMore, connectionState }`. Manejar reconexión, unsubscribe en cleanup del useEffect.

---

## 4. Arquitectura objetivo

Todo dentro de `dashboard-src/src/`. **Nada nuevo en `public/`, nada nuevo servido por backend como estático.**

### Ruta
- Nueva ruta: `/dashboard/attribution-v2` (feature flag por query param `?v2=1` o por env var en desarrollo). Al terminar el refactor, la ruta default `/dashboard/attribution` apunta al componente nuevo y la v1 se borra.

### Estructura de archivos propuesta
```
dashboard-src/src/
├── pages/
│   ├── Attribution.tsx                    ← nuevo página principal (reemplaza AttributionEmbed)
│   └── AttributionEmbed.tsx               ← se borra al final de FASE E
├── features/attribution/                  ← nuevo directorio
│   ├── components/
│   │   ├── AttributionHeader.tsx          ← selectores + refresh + export
│   │   ├── ShopSwitcher.tsx
│   │   ├── DateRangePicker.tsx
│   │   ├── ModelSelector.tsx
│   │   ├── KpiGrid.tsx                    ← grid de las 15 KPI cards
│   │   ├── KpiCard.tsx                    ← componente reutilizable
│   │   ├── LiveFeed.tsx
│   │   ├── LiveFeedItem.tsx
│   │   ├── ConversionPaths.tsx
│   │   ├── HistoricalJourneys.tsx
│   │   ├── SelectedJourney.tsx
│   │   ├── AttributionChart.tsx           ← usa recharts
│   │   ├── AttributionPieChart.tsx        ← usa recharts
│   │   ├── TrendChart.tsx                 ← usa recharts
│   │   ├── SessionDetailPanel.tsx
│   │   ├── SessionComparePanel.tsx
│   │   ├── PixelHealthPanel.tsx
│   │   ├── PaidMediaPanel.tsx
│   │   ├── TopProductsPanel.tsx
│   │   ├── DataEnrichmentPanel.tsx
│   │   ├── DataEnrichmentModal.tsx
│   │   ├── UserExplorerPanel.tsx
│   │   └── ExportModal.tsx
│   ├── hooks/
│   │   ├── useAnalytics.ts                ← fetch /api/analytics/${shopId}
│   │   ├── useLiveFeed.ts                 ← SSE
│   │   ├── useShops.ts
│   │   ├── useRecording.ts
│   │   ├── useAttributionFilters.ts       ← state de filtros (model, range, channel)
│   │   └── useShopPersistence.ts          ← localStorage + URL sync
│   ├── api/
│   │   └── attribution.ts                 ← funciones fetch tipadas
│   ├── types/
│   │   └── index.ts                       ← interfaces TypeScript de toda la data
│   └── utils/
│       ├── formatters.ts                  ← format currency, percentages, dates
│       └── channelColors.ts               ← paleta Meta/Google/TikTok/Organic
```

### Principios del componente nuevo
- Toda la UI consume `@/components/ui/*` (shadcn) — Card, Button, Dialog, HoverCard, Tooltip, Select, Popover, Input, etc. Cero clases CSS custom salvo casos muy puntuales.
- Estilo 100% Tailwind utility. Cero `<style>` tags, cero CSS modules para este feature.
- Todo fetching vía hooks con `useQuery` de TanStack Query (si ya está en el proyecto) o, si no, via `useEffect + useState + AbortController` uniformizado en un helper `useFetch`.
- Sticky del header: `<div className="sticky top-0 z-50 ...">` sobre el scroll container natural de la página React (no iframe). Funciona sin parches.
- Mobile first — breakpoints `sm:` (≥640px) y `lg:` (≥1024px) como tiene el resto del dashboard.
- Cero `postMessage`, cero `window.parent`, cero iframe.

---

## 5. Estrategia de entrega — no destructiva

**Regla de oro:** el iframe actual (`/dashboard/attribution` + `public/adray-analytics.html`) sigue 100% operativo en producción durante todo el refactor. Se borra solo cuando el v2 esté validado E2E.

### Flujo
1. **Branch principal de trabajo:** `feature/attribution-react-refactor` (creada desde `main`).
2. **Sub-branches por fase:** `feature/attribution-v2-phase-a`, `-b`, `-c`, `-d`. Cada una mergea a `feature/attribution-react-refactor` cuando esté validada en staging.
3. **Ruta feature-flagged:** durante el refactor, el v2 vive en `/dashboard/attribution?v2=1` (o mejor: `/dashboard/attribution-v2`). Solo Jose / dev team lo activa para validar. El `/dashboard/attribution` sin flag sigue mostrando el iframe.
4. **Staging deploy:** cada fase mergea a `german/dev` → auto-deploy a staging → validación visual y funcional → aprobación de Jose → cherry-pick o merge a `main` si aplica.
5. **Switch final (FASE E):** cuando las fases A–D están mergeadas y validadas E2E en producción bajo el flag, se cambia el `<Route path="/dashboard/attribution">` para que apunte al componente v2. El `AttributionEmbed.tsx` + `public/adray-analytics.html` + `public/fonts/UlmGrotesk-Bold.otf` se borran. Backend: remover el endpoint que sirve el HTML si aplica.

### Por qué esta estrategia
- Cero riesgo para producción durante el refactor.
- Jose puede comparar v1 vs v2 lado a lado abriendo dos tabs.
- Si una fase regresiona algo, se revierte sin afectar el iframe vigente.
- El PR de cada fase es chico y reviewable.

---

## 6. Plan por fases

Cada fase es mergeable por sí misma. Las fases A–D llegan a producción bajo feature flag. La E hace el switch definitivo.

### FASE A — Esqueleto + Header + KPIs (1 semana)
- Crear estructura `features/attribution/`
- Crear `Attribution.tsx` nueva con ruta flag-gated
- Portar `AttributionHeader` (shop switcher, date range, model selector, refresh, export button placeholder)
- Portar `KpiGrid` con los 15 KPI cards como `<Card>` shadcn
- Hook `useAnalytics(shopId, filters)` que pega a `/api/analytics/${shopId}`
- Hook `useShops()` y `useShopPersistence()`
- Sticky del header funcionando nativo
- **Criterio de aceptación:** ruta `/dashboard/attribution?v2=1` carga con el header sticky, selectores funcionales (cambiar Shop refetch data, cambiar Range refetch data), las 15 KPI cards muestran los números correctos con los mismos formatters que v1 (currencies MX$, percentages, thousands separator). Sticky se pega al scroll de la página React (no iframe). Cero errores en console. Build pasa.

### FASE B — Live Feed + Conversion Paths + Charts (1 semana)
- Hook `useLiveFeed(shopId)` con SSE + reconexión + pausa
- Componente `LiveFeed` con la lista en tiempo real + Load More
- Componente `ConversionPaths` con los filtros All/Meta/Google/TikTok/Organic
- Componente `HistoricalJourneys` con paginación y search por user
- Componente `SelectedJourney` con UTM history + Condensed/Full toggle + Download CSV
- Migrar `AttributionChart` y `AttributionPieChart` de Chart.js → `recharts`
- Paleta de canales unificada (`utils/channelColors.ts`)
- **Criterio de aceptación:** Live Feed pushea eventos en tiempo real sin memory leaks (revisar React DevTools Profiler). Charts renderizan con los mismos datos que v1 (color, proporciones, tooltips). Conversion paths y journeys paginables.

### FASE C — Session Detail + User Explorer + Support Grid (3-5 días)
- Componente `SessionDetailPanel` con apertura lateral animada (usar `Sheet` de shadcn)
- Componente `SessionComparePanel` (si se usa en producción — validar con Jose antes si es prioridad)
- Hook `useRecording` para rrweb playback
- Componente `UserExplorerPanel` con wordpress-users-online + session-explorer
- `PixelHealthPanel`, `PaidMediaPanel`, `TopProductsPanel`
- **Criterio de aceptación:** todos los paneles laterales / secundarios funcionan como en v1. Session replay (rrweb) arranca correctamente.

### FASE D — Data Enrichment + Export Modal + Polish (2-3 días)
- `DataEnrichmentPanel` + `DataEnrichmentModal`
- `ExportModal` completo (candidates + download CSV)
- Tooltip global unificado con `Tooltip` shadcn
- Loading states premium (consistentes con `AttributionEmbed` loader actual — glassmorphism, particles, gradient progress)
- Empty states premium
- prefers-reduced-motion respetado
- **Criterio de aceptación:** parity funcional 100% con v1. Export CSV baja el mismo archivo que v1. Data enrichment flow idéntico.

### FASE E — Switch + Cleanup (medio día)
- Cambiar `<Route path="/dashboard/attribution">` de `<AttributionEmbed />` a `<Attribution />` (el nuevo)
- Borrar `dashboard-src/src/pages/AttributionEmbed.tsx`
- Borrar `public/adray-analytics.html`
- Borrar `public/fonts/UlmGrotesk-Bold.otf`
- Remover (si aplica) cualquier ruta de backend que sirva el HTML o los fonts
- Quitar feature flag `?v2=1`
- Actualizar `CLAUDE.md` y `README.md` para reflejar que Attribution es componente React
- **Criterio de aceptación:** todo el QA de fases A–D sigue pasando sin feature flag. Bundle size del dashboard disminuye considerablemente (menos Chart.js CDN, menos iframe overhead). Lighthouse score del panel sube (sin iframe + sin CDN double-fetch).

---

## 7. Stack técnico objetivo

- **Framework:** React 18 + TypeScript + Vite (ya configurado en `dashboard-src/`)
- **Estilos:** Tailwind con `tailwind.config.ts` existente + variables `--adray-*` de `index.css` existente
- **Componentes:** shadcn-ui existentes en `dashboard-src/src/components/ui/` (Card, Button, Dialog, HoverCard, Tooltip, Select, Popover, Input, Badge, Sheet, ScrollArea, Tabs, Separator, etc.). Si falta alguno, instalar con `npx shadcn-ui@latest add <componente>`.
- **Iconos:** `lucide-react` (ya instalado)
- **Charts:** `recharts` (ya instalado) — NO Chart.js
- **Fechas:** `date-fns` (validar que esté o instalar)
- **Fetching:** TanStack Query si ya está en `dashboard-src/package.json`; si no, `useEffect + AbortController + typed fetch` uniformizado
- **State:** `useState` + `useReducer` para state local; URL params (`useSearchParams`) para filtros compartibles
- **Forms:** `react-hook-form` + `zod` si se necesitan (probablemente para el export modal)
- **Routing:** React Router v6 (ya configurado)

---

## 8. Reglas estrictas

- ❌ **No** modificar `public/adray-analytics.html` ni ninguno de sus assets durante las fases A–D. Se toca solo en FASE E para borrarlo.
- ❌ **No** crear nuevos archivos en `public/` para el feature nuevo.
- ❌ **No** servir nada nuevo desde el backend como HTML estático.
- ❌ **No** usar Chart.js en el componente nuevo — solo `recharts`.
- ❌ **No** copiar-pegar CSS del HTML al componente React — reescribir con Tailwind.
- ❌ **No** usar `<style>` tags inline o CSS modules — solo Tailwind utilities + variables de `index.css`.
- ❌ **No** usar `postMessage` ni `window.parent` — el componente vive en el mismo contexto React.
- ❌ **No** instalar librerías CDN — todo como dependencia npm en `dashboard-src/package.json`.
- ❌ **No** mergear a `main` sin validación visual de Jose en staging.
- ✅ **Sí** escribir tests unitarios para hooks críticos (`useLiveFeed`, `useAnalytics`, `useShopPersistence`) y tests de componente para `KpiGrid` y `ConversionPaths` con Vitest + React Testing Library.
- ✅ **Sí** tipar todo. `any` solo con comentario justificando.
- ✅ **Sí** respetar `prefers-reduced-motion` en todas las animaciones.
- ✅ **Sí** mobile first con `sm:` `md:` `lg:`.
- ✅ **Sí** dejar feature flag activo hasta FASE E.
- ✅ **Sí** documentar el shape de la respuesta de cada endpoint en `features/attribution/types/index.ts`.

---

## 9. Criterios globales de aceptación (al cerrar FASE E)

1. Usuario en `/dashboard/attribution` ve exactamente los mismos números, gráficas, live feed, conversion paths y paneles que antes — cero regresiones funcionales.
2. No hay iframe en el DOM de la página.
3. Sticky del header funciona sin parches en desktop y tablet.
4. Build de producción pasa (`npm run build`) sin warnings nuevos.
5. Lint pasa (`cd dashboard-src && npm run lint`).
6. Tests unitarios pasan (`cd dashboard-src && npm test` si aplica).
7. Lighthouse performance del panel sube al menos 10 puntos vs v1 (medir antes y después).
8. Bundle size del dashboard sube en `X` kB por la incorporación, pero ya no se sirve el HTML standalone ni Chart.js CDN — el neto debería ser neutro o favorable.
9. Console sin errores ni warnings de React.
10. Mobile (<640px): el panel es usable. KPIs stackean vertical, selectores se adaptan.
11. `public/adray-analytics.html` y `AttributionEmbed.tsx` eliminados del repo.
12. `CLAUDE.md` y `README.md` reflejan la nueva arquitectura.

---

## 10. Checklist operativo para arrancar FASE A

- [ ] Leer este documento completo antes de tocar código.
- [ ] Revisar `dashboard-src/src/index.css` para entender las variables `--adray-*` disponibles.
- [ ] Revisar `dashboard-src/src/components/ui/` para inventariar los componentes shadcn existentes.
- [ ] Confirmar si `@tanstack/react-query` está en `dashboard-src/package.json`. Si no, decidir con Jose si se instala o se hace fetching manual.
- [ ] Crear branch `feature/attribution-v2-phase-a` desde `german/dev`.
- [ ] Abrir `/dashboard/attribution` en staging con DevTools → Network y hacer una sesión completa de uso (cambiar shop, rango, modelo, hacer refresh, export) para capturar el shape real de cada endpoint.
- [ ] Escribir `features/attribution/types/index.ts` con las interfaces.
- [ ] Arrancar por `AttributionHeader` + `KpiGrid`.
- [ ] Validación visual con Jose antes de pasar a FASE B.

---

## 11. Preguntas pendientes para resolver con Jose antes de FASE A

1. ¿Hay alguna sección del panel v1 que **no se use en producción** o que se quiera eliminar? (Si algo se puede recortar, recorta — menos scope es más velocidad.)
2. ¿Hay URLs de filtros que deberían ser compartibles? (Sugerencia: sí, todos los filtros en query params.)
3. ¿Hay alguna feature nueva que Jose quiere aprovechar para meter mientras se hace el refactor? (Regla: cero scope creep. Si es "nice to have", después del refactor.)
4. ¿Timeline hard? ¿Hay deadline de cliente o demo que obligue a acelerar?
5. Permitir borrar `public/fonts/UlmGrotesk-Bold.otf` al cerrar FASE E (confirmar que ningún otro surface del repo lo referencia).

---

## 12. Notas finales

Este refactor no es "tirar lo de German y hacerlo de nuevo". El HTML standalone cumplió su función mientras el dashboard React maduraba. Hoy el dashboard es suficientemente robusto para absorber este panel nativamente, y mantener dos codebases duplicados cuesta más que portarlo. El diseño visual del v1 (glassmorphism morado, KPIs, Live Feed) se preserva — solo cambia el substrato técnico.

El plan por fases con feature flag garantiza que en ningún momento el usuario final ve un panel roto. Si algo sale mal en una fase, se revierte sin consecuencias.

Cualquier duda técnica durante el refactor se consulta con Jose antes de tomar decisiones que afecten el scope o el contrato de datos con backend.