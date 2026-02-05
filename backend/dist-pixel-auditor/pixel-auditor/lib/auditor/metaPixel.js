"use strict";
/**
 * Pixel Auditor AI™ - Meta Pixel Detector
 * Detecta instalación y configuración de Meta Pixel (Facebook Pixel)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectMetaPixel = detectMetaPixel;
exports.isValidPixelId = isValidPixelId;
exports.detectPixelVersion = detectPixelVersion;
exports.extractPixelConfig = extractPixelConfig;

const extractScripts_1 = require("../crawler/extractScripts");

/**
 * Helpers
 */
function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function makeIssue(code, title, severity, details, evidence) {
  const issue = { platform: "meta", code, title, severity };
  if (details) issue.details = details;
  if (evidence) issue.evidence = evidence;
  return issue;
}

/**
 * Detecta Meta Pixel en una página
 * @param pageContent - Contenido de la página
 * @param scripts - Scripts procesados
 * @returns Resultado de auditoría Meta Pixel
 */
function detectMetaPixel(pageContent, scripts) {
  const result = {
    detected: false,
    ids: [],
    errors: [], // compat legacy
    issues: [], // ✅ para UI rica (German-like)
    hasScript: false,
    hasInit: false,
    hasTrackCalls: false,
  };

  const html = pageContent?.html || "";
  const scriptsText = (scripts || []).map((s) => s?.content || "").join("\n");
  const allContent = [html, scriptsText].join("\n");

  // --------------------------
  // Señales / patrones base
  // --------------------------
  // Script oficial
  const fbScriptPattern =
    /(?:connect\.facebook\.net|facebook\.com)\/[a-z_-]+\/(?:fbevents|sdk)\.js/gi;
  const scriptMatches = (0, extractScripts_1.extractAllMatches)(allContent, fbScriptPattern);

  // fbq definido / snippet
  const hasFbqFunction =
    /fbq\s*=\s*function/i.test(allContent) ||
    /n\s*=\s*f\.fbq\s*=\s*function/i.test(allContent) ||
    /window\.fbq\s*=/i.test(allContent);

  // Init (con ID o sin ID)
  const fbqInitPattern = /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi;
  const initMatches = (0, extractScripts_1.extractAllMatches)(allContent, fbqInitPattern);

  // Init legacy
  const fbqPushInitPattern =
    /_fbq\.push\s*\(\s*\[\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi;
  const pushInitMatches = (0, extractScripts_1.extractAllMatches)(allContent, fbqPushInitPattern);

  // Config / objetos
  const pixelIdConfigPattern =
    /['"]?(?:pixel_?[Ii]d|fb_pixel_id)['"]?\s*[:=]\s*['"]?(\d{10,20})['"]?/gi;
  const configMatches = (0, extractScripts_1.extractAllMatches)(allContent, pixelIdConfigPattern);

  // URL tracking directa
  const fbTrackingUrlPattern = /facebook\.com\/tr\?(?:[^"']*&)?id=(\d{10,20})/gi;
  const trackingUrlMatches = (0, extractScripts_1.extractAllMatches)(allContent, fbTrackingUrlPattern);

  // data-attributes
  const dataAttrPattern =
    /data-(?:fb-?pixel|pixel-id|facebook-pixel)=['"](\d{10,20})['"]/gi;
  const dataAttrMatches = (0, extractScripts_1.extractAllMatches)(allContent, dataAttrPattern);

  // variables JS
  const jsVarPattern =
    /(?:var|let|const)\s+(?:fb_?pixel_?id|pixel_?id|FB_PIXEL_ID)\s*=\s*['"](\d{10,20})['"]/gi;
  const jsVarMatches = (0, extractScripts_1.extractAllMatches)(allContent, jsVarPattern);

  // JSON config
  const jsonConfigPattern =
    /"(?:meta_?pixel|facebook_?pixel|fb_?pixel)"\s*:\s*"(\d{10,20})"/gi;
  const jsonConfigMatches = (0, extractScripts_1.extractAllMatches)(allContent, jsonConfigPattern);

  // fbq.queue init
  const fbqQueuePattern =
    /fbq\.queue\.push\s*\(\s*\[\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi;
  const queueMatches = (0, extractScripts_1.extractAllMatches)(allContent, fbqQueuePattern);

  // Shopify/plataformas
  const shopifyPattern =
    /(?:facebook_pixel_id|fbPixelId)['"]?\s*[:=]\s*['"]?(\d{10,20})['"]?/gi;
  const shopifyMatches = (0, extractScripts_1.extractAllMatches)(allContent, shopifyPattern);

  // --------------------------
  // Track calls (events)
  // --------------------------
  const fbqTrackPattern =
    /fbq\s*\(\s*['"](track|trackCustom)['"]\s*,\s*['"]([A-Za-z0-9_:\-\. ]{2,60})['"]/gi;
  const trackMatches = (0, extractScripts_1.extractAllMatches)(allContent, fbqTrackPattern);

  const fbqPageViewPattern = /fbq\s*\(\s*['"]track['"]\s*,\s*['"]PageView['"]/gi;
  const pageViewMatches = (0, extractScripts_1.extractAllMatches)(allContent, fbqPageViewPattern);

  // --------------------------
  // Recolectar IDs
  // --------------------------
  const allIds = new Set();
  [
    initMatches,
    pushInitMatches,
    configMatches,
    trackingUrlMatches,
    dataAttrMatches,
    jsVarMatches,
    jsonConfigMatches,
    queueMatches,
    shopifyMatches,
  ].forEach((matches) => {
    matches.forEach((m) => {
      if (m[1]) allIds.add(m[1]);
    });
  });

  result.ids = Array.from(allIds);

  // --------------------------
  // Señales de estado
  // --------------------------
  const hasScript = scriptMatches.length > 0 || hasFbqFunction || /fbevents\.js/i.test(allContent);
  const hasInitById = initMatches.length > 0 || pushInitMatches.length > 0 || queueMatches.length > 0;
  // init sin ID visible (a veces se ofusca): fbq('init', somethingVariable)
  const hasInitUnknownId = /fbq\s*\(\s*['"]init['"]\s*,/i.test(allContent) && !hasInitById;

  const hasAnyInit = hasInitById || hasInitUnknownId;
  const hasAnyTrack = trackMatches.length > 0 || pageViewMatches.length > 0;

  result.hasScript = !!hasScript;
  result.hasInit = !!hasAnyInit;
  result.hasTrackCalls = !!hasAnyTrack;

  // detected: si hay ID o si hay script/snippet
  result.detected = result.ids.length > 0 || hasScript;

  // --------------------------
  // Issues (German-like)
  // --------------------------
  // 1) Script presente pero sin init
  if (hasScript && !hasAnyInit) {
    result.errors.push("pixel_script_without_init");
    result.issues.push(
      makeIssue(
        "pixel_script_without_init",
        "Meta Pixel cargado pero no inicializado",
        "high",
        "Se detectó el script/snippet de Meta Pixel, pero no encontramos una inicialización (fbq('init', ...)). Esto evita que el pixel registre eventos correctamente.",
        {
          foundScript: true,
          foundInit: false,
        }
      )
    );
  }

  // 2) Init presente pero sin script/snippet
  if (!hasScript && hasAnyInit) {
    result.errors.push("pixel_init_without_script");
    result.issues.push(
      makeIssue(
        "pixel_init_without_script",
        "Meta Pixel inicializado sin script",
        "medium",
        "Encontramos fbq('init', ...) pero no se detectó la carga del script oficial (fbevents.js) ni el snippet completo. Puede estar bloqueado por CSP/adblock o cargándose de forma no estándar.",
        {
          foundScript: false,
          foundInit: true,
        }
      )
    );
  }

  // 3) ID no encontrado (pero hay script)
  if (hasScript && result.ids.length === 0) {
    result.errors.push("pixel_id_not_found");
    result.issues.push(
      makeIssue(
        "pixel_id_not_found",
        "No se detectó el Pixel ID",
        "medium",
        "Hay señales de Meta Pixel, pero no encontramos el Pixel ID. Puede estar ofuscado, venir por GTM o cargarse dinámicamente.",
        { foundScript: true }
      )
    );
  }

  // 4) Init sin eventos track/trackCustom/PageView
  //    (esto es MUY típico: instalado pero sin eventos => score baja como en German)
  if (hasAnyInit && !hasAnyTrack) {
    result.issues.push(
      makeIssue(
        "pixel_no_track_calls",
        "Meta Pixel sin eventos detectables",
        "medium",
        "Se detectó inicialización del pixel, pero no encontramos llamadas a fbq('track' | 'trackCustom') ni PageView. Si tu sitio es SPA o los eventos se disparan tarde, podrían no verse sin navegación/interacción.",
        { foundInit: true, foundTrack: false }
      )
    );
  }

  // 5) Duplicados (en HTML del sitio)
  const siteContent = html;

  const fbqDefinitions = siteContent.match(/n\s*=\s*f\.fbq\s*=\s*function|window\.fbq\s*=/g);
  if (fbqDefinitions && fbqDefinitions.length > 1) {
    result.errors.push("multiple_fbq_definitions");
    result.issues.push(
      makeIssue(
        "multiple_fbq_definitions",
        "Meta Pixel definido múltiples veces",
        "medium",
        "Se encontró más de una definición de fbq en el HTML del sitio. Esto puede duplicar eventos o romper el tracking.",
        { count: fbqDefinitions.length }
      )
    );
  }

  // Init múltiple en HTML del sitio
  const siteInitMatches = (0, extractScripts_1.extractAllMatches)(
    siteContent,
    /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi
  );

  if (siteInitMatches.length > 0) {
    const siteIds = siteInitMatches.map((m) => m[1]).filter(Boolean);
    const siteUniqueIds = uniq(siteIds);

    if (siteInitMatches.length > siteUniqueIds.length) {
      result.errors.push("pixel_init_multiple_times");
      result.issues.push(
        makeIssue(
          "pixel_init_multiple_times",
          "Meta Pixel inicializado múltiples veces",
          "medium",
          "Se detectaron múltiples llamadas a fbq('init', ...) con el mismo Pixel ID. Esto puede duplicar eventos.",
          { totalInits: siteInitMatches.length, uniqueIds: siteUniqueIds }
        )
      );
    }
  }

  // 6) NoScript fallback (warning)
  const hasNoscript = /<noscript[^>]*>[\s\S]*?facebook\.com\/tr\?(?:[^"']*&)?id=/i.test(allContent);
  if (!hasNoscript && result.ids.length > 0) {
    result.errors.push("missing_noscript_fallback");
    result.issues.push(
      makeIssue(
        "missing_noscript_fallback",
        "Falta fallback noscript",
        "low",
        "No se detectó el fallback <noscript> para el pixel. No es crítico, pero ayuda a medir en casos muy limitados.",
        { foundNoscript: false }
      )
    );
  }

  return result;
}

/**
 * Verifica si un Pixel ID es válido
 * @param id - ID a verificar
 * @returns true si es válido
 */
function isValidPixelId(id) {
  return /^\d{10,20}$/.test(id);
}

/**
 * Detecta la versión del código de Meta Pixel
 * @param content - Contenido donde buscar
 * @returns Versión detectada
 */
function detectPixelVersion(content) {
  const hasLegacy = /_fbq\.push/.test(content);
  const hasModern = /fbq\s*\(\s*['"]init['"]/.test(content);
  const hasAutoConfig =
    /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{15,16})['"]\s*,\s*\{.*?autoConfig/.test(content);

  let version = "unknown";
  if (hasModern) version = "modern";
  else if (hasLegacy) version = "legacy";

  return { version, hasAutoConfig };
}

/**
 * Detecta configuraciones avanzadas de Meta Pixel
 * @param content - Contenido donde buscar
 * @returns Configuraciones encontradas
 */
function extractPixelConfig(content) {
  const config = {};

  const autoConfigMatch = /autoConfig['"]\s*:\s*(true|false)/i.exec(content);
  if (autoConfigMatch) config.autoConfig = autoConfigMatch[1] === "true";

  const debugMatch = /debug['"]\s*:\s*(true|false)/i.exec(content);
  if (debugMatch) config.debug = debugMatch[1] === "true";

  return config;
}
