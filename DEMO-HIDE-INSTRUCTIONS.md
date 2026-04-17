# DEMO-HIDE — Ocultar temporalmente Attribution (sidebar) y bloque "Connect your website pixel" (Get started)

> **Contexto:** Demo a las 16:00 del 2026-04-17. Necesitamos ocultar **únicamente en el frontend** dos elementos del dashboard, sin eliminar lógica, sin romper estética, sin romper el build y con reversión trivial.
>
> **Alcance:** Este cambio es **solo visual** (comentar JSX). NO se toca ninguna ruta, hook, estado, servicio, endpoint ni modelo. La lógica permanece 100% intacta.
>
> **Tag de reversión:** Todo cambio va acompañado del marcador `DEMO-HIDE 2026-04-17` para poder hacer `grep -r "DEMO-HIDE" dashboard-src/` después de la demo y revertir en segundos.

---

## 🎯 Objetivo

1. **Sidebar:** Ocultar el botón "Attribution" del nav lateral (`dashboard-src/src/components/Sidebar.tsx`).
2. **Get started (Index):** Ocultar el bloque completo "Guided Pixel Setup / Connect your website pixel" (`dashboard-src/src/pages/Index.tsx`).

El resto del dashboard permanece idéntico: layout, espaciados, colores, animaciones, comportamiento.

---

## ⛔ Reglas estrictas (NO hacer)

- ❌ **NO eliminar** ninguna línea. Solo comentar.
- ❌ **NO tocar** imports (ni `ChartColumn` en `Sidebar.tsx`, ni `PixelSetupWizard`, `Search`, `CheckCircle2`, `ArrowRight` en `Index.tsx`). Dejar los imports intactos evita riesgo de lint estricto y hace la reversión más fácil.
- ❌ **NO tocar** la ruta `/attribution` en `dashboard-src/src/App.tsx` (línea 307). La ruta debe seguir respondiendo si alguien la teclea directo.
- ❌ **NO tocar** el componente `<PixelSetupWizard ... />` montado al final de `Index.tsx` (línea ~1241). Se queda montado — solo ocultamos su punto de entrada visual.
- ❌ **NO tocar** los estados `pixelWizardOpen`, `setPixelWizardOpen`, `pixelConnected`, `pixelShop`, `asmUiError`, `asmUiLoading`. Ningún handler, ningún `useState`, ningún `useEffect`.
- ❌ **NO tocar** `dashboard-src/src/components/MobileBottomNav.tsx`. Ya fue verificado: no contiene Attribution, no requiere cambios.
- ❌ **NO tocar** `dashboard-src/src/pages/AttributionEmbed.tsx`. La página sigue existiendo.
- ❌ **NO introducir** flags de entorno, feature toggles, ni lógica condicional. El cambio es puramente comentar JSX.

---

## ✅ Cambio 1 — `dashboard-src/src/components/Sidebar.tsx`

**Ubicación:** Array `PRIMARY`, líneas 27–30 (aprox.).

**Estado actual (verificado):**

```tsx
const PRIMARY: NavItem[] = [
  { icon: <Compass className="h-5 w-5" />, label: "Get started", path: START_PATH },
  { icon: <ChartColumn className="h-5 w-5" />, label: "Attribution", path: ATTRIBUTION_PATH },
];
```

**Cambio exacto:** Comentar la segunda línea del array (la de Attribution), **preservando la coma final del primer item** para evitar que quede una coma colgando dentro del array.

**Estado después del cambio:**

```tsx
const PRIMARY: NavItem[] = [
  { icon: <Compass className="h-5 w-5" />, label: "Get started", path: START_PATH },
  // DEMO-HIDE 2026-04-17: Attribution oculto temporalmente del sidebar para la demo. Revertir descomentando esta línea.
  // { icon: <ChartColumn className="h-5 w-5" />, label: "Attribution", path: ATTRIBUTION_PATH },
];
```

**Notas importantes:**

- La constante `ATTRIBUTION_PATH` (línea 23) se mantiene definida — NO comentar.
- El import de `ChartColumn` en la línea 3 se mantiene — NO comentar.
- El bloque `<div className="pt-3"><div className="mb-3 h-px ..." />` que actúa como separador entre PRIMARY y SECONDARY (líneas 464–465 aprox.) se mantiene intacto. El separador se verá exactamente igual, solo con un item menos arriba.

**Validación visual esperada:**

- El nav del sidebar mostrará únicamente "Get started" en la sección PRIMARY.
- El separador delgado y la sección "Settings" se renderizan sin cambios.
- "Sign out" al final, sin cambios.
- El footer de usuario (E-Nova Business Sol…) sin cambios.

---

## ✅ Cambio 2 — `dashboard-src/src/pages/Index.tsx`

**Ubicación:** Bloque "Guided Pixel Setup", líneas **1122 a 1164** (inclusive).

**Estado actual (verificado, extracto):**

```tsx
                  </div>  {/* ← línea 1120, cierre del bloque Progress anterior */}

                  <div className="mt-5 overflow-hidden rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] p-4 backdrop-blur-md sm:mt-6 sm:rounded-[28px] sm:p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 rounded-full border border-[#B55CFF]/18 bg-[#B55CFF]/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#E6D2FF]">
                          <Search className="h-3.5 w-3.5" />
                          Guided Pixel Setup
                        </div>

                        <h2 className="mt-3 text-[1.1rem] font-semibold tracking-[-0.03em] text-white sm:text-[1.28rem]">
                          {pixelConnected ? "Pixel connected" : "Connect your website pixel"}
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/56">
                          {pixelConnected && pixelShop
                            ? `Tracking active on ${pixelShop}. Run the wizard again to update your setup.`
                            : "Detect your store type and get a guided install flow for the Adray pixel without leaving this page."}
                        </p>
                      </div>

                      {pixelConnected ? (
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 rounded-2xl border border-[#4FE3C1]/30 bg-[#4FE3C1]/10 px-4 py-2.5 text-sm font-semibold text-[#4FE3C1]">
                            <CheckCircle2 className="h-4 w-4" />
                            Connected
                          </div>
                          <Button
                            onClick={() => setPixelWizardOpen(true)}
                            variant="outline"
                            className="h-10 rounded-2xl border-white/10 bg-white/[0.04] px-4 text-sm text-white/70 hover:bg-white/[0.08] hover:text-white md:w-auto"
                          >
                            Reconfigure
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setPixelWizardOpen(true)}
                          className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.22)] transition-all hover:bg-[#A664FF] md:w-auto"
                        >
                          <span>Connect Pixel</span>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>  {/* ← línea 1164, cierre del bloque "Guided Pixel Setup" */}


                  {asmUiLoading ? (  {/* ← línea 1167, NO TOCAR */}
```

**Cambio exacto:** Envolver el bloque completo (líneas 1122–1164 inclusive) en un comentario JSX `{/* ... */}`, precedido de un comentario JSX de marcador `DEMO-HIDE`. Mantener la indentación de 18 espacios como en el código original (para que la reversión sea un simple remover de `{/* ` y ` */}`).

**Estado después del cambio:**

```tsx
                  </div>

                  {/* DEMO-HIDE 2026-04-17: bloque "Guided Pixel Setup / Connect your website pixel" oculto temporalmente para la demo. Revertir removiendo los delimitadores {/* y *\/} de abajo. */}
                  {/*
                  <div className="mt-5 overflow-hidden rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] p-4 backdrop-blur-md sm:mt-6 sm:rounded-[28px] sm:p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 rounded-full border border-[#B55CFF]/18 bg-[#B55CFF]/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#E6D2FF]">
                          <Search className="h-3.5 w-3.5" />
                          Guided Pixel Setup
                        </div>

                        <h2 className="mt-3 text-[1.1rem] font-semibold tracking-[-0.03em] text-white sm:text-[1.28rem]">
                          {pixelConnected ? "Pixel connected" : "Connect your website pixel"}
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/56">
                          {pixelConnected && pixelShop
                            ? `Tracking active on ${pixelShop}. Run the wizard again to update your setup.`
                            : "Detect your store type and get a guided install flow for the Adray pixel without leaving this page."}
                        </p>
                      </div>

                      {pixelConnected ? (
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 rounded-2xl border border-[#4FE3C1]/30 bg-[#4FE3C1]/10 px-4 py-2.5 text-sm font-semibold text-[#4FE3C1]">
                            <CheckCircle2 className="h-4 w-4" />
                            Connected
                          </div>
                          <Button
                            onClick={() => setPixelWizardOpen(true)}
                            variant="outline"
                            className="h-10 rounded-2xl border-white/10 bg-white/[0.04] px-4 text-sm text-white/70 hover:bg-white/[0.08] hover:text-white md:w-auto"
                          >
                            Reconfigure
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setPixelWizardOpen(true)}
                          className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.22)] transition-all hover:bg-[#A664FF] md:w-auto"
                        >
                          <span>Connect Pixel</span>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  */}


                  {asmUiLoading ? (
```

> ⚠️ **Atención con los comentarios JSX anidados:** JSX no permite `*/` dentro de `{/* ... */}` de forma literal si hay otro `*/` dentro. El bloque a comentar **no contiene `*/`** (revisado). El único riesgo sería si el linter se confunde con llaves dentro del comentario — pero como comentamos un bloque JSX bien formado sin strings raros, es seguro.
>
> **Regla práctica:** el bloque interno tiene expresiones `{pixelConnected ? ... : ...}` y `{pixelShop}`. Dentro de un comentario `{/* ... */}` estas llaves son texto inerte, NO se evalúan. Confirmado seguro.

**Validación visual esperada:**

- La página "Get started" mostrará, en orden: header "Connect Your Data Sources" → progress bar → pills (Meta/Google Ads/Google Analytics) → **[sin el bloque Guided Pixel Setup]** → los 4 StepRows (Meta Ads / Google Ads / Google Analytics / Merchant Center) → bloque "Your data is ready" (si aplica).
- El espaciado vertical entre la tarjeta de Progress y el primer StepRow seguirá siendo correcto: el StepRow grid ya tiene su propio `mt-5` (línea 1173), así que no hay colapso ni hueco raro.
- Ningún otro cambio visual, ninguna sección se desalinea.

---

## 🧪 Validación E2E (ejecutar después de aplicar ambos cambios)

Desde la raíz del repo:

```bash
# 1. Compilar el dashboard — debe pasar sin errores
cd dashboard-src && npm run build
```

**Criterio de éxito:** build exitoso, sin errores TypeScript ni errores de bundler.

Luego ejecutar el dashboard localmente y verificar visualmente:

```bash
# 2. (Opcional si ya está corriendo) arrancar el dashboard en dev
cd dashboard-src && npm run dev
```

**Checklist visual en `adray.ai/dashboard/` (o localhost dev):**

- [ ] Sidebar muestra: **Get started** (activo con badge magenta), separador, **Settings**, separador, **Sign out**. NO aparece "Attribution".
- [ ] Página "Get started" muestra en orden: badge "STEP 1 · ACTIVATION" → título "Connect Your Data Sources" → "Your platforms are already synchronized" → "3 of 3 connected" → tarjeta Progress 100% con pills Meta/Google Ads/Google Analytics.
- [ ] **NO aparece** el bloque con badge "GUIDED PIXEL SETUP" ni el título "Connect your website pixel" ni el botón morado "Connect Pixel".
- [ ] Inmediatamente debajo de la tarjeta Progress aparecen los 4 StepRows: (1) Meta Ads Completed, (2) Google Ads Completed, (3) Google Analytics Completed, (4) Merchant Center Pending.
- [ ] Al final, el bloque "Your data is ready → Use in AI".
- [ ] No hay huecos raros, bordes desalineados, ni cards flotantes.
- [ ] Tipografía, colores, sombras y animaciones idénticos al estado previo.
- [ ] Navegar a `/attribution` **directamente por URL** sigue funcionando (la página `AttributionEmbed` carga). Esto confirma que solo ocultamos el link, no la ruta.

---

## 🔁 Reversión post-demo

Después de la demo, revertir es trivial:

```bash
# Localizar todos los cambios DEMO-HIDE
grep -rn "DEMO-HIDE 2026-04-17" dashboard-src/src/
```

Esto devolverá 2 ubicaciones:
1. `dashboard-src/src/components/Sidebar.tsx` — remover las 2 líneas comentadas y restaurar el item `Attribution` en el array `PRIMARY`.
2. `dashboard-src/src/pages/Index.tsx` — remover el comentario marcador `{/* DEMO-HIDE ... */}` y los delimitadores `{/*` y `*/}` que envuelven el bloque `<div className="mt-5 overflow-hidden rounded-[24px] ...">`.

Ejecutar `cd dashboard-src && npm run build` para confirmar que todo vuelve a compilar limpio.

---

## 📋 Resumen del diff (para revisión humana rápida)

| Archivo | Líneas afectadas | Tipo de cambio | Riesgo |
|---|---|---|---|
| `dashboard-src/src/components/Sidebar.tsx` | 29 (comentar) + 1 línea marcador agregada | Comment-out JSX array item | Muy bajo |
| `dashboard-src/src/pages/Index.tsx` | 1122–1164 (envolver en `{/* */}`) + 1 línea marcador agregada | Comment-out JSX block | Muy bajo |

**Total:** 2 archivos tocados, 0 líneas eliminadas, 0 imports modificados, 0 lógica alterada.

---

## ⏱ Tiempo estimado de ejecución

- Aplicar cambios: **< 2 min**
- Build + verificación visual: **2–3 min**
- **Total: ~5 min**, con holgura suficiente para la demo de las 16:00.
