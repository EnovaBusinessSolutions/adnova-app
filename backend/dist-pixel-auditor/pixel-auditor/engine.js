"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPixelAudit = runPixelAudit;
// backend/pixel-auditor/engine.ts
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
  // ✅ Intentar usar score del detector si existe (futuro)
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

  // Fallback estilo German: base por instalaciones + penalizaciones por issues
  const hasGA4 =
    !!ga4?.detected || (Array.isArray(ga4?.ids) && ga4.ids.length > 0) || !!ga4?.measurementId;
  const hasMeta =
    !!metaPixel?.detected || (Array.isArray(metaPixel?.ids) && metaPixel.ids.length > 0);
  const hasGTM =
    !!gtm?.detected || (Array.isArray(gtm?.ids) && gtm.ids.length > 0) || !!gtm?.containerId;
  const hasGAds =
    !!googleAds?.detected || (Array.isArray(googleAds?.ids) && googleAds.ids.length > 0);

  let score = 100;

  // Core
  if (!hasGA4) score -= 25;
  if (!hasMeta) score -= 25;

  // Soft
  if (!hasGTM) score -= 10;
  if (!hasGAds) score -= 10;

  // Penalizar por issues (pero sin destruir el score)
  const iss = Array.isArray(issues) ? issues : [];
  let penalty = 0;
  iss.forEach((it) => {
    penalty += severityWeight(it?.severity);
  });

  // cap penalty
  penalty = clamp(penalty, 0, 40);
  score -= penalty;

  return clamp(score, 0, 100);
}

async function runPixelAudit(url, includeDetails = false) {
  // 1) Descargar HTML + metadatos
  const page = await (0, fetchPage_1.fetchPage)(url);

  // 2) Extraer scripts (internos + externos)
  const allScripts = (0, extractScripts_1.getAllScripts)(page);

  // 3) Preparar lista de scripts externos (src) para descargar contenido relevante
  const scriptsWithSrc = allScripts
    .filter((s) => typeof s.src === "string" && s.src.length > 0)
    .map((s) => ({ src: s.src, content: s.content }));

  // ✅ 4) Descargar scripts externos relevantes SIEMPRE
  let externalScripts = [];
  try {
    const siteUrl = page.finalUrl || url;
    externalScripts = await (0, extractScripts_1.fetchRelevantExternalScripts)(
      scriptsWithSrc,
      siteUrl
    );
  } catch (e) {
    externalScripts = [];
  }

    // ✅ 5) Unir contenido descargado al script original para que detectores vean "content"
  // Problema real: allScripts trae s.src a veces RELATIVA (/assets/app.js)
  // pero externalScripts trae ABSOLUTA (https://dominio.com/assets/app.js)
  // => si comparas "===" no matchea y pierdes contenido/eventos/issues.
  const siteUrlForResolve = page.finalUrl || url;

  function resolveSrcToAbs(src) {
    try {
      if (!src) return "";
      // //cdn...  => https://cdn...
      if (src.startsWith("//")) return "https:" + src;
      // http(s)...
      if (/^https?:\/\//i.test(src)) return src;
      // relativo => resolver contra siteUrl
      const base = new URL(siteUrlForResolve);
      return new URL(src, base.origin).toString();
    } catch {
      return String(src || "");
    }
  }

  // índice rápido por src absoluta
  const externalByAbsSrc = new Map();
  (Array.isArray(externalScripts) ? externalScripts : []).forEach((es) => {
    const key = resolveSrcToAbs(es?.src);
    if (key) externalByAbsSrc.set(key, es);
  });

  const scriptsForDetection =
    Array.isArray(externalScripts) && externalScripts.length
      ? allScripts.map((s) => {
          if (!s || !s.src) return s;

          const abs = resolveSrcToAbs(s.src);
          const hit = externalByAbsSrc.get(abs);

          // ✅ IMPORTANTE: conservar flags (excludeFromEvents) y cualquier extra futuro del crawler
          return hit
            ? { ...s, ...hit, content: hit.content || s.content }
            : s;
        })
      : allScripts;


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
  const eventAnalysis = (0, events_1.validateEventParameters)(events); // ✅ ahora devuelve issues listos

  // ✅ 9) Consolidar issues (como German)
  const issues = [
    ...normalizeIssues(ga4?.issues),
    ...normalizeIssues(gtm?.issues),
    ...normalizeIssues(metaPixel?.issues),
    ...normalizeIssues(googleAds?.issues),
    ...normalizeIssues(eventAnalysis),
  ];

  // ✅ 10) Summary real
  const trackingHealthScore = computeTrackingHealth({
    ga4,
    gtm,
    metaPixel,
    googleAds,
    issues,
  });

  const recommendations = [];
  // si detectores generan recs en el futuro, aquí se agregan
  // por ahora lo dejamos vacío: la ruta /pixelAuditor.js ya arma recomendaciones base

  // 11) Construir respuesta (shape estable)
  const result = {
    status: "ok",
    url, // ✅ NO uses page.url (no existe en PageContent)
    ga4,
    gtm,
    metaPixel,
    googleAds,

    merchantCenter: { detected: false, ids: [], errors: [] },
    shopify,

    events,
    issues, // ✅ SIEMPRE presente

    summary: {
      trackingHealthScore,
      issuesCount: issues.length,
      eventsCount: Array.isArray(events) ? events.length : 0,
      recommendations,
    },
  };

  // 12) Extras en modo detallado (debug)
  if (includeDetails) {
    result.externalScripts = externalScripts;
    result.duplicates = duplicateEvents;
    result.analysis = eventAnalysis;
  }

  return result;
}
