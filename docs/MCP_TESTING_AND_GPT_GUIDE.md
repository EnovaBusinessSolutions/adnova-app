# Guía: Probar las Tools MCP y conectar con GPT

Esta guía cubre cómo probar las 8 tools del servidor MCP Phase 1 y cómo integrar con ChatGPT Custom GPT.

---

## Prerrequisitos

1. **Servidor corriendo** con MongoDB, variables de entorno (`MONGO_URI`, `APP_URL`, etc.).
2. **Usuario logueado** en Adray con Meta/Google/Shopify conectados.
3. **Cliente OAuth** registrado en la base de datos.

---

## 1. Crear un cliente OAuth

Necesitas al menos un registro en la colección `oauth_clients`. Ejecuta en MongoDB o usa un script:

```javascript
// Ejemplo: insertar vía Mongo shell o Compass
db.oauth_clients.insertOne({
  clientId: "adray-gpt-client",
  clientSecret: "tu_secret_seguro_min_32_chars",
  name: "Adray GPT / MCP Client",
  redirectUris: [],
  redirectUriPatterns: ["https://chat.openai.com/aip/*/oauth/callback"], // recomendado para ChatGPT
  scopes: ["read:ads_performance", "read:shopify_orders"],
  active: true
});
```

Para **ChatGPT Custom GPT**, el `redirect_uri` debe coincidir con lo que ChatGPT envía. ChatGPT suele usar `https://chat.openai.com/aip/{app_id}/oauth/callback`. Opciones:

- Configurar `redirectUriPatterns` con `https://chat.openai.com/aip/*/oauth/callback` (recomendado).
- Configurar `redirectUris` con valores exactos (máxima seguridad, más frágil).
- Dejar `redirectUris` vacío sigue siendo compatible, pero no es recomendable sin patrones.

---

## 2. Obtener un Access Token (OAuth 2.0)

### Flujo authorization code

1. **Loguearte en Adray** en el navegador (session + passport).

2. **Autorizar** (en la misma sesión del navegador):
   ```
   GET https://api.adray.ai/oauth/authorize?
     client_id=adray-gpt-client&
     redirect_uri=https://tu-sitio.com/callback&
     response_type=code&
     scope=read:ads_performance%20read:shopify_orders&
     state=random123
   ```
   Sustituye `api.adray.ai` por tu dominio (o `localhost:3000` en local) y `redirect_uri` por una URL donde puedas capturar el `code`.

3. **Callback**: Serás redirigido a `redirect_uri?code=...&state=...`. Guarda el `code`.

4. **Intercambiar code por token**:
   ```bash
   curl -X POST https://api.adray.ai/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code" \
     -d "code=EL_CODIGO_OBTENIDO" \
     -d "redirect_uri=https://tu-sitio.com/callback" \
     -d "client_id=adray-gpt-client" \
     -d "client_secret=tu_secret_seguro"
   ```

5. Respuesta esperada:
   ```json
   {
     "access_token": "...",
     "token_type": "Bearer",
     "expires_in": 3600,
     "refresh_token": "...",
     "scope": "read:ads_performance read:shopify_orders"
   }
   ```

Notas importantes:

- El `code` de autorización es de un solo uso y de corta vida (aprox. 10 minutos).
- `redirect_uri` en `/oauth/token` debe ser exactamente la misma del `authorize` (mismo callback final, no la URL completa de `/oauth/authorize`).
- El `refresh_token` tiene vida larga (actualmente 180 días) y es el que evita pedir login constantemente.

6. **Refrescar** cuando caduque:
   ```bash
   curl -X POST https://api.adray.ai/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=refresh_token" \
     -d "refresh_token=TU_REFRESH_TOKEN" \
     -d "client_id=adray-gpt-client" \
     -d "client_secret=tu_secret_seguro"
   ```

---

## 3. Probar las 8 tools vía REST (cURL)

Base URL de la API: `https://api.adray.ai/gpt/v1` (en producción) o `http://localhost:3000/gpt/v1` (local).

Sustituye `TU_ACCESS_TOKEN` por el token obtenido arriba.

Los endpoints de ads (**`/ad-performance`**, **`/campaign-performance`**, **`/channel-summary`**, **`/date-comparison`**) comparten la misma lógica **snapshot-first** que las tools MCP cuando `MCP_SNAPSHOT_FIRST_ENABLED=true`: leen primero agregados en Mongo **`mcpdata`** (chunks `google.daily_trends_ai` / `meta.daily_trends_ai`, etc.) y solo entonces intentan la API en vivo si el snapshot no aplica. Detalle operativo en §8.7.

### 3.1 get_account_info

```bash
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/account-info"
```

### 3.2 get_ad_performance

```bash
# Meta
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/ad-performance?channel=meta&date_from=2026-01-01&date_to=2026-01-31&granularity=total"

# Google
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/ad-performance?channel=google&date_from=2026-01-01&date_to=2026-01-31&granularity=total"

# Ambos canales
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/ad-performance?channel=all&date_from=2026-01-01&date_to=2026-01-31"
```

### 3.3 get_campaign_performance

```bash
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/campaign-performance?channel=meta&date_from=2026-01-01&date_to=2026-01-31&limit=10&status=all"
```

### 3.4 get_adset_performance

```bash
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/adset-performance?channel=meta&campaign_id=CAMPAIGN_ID&date_from=2026-01-01&date_to=2026-01-31"
```

### 3.5 get_shopify_revenue

```bash
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/shopify-revenue?date_from=2026-01-01&date_to=2026-01-31&granularity=total"
```

### 3.6 get_shopify_products

```bash
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/shopify-products?date_from=2026-01-01&date_to=2026-01-31&sort_by=revenue&limit=10"
```

### 3.7 get_channel_summary

```bash
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/channel-summary?date_from=2026-01-01&date_to=2026-01-31"
```

### 3.8 get_date_comparison

```bash
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  "https://api.adray.ai/gpt/v1/date-comparison?channel=meta&period_a_from=2026-01-01&period_a_to=2026-01-15&period_b_from=2026-01-16&period_b_to=2026-01-31"
```

### Parámetros comunes

| Parámetro | Formato | Ejemplo |
|-----------|---------|---------|
| `date_from` / `date_to` | `YYYY-MM-DD` | `2026-01-01` |
| `channel` | `meta`, `google`, `all`, `shopify` | según tool |
| `granularity` | `day`, `week`, `month`, `total` | `total` |
| `limit` | 1–50 | `10` |
| `status` | `active`, `paused`, `all` | `all` |

Rango máximo: **365 días**.

---

## 4. Tests unitarios

```bash
npm test
# o específico MCP
npm run test:mcp
```

Los tests usan mocks de los adapters, no llaman APIs reales.

---

## 5. Interacción con ChatGPT Custom GPT

ChatGPT Custom GPT usa **Actions** basadas en **OpenAPI 3.0**. Según el plan Phase 1, la especificación OpenAPI completa se prepara en Plan 2. Mientras tanto, puedes:

### Opción A: Crear una spec OpenAPI mínima para Actions

Crea `openapi.json` con los 8 endpoints REST. ChatGPT requiere:

- `openapi: 3.0.0`
- `servers` con tu base URL
- `paths` para cada endpoint
- `security` tipo OAuth2

Ejemplo mínimo para un endpoint:

```json
{
  "openapi": "3.0.0",
  "info": { "title": "Adray MCP API", "version": "1.0.0" },
  "servers": [{ "url": "https://api.adray.ai/gpt/v1" }],
  "security": [{ "oauth2": [] }],
  "components": {
    "securitySchemes": {
      "oauth2": {
        "type": "oauth2",
        "flows": {
          "authorizationCode": {
            "authorizationUrl": "https://api.adray.ai/oauth/authorize",
            "tokenUrl": "https://api.adray.ai/oauth/token",
            "scopes": {
              "read:ads_performance": "Ver métricas de ads",
              "read:shopify_orders": "Ver órdenes de Shopify"
            }
          }
        }
      }
    }
  },
  "paths": {
    "/account-info": {
      "get": {
        "operationId": "get_account_info",
        "summary": "Obtener cuentas conectadas",
        "responses": { "200": { "description": "OK" } }
      }
    },
    "/ad-performance": {
      "get": {
        "operationId": "get_ad_performance",
        "parameters": [
          { "name": "channel", "in": "query", "required": true, "schema": { "type": "string", "enum": ["meta", "google", "all"] } },
          { "name": "date_from", "in": "query", "required": true, "schema": { "type": "string" } },
          { "name": "date_to", "in": "query", "required": true, "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "OK" } }
      }
    }
  }
}
```

Luego:

1. En ChatGPT: **Configure** → **Actions** → **Create new action**
2. Pegar o importar la OpenAPI spec (URL o JSON)
3. Configurar OAuth con:
   - Client ID: `adray-gpt-client`
   - Client Secret: tu `client_secret`
   - Authorization URL: `https://api.adray.ai/oauth/authorize`
   - Token URL: `https://api.adray.ai/oauth/token`
   - Scope: `read:ads_performance read:shopify_orders`

### Opción B: MCP en cliente (Claude, etc.)

Para clientes compatibles con MCP (por ejemplo Claude Desktop):

- **URL del servidor**: `https://api.adray.ai/mcp` (o `https://mcp.adray.ai/mcp` si usas subdominio).
- El cliente MCP debe enviar el Bearer token en el transporte. Consulta la documentación de tu cliente MCP para configurar autenticación.

---

## 6. Errores típicos

| Código | Causa |
|--------|-------|
| `UNAUTHORIZED` | Token ausente, expirado o inválido |
| `ACCOUNT_NOT_CONNECTED` | No hay Meta/Google/Shopify conectado para ese usuario |
| `DATE_RANGE_TOO_LARGE` | Rango > 365 días |
| `INVALID_PARAMETERS` | Faltan parámetros requeridos o formato incorrecto |
| `invalid_client` | `client_id` no existe o está inactivo en `oauth_clients` |
| `invalid_redirect_uri` | `redirect_uri` malformado o fuera de allowlist/patrones |
| `invalid_grant` (`redirect_uri mismatch`) | El `redirect_uri` enviado al token no coincide con el guardado al emitir el `code` |

---

## 7. Checklist pre-producción

- [ ] Cliente OAuth creado con `client_id` y `client_secret` seguros
- [ ] `APP_URL` correcto (ej. `https://api.adray.ai`)
- [ ] CORS / reverse proxy configurado para `/mcp`, `/oauth`, `/gpt/v1`
- [ ] MongoDB accesible para `oauth_clients`, `oauth_codes`, `oauth_tokens`
- [ ] Usuarios de prueba con Meta, Google y Shopify conectados
- [ ] Tests unitarios pasando (`npm run test:mcp`)

---

## 8. Staging (Render / `german/dev`): checklist y smoke automatizado

Usa la misma **BASE** pública del backend que `APP_URL` en Render (ej. `https://adray-app-staging-german.onrender.com`). Sustituye `api.adray.ai` en los ejemplos de las secciones 2–3 por esa BASE.

### 8.1 Entorno (Fase 0)

- En Render: `APP_URL` y `MONGO_URI` del servicio staging coherentes con la URL real y la base de datos de staging.
- **Recomendado (Google Ads / mcpdata):** en el dashboard de Render, añade la variable de entorno `MCP_SNAPSHOT_FIRST_ENABLED=true` en el servicio del backend staging. Así MCP y `/gpt/v1/*` leen primero agregados en Mongo `mcpdata` y evitan depender solo de la API de Google (útil si el developer token da 403 en staging). Sin chunks en `mcpdata`, las tools devuelven métricas en cero en lugar de `INTERNAL_ERROR` cuando la API falla (salvo `ACCOUNT_NOT_CONNECTED`, que sigue como 404).
- Rutas expuestas en el mismo servicio: `/mcp`, `/oauth/*`, `/gpt/v1/*` (sin reglas de proxy que las bloqueen).
- **CORS:** en `backend/index.js` la política actual acepta cualquier origen (`origin: (origin, cb) => cb(null, true)`), así que no suele bloquear navegador u orígenes dinámicos para OAuth MCP.

### 8.2 Cliente OAuth en Mongo de staging (Fase 1)

Desde tu máquina, apuntando al **Mongo de staging**:

```bash
export MONGO_URI="mongodb+srv://...staging..."
export MCP_OAUTH_CLIENT_SECRET="minimo_16_caracteres_seguros"
# opcional: MCP_OAUTH_CLIENT_ID, MCP_OAUTH_REDIRECT_URIS
npm run seed:oauth-client
```

O inserta manualmente en `oauth_clients` como en la §1.

### 8.3 Usuario de prueba (Fase 2)

1. Inicia sesión en la **app web** de staging (cookie de sesión).
2. Conecta Meta y/o Google y/o Shopify según lo que quieras validar.

### 8.4 Token OAuth MCP (Fase 3)

Con sesión abierta en el navegador, abre la URL de autorización de la §2 usando **BASE** de staging; intercambia el `code` en `POST BASE/oauth/token`. Guarda el `access_token`.

### 8.5 Matriz REST + POST `/mcp` (Fases 4–5)

Script (8 GET `/gpt/v1/*` + `initialize` vía `POST /mcp`):

```bash
export MCP_STAGING_BASE_URL="https://TU-STAGING.onrender.com"
export MCP_ACCESS_TOKEN="..."
# opcional: export MCP_META_CAMPAIGN_ID="..."  # para adset-performance
# opcional: export MCP_SKIP_MCP_POST=1         # solo REST, sin probar /mcp
npm run mcp:smoke:staging
```

- **PASS:** respuesta 2xx.
- **SKIP:** 404 con `ACCOUNT_NOT_CONNECTED` (falta integración; esperado si no conectaste ese canal).
- **FAIL:** 401 u otros errores: revisar token, parámetros o datos.

El proceso termina con código de salida **1** si hay algún **FAIL** o si **POST /mcp** `initialize` no responde OK. Los **SKIP** (p. ej. `ACCOUNT_NOT_CONNECTED` sin integración) **no** cuentan como fallo. Si no defines `MCP_META_CAMPAIGN_ID`, `adset-performance` se omite (verdict SKIP) y no bloquea el exit code.

### 8.6 Tests unitarios (Fase 6)

En el repo: `npm run test:mcp` (mocks, sin APIs externas).

### 8.7 Snapshot-first (Fase 7, opcional)

Si en staging activas `MCP_SNAPSHOT_FIRST_ENABLED=true`, además:

- En Render (o `.env` local), define `MCP_SNAPSHOT_FIRST_ENABLED=true`. Opcional: `MCP_SNAPSHOT_FIRST_TOOLS` (lista separada por comas); vacío = todas las tools contempladas.
- **Datos Google/Meta en Mongo:** los KPIs diarios llegan a `mcpdata` vía el collector (`googleCollector` / `metaCollector`) y rutas como `POST /api/mcpdata/collect-now` o el worker `npm run worker:mcp`. Sin chunks recientes, el servidor puede hacer **fallback** a la API en vivo (mismo riesgo de error que antes).
- Comprueba estado de chunks (con sesión de usuario en la app web): `GET /api/mcpdata/google-ads/status` y `GET /api/mcpdata/meta/status` en la misma BASE del backend.
- Prueba **REST** (`/gpt/v1/ad-performance?channel=google&...`) y **MCP**: ambos usan [`backend/mcp/services/adsPerformanceResolve.js`](../backend/mcp/services/adsPerformanceResolve.js) para esos endpoints.
- Revisa logs con `mcp_tool_source` / `source_mode` ([backend/mcp/README.md](../backend/mcp/README.md)).
- Si usas `MCP_SNAPSHOT_BACKGROUND_REFRESH`, confirma `REDIS_URL` y el worker (`npm run worker:mcp` en el servicio que corresponda).
