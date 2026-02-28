# CONTEXTO DEL PROYECTO (Shopify Connector Fixes)

## Estado Actual (27 de Febrero, 2026)

Este documento resume los cambios críticos realizados para lograr la aprobación de la App en el Shopify Review y solucionar errores de conexión en el conector embebido.

### Problemas Solucionados

1.  **Conflicto de App Bridge (v3 vs v4):**
    *   **Síntoma:** Errores `postMessage` origin mismatch en la consola y `ERR_BLOCKED_BY_CLIENT`.
    *   **Causa:** Se estaban cargando simultáneamente la librería NPM `@shopify/app-bridge` (v3) y el script CDN `app-bridge.js` (v4).
    *   **Solución:** Se eliminó por completo la dependencia de NPM de los archivos del frontend (`interface.js`, `interface.connector.js`). Ahora se usa exclusivamente `window.shopify` inyectado por el CDN.

2.  **Verificación de Session Tokens:**
    *   **Síntoma:** Error 401 o `invalid session token` en el backend.
    *   **Causa:** El método `Shopify.Utils.decodeSessionToken()` está obsoleto en nuevas versiones de la API y no verificaba la firma criptográfica correctamente, lo cual es un requisito de seguridad (Security Requirement) para la aprobación de la app.
    *   **Solución:** Se implementó una verificación manual estricta usando `jsonwebtoken` y `process.env.SHOPIFY_API_SECRET` (HS256) en `middlewares/verifySessionToken.js`.

3.  **Content Security Policy (CSP):**
    *   **Síntoma:** Advertencias de "The Content Security Policy 'frame-ancestors' was ignored" en la consola.
    *   **Causa:** Etiqueta `<meta>` redundante en `interface.html` mientras el servidor ya enviaba headers via Helmet.
    *   **Solución:** Se eliminó la etiqueta `<meta>` de `public/connector/interface.html`.

### Archivos Clave Modificados

*   `public/connector/interface.html`: Limpieza de meta tags y scripts.
*   `public/connector/interface.connector.js`: Lógica principal del iframe. Ahora usa `shopify.config()` y `shopify.idToken()`.
*   `frontend/interface.js`: Punto de entrada frontend (React), adaptado para usar `window.shopify`.
*   `middlewares/verifySessionToken.js`: Reescrito para usar `jwt.verify()`.
*   `shopify.app.toml`: Configurado temporalmente para STAGING.

### Configuración de Staging

Para probar en `adray-app-staging-german.onrender.com`:

1.  El archivo `shopify.app.toml` tiene las URLs apuntando a este dominio.
2.  **IMPORTANTE (Opción Manual):** Debes actualizar la configuración de la App en el **Shopify Partner Dashboard > App Setup**:
    *   **App URL:** `https://adray-app-staging-german.onrender.com/connector`
    *   **Allowed redirection URL(s):** `https://adray-app-staging-german.onrender.com/connector/auth/callback`
3.  **IMPORTANTE (Opción CLI - Recomendada):** Puedes subir la configuración del TOML directamente usando Shopify CLI:
    ```bash
    # Ejecutar en la raíz del proyecto
    npm run shopify app config push
    # O si usas npx directo:
    npx shopify app config push
    ```
    Esto actualizará las URLs en el Partner Dashboard automáticamente para apuntar a Staging.
4.  Asegúrate de que las variables de entorno en Render (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `APP_URL`) coincidan con la app de staging.

### Reversión a Producción (Antes de Merge a Main)

**MUY IMPORTANTE:** Antes de hacer merge de `german/dev` a `main` (producción), debes:

1.  Revertir las URLs en `shopify.app.toml` a `https://adray.ai`.
2.  Ejecutar nuevamente `shopify app config push` (o hacerlo manual) para apuntar la App de Shopify a Producción.
3.  Si no lo haces, la App en producción intentará redirigir a Staging.

### Solución de Errores Recientes (Staging)

4.  **Error `shopify.config is not a function`:**
    *   **Causa:** En algunos contextos del CDN de App Bridge v4, el objeto `shopify` se autoconfigura y el método `.config()` no está expuesto o es un Proxy, causando un crash.
    *   **Solución:** Se hizo opcional la llamada a `.config()` en `interface.connector.js`.

5.  **Caché Agresivo en Staging:**
    *   **Causa:** El navegador retenía la versión antigua del JS (`maxAge: 1h`) impidiendo ver los fixes.
    *   **Solución:** Se deshabilitó el caché (`Cache-Control: no-store`) para la ruta `/connector` en `backend/index.js` garantizando que Shopify siempre cargue la última versión.

---

## 🧪 Plan de Pruebas Pre-Submission (Checklist)

Para asegurar que Shopify aprobará la app, realiza estas pruebas manuales en tu entorno de Staging (`adray-app-staging-german.onrender.com`):

### 1. Verificación de Seguridad (JWT) - **CRÍTICO**
Shopify rechazará la app si no valida el token en el backend.

*   [ ] Abre la App en Shopify Admin.
*   [ ] Abre **DevTools** (F12) -> **Network**.
*   [ ] Filtra por `ping`.
*   [ ] Deberías ver una petición a `/api/secure/ping`.
*   [ ] **Verifica:**
    *   Status: `200 OK`.
    *   Header Request: `Authorization: Bearer eyJhbGci...` (El token JWT).
    *   Si ves error 401, la validación de firma (`verifySessionToken.js`) estaría fallando.

### 2. Comportamiento de App Bridge
*   [ ] **Carga:** La interfaz debe cargar sin parpadeos excesivos ni errores rojos en consola.
*   [ ] **Consola:** No debe haber errores de `Samesite cookie`, `frame-ancestors` o `postMessage origin mismatch`.
*   [ ] **Redirección:** Haz clic en "Ir a ADRAY AI".
    *   Debe abrirse en una **nueva pestaña** o romper el iframe correctamente (salir del admin de Shopify).
    *   Si se queda dentro del iframe cargando la app completa, será rechazado.

### 3. Instalación desde Cero (OAuth)
*   [ ] Desinstala la App de tu tienda de desarrollo.
*   [ ] Vuelve a instalarla desde el link de "Test App" en Partners.
*   [ ] El flujo debe llevarte a la pantalla de "Aceptar permisos".
*   [ ] Al finalizar, debe redirigirte correctamente al `interface.html` embebido.

### 4. Móvil (Shopify Mobile App)
*   [ ] Si es posible, abre la app de Shopify en tu celular -> Tienda -> Apps -> Adray Connector.
*   [ ] Debe verse correctamente (App Bridge v4 maneja esto nativamente).

---

### 🚀 Pasos para Pase a Producción (Main)

Una vez validadas las pruebas anteriores:

1.  **Merge:** `git checkout main` -> `git merge german/dev`.
2.  **Config:** Revertir `shopify.app.toml` a las URLs de producción (`https://adray.ai`).
3.  **Deploy Config:** `npm run shopify app config push` (para apuntar la App ID de producción a `adray.ai`).
4.  **Deploy Render:** Push a `main` para que Render actualice producción.

