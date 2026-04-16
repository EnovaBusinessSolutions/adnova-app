# TASK: Agregar chunks meta.ad_sets y meta.ads al collector

## REGLAS ABSOLUTAS
- NO hagas commit ni push.
- Lee cada sección antes de modificar.
- Cambios mínimos y coherentes con el estilo existente del archivo.
- Reporta qué hiciste al terminar cada paso.

---

## Diagnóstico previo (ya mapeado — no re-explorar)

**Archivo central:** `backend/jobs/collect/metaCollector.js`

El collector ya tiene este patrón para agregar datasets (línea ~1595):
```js
const datasets = [
  { source: 'metaAds', dataset: 'meta.insights_summary', ... },
  { source: 'metaAds', dataset: 'meta.campaigns_ranked', ... },
  { source: 'metaAds', dataset: 'meta.breakdowns_top', ... },
  { source: 'metaAds', dataset: 'meta.optimization_signals', ... },
];
// luego condicionales: if (buildDailySeries) { datasets.push(...) }
// luego: if (buildHistoricalDatasets) { datasets.push(...) }
```

Hay un flag `buildDailySeries` (línea ~761) que controla si se construyen datasets opcionales.
Seguir el mismo patrón: agregar un flag `buildAdSets` y otro `buildAds`, y pushear los datasets condicionalmente.

La función principal del collector recibe `opts` con un campo `granularity` (array de strings).
El worker ya pasa: `['summary', 'ranked_campaigns', 'breakdown', 'signals', 'daily_ai', 'history_daily_totals', 'history_daily_campaigns']`
Agregar `'ad_sets'` y `'ads'` a ese array en el worker también (Paso 4).

---

## Paso 1 — Leer el shape exacto de la API de Meta para ad sets y ads

Antes de escribir código, lee estas secciones del archivo para entender el patrón de llamadas a la API:
- Línea ~283: cómo se construye la URL de campaigns (fields, paginación)
- Línea ~862: cómo se agregan breakdowns a la URL
- Línea ~866: función `mkUrl` o equivalente

Con eso como referencia, las URLs que necesitas agregar son:

**Ad Sets:**
```
GET /act_{actId}/adsets
fields=id,name,campaign_id,status,effective_status,bid_strategy,bid_amount,daily_budget,
       lifetime_budget,targeting,optimization_goal,destination_type
limit=500
```

**Ads (nivel creativo):**
```
GET /act_{actId}/ads
fields=id,name,adset_id,campaign_id,status,effective_status,creative{id,title,body,object_type,asset_feed_spec}
limit=500
```

**Insights de ad sets (últimos 7 y 30 días):**
```
GET /act_{actId}/insights
fields=adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,
       frequency,actions,action_values,reach
level=adset
date_preset=last_7d   (y separado: last_30d)
```

**Insights de ads (últimos 7 y 30 días):**
```
GET /act_{actId}/insights
fields=ad_id,ad_name,adset_id,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,
       frequency,actions,action_values
level=ad
date_preset=last_7d   (y separado: last_30d)
```

---

## Paso 2 — Agregar flags de control

Cerca de donde está `buildDailySeries` (línea ~761), agregar:

```js
const buildAdSets = opts.buildAdSets !== undefined
  ? !!opts.buildAdSets
  : (Array.isArray(opts.granularity)
      ? opts.granularity.includes('ad_sets')
      : true);

const buildAds = opts.buildAds !== undefined
  ? !!opts.buildAds
  : (Array.isArray(opts.granularity)
      ? opts.granularity.includes('ads')
      : true);
```

---

## Paso 3 — Agregar las llamadas a la API y construir los datos

Después de donde se construyen los `breakdownsTop` y antes de armar el array `datasets`,
agregar la colección de ad sets y ads (solo si los flags están activos).

### 3a — Fetch de ad sets con insights

```js
let adSetsData = [];
if (buildAdSets) {
  try {
    // 1. Fetch lista de ad sets
    const adSetsList = await pageAll(`https://graph.facebook.com/${API_VER}/act_${actId}/adsets?fields=id,name,campaign_id,status,effective_status,bid_strategy,bid_amount,daily_budget,lifetime_budget,optimization_goal&limit=500&access_token=${encodeURIComponent(token)}`);

    // 2. Fetch insights last 7d a nivel adset
    const insights7Url = `https://graph.facebook.com/${API_VER}/act_${actId}/insights?fields=adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,frequency,reach,actions,action_values&level=adset&date_preset=last_7d&limit=500&access_token=${encodeURIComponent(token)}`;
    const insights7 = await pageAllInsights(insights7Url);

    // 3. Fetch insights last 30d a nivel adset
    const insights30Url = insights7Url.replace('last_7d', 'last_30d');
    const insights30 = await pageAllInsights(insights30Url);

    // 4. Merge: ad set info + insights
    const insightsMap7 = new Map(insights7.map(r => [r.adset_id, r]));
    const insightsMap30 = new Map(insights30.map(r => [r.adset_id, r]));

    adSetsData = adSetsList.map(adSet => {
      const i7 = insightsMap7.get(adSet.id) || {};
      const i30 = insightsMap30.get(adSet.id) || {};
      const spend7 = toNum(i7.spend);
      const conversions7 = extractActionValue(i7.actions, 'purchase') || extractActionValue(i7.actions, 'offsite_conversion.fb_pixel_purchase');
      const spend30 = toNum(i30.spend);
      const conversions30 = extractActionValue(i30.actions, 'purchase') || extractActionValue(i30.actions, 'offsite_conversion.fb_pixel_purchase');

      return {
        ad_set_id: adSet.id,
        ad_set_name: adSet.name,
        campaign_id: adSet.campaign_id,
        status: adSet.effective_status || adSet.status,
        bid_strategy: adSet.bid_strategy || null,
        bid_amount: adSet.bid_amount ? minorToUnit(adSet.bid_amount) : null,
        daily_budget: adSet.daily_budget ? minorToUnit(adSet.daily_budget) : null,
        optimization_goal: adSet.optimization_goal || null,
        last_7: {
          spend: round2(spend7),
          impressions: toNum(i7.impressions),
          clicks: toNum(i7.clicks),
          ctr: toNum(i7.ctr),
          cpc: toNum(i7.cpc),
          reach: toNum(i7.reach),
          frequency: toNum(i7.frequency),
          conversions: conversions7,
        },
        last_30: {
          spend: round2(spend30),
          impressions: toNum(i30.impressions),
          clicks: toNum(i30.clicks),
          ctr: toNum(i30.ctr),
          cpc: toNum(i30.cpc),
          frequency: toNum(i30.frequency),
          conversions: conversions30,
        },
        cpa_7d: spend7 > 0 && conversions7 > 0 ? round2(spend7 / conversions7) : null,
        cpa_30d: spend30 > 0 && conversions30 > 0 ? round2(spend30 / conversions30) : null,
        frequency_warning: toNum(i7.frequency) > 3.5,
      };
    });
  } catch (e) {
    logCollectorError('ad_sets_fetch_failed', e);
    adSetsData = [];
  }
}
```

**Nota:** Usa la función `extractActionValue` si ya existe en el archivo, o créala:
```js
function extractActionValue(actions, actionType) {
  if (!Array.isArray(actions)) return null;
  const match = actions.find(a => a.action_type === actionType);
  return match ? toNum(match.value) : null;
}
```
Si ya existe una función equivalente con otro nombre, úsala.

### 3b — Fetch de ads con insights

```js
let adsData = [];
if (buildAds) {
  try {
    // 1. Fetch lista de ads
    const adsList = await pageAll(`https://graph.facebook.com/${API_VER}/act_${actId}/ads?fields=id,name,adset_id,campaign_id,status,effective_status,creative{id,title,object_type}&limit=500&access_token=${encodeURIComponent(token)}`);

    // 2. Insights last 7d a nivel ad
    const adInsights7Url = `https://graph.facebook.com/${API_VER}/act_${actId}/insights?fields=ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,frequency,actions,action_values&level=ad&date_preset=last_7d&limit=500&access_token=${encodeURIComponent(token)}`;
    const adInsights7 = await pageAllInsights(adInsights7Url);

    // 3. Insights last 30d a nivel ad
    const adInsights30Url = adInsights7Url.replace('last_7d', 'last_30d');
    const adInsights30 = await pageAllInsights(adInsights30Url);

    const adInsightsMap7 = new Map(adInsights7.map(r => [r.ad_id, r]));
    const adInsightsMap30 = new Map(adInsights30.map(r => [r.ad_id, r]));

    // Calcular promedios de cuenta para flags relativos
    const allRoas7 = adInsights7
      .map(r => {
        const s = toNum(r.spend);
        const v = extractActionValue(r.action_values, 'purchase');
        return s > 0 && v != null ? v / s : null;
      })
      .filter(v => v != null);
    const accountAvgRoas7 = allRoas7.length > 0
      ? allRoas7.reduce((a, b) => a + b, 0) / allRoas7.length : null;

    const allCtr7 = adInsights7.map(r => toNum(r.ctr)).filter(v => v > 0);
    const accountAvgCtr7 = allCtr7.length > 0
      ? allCtr7.reduce((a, b) => a + b, 0) / allCtr7.length : null;

    adsData = adsList.map(ad => {
      const i7 = adInsightsMap7.get(ad.id) || {};
      const i30 = adInsightsMap30.get(ad.id) || {};
      const spend7 = toNum(i7.spend);
      const purchaseValue7 = extractActionValue(i7.action_values, 'purchase');
      const roas7 = spend7 > 0 && purchaseValue7 != null ? round2(purchaseValue7 / spend7) : null;
      const ctr7 = toNum(i7.ctr);
      const freq7 = toNum(i7.frequency);

      return {
        ad_id: ad.id,
        ad_name: ad.name,
        adset_id: ad.adset_id,
        campaign_id: ad.campaign_id,
        status: ad.effective_status || ad.status,
        creative_type: ad.creative?.object_type || null,
        headline: ad.creative?.title || null,
        last_7_spend: round2(spend7),
        last_7_impressions: toNum(i7.impressions),
        last_7_ctr: round2(ctr7),
        last_7_roas_platform: roas7,
        last_7_frequency: freq7 > 0 ? round2(freq7) : null,
        last_30_ctr: round2(toNum(i30.ctr)),
        last_30_roas_platform: (() => {
          const s30 = toNum(i30.spend);
          const v30 = extractActionValue(i30.action_values, 'purchase');
          return s30 > 0 && v30 != null ? round2(v30 / s30) : null;
        })(),
        ctr_vs_account_avg: accountAvgCtr7 && ctr7 > 0
          ? round2(ctr7 / accountAvgCtr7) : null,
        roas_vs_account_avg: accountAvgRoas7 && roas7 != null
          ? round2(roas7 / accountAvgRoas7) : null,
        fatigue_flag: freq7 > 3 && toNum(i30.ctr) > 0 && ctr7 < toNum(i30.ctr),
        top_performer_flag: roas7 != null && accountAvgRoas7 != null && spend7 >= 100
          ? roas7 >= accountAvgRoas7 * 1.2 : false,
      };
    });
  } catch (e) {
    logCollectorError('ads_fetch_failed', e);
    adsData = [];
  }
}
```

---

## Paso 4 — Agregar los datasets al array de retorno

Justo después del bloque `if (buildHistoricalDatasets)`, agregar:

```js
if (buildAdSets && adSetsData.length > 0) {
  datasets.push({
    source: 'metaAds',
    dataset: 'meta.ad_sets',
    range: contextRangeOut,
    stats: { rows: adSetsData.length, bytes: 0 },
    data: {
      meta: contextHeader,
      ad_sets: adSetsData,
    },
  });
}

if (buildAds && adsData.length > 0) {
  datasets.push({
    source: 'metaAds',
    dataset: 'meta.ads',
    range: contextRangeOut,
    stats: { rows: adsData.length, bytes: 0 },
    data: {
      meta: contextHeader,
      ads: adsData,
    },
  });
}
```

---

## Paso 5 — Actualizar el worker para incluir los nuevos granularity flags

**Archivo:** `backend/workers/mcpWorker.js`

Busca el array `granularity` que se pasa al collector de Meta (línea ~413).
Agrega `'ad_sets'` y `'ads'`:

```js
granularity: [
  'summary',
  'ranked_campaigns',
  'breakdown',
  'signals',
  'daily_ai',
  'history_daily_totals',
  'history_daily_campaigns',
  'ad_sets',   // <-- agregar
  'ads',       // <-- agregar
],
```

---

## Paso 6 — Implementar `buildStructuredAdSets()` y `buildStructuredAds()` en mcpContextBuilder

**Archivo:** `backend/services/mcpContextBuilder.js`

### 6a — buildStructuredAdSets (línea ~2418, actualmente stub)

Reemplazar el stub por:

```js
function buildStructuredAdSets({ metaPack }) {
  const raw = Array.isArray(metaPack?.adSetsDataset?.data?.ad_sets)
    ? metaPack.adSetsDataset.data.ad_sets
    : [];
  return raw.slice(0, 200);
}
```

Agregar `adSetsDataset` al objeto retornado por `buildMetaContext()` (junto a `dailyDataset` y `rankedDataset`):
```js
adSetsDataset: chunks.find((c) => c?.dataset === 'meta.ad_sets') || null,
```

Actualizar la llamada en `buildStructuredSignalSchema()` para pasar `metaPack`:
```js
const adSets = buildStructuredAdSets({ metaPack });
```

### 6b — buildStructuredAds (línea ~2422, actualmente stub)

```js
function buildStructuredAds({ metaPack }) {
  const raw = Array.isArray(metaPack?.adsDataset?.data?.ads)
    ? metaPack.adsDataset.data.ads
    : [];
  return raw.slice(0, 300);
}
```

Agregar `adsDataset` al objeto retornado por `buildMetaContext()`:
```js
adsDataset: chunks.find((c) => c?.dataset === 'meta.ads') || null,
```

Actualizar la llamada en `buildStructuredSignalSchema()`:
```js
const ads = buildStructuredAds({ metaPack });
```

---

## Paso 7 — Verificación

```bash
node --check backend/jobs/collect/metaCollector.js
node --check backend/services/mcpContextBuilder.js
node --check backend/workers/mcpWorker.js
```

Reporta:
1. Sintaxis OK en los 3 archivos
2. Nombre exacto de la función de paginación que usaste (`pageAll`, `pageAllInsights` u otra)
3. Si `extractActionValue` ya existía o la creaste nueva
4. Cualquier error o inconsistencia encontrada

NO hagas commit. NO hagas push.
