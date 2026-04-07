# Staging y producción (AdRay)

Guía para desplegar el mismo código en **staging** (p. ej. `german/dev` en Render) y **producción** sin romper login OAuth ni sesiones.

## Variables de entorno (resumen)

| Variable | Staging (ejemplo) | Producción (ejemplo) |
|----------|-------------------|----------------------|
| `APP_URL` | `https://adray-app-staging-german.onrender.com` | `https://adray.ai` |
| `NODE_ENV` | `production` | `production` |
| `SESSION_SECRET` | Secreto propio de staging | Secreto propio de prod |
| `MONGO_URI` | Mongo de staging | Mongo de prod |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Mismo cliente con URIs extra **o** cliente dedicado | Cliente prod |
| `GOOGLE_LOGIN_CALLBACK_URL` | (Opcional) Solo si no usas `APP_URL` | `https://adray.ai/auth/google/login/callback` si aplica |
| `RENDER_EXTERNAL_URL` | Inyectada por Render (fallback si falta `APP_URL`) | Inyectada por Render |

**Nota:** Cloudflare Turnstile fue retirado del repo (registro, login y recuperar contraseña). Las variables `TURNSTILE_*` ya no se usan; puedes eliminarlas del entorno en Render.

El backend asigna `APP_URL` desde `RENDER_EXTERNAL_URL` cuando `APP_URL` está vacía (ver [backend/index.js](../backend/index.js) tras `dotenv`), para que el callback de Google OAuth coincida con el host del servicio en Render.

**Recomendación:** definir `APP_URL` explícitamente en cada servicio de Render para evitar ambigüedad si cambia el dominio o hay varios servicios.

## Checklist: Google Cloud (OAuth login web)

En **APIs y servicios → Credenciales → Cliente OAuth 2.0** usado para el login:

1. **Orígenes JavaScript autorizados:** incluir la URL base del entorno (sin path), p. ej. `https://adray-app-staging-german.onrender.com`.
2. **URI de redirección autorizados:** incluir exactamente  
   `{APP_URL}/auth/google/login/callback`  
   Ejemplo staging: `https://adray-app-staging-german.onrender.com/auth/google/login/callback`.

Puedes añadir varias URIs al mismo cliente OAuth. Para **aislar** entornos, crea un cliente OAuth solo para staging y configura en Render las credenciales de ese cliente.

## Checklist: Render

- Servicio Web con **URL pública** coherente con `APP_URL` (dominio `*.onrender.com` o custom domain).
- `NODE_ENV=production` (cookies de sesión `secure` + `sameSite: 'none'` en producción).
- `SESSION_SECRET` y `MONGO_URI` **no** compartidos entre staging y prod si no quieres mezclar sesiones/datos.
- Tras cambiar variables, **Redeploy** el servicio.

## Checklist: Cloudflare (si el tráfico pasa por Cloudflare o hay dominio custom)

- **SSL/TLS:** modo **Full (strict)** hacia el origen (Render).
- **Reglas de redirección:** ninguna que envíe `staging` → producción o que intercepte `/auth/google/*` y rompa el flujo OAuth.
- Si el **hostname** público es custom (no `onrender.com`), las URIs de Google OAuth y `APP_URL` deben usar ese dominio.

## Camino hacia producción

1. Validar en **staging** (login Google, sesión, flujos críticos).
2. Abrir PR a `main` desde la rama validada.
3. En el servicio de **producción** en Render, revisar solo variables (URLs y secretos); el código es el mismo.
4. Opcional: usar **Environment Groups** en Render para agrupar variables por entorno y reducir errores de copiar/pegar.

## Referencias en código

- `APP_URL` y callback de login: [backend/auth.js](../backend/auth.js)
- Rutas `/auth/google/login` y callback: [backend/index.js](../backend/index.js)
- CORS incluye origen de staging de ejemplo: [backend/index.js](../backend/index.js) (`ALLOWED_ORIGINS`)
