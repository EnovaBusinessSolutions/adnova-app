# Pixel Bulletproof — plan ad-blocker proof + pendientes urgentes

Branch destino: `german/dev` (staging) → `main` (prod)
Owner: Germán
Creado: 2026-04-23

Este doc tiene dos partes:
1. **Pendientes urgentes del proyecto** — foto del backlog real que no se ha cerrado (P0/P1 del README + follow-ups de nuestra sesión de atribución).
2. **Plan pixel bulletproof** — hacer que `/collect` sea imposible de bloquear por Brave Shields, uBlock, AdBlock Plus, Privacy Badger, etc.

El pixel se bloquea hoy en ~20-30% de usuarios (Brave por default, todos los usuarios con ad-blocker); sin atribución confiable el panel pierde sentido como fuente de verdad.

---

## Parte 1 — Pendientes urgentes del proyecto

### Validaciones pendientes (nuestra sesión de atribución)
- [ ] Fix #5 scoping del journey — verificar #66917 con cliente real sin shields bloqueando.
- [ ] Fix #6 sanitización — confirmar que `adset: /` desapareció en todos los pedidos (ya desplegado, pendiente ojo en staging).
- [ ] Fix #6 click-ID provider fallback — abrir #66933 tras deploy y confirmar que aparece "Meta Ads · click ID: …".
- [ ] Fix #6 Google Ads API resolver — validar con el primer pedido real que venga con `gclid` una vez se corrija el bloqueo.
- [ ] Live Feed channel badge — validar visualmente en staging.

### Del README — P0 (bloquean producción)
- [ ] **Meta CAPI real**: `backend/services/capiFanout.js` es placeholder. No se están mandando purchases reales a Meta → Meta no optimiza campañas. **Crítico** si vendemos Adray como "mejora CAPI coverage".
- [ ] **Shopify pixel validation**: Woo ya pasó el smoke test; Shopify falta. Sin esto no podemos vender a merchants Shopify con confianza.

### Del README — P1 (riesgos altos)
- [ ] **`ENCRYPTION_KEY` regenerate on restart**: cada deploy de Render rota la key → tokens OAuth guardados en DB se vuelven basura → usuarios tienen que reconectar Meta/Google. Fix: fijar la key en env var y fallar fuerte si no está.
- [ ] **Rate limit key legacy**: usa `shop_id` en vez de `account_id` para non-Shopify → una tienda Woo con mucho tráfico puede tumbar el rate limiter global.
- [ ] **Google conversions endpoint stub**: `backend/routes/adrayPlatforms.js` no sube conversiones reales a Google Ads API.
- [ ] **`session_end_at` policy**: fallback al `last_event_at`, pero no hay heartbeat/close explícito → sesiones reales pueden quedar abiertas 24h+.

### Del README — Next Implementation Steps (priorizados previamente)
- [ ] Live Feed polling de estado de usuarios online (refresh periódico además de event-triggered).
- [ ] Identity resolution en Live Feed: cada evento debe mostrar identidad resuelta (name/email/phone/customerId) o indicar explícito "sin identity".
- [ ] Woo sync pagination: hoy hay cap de 100 órdenes — tiendas grandes quedan con histórico truncado.
- [ ] Historical Conversion Journey real names (parcialmente hecho via identity cache; validar exhaustivo).
- [ ] User filter UX fix: input con texto negro sobre fondo blanco + validar filtering funcional.

### Del CLAUDE.md — Known Issues no cerrados
- [ ] `/collect` unstable en producción — **este plan lo aborda directamente**.
- [ ] Prisma+Mongo mismatch en session resolution (bug latente).
- [ ] Export CSV endpoints (`/api/analytics/:id/export/candidates`, `/export/download`) no implementados — hoy el Export modal hace CSV client-side de memoria.
- [ ] `rrweb-player` no instalado en `dashboard-src` → Session Detail panel linkea al presigned URL en lugar de reproducir inline.

### Nuevo (detectado esta sesión)
- [ ] ~20-30% de tráfico bloqueado por ad-blockers (confirmado en Brave con shogun.mx). **Este plan lo resuelve**.
- [ ] Click-id resolver cache es in-memory — se pierde en cada deploy. Mover a Mongo `ClickIdCache` collection.
- [ ] Resolver fbclid: Meta no expone mapping → educar merchants a usar URL tags en Ads Manager. Falta checklist/UI en onboarding que lo verifique.

---

## Parte 2 — Plan pixel bulletproof

### Objetivo
Hacer que la ingesta de eventos del pixel sea indistinguible de tráfico normal de la tienda, de modo que ad-blockers no puedan bloquearla sin romper la propia tienda.

### Por qué es imposible al 100% (y qué es realista)
Ningún pixel es **100% ad-blocker proof** — Brave y uBlock pueden leer JavaScript inline y detectar patrones de telemetría. Pero podemos pasar del ~70% de cobertura actual a **>98%** combinando:
1. First-party proxy (el pixel viaja por el dominio del merchant, no por adray.ai).
2. Server-side tracking para eventos críticos (purchase, checkout) vía webhooks — imposible de bloquear.
3. Resiliencia del browser pixel (sendBeacon + keepalive + fallbacks).

El 2% restante (usuarios con Tor + uBlock dinámico + NoScript) no tiene solución y tampoco hace compras significativas — es ruido aceptable.

### Estrategia en 4 fases

Cada fase es independiente. Se puede merger y validar por separado.

---

#### Fase A — First-party proxy vía subdominio del merchant (impacto más alto)

**Idea**: en lugar de que el pixel haga `POST https://adray.ai/m/s`, haga `POST https://track.shogun.mx/m/s` (o similar). El subdominio `track.*` apunta (vía CNAME) a un proxy que reenvía a `adray.ai/m/s`. Ad-blockers no bloquean dominios de la tienda que visitas — sólo bloquean dominios externos conocidos de tracking.

**Por qué funciona**: Brave Shields, uBlock, etc. trabajan con listas de dominios (EasyList, EasyPrivacy). `adray.ai` está (o estará) en esas listas; `track.shogun.mx` no, porque es un subdominio del site que el usuario eligió visitar. Bloquearlo rompería la tienda.

**Implementación**:

1. **Cloudflare Worker** (más barato, sin servidor propio):
   - Crear worker `adray-proxy` que reciba `*/m/s` y `*/m/b` (beacon), hashe/enmascare headers problemáticos, y haga `fetch('https://adray-app.onrender.com/m/s', ...)`.
   - Devolver la respuesta al cliente con CORS wildcard + sin cookies third-party.
   - Merchant añade CNAME en su DNS: `track.shogun.mx CNAME worker-route.adray.ai`.
   - El pixel JS auto-detecta el endpoint: si está servido desde `shogun.mx`, pide a `track.shogun.mx`; si está servido desde el CDN de Adray, pide a `adray.ai`.

2. **Alternativa en merchant**: si el merchant tiene WordPress + WooCommerce (caso principal nuestro), el **plugin existente** puede servir un endpoint `/wp-json/adray/v1/collect` que reenvía al backend de Adray. Sin CNAME. Sin Cloudflare. Funciona out-of-the-box.
   - Pro: 0 configuración DNS.
   - Contra: añade carga al servidor WordPress; si el hosting es lento, el pixel lo será también.

**Cambios requeridos en el pixel JS** (`public/adray-pixel.js`):
- `ADRAY_ENDPOINT` debe ser configurable por merchant.
- Si el script está servido desde `track.{domain}` o desde el plugin WP, usar ese mismo origin.
- Fallback a `adray.ai/m/s` si no hay proxy configurado.

**Checklist Fase A**:
- [ ] Servicio proxy: Cloudflare Worker con ruta `/m/s` y `/m/b` que reenvía POST+GET con header `X-Adray-Forwarded-For: {worker}`.
- [ ] DNS template: documento con los CNAME que el merchant tiene que configurar.
- [ ] Pixel auto-detect: `ADRAY_ENDPOINT = window.location.hostname + '/m/s'` si el subdominio empieza con `track.`; sino fallback actual.
- [ ] WordPress plugin: endpoint `/wp-json/adray/v1/collect` que hace forward al backend (añadir a plugin v1.3.0).
- [ ] Shopify proxy: evaluar si Shopify App Proxy sirve (`/apps/adray/collect` → endpoint del worker). Documentar.
- [ ] Onboarding UI: paso "Configure tu tracker dominio" con 2 opciones (CNAME o "usar mi WordPress"). Mostrar status live del subdominio (DNS resolve OK / SSL OK / reach endpoint OK).

**Esperado**: bloqueo baja de ~25% a <5% en Brave/uBlock.

---

#### Fase B — Server-side tracking para purchase + checkout (hace el revenue tracking invulnerable)

**Idea**: los eventos más importantes del funnel (`begin_checkout`, `purchase`) ya se capturan via webhooks de WooCommerce/Shopify. Expandir ese camino para que el dashboard **no dependa del pixel** para revenue tracking — sólo para atribución pre-checkout (page_view, view_item, add_to_cart).

**Estado actual**:
- Shopify webhooks: funcionan (`/api/adray-webhooks/shopify/orders/create`).
- WooCommerce webhooks: funcionan (`/api/woo/orders/sync` + real-time plugin hook).
- Pero la **atribución** (fbclid, gclid, UTMs) hoy se toma del snapshot del pixel en `begin_checkout`. Si el pixel está bloqueado en `begin_checkout`, el webhook del purchase llega sin atribución.

**Fix**: hacer que el plugin/app de la tienda capture los UTMs y click IDs **server-side** desde el primer request HTTP y los persista en la sesión PHP/session del merchant. En el webhook `order.created`, el plugin envía esos UTMs al backend junto con el order payload.

**Por qué esto es game changing**: los ad-blockers no pueden tocar tráfico server-to-server. Si el plugin de WP lee `$_GET['fbclid']` en el `init` hook de WordPress, la atribución queda registrada sin que el navegador del usuario tenga que correr nada.

**Implementación**:

1. **WordPress plugin (v1.3.0)**:
   - En `init` hook: leer `fbclid`, `gclid`, `ttclid`, `utm_*` de `$_GET` y persistir en cookie HTTP-only + WC session.
   - En `woocommerce_new_order` hook: leer la cookie + session, anexar al payload del webhook como `server_attribution_snapshot`.
   - Si el cliente completa múltiples visitas, siempre preservar el **first touch** y el **last touch** server-side.
2. **Shopify app** (futuro): mismo patrón vía Shopify App Proxy + metafields de customer.
3. **Backend** (`adrayWebhooks.js`):
   - Al procesar un webhook, si trae `server_attribution_snapshot`, preferirlo sobre el snapshot del pixel (es más confiable).
   - Marcar esos orders con `attributionSource='server_side'` para distinguir en el dashboard.

**Checklist Fase B**:
- [ ] Plugin WP v1.3.0: capturar UTMs + click IDs server-side en `init`.
- [ ] Plugin WP: anexar snapshot al webhook en `woocommerce_new_order`.
- [ ] Backend: leer `server_attribution_snapshot` en `adrayWebhooks.js` y preferirlo sobre pixel.
- [ ] Backend: exponer `attributionSource='server_side'` en el response de analytics.
- [ ] Frontend: nuevo badge "Server-side" en el attribution source del journey.
- [ ] Telemetría: métrica de "cobertura server-side %" en el dashboard de admin.

**Esperado**: revenue tracking llega al 100% aunque el pixel esté bloqueado. Atribución post-click (fbclid/gclid/UTMs) llega al ~98% porque lo captura el server en la primera request.

---

#### Fase C — Resiliencia del browser pixel (cubre el 2% restante)

**Idea**: incluso si el proxy está bien, los ad-blockers modernos hacen pattern matching sobre comportamiento JS. Endurecer el pixel para sobrevivir más casos:

1. **`navigator.sendBeacon()` primario**: más difícil de bloquear que `fetch` porque el navegador lo prioriza al descargar la página. Fallback a `fetch({ keepalive: true })` y de último recurso a Image pixel GIF 1×1 (`new Image().src = '/m/s?data=base64...'`).

2. **Event batching**: en vez de 1 POST por evento, juntar 3-5 events en 1 POST con debounce de 500ms. Menos requests = menos surface para patterns.

3. **Nombre de script genérico**: renombrar `adray-pixel.js` → `app.min.js` o similar. El nombre es una señal obvia para filters.

4. **Sin referencias a palabras sospechosas** (`track`, `pixel`, `analytics`, `collect`) en código inline visible al DOM. Ya las rutas del server son `/m/s` + `/m/b` — extender al JS.

5. **Ofuscación ligera del payload**: `JSON.stringify(payload)` → Base64 → parámetro `d`. No es seguridad, es camuflaje de patrones.

6. **Retry con backoff**: si el primer envío falla, reintentar 3× con jitter. Útil para bloqueos intermitentes o de red.

7. **Preconnect + DNS prefetch**: `<link rel="preconnect" href="https://track.shogun.mx">` en el `<head>` acelera el primer POST.

**Checklist Fase C**:
- [ ] Pixel JS: `sendBeacon → fetch(keepalive) → Image pixel` chain.
- [ ] Batching con debounce 500ms + flush on pageunload/visibilitychange.
- [ ] Rename assets: `adray-pixel.js` → `app.min.js`; loader tag también.
- [ ] Base64 payload en parámetro `d` (opcional).
- [ ] Retry con exponential backoff + jitter.
- [ ] Preconnect tags en página del merchant (via plugin).

**Esperado**: recupera el 1-2% del tráfico que queda atrapado en Fase A+B.

---

#### Fase D — Medición y alertas de bloqueo

**Idea**: saber cuánto tráfico real estamos perdiendo y alertar al merchant si sube.

**Métricas clave**:
- **Pixel coverage rate**: `(orders_with_at_least_1_browser_event) / total_orders`. Target >95%.
- **Attribution coverage rate**: `(orders_with_attributedChannel_not_unattributed) / total_orders`. Target >80%.
- **Server-side coverage**: `(orders_with_server_attribution_snapshot) / total_orders`. Target >95% para merchants con plugin v1.3.0.
- **Bloqueo detectado**: orders cuyo webhook llegó sin ningún browser event previo. Señal fuerte de ad-blocker.

**Implementación**:
- Nuevo endpoint `/api/analytics/:id/pixel-health` con esas métricas para rango de fechas.
- Panel de admin con chart de cobertura semanal.
- Alerta por email al merchant si pixel coverage <80% por 48h seguidas.

**Checklist Fase D**:
- [ ] Endpoint `/api/analytics/:id/pixel-health`.
- [ ] UI: panel "Pixel Health" en Integrations con las 4 métricas.
- [ ] Alerta email al admin si coverage <80% durante 48h.
- [ ] Onboarding: checklist visible de qué fase tiene activa cada merchant (A/B/C).

---

### Orden de ataque recomendado

1. **Fase B primero** (1-2 semanas): revenue tracking es más importante que atribución. Con server-side webhooks + attribution_snapshot del plugin WP, perdemos atribución de quizás 2-5% del tráfico aunque el pixel esté bloqueado, pero conservamos 100% del revenue. Esto desbloquea Adray como fuente de verdad para revenue ya mismo.

2. **Fase A después** (2-3 semanas): el proxy first-party eleva la cobertura de atribución pre-click. Requiere más trabajo de infra (Cloudflare Workers + CNAMEs) y coordinación con merchants.

3. **Fase C en paralelo** (1 semana): mejoras del pixel JS son aisladas y de bajo riesgo. Pueden correr mientras hacemos A y B.

4. **Fase D al final** (1 semana): no mueve la aguja de cobertura pero es la que nos da visibilidad de qué tan bien están funcionando A+B+C y nos deja ajustar.

---

### Criterio de éxito global

Al final de las 4 fases, para cualquier merchant:
- **Revenue tracking**: 100% (server-side via webhooks).
- **Attribution coverage** (channel + campaign resuelto): ≥95% de orders.
- **Cobertura pixel browser** (para heatmaps/journey): ≥90% incluso en audiencias con adblockers altos.

Si alguna métrica no llega al target, iteramos la fase correspondiente antes de seguir.

---

### Riesgos y consideraciones

- **Privacidad**: al proxyear por el dominio del merchant, los datos pasan por su DNS y posiblemente logs. Política privacy del merchant debe declararlo.
- **Cloudflare Worker costs**: a alto volumen ($/request puede sumar). Alternativa: self-host proxy en Render.
- **SSL cert para subdominios `track.*`**: Cloudflare lo da auto-SSL si usas su DNS; en otros casos hay que instalar cert.
- **Plugin WP nuevas versiones**: cada merchant tiene que actualizar. Considerar auto-update desde la admin page del plugin.
- **Breaking changes**: renombrar `adray-pixel.js` rompe merchants que tengan el script embebido manual. Dejar alias con redirect 301 por 90 días.

---

### Next step

Confirmar prioridad: ¿arrancamos con **Fase B (server-side via plugin WP)** para tener revenue tracking bulletproof ya, o prefieres **Fase A (proxy)** para atacar el problema del tráfico Brave que acabamos de ver en shogun.mx? Mi recomendación: B primero. A en paralelo si hay bandwidth.
