Cotización: Layer 1 Foundation (Shopify + Meta
+ Google)
Custom Pixel sin cambios de scopes + revenue truth + stitching base + conexiones Ads listas.
Enfoque: vender pilotos en 30 días.
Cliente Adray (Director / Operación)
Proveedor Web Mentor
Fecha 26/02/2026
Duración 4 semanas (30 días calendario)
Inversión $40,000 MXN + IVA
Objetivo
Entregar la primera capa completa (Layer 1) para capturar eventos de navegación y atribución vía Custom
Pixel (sin scopes nuevos en Shopify), leer órdenes como verdad de revenue (read-only), unir
sesión/checkout/orden, y dejar Meta y Google conectados y verificados para leer gasto/clicks y habilitar la
fase 2 (deduplicación avanzada + modelos + MCP server).
Alcance
Custom Pixel (Customer Events) - sin cambios de scopes
• Snippet listo para copiar/pegar en Shopify Admin (Customer events -> Custom pixel).
• Llaves de unión: event_id, user_key, session_id, timestamp, shop_id.
• Atribución: utm_* + click IDs (fbclid, gclid, wbraid, gbraid, ttclid cuando existan).
• Eventos V1-lite: page_view, view_item, add_to_cart, begin_checkout (si aplica), purchase marker.
• Envío al collector first-party (api) para posterior fan-out a plataformas (fase 2).
Revenue truth (Shopify read-only)
• Sync incremental de órdenes con idempotencia (evita duplicados) y reintentos.
• Estandarización mínima: valor, moneda, impuestos, envío, descuentos e items.
• Health del sync: última ejecución, órdenes nuevas y errores recientes.
Stitching base (sesión -> checkout -> orden)
• Guardar first touch y last touch (por usuario/sesión) para backfill.
• Mapeo básico checkout_token -> order_id cuando aplique.
Pixel Health + Onboarding
• Pixel Health Monitor (eventos recibidos, errores y versión).
• Match rate (órdenes con sesión/checkout) + checklist de onboarding.
Conexiones Ads (Meta + Google) - verificación y lectura básica
• Validación de que el OAuth/login existente funciona end-to-end (tokens, refresh, expiración).
• Verificación de permisos necesarios para leer: cuentas, campañas y gasto/clicks.
• Pull básico de datos: spend + clicks por día/campaña (y conversiones reportadas si están disponibles).
• Ads Health: estado de conexión (conectado / expirado / permisos faltantes).
Web Mentor - Propuesta Comercial Layer 1 Foundation (Shopify + Ads)
Documento confidencial. Uso exclusivo del cliente. Pagina 2
Entregables
• Custom Pixel V1 (snippet) + guía de instalación y verificación.
• Collector receptor listo (endpoints + logs) para recibir eventos del pixel.
• Sync read-only de órdenes + health básico (revenue truth).
• Stitching base (first/last touch + checkout->order cuando aplique).
• Panel mínimo: Pixel Health + Match rate + Ads Health (Meta/Google).
• Pull básico de Ads: spend + clicks por campaña/día (y conversiones reportadas si están disponibles).
Cronograma (4 semanas)
Semana 1 Schema v0 + Custom Pixel V1 + collector base + baseline health.
Semana 2 Revenue sync (órdenes) + stitching base + Pixel Health UI.
Semana 3 Validación conexiones Meta/Google + Ads Health + pull básico (spend/clicks).
Semana 4 Hardening + onboarding tienda(s) piloto + output mínimo para demo (Shopify truth + Ads spend/clicks).
Supuestos (para evitar retrabajo)
• La app se mantiene con scopes read-only en Shopify (sin re-autorización ni re-verificación por
permisos).
• El merchant instala el Custom Pixel manualmente siguiendo el checklist.
• Se habilita 1 tienda piloto para pruebas end-to-end.
• El cliente provee acceso a 1 cuenta piloto de Meta y 1 cuenta piloto de Google (con permisos para
lectura de campañas y gasto).
Fuera de alcance (por diseño)
• Fase 2: deduplicación avanzada, reconciliación multi-touch, scoring robusto y backfill completo.
• Fase 2: MCP server y exposición completa del esquema a otras IAs.
• Fase 2: envío server-side a plataformas (Meta CAPI / Google Enhanced Conversions / TikTok Events
API).
• Cambios de scopes o auto-instalación del pixel vía app (Web Pixel Extension)