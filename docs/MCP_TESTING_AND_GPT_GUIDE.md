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
  redirectUris: ["https://chat.openai.com/aip/*"],  // ChatGPT usa URLs dinámicas
  scopes: ["read:ads_performance", "read:shopify_orders"],
  active: true
});
```

Para **ChatGPT Custom GPT**, el `redirect_uri` debe coincidir con lo que ChatGPT envía. ChatGPT suele usar `https://chat.openai.com/aip/{app_id}/oauth/callback`. Opciones:

- Dejar `redirectUris` **vacío** (`[]`) para aceptar cualquier `redirect_uri` (menos seguro, útil para pruebas).
- O configurar el valor exacto que ChatGPT muestre en su panel de OAuth.

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

---

## 7. Checklist pre-producción

- [ ] Cliente OAuth creado con `client_id` y `client_secret` seguros
- [ ] `APP_URL` correcto (ej. `https://api.adray.ai`)
- [ ] CORS / reverse proxy configurado para `/mcp`, `/oauth`, `/gpt/v1`
- [ ] MongoDB accesible para `oauth_clients`, `oauth_codes`, `oauth_tokens`
- [ ] Usuarios de prueba con Meta, Google y Shopify conectados
- [ ] Tests unitarios pasando (`npm run test:mcp`)
