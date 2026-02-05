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
    ga4?.healthScore ??
    ga4?.score ??
    metaPixel?.healthScore ??
    metaPixel?.score ??
    googleAds?.healthScore ??
    googleAds?.score;

  if (Number.isFinite(Number(candidate))) {
    return clamp(Number(candidate), 0, 100);
  }

  const hasGA4 =
    !!ga4?.detected ||
    (Array.isArray(ga4?.ids) && ga4.ids.length > 0) ||
    !!ga4?.measurementId;

  const hasMeta =
    !!metaPixel?.detected ||
    (Array.isArray(metaPixel?.ids) && metaPixel.ids.length > 0);

  const hasGTM =
    !!gtm?.detected ||
    (Array.isArray(gtm?.ids) && gtm.ids.length > 0) ||
    !!gtm?.containerId;

  const hasGAds =
    !!googleAds?.detected ||
    (Array.isArray(googleAds?.ids) && googleAds.ids.length > 0);

  let score = 100;

  if (!hasGA4) score -= 25;
  if (!hasMeta) score -= 25;

  if (!hasGTM) score -= 10;
  if (!hasGAds) score -= 10;

  const iss = Array.isArray(issues) ? issues : [];
  let penalty = 0;
  iss.forEach((it) => {
    penalty += severityWeight(it?.severity);
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

  if (s.includes("cloudflare") && (s.includes("challenge") || s.includes("attention required")))
    return "cloudflare_challenge";

  if (s.includes("akamai") && (s.includes("reference #") || s.includes("access denied")))
    return "akamai_block";

  if (s.includes("imperva") && (s.includes("incident id") || s.includes("access denied")))
    return "imperva_block";

  if (s.includes("incapsula") && (s.includes("incident id") || s.includes("request unsuccessful")))
    return "incapsula_block";

  if (s.includes("bot") && s.includes("detected")) return "bot_detected";

  // hints genéricos que salen mucho
  if (s.includes("checking your browser")) return "challenge_checking_browser";
  if (s.includes("enable javascript")) return "challenge_enable_js";

  return null;
}

async function runPixelAudit(url, includeDetails = false) {
  const startedAt = Date.now();

  // 1) Descargar HTML + metadatos
  const page = await (0, fetchPage_1.fetchPage)(url);

  // 2) Extraer scripts (internos + externos)
  const allScripts = (0, extractScripts_1.getAllScripts)(page);

  // 3) Preparar lista de scripts externos (src) para descargar contenido relevante
  const scriptsWithSrc = (Array.isArray(allScripts) ? allScripts : [])
    .filter((s) => typeof s?.src === "string" && s.src.length > 0)
    .map((s) => ({ src: s.src, content: s.content }));

  // 4) Descargar scripts externos relevantes (primera pasada)
  let externalScripts = [];
  try {
    const siteUrl = page.finalUrl || url;
    externalScripts = await (0, extractScripts_1.fetchRelevantExternalScripts)(scriptsWithSrc, siteUrl);
  } catch {
    externalScripts = [];
  }

  // 5) Merge robusto (relativo vs absoluto) + normaliza src
  const siteUrlForResolve = page.finalUrl || url;

  function resolveSrcToAbs(src) {
    try {
      if (!src) return "";
      if (src.startsWith("//")) return "https:" + src;
      if (/^https?:\/\//i.test(src)) return src;
      return new URL(src, siteUrlForResolve).href; // cubre "/x.js" y "x.js"
    } catch {
      return String(src || "");
    }
  }

  // === FALLBACK DE EMERGENCIA ===
  // Si el filtro "relevant" no bajó nada, pero sí hay scripts externos,
  // bajamos un "top N" (sin romper performance) para no quedarnos ciegos.
  try {
    const hasAnySrc = Array.isArray(scriptsWithSrc) && scriptsWithSrc.length > 0;
    const fetchedNone = !Array.isArray(externalScripts) || externalScripts.length === 0;

    if (hasAnySrc && fetchedNone) {
      const siteUrl = page.finalUrl || url;
      const maxFallback = 18;

      // elegimos los primeros N (muchas veces bundles principales están ahí)
      const top = scriptsWithSrc.slice(0, maxFallback).map((x) => ({
        src: resolveSrcToAbs(x.src),
        content: x.content,
      }));

      // si existe helper en extractScripts para bajar, úsalo; si no, usa fetchExternalScript directo
      // Nota: fetchExternalScript vive en fetchPage.js, pero aquí no lo importamos para no cambiar imports.
      // Entonces: reusamos fetchRelevantExternalScripts con una lista ya "recortada" (mejor que nada).
      externalScripts = await (0, extractScripts_1.fetchRelevantExternalScripts)(top, siteUrl);
    }
  } catch {
    // si falla el fallback no pasa nada; seguimos con lo que haya
  }

  const externalByAbsSrc = new Map();
  (Array.isArray(externalScripts) ? externalScripts : []).forEach((es) => {
    const key = resolveSrcToAbs(es?.src);
    if (key) externalByAbsSrc.set(key, es);
  });

  const scriptsForDetection = (Array.isArray(allScripts) ? allScripts : []).map((s) => {
    if (!s || !s.src) return s;
    const abs = resolveSrcToAbs(s.src);
    const hit = externalByAbsSrc.get(abs);

    if (hit) {
      return {
        ...s,
        src: abs,
        excludeFromEvents: hit.excludeFromEvents ?? s.excludeFromEvents,
        content: hit.content || s.content,
      };
    }

    return { ...s, src: abs };
  });

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
    (shopifySignals.shopifyAppsDetected?.length ?? 0) > 0;

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
    ...normalizeIssues(ga4?.issues),
    ...normalizeIssues(gtm?.issues),
    ...normalizeIssues(metaPixel?.issues),
    ...normalizeIssues(googleAds?.issues),
    ...normalizeIssues(eventAnalysis),
  ];

  // 10) Summary real
  const trackingHealthScore = computeTrackingHealth({
    ga4,
    gtm,
    metaPixel,
    googleAds,
    issues,
  });

  const recommendations = [];

  // 11) Construir respuesta
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

  // ✅ Debug SIEMPRE (clave para saber por qué sale todo en 0)
  const htmlLength = Number(page?.htmlLength ?? (page?.html ? page.html.length : 0)) || 0;

  const htmlSnippet = String(
    (page?.htmlSnippet ?? (page?.html ? page.html.slice(0, 600) : "")) || ""
  );

  const blockedHint = guessBlocked(htmlSnippet);

  result._debug = {
    tookMs: Date.now() - startedAt,
    finalUrl: page?.finalUrl || null,
    httpStatus: page?.status ?? null,
    statusText: page?.statusText ?? null,
    contentType: page?.contentType ?? null,
    htmlLength,
    htmlSnippet,
    blockedHint,
    scripts: {
      inlineCount: Array.isArray(page?.scripts?.inline) ? page.scripts.inline.length : null,
      externalCount: Array.isArray(page?.scripts?.external) ? page.scripts.external.length : null,
      allScripts: Array.isArray(allScripts) ? allScripts.length : 0,
      scriptsWithSrc: Array.isArray(scriptsWithSrc) ? scriptsWithSrc.length : 0,
      externalFetched: Array.isArray(externalScripts) ? externalScripts.length : 0,
      externalsWithContent: Array.isArray(externalScripts)
        ? externalScripts.filter((x) => x && x.content && x.content.length > 0).length
        : 0,
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
