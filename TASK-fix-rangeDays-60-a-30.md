# TASK — Fix: rangeDays 60→30 en todos los archivos restantes

## Problema
El signal con 3 fuentes (Meta + Google + GA4) muestra `rangeDays: 60` porque hay 9 lugares
con `60` hardcodeado en 5 archivos que NO fueron modificados en Phase 1.

## Archivos y líneas exactas a modificar

**NO hagas commit ni push.**

---

### ARCHIVO 1: `backend/jobs/transform/metaLlmFormatter.js`

**Línea ~841** — Cambiar el fallback `60` a `30`:
```js
// ANTES
clampInt(contextRangeDays || meta?.contextRangeDays || range?.days || 60, 7, 3650);
// DESPUÉS
clampInt(contextRangeDays || meta?.contextRangeDays || range?.days || 30, 7, 3650);
```

---

### ARCHIVO 2: `backend/jobs/transform/googleAdsLlmFormatter.js`

**Línea ~122** — Cambiar el fallback `60` a `30`:
```js
// ANTES
const rangeDays = clampInt(contextRangeDays || 60, 1, 3650);
// DESPUÉS
const rangeDays = clampInt(contextRangeDays || 30, 1, 3650);
```

**Línea ~749** — Cambiar el fallback `60` a `30`:
```js
// ANTES
clampInt(contextRangeDays || meta?.contextRangeDays || normalizedRange?.days || 60, 7, 3650);
// DESPUÉS
clampInt(contextRangeDays || meta?.contextRangeDays || normalizedRange?.days || 30, 7, 3650);
```

---

### ARCHIVO 3: `backend/jobs/transform/ga4LlmFormatter.js`

**Línea ~863** — Cambiar el fallback `60` a `30`:
```js
// ANTES
clampInt(contextRangeDays || meta?.contextRangeDays || normalizedRange?.days || 60, 7, 3650);
// DESPUÉS
clampInt(contextRangeDays || meta?.contextRangeDays || normalizedRange?.days || 30, 7, 3650);
```

---

### ARCHIVO 4: `backend/routes/analytics.js`

**Línea ~1095** — Auto-sync Meta hardcodeado:
```js
// ANTES
rangeDays: 60,
// DESPUÉS
rangeDays: 30,
```
(Dentro de la llamada a `enqueueMetaCollectBestEffort` con `reason: 'paid_media_auto_sync'`)

**Línea ~1114** — Auto-sync Google hardcodeado:
```js
// ANTES
rangeDays: 60,
// DESPUÉS
rangeDays: 30,
```
(Dentro de la llamada a `enqueueGoogleAdsCollectBestEffort` con `reason: 'paid_media_auto_sync'`)

---

### ARCHIVO 5: `backend/routes/googleConnect.js`

**Línea ~468** — Enqueue al conectar Google Ads:
```js
// ANTES
rangeDays: 60,
// DESPUÉS
rangeDays: 30,
```
(Dentro de `enqueueGoogleAdsCollectBestEffort` con `trigger: 'googleConnect'`)

**Línea ~495** — Enqueue al conectar GA4:
```js
// ANTES
rangeDays: 60,
// DESPUÉS
rangeDays: 30,
```
(Dentro de `enqueueGa4CollectBestEffort` con `trigger: 'googleConnect'`)

---

### ARCHIVO 6: `backend/routes/mcpdata.js`

**Línea ~811** — Fallback del endpoint "collect-now" manual:
```js
// ANTES
const rangeDays = toBoundedInt(body.rangeDays, 60, 7, 3650);
// DESPUÉS
const rangeDays = toBoundedInt(body.rangeDays, 30, 7, 3650);
```

---

## Verificación final

Ejecuta grep para confirmar que no quedan `rangeDays: 60` ni fallbacks `|| 60` relacionados
con el rango de contexto:

```bash
grep -n "rangeDays.*60\||| 60\|, 60," \
  backend/jobs/transform/metaLlmFormatter.js \
  backend/jobs/transform/googleAdsLlmFormatter.js \
  backend/jobs/transform/ga4LlmFormatter.js \
  backend/routes/analytics.js \
  backend/routes/googleConnect.js \
  backend/routes/mcpdata.js
```

El resultado debe estar vacío (0 matches relacionados con rangeDays).

**NO hagas commit ni push.**
