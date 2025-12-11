# ADRAY WooCommerce Plugin - Spec (POC)

Resumen

- Plugin name: ADRAY
- Distribution: zip (initial)
- Auth model: servidor genera token durante `install` request
- Permissions: lectura (read-only)

Endpoints (backend)

- POST /api/woocommerce/install
  - Body: { shopDomain, adminEmail, pluginVersion }
  - Response: { ok: true, token }
  - Server stores `shop` + `accessToken` in `WooConnections`.

- POST /api/woocommerce/webhook
  - Requires header `Authorization: Bearer <token>`
  - Receives events registered by plugin (orders, products, customers)

- GET /api/woocommerce/healthz
  - Simple probe for connectivity

Plugin behavior (install flow)

1. Admin installs plugin and opens ADRAY settings.
2. Admin enters ADRAY server URL (staging/prod) or uses pre-filled.
3. Admin clicks "Conectar".
4. Plugin sends `POST /api/woocommerce/install` with `{ shopDomain, adminEmail, pluginVersion }`.
5. Server returns `{ token }`. Plugin stores token in WP options (option_name) and uses it for webhook registration.
6. Plugin registers webhooks (orders.created, order.updated, product.updated, customer.created) pointing to `{server}/api/woocommerce/webhook` and includes `Authorization: Bearer <token>` in those calls (or uses the plugin to post events directly).

Webhook payloads

- Use WooCommerce default webhook payloads (JSON). The server should accept full objects for orders, products and customers.

Security

- All communication must use HTTPS in production.
- Plugin stores token in WP options with capability check (only administrators can access settings).
- Server validates `Authorization` header by matching token to a record in `WooConnections`.
- Optionally add HMAC signature in a custom header for extra verification.

Data to collect (initial)

- Products: id, name, slug, sku, price, regular_price, sale_price, description, short_description, categories, images
- Orders: id, status, total, line_items, customer, created_at
- Customers: id, email, name, total_spent

Uninstall

- On uninstall hook, plugin should POST `DELETE /api/woocommerce/install` (TBD) or call an uninstall endpoint to revoke token and unregister webhooks.

Local testing (dev)

- Use `ngrok` to expose local server: `ngrok http 3000` and paste URL in plugin settings.
- Use curl to simulate install and webhooks (examples in README).
