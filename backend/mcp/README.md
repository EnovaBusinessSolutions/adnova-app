# Adray MCP Server - Phase 1

Servidor MCP que expone 8 tools read-only para Meta Ads, Google Ads y Shopify.

## Endpoints

| Ruta | Propósito |
|------|-----------|
| `POST /mcp` | Protocolo MCP (Streamable HTTP) |
| `GET /oauth/authorize` | OAuth 2.0 - autorización |
| `POST /oauth/token` | OAuth 2.0 - exchange / refresh token |
| `POST /oauth/revoke` | OAuth 2.0 - revocación |
| `GET /gpt/v1/account-info` | REST mirror |
| `GET /gpt/v1/ad-performance` | REST mirror |
| `GET /gpt/v1/campaign-performance` | REST mirror |
| `GET /gpt/v1/adset-performance` | REST mirror |
| `GET /gpt/v1/shopify-revenue` | REST mirror |
| `GET /gpt/v1/shopify-products` | REST mirror |
| `GET /gpt/v1/channel-summary` | REST mirror |
| `GET /gpt/v1/date-comparison` | REST mirror |

## Cómo probar

### 1. Tests unitarios (mocks)
```bash
npm test
```
o específicamente MCP:
```bash
npm run test:mcp
```

### 2. Levantar el servidor
```bash
npm start
```

### 3. REST mirror (requiere OAuth token)
```bash
curl -H "Authorization: Bearer <access_token>" "http://localhost:3000/gpt/v1/account-info"
```

### 4. OAuth flow

**Crear cliente OAuth (requerido antes de usar MCP/REST):**
```bash
# En .env define MCP_OAUTH_CLIENT_SECRET=tu_secret_minimo_16_chars
npm run seed:oauth-client
```

Variables opcionales: `MCP_OAUTH_CLIENT_ID` (default: adray-mcp-client), `MCP_OAUTH_REDIRECT_URIS`.

**Flujo:**
1. Usuario ya logueado en Adray (session)
2. `GET /oauth/authorize?client_id=adray-mcp-client&redirect_uri=https://httpbin.org/get&response_type=code&scope=read:ads_performance%20read:shopify_orders&state=xyz`
3. Callback con `code` → intercambiar en `POST /oauth/token` con client_id, client_secret, code, redirect_uri
4. Usar `access_token` como Bearer en MCP o REST

### 5. Cliente MCP (Claude / ChatGPT)
Configurar MCP endpoint: `http://localhost:3000/mcp` (o `https://mcp.adray.ai/mcp` en producción).
Usar el `access_token` OAuth en el transporte.

## Snapshot-first (mcpdata) — opcional

Las tools de Meta/Google pueden leer primero datos ya recolectados en `mcpdata` (datasets `*.daily_trends_ai` o `*.history.daily_account_totals`) y usar la API en vivo solo si hace falta (snapshot fresco → sin llamar a la API; snapshot obsoleto → intentar live y, si falla, devolver snapshot).

**Kill-switch:** por defecto está desactivado.

| Variable | Descripción |
|----------|-------------|
| `MCP_SNAPSHOT_FIRST_ENABLED` | `true` / `1` para activar |
| `MCP_SNAPSHOT_FIRST_TOOLS` | Lista separada por comas (ej. `get_ad_performance,get_campaign_performance`). Vacío = todas las tools contempladas |
| `MCP_SNAPSHOT_MAX_AGE_MIN` | Minutos para considerar el snapshot “fresco” (default 360) |
| `MCP_SNAPSHOT_BACKGROUND_REFRESH` | Si `true`, tras `live_fallback` encola recolección MCP (requiere `REDIS_URL`) |
| `MCP_SNAPSHOT_REFRESH_DEBOUNCE_MS` | Mínimo entre encolados por usuario+fuente (default 300000) |

Logs estructurados: líneas JSON con `mcp_tool_source: true`, `source_mode` (`snapshot_fresh` \| `snapshot_stale` vía live \| `live` \| `live_fallback` \| `error`), `latency_ms`, `snapshot_id` cuando aplica.

## Tools Phase 1
- `get_account_info` – cuentas conectadas
- `get_ad_performance` – métricas agregadas (spend, impresiones, clicks…)
- `get_campaign_performance` – campañas con métricas
- `get_adset_performance` – adsets/ad groups por campaña
- `get_shopify_revenue` – ingresos y órdenes Shopify
- `get_shopify_products` – productos rankeados
- `get_channel_summary` – resumen Meta + Google
- `get_date_comparison` – comparación entre dos periodos
