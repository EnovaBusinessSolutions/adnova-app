=== Adnova Pixel ===
Contributors: adnova
Tags: analytics, tracking, pixel, marketing
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.4
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Instala y activa para cargar automaticamente el pixel de Adnova en todo el sitio.
El plugin detecta el dominio y lo usa como Site ID/account_id.

== Description ==
Adnova Pixel agrega el script de tracking en el frontend de WordPress sin configuracion manual.

Comportamiento:
- Detecta el dominio de tu sitio con `home_url()`.
- Lo asigna como `data-account-id` y `data-site-id`.
- Inyecta `https://adray-app-staging-german.onrender.com/adray-pixel.js` en el frontend.
- En activacion envia un evento de verificacion a `/collect`.

Eventos soportados (actual):
- `page_view`
- `view_item`
- `add_to_cart`
- `begin_checkout`
- `purchase`

WooCommerce purchase (v1.0.4):
- En la pagina de thank-you envia `purchase` con `order_id`, `revenue`, `currency` e `items`.
- Tiene fallback server-side via `woocommerce_thankyou`.
- Tiene fallback extra via `wp_footer` para themes/checkouts custom que no ejecutan el hook normal.
- Tiene fallback browser-side por scraping del DOM cuando no existe `window.adnova_order_data`.
- Incluye metadatos de atribucion de WooCommerce (`_wc_order_attribution_*`) en el evento purchase server-side/browser-side.
- Captura server-side en `payment_complete`, `processing` y `completed` para no perder pedidos cuando no se renderiza thank-you.
- Sincroniza pedidos Woo directamente al backend (`orders`) en tiempo real.
- Hace backfill reciente de pedidos Woo al activar/actualizar el plugin.

Dashboard (api/analytics) muestra:
- Revenue total (con fallback a eventos de `purchase` si no hay ordenes sincronizadas).
- Top products.
- Pixel health (events received, purchase signals, matched orders, coverage).
- Detalle de compras recientes (fecha, pedido, ingreso, productos, fuente).

Estado de atribucion (importante):
- El plugin ya envia UTMs y click IDs desde el pixel (`utm_*`, `fbclid`, `gclid`, etc.).
- Si aun no ves buena atribucion por canal/campana, normalmente falta el stitching completo en backend
	(union sesion -> checkout -> orden y reglas de first/last touch), no el disparo del evento.

== Installation ==
1. Comprime la carpeta `adnova-pixel` en un .zip.
2. Ve a WordPress > Plugins > Add New > Upload Plugin.
3. Sube el ZIP y activa el plugin.
4. Listo: el pixel queda activo automaticamente.

== Troubleshooting ==
- Purchase llega con `$0` o sin items:
	- Revisa que la pagina de gracias sea realmente `order-received`.
	- Verifica que no se redirija a una pagina custom sin datos de orden.
	- Usa la version `1.0.1` o superior del plugin.
- Atribucion incompleta:
	- Confirma que las URLs de entrada traigan `utm_source`, `utm_medium`, `utm_campaign`.
	- Confirma que el backend tenga activo el mapeo checkout/order y reglas de atribucion.

== Changelog ==
= 1.0.4 =
- Sincronizacion directa de pedidos Woo al backend para reporting real-time sin depender solo de Pixel Events.
- Backfill reciente de pedidos al activar/actualizar el plugin.

= 1.0.3 =
- Captura server-side de purchase en hooks de estado/pago para cubrir mas pedidos.
- Fallback mas robusto de fuente WooCommerce en purchase (`woo_source_label`, `woo_source_type`, `session_source`).

= 1.0.2 =
- Envio de UTM/click IDs desde metadatos de pedido WooCommerce (`_wc_order_attribution_*`) en `purchase`.
- Reduce casos de `unattributed` en dashboard cuando WooCommerce ya marca fuente (Google, Directo, etc.).

= 1.0.1 =
- Mejoras para WooCommerce purchase en checkouts custom (fallback `wp_footer`).
- Fallback browser-side para capturar total/items desde DOM en thank-you page.
- Compatibilidad con dashboard extendido (pixel health, top products, recent purchases).

= 1.0.0 =
- Primera version con auto-configuracion por dominio.
