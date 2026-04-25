# Workspaces MVP — Checklist E2E Manual

Última actualización: Fase 5C

Este checklist sirve para validar manualmente el MVP completo de workspaces antes
de mergear `german/dev` a `main`. Cada bloque tiene pasos numerados y un
resultado esperado. Marca `[x]` cuando completes cada uno.

## Setup previo

- [ ] Mongo staging vacío o con datos de prueba conocidos.
- [ ] Postgres staging migrado (no debería tener tablas de workspaces — Mongo es la fuente de verdad).
- [ ] `german/dev` deployado en Render staging y arriba.
- [ ] `RESEND_API_KEY` configurada en staging para que las invitaciones envíen emails reales.
- [ ] Tener acceso a 2 cuentas de email distintas para probar invitaciones (ej. `qa+owner@example.com` y `qa+invitee@example.com`).

---

## Flujo 1 — Owner nuevo: signup → onboarding → dashboard

1. [ ] Ir a `/signup`, crear cuenta nueva con email `qa+owner@example.com`.
2. [ ] Verificar que después del signup se redirige a `/onboarding` (no a `/dashboard/onboarding`).
3. [ ] **Step 1 — Workspace:** llenar nombre "QA Test Workspace", elegir ícono "ROCKET", vertical "Moda y ropa". Submit.
4. [ ] **Step 2 — Profile:** llenar firstName "QA", lastName "Owner", primary focus "FOUNDER_CEO". Submit.
5. [ ] **Step 3 — Team:** dejar vacío. Click "Saltar por ahora".
6. [ ] **Pantalla de éxito:** ver "Todo está configurado" con workspace name y rol Owner. Click "Continuar al dashboard".
7. [ ] Confirmar que aterrizamos en `/dashboard` (NO `/dashboard/onboarding`) y se ve la pantalla "Connect Data Sources".

**Resultado esperado:** workspace creado en Mongo, User con `defaultWorkspaceId` y `onboardingStep: COMPLETE`. Redirect funciona limpio.

---

## Flujo 2 — Switcher en sidebar

1. [ ] En `/dashboard`, hacer click en el footer del sidebar (donde está el nombre del usuario).
2. [ ] Confirmar que se abre dropdown HACIA ARRIBA con: header (nombre + email), sección "Workspaces" con el workspace activo (check al lado), botón "Crear nuevo workspace", "Settings", "Sign out".
3. [ ] Hacer click en "Crear nuevo workspace".
4. [ ] Confirmar que se abre el modal `CreateWorkspaceModal` (NO redirige a otra página).
5. [ ] Llenar el modal con un segundo workspace "QA Workspace 2", icon "DIAMOND", vertical "Belleza". Submit.
6. [ ] Confirmar toast de éxito y que el switcher ahora muestra el nuevo workspace activo.
7. [ ] Abrir el dropdown otra vez y confirmar que aparecen los 2 workspaces, el nuevo con el check.
8. [ ] Hacer click en el primer workspace (QA Test Workspace) para volver. Confirmar el cambio.

---

## Flujo 3 — Invitar miembro y aceptar

### 3A — Invitar

1. [ ] Como Owner, ir a `/dashboard/workspaces`.
2. [ ] Click en tab "Invitaciones". Click "+ Invitar miembro".
3. [ ] En el modal, llenar email `qa+invitee@example.com` y rol "MEMBER". Submit.
4. [ ] Confirmar toast de éxito.
5. [ ] Confirmar que la invitación aparece en la lista con email/rol/fecha de expiración.

### 3B — Aceptar

1. [ ] En otra ventana / modo incógnito, ir al email del invitee y abrir el email recibido (asunto: "QA Owner te invitó a QA Test Workspace en Adray").
2. [ ] Click en el botón "Aceptar invitación".
3. [ ] Si no hay sesión, hacer signup con `qa+invitee@example.com`.
4. [ ] Confirmar que después del login/signup aterrizamos en `/onboarding/invitations/<token>` y se procesa la invitación automáticamente.
5. [ ] Confirmar que vemos pantalla "¡Bienvenido al workspace!" y se redirige a `/dashboard`.

### 3C — Verificar

1. [ ] Volver a la sesión del Owner. Refrescar `/dashboard/workspaces` tab "Miembros".
2. [ ] Confirmar que el invitee aparece con rol "Member".
3. [ ] Confirmar que la invitación ya no aparece en tab "Invitaciones" (fue aceptada).

---

## Flujo 4 — Permisos por rol

### 4A — Vista del Member

1. [ ] Como invitee (rol Member), ir a `/dashboard`.
2. [ ] Confirmar que se redirige automáticamente a `/dashboard/laststep` (RouteGate funcionando).
3. [ ] En `/dashboard/laststep`, confirmar que se ven las 3 opciones (ChatGPT, Claude, Signal PDF).
4. [ ] Abrir el dropdown del switcher. Confirmar que NO aparecen tabs de "Invitaciones" ni "Configuración" si entra a `/workspaces`.
5. [ ] Ir a `/dashboard/workspaces`. Confirmar que SÍ ve el tab "Miembros" pero sin acciones (no hay menú de "..." junto a los miembros).

### 4B — Cambiar rol del invitee a Admin

1. [ ] Como Owner, ir a `/dashboard/workspaces` tab "Miembros".
2. [ ] Click en "..." del invitee → "Cambiar a Admin".
3. [ ] Confirmar toast y que el badge cambia a "Admin".

### 4C — Vista del Admin

1. [ ] Como invitee (ahora Admin), refrescar el dashboard.
2. [ ] Confirmar que ahora SÍ puede entrar a `/dashboard` (no se redirige).
3. [ ] Ir a `/dashboard/workspaces`. Confirmar que ve los 3 tabs (Miembros, Invitaciones, Configuración).
4. [ ] En tab Configuración, confirmar que puede editar nombre/icon/vertical pero el campo "slug" está deshabilitado (solo Owner).
5. [ ] Confirmar que NO ve la sección "Danger zone" (transfer + delete son solo para Owner).

---

## Flujo 5 — Aislamiento entre workspaces

1. [ ] Como Owner, switch al workspace "QA Workspace 2" desde el switcher.
2. [ ] Ir a `/dashboard/workspaces` tab Miembros. Confirmar que solo ve a sí mismo (Owner) — NO está el invitee porque no fue invitado a ese workspace.
3. [ ] Hacer logout y login como invitee.
4. [ ] Confirmar que el invitee solo ve "QA Test Workspace" en su switcher (NO "QA Workspace 2").

---

## Flujo 6 — Transfer ownership

1. [ ] Como Owner, ir a `/dashboard/workspaces` tab Configuración.
2. [ ] En "Danger zone", click "Transfer ownership".
3. [ ] En el modal, seleccionar al invitee (que ahora es Admin). Confirmar.
4. [ ] Confirmar toast y que el switcher refresca.
5. [ ] Refrescar la página. Confirmar que ahora yo (Owner viejo) soy "Admin" y el invitee es "Owner".

---

## Flujo 7 — Delete workspace

1. [ ] Como nuevo Owner (el invitee), switch a "QA Test Workspace".
2. [ ] Ir a `/dashboard/workspaces` tab Configuración → "Danger zone" → click "Eliminar workspace".
3. [ ] Confirmar que el botón "Eliminar" está deshabilitado.
4. [ ] Tipear el nombre "QA Test Workspace" en el input.
5. [ ] Confirmar que el botón se habilita. Click "Eliminar".
6. [ ] Confirmar toast y que el switcher cambia automáticamente a otro workspace disponible (o redirige al onboarding si no quedan).

---

## Flujo 8 — Edge cases

### 8A — Slug duplicado

1. [ ] Crear nuevo workspace con un nombre que genere un slug ya existente.
2. [ ] Confirmar mensaje claro: "Este nombre ya está en uso..."

### 8B — Email ya es miembro

1. [ ] Como Owner, intentar invitar a un email que ya es miembro.
2. [ ] Confirmar mensaje "ALREADY_A_MEMBER" en el modal.

### 8C — Invitación expirada

1. [ ] (Opcional, requiere manipular DB) Setear `expiresAt` a pasado en una invitación.
2. [ ] Tratar de aceptarla. Confirmar mensaje "Esta invitación ha expirado".

### 8D — Email mismatch al aceptar

1. [ ] Owner invita `email-A@example.com`. Iniciar sesión con `email-B@example.com` y abrir el link.
2. [ ] Confirmar mensaje "EMAIL_MISMATCH" con CTA de cerrar sesión.

### 8E — Last Owner protegido

1. [ ] Como Owner único, intentar removerse del workspace.
2. [ ] Confirmar mensaje "CANNOT_REMOVE_LAST_OWNER".

---

## Validación final

- [ ] Logs de Render no muestran errores 500 durante todo el QA.
- [ ] No hay regresiones en flujos legacy (login, dashboard "Connect Data Sources", Settings).
- [ ] El email de invitación se ve bien en Gmail / Outlook (no roto).
- [ ] El bundle del dashboard se sirve correctamente y todos los assets cargan.

---

## Bloqueadores conocidos / pendientes para post-MVP

- **Filtrado de datos por workspace en endpoints legacy**: hoy `/api/meta/insights`, `/api/google/ads/insights` y otros leen del User directamente, no del workspace. Cuando coordinemos con backend, se actualizan esos endpoints para respetar `X-Workspace-Id` y migrar los hooks legacy de `fetch` directo a `apiFetch`.
- **E2E automatizado con Cypress**: por ahora este checklist es manual. La automatización es una iteración futura.
- **Upload real de profile photo**: el botón está deshabilitado, dice "Próximamente". Requiere S3 setup.
- **Ruta legacy `/onboarding`**: en `backend/index.js` hay un `app.get("/onboarding", ensureNotOnboarded, ...)` que sirve `public/onboarding.html`. Está como dead code (el SPA del onboarding lo cubre antes en el order de Express). Se puede limpiar en un PR aparte.
