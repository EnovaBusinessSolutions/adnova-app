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

### Errores Conocidos (Lecciones Aprendidas)

*   **NO usar** `@shopify/app-bridge` ni `@shopify/app-bridge-utils` desde NPM si ya se carga el CDN. Causan conflictos de versión.
*   **NO confiar** en `Shopify.Utils.decodeSessionToken` para autenticación crítica; siempre verificar firma.
*   **NO mezclar** CSP en HTML y Headers. Headers ganan, pero HTML causa ruido en consola.

---
*Generado por GitHub Copilot para futura referencia.*
