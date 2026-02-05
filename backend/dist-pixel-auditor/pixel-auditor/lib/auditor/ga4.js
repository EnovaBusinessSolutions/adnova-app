"use strict";
/**
 * Pixel Auditor AI™ - Google Analytics 4 Detector
 * Detecta instalación y configuración de GA4
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectGA4 = detectGA4;
exports.isValidGA4Id = isValidGA4Id;
exports.extractGA4Config = extractGA4Config;

const extractScripts_1 = require("../crawler/extractScripts");

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function makeIssue(code, title, severity, details, evidence) {
  const issue = { platform: "ga4", code, title, severity };
  if (details) issue.details = details;
  if (evidence) issue.evidence = evidence;
  return issue;
}

/**
 * Detecta Google Analytics 4 en una página
 * @param pageContent - Contenido de la página
 * @param scripts - Scripts procesados
 * @returns Resultado de auditoría GA4
 */
function detectGA4(pageContent, scripts) {
  const result = {
    detected: false,
    ids: [],
    errors: [], // compat legacy
    issues: [], // ✅ German-like
    hasScript: false,
    hasConfig: false,
    configFlags: {},
  };

  const html = pageContent?.html || "";
  const scriptsText = (scripts || []).map((s) => s?.content || "").join("\n");
  const allContent = [html, scriptsText].join("\n");

  // Patrón 1: Script de GA4 via gtag.js
  const ga4ScriptPattern = /googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/gi;
  const scriptMatches = (0, extractScripts_1.extractAllMatches)(allContent, ga4ScriptPattern);

  // Patrón 2: gtag config con G-
  const gtagConfigPattern =
    /gtag\s*\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"](?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/gi;
  const configMatches = (0, extractScripts_1.extractAllMatches)(allContent, gtagConfigPattern);

  // Patrón 3: measurement_id en configuración
  const measurementIdPattern = /['"]measurement_id['"]\s*:\s*['"](G-[A-Z0-9]+)['"]/gi;
  const measurementMatches = (0, extractScripts_1.extractAllMatches)(allContent, measurementIdPattern);

  // Patrón 4: G- ID en cualquier contexto de string (filtrado)
  const anyGIdPattern = /['"](G-[A-Z0-9]{6,12})['"]/gi;
  const anyGMatches = (0, extractScripts_1.extractAllMatches)(allContent, anyGIdPattern);

  // Patrón 5: data-attributes con GA4 ID
  const dataAttrPattern = /data-(?:ga4?|analytics|measurement)=['"]?(G-[A-Z0-9]+)['"]?/gi;
  const dataAttrMatches = (0, extractScripts_1.extractAllMatches)(allContent, dataAttrPattern);

  // Patrón 6: Variables JS con GA4 ID
  const jsVarPattern =
    /(?:var|let|const)\s+(?:ga4_?id|measurement_?id|tracking_?id|GA4_ID|MEASUREMENT_ID)\s*=\s*['"](G-[A-Z0-9]+)['"]/gi;
  const jsVarMatches = (0, extractScripts_1.extractAllMatches)(allContent, jsVarPattern);

  // Patrón 7: GA4 en JSON config
  const jsonConfigPattern = /"(?:ga4|measurement_id|tracking_id|analytics_id)"\s*:\s*"(G-[A-Z0-9]+)"/gi;
  const jsonConfigMatches = (0, extractScripts_1.extractAllMatches)(allContent, jsonConfigPattern);

  // Patrón 8: gtag.js con id
  const gtagJsPattern = /gtag\.js\?id=(G-[A-Z0-9]+)/gi;
  const gtagJsMatches = (0, extractScripts_1.extractAllMatches)(allContent, gtagJsPattern);

  // Patrón 9: plataformas
  const platformPattern = /(?:googleAnalytics|ga4Id|gaTrackingId)['"]?\s*[:=]\s*['"](G-[A-Z0-9]+)['"]/gi;
  const platformMatches = (0, extractScripts_1.extractAllMatches)(allContent, platformPattern);

  // Patrón 10: collect endpoint GA4 (g/collect?tid=G-)
  const collectPattern = /google-analytics\.com\/g\/collect\?.*?tid=(G-[A-Z0-9]+)/gi;
  const collectMatches = (0, extractScripts_1.extractAllMatches)(allContent, collectPattern);

  const falsePositives = new Set([
    "G-RECAPTCHA",
    "G-SAMPLING",
    "G-ANIMATION",
    "G-IMAGE",
    "G-VIDEO",
    "G-AUDIO",
  ]);

  const allIds = new Set();
  [
    scriptMatches,
    configMatches,
    measurementMatches,
    anyGMatches,
    dataAttrMatches,
    jsVarMatches,
    jsonConfigMatches,
    gtagJsMatches,
    platformMatches,
    collectMatches,
  ].forEach((matches) => {
    matches.forEach((match) => {
      if (!match[1]) return;

      const originalId = match[1];
      const id = String(originalId).toUpperCase();

      const hasValidFormat = /^G-[A-Z0-9]{6,12}$/i.test(originalId);
      const hasDigit = /\d/.test(id);
      const isNotOnlyLetters = !/^G-[A-Z]+$/i.test(id);
      const isNotFalsePositive = !falsePositives.has(id);
      const hasSuspiciousCasing =
        /[a-z]/.test(originalId) && /[A-Z]/.test(String(originalId).substring(2));

      if (hasValidFormat && hasDigit && isNotOnlyLetters && isNotFalsePositive && !hasSuspiciousCasing) {
        allIds.add(id);
      }
    });
  });

  result.ids = Array.from(allIds);

  // Señales
  const hasAnyGtagScript = /googletagmanager\.com\/gtag\/js/i.test(allContent);
  const hasScript = scriptMatches.length > 0 || gtagJsMatches.length > 0 || hasAnyGtagScript;

  const hasConfig =
    configMatches.length > 0 ||
    measurementMatches.length > 0 ||
    /gtag\s*\(\s*['"]config['"]\s*,/i.test(allContent);

  result.hasScript = !!hasScript;
  result.hasConfig = !!hasConfig;

  // detected: ids o señales de script/config (para que no se “pierda” GA4 por ofuscación)
  result.detected = result.ids.length > 0 || hasScript || hasConfig;

  // Extra: flags de configuración comunes (send_page_view, cookie_domain, etc.)
  try {
    // Buscar send_page_view dentro de config calls
    const cfgFlags = [];
    configMatches.forEach((m) => {
      if (!m[2]) return;
      const flags = extractGA4Config(m[2]);
      if (Object.keys(flags).length) cfgFlags.push(flags);
    });
    // merge superficial
    const merged = {};
    cfgFlags.forEach((f) => Object.assign(merged, f));
    result.configFlags = merged || {};
  } catch {
    result.configFlags = {};
  }

  // --------------------------
  // Issues (German-like)
  // --------------------------
  if (result.detected) {
    // Script sin config
    if (hasScript && !hasConfig) {
      result.errors.push("ga4_script_without_config");
      result.issues.push(
        makeIssue(
          "ga4_script_without_config",
          "GA4 cargado pero no configurado",
          "high",
          "Se detectó la carga de gtag.js (GA4), pero no encontramos gtag('config', 'G-...') ni measurement_id. Esto evita que GA4 envíe PageView/ eventos correctamente.",
          { hasScript: true, hasConfig: false }
        )
      );
    }

    // Config sin script (posible bloqueo CSP/adblock o carga no estándar)
    if (!hasAnyGtagScript && hasConfig) {
      result.errors.push("ga4_config_without_script");
      result.issues.push(
        makeIssue(
          "ga4_config_without_script",
          "GA4 configurado pero sin script detectado",
          "medium",
          "Encontramos configuración de GA4 (gtag('config') o measurement_id), pero no la carga de gtag.js. Puede estar bloqueado por CSP/adblock o cargándose dinámicamente.",
          { hasScript: false, hasConfig: true }
        )
      );
    }

    // Duplicados de gtag() en HTML del sitio
    const siteContent = html;
    const gtagDefinitions = siteContent.match(/function\s+gtag\s*\(\s*\)\s*\{/g);
    if (gtagDefinitions && gtagDefinitions.length > 1) {
      result.errors.push("multiple_gtag_definitions");
      result.issues.push(
        makeIssue(
          "multiple_gtag_definitions",
          "Se detectaron múltiples definiciones de gtag()",
          "medium",
          "El HTML del sitio contiene más de una definición de la función gtag(). Esto puede causar duplicación de eventos o comportamiento inesperado.",
          { count: gtagDefinitions.length }
        )
      );
    }

    // send_page_view: false (si aparece)
    if (result.configFlags && result.configFlags.send_page_view === false) {
      result.issues.push(
        makeIssue(
          "ga4_send_page_view_disabled",
          "send_page_view está desactivado",
          "medium",
          "Se encontró send_page_view: false. En sitios SPA esto puede ser intencional, pero si no se envían PageViews manuales, GA4 podría no registrar visitas.",
          { send_page_view: false }
        )
      );
    }

    // Detectar si NO hay ni un solo gtag('event', ...) en todo el contenido
    const hasGtagEvent = /gtag\s*\(\s*['"]event['"]\s*,/i.test(allContent);
    if (hasConfig && !hasGtagEvent) {
      // no es necesariamente error, pero aporta al “feeling” German
      result.issues.push(
        makeIssue(
          "ga4_no_events_detected",
          "No se detectaron eventos de GA4 en el código",
          "low",
          "GA4 está presente, pero no encontramos llamadas a gtag('event', ...). Si el tracking se maneja por GTM o se dispara tras interacción, esto puede ser normal.",
          { hasConfig: true, hasGtagEvent: false }
        )
      );
    }
  } else {
    // No detectado: nada (pero si quieres, aquí podríamos empujar un issue low)
  }

  return result;
}

/**
 * Verifica si un ID de GA4 es válido
 */
function isValidGA4Id(id) {
  return /^G-[A-Z0-9]{10,}$/.test(id);
}

/**
 * Extrae configuración adicional de GA4
 */
function extractGA4Config(content) {
  const config = {};
  if (!content) return config;

  const patterns = {
    send_page_view: /['"]send_page_view['"]\s*:\s*(true|false)/i,
    cookie_domain: /['"]cookie_domain['"]\s*:\s*['"]([^'"]+)['"]/i,
    cookie_flags: /['"]cookie_flags['"]\s*:\s*['"]([^'"]+)['"]/i,
    anonymize_ip: /['"]anonymize_ip['"]\s*:\s*(true|false)/i,
    debug_mode: /['"]debug_mode['"]\s*:\s*(true|false)/i,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = pattern.exec(content);
    if (match && match[1] != null) {
      config[key] =
        match[1] === "true" ? true : match[1] === "false" ? false : match[1];
    }
  }

  return config;
}
