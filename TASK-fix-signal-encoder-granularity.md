# TASK — Fix: Signal Encoder Granularidad + workspace=unknown

## Objetivo
Serializar las secciones diarias del structured_signal en el encoded signal (PDF) y corregir
workspace=unknown. Actualmente `campaigns_daily`, `ads_daily`, `landing_pages_daily`,
`anomalies` y `benchmarks` SE CONSTRUYEN correctamente en el structured_signal pero NUNCA
llegan al PDF porque el encoder no las recibe ni las renderiza.

**NO hagas commit ni push.**

---

## ROOT CAUSES CONFIRMADOS

### RC-1: `appendStructuredSignalSchema()` omite 3 campos del structured_signal
**Archivo:** `backend/services/mcpContextBuilder.js` líneas **3811–3826**

La función `buildStructuredSignalSchema()` sí incluye `campaigns_daily`, `ads_daily` y
`landing_pages_daily` en líneas 3746–3748, pero cuando construye el objeto `structured_signal`
de retorno (línea 3811), esos 3 campos están ausentes.

### RC-2: `buildEncodedContextText()` no tiene parámetros ni rendering para secciones daily
**Archivo:** `backend/services/signalEncoder.js` líneas **49–108**

La función solo serializa: EXECUTIVE_SUMMARY, BUSINESS_STATE, CROSS_CHANNEL_STORY,
PERFORMANCE_DRIVERS, CONVERSION_BOTTLENECKS, SCALING_OPPORTUNITIES, RISK_FLAGS,
PRIORITY_ACTIONS. No tiene parámetros ni lógica para DAILY_INDEX, CAMPAIGNS_DAILY,
ADS_DAILY, LANDING_PAGES_DAILY, ANOMALIES ni BENCHMARKS.

### RC-3: `encodeSignalPayload()` nunca extrae ni pasa los datos daily al encoder
**Archivo:** `backend/services/signalEncoder.js` líneas **179–192**

La llamada a `buildEncodedContextText()` solo pasa los campos narrativos, nunca extrae
`structuredSignal.daily_index`, `structuredSignal.campaigns_daily`, etc.

### RC-4: `workspace=unknown` — el encoder no busca en `structured_signal.meta.workspace_name`
**Archivo:** `backend/services/signalEncoder.js` líneas **170–177**

`mcpContextBuilder.js` resuelve correctamente el workspace en `pickWorkspaceName()` y lo
guarda en `structured_signal.meta.workspace_name`, pero el encoder nunca lo lee desde ahí.
Solo busca en `payload.workspaceName`, `root.workspaceName`, `user.companyName`, etc.
que están vacíos.

---

## ARCHIVOS A MODIFICAR

---

### ARCHIVO 1: `backend/services/mcpContextBuilder.js`

**Fix 1 — Agregar 3 campos faltantes al objeto structured_signal** (línea ~3823, dentro del
bloque `structured_signal: { ... }` de `appendStructuredSignalSchema()`):

```js
// ANTES (líneas 3811-3826):
    structured_signal: {
      schema: structured.schema,
      meta: structured.meta,
      daily_index: structured.daily_index,
      campaigns: structured.campaigns,
      anomalies: structured.anomalies,
      benchmarks: structured.benchmarks,
      placements: structured.placements,
      devices: structured.devices,
      ga4_web: structured.ga4_web,
      cross_channel: structured.cross_channel,
      ad_sets: structured.ad_sets,
      ads: structured.ads,
      payload_stats: structured.payload_stats,
      payload_health: structured.payload_health,
    },

// DESPUÉS:
    structured_signal: {
      schema: structured.schema,
      meta: structured.meta,
      daily_index: structured.daily_index,
      campaigns: structured.campaigns,
      anomalies: structured.anomalies,
      benchmarks: structured.benchmarks,
      placements: structured.placements,
      devices: structured.devices,
      ga4_web: structured.ga4_web,
      cross_channel: structured.cross_channel,
      ad_sets: structured.ad_sets,
      ads: structured.ads,
      campaigns_daily: structured.campaigns_daily || [],
      ads_daily: structured.ads_daily || [],
      landing_pages_daily: structured.landing_pages_daily || [],
      payload_stats: structured.payload_stats,
      payload_health: structured.payload_health,
    },
```

---

### ARCHIVO 2: `backend/services/signalEncoder.js`

#### Fix 2A — Extender `buildEncodedContextText()` con parámetros y rendering de secciones daily

**Línea ~49 — Agregar parámetros nuevos a la función:**

```js
// ANTES (línea 49-62):
function buildEncodedContextText({
  workspaceName = '',
  generatedAt = '',
  sourceFingerprint = '',
  connectionFingerprint = '',
  contextWindow = null,
  summary = {},
  performanceDrivers = [],
  conversionBottlenecks = [],
  scalingOpportunities = [],
  riskFlags = [],
  priorityActions = [],
  existingDetailedText = '',
}) {

// DESPUÉS:
function buildEncodedContextText({
  workspaceName = '',
  generatedAt = '',
  sourceFingerprint = '',
  connectionFingerprint = '',
  contextWindow = null,
  summary = {},
  performanceDrivers = [],
  conversionBottlenecks = [],
  scalingOpportunities = [],
  riskFlags = [],
  priorityActions = [],
  existingDetailedText = '',
  dailyIndex = [],
  campaignsDailyRows = [],
  adsDailyRows = [],
  landingPagesDailyRows = [],
  anomalies = [],
  benchmarks = null,
}) {
```

**Línea ~99 — Agregar rendering de secciones daily DESPUÉS de `addList('PRIORITY_ACTIONS', priorityActions)`:**

```js
// ANTES (línea ~99-105):
  addList('PRIORITY_ACTIONS', priorityActions);

  if (existingDetailedText) {
    lines.push('');
    lines.push('[LEGACY_CONTEXT_APPENDIX]');
    lines.push(existingDetailedText);
  }

// DESPUÉS:
  addList('PRIORITY_ACTIONS', priorityActions);

  // --- DAILY INDEX (30-day day-by-day snapshot) ---
  if (Array.isArray(dailyIndex) && dailyIndex.length > 0) {
    lines.push('');
    lines.push('[DAILY_INDEX]');
    for (const row of dailyIndex.slice(0, 30)) {
      const date = row?.date || row?.day || '?';
      const parts = [];
      if (row?.meta_spend != null) parts.push(`meta_spend=${Number(row.meta_spend).toFixed(0)}`);
      if (row?.meta_roas != null) parts.push(`meta_roas=${Number(row.meta_roas).toFixed(2)}`);
      if (row?.meta_purchases != null) parts.push(`meta_purchases=${row.meta_purchases}`);
      if (row?.google_spend != null) parts.push(`google_spend=${Number(row.google_spend).toFixed(0)}`);
      if (row?.google_roas != null) parts.push(`google_roas=${Number(row.google_roas).toFixed(2)}`);
      if (row?.google_conversions != null) parts.push(`google_conv=${Number(row.google_conversions).toFixed(0)}`);
      if (row?.ga4_revenue != null) parts.push(`ga4_revenue=${Number(row.ga4_revenue).toFixed(0)}`);
      if (row?.ga4_sessions != null) parts.push(`ga4_sessions=${row.ga4_sessions}`);
      if (row?.ga4_conversions != null) parts.push(`ga4_conv=${row.ga4_conversions}`);
      if (parts.length > 0) lines.push(`- ${date}: ${parts.join(' | ')}`);
    }
  }

  // --- CAMPAIGNS DAILY (per-campaign day-by-day performance) ---
  if (Array.isArray(campaignsDailyRows) && campaignsDailyRows.length > 0) {
    lines.push('');
    lines.push('[CAMPAIGNS_DAILY]');
    for (const row of campaignsDailyRows.slice(0, 60)) {
      const name = row?.campaign_name || row?.campaign_id || '?';
      const source = row?.source ? `[${String(row.source).toUpperCase()}] ` : '';
      const date = row?.date || '?';
      const parts = [];
      if (row?.spend != null) parts.push(`spend=${Number(row.spend).toFixed(0)}`);
      if (row?.roas != null) parts.push(`roas=${Number(row.roas).toFixed(2)}`);
      if (row?.conversions != null) parts.push(`conv=${Number(row.conversions).toFixed(0)}`);
      if (row?.impressions != null) parts.push(`imp=${row.impressions}`);
      if (row?.clicks != null) parts.push(`clicks=${row.clicks}`);
      if (parts.length > 0) lines.push(`- ${source}${name} | ${date} | ${parts.join(' | ')}`);
    }
  }

  // --- ADS DAILY (per-ad day-by-day performance, top ads) ---
  if (Array.isArray(adsDailyRows) && adsDailyRows.length > 0) {
    lines.push('');
    lines.push('[ADS_DAILY]');
    for (const row of adsDailyRows.slice(0, 40)) {
      const name = row?.ad_name || row?.ad_id || '?';
      const source = row?.source ? `[${String(row.source).toUpperCase()}] ` : '';
      const date = row?.date || '?';
      const parts = [];
      if (row?.spend != null) parts.push(`spend=${Number(row.spend).toFixed(0)}`);
      if (row?.roas != null) parts.push(`roas=${Number(row.roas).toFixed(2)}`);
      if (row?.impressions != null) parts.push(`imp=${row.impressions}`);
      if (row?.clicks != null) parts.push(`clicks=${row.clicks}`);
      if (row?.ctr != null) parts.push(`ctr=${Number(row.ctr).toFixed(2)}%`);
      if (parts.length > 0) lines.push(`- ${source}${name} | ${date} | ${parts.join(' | ')}`);
    }
  }

  // --- LANDING PAGES DAILY ---
  if (Array.isArray(landingPagesDailyRows) && landingPagesDailyRows.length > 0) {
    lines.push('');
    lines.push('[LANDING_PAGES_DAILY]');
    for (const row of landingPagesDailyRows.slice(0, 30)) {
      const page = row?.page || row?.landing_page || '?';
      const date = row?.date || '?';
      const parts = [];
      if (row?.sessions != null) parts.push(`sessions=${row.sessions}`);
      if (row?.conversions != null) parts.push(`conv=${row.conversions}`);
      if (row?.revenue != null) parts.push(`revenue=${Number(row.revenue).toFixed(0)}`);
      if (row?.engagement_rate != null) parts.push(`eng=${Number(row.engagement_rate).toFixed(1)}%`);
      if (parts.length > 0) lines.push(`- ${page} | ${date} | ${parts.join(' | ')}`);
    }
  }

  // --- ANOMALIES ---
  if (Array.isArray(anomalies) && anomalies.length > 0) {
    lines.push('');
    lines.push('[ANOMALIES]');
    for (const a of anomalies.slice(0, 20)) {
      const type = a?.type ? `[${String(a.type).toUpperCase()}] ` : '';
      const metric = a?.metric || a?.field || '?';
      const desc = a?.description || a?.message || '';
      lines.push(`- ${type}${metric}: ${desc}`);
    }
  }

  // --- BENCHMARKS ---
  if (benchmarks && typeof benchmarks === 'object') {
    lines.push('');
    lines.push('[BENCHMARKS]');
    for (const [key, val] of Object.entries(benchmarks)) {
      if (!val || typeof val !== 'object') continue;
      const curr = val?.current_value != null ? Number(val.current_value).toFixed(2) : 'n/a';
      const prior = val?.prior_value != null ? Number(val.prior_value).toFixed(2) : 'n/a';
      const pct = val?.pct_change != null ? `${Number(val.pct_change).toFixed(1)}%` : 'n/a';
      const trend = val?.trend ? String(val.trend).toUpperCase() : 'n/a';
      lines.push(`- ${key}: current=${curr} | prior=${prior} | chg=${pct} | trend=${trend}`);
    }
  }

  if (existingDetailedText) {
    lines.push('');
    lines.push('[LEGACY_CONTEXT_APPENDIX]');
    lines.push(existingDetailedText);
  }
```

#### Fix 2B — Extender `encodeSignalPayload()` para pasar datos daily a `buildEncodedContextText()`

**Línea ~179 — Cambiar la llamada a `buildEncodedContextText()`:**

```js
// ANTES (líneas ~179-192):
  const encodedContext = buildEncodedContextText({
    workspaceName,
    generatedAt,
    sourceFingerprint,
    connectionFingerprint,
    contextWindow,
    summary,
    performanceDrivers: uniqStrings(payload?.performance_drivers || [], 12),
    conversionBottlenecks: uniqStrings(payload?.conversion_bottlenecks || [], 12),
    scalingOpportunities: uniqStrings(payload?.scaling_opportunities || [], 12),
    riskFlags: uniqStrings(payload?.risk_flags || negatives || [], 12),
    priorityActions,
    existingDetailedText,
  });

// DESPUÉS:
  const encodedContext = buildEncodedContextText({
    workspaceName,
    generatedAt,
    sourceFingerprint,
    connectionFingerprint,
    contextWindow,
    summary,
    performanceDrivers: uniqStrings(payload?.performance_drivers || [], 12),
    conversionBottlenecks: uniqStrings(payload?.conversion_bottlenecks || [], 12),
    scalingOpportunities: uniqStrings(payload?.scaling_opportunities || [], 12),
    riskFlags: uniqStrings(payload?.risk_flags || negatives || [], 12),
    priorityActions,
    existingDetailedText,
    dailyIndex: Array.isArray(structuredSignal?.daily_index) ? structuredSignal.daily_index : [],
    campaignsDailyRows: Array.isArray(structuredSignal?.campaigns_daily) ? structuredSignal.campaigns_daily : [],
    adsDailyRows: Array.isArray(structuredSignal?.ads_daily) ? structuredSignal.ads_daily : [],
    landingPagesDailyRows: Array.isArray(structuredSignal?.landing_pages_daily) ? structuredSignal.landing_pages_daily : [],
    anomalies: Array.isArray(structuredSignal?.anomalies) ? structuredSignal.anomalies : [],
    benchmarks: structuredSignal?.benchmarks && typeof structuredSignal.benchmarks === 'object'
      ? structuredSignal.benchmarks
      : null,
  });
```

#### Fix 2C — Corregir `workspace=unknown` agregando `structured_signal.meta.workspace_name`

**Línea ~170 — Extender la cadena `pickFirstText` para `workspaceName`:**

```js
// ANTES (líneas 170-177):
  const workspaceName = pickFirstText(
    payload?.workspaceName,
    root?.workspaceName,
    user?.companyName,
    user?.workspaceName,
    user?.businessName,
    user?.name
  );

// DESPUÉS:
  const workspaceName = pickFirstText(
    payload?.workspaceName,
    structuredSignal?.meta?.workspace_name,
    root?.workspaceName,
    user?.companyName,
    user?.workspaceName,
    user?.businessName,
    user?.name
  );
```

---

## VERIFICACIÓN FINAL

```bash
# 1. Verificar que structured_signal ahora incluye los 3 campos
grep -n "campaigns_daily\|ads_daily\|landing_pages_daily" backend/services/mcpContextBuilder.js | grep "structured_signal" -A 20

# 2. Verificar que buildEncodedContextText tiene los nuevos parámetros
grep -n "dailyIndex\|campaignsDailyRows\|adsDailyRows\|landingPagesDailyRows\|anomalies\|benchmarks" backend/services/signalEncoder.js

# 3. Verificar que encodeSignalPayload pasa los datos daily
grep -n "structuredSignal\." backend/services/signalEncoder.js | grep "daily\|anomalies\|benchmarks"

# 4. Verificar fix workspace
grep -n "workspace_name\|workspaceName" backend/services/signalEncoder.js | head -15
```

**NO hagas commit ni push.**

---

## RESUMEN DE IMPACTO

| Fix | Archivo | Línea | Resultado |
|-----|---------|-------|-----------|
| 1 | mcpContextBuilder.js | 3823 | campaigns_daily, ads_daily, landing_pages_daily entran en structured_signal |
| 2A | signalEncoder.js | 49-62 | buildEncodedContextText acepta 6 parámetros nuevos |
| 2A | signalEncoder.js | ~99 | Renderiza [DAILY_INDEX], [CAMPAIGNS_DAILY], [ADS_DAILY], [LANDING_PAGES_DAILY], [ANOMALIES], [BENCHMARKS] |
| 2B | signalEncoder.js | ~179 | encodeSignalPayload extrae y pasa daily data al encoder |
| 2C | signalEncoder.js | ~170 | workspace=unknown → nombre real del workspace |

Con estos fixes, el signal pasa de **5.5/10 a ~8.5/10** en granularidad.
