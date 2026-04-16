# TASK: Eliminar submódulos y alinear con origin/main

## Contexto

El repo local registra 6 submódulos en `.gitmodules`:
- `saas-landing`
- `dashboard-src`
- `support-src`
- `plan-src`
- `bookcall-src`
- `landing-adray`

Otro dev ya eliminó los submódulos en `origin/main` y subió los cambios. El repo local sigue registrándolos. El objetivo es traer todo lo que está hoy en `origin/main` al repo local y eliminar el registro de submódulos, de forma segura.

## IMPORTANTE antes de ejecutar

- NO hagas commit en ningún momento. El usuario hará todos los commits y push de forma manual.
- NO hagas push en ningún momento, bajo ninguna circunstancia.
- NO uses `reset --hard`, `checkout --`, `clean -fd` ni ningún comando destructivo.
- Si cualquier paso falla, detente y repórtalo antes de continuar.

---

## Pasos a ejecutar en orden

### Paso 1 — Verificar estado actual

```bash
git status --short
git submodule status
git fetch origin
```

Confirma que `origin/main` existe y tiene cambios. Reporta lo que ves.

### Paso 2 — Desinicializar cada submódulo

Ejecuta en orden, uno por uno. Si alguno falla porque el directorio no existe, ignora ese error y continúa.

```bash
git submodule deinit -f saas-landing
git submodule deinit -f dashboard-src
git submodule deinit -f support-src
git submodule deinit -f plan-src
git submodule deinit -f bookcall-src
git submodule deinit -f landing-adray
```

### Paso 3 — Sacar cada submódulo del índice de git

```bash
git rm -f --cached saas-landing 2>/dev/null || true
git rm -f --cached dashboard-src 2>/dev/null || true
git rm -f --cached support-src 2>/dev/null || true
git rm -f --cached plan-src 2>/dev/null || true
git rm -f --cached bookcall-src 2>/dev/null || true
git rm -f --cached landing-adray 2>/dev/null || true
```

El `|| true` evita que falle si alguno ya no estaba registrado.

### Paso 4 — Eliminar entradas de .git/modules

```bash
rm -rf .git/modules/saas-landing
rm -rf .git/modules/dashboard-src
rm -rf .git/modules/support-src
rm -rf .git/modules/plan-src
rm -rf .git/modules/bookcall-src
rm -rf .git/modules/landing-adray
```

### Paso 5 — Eliminar el archivo .gitmodules

```bash
git rm -f .gitmodules 2>/dev/null || rm -f .gitmodules
```

### Paso 6 — Verificar que git ya no registra submódulos

```bash
git submodule status
cat .gitmodules 2>/dev/null && echo "ALERTA: .gitmodules todavía existe" || echo "OK: .gitmodules eliminado"
```

Si todavía aparecen submódulos, reporta qué submódulo persiste antes de seguir.

### Paso 7 — Merge con origin/main de forma segura

```bash
git merge origin/main --no-edit
```

Si hay conflictos, repórtalos uno por uno. NO resuelvas conflictos en archivos de `backend/` sin confirmación.

### Paso 8 — Verificar estado final

```bash
git status --short
git submodule status 2>/dev/null
```

Esperado: cero submódulos registrados. Si hay archivos en conflicto, listarlos y detenerse.

### Paso 9 — Verificación final

```bash
git status --short
git submodule status 2>/dev/null
```

No hagas commit ni push. Solo reporta el estado final.

---

## Reporte esperado al terminar

Al finalizar dime:
1. ¿Quedaron submódulos registrados? (sí/no)
2. ¿Hubo conflictos en el merge? (y cuáles archivos si los hubo)
3. Estado final de `git status`
4. Cualquier error o anomalía encontrada en el proceso

El usuario hará el commit y push de forma manual cuando confirme que todo está bien.
