=== Adnova Pixel ===
Contributors: adnova
Tags: analytics, tracking, pixel, marketing
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
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

== Installation ==
1. Comprime la carpeta `adnova-pixel` en un .zip.
2. Ve a WordPress > Plugins > Add New > Upload Plugin.
3. Sube el ZIP y activa el plugin.
4. Listo: el pixel queda activo automaticamente.

== Changelog ==
= 1.0.0 =
- Primera version con auto-configuracion por dominio.
