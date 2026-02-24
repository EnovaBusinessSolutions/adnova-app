"use strict";
/**
 * Pixel Auditor AI™ - Google Ads Detector
 * Detecta instalación y configuración de Google Ads (gtag con AW-)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectGoogleAds = detectGoogleAds;
exports.isValidGoogleAdsId = isValidGoogleAdsId;
exports.extractGoogleAdsConfig = extractGoogleAdsConfig;

const extractScripts_1 = require("../crawler/extractScripts");

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function makeIssue(code, title, severity, details, evidence) {
  const issue = { platform: "gads", code, title, severity };
  if (details) issue.details = details;
  if (evidence) issue.evidence = evidence;
  return issue;
}

function safeBool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * Detecta Google Ads en una página
 * @param pageContent - Contenido de la página
 * @param scripts - Scripts procesados
 * @returns Resultado de auditoría Google Ads
 */
function detectGoogleAds(pageContent, scripts) {
  const result = {
    detected: false,
    ids: [],
    errors: [], // compat legacy
    issues: [], // ✅ German-like
    conversions: [],
    hasScript: false,
    hasConfig: false,
    hasConversions: false,
    hasConversionLinker: false,
    configFlags: {},
  };

  const html = pageContent?.html || "";
  const scriptsText = (scripts || []).map((s) => s?.content || "").join("\n");
  const allContent = [html, scriptsText].join("\n");

  // Patrón 1: Script de Google Ads via gtag.js?id=AW-XXXX
  const googleAdsScriptPattern = /googletagmanager\.com\/gtag\/js\?id=(AW-\d+)/gi;
  const scriptMatches = (0, extractScripts_1.extractAllMatches)(allContent, googleAdsScriptPattern);

  // Patrón 2: gtag config con AW-
  const gtagConfigPattern =
    /gtag\s*\(\s*['"]config['"]\s*,\s*['"](AW-\d+)['"](?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/gi;
  const configMatches = (0, extractScripts_1.extractAllMatches)(allContent, gtagConfigPattern);

  // Patrón 3: Conversion tracking con send_to (AW-XXXX/label)
  const conversionPattern =
    /gtag\s*\(\s*['"]event['"]\s*,\s*['"]conversion['"]\s*,\s*\{[\s\S]*?['"]send_to['"]\s*:\s*['"](AW-\d+(?:\/[^'"]+)?)['"][\s\S]*?\}\s*\)/gi;
  const conversionMatches = (0, extractScripts_1.extractAllMatches)(allContent, conversionPattern);

  // Patrón 4: gtag_report_conversion (común)
  const reportConversionPattern = /gtag_report_conversion\s*\([^)]*\)|function\s+gtag_report_conversion/gi;
  const hasReportConversion = reportConversionPattern.test(allContent);

  // Patrón 5: AW- ID en cualquier contexto
  const anyAwIdPattern = /['"](AW-\d{9,12})['"]/gi;
  const anyAwMatches = (0, extractScripts_1.extractAllMatches)(allContent, anyAwIdPattern);

  // Patrón 6: conversion linker / pagead conversion
  const conversionLinkerPattern =
    /googleads\.g\.doubleclick\.net|www\.googleadservices\.com\/pagead\/conversion\/(AW-?\d+|\d+)/gi;
  const linkerMatches = (0, extractScripts_1.extractAllMatches)(allContent, conversionLinkerPattern);

  // Patrón 7: data-attributes con AW ID
  const dataAttrPattern = /data-(?:google-?ads?|conversion|aw)=['"]?(AW-\d+)['"]?/gi;
  const dataAttrMatches = (0, extractScripts_1.extractAllMatches)(allContent, dataAttrPattern);

  // Patrón 8: Variables JS con AW ID
  const jsVarPattern =
    /(?:var|let|const)\s+(?:google_?ads?_?id|aw_?id|conversion_?id)\s*=\s*['"](AW-\d+)['"]/gi;
  const jsVarMatches = (0, extractScripts_1.extractAllMatches)(allContent, jsVarPattern);

  // Patrón 9: Google Ads en JSON config
  const jsonConfigPattern = /"(?:google_?ads?|aw_?id|adwords)"\s*:\s*"(AW-\d+)"/gi;
  const jsonConfigMatches = (0, extractScripts_1.extractAllMatches)(allContent, jsonConfigPattern);

  // Patrón 10: Conversion ID numérico (sin prefijo AW-)
  const numericConversionPattern = /googleadservices\.com\/pagead\/conversion\/(\d{9,12})/gi;
  const numericMatches = (0, extractScripts_1.extractAllMatches)(allContent, numericConversionPattern);

  // Patrón 11: goog_report_conversion("AW-XXXX")
  const googReportPattern = /goog_report_conversion\s*\(\s*['"](AW-\d+)/gi;
  const googReportMatches = (0, extractScripts_1.extractAllMatches)(allContent, googReportPattern);

  // --------------------------
  // IDs
  // --------------------------
  const allIds = new Set();

  [scriptMatches, configMatches, anyAwMatches, dataAttrMatches, jsVarMatches, jsonConfigMatches, googReportMatches].forEach(
    (matches) => {
      matches.forEach((match) => {
        if (match[1]) allIds.add(match[1]);
      });
    }
  );

  // IDs de conversiones -> baseId (AW-XXXX)
  const allConversions = [];
  conversionMatches.forEach((match) => {
    if (!match[1]) return;
    allConversions.push(match[1]);
    const baseId = match[1].split("/")[0];
    if (baseId) allIds.add(baseId);
  });

  // IDs numéricos -> AW-#########
  numericMatches.forEach((match) => {
    if (match[1]) allIds.add(`AW-${match[1]}`);
  });

  // IDs del linker
  linkerMatches.forEach((match) => {
    if (!match[1]) return;
    const id = match[1].startsWith("AW-") ? match[1] : `AW-${match[1]}`;
    if (/^AW-\d{9,12}$/.test(id)) allIds.add(id);
  });

  result.ids = Array.from(allIds);
  result.conversions = uniq(allConversions);

  // Señales
  const hasAnyGtagScript = /googletagmanager\.com\/gtag\/js/i.test(allContent);
  const hasScript = scriptMatches.length > 0 || hasAnyGtagScript;
  const hasConfig = configMatches.length > 0 || /gtag\s*\(\s*['"]config['"]\s*,\s*['"]AW-/i.test(allContent);

  const hasConversions =
    result.conversions.length > 0 ||
    /['"]send_to['"]\s*:\s*['"]AW-\d+\//i.test(allContent) ||
    /gtag\s*\(\s*['"]event['"]\s*,\s*['"]conversion['"]/i.test(allContent);

  const hasConversionLinker =
    linkerMatches.length > 0 ||
    /googleadservices\.com\/pagead\/conversion/i.test(allContent) ||
    /googleads\.g\.doubleclick\.net/i.test(allContent);

  result.hasScript = !!hasScript;
  result.hasConfig = !!hasConfig;
  result.hasConversions = !!hasConversions;
  result.hasConversionLinker = !!hasConversionLinker;

  // detected: ids o señales report_conversion o linker
  result.detected = result.ids.length > 0 || hasReportConversion || hasConversionLinker;

  // --------------------------
  // Config flags (best-effort)
  // --------------------------
  try {
    const flags = {};
    configMatches.forEach((m) => {
      if (!m[2]) return;
      const cfg = extractGoogleAdsConfig(m[2]);
      if (cfg && typeof cfg === "object") Object.assign(flags, cfg);
    });
    result.configFlags = flags || {};
  } catch {
    result.configFlags = {};
  }

  // --------------------------
  // Issues (German-like)
  // --------------------------
  if (result.detected) {
    // Script sin config
    if (hasScript && !hasConfig) {
      result.errors.push("google_ads_script_without_config");
      result.issues.push(
        makeIssue(
          "google_ads_script_without_config",
          "Google Ads cargado pero no configurado",
          "high",
          "Se detectó gtag.js con AW-XXXX, pero no encontramos gtag('config', 'AW-...'). Esto puede impedir que el tag funcione correctamente.",
          { hasScript: true, hasConfig: false }
        )
      );
    }

    // Config sin script
    if (!hasAnyGtagScript && hasConfig) {
      result.errors.push("google_ads_config_without_script");
      result.issues.push(
        makeIssue(
          "google_ads_config_without_script",
          "Google Ads configurado pero sin script detectado",
          "medium",
          "Encontramos configuración de Google Ads (AW) pero no la carga de gtag.js. Puede estar bloqueado por CSP/adblock o cargándose dinámicamente.",
          { hasScript: false, hasConfig: true }
        )
      );
    }

    // Conversion linker detectado pero sin conversiones
    if (hasConversionLinker && !hasConversions) {
      result.issues.push(
        makeIssue(
          "google_ads_linker_without_conversions",
          "Se detectó tracking de Google Ads, pero no conversiones",
          "medium",
          "Vemos señales de Google Ads (conversion linker / pagead conversion), pero no se detectaron eventos de conversión con send_to (AW-.../LABEL). Si estás invirtiendo en Ads, esto limita la medición.",
          { hasConversionLinker: true, hasConversions: false }
        )
      );
    }

    // AW configurado pero sin conversiones
    if ((hasConfig || result.ids.length > 0) && !hasConversions) {
      result.issues.push(
        makeIssue(
          "google_ads_no_conversions_detected",
          "No se detectaron conversiones de Google Ads",
          "high",
          "Se detectó el ID de Google Ads (AW), pero no encontramos gtag('event','conversion',{send_to:'AW-.../LABEL'}). Esto suele indicar que no estás midiendo conversiones.",
          { awIds: result.ids.slice(0, 5), conversions: [] }
        )
      );
    }

    // Conversiones sin label (AW-XXXX sin /LABEL)
    const badSendTo = [];
    result.conversions.forEach((c) => {
      if (typeof c !== "string") return;
      if (/^AW-\d+$/i.test(c.trim())) badSendTo.push(c.trim());
    });
    if (badSendTo.length > 0) {
      result.issues.push(
        makeIssue(
          "google_ads_send_to_missing_label",
          "Conversiones con send_to incompleto (sin label)",
          "high",
          "Detectamos send_to con AW-XXXX sin el sufijo /LABEL. En Google Ads, el formato esperado es AW-XXXXXXXXX/LABEL para conversiones específicas.",
          { send_to: badSendTo.slice(0, 10) }
        )
      );
    }

    // gtag_report_conversion presente pero no se detecta send_to
    if (hasReportConversion && !hasConversions) {
      result.issues.push(
        makeIssue(
          "google_ads_report_conversion_without_send_to",
          "Función de conversión detectada, pero sin send_to",
          "medium",
          "Se detectó gtag_report_conversion (típico de botones/CTAs), pero no encontramos send_to configurado. Puede que el flujo esté incompleto o dependa de variables dinámicas.",
          { hasReportConversion: true }
        )
      );
    }

    // Múltiples AW IDs (posible duplicidad / cuentas mezcladas)
    if (result.ids.length > 1) {
      result.issues.push(
        makeIssue(
          "google_ads_multiple_aw_ids",
          "Se detectaron múltiples IDs de Google Ads",
          "medium",
          "Hay más de un AW-XXXX en el sitio. Esto puede ser intencional (varias cuentas), pero a menudo causa medición duplicada o configuración confusa.",
          { awIds: result.ids.slice(0, 10) }
        )
      );
    }

    // Sugerencia: Enhanced conversions (si no se ve allow_enhanced_conversions)
    const hasEnhanced =
      safeBool(result.configFlags?.hasEnhancedConversions) ||
      /allow_enhanced_conversions\s*:\s*true/i.test(allContent) ||
      /enhanced_conversions/i.test(allContent);

    if (!hasEnhanced && (hasConversions || hasReportConversion)) {
      result.issues.push(
        makeIssue(
          "google_ads_enhanced_conversions_not_detected",
          "No se detectó Enhanced Conversions",
          "low",
          "Si tu sitio captura leads/checkout, Enhanced Conversions puede mejorar la atribución. No detectamos señales de allow_enhanced_conversions.",
          { hasEnhancedConversions: false }
        )
      );
    }
  }

  return result;
}

/**
 * Verifica si un ID de Google Ads es válido
 */
function isValidGoogleAdsId(id) {
  return /^AW-[0-9]{9,12}$/.test(id);
}

/**
 * Extrae la configuración de Google Ads de una página
 */
function extractGoogleAdsConfig(content) {
  const ids = [];
  const conversions = [];

  if (!content) {
    return { ids, conversions, hasEnhancedConversions: false, hasRemarketingTag: false };
  }

  // Extraer IDs
  const idPattern = /['"]?(AW-[0-9]+)['"]?/gi;
  let match;
  while ((match = idPattern.exec(content)) !== null) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }

  // Extraer conversiones (AW-XXXX/label)
  const conversionPattern = /AW-[0-9]+\/[A-Za-z0-9_-]+/g;
  while ((match = conversionPattern.exec(content)) !== null) {
    if (!conversions.includes(match[0])) conversions.push(match[0]);
  }

  const hasEnhancedConversions =
    /allow_enhanced_conversions\s*:\s*true/i.test(content) ||
    /enhanced_conversions/i.test(content);

  const hasRemarketingTag =
    /remarketing_only\s*:\s*true/i.test(content) ||
    /google_remarketing_only/i.test(content);

  return {
    ids,
    conversions,
    hasEnhancedConversions,
    hasRemarketingTag,
  };
}
