# TASK: Signal Granularity — 60 días + campos faltantes

## REGLAS ABSOLUTAS
- NO hagas commit ni push en ningún momento.
- Lee cada función antes de modificarla.
- Cambios mínimos y coherentes con el estilo existente.
- Si un campo requiere una fuente no conectada: pon `null`, nunca `0` en lugar de `null`.
- Reporta qué hiciste al terminar cada paso.

---

## Diagnóstico previo (ya mapeado — no re-explorar)

El archivo central es `backend/services/mcpContextBuilder.js`.
La arquitectura ya está construida. Los gaps son específicos:

### Gap 1 — `daily_index` cubre solo ~30 días, no 60

`buildMetaDailyRows()` y `buildGoogleDailyRows()` leen únicamente de:
- `metaPack.dailyDataset.data.totals_by_day` → chunk `meta.daily_trends_ai`
- `googlePack.dailyDataset.data.totals_by_day` → chunk `google.daily_trends_ai`

Estos chunks tienen el rango activo (típicamente 7–30 días).
Los 60 días históricos están en chunks separados que YA existen en MongoDB:
- `meta.history.daily_account_totals` → campo `data.totals_by_day` (rows por día, nivel cuenta)
- `google.history.daily_account_totals` → mismo patrón

`metaPack` y `googlePack` se arman en `buildMetaContext()` (línea ~1478).
Actualmente solo mapean `dailyDataset` y `rankedDataset`.
Los chunks de history están disponibles en `metaPack.chunks` (array completo).

### Gap 2 — `buildStructuredAdSets()` es stub (línea 2418)
```js
function buildStructuredAdSets() { return []; }
```
Los datos de ad sets ya están en el chunk `meta.campaigns_ranked` (`data.campaigns` o similar).
Verifica el shape exacto del campo antes de implementar.

### Gap 3 — `buildStructuredAds()` es stub (línea 2422)
```js
function buildStructuredAds() { return []; }
```
Los datos de ads/creativos pueden estar en chunks de Meta breakdown. Verifica disponibilidad.
Si no hay datos de ads en los chunks actuales, retorna `[]` y agrega comentario `// TODO: requires meta.ads chunk`.

### Gap 4 — `anomalies` carecen de `magnitude_pct`, `prior_value`, `current_value`
`buildStructuredAnomalies()` (línea 2578) existe y genera anomalías desde `mini.active_risks` y `mini.risks`,
pero no computa comparación WoW. Esos campos quedan en `null`.
Para poblarlos se necesitan los totales de la semana anterior desde los chunks de history.

### Gap 5 — Campos Tier 3/4 faltantes en cada fila del `daily_index`
Cada row ya tiene los campos pero hardcoded a `null`:
`reach`, `frequency`, `sessions`, `new_users`, `landing_page_cvr`, `add_to_cart_count`,
`checkout_starts`, `orders`, `revenue`, `roas_reconciled`, `ncac`, `mer`, `cart_abandonment_rate`

Estos se pueden poblar con:
- **Pixel data**: tabla `events` de Prisma agrupada por día y `account_id`
- **Órdenes**: tabla `orders` de Prisma agrupada por `platform_created_at`
Solo si hay datos disponibles. Si no: dejar en `null` con consistencia.

---

## Paso 1 — Extender `daily_index` a 60 días

**Archivo:** `backend/services/mcpContextBuilder.js`

### 1a — Agregar helper para leer history chunks

Antes de `buildMetaDailyRows()` (línea 1725), agrega esta función:

```js
function extractHistoryTotals(chunks, datasetPrefix) {
  // Lee todos los chunks cuyo dataset empieza con datasetPrefix
  // Ej: 'meta.history.daily_account_totals'
  // Retorna array plano de rows { date, kpis: {...} }
  const historyChunks = (Array.isArray(chunks) ? chunks : [])
    .filter((c) => safeStr(c?.dataset).startsWith(datasetPrefix));

  const allRows = [];
  for (const chunk of historyChunks) {
    const rows = Array.isArray(chunk?.data?.totals_by_day) ? chunk.data.totals_by_day : [];
    for (const row of rows) {
      if (isIsoDay(row?.date)) allRows.push(row);
    }
  }
  return allRows;
}
```

### 1b — Modificar `buildMetaDailyRows(metaPack)`

Combina los totals del chunk activo (`dailyDataset`) con los del history, deduplica por fecha
(el chunk activo tiene prioridad si hay solapamiento), y filtra a los últimos 60 días:

```js
function buildMetaDailyRows(metaPack) {
  const activeTotals = Array.isArray(metaPack?.dailyDataset?.data?.totals_by_day)
    ? metaPack.dailyDataset.data.totals_by_day : [];

  const historyTotals = extractHistoryTotals(
    metaPack?.chunks,
    'meta.history.daily_account_totals'
  );

  // Merge: activo tiene prioridad. Deduplicar por fecha.
  const byDate = new Map();
  for (const row of [...historyTotals, ...activeTotals]) {
    if (isIsoDay(row?.date)) byDate.set(row.date, row);
  }

  // Filtrar últimos 60 días
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const totals = [...byDate.values()].filter((r) => r.date >= cutoffStr);

  return totals
    .filter((row) => isIsoDay(row?.date))
    .map((row) => {
      // ... mismo mapping que hoy, sin cambios en los campos
    });
}
```

Aplica el mismo patrón a `buildGoogleDailyRows(googlePack)` usando
`'google.history.daily_account_totals'`.

### 1c — Verificar que `metaPack.chunks` esté disponible

En `buildMetaContext()` (línea ~1478), confirma que el objeto retornado incluye `chunks`.
Si no lo incluye, agrégalo:
```js
return {
  dailyDataset: ...,
  rankedDataset: ...,
  chunks,   // <-- agregar si falta
  full: ...,
  mini: ...,
};
```
Haz lo mismo para `buildGoogleContext()`.

---

## Paso 2 — Implementar `buildStructuredAdSets()`

**Antes de implementar:** Lee el shape exacto de `metaPack.rankedDataset.data` y reporta
qué campos de ad_set están disponibles (bid_strategy, daily_budget, targeting, etc.).

Si hay datos de ad_sets en los chunks, implementa la función con la firma:
```js
function buildStructuredAdSets({ metaPack, googlePack }) { ... }
```
Y actualiza la llamada en `buildStructuredSignalSchema()` (línea ~2900) para pasarle los packs.

Shape mínimo de cada item:
```js
{
  ad_set_id, ad_set_name, campaign_name, platform, status,
  bid_strategy, bid_amount, daily_budget, targeting_summary, audience_type,
  last_7: { spend, impressions, clicks, ctr, cpc, conversions, roas_platform },
  last_30: { ... },
  cpa_7d, cpa_30d,
  frequency_7d,   // null si no disponible
  frequency_30d,  // null si no disponible
  frequency_warning,  // true si frequency_7d > 3.5
  cpa_reconciled_30d  // null hasta Tier 4
}
```

Si los chunks no tienen datos de ad_sets, retorna `[]` y agrega:
```js
// TODO: requires meta.ad_sets chunk (not yet collected)
```

---

## Paso 3 — Implementar `buildStructuredAds()` 

Mismo enfoque que Paso 2. Verifica disponibilidad en chunks antes de implementar.

Shape mínimo:
```js
{
  ad_id, ad_name, campaign_name, platform, creative_type, status,
  last_7_spend, last_7_impressions, last_7_ctr, last_7_roas_platform,
  last_7_frequency,      // null si no disponible
  last_30_ctr, last_30_roas_platform,
  ctr_vs_account_avg,    // last_7_ctr / account_avg_ctr
  roas_vs_account_avg,   // last_7_roas / account_avg_roas
  landing_page_cvr_7d,   // null hasta Tier 3
  add_to_cart_rate_7d,   // null hasta Tier 3
  fatigue_flag,          // true si CTR bajó WoW AND frequency > 3
  top_performer_flag     // true si ROAS top 20% entre ads activos con spend > 100
}
```

---

## Paso 4 — Poblar `magnitude_pct`, `prior_value`, `current_value` en anomalies

En `buildStructuredAnomalies()` (línea 2578), las campañas de riesgo ya se detectan.
El problema es que no hay comparación WoW para calcular `magnitude_pct`.

Agrega un helper que calcule totales de la semana anterior desde history:

```js
function getPriorWeekTotals(chunks, platform) {
  // Lee meta.history.daily_account_totals o google.history.daily_account_totals
  // Suma los KPIs de los 7 días anteriores a "hoy - 7 días"
  // Retorna { spend, roas, cpa, conversions } o null si no hay datos
}
```

Usa ese helper en `pushCampaignAnomalies()` para poblar:
- `prior_value`: valor de la métrica en la semana anterior
- `current_value`: valor actual (ya existe)
- `magnitude_pct`: `((current - prior) / prior) * 100`
- `estimated_impact_usd`: `(magnitude_pct / 100) * prior_spend` aproximado

Si no hay history suficiente para calcular, deja en `null` (no inventes valores).

---

## Paso 5 — Verificación final

Genera un dry-run del signal payload en modo log (sin guardar ni enviar).
Puedes invocar `buildStructuredSignalSchema()` con datos de prueba o con un usuario real si hay forma segura de hacerlo en desarrollo.

Reporta solo:
```
daily_index: N rows (fechas desde YYYY-MM-DD hasta YYYY-MM-DD)
campaigns: N items
ad_sets: N items
ads: N items
anomalies: N items (con magnitude_pct poblado: X de N)
benchmarks: present / null
```

NO hagas commit. NO hagas push.
