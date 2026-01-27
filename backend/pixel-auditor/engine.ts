// backend/pixel-auditor/engine.ts
import { fetchPage } from "./lib/crawler/fetchPage";
import { getAllScripts, fetchRelevantExternalScripts } from "./lib/crawler/extractScripts";

import { detectGA4 } from "./lib/auditor/ga4";
import { detectGTM } from "./lib/auditor/gtm";
import { detectMetaPixel } from "./lib/auditor/metaPixel";
import { detectGoogleAds } from "./lib/auditor/googleAds";
import { detectShopifyTrackingPatterns } from "./lib/auditor/shopifyPixels";

import { extractEvents, findDuplicateEvents, validateEventParameters } from "./lib/auditor/events";

import type { AuditResult, ScriptInfo, PageContent, ShopifyInfo } from "./type/AuditResult";

export async function runPixelAudit(
  url: string,
  includeDetails = false
): Promise<AuditResult> {
  // 1) Descargar HTML + metadatos
  const page: PageContent = await fetchPage(url);

  // 2) Extraer scripts (internos + externos)
  const allScripts: ScriptInfo[] = getAllScripts(page);

  // 3) (Opcional) descargar contenido de scripts externos relevantes (para detectores que lo usen)
  //    OJO: algunos detectores NO lo necesitan, pero lo dejamos listo para "modo detallado".
  const scriptsWithSrc = allScripts
    .filter((s) => typeof s.src === "string" && s.src.length > 0)
    .map((s) => ({ src: s.src as string, content: s.content }));

  // Solo lo bajamos si el caller pidió detalle (así no haces crawling pesado siempre)
  const externalScripts = includeDetails
    ? await fetchRelevantExternalScripts(scriptsWithSrc)
    : [];

  // 4) Detectores principales (estos esperan: (page, scripts))
  const ga4 = detectGA4(page, allScripts);
  const gtm = detectGTM(page, allScripts);
  const metaPixel = detectMetaPixel(page, allScripts);
  const googleAds = detectGoogleAds(page, allScripts);

  // 5) Shopify: tu detector actual regresa "señales", pero el type ShopifyInfo exige campos extra
  const shopifySignals = detectShopifyTrackingPatterns(page.html);

  const isShopify =
    !!shopifySignals.hasWebPixelsManager ||
    !!shopifySignals.hasMonorailTracking ||
    !!shopifySignals.hasTrekkieTracking ||
    (shopifySignals.shopifyAppsDetected?.length ?? 0) > 0;

  const shopify: ShopifyInfo = {
    ...(shopifySignals as any),
    isShopify,
    appsDetected: shopifySignals.shopifyAppsDetected ?? [],
    tiktokPixelIds: [],
  };

  // 6) Eventos
  const events = extractEvents(page, allScripts);
  const duplicateEvents = findDuplicateEvents(events);
  const eventAnalysis = validateEventParameters(events);

  // 7) Construir respuesta (sin teoría, puro resultado)
  const result: AuditResult = {
    status: "ok",
    url, // ✅ NO uses page.url (no existe en PageContent)

    ga4,
    gtm,
    metaPixel,
    googleAds,

    // Si tu type lo exige, lo dejamos “neutral”
    merchantCenter: { detected: false, ids: [], errors: [] },

    shopify,
    events,

    summary: {
      trackingHealthScore: 0,
      issuesFound: 0,
      recommendations: [],
    },
  };

  // 8) Si tu AuditResult soporta extras en modo detallado, los anexamos sin romper tipos
  if (includeDetails) {
    (result as any).externalScripts = externalScripts;
    (result as any).duplicates = duplicateEvents;
    (result as any).analysis = eventAnalysis;
  }

  return result;
}
