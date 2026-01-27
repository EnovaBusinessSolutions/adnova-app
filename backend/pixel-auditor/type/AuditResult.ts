/**
 * Pixel Auditor AI™ - Type Definitions
 * Definiciones de tipos para el módulo de auditoría digital
 */

export interface AuditRequest {
  url: string;
  /** Si es true, incluye descripciones detalladas de errores y eventos */
  includeDetails?: boolean;
}

/** Detalle completo de un error */
export interface ErrorDetailInfo {
  code: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  impact: string;
  solution: string;
  docsUrl?: string;
}

export interface GA4Result {
  detected: boolean;
  ids: string[];
  errors: string[];
  /** Detalles expandidos de errores (solo si includeDetails=true) */
  errorsDetails?: ErrorDetailInfo[];
}

export interface GTMResult {
  detected: boolean;
  containers: string[];
  errors: string[];
  /** Detalles expandidos de errores (solo si includeDetails=true) */
  errorsDetails?: ErrorDetailInfo[];
}

export interface MetaPixelResult {
  detected: boolean;
  ids: string[];
  errors: string[];
  /** Detalles expandidos de errores (solo si includeDetails=true) */
  errorsDetails?: ErrorDetailInfo[];
}

export interface GoogleAdsResult {
  detected: boolean;
  ids: string[];
  errors: string[];
  /** Conversiones detectadas (formato: AW-XXXXX/label) */
  conversions?: string[];
  /** Detalles expandidos de errores (solo si includeDetails=true) */
  errorsDetails?: ErrorDetailInfo[];
}

export interface GoogleTagResult {
  detected: boolean;
  /** IDs de Google Tag (formato GT-XXXXXXXXX) */
  ids: string[];
  errors: string[];
  errorsDetails?: ErrorDetailInfo[];
}

export interface MerchantCenterResult {
  detected: boolean;
  /** IDs de Merchant Center (formato MC-XXXXXXXXXXX) */
  ids: string[];
  errors: string[];
  errorsDetails?: ErrorDetailInfo[];
}

export interface ShopifyInfo {
  /** Si es una tienda Shopify */
  isShopify: boolean;
  /** Apps de tracking detectadas */
  appsDetected: string[];
  /** Si usa Web Pixels Manager */
  hasWebPixelsManager: boolean;
  /** TikTok Pixel IDs encontrados */
  tiktokPixelIds: string[];
}

/** Detalle de un parámetro esperado */
export interface ExpectedParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
}

/** Detalle completo de un evento */
export interface EventDetailInfo {
  category: 'standard' | 'ecommerce' | 'engagement' | 'conversion' | 'custom';
  title: string;
  description: string;
  expectedParams: ExpectedParam[];
  bestPractices: string[];
}

/** Análisis de parámetros de un evento */
export interface EventAnalysis {
  missingRequired: string[];
  warnings: string[];
}

export interface EventData {
  type: 'GA4' | 'GTM' | 'MetaPixel';
  name: string;
  params?: Record<string, any>;
  line?: number;
  /** Detalles del evento (solo si includeDetails=true) */
  details?: EventDetailInfo | null;
  /** Análisis de parámetros (solo si includeDetails=true) */
  analysis?: EventAnalysis;
}

export interface AuditSummary {
  trackingHealthScore: number;
  issuesFound: number;
  recommendations: string[];
}

export interface AuditResult {
  status: 'ok' | 'error';
  url: string;
  ga4: GA4Result;
  gtm: GTMResult;
  metaPixel: MetaPixelResult;
  googleAds: GoogleAdsResult;
  /** Google Tag (GT-) - nuevo formato de etiquetas de Google */
  googleTag?: GoogleTagResult;
  /** Merchant Center (MC-) */
  merchantCenter?: MerchantCenterResult;
  /** Información específica de Shopify */
  shopify?: ShopifyInfo;
  events: EventData[];
  summary: AuditSummary;
  error?: string;
}

export interface PageContent {
  html: string;
  scripts: {
    inline: string[];
    external: {
      src: string;
      content?: string;
    }[];
  };
}

export interface ScriptInfo {
  type: 'inline' | 'external';
  content: string;
  src?: string;
  line?: number;
  /** Si es true, excluir de análisis de eventos (scripts de terceros como fbevents.js) */
  excludeFromEvents?: boolean;
}