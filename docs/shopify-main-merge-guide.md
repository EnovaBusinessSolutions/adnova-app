# Guía de merge a main (Shopify session fix)

Esta guía deja en main únicamente los cambios de Shopify/session token y evita incluir los workarounds temporales de captcha.

## Commits que SÍ deben entrar

- 95b7b1f (CORS robusto para entornos de app)
- 184143f (fix de App Bridge en el conector)
- 207e9e7 (ajustes de flujo/config Shopify)
- ef84603 (base del fix de session token)
- 420a5cf (unificación de config prod en shopify.app.toml)

## Commits que NO deben entrar

- 4814813 (bypass captcha backend)
- 2d4d06f (workaround captcha frontend)
- 560c34b (eliminar captcha en register)
- 07e2d6e (bypass captcha automático)

## Bloque de comandos (merge seguro por cherry-pick)

Ejecutar desde la raíz del repo:

```bash
git checkout main
git pull origin main
git checkout -b release/shopify-session-fix

# 1) Commits limpios de Shopify
git cherry-pick 95b7b1f 184143f 207e9e7

# 2) Tomar ef84603 sin arrastrar dashboard-src (submódulo)
git cherry-pick -n ef84603
git restore --staged dashboard-src
git checkout -- dashboard-src
git commit -m "feat(shopify): session token auth and embedded connector fixes"

# 3) Cleanup final de config prod/staging
git cherry-pick 420a5cf

# 4) Publicar rama para PR
git push -u origin release/shopify-session-fix
```

## Qué hace cada parte

- git checkout main / git pull origin main
  - Sincroniza base limpia desde main.

- git checkout -b release/shopify-session-fix
  - Crea rama de release aislada para PR.

- git cherry-pick 95b7b1f 184143f 207e9e7
  - Aplica fixes de CORS + App Bridge + flujo/config de Shopify.

- git cherry-pick -n ef84603
  - Trae cambios de ef84603 sin commit inmediato para poder limpiar.

- git restore --staged dashboard-src + git checkout -- dashboard-src
  - Evita mover el puntero del submódulo dashboard-src.

- git commit -m "..."
  - Crea commit limpio solo con cambios útiles de ef84603.

- git cherry-pick 420a5cf
  - Deja solo dos TOML: shopify.app.toml (prod) y shopify.app.staging.toml.

- git push -u origin release/shopify-session-fix
  - Publica rama para abrir PR a main.

## Post-validación (obligatoria antes de merge final)

1) Validación de app config Shopify (prod)
- npm run shopify:deploy:prod

2) Smoke test contra prod
- En PowerShell:
  - $env:SMOKE_BASE_URL='https://adray.ai'
  - npm run test:shopify-session
- Debe terminar en: All Shopify session smoke tests passed.

3) Validación embebida en Shopify Admin
- Abrir app desde admin.shopify.com/store/<tienda>/apps/<handle>.
- Verificar en consola del iframe:
  - typeof window.shopify === 'object'
  - typeof window.shopify.idToken === 'function'

4) Validación de request protegida con Bearer
- Ejecutar en consola del iframe:

```js
(async () => {
  const token = await window.shopify.idToken();
  const res = await fetch('/api/secure/ping', {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  console.log('status', res.status);
})();
```

- Confirmar en Network que la request incluye Authorization: Bearer.

5) Prueba negativa de reauth
- Ejecutar:

```js
fetch('/api/secure/ping', {
  headers: { Authorization: 'Bearer invalid-token' },
  credentials: 'include',
}).then(async r => ({
  status: r.status,
  retry: r.headers.get('X-Shopify-Retry-Invalid-Session-Request'),
  reauth: r.headers.get('X-Shopify-API-Request-Failure-Reauthorize')
})).then(console.log);
```

- Esperado: status 401, retry=1 y reauth=1.

6) Comprobaciones de seguridad solicitadas por Shopify
- No existe sessionToken en URL.
- No existe sessionToken en LocalStorage/SessionStorage.
- Reintentar request válida después de 70-90 segundos y confirmar que sigue funcionando.

## Criterio de GO para PR/merge a main

- Smoke test prod en verde.
- Validación embebida en verde (Bearer presente en request protegida).
- Reauth headers correctos en prueba negativa.
- Sin rastros de workarounds de captcha en los commits incluidos.
