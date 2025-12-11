# ADRAY WooCommerce POC - Quickstart

1) Pre-requisitos

- Node (>=18), npm
- MongoDB local or Atlas
- ngrok (para exponer localmente)

2) Variables de entorno

- Copiar `env.example` → `.env` y ajustar `MONGO_URI`, `OPENAI_API_KEY`, etc.

3) Ejecutar backend

```bash
npm install
npm start
```

4) Exponer local a Internet (ngrok)

```bash
ngrok http 3000
```

Anota la URL pública `https://<xxx>.ngrok.io` y usa esa URL en el plugin settings como server URL.

5) Simular instalación desde plugin (curl)

```bash
curl -X POST https://<ngrok-id>.ngrok.io/api/woocommerce/install \
  -H 'Content-Type: application/json' \
  -d '{"shopDomain":"store.example.com","adminEmail":"admin@store.com","pluginVersion":"0.1.0"}'
```

Respuesta esperada: `{ "ok": true, "token": "..." }` → Guarda `token` en plugin.

6) Simular webhook

```bash
curl -X POST https://<ngrok-id>.ngrok.io/api/woocommerce/webhook \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token-from-install>' \
  -d '{"id":123,"event":"order.created","order":{}}'
```

7) Siguientes pasos (POC → MVP)

- POC: validar install + webhook push
  - Registrar webhooks desde el plugin y verificar recepción en `POST /api/woocommerce/webhook`.
  - En backend procesar eventos mínimos: guardar snapshot y encolar job para auditoría.

- MVP: robustecer seguridad y UX
  - Añadir validación HMAC opcional y limpiar logs sensibles (ya hay `sanitizeLogs`).
  - Implementar `uninstall` hook en plugin que notifique al servidor para revocar token.
  - Mostrar en el dashboard una lista de tiendas instaladas (`WooConnections`) y su estado.

8) Checklist de entrega para la rama `Nicho`

- `backend/models/WooConnections.js` (persistencia de instalaciones)
- `backend/routes/woocommerceConnector.js` (install / webhook / healthz)
- `docs/woocommerce-plugin-spec.md` (spec del plugin)
- `env.example` + `README-poc-woocommerce.md` (this file)

9) Comandos git útiles (ejecutar desde la raíz del repo)

```bash
# crear y cambiar a rama 'Nicho'
git checkout -b Nicho

# añadir cambios
git add backend/models/WooConnections.js backend/routes/woocommerceConnector.js docs/woocommerce-plugin-spec.md env.example README-poc-woocommerce.md

# commit
git commit -m "feat(woocommerce): add POC endpoints, model and docs for ADRAY plugin"

# push y crear rama remota
git push -u origin Nicho
```

10) Probar localmente con ngrok (resumen)

```bash
# arrancar server
npm install
npm start

# exponer puerto
ngrok http 3000

# instalar plugin en WP y poner la URL de ngrok como server URL
```
