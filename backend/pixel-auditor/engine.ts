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

type RunInput =
  | string
  | {
      url?: string;
      html?: string;
      includeDetails?: boolean;
      traceId?: string;
    };

function safeStr(v: any) {
  return typeof v === "string" ? v : "";
}

/**
 * Extrae IDs de GTM desde src/content.
 * (Ya tienes extractGtmIds en crawler, pero aquí lo dejamos local para no depender de otra firma.)
 */
function extractGtmIdsFromScripts(scripts: ScriptInfo[]): string[] {
  const ids = new Set<string>();
  const patterns = [
    /['"](GTM-[A-Z0-9]+)['"]/gi,
    /\bid\s*=\s*['"]?(GTM-[A-Z0-9]+)['"]?/gi,
    /\bgtm\.js\?id=(GTM-[A-Z0-9]+)/gi,
  ];

  for (const s of scripts) {
    const src = safeStr((s as any).src);
    if (src) {
      const m = /[?&]id=(GTM-[A-Z0-9]+)/i.exec(src);
      if (m?.[1]) ids.add(m[1]);
    }

    const content = safeStr((s as any).content);
    if (!content) continue;

    for (const p of patterns) {
      let m: RegExpExecArray | null;
      while ((m = p.exec(content)) !== null) {
        if (m?.[1]) ids.add(m[1]);
      }
    }
  }

  return Array.from(ids);
}

function generateSummary(args: {
  ga4: any;
  gtm: any;
  metaPixel: any;
  googleAds: any;
  shopify?: ShopifyInfo;
  events: any[];
  duplicateEvents: any[];
  eventsWithMissingParams: any[];
}) {
  const recommendations: string[] = [];
  let issuesFound = 0;
  let score = 100;

  // GA4
  if (!args.ga4?.detected) {
    recommendations.push("Google Analytics 4 no está instalado.");
    score -= 20;
  } else {
    issuesFound += args.ga4?.errors?.length ?? 0;
    const errors: string[] = args.ga4?.errors ?? [];
    if (errors.includes("multiple_ga4_ids")) {
      recommendations.push("Se detectaron múltiples IDs de GA4. Conserva solo el principal.");
      score -= 10;
    }
    if (errors.includes("ga4_script_without_config")) {
      recommendations.push("GA4 parece cargarse sin configuración (gtag('config')). Revisa implementación.");
      score -= 15;
    }
  }

  // GTM
  if (!args.gtm?.detected) {
    recommendations.push("Considera implementar Google Tag Manager para administrar etiquetas.");
    score -= 5;
  } else {
    issuesFound += args.gtm?.errors?.length ?? 0;
    const errors: string[] = args.gtm?.errors ?? [];
    if (errors.includes("duplicate_container")) {
      recommendations.push("Se detectó contenedor GTM duplicado. Elimina duplicados.");
      score -= 15;
    }
    if (errors.includes("datalayer_not_initialized")) {
      recommendations.push("dataLayer no está inicializado antes de GTM. Ajusta el orden de carga.");
      score -= 10;
    }
  }

  // Meta Pixel
  if (!args.metaPixel?.detected) {
    recommendations.push("Meta Pixel no está instalado.");
    score -= 10;
  } else {
    issuesFound += args.metaPixel?.errors?.length ?? 0;
    const errors: string[] = args.metaPixel?.errors ?? [];
    if (errors.includes("multiple_pixel_ids")) {
      recommendations.push("Se detectaron múltiples Pixel IDs. Elimina duplicados.");
      score -= 10;
    }
  }

  // Google Ads
  if (args.googleAds?.detected) {
    issuesFound += args.googleAds?.errors?.length ?? 0;
  }

  // Duplicados
  if (args.duplicateEvents?.length) {
    const unique = new Set(args.duplicateEvents.map((e: any) => `${e?.type ?? ""}:${e?.name ?? ""}`));
    if (unique.size > 0) {
      recommendations.push(`Se encontraron ${unique.size} evento(s) duplicado(s).`);
      issuesFound += unique.size;
      score -= unique.size * 5;
    }
  }

  // Params faltantes
  if (args.eventsWithMissingParams?.length) {
    for (const it of args.eventsWithMissingParams) {
      const ev = it?.event;
      const missing = it?.missingParams ?? [];
      if (ev?.name && missing.length) {
        recommendations.push(`El evento "${ev.name}" no incluye: ${missing.join(", ")}.`);
        issuesFound += 1;
        score -= 8;
      }
    }
  }

  // Shopify
  if (args.shopify?.isShopify && (args.shopify as any)?.hasWebPixelsManager) {
    recommendations.push("Shopify Web Pixels Manager detectado.");
  }

  score = Math.max(0, Math.min(100, score));
  if (issuesFound === 0 && score === 100) {
    recommendations.push("Excelente: no se detectaron problemas importantes.");
  }

  return {
    trackingHealthScore: score,
    issuesFound,
    recommendations,
  };
}

function extractScriptsFromHTML(html: string): PageContent["scripts"] {
  const scripts: PageContent["scripts"] = { inline: [], external: [] };

  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const attributes = match[1] || "";
    const content = match[2] || "";
    const srcMatch = /src=["']([^"']+)["']/i.exec(attributes);

    if (srcMatch?.[1]) scripts.external.push({ src: srcMatch[1] });
    else if (content.trim()) scripts.inline.push(content);
  }

  return scripts;
}

export async function runPixelAudit(input: RunInput, includeDetailsLegacy = false): Promise<AuditResult> {
  const traceId = typeof input === "object" && input ? input.traceId : undefined;

  const url = typeof input === "string" ? input : (input?.url || "").trim();
  const html = typeof input === "object" && input ? (input.html || "").trim() : "";

  // ✅ Default TRUE estilo German (solo se apaga si viene explícitamente false en firma moderna)
  const includeDetails =
    typeof input === "string" ? !!includeDetailsLegacy : input.includeDetails === false ? false : true;

  if (!url && !html) throw new Error("URL_OR_HTML_REQUIRED");

  // 1) Obtener PageContent (URL o HTML)
  let page: PageContent;
  if (html) {
    page = { html, scripts: extractScriptsFromHTML(html) };
  } else {
    page = await fetchPage(url);
  }

  // 2) Unificar scripts inline + refs externas
  const allScripts: ScriptInfo[] = getAllScripts(page);

  // 3) Inyectar GTM container (como German)
  const gtmIds = extractGtmIdsFromScripts(allScripts);
  const injectedGtmScripts = gtmIds.map((id) => ({
    src: `https://www.googletagmanager.com/gtm.js?id=${id}`,
    content: "",
  }));

  // 4) Lista externa única (refs + inyectados)
  const scriptsWithSrc = allScripts
    .filter((s) => typeof (s as any).src === "string" && safeStr((s as any).src))
    .map((s) => ({ src: safeStr((s as any).src), content: safeStr((s as any).content) }));

  const combinedExternal = [...scriptsWithSrc, ...injectedGtmScripts];

  const uniqueExternal = Array.from(
    new Map(combinedExternal.map((s) => [String(s.src).toLowerCase(), s])).values()
  );
  
  (globalThis as any).__PIXEL_AUDITOR_HTML__ = page.html;

  // ✅ CLAVE: descargar externos relevantes SIEMPRE para no perder detección real
  const externalScripts = await fetchRelevantExternalScripts(uniqueExternal as any, url || undefined);

  delete (globalThis as any).__PIXEL_AUDITOR_HTML__;


  // 5) Merge de descargas dentro de allScripts
  for (const downloaded of externalScripts as any[]) {
    const src = safeStr(downloaded?.src);
    const content = safeStr(downloaded?.content);
    if (!src || !content) continue;

    const existing = allScripts.find((s: any) => safeStr(s.src) === src);
    if (existing) {
      (existing as any).content = content;
      if (downloaded?.excludeFromEvents != null) {
        (existing as any).excludeFromEvents = downloaded.excludeFromEvents;
      }
    } else {
      allScripts.push({
        type: "external" as any,
        src,
        content,
        excludeFromEvents: downloaded?.excludeFromEvents,
      } as any);
    }
  }

  // 6) Detectores principales
  const ga4 = detectGA4(page, allScripts);
  const gtm = detectGTM(page, allScripts);
  const metaPixel = detectMetaPixel(page, allScripts);
  const googleAds = detectGoogleAds(page, allScripts);

  // 7) Shopify
  const shopifySignals = detectShopifyTrackingPatterns(page.html);

  const isShopify =
    !!(shopifySignals as any).hasWebPixelsManager ||
    !!(shopifySignals as any).hasMonorailTracking ||
    !!(shopifySignals as any).hasTrekkieTracking ||
    (((shopifySignals as any).shopifyAppsDetected?.length ?? 0) > 0);

  const shopify: ShopifyInfo = {
    ...(shopifySignals as any),
    isShopify,
    appsDetected: (shopifySignals as any).shopifyAppsDetected ?? [],
    tiktokPixelIds: [],
  };

  // 8) Eventos
  const events = extractEvents(page, allScripts);
  const duplicateEvents = findDuplicateEvents(events);
  const eventsWithMissingParams = validateEventParameters(events);

  // 9) Summary
  const summary = generateSummary({
    ga4,
    gtm,
    metaPixel,
    googleAds,
    shopify,
    events,
    duplicateEvents,
    eventsWithMissingParams,
  });

  // 10) Respuesta final
  const result: AuditResult = {
    status: "ok",
    url: url || "manual-html-input",

    ga4,
    gtm,
    metaPixel,
    googleAds,

    merchantCenter: { detected: false, ids: [], errors: [] },

    shopify,
    events,

    summary,
  };

  // 11) Extras
  if (includeDetails) {
    (result as any).externalScripts = externalScripts;
    (result as any).duplicates = duplicateEvents;
    (result as any).analysis = eventsWithMissingParams;
    if (traceId) (result as any).traceId = traceId;
  }

  return result;
}
