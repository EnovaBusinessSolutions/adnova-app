# Meta Creative Intelligence Module — Plan de Implementación v1

> **Fecha:** 2026-01-27  
> **Autor:** Copilot (Senior Full-Stack Engineer)  
> **Branch:** `feature/meta-creative-intelligence`  
> **Estado:** ✅ MVP IMPLEMENTADO (2026-01-27)  

---

## 🚀 Archivos Implementados

### Backend
- `backend/models/CreativeSnapshot.js` - Modelo MongoDB para snapshots de creativos
- `backend/services/creativeScoreEngine.js` - Motor de cálculo de scores (Value, Risk, Alignment)
- `backend/services/creativeRecommendationEngine.js` - Generador de recomendaciones
- `backend/routes/creativeIntelligence.js` - API endpoints
- `backend/index.js` - Ruta registrada: `/api/creative-intelligence`

### Frontend (Dashboard)
- `dashboard-src/.../src/hooks/useCreativeIntelligence.ts` - Hook para fetching de datos
- `dashboard-src/.../src/pages/CreativeIntelligence.tsx` - Página principal
- `dashboard-src/.../src/components/Sidebar.tsx` - Menu item con badge PRO
- `dashboard-src/.../src/App.tsx` - Ruta registrada: `/creative-intelligence`

---

## Decisiones de José (2026-01-27)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿Integración React o Vanilla JS? | **React** - Nuevo módulo con el nombre "Creative Intelligence" que debe ser una pestaña del menú de navegación izquierdo en el dashboard con una insignia de PRO |
| 2 | ¿Objetivo global o por campaña? | **Global por defecto**, con override opcional por creativo |
| 3 | Threshold mínimo de datos | **Aprobado** (1000 imp, 7 días) |
| 4 | Tracking de recomendaciones | **Sí** - Checkboxes para marcar implementadas |
| 5 | Ads Library API | **NO para MVP** - Solo API existente, Ads Library después |
| 6 | Estrategia de refresh | **Botón manual** - No carga automática constante |
| 7 | Restricciones de plan | **Ninguna** - Módulo completo para usuarios de pago |
| 8 | Integración con Audit.js | **Separado** - Modelo independiente |
| 9 | Market Signals | **Después del MVP** |
| 10 | Timeline | **MVP HOY** - Todo en < 4 semanas |

---

## Índice

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [MVP HOY - Alcance Reducido](#2-mvp-hoy---alcance-reducido)
3. [Alcance Funcional Completo (v1)](#3-alcance-funcional-completo-v1)
4. [Inventario de Componentes / Reutilización](#4-inventario-de-componentes--reutilización)
4. [Diseño de Datos](#4-diseño-de-datos)
5. [Diseño de Obtención de Datos](#5-diseño-de-obtención-de-datos)
6. [Definición del Creative Score v1](#6-definición-del-creative-score-v1)
7. [Sistema de Recomendaciones v1](#7-sistema-de-recomendaciones-v1)
8. [UI/UX Dashboard](#8-uiux-dashboard)
9. [Seguridad y Compliance](#9-seguridad-y-compliance)
10. [Plan de Implementación por Etapas](#10-plan-de-implementación-por-etapas)
11. [Testing Mínimo](#11-testing-mínimo)
12. [Riesgos y Mitigaciones](#12-riesgos-y-mitigaciones)
13. [Preguntas para José (Bloqueantes)](#13-preguntas-para-josé-bloqueantes)

---

## 1. Resumen Ejecutivo

El **Meta Creative Intelligence Module** es un motor de decisión para creativos de Meta Ads que analiza datos reales del anunciante y señales de mercado (Meta Ads Library) para generar un **Creative Score (0-100)** por creativo, junto con recomendaciones accionables priorizadas.

**No es:**
- Un sistema de reporting genérico
- Un generador de anuncios
- Un gestor de budgets/bids

**Sí es:**
- Un sistema de decisión que indica qué creativos proteger, optimizar, preparar reemplazo o reemplazar
- UX "zero-config": sin uploads, sin inputs complejos, sin tagging manual

---

## 2. MVP HOY - Alcance Reducido

> ⚡ **Fecha límite: 2026-01-27 (HOY)**

### 2.1 Qué INCLUYE el MVP

| Componente | Descripción |
|------------|-------------|
| **Backend API completo** | Endpoints para listar creativos con scores y recomendaciones |
| **Modelo CreativeSnapshot** | Persistencia de datos de creativos |
| **Score Engine v1** | Cálculo de Creative Score (Value + Risk, SIN Alignment) |
| **Recomendaciones v1** | Reglas básicas de recomendación |
| **Tracking de recomendaciones** | Checkboxes para marcar como implementadas |
| **Refresh manual** | Endpoint para forzar recálculo |

### 2.2 Qué NO INCLUYE el MVP (Post-MVP)

- ❌ Integración con Ads Library API (Alignment Score = neutral)
- ❌ UI React (se documenta estructura para integración)
- ❌ Historial de scores (solo snapshot actual)
- ❌ Comparación antes/después

### 2.3 Endpoints MVP

```
GET  /api/meta/creative-intelligence          → Lista creativos + scores
GET  /api/meta/creative-intelligence/:adId    → Detalle de un creativo
GET  /api/meta/creative-intelligence/summary  → KPIs agregados
POST /api/meta/creative-intelligence/refresh  → Fuerza recálculo
POST /api/meta/creative-intelligence/:adId/objective   → Override objetivo
PATCH /api/meta/creative-intelligence/recommendations/:id → Marcar recomendación
```

### 2.4 Estructura de Respuesta (para React)

```typescript
// GET /api/meta/creative-intelligence
interface CreativeIntelligenceResponse {
  ok: boolean;
  creatives: Creative[];
  summary: Summary;
  globalObjective: 'ventas' | 'leads' | 'awareness';
  lastRefresh: string; // ISO date
}

interface Creative {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  
  // Assets
  creative: {
    type: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
    thumbnailUrl: string | null;
    title: string;
    body: string;
    callToAction: string;
  };
  
  // Status
  effectiveStatus: string;
  
  // Metrics (30d)
  metrics: {
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    frequency: number;
    purchases: number;
    purchaseValue: number; // revenue
    roas: number;
    cpa: number;
    revenueShare: number; // % del total
  };
  
  // Score
  score: {
    total: number; // 0-100
    valueScore: number;
    riskScore: number;
    alignmentScore: number; // 50 para MVP (neutral)
    classification: 'PROTECT' | 'OPTIMIZE' | 'PREPARE_REPLACE' | 'REPLACE';
  };
  
  // Objective (global o override)
  objective: 'ventas' | 'leads' | 'awareness';
  objectiveOverride: boolean; // true si es custom
  
  // Recomendaciones
  recommendations: Recommendation[];
}

interface Recommendation {
  id: string;
  type: string;
  title: string;
  whatToDo: string;
  why: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  expectedScoreImpact: number | null;
  implemented: boolean;
  implementedAt: string | null;
}

interface Summary {
  totalCreatives: number;
  protectedRevenue: number;
  atRiskRevenue: number;
  avgScore: number;
  byClassification: {
    PROTECT: number;
    OPTIMIZE: number;
    PREPARE_REPLACE: number;
    REPLACE: number;
  };
}
```

---

## 3. Alcance Funcional Completo (v1)

### 2.1 Pantallas / Vistas

| Vista | Descripción |
|-------|-------------|
| **Creative Intelligence Dashboard** | Dashboard principal con vista de todos los creativos analizados, ordenados por Score o por estado |
| **Creative Detail Modal/Page** | Detalle de un creativo específico: métricas, sub-scores, recomendaciones, comparación con mercado |
| **Objetivo Selector** | Selector de objetivo (ventas/leads/awareness) que ajusta pesos del Score - Integrar con el existente en onboarding |
| **Loading / Empty / Error States** | Estados para: cargando análisis, sin datos, sin permisos, error de API |

### 2.2 Endpoints / Servicios Backend

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `GET /api/meta/creative-intelligence` | GET | Retorna lista de creativos con Score y estado |
| `GET /api/meta/creative-intelligence/:adId` | GET | Detalle completo de un creativo |
| `GET /api/meta/creative-intelligence/summary` | GET | KPIs agregados (revenue at risk, protected, etc.) |
| `POST /api/meta/creative-intelligence/refresh` | POST | Fuerza re-cálculo del Score (con rate limit) |
| `GET /api/meta/market-signals` | GET | Señales de mercado (Ads Library) |

### 2.3 Cálculos Core

1. **Creative Score** (0-100) por cada ad creative
2. **Sub-scores**: Valor, Riesgo, Alineación Mercado
3. **Revenue Attribution**: % de revenue por creativo
4. **Fatigue Detection**: detección de fatiga por frecuencia/tiempo
5. **Market Alignment**: comparación con patrones del sector

---

## 3. Inventario de Componentes / Reutilización

### 3.1 Archivos Backend Existentes a Reutilizar

| Archivo | Uso Actual | Reutilización |
|---------|------------|---------------|
| `backend/routes/meta.js` | OAuth Meta, login, callback, disconnect | ✅ Usar tal cual - autenticación ya funciona |
| `backend/routes/metaInsights.js` | Insights API (KPIs, comparaciones) | ✅ Reutilizar `fetchInsights()`, helpers de métricas |
| `backend/routes/metaAccounts.js` | Listado/selección de cuentas | ✅ Reutilizar selección de cuentas |
| `backend/routes/metaTable.js` | Tabla de campañas/adsets/ads | ✅ Reutilizar `fetchAllInsights()`, `fetchEntitiesWithStatus()` |
| `backend/models/MetaAccount.js` | Modelo de cuenta Meta | ✅ Usar para tokens y cuentas |
| `backend/models/User.js` | Usuario con objetivos | ✅ Usar `metaObjective` |
| `backend/models/Audit.js` | Auditorías con issues | ⚠️ Modelo de referencia para issues/recommendations |
| `backend/jobs/collect/metaCollector.js` | Collector de datos Meta | ✅ Reutilizar helpers, normalización, paginación |
| `backend/jobs/metaAuditJob.js` | Job de auditoría Meta | ⚠️ Patrón de referencia para heurísticas |

### 3.2 Helpers Existentes Críticos

```javascript
// De metaCollector.js - REUTILIZAR
- fetchJSON(url, { retries }) // fetch con retry + backoff
- pageAllInsights(baseUrl)    // paginación automática
- extractPurchaseMetrics(x)   // purchases + purchase_value sin doble conteo
- pickClicks(x)               // normaliza clicks (link vs all)
- normalizeMetaObjective(raw) // SALES/LEADS/TRAFFIC/AWARENESS/etc
- getStrictLast30dRangeForTZ(tz, includeToday) // rangos timezone-aware

// De metaInsights.js - REUTILIZAR
- computeCompareRangesTZ()    // cálculo de períodos comparativos
- kpisVentas(), kpisAlcance(), kpisLeads() // normalización KPIs por objetivo
- PURCHASE_COUNT_PRIORITIES, PURCHASE_VALUE_PRIORITIES // prioridades de action_type
```

### 3.3 Frontend Existente

| Archivo | Uso | Reutilización |
|---------|-----|---------------|
| `public/onboarding.js` | Flujo onboarding vanilla JS | ✅ Patrón de fetch, interacción, estados |
| `public/onboarding.css` | Estilos onboarding | ✅ Variables CSS, cards, botones |
| `public/theme.css` | Tokens de marca Adray | ✅ Usar `--ad-*` variables |
| `public/dashboard/` | Dashboard React (lovable) | ⚠️ El módulo será Vanilla JS separado |

### 3.4 Constantes Existentes Relevantes

```javascript
// Versión de API
const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

// Scopes requeridos
const SCOPES = ['ads_read', 'ads_management', 'business_management', ...];

// Límites
const MAX_ACCOUNTS = 3; // máximo cuentas a procesar
const HARD_LIMIT = 3;   // límite duro por tipo
```

---

## 4. Diseño de Datos

### 4.1 Entidades Propuestas

#### 4.1.1 `CreativeSnapshot` (nueva colección)

```javascript
// backend/models/CreativeSnapshot.js
const CreativeSnapshotSchema = new Schema({
  // Referencias
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  adAccountId: { type: String, required: true, index: true },
  
  // Identificadores Meta
  adId: { type: String, required: true, index: true },
  adName: { type: String },
  adsetId: { type: String, index: true },
  adsetName: { type: String },
  campaignId: { type: String, index: true },
  campaignName: { type: String },
  
  // Objetivo de la campaña (normalizado)
  objective: { type: String, enum: ['SALES', 'LEADS', 'TRAFFIC', 'AWARENESS', 'ENGAGEMENT', 'OTHER'] },
  
  // Status
  effectiveStatus: { type: String }, // ACTIVE, PAUSED, DELETED, etc
  
  // Assets del creativo (para comparar con mercado)
  creative: {
    type: { type: String }, // IMAGE, VIDEO, CAROUSEL, COLLECTION
    thumbnailUrl: { type: String },
    title: { type: String },
    body: { type: String },
    callToAction: { type: String }, // SHOP_NOW, LEARN_MORE, etc
    linkUrl: { type: String },
    
    // Video específico
    videoDuration: { type: Number }, // segundos
    
    // Aspect ratio inferido
    aspectRatio: { type: String }, // 1:1, 4:5, 9:16, 16:9
  },
  
  // Métricas del período (últimos 7/14/30 días)
  metrics: {
    period: { since: String, until: String, days: Number },
    
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    frequency: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    cpc: { type: Number, default: 0 },
    cpm: { type: Number, default: 0 },
    
    // Conversiones
    purchases: { type: Number, default: 0 },
    purchaseValue: { type: Number, default: 0 }, // revenue
    leads: { type: Number, default: 0 },
    
    // Calculados
    roas: { type: Number, default: 0 },
    cpa: { type: Number, default: 0 }, // cost per acquisition
    cpl: { type: Number, default: 0 }, // cost per lead
    
    // Contribución
    revenueShare: { type: Number, default: 0 }, // % del revenue total
    spendShare: { type: Number, default: 0 },   // % del spend total
  },
  
  // Time series para detectar tendencias (últimos 14 días por día)
  timeSeries: [{
    date: { type: String }, // YYYY-MM-DD
    spend: Number,
    impressions: Number,
    clicks: Number,
    frequency: Number,
    purchases: Number,
    purchaseValue: Number,
  }],
  
  // Creative Score calculado
  score: {
    total: { type: Number, min: 0, max: 100 },
    
    // Sub-scores
    valueScore: { type: Number, min: 0, max: 100 },      // contribución actual
    riskScore: { type: Number, min: 0, max: 100 },       // 100 = bajo riesgo
    alignmentScore: { type: Number, min: 0, max: 100 },  // vs mercado
    
    // Clasificación derivada
    classification: { 
      type: String, 
      enum: ['PROTECT', 'OPTIMIZE', 'PREPARE_REPLACE', 'REPLACE'] 
    },
    
    calculatedAt: { type: Date, default: Date.now },
  },
  
  // Historial de scores (para validación antes/después)
  scoreHistory: [{
    date: { type: Date },
    total: Number,
    valueScore: Number,
    riskScore: Number,
    alignmentScore: Number,
  }],
  
  // Metadata
  snapshotAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'creativesnapshots' });

// Índices compuestos
CreativeSnapshotSchema.index({ userId: 1, adAccountId: 1, adId: 1 }, { unique: true });
CreativeSnapshotSchema.index({ userId: 1, 'score.total': -1 });
CreativeSnapshotSchema.index({ userId: 1, 'score.classification': 1 });
```

#### 4.1.2 `MarketSignal` (nueva colección)

```javascript
// backend/models/MarketSignal.js
const MarketSignalSchema = new Schema({
  // Scope
  industry: { type: String, index: true }, // ecommerce, lead_gen, etc (inferido)
  country: { type: String, index: true },  // MX, US, ES
  
  // Agregaciones del Ads Library
  signals: {
    // Formatos más usados
    topFormats: [{
      format: String, // IMAGE, VIDEO, CAROUSEL
      percentage: Number,
    }],
    
    // CTAs más usados
    topCTAs: [{
      cta: String, // SHOP_NOW, LEARN_MORE
      percentage: Number,
    }],
    
    // Aspect ratios dominantes
    topAspectRatios: [{
      ratio: String,
      percentage: Number,
    }],
    
    // Duración promedio de videos activos
    avgVideoDuration: { type: Number }, // segundos
    
    // Tiempo activo promedio de creativos
    avgActiveTime: { type: Number }, // días
    
    // Patrones de copy
    avgTitleLength: Number,
    avgBodyLength: Number,
    
    // Sample size
    sampleSize: { type: Number, default: 0 },
  },
  
  // Ventana de análisis
  periodStart: { type: Date },
  periodEnd: { type: Date },
  
  collectedAt: { type: Date, default: Date.now, index: true },
}, { collection: 'marketsignals' });

MarketSignalSchema.index({ industry: 1, country: 1, collectedAt: -1 });
```

#### 4.1.3 `CreativeRecommendation` (embebido o separado)

```javascript
// Embebido en CreativeSnapshot o separado
const RecommendationSchema = new Schema({
  // Referencia
  userId: { type: ObjectId, ref: 'User', index: true },
  adId: { type: String, index: true },
  
  // Tipo de recomendación
  type: {
    type: String,
    enum: [
      'PROTECT',           // Escalar con cuidado
      'ITERATE_HOOK',      // Cambiar hook/primeros 3s
      'ITERATE_CTA',       // Probar otro CTA
      'CHANGE_FORMAT',     // Cambiar formato (ej: imagen → video)
      'REDUCE_FREQUENCY',  // Bajar frecuencia
      'PREPARE_VARIANT',   // Crear variante antes de fatiga
      'REPLACE_URGENT',    // Reemplazar urgente
    ],
  },
  
  // Contenido
  title: { type: String, required: true },
  whatToDo: { type: String, required: true },      // Qué hacer
  whatToChange: { type: String },                   // Qué cambiar/lanzar específicamente
  why: { type: String, required: true },            // Por qué (data-driven)
  
  // Urgencia
  urgency: { 
    type: String, 
    enum: ['critical', 'high', 'medium', 'low'],
    required: true 
  },
  
  // Impacto esperado
  expectedScoreImpact: { type: Number }, // +10 puntos, -5 puntos, etc
  expectedRevenueImpact: { type: String }, // "Protege ~$X revenue"
  
  // Estado
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'implemented', 'dismissed'],
    default: 'pending',
  },
  
  // Tracking
  createdAt: { type: Date, default: Date.now },
  implementedAt: { type: Date },
  dismissedAt: { type: Date },
  dismissReason: { type: String },
}, { _id: true });
```

### 4.2 Estrategia de Almacenamiento

| Dato | Estrategia | Justificación |
|------|------------|---------------|
| **CreativeSnapshot** | Persistir en MongoDB | Permite historial de scores, comparación antes/después, no re-calcular en cada request |
| **Métricas raw** | On-the-fly + caché 15min | Datos de Meta API cambian frecuentemente, caché corto |
| **MarketSignal** | Persistir, actualizar 1x/día | Ads Library no cambia en tiempo real, costoso de consultar |
| **Score** | Persistir + recalcular en refresh | Fórmula puede optimizarse, historial valioso |
| **Recomendaciones** | Embebidas en Snapshot | Siempre ligadas a un creativo específico |

### 4.3 TTL y Limpieza

```javascript
// Mantener snapshots de últimos 90 días
CreativeSnapshotSchema.index({ snapshotAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

// Market signals de últimos 30 días
MarketSignalSchema.index({ collectedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
```

---

## 5. Diseño de Obtención de Datos

### 5.1 Datos del Usuario (Meta Insights API)

#### 5.1.1 Listar Creativos del Usuario

**Endpoint Meta:** `GET /{ad_account_id}/ads`

```javascript
// Campos necesarios
const AD_FIELDS = [
  'id',
  'name',
  'status',
  'effective_status',
  'adset_id',
  'campaign_id',
  'creative{
    id,
    name,
    title,
    body,
    call_to_action_type,
    object_type,
    thumbnail_url,
    video_id,
    image_url,
    link_url
  }',
].join(',');

// URL
`${FB_GRAPH}/act_${accountId}/ads?fields=${AD_FIELDS}&limit=500&access_token=${token}`
```

#### 5.1.2 Métricas por Creativo (nivel=ad)

**Endpoint Meta:** `GET /{ad_account_id}/insights`

```javascript
const INSIGHT_FIELDS = [
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'objective',
  'date_start',
  'date_stop',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'inline_link_clicks',
  'ctr',
  'cpc',
  'cpm',
  'actions',
  'action_values',
  'purchase_roas',
].join(',');

// Para time series (últimos 14 días)
const timeSeriesParams = {
  level: 'ad',
  time_increment: 1, // día por día
  time_range: JSON.stringify({ since: '2026-01-13', until: '2026-01-27' }),
  fields: INSIGHT_FIELDS,
};

// Para agregado (últimos 30 días)
const aggregateParams = {
  level: 'ad',
  time_increment: 'all_days',
  date_preset: 'last_30d',
  fields: INSIGHT_FIELDS,
};
```

#### 5.1.3 Métricas de Frecuencia Históricas

Para detectar fatiga necesitamos frecuencia por día:

```javascript
const FREQUENCY_FIELDS = ['ad_id', 'date_start', 'frequency', 'reach', 'impressions'];

// 14 días para detectar tendencia
const frequencyParams = {
  level: 'ad',
  time_increment: 1,
  date_preset: 'last_14d',
  fields: FREQUENCY_FIELDS.join(','),
};
```

### 5.2 Señales de Mercado (Meta Ads Library API)

#### 5.2.1 Endpoint y Limitaciones

**Endpoint:** `GET /ads_archive`

```javascript
const ADS_LIBRARY_FIELDS = [
  'id',
  'ad_creative_bodies',
  'ad_creative_link_captions',
  'ad_creative_link_descriptions',
  'ad_creative_link_titles',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'languages',
  'page_name',
  'publisher_platforms',  // facebook, instagram, messenger, audience_network
  'bylines',
  // 'ad_snapshot_url', // para obtener más detalles del creativo
].join(',');

// Búsqueda por categoría/industria
const params = {
  ad_reached_countries: ['MX'],
  ad_type: 'ALL',
  ad_active_status: 'ACTIVE',
  search_terms: '', // o keywords del sector
  fields: ADS_LIBRARY_FIELDS,
  limit: 500,
  access_token: token,
};
```

**Limitaciones conocidas:**
- Rate limit: ~200 requests/hora por token
- No expone métricas de performance (solo creativos activos)
- Requiere `ads_read` scope
- Algunos campos no disponibles para todos los países

#### 5.2.2 Normalización de Señales

```javascript
function normalizeLibraryAd(rawAd) {
  return {
    // Formato (inferido)
    format: inferFormat(rawAd), // IMAGE, VIDEO, CAROUSEL
    
    // CTA (de link caption)
    cta: extractCTA(rawAd.ad_creative_link_captions),
    
    // Plataformas
    platforms: rawAd.publisher_platforms || [],
    
    // Idioma
    language: rawAd.languages?.[0] || null,
    
    // Tiempo activo (días desde ad_delivery_start_time)
    activeTimeDays: calculateActiveTime(rawAd.ad_delivery_start_time),
    
    // Copy length
    titleLength: rawAd.ad_creative_link_titles?.[0]?.length || 0,
    bodyLength: rawAd.ad_creative_bodies?.[0]?.length || 0,
  };
}

function inferFormat(ad) {
  // Heurística basada en campos disponibles
  const bodies = ad.ad_creative_bodies || [];
  const titles = ad.ad_creative_link_titles || [];
  
  // Carousel típicamente tiene múltiples títulos
  if (titles.length > 1) return 'CAROUSEL';
  
  // Video detection requiere ad_snapshot_url parsing
  // Por ahora asumimos imagen si hay un solo título
  return 'IMAGE';
}
```

### 5.3 Manejo de Paginación, Rate Limits, Retries

#### 5.3.1 Paginación (Reutilizar `pageAllInsights`)

```javascript
// Ya existe en metaCollector.js
async function pageAllInsights(baseUrl) {
  const out = [];
  let next = baseUrl;
  let guard = 0;
  
  while (next && guard < 20) {
    guard += 1;
    const j = await fetchJSON(next, { retries: 1 });
    const data = Array.isArray(j?.data) ? j.data : [];
    out.push(...data);
    next = j?.paging?.next || null;
  }
  return out;
}
```

#### 5.3.2 Rate Limits y Backoff

```javascript
// Reutilizar fetchJSON de metaCollector.js con mejoras
async function fetchJSON(url, { retries = 2, baseDelay = 800 } = {}) {
  let lastErr = null;
  
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { timeout: 30000 });
      const j = await r.json().catch(() => ({}));
      
      if (!r.ok) {
        const code = j?.error?.code || r.status;
        const isRateLimit = code === 4 || code === 17 || code === 32;
        const isServerError = String(code).startsWith('5');
        
        if ((isRateLimit || isServerError) && i < retries) {
          // Exponential backoff con jitter
          const delay = baseDelay * Math.pow(2, i) + Math.random() * 200;
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        
        throw new Error(j?.error?.message || `HTTP_${r.status}`);
      }
      return j;
    } catch (e) {
      lastErr = e;
      if (i === retries) throw e;
    }
  }
  throw lastErr;
}
```

#### 5.3.3 Timeouts

```javascript
const TIMEOUTS = {
  insights: 30000,      // 30s para insights (pueden ser pesados)
  adsLibrary: 15000,    // 15s para Ads Library
  adsList: 20000,       // 20s para lista de ads
  metadata: 10000,      // 10s para metadata de cuenta
};
```

### 5.4 Estrategia de Caché

```javascript
// Usar node-cache o similar (ya no agregamos Redis como dependencia nueva)
const NodeCache = require('node-cache'); // Ya existe en el proyecto?

const cache = new NodeCache({
  stdTTL: 900,        // 15 minutos default
  checkperiod: 120,   // Check cada 2 min
  useClones: false,
});

const CACHE_TTL = {
  insights_aggregate: 900,    // 15 min (datos agregados)
  insights_timeseries: 900,   // 15 min (time series)
  ads_list: 1800,             // 30 min (lista de ads cambia menos)
  market_signals: 86400,      // 24h (señales de mercado)
  creative_score: 900,        // 15 min (score calculado)
};

function cacheKey(userId, type, params = {}) {
  return `ci:${userId}:${type}:${JSON.stringify(params)}`;
}
```

### 5.5 Ventanas de Tiempo

| Dato | Ventana | Justificación |
|------|---------|---------------|
| **Score total** | Últimos 30 días | Balance entre estabilidad y reactividad |
| **Detección fatiga** | Últimos 14 días (día x día) | Detectar tendencias recientes |
| **Comparación período anterior** | 30d vs 30d previos | Consistente con dashboard existente |
| **Market signals** | Últimos 30 días de Ads Library | Snapshot representativo del mercado |

---

## 6. Definición del Creative Score v1

### 6.1 Fórmula General

```
Creative Score = (W_value × Value Score) + (W_risk × Risk Score) + (W_alignment × Alignment Score)
```

Donde los pesos `W_*` varían según el objetivo del usuario:

| Objetivo | W_value | W_risk | W_alignment |
|----------|---------|--------|-------------|
| **Ventas** | 0.50 | 0.35 | 0.15 |
| **Leads** | 0.45 | 0.35 | 0.20 |
| **Awareness** | 0.30 | 0.30 | 0.40 |

### 6.2 Sub-Score: Value Score (Contribución Actual)

Mide cuánto valor genera el creativo actualmente.

#### Para objetivo VENTAS:

```javascript
function calculateValueScore_Sales(creative, accountTotals) {
  // Métricas relevantes
  const revenueShare = creative.metrics.purchaseValue / accountTotals.totalRevenue;
  const roas = creative.metrics.roas;
  const purchases = creative.metrics.purchases;
  
  // Normalización (percentiles dentro del account)
  const revenueSharePct = percentileRank(revenueShare, accountDistributions.revenueShare);
  const roasPct = percentileRank(roas, accountDistributions.roas);
  const purchasesPct = percentileRank(purchases, accountDistributions.purchases);
  
  // Ponderación interna
  const valueScore = (
    0.45 * revenueSharePct +  // Contribución al revenue es lo más importante
    0.35 * roasPct +          // Eficiencia
    0.20 * purchasesPct       // Volumen absoluto
  ) * 100;
  
  return Math.min(100, Math.max(0, valueScore));
}
```

#### Para objetivo LEADS:

```javascript
function calculateValueScore_Leads(creative, accountTotals) {
  const leadsShare = creative.metrics.leads / accountTotals.totalLeads;
  const cpl = creative.metrics.cpl;
  const cvr = creative.metrics.leads / creative.metrics.clicks;
  
  // Invertir CPL (menor es mejor)
  const cplScore = 1 - percentileRank(cpl, accountDistributions.cpl);
  
  const valueScore = (
    0.45 * percentileRank(leadsShare, accountDistributions.leadsShare) +
    0.35 * cplScore +
    0.20 * percentileRank(cvr, accountDistributions.cvr)
  ) * 100;
  
  return clamp(valueScore, 0, 100);
}
```

#### Para objetivo AWARENESS:

```javascript
function calculateValueScore_Awareness(creative, accountTotals) {
  const reachShare = creative.metrics.reach / accountTotals.totalReach;
  const cpm = creative.metrics.cpm;
  const ctr = creative.metrics.ctr;
  
  // Invertir CPM
  const cpmScore = 1 - percentileRank(cpm, accountDistributions.cpm);
  
  const valueScore = (
    0.40 * percentileRank(reachShare, accountDistributions.reachShare) +
    0.30 * cpmScore +
    0.30 * percentileRank(ctr, accountDistributions.ctr)
  ) * 100;
  
  return clamp(valueScore, 0, 100);
}
```

### 6.3 Sub-Score: Risk Score (100 = bajo riesgo)

Mide el riesgo de que el creativo deje de funcionar.

```javascript
function calculateRiskScore(creative, accountTotals) {
  // 1. Fatiga por frecuencia
  const frequency = creative.metrics.frequency;
  const frequencyRisk = calculateFrequencyRisk(frequency);
  
  // 2. Tendencia de deterioro (últimos 14 días)
  const trendRisk = calculateTrendRisk(creative.timeSeries);
  
  // 3. Dependencia de revenue (concentración)
  const revenueConcentration = creative.metrics.revenueShare;
  const concentrationRisk = revenueConcentration > 0.3 ? (revenueConcentration - 0.3) * 2 : 0;
  
  // 4. Tiempo activo (creativos muy viejos tienden a fatigar)
  const ageRisk = calculateAgeRisk(creative.activeTimeDays);
  
  // Combinar (invertir para que 100 = bajo riesgo)
  const totalRisk = (
    0.35 * frequencyRisk +
    0.30 * trendRisk +
    0.20 * concentrationRisk +
    0.15 * ageRisk
  );
  
  return clamp(100 - (totalRisk * 100), 0, 100);
}

function calculateFrequencyRisk(frequency) {
  // Umbral de fatiga típico: 3-4
  if (frequency < 2) return 0;
  if (frequency < 3) return 0.2;
  if (frequency < 4) return 0.5;
  if (frequency < 5) return 0.7;
  return 1.0;
}

function calculateTrendRisk(timeSeries) {
  if (!timeSeries || timeSeries.length < 7) return 0;
  
  // Comparar última semana vs semana anterior
  const lastWeek = timeSeries.slice(-7);
  const prevWeek = timeSeries.slice(-14, -7);
  
  const lastWeekCTR = avg(lastWeek.map(d => d.clicks / d.impressions));
  const prevWeekCTR = avg(prevWeek.map(d => d.clicks / d.impressions));
  
  if (prevWeekCTR === 0) return 0;
  
  const ctrChange = (lastWeekCTR - prevWeekCTR) / prevWeekCTR;
  
  // Si CTR cayó más de 20%, alto riesgo
  if (ctrChange < -0.30) return 1.0;
  if (ctrChange < -0.20) return 0.7;
  if (ctrChange < -0.10) return 0.4;
  return 0;
}

function calculateAgeRisk(activeTimeDays) {
  // Creativos de más de 60 días tienen mayor riesgo
  if (activeTimeDays < 30) return 0;
  if (activeTimeDays < 60) return 0.2;
  if (activeTimeDays < 90) return 0.5;
  return 0.8;
}
```

### 6.4 Sub-Score: Alignment Score (vs Mercado)

Mide qué tan alineado está el creativo con los patrones del mercado.

```javascript
function calculateAlignmentScore(creative, marketSignals) {
  if (!marketSignals) return 50; // Sin data, neutral
  
  // 1. Formato (coincide con top formatos del mercado?)
  const formatMatch = marketSignals.topFormats
    .findIndex(f => f.format === creative.creative.type);
  const formatScore = formatMatch === 0 ? 100 : formatMatch === 1 ? 70 : formatMatch >= 0 ? 40 : 20;
  
  // 2. CTA (coincide con CTAs efectivos del mercado?)
  const ctaMatch = marketSignals.topCTAs
    .findIndex(c => c.cta === creative.creative.callToAction);
  const ctaScore = ctaMatch === 0 ? 100 : ctaMatch === 1 ? 70 : ctaMatch >= 0 ? 40 : 30;
  
  // 3. Aspect Ratio
  const ratioMatch = marketSignals.topAspectRatios
    .findIndex(r => r.ratio === creative.creative.aspectRatio);
  const ratioScore = ratioMatch >= 0 && ratioMatch < 2 ? 100 : ratioMatch >= 0 ? 60 : 30;
  
  // 4. Duración de video (si aplica)
  let durationScore = 70; // neutral para no-videos
  if (creative.creative.type === 'VIDEO' && marketSignals.avgVideoDuration) {
    const diff = Math.abs(creative.creative.videoDuration - marketSignals.avgVideoDuration);
    const tolerance = marketSignals.avgVideoDuration * 0.3; // 30% tolerance
    durationScore = diff < tolerance ? 100 : diff < tolerance * 2 ? 60 : 30;
  }
  
  return (
    0.30 * formatScore +
    0.30 * ctaScore +
    0.20 * ratioScore +
    0.20 * durationScore
  );
}
```

### 6.5 Clasificación Final

```javascript
function classifyCreative(totalScore) {
  if (totalScore >= 80) return 'PROTECT';        // 80-100: Proteger / escalar con cuidado
  if (totalScore >= 60) return 'OPTIMIZE';       // 60-79: Optimizar / monitorear
  if (totalScore >= 40) return 'PREPARE_REPLACE'; // 40-59: Preparar reemplazo
  return 'REPLACE';                              // 0-39: Reemplazar
}
```

### 6.6 Normalización: Percentiles con Winsorization

```javascript
function percentileRank(value, distribution) {
  if (!distribution || !distribution.length) return 0.5;
  
  // Winsorization: cap at 1st and 99th percentile to reduce outlier impact
  const sorted = [...distribution].sort((a, b) => a - b);
  const p1 = sorted[Math.floor(sorted.length * 0.01)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  
  const clampedValue = Math.min(p99, Math.max(p1, value));
  
  // Calculate percentile rank
  const below = sorted.filter(v => v < clampedValue).length;
  return below / sorted.length;
}
```

---

## 7. Sistema de Recomendaciones v1

### 7.1 Taxonomía de Recomendaciones

| Tipo | Trigger | Urgencia típica |
|------|---------|-----------------|
| `PROTECT` | Score ≥ 80, alta contribución | low |
| `ITERATE_HOOK` | Video con drop en 3s, CTR bajo | medium/high |
| `ITERATE_CTA` | CTA no alineado con mercado | medium |
| `CHANGE_FORMAT` | Formato no óptimo vs mercado | medium |
| `REDUCE_FREQUENCY` | Frecuencia > 4, CTR cayendo | high |
| `PREPARE_VARIANT` | Score 60-70, frecuencia 3+ | medium |
| `REPLACE_URGENT` | Score < 40, alta contribución | critical |

### 7.2 Reglas de Disparo

```javascript
function generateRecommendations(creative, marketSignals, accountTotals) {
  const recommendations = [];
  const score = creative.score;
  const metrics = creative.metrics;
  
  // REGLA 1: PROTECT (Score alto, dejar quieto)
  if (score.total >= 80 && metrics.revenueShare >= 0.1) {
    recommendations.push({
      type: 'PROTECT',
      title: 'Proteger creativo top performer',
      whatToDo: 'No modificar este creativo. Monitorear frecuencia.',
      whatToChange: null,
      why: `Contribuye ${(metrics.revenueShare * 100).toFixed(1)}% del revenue con ROAS ${metrics.roas.toFixed(2)}x`,
      urgency: 'low',
      expectedScoreImpact: 0,
      expectedRevenueImpact: `Protege $${metrics.purchaseValue.toFixed(0)} en revenue`,
    });
    return recommendations; // No más recomendaciones para protegidos
  }
  
  // REGLA 2: REPLACE URGENT (Score muy bajo pero con spend)
  if (score.total < 40 && metrics.spend > accountTotals.avgSpendPerAd) {
    recommendations.push({
      type: 'REPLACE_URGENT',
      title: 'Reemplazar creativo urgentemente',
      whatToDo: 'Pausar este creativo y lanzar variante nueva',
      whatToChange: 'Crear nuevo creativo con ángulo diferente basado en top performers',
      why: `Score ${score.total}/100 indica bajo rendimiento. Gastando sin retorno.`,
      urgency: 'critical',
      expectedScoreImpact: null, // N/A, se reemplaza
      expectedRevenueImpact: `Evita pérdida de ~$${(metrics.spend * 0.7).toFixed(0)} en próximos 7 días`,
    });
  }
  
  // REGLA 3: REDUCE FREQUENCY (Fatiga detectada)
  if (metrics.frequency >= 4 && score.riskScore < 50) {
    recommendations.push({
      type: 'REDUCE_FREQUENCY',
      title: 'Reducir frecuencia - fatiga detectada',
      whatToDo: 'Ampliar audiencia o limitar frecuencia en configuración de ad set',
      whatToChange: 'Agregar exclusiones de audiencia caliente o usar frequency cap',
      why: `Frecuencia ${metrics.frequency.toFixed(1)} con CTR cayendo ${calculateTrendPercentage(creative.timeSeries)}%`,
      urgency: 'high',
      expectedScoreImpact: +15,
      expectedRevenueImpact: 'Extiende vida útil del creativo ~2 semanas',
    });
  }
  
  // REGLA 4: CHANGE FORMAT (Desalineado con mercado)
  if (score.alignmentScore < 50 && marketSignals) {
    const topFormat = marketSignals.topFormats[0]?.format;
    if (topFormat && creative.creative.type !== topFormat) {
      recommendations.push({
        type: 'CHANGE_FORMAT',
        title: `Considerar cambio a formato ${topFormat}`,
        whatToDo: `El mercado favorece ${topFormat}. Crear variante en ese formato.`,
        whatToChange: `Adaptar el mensaje actual a formato ${topFormat}`,
        why: `Tu formato actual (${creative.creative.type}) solo representa ${findFormatShare(creative.creative.type, marketSignals)}% del mercado`,
        urgency: 'medium',
        expectedScoreImpact: +10,
      });
    }
  }
  
  // REGLA 5: ITERATE CTA
  if (marketSignals) {
    const topCTA = marketSignals.topCTAs[0]?.cta;
    if (topCTA && creative.creative.callToAction !== topCTA && score.alignmentScore < 60) {
      recommendations.push({
        type: 'ITERATE_CTA',
        title: `Probar CTA "${topCTA}"`,
        whatToDo: `Crear variante con CTA "${topCTA}" en lugar de "${creative.creative.callToAction}"`,
        whatToChange: 'Solo el CTA, mantener resto del creativo',
        why: `"${topCTA}" es el CTA #1 en tu sector (${marketSignals.topCTAs[0]?.percentage}% de ads activos)`,
        urgency: 'medium',
        expectedScoreImpact: +8,
      });
    }
  }
  
  // REGLA 6: PREPARE VARIANT (Score medio, frecuencia subiendo)
  if (score.total >= 60 && score.total < 75 && metrics.frequency >= 3) {
    recommendations.push({
      type: 'PREPARE_VARIANT',
      title: 'Preparar variante antes de fatiga',
      whatToDo: 'Crear variante con nuevo ángulo/hook mientras este aún funciona',
      whatToChange: 'Nuevo hook en primeros 3 segundos, mismo producto/oferta',
      why: `Score ${score.total} con frecuencia ${metrics.frequency.toFixed(1)} indica fatiga próxima`,
      urgency: 'medium',
      expectedScoreImpact: null, // Para el nuevo creativo
      expectedRevenueImpact: 'Previene caída de revenue cuando este creative se agote',
    });
  }
  
  return recommendations;
}
```

### 7.3 Formato de Salida y Prioridad

```javascript
function sortRecommendations(recommendations) {
  const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  
  return recommendations.sort((a, b) => {
    // Primero por urgencia
    if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) {
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    }
    // Luego por impacto esperado (mayor primero)
    return (b.expectedScoreImpact || 0) - (a.expectedScoreImpact || 0);
  });
}
```

---

## 8. UI/UX Dashboard

### 8.1 Estructura del Dashboard (Vanilla JS)

```
/dashboard/creative-intelligence/
├── index.html          # Vista principal
├── creative-detail.html # Detalle de creativo (o modal)
├── ci.js               # Lógica principal
├── ci.css              # Estilos específicos
└── components/
    ├── score-card.js   # Componente de tarjeta de score
    ├── recommendation-card.js
    └── trend-chart.js  # Mini gráfico de tendencia
```

### 8.2 Layout Principal

```html
<!-- dashboard/creative-intelligence/index.html -->
<div class="ci-container">
  <!-- Header con KPIs globales -->
  <header class="ci-header">
    <h1>Creative Intelligence</h1>
    <div class="ci-kpis">
      <div class="ci-kpi">
        <span class="ci-kpi-value" id="total-creatives">--</span>
        <span class="ci-kpi-label">Creativos analizados</span>
      </div>
      <div class="ci-kpi ci-kpi--success">
        <span class="ci-kpi-value" id="protected-revenue">$--</span>
        <span class="ci-kpi-label">Revenue protegido</span>
      </div>
      <div class="ci-kpi ci-kpi--warning">
        <span class="ci-kpi-value" id="at-risk-revenue">$--</span>
        <span class="ci-kpi-label">Revenue en riesgo</span>
      </div>
      <div class="ci-kpi">
        <span class="ci-kpi-value" id="avg-score">--</span>
        <span class="ci-kpi-label">Score promedio</span>
      </div>
    </div>
  </header>

  <!-- Tabs de clasificación -->
  <nav class="ci-tabs">
    <button class="ci-tab ci-tab--active" data-filter="all">
      Todos <span class="ci-tab-count">--</span>
    </button>
    <button class="ci-tab" data-filter="PROTECT">
      🛡️ Proteger <span class="ci-tab-count">--</span>
    </button>
    <button class="ci-tab" data-filter="OPTIMIZE">
      ⚡ Optimizar <span class="ci-tab-count">--</span>
    </button>
    <button class="ci-tab" data-filter="PREPARE_REPLACE">
      ⚠️ Preparar reemplazo <span class="ci-tab-count">--</span>
    </button>
    <button class="ci-tab" data-filter="REPLACE">
      🔴 Reemplazar <span class="ci-tab-count">--</span>
    </button>
  </nav>

  <!-- Grid de creativos -->
  <main class="ci-grid" id="creatives-grid">
    <!-- Se llena dinámicamente -->
  </main>

  <!-- Panel de recomendaciones urgentes (sidebar o drawer) -->
  <aside class="ci-recommendations" id="recommendations-panel">
    <h2>Recomendaciones urgentes</h2>
    <div id="urgent-recommendations">
      <!-- Se llena dinámicamente -->
    </div>
  </aside>
</div>
```

### 8.3 Card de Creativo

```javascript
// ci.js - Componente de tarjeta
function renderCreativeCard(creative) {
  const scoreClass = getScoreClass(creative.score.total);
  const classificationIcon = getClassificationIcon(creative.score.classification);
  
  return `
    <article class="ci-card ci-card--${scoreClass}" data-ad-id="${creative.adId}">
      <div class="ci-card-header">
        <div class="ci-card-thumb">
          ${creative.creative.thumbnailUrl 
            ? `<img src="${creative.creative.thumbnailUrl}" alt="${creative.adName}" />`
            : `<div class="ci-card-thumb-placeholder">${creative.creative.type}</div>`
          }
          <span class="ci-card-format">${creative.creative.type}</span>
        </div>
        <div class="ci-card-score">
          <span class="ci-score-value">${creative.score.total}</span>
          <span class="ci-score-label">Score</span>
        </div>
      </div>
      
      <div class="ci-card-body">
        <h3 class="ci-card-title">${escapeHtml(creative.adName)}</h3>
        <p class="ci-card-campaign">${escapeHtml(creative.campaignName)}</p>
        
        <div class="ci-card-metrics">
          <div class="ci-metric">
            <span class="ci-metric-value">$${formatNumber(creative.metrics.purchaseValue)}</span>
            <span class="ci-metric-label">Revenue</span>
          </div>
          <div class="ci-metric">
            <span class="ci-metric-value">${creative.metrics.roas.toFixed(2)}x</span>
            <span class="ci-metric-label">ROAS</span>
          </div>
          <div class="ci-metric">
            <span class="ci-metric-value">${creative.metrics.frequency.toFixed(1)}</span>
            <span class="ci-metric-label">Frecuencia</span>
          </div>
        </div>
        
        <div class="ci-card-subscores">
          <div class="ci-subscore" title="Valor actual">
            <div class="ci-subscore-bar" style="width: ${creative.score.valueScore}%"></div>
            <span>Valor</span>
          </div>
          <div class="ci-subscore" title="Riesgo (100=bajo)">
            <div class="ci-subscore-bar ci-subscore-bar--risk" style="width: ${creative.score.riskScore}%"></div>
            <span>Salud</span>
          </div>
          <div class="ci-subscore" title="Alineación mercado">
            <div class="ci-subscore-bar" style="width: ${creative.score.alignmentScore}%"></div>
            <span>Mercado</span>
          </div>
        </div>
      </div>
      
      <div class="ci-card-footer">
        <span class="ci-card-classification">${classificationIcon} ${getClassificationLabel(creative.score.classification)}</span>
        <button class="ci-card-detail-btn" data-ad-id="${creative.adId}">Ver detalle →</button>
      </div>
    </article>
  `;
}

function getScoreClass(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'warning';
  return 'critical';
}
```

### 8.4 Estados de UI

```javascript
// Estados de carga
const UI_STATES = {
  LOADING: 'loading',
  EMPTY: 'empty',
  ERROR: 'error',
  SUCCESS: 'success',
  NO_PERMISSIONS: 'no_permissions',
  NO_ACCOUNT: 'no_account',
};

function renderState(state, message = '') {
  const grid = document.getElementById('creatives-grid');
  
  switch (state) {
    case UI_STATES.LOADING:
      grid.innerHTML = `
        <div class="ci-state ci-state--loading">
          <div class="ci-spinner"></div>
          <p>Analizando creativos...</p>
        </div>
      `;
      break;
      
    case UI_STATES.EMPTY:
      grid.innerHTML = `
        <div class="ci-state ci-state--empty">
          <span class="ci-state-icon">📊</span>
          <h3>Sin creativos activos</h3>
          <p>No encontramos anuncios activos con datos suficientes en los últimos 30 días.</p>
        </div>
      `;
      break;
      
    case UI_STATES.NO_PERMISSIONS:
      grid.innerHTML = `
        <div class="ci-state ci-state--error">
          <span class="ci-state-icon">🔒</span>
          <h3>Permisos insuficientes</h3>
          <p>Necesitamos el permiso <code>ads_read</code> para analizar tus creativos.</p>
          <a href="/auth/meta/login?returnTo=/dashboard/creative-intelligence" class="ci-btn">
            Reconectar Meta
          </a>
        </div>
      `;
      break;
      
    case UI_STATES.NO_ACCOUNT:
      grid.innerHTML = `
        <div class="ci-state ci-state--empty">
          <span class="ci-state-icon">🔗</span>
          <h3>Conecta tu cuenta de Meta</h3>
          <p>Para usar Creative Intelligence, primero conecta tu cuenta de Meta Ads.</p>
          <a href="/onboarding" class="ci-btn">Ir a Onboarding</a>
        </div>
      `;
      break;
      
    case UI_STATES.ERROR:
      grid.innerHTML = `
        <div class="ci-state ci-state--error">
          <span class="ci-state-icon">⚠️</span>
          <h3>Error al cargar</h3>
          <p>${escapeHtml(message) || 'Hubo un problema al cargar los datos. Intenta de nuevo.'}</p>
          <button class="ci-btn" onclick="loadCreatives()">Reintentar</button>
        </div>
      `;
      break;
  }
}
```

### 8.5 Estilos (siguiendo theme.css existente)

```css
/* ci.css */

/* Usar variables existentes de theme.css */
.ci-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
  font-family: var(--font-sans, 'Inter', sans-serif);
  color: var(--ad-ice, #E1D8F3);
}

.ci-header {
  margin-bottom: 32px;
}

.ci-header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 20px;
  color: var(--ad-ice);
}

/* KPIs */
.ci-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.ci-kpi {
  background: var(--card, rgba(62, 40, 111, 0.35));
  border: 1px solid var(--stroke, rgba(202, 138, 229, 0.22));
  border-radius: var(--radius, 16px);
  padding: 20px;
  text-align: center;
}

.ci-kpi-value {
  display: block;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--ad-primary, #CA8AE5);
}

.ci-kpi--success .ci-kpi-value { color: #10b981; }
.ci-kpi--warning .ci-kpi-value { color: #f59e0b; }

.ci-kpi-label {
  font-size: 0.85rem;
  color: var(--muted, rgba(225, 216, 243, 0.72));
  margin-top: 4px;
}

/* Tabs */
.ci-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.ci-tab {
  padding: 10px 18px;
  border-radius: 12px;
  border: 1px solid var(--stroke);
  background: transparent;
  color: var(--ad-ice);
  cursor: pointer;
  transition: all 0.2s ease;
}

.ci-tab:hover { background: rgba(202, 138, 229, 0.1); }
.ci-tab--active {
  background: var(--ad-primary);
  color: #0b0614;
  border-color: var(--ad-primary);
}

/* Grid de cards */
.ci-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

/* Card */
.ci-card {
  background: var(--card);
  border: 1px solid var(--stroke);
  border-radius: var(--radius);
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.ci-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft);
}

/* Score colores */
.ci-card--excellent { border-left: 4px solid #10b981; }
.ci-card--good { border-left: 4px solid #3b82f6; }
.ci-card--warning { border-left: 4px solid #f59e0b; }
.ci-card--critical { border-left: 4px solid #ef4444; }

.ci-card-header {
  display: flex;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--stroke);
}

.ci-card-thumb {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  background: rgba(0,0,0,0.3);
}

.ci-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ci-card-format {
  position: absolute;
  bottom: 4px;
  right: 4px;
  font-size: 0.65rem;
  padding: 2px 6px;
  background: rgba(0,0,0,0.7);
  border-radius: 4px;
}

.ci-card-score {
  text-align: center;
}

.ci-score-value {
  display: block;
  font-size: 2rem;
  font-weight: 800;
  color: var(--ad-primary);
}

.ci-score-label {
  font-size: 0.75rem;
  color: var(--muted);
}

/* ... más estilos ... */
```

---

## 9. Seguridad y Compliance

### 9.1 Scopes Requeridos

| Scope | Uso | Validación |
|-------|-----|------------|
| `ads_read` | **Obligatorio** - Leer insights, ads, creativos | ✅ Verificar en MetaAccount.scopes |
| `ads_management` | Recomendado - Acceso completo a ads | ⚠️ Opcional pero mejora datos |
| `business_management` | Para acceso a Business Manager | ⚠️ Opcional |

```javascript
// Validación de scopes
function validateScopes(metaAccount) {
  const scopes = (metaAccount.scopes || []).map(s => s.toLowerCase());
  
  const required = ['ads_read'];
  const missing = required.filter(s => !scopes.includes(s));
  
  if (missing.length) {
    return {
      valid: false,
      missing,
      message: `Faltan permisos: ${missing.join(', ')}. Reconecta Meta.`,
    };
  }
  
  return { valid: true };
}
```

### 9.2 Ads Library - Consideraciones Legales

1. **Uso público**: La Ads Library es información pública de Meta para transparencia
2. **Sin scraping**: Usar API oficial, no web scraping
3. **Atribución**: No presentar ads de competidores como propios
4. **Rate limits**: Respetar límites de la API
5. **Almacenamiento**: No almacenar indefinidamente datos de terceros

```javascript
// Disclaimer para UI
const ADS_LIBRARY_DISCLAIMER = 
  'Las señales de mercado provienen de la Ads Library de Meta, ' +
  'información pública para transparencia publicitaria. ' +
  'No incluye métricas de rendimiento de terceros.';
```

### 9.3 Sanitización de Datos

```javascript
// Antes de almacenar/mostrar
function sanitizeCreativeData(creative) {
  return {
    ...creative,
    // No almacenar URL completas de landing (puede tener tracking params sensibles)
    creative: {
      ...creative.creative,
      linkUrl: creative.creative.linkUrl 
        ? new URL(creative.creative.linkUrl).hostname 
        : null,
    },
  };
}
```

---

## 10. Plan de Implementación por Etapas

### Etapa 1: Data Plumbing (3-4 días)

- [ ] Crear branch `feature/meta-creative-intelligence`
- [ ] Crear modelo `CreativeSnapshot.js`
- [ ] Crear servicio `backend/services/creativeIntelligence/dataCollector.js`
  - [ ] Función para listar ads activos
  - [ ] Función para obtener insights nivel ad
  - [ ] Función para obtener time series
  - [ ] Integrar con helpers existentes de `metaCollector.js`
- [ ] Crear endpoint básico `GET /api/meta/creative-intelligence` (sin score)
- [ ] Tests unitarios para collectors

### Etapa 2: Score Engine (3-4 días)

- [ ] Crear servicio `backend/services/creativeIntelligence/scoreEngine.js`
  - [ ] Implementar `calculateValueScore()` por objetivo
  - [ ] Implementar `calculateRiskScore()`
  - [ ] Implementar `calculateAlignmentScore()` (mock inicial sin Ads Library)
  - [ ] Implementar `calculateCreativeScore()` completo
  - [ ] Implementar `classifyCreative()`
- [ ] Integrar score en endpoint
- [ ] Guardar snapshots con scores
- [ ] Tests unitarios para fórmulas

### Etapa 3: Dashboard Base (3-4 días)

- [ ] Crear estructura HTML/CSS vanilla
- [ ] Implementar `ci.js` con:
  - [ ] Fetch de datos
  - [ ] Renderizado de grid
  - [ ] Filtros por clasificación
  - [ ] Estados de UI (loading, empty, error)
- [ ] Integrar con estilos existentes (theme.css, onboarding.css)
- [ ] Vista de detalle de creativo (modal o page)

### Etapa 4: Recomendaciones (2-3 días)

- [ ] Crear servicio `backend/services/creativeIntelligence/recommendationEngine.js`
- [ ] Implementar reglas de disparo
- [ ] Agregar recomendaciones al endpoint
- [ ] UI para mostrar recomendaciones
- [ ] Panel de recomendaciones urgentes

### Etapa 5: Market Signals (2-3 días)

- [ ] Investigar/implementar integración con Ads Library API
- [ ] Crear modelo `MarketSignal.js`
- [ ] Job para recolectar señales (1x/día)
- [ ] Conectar con Alignment Score real
- [ ] UI para mostrar comparación con mercado

### Etapa 6: Validación Antes/Después (1-2 días)

- [ ] Implementar almacenamiento de historial de scores
- [ ] Endpoint para comparar snapshots
- [ ] UI para mostrar evolución de score
- [ ] KPIs de mejora agregados

### Etapa 7: Polish y QA (2 días)

- [ ] Revisar edge cases
- [ ] Optimizar performance
- [ ] Responsive mobile
- [ ] Documentación inline
- [ ] Code review

**Total estimado: ~18-22 días de desarrollo**

---

## 11. Testing Mínimo

### 11.1 Unit Tests (si existe framework)

```javascript
// tests/creativeIntelligence/scoreEngine.test.js

describe('Creative Score Engine', () => {
  describe('calculateValueScore_Sales', () => {
    it('should return 100 for top performer', () => {
      const creative = { metrics: { purchaseValue: 10000, roas: 5, purchases: 100 } };
      const totals = { totalRevenue: 10000 };
      const distributions = { /* mock */ };
      
      const score = calculateValueScore_Sales(creative, totals, distributions);
      expect(score).toBeGreaterThanOrEqual(90);
    });
    
    it('should return low score for no revenue', () => {
      const creative = { metrics: { purchaseValue: 0, roas: 0, purchases: 0 } };
      // ...
    });
  });
  
  describe('calculateRiskScore', () => {
    it('should detect high frequency risk', () => {
      const creative = { metrics: { frequency: 5.5 }, timeSeries: [] };
      const score = calculateRiskScore(creative, {});
      expect(score).toBeLessThan(50); // Alto riesgo = bajo score
    });
  });
  
  describe('classifyCreative', () => {
    it('should classify score 85 as PROTECT', () => {
      expect(classifyCreative(85)).toBe('PROTECT');
    });
    
    it('should classify score 35 as REPLACE', () => {
      expect(classifyCreative(35)).toBe('REPLACE');
    });
  });
});
```

### 11.2 Casos de Borde

1. **Creativo sin conversiones**: Score basado solo en CTR/reach
2. **Cuenta nueva (< 7 días datos)**: Marcar como "insufficient data"
3. **Un solo creativo activo**: No hay distribución, usar benchmarks fijos
4. **Campañas mixtas (ventas + awareness)**: Respetar objetivo de campaña, no usuario
5. **Token expirado mid-request**: Retry con refresh o error claro
6. **Ads Library sin datos para el país**: Alignment score = 50 (neutral)

### 11.3 Mocks de Meta

```javascript
// tests/mocks/metaMock.js

const mockInsightsResponse = {
  data: [
    {
      ad_id: '123',
      ad_name: 'Test Ad',
      spend: '100.50',
      impressions: '10000',
      clicks: '250',
      actions: [
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '15' }
      ],
      action_values: [
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '750.00' }
      ],
    },
  ],
  paging: { cursors: { after: null } },
};

const mockAdsListResponse = {
  data: [
    {
      id: '123',
      name: 'Test Ad',
      effective_status: 'ACTIVE',
      creative: {
        id: 'cr_123',
        object_type: 'VIDEO',
        thumbnail_url: 'https://...',
        title: 'Test Title',
        body: 'Test Body',
        call_to_action_type: 'SHOP_NOW',
      },
    },
  ],
};
```

### 11.4 Pruebas Manuales Guiadas

1. **Flujo completo happy path**:
   - Login → Onboarding completo → Dashboard CI → Ver creativos → Ver detalle → Ver recomendaciones

2. **Sin conexión Meta**:
   - Verificar estado "Conecta tu cuenta"

3. **Sin permisos ads_read**:
   - Verificar estado "Permisos insuficientes" con botón reconectar

4. **Cuenta sin ads activos**:
   - Verificar estado "Sin creativos activos"

5. **Filtros por clasificación**:
   - Verificar que filtros funcionan y contadores son correctos

6. **Refresh de datos**:
   - Verificar que botón refresh actualiza scores

---

## 12. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| **Missing revenue field** (algunas cuentas no tienen purchase_value) | Alta | Alto | Fallback a purchases * AOV estimado; si no hay conversiones, usar métricas de engagement |
| **Atribución incorrecta** (attribution windows diferentes) | Media | Medio | Usar `use_unified_attribution_setting=true`; documentar limitación |
| **Creativos sin conversiones** (campañas de awareness) | Alta | Medio | Ajustar fórmula según objetivo de campaña |
| **Campañas mixtas** (múltiples objetivos) | Media | Bajo | Usar objetivo de campaña, no de usuario |
| **Sample size pequeño** (< 1000 impressions) | Media | Medio | Marcar como "insufficient data", no calcular score |
| **Rate limits Meta API** | Media | Alto | Implementar backoff exponencial, caché agresivo |
| **Ads Library no disponible** (países limitados) | Baja | Medio | Alignment score = 50 neutral; documentar |
| **Token expira mid-session** | Media | Medio | Detectar error 190, redirigir a reconexión |
| **Múltiples ad accounts** | Alta | Bajo | Ya manejado en arquitectura existente (selector de cuentas) |
| **Dashboard React vs Vanilla JS** | Baja | Medio | CI será módulo Vanilla JS independiente, no afecta dashboard React |

---

## 13. Preguntas para José (Bloqueantes)

> ✅ **TODAS LAS PREGUNTAS RESPONDIDAS - Ver sección "Decisiones de José" al inicio**

---

## 14. Log de Implementación

### 2026-01-27 - MVP Day

| Hora | Tarea | Estado |
|------|-------|--------|
| -- | Backend: Modelo CreativeSnapshot | ⏳ |
| -- | Backend: Score Engine | ⏳ |
| -- | Backend: Endpoints API | ⏳ |
| -- | Backend: Recomendaciones | ⏳ |
| -- | Testing manual | ⏳ |

---

**🚀 LISTO PARA IMPLEMENTAR - Esperando "AUTORIZO" de José**

```
# Conector Meta
backend/routes/meta.js              ← OAuth, login, callback, disconnect
backend/routes/metaInsights.js      ← Insights API, KPIs
backend/routes/metaAccounts.js      ← Listado/selección cuentas
backend/routes/metaTable.js         ← Tabla de campañas/ads
backend/models/MetaAccount.js       ← Modelo de cuenta Meta
backend/jobs/metaAuditJob.js        ← Job de auditoría Meta
backend/jobs/collect/metaCollector.js ← Collector de datos Meta

# Modelos y Servicios
backend/models/User.js              ← Usuario con objetivos
backend/models/Audit.js             ← Auditorías con issues
backend/jobs/auditJob.js            ← Motor de auditorías
backend/api/dashboardRoute.js       ← Dashboard API

# Frontend
public/onboarding.html              ← Estructura onboarding
public/onboarding.css               ← Estilos onboarding
public/js/onboarding.js             ← Lógica vanilla JS
public/theme.css                    ← Tokens de marca

# Estructura general
backend/index.js                    ← Entry point, rutas, middleware
public/dashboard/index.html         ← Dashboard (React bundle)
```

---

**🚧 ESTE DOCUMENTO ES UN PLAN. NO SE HA ESCRITO CÓDIGO.**

**Esperando autorización explícita ("AUTORIZO") para comenzar implementación.**
