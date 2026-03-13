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
1. Usuario ya logueado en Adray (session)
2. `GET /oauth/authorize?client_id=...&redirect_uri=...&response_type=code`
3. Callback con `code` → intercambiar en `POST /oauth/token`
4. Usar `access_token` como Bearer en MCP o REST

### 5. Cliente MCP (Claude / ChatGPT)
Configurar MCP endpoint: `http://localhost:3000/mcp` (o `https://mcp.adray.ai/mcp` en producción).
Usar el `access_token` OAuth en el transporte.

## Tools Phase 1
- `get_account_info` – cuentas conectadas
- `get_ad_performance` – métricas agregadas (spend, impresiones, clicks…)
- `get_campaign_performance` – campañas con métricas
- `get_adset_performance` – adsets/ad groups por campaña
- `get_shopify_revenue` – ingresos y órdenes Shopify
- `get_shopify_products` – productos rankeados
- `get_channel_summary` – resumen Meta + Google
- `get_date_comparison` – comparación entre dos periodos
