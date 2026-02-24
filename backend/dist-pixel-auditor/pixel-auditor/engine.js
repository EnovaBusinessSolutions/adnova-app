"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPixelAudit = runPixelAudit;

// backend/pixel-auditor/engine.ts (build JS)
const fetchPage_1 = require("./lib/crawler/fetchPage");
const extractScripts_1 = require("./lib/crawler/extractScripts");
const ga4_1 = require("./lib/auditor/ga4");
const gtm_1 = require("./lib/auditor/gtm");
const metaPixel_1 = require("./lib/auditor/metaPixel");
const googleAds_1 = require("./lib/auditor/googleAds");
const shopifyPixels_1 = require("./lib/auditor/shopifyPixels");
const events_1 = require("./lib/auditor/events");

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function severityWeight(sev) {
  const s = String(sev || "").toLowerCase();
  if (s === "critical") return 25;
  if (s === "high") return 18;
  if (s === "medium") return 10;
  if (s === "low") return 5;
  return 8;
}

function normalizeIssues(list) {
  if (!list) return [];
  if (Array.isArray(list)) return list;
  if (typeof list === "object") {
    if (Array.isArray(list.issues)) return list.issues;
    if (Array.isArray(list.items)) return list.items;
  }
  return [];
}

function computeTrackingHealth({ ga4, gtm, metaPixel, googleAds, issues }) {
  const candidate =
    (ga4 && (ga4.healthScore ?? ga4.score)) ??
    (metaPixel && (metaPixel.healthScore ?? metaPixel.score)) ??
    (googleAds && (googleAds.healthScore ?? googleAds.score));

  if (Number.isFinite(Number(candidate))) {
    return clamp(Number(candidate), 0, 100);
  }

  const hasGA4 =
    !!(ga4 && ga4.detected) ||
    (Array.isArray(ga4 && ga4.ids) && (ga4.ids || []).length > 0) ||
    !!(ga4 && ga4.measurementId);

  const hasMeta =
    !!(metaPixel && metaPixel.detected) ||
    (Array.isArray(metaPixel && metaPixel.ids) && (metaPixel.ids || []).length > 0);

  const hasGTM =
    !!(gtm && gtm.detected) ||
    (Array.isArray(gtm && gtm.ids) && (gtm.ids || []).length > 0) ||
    !!(gtm && gtm.containerId);

  const hasGAds =
    !!(googleAds && googleAds.detected) ||
    (Array.isArray(googleAds && googleAds.ids) && (googleAds.ids || []).length > 0);

  let score = 100;

  if (!hasGA4) score -= 25;
  if (!hasMeta) score -= 25;

  if (!hasGTM) score -= 10;
  if (!hasGAds) score -= 10;

  const iss = Array.isArray(issues) ? issues : [];
  let penalty = 0;
  iss.forEach((it) => {
    penalty += severityWeight(it && it.severity);
  });

  penalty = clamp(penalty, 0, 40);
  score -= penalty;

  return clamp(score, 0, 100);
}

function guessBlocked(htmlSnippet) {
  const s = String(htmlSnippet || "").toLowerCase();
  if (!s) return null;

  if (s.includes("access denied")) return "access_denied";
  if (s.includes("request blocked")) return "request_blocked";
  if (s.includes("forbidden")) return "forbidden";
  if (s.includes("captcha")) return "captcha";
  if (s.includes("cloudflare") && (s.includes("challenge") || s.includes("attention required"))) {
    return "cloudflare_challenge";
  }
  if (s.includes("akamai") && (s.includes("reference #") || s.includes("access denied"))) {
    return "akamai_block";
  }
  if (s.includes("incident id") && s.includes("imperva")) return "imperva_block";
  if (s.includes("bot") && s.includes("detected")) return "bot_detected";

  return null;
}

// ✅ Clave estilo German: extraer IDs GTM (GTM-XXXXXXX) desde HTML + scripts inline
function extractGtmIdsFromText(text) {
  const out = new Set();
  const s = String(text || "");
  if (!s) return [];
  const re = /\bGTM-[A-Z0-9]+\b/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0]) out.add(m[0].toUpperCase());
  }
  return Array.from(out);
}

function extractGtmIdsFromScripts(page, scripts) {
  const ids = new Set();

  // HTML completo
  extractGtmIdsFromText(page && page.html).forEach((x) => ids.add(x));

  // snippet si existiera
  extractGtmIdsFromText(page && page.htmlSnippet).forEach((x) => ids.add(x));

  // inline scripts (content)
  (Array.isArray(scripts) ? scripts : []).forEach((sc) => {
    if (sc && typeof sc.content === "string") {
      extractGtmIdsFromText(sc.content).forEach((x) => ids.add(x));
    }
    if (sc && typeof sc.src === "string") {
      extractGtmIdsFromText(sc.src).forEach((x) => ids.add(x));
    }
  });

  return Array.from(ids);
}

async function runPixelAudit(url, includeDetails = false) {
  const startedAt = Date.now();

  // 1) Descargar HTML + metadatos
  const page = await (0, fetchPage_1.fetchPage)(url);

  // 2) Extraer scripts (internos + externos)
  const allScripts = (0, extractScripts_1.getAllScripts)(page);

  // 3) scripts externos detectados en el HTML
  const scriptsWithSrc = (Array.isArray(allScripts) ? allScripts : [])
    .filter((s) => typeof (s && s.src) === "string" && s.src.length > 0)
    .map((s) => ({ src: s.src, content: s.content }));

  // ✅ 3.1) EXTRA: inyectar scripts de GTM aunque no estén como <script src="...">
  const gtmIds = extractGtmIdsFromScripts(page, allScripts);
  const injectedGtmScripts = gtmIds.map((id) => ({
    src: `https://www.googletagmanager.com/gtm.js?id=${id}`,
  }));

  // 3.2) Combinar + deduplicar por src (case-insensitive)
  const combinedExternal = [...scriptsWithSrc, ...injectedGtmScripts];
  const uniqueBySrc = Array.from(
    new Map(
      combinedExternal
        .filter((x) => x && typeof x.src === "string" && x.src.trim())
        .map((x) => [String(x.src).toLowerCase(), x])
    ).values()
  );

  // 4) Descargar scripts externos relevantes (incluye GTM inyectados)
  let externalScripts = [];
  try {
    const siteUrl = page.finalUrl || url;
    externalScripts = await (0, extractScripts_1.fetchRelevantExternalScripts)(uniqueBySrc, siteUrl);
  } catch {
    externalScripts = [];
  }

  // 5) Merge robusto (relativo vs absoluto) + normaliza src
  const siteUrlForResolve = page.finalUrl || url;

  function resolveSrcToAbs(src) {
    try {
      if (!src) return "";
      const s = String(src);
      if (s.startsWith("//")) return "https:" + s;
      if (/^https?:\/\//i.test(s)) return s;
      return new URL(s, siteUrlForResolve).href;
    } catch {
      return String(src || "");
    }
  }

  const externalByAbsSrc = new Map();
  (Array.isArray(externalScripts) ? externalScripts : []).forEach((es) => {
    const key = resolveSrcToAbs(es && es.src);
    if (key) externalByAbsSrc.set(key, es);
  });

  // ✅ Importante: también metemos los GTM inyectados en scriptsForDetection (aunque no estuvieran en allScripts)
  const injectedAsDetectionScripts = (Array.isArray(externalScripts) ? externalScripts : [])
    .filter((x) => x && typeof x.src === "string" && x.src.includes("googletagmanager.com/gtm.js"))
    .map((x) => ({
      type: "external",
      src: resolveSrcToAbs(x.src),
      content: x.content || "",
      excludeFromEvents: x.excludeFromEvents,
    }));

  const scriptsForDetectionBase = (Array.isArray(allScripts) ? allScripts : []).map((s) => {
    if (!s || !s.src) return s;

    const abs = resolveSrcToAbs(s.src);
    const hit = externalByAbsSrc.get(abs);

    if (hit) {
      return {
        ...s,
        src: abs,
        excludeFromEvents: (hit.excludeFromEvents ?? s.excludeFromEvents),
        content: (hit.content || s.content),
      };
    }

    return { ...s, src: abs };
  });

  // Dedup final scriptsForDetection por src
  const scriptsForDetection = Array.from(
    new Map(
      [...scriptsForDetectionBase, ...injectedAsDetectionScripts]
        .filter(Boolean)
        .map((sc) => {
          const key = sc && sc.src ? String(sc.src).toLowerCase() : `inline:${Math.random()}`;
          return [key, sc];
        })
    ).values()
  );

  // 6) Detectores principales
  const ga4 = (0, ga4_1.detectGA4)(page, scriptsForDetection);
  const gtm = (0, gtm_1.detectGTM)(page, scriptsForDetection);
  const metaPixel = (0, metaPixel_1.detectMetaPixel)(page, scriptsForDetection);
  const googleAds = (0, googleAds_1.detectGoogleAds)(page, scriptsForDetection);

  // 7) Shopify signals
  const shopifySignals = (0, shopifyPixels_1.detectShopifyTrackingPatterns)(page.html);
  const isShopify =
    !!shopifySignals.hasWebPixelsManager ||
    !!shopifySignals.hasMonorailTracking ||
    !!shopifySignals.hasTrekkieTracking ||
    ((shopifySignals.shopifyAppsDetected && shopifySignals.shopifyAppsDetected.length) || 0) > 0;

  const shopify = {
    ...shopifySignals,
    isShopify,
    appsDetected: shopifySignals.shopifyAppsDetected ?? [],
    tiktokPixelIds: [],
  };

  // 8) Eventos
  const events = (0, events_1.extractEvents)(page, scriptsForDetection);
  const duplicateEvents = (0, events_1.findDuplicateEvents)(events);
  const eventAnalysis = (0, events_1.validateEventParameters)(events);

  // 9) Consolidar issues
  const issues = [
    ...normalizeIssues(ga4 && ga4.issues),
    ...normalizeIssues(gtm && gtm.issues),
    ...normalizeIssues(metaPixel && metaPixel.issues),
    ...normalizeIssues(googleAds && googleAds.issues),
    ...normalizeIssues(eventAnalysis),
  ];

  // 10) Score
  const trackingHealthScore = computeTrackingHealth({
    ga4,
    gtm,
    metaPixel,
    googleAds,
    issues,
  });

  const recommendations = [];

  // 11) Respuesta base
  const result = {
    status: "ok",
    url,
    ga4,
    gtm,
    metaPixel,
    googleAds,
    merchantCenter: { detected: false, ids: [], errors: [] },
    shopify,
    events,
    issues,
    summary: {
      trackingHealthScore,
      issuesCount: issues.length,
      eventsCount: Array.isArray(events) ? events.length : 0,
      recommendations,
    },
  };

  // ✅ Debug SIEMPRE
  const htmlLength =
    Number((page && page.htmlLength) ?? ((page && page.html) ? page.html.length : 0)) || 0;

  const htmlSnippet = String(
    ((page && page.htmlSnippet) ?? ((page && page.html) ? page.html.slice(0, 600) : "")) || ""
  );

  const blockedHint = guessBlocked(htmlSnippet);

  result._debug = {
    tookMs: Date.now() - startedAt,
    finalUrl: (page && page.finalUrl) || null,
    httpStatus: (page && page.status) ?? null,
    statusText: (page && page.statusText) ?? null,
    contentType: (page && page.contentType) ?? null,
    htmlLength,
    htmlSnippet,
    blockedHint,
    gtmIdsDetected: gtmIds,
    scripts: {
      inlineCount: (page && page.scripts && Array.isArray(page.scripts.inline)) ? page.scripts.inline.length : null,
      externalCount: (page && page.scripts && Array.isArray(page.scripts.external)) ? page.scripts.external.length : null,
      allScripts: Array.isArray(allScripts) ? allScripts.length : 0,
      scriptsWithSrc: Array.isArray(scriptsWithSrc) ? scriptsWithSrc.length : 0,
      injectedGtmScripts: injectedGtmScripts.length,
      externalFetched: Array.isArray(externalScripts) ? externalScripts.length : 0,
      externalsWithContent: Array.isArray(externalScripts)
        ? externalScripts.filter((x) => x && x.content && x.content.length > 0).length
        : 0,
      detectionScripts: Array.isArray(scriptsForDetection) ? scriptsForDetection.length : 0,
    },
  };

  // Extras extendidos solo en includeDetails
  if (includeDetails) {
    result.externalScripts = externalScripts;
    result.duplicates = duplicateEvents;
    result.analysis = eventAnalysis;
  }

  return result;
}
