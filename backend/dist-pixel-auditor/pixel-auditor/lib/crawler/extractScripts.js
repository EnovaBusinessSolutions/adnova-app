"use strict";
/**
 * Pixel Auditor AI™ - Script Extractor
 * Módulo para extraer y procesar scripts de páginas web
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllScripts = getAllScripts;
exports.fetchRelevantExternalScripts = fetchRelevantExternalScripts;
exports.searchInScripts = searchInScripts;
exports.extractAllMatches = extractAllMatches;
exports.extractGtmIds = extractGtmIds;

const fetchPage_1 = require("./fetchPage");

/**
 * Convierte el contenido de una página en una lista unificada de scripts
 * @param pageContent - Contenido de la página (HTML + scripts)
 * @returns Array de información de scripts
 */
function getAllScripts(pageContent) {
  const allScripts = [];

  // Agregar scripts inline
  (pageContent?.scripts?.inline || []).forEach((content, index) => {
    allScripts.push({
      type: "inline",
      content,
      line: index + 1,
    });
  });

  // Agregar scripts externos (solo la referencia, sin descargar aún)
  (pageContent?.scripts?.external || []).forEach((script, index) => {
    allScripts.push({
      type: "external",
      content: (script && script.content) || "",
      src: script && script.src,
      line: (pageContent?.scripts?.inline || []).length + index + 1,
    });
  });

  return allScripts;
}

/* =========================
 * Helpers de normalización
 * ========================= */

function safeUrlString(u, fallback) {
  const s = String(u || "").trim();
  return s ? s : fallback;
}

function toAbsUrl(src, baseUrl) {
  const s = String(src || "").trim();
  if (!s) return "";
  try {
    // //cdn... => https://cdn...
    if (s.startsWith("//")) return "https:" + s;
    // absolute
    if (/^https?:\/\//i.test(s)) return s;
    // relative
    return new URL(s, baseUrl).toString();
  } catch {
    return "";
  }
}

function getBaseDomain(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^www\./, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 2) return h;
  return parts.slice(-2).join(".");
}

function isSameSiteHost(scriptHost, siteHost, siteBaseDomain, siteOrigin) {
  const sh = String(scriptHost || "").toLowerCase();
  const dh = String(siteHost || "").toLowerCase();
  const bd = String(siteBaseDomain || "").toLowerCase();

  if (!sh) return false;

  // 1) mismo host exacto
  if (dh && sh === dh) return true;

  // 2) termina con el baseDomain (más estable que includes)
  if (bd && (sh === bd || sh.endsWith("." + bd))) return true;

  // 3) fallback: si coincide con origin (por si el host se resuelve igual)
  if (siteOrigin) {
    try {
      const so = new URL(siteOrigin);
      if (so.hostname && so.hostname.toLowerCase() === sh) return true;
    } catch {}
  }

  return false;
}

/**
 * Descarga el contenido de scripts externos relevantes para auditoría
 * @param externalScripts - Array de scripts externos (con src)
 * @param siteUrl - URL del sitio para identificar scripts del mismo dominio y resolver URLs relativas
 * @returns Scripts con contenido descargado
 */
async function fetchRelevantExternalScripts(externalScripts, siteUrl) {
  const relevantScripts = [];

  // ✅ fallback seguro para resolver URLs relativas
  const safeSiteUrl = safeUrlString(siteUrl, "https://example.com/");

  // Obtener info del sitio
  let siteOrigin = "";
  let siteDomain = "";
  let siteBaseDomain = "";

  try {
    const u = new URL(safeSiteUrl);
    siteOrigin = u.origin;
    siteDomain = u.hostname;
    siteBaseDomain = getBaseDomain(siteDomain);
  } catch {
    // se queda con strings vacíos
  }

  // Lista de dominios de terceros para excluir de análisis de eventos
  const excludeFromEventAnalysis = [
    "facebook.net",
    "connect.facebook.net",
    "fbevents.js",
    "google-analytics.com",
    "googleadservices.com",
    "doubleclick.net",
    "googlesyndication.com",
    "cdn.segment.com",
    "cdn.amplitude.com",
    "cdn.mxpnl.com",
    "hotjar.com",
    "clarity.ms",
    "intercom.io",
    "crisp.chat",
    "tawk.to",
  ].map((x) => String(x).toLowerCase());

  // ✅ tracking scripts que SIEMPRE descargamos aunque sean terceros
  const trackingAllowlist = [
    "googletagmanager.com", // GTM
    "gtm.js",
    "gtag/js",
  ].map((x) => String(x).toLowerCase());

  // 1) Normalizar + deduplicar por src absoluto (case-insensitive)
  const dedup = new Map();
  (externalScripts || []).forEach((script) => {
    const rawSrc = script && script.src;
    const abs = toAbsUrl(rawSrc, safeSiteUrl);
    if (!abs) return;
    const key = abs.toLowerCase();
    if (!dedup.has(key)) {
      dedup.set(key, { src: abs });
    }
  });

  const uniqueExternalScripts = Array.from(dedup.values());

  // 2) Descargar en paralelo (manteniendo reglas)
  await Promise.all(
    uniqueExternalScripts.map(async (script) => {
      if (!script || !script.src) return;

      const fullScriptUrl = script.src;
      const fullLower = fullScriptUrl.toLowerCase();

      // Verificar si es un script de terceros a excluir de eventos
      const isExcludedFromEvents = excludeFromEventAnalysis.some((pattern) =>
        fullLower.includes(pattern)
      );

      // Verificar host vs mismo sitio
      let isSameSite = false;
      try {
        const scriptUrl = new URL(fullScriptUrl);
        isSameSite = isSameSiteHost(
          scriptUrl.hostname,
          siteDomain,
          siteBaseDomain,
          siteOrigin
        );
      } catch {}

      // tracking allowlist (siempre)
      const isTrackingScript = trackingAllowlist.some((p) => fullLower.includes(p));

      // ✅ regla final de descarga
      if (!isSameSite && !isTrackingScript) return;

      try {
        const content = await (0, fetchPage_1.fetchExternalScript)(fullScriptUrl);
        if (!content) return;

        // ✅ Si es GTM/Tracking, NO excluirlo de eventos (queremos analizar el contenedor)
        const shouldExclude = isExcludedFromEvents && !isTrackingScript;

        relevantScripts.push({
          src: fullScriptUrl,
          content,
          excludeFromEvents: shouldExclude,
        });
      } catch {
        // no truena auditor
      }
    })
  );

  return relevantScripts;
}

/**
 * Busca un patrón en todos los scripts
 * @param scripts - Array de scripts a buscar
 * @param pattern - Patrón regex a buscar
 * @returns Array de matches encontrados
 */
function searchInScripts(scripts, pattern) {
  const results = [];
  (scripts || []).forEach((script) => {
    if (!script || !script.content) return;
    const matches = script.content.match(pattern);
    if (matches) {
      matches.forEach((match, index) => {
        results.push({ match, script, index });
      });
    }
  });
  return results;
}

/**
 * Extrae todas las ocurrencias de un patrón con grupos de captura
 * @param text - Texto donde buscar
 * @param pattern - Patrón regex (se fuerza 'gi' por estabilidad)
 * @returns Array de matches con grupos de captura
 */
function extractAllMatches(text, pattern) {
  const matches = [];
  let match;

  const globalPattern = new RegExp(pattern.source, "gi");
  while ((match = globalPattern.exec(String(text || ""))) !== null) {
    matches.push(match);
  }
  return matches;
}

/**
 * Busca IDs de GTM en los scripts para descargar sus contenedores
 * @param scripts - Scripts donde buscar
 * @returns Array de IDs de GTM encontrados
 */
function extractGtmIds(scripts) {
  const gtmIds = new Set();

  const patterns = [
    /['"](GTM-[A-Z0-9]+)['"]/gi,
    /id=(GTM-[A-Z0-9]+)/gi,
    /gtm\.js\?id=(GTM-[A-Z0-9]+)/gi,
  ];

  (scripts || []).forEach((script) => {
    if (!script) return;

    // Si es un script externo de GTM, intentar sacar el ID de la URL src
    if (script.type === "external" && script.src) {
      const urlMatch = /id=(GTM-[A-Z0-9]+)/i.exec(String(script.src));
      if (urlMatch && urlMatch[1]) gtmIds.add(String(urlMatch[1]).toUpperCase());
    }

    const content = String(script.content || "");
    if (!content) return;

    patterns.forEach((pattern) => {
      const matches = extractAllMatches(content, pattern);
      matches.forEach((m) => {
        if (m && m[1]) gtmIds.add(String(m[1]).toUpperCase());
      });
    });
  });

  return Array.from(gtmIds);
}
