# TASK — Fix: rangeDays 60 → 30 (runSnapshotFirst + formatter defaults)

## Objetivo
Eliminar los últimos hardcodes de `rangeDays: 60` que hacen que señales Meta-only (y Google-only)
sigan apareciendo en 60 días aunque el sistema ya está configurado en 30. Son dos grupos de archivos:

1. **`runSnapshotFirst.js`** — dispara colecciones con `rangeDays: 60` cada vez que el snapshot
   está obsoleto. Es el ROOT CAUSE confirmado del 60d persistente en Meta-only.
2. **3 formatters LLM** — usan `contextRangeDays = 60` como valor por defecto en los parámetros
   de sus funciones de construcción de texto.

**NO hagas commit ni push.**

---

## ROOT CAUSES

### RC-1: `maybeEnqueueBackgroundCollect()` hardcodea `rangeDays: 60`
**Archivo:** `backend/mcp/snapshot/runSnapshotFirst.js` líneas **73** y **79**

Cuando el snapshot MCP está obsoleto, esta función encola colecciones nuevas de Meta y Google
con `rangeDays: 60`. Ese valor se propaga por `resolveContextRangeDaysByPlan()` (que lo preserva),
entra al colector, se guarda en MongoDB como `range.days = 60` y `mcpContextBuilder.js` lo lee
como `contextWindow.rangeDays = 60`. Con Multi-fuente hay otro code path que recalcula
`contextRangeDays`, pero con Meta-only el valor del snapshot es el único disponible → 60d.

### RC-2: Defaults de `contextRangeDays = 60` en formatters
**Archivos:**
- `backend/jobs/transform/metaLlmFormatter.js` líneas **450**, **825**, **897**
- `backend/jobs/transform/googleAdsLlmFormatter.js` líneas **376**, **733**, **801**
- `backend/jobs/transform/ga4LlmFormatter.js` líneas **848**, **947**

Son parámetros con default; normalmente el caller los pasa correctamente, pero si por algún
motivo la llamada omite el argumento el formatter genera texto con "30-day window" pero
internamente recorta/referencia 60 días.

---

## ARCHIVOS A MODIFICAR

---

### ARCHIVO 1: `backend/mcp/snapshot/runSnapshotFirst.js`

**Fix — Cambiar `rangeDays: 60` → `rangeDays: 30` en ambas llamadas de enqueue (líneas 73 y 79):**

```js
// ANTES (líneas 69-81):
  if (sourceKey === 'metaAds') {
    await q.enqueueMetaCollectBestEffort({
      userId,
      reason: 'mcp_snapshot_stale_read',
      rangeDays: 60,
    });
  } else if (sourceKey === 'googleAds') {
    await q.enqueueGoogleAdsCollectBestEffort({
      userId,
      reason: 'mcp_snapshot_stale_read',
      rangeDays: 60,
    });
  }

// DESPUÉS:
  if (sourceKey === 'metaAds') {
    await q.enqueueMetaCollectBestEffort({
      userId,
      reason: 'mcp_snapshot_stale_read',
      rangeDays: 30,
    });
  } else if (sourceKey === 'googleAds') {
    await q.enqueueGoogleAdsCollectBestEffort({
      userId,
      reason: 'mcp_snapshot_stale_read',
      rangeDays: 30,
    });
  }
```

---

### ARCHIVO 2: `backend/jobs/transform/metaLlmFormatter.js`

**Fix — Cambiar 3 defaults de `contextRangeDays = 60` → `contextRangeDays = 30`:**

Línea **450**:
```js
// ANTES:
function buildDailyTrends(dailyData, topCampaignRows = 5, contextRangeDays = 60) {

// DESPUÉS:
function buildDailyTrends(dailyData, topCampaignRows = 5, contextRangeDays = 30) {
```

Línea **825**:
```js
// ANTES:
  contextRangeDays = 60,

// DESPUÉS:
  contextRangeDays = 30,
```

Línea **897**:
```js
// ANTES:
  contextRangeDays = 60,

// DESPUÉS:
  contextRangeDays = 30,
```

---

### ARCHIVO 3: `backend/jobs/transform/googleAdsLlmFormatter.js`

**Fix — Cambiar 3 defaults de `contextRangeDays = 60` → `contextRangeDays = 30`:**

Línea **376**:
```js
// ANTES:
function buildDailyTrends(dailyData, topCampaignRows = 5, contextRangeDays = 60) {

// DESPUÉS:
function buildDailyTrends(dailyData, topCampaignRows = 5, contextRangeDays = 30) {
```

Línea **733**:
```js
// ANTES:
  contextRangeDays = 60,

// DESPUÉS:
  contextRangeDays = 30,
```

Línea **801**:
```js
// ANTES:
  contextRangeDays = 60,

// DESPUÉS:
  contextRangeDays = 30,
```

---

### ARCHIVO 4: `backend/jobs/transform/ga4LlmFormatter.js`

**Fix — Cambiar 2 defaults de `contextRangeDays = 60` → `contextRangeDays = 30`:**

Línea **848**:
```js
// ANTES:
  contextRangeDays = 60,

// DESPUÉS:
  contextRangeDays = 30,
```

Línea **947**:
```js
// ANTES:
  contextRangeDays = 60,

// DESPUÉS:
  contextRangeDays = 30,
```

---

## VERIFICACIÓN FINAL

```bash
# 1. Confirmar que runSnapshotFirst ya no tiene 60
grep -n "rangeDays" backend/mcp/snapshot/runSnapshotFirst.js

# 2. Confirmar que los 3 formatters ya no tienen contextRangeDays = 60
grep -n "contextRangeDays = 60" backend/jobs/transform/metaLlmFormatter.js
grep -n "contextRangeDays = 60" backend/jobs/transform/googleAdsLlmFormatter.js
grep -n "contextRangeDays = 60" backend/jobs/transform/ga4LlmFormatter.js
```

Todos los comandos anteriores deben retornar **0 resultados** si el fix está correcto.

**NO hagas commit ni push.**

---

## RESUMEN DE IMPACTO

| Fix | Archivo | Línea(s) | Resultado |
|-----|---------|----------|-----------|
| RC-1 | runSnapshotFirst.js | 73, 79 | Colecciones por snapshot stale usan 30d → MongoDB guarda range.days=30 → signal muestra 30d |
| RC-2a | metaLlmFormatter.js | 450, 825, 897 | Defaults del formatter alineados a 30d |
| RC-2b | googleAdsLlmFormatter.js | 376, 733, 801 | Defaults del formatter alineados a 30d |
| RC-2c | ga4LlmFormatter.js | 848, 947 | Defaults del formatter alineados a 30d |

**Después de commitear y hacer deploy:**
- Esperar ~2-3 minutos para que el snapshot expire y `maybeEnqueueBackgroundCollect` dispare con 30d
- Generar un nuevo signal — `context_window.rangeDays` debe ser **30** en el PDF
- Si el snapshot aún carga el viejo dato (60d) desde cache, invalidar manualmente o esperar el TTL del snapshot
