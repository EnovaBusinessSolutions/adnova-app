"use strict";
/**
 * Pixel Auditor AI™ - Event Detector
 * Extrae y analiza eventos de GA4, GTM y Meta Pixel
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractEvents = extractEvents;
exports.findDuplicateEvents = findDuplicateEvents;
exports.validateEventParameters = validateEventParameters;

const extractScripts_1 = require("../crawler/extractScripts");

function makeIssue(code, title, severity, details, extra) {
  const issue = { platform: "events", code, title, severity };
  if (details) issue.details = details;
  if (extra && typeof extra === "object") Object.assign(issue, extra);
  return issue;
}

function safeJsonishToObj(objStr) {
  // intenta transformar objetos JS simples a JSON
  try {
    const cleaned = objStr
      .replace(/\\'|\\"/g, '"')
      .replace(/'/g, '"')
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/,\s*}/g, "}");
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Extrae todos los eventos encontrados en la página
 * @param pageContent - Contenido de la página
 * @param scripts - Scripts procesados
 * @returns Array de eventos detectados
 */
function extractEvents(pageContent, scripts) {
  const events = [];

  const html = pageContent?.html || "";

  // ✅ solo scripts externos del mismo sitio que no sean de terceros (y que tengan content)
  const siteExternalScripts = (scripts || [])
    .filter((s) => s && s.type === "external" && !s.excludeFromEvents && s.content)
    .map((s) => s.content)
    .join("\n");

  // Para poder marcar origen
  const htmlContent = html;
  const externalContent = siteExternalScripts;

  // Extraer eventos por separado (para source)
  const ga4EventsHtml = extractGA4Events(htmlContent, "html");
  const ga4EventsExt = extractGA4Events(externalContent, "external");
  events.push(...ga4EventsHtml, ...ga4EventsExt);

  const gtmEventsHtml = extractGTMEvents(htmlContent, "html");
  const gtmEventsExt = extractGTMEvents(externalContent, "external");
  events.push(...gtmEventsHtml, ...gtmEventsExt);

  const pixelEventsHtml = extractMetaPixelEvents(htmlContent, "html");
  const pixelEventsExt = extractMetaPixelEvents(externalContent, "external");
  events.push(...pixelEventsHtml, ...pixelEventsExt);

  return events;
}

/**
 * Extrae eventos de Google Analytics 4
 */
function extractGA4Events(content, source) {
  const events = [];
  if (!content) return events;

  // Patrón 1: gtag('event', 'event_name', {...})
  const gtagEventPattern =
    /gtag\s*\(\s*['"]event['"]\s*,\s*['"]([a-zA-Z][a-zA-Z0-9_]+)['"](?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/gi;

  const matches = (0, extractScripts_1.extractAllMatches)(content, gtagEventPattern);

  matches.forEach((match) => {
    const eventName = match[1];
    let params = undefined;

    if (match[2]) {
      const parsed = safeJsonishToObj(match[2]);
      params = parsed || extractParametersManually(match[2]);
    }

    events.push({
      type: "GA4",
      name: eventName,
      params,
      source,
    });
  });

  // Patrón 2: dataLayer.push({event:'x'}) (también puede ser GA4 via GTM)
  // No lo duplicamos aquí para no mezclar con GTM.

  return events;
}

/**
 * Extrae eventos de Google Tag Manager (dataLayer)
 */
function extractGTMEvents(content, source) {
  const events = [];
  if (!content) return events;

  // dataLayer.push( { ... } )
  // mejor regex tolerante (no perfecto para nested, pero reduce falsos)
  const dataLayerPattern = /dataLayer\.push\s*\(\s*(\{[\s\S]*?\})\s*\)/gi;
  const matches = (0, extractScripts_1.extractAllMatches)(content, dataLayerPattern);

  matches.forEach((match) => {
    const rawObjStr = match[1];

    const parsed = safeJsonishToObj(rawObjStr);
    if (parsed && parsed.event) {
      const params = Object.assign({}, parsed);
      delete params.event;
      events.push({
        type: "GTM",
        name: String(parsed.event),
        params,
        source,
      });
      return;
    }

    // fallback: extraer event name manual
    const eventNameMatch = /['"]event['"]\s*:\s*['"]([^'"]+)['"]/i.exec(rawObjStr);
    if (eventNameMatch && eventNameMatch[1]) {
      events.push({
        type: "GTM",
        name: eventNameMatch[1],
        params: extractParametersManually(rawObjStr),
        source,
      });
    }
  });

  return events;
}

/**
 * Extrae eventos de Meta Pixel
 */
function extractMetaPixelEvents(content, source) {
  const events = [];
  if (!content) return events;

  const reserved = new Set([
    "init",
    "track",
    "trackcustom",
    "tracksingle",
    "tracksinglecustom",
    "true",
    "false",
    "null",
    "undefined",
    "function",
    "return",
  ]);

  // fbq('track', 'EventName', {...})
  const fbqTrackPattern =
    /fbq\s*\(\s*(?:['"]|\\['"])\s*track\s*(?:['"]|\\['"])\s*,\s*(?:['"]|\\['"])?((?:[A-Za-z][A-Za-z0-9_]+)|(?:\{\{.*?\}\}))(?:['"]|\\['"])?(?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/gi;

  const trackMatches = (0, extractScripts_1.extractAllMatches)(content, fbqTrackPattern);
  trackMatches.forEach((match) => {
    let eventName = match[1];

    if (eventName && eventName.startsWith("{{") && eventName.endsWith("}}")) {
      eventName = `[Dynamic] ${eventName}`;
    }

    if (!eventName) return;
    if (reserved.has(eventName.toLowerCase())) return;

    let params = undefined;
    if (match[2]) {
      const parsed = safeJsonishToObj(match[2]);
      params = parsed || extractParametersManually(match[2]);
    }

    events.push({
      type: "MetaPixel",
      name: eventName,
      params,
      source,
    });
  });

  // fbq('trackCustom', 'CustomEvent', {...})
  const fbqCustomPattern =
    /fbq\s*\(\s*(?:['"]|\\['"])\s*trackCustom\s*(?:['"]|\\['"])\s*,\s*(?:['"]|\\['"])([A-Za-z][A-Za-z0-9_]+)(?:['"]|\\['"])(?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/gi;

  const customMatches = (0, extractScripts_1.extractAllMatches)(content, fbqCustomPattern);
  customMatches.forEach((match) => {
    const name = match[1];
    if (!name) return;
    if (reserved.has(name.toLowerCase())) return;

    let params = undefined;
    if (match[2]) {
      const parsed = safeJsonishToObj(match[2]);
      params = parsed || extractParametersManually(match[2]);
    }

    events.push({
      type: "MetaPixel",
      name: `Custom: ${name}`,
      params,
      source,
    });
  });

  // Auto PageView evidence (init + explicit PageView/noScript)
  const hasPixelInit =
    /fbq\s*\(\s*['"]init['"]\s*,/i.test(content) || /\w{1,3}\s*\(\s*['"]init['"]\s*,/i.test(content);

  if (hasPixelInit) {
    const hasExplicitPageView = /fbq\s*\(\s*['"]track['"]\s*,\s*['"]PageView['"]/i.test(content);
    const hasMinifiedPageView = /\w{1,3}\s*\(\s*['"]track['"]\s*,\s*['"]PageView['"]/i.test(content);
    const hasNoScriptPixel =
      /facebook\.com\/tr\?[^"']*ev=PageView/i.test(content) ||
      /facebook\.com\/tr\/\?[^"']*ev=PageView/i.test(content);

    if (hasExplicitPageView || hasMinifiedPageView || hasNoScriptPixel) {
      events.push({
        type: "MetaPixel",
        name: "PageView",
        params: { _auto: true },
        source,
      });
    }
  }

  return events;
}

/**
 * Extrae parámetros manualmente cuando JSON.parse falla
 */
function extractParametersManually(paramsStr) {
  const params = {};
  if (!paramsStr) return params;

  const paramPattern = /['"]?(\w+)['"]?\s*:\s*['"]?([^,}'"]+)['"]?/g;
  let match;
  while ((match = paramPattern.exec(paramsStr)) !== null) {
    const key = match[1];
    let value = match[2].trim();

    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (!isNaN(Number(value)) && value !== "") value = Number(value);

    params[key] = value;
  }
  return params;
}

/**
 * Detecta eventos duplicados (por type+name) y regresa conteo + sources
 */
function findDuplicateEvents(events) {
  const map = new Map();

  (events || []).forEach((ev) => {
    const key = `${ev.type}:${ev.name}`;
    const entry = map.get(key) || { event: ev, count: 0, sources: new Set() };
    entry.count += 1;
    if (ev.source) entry.sources.add(ev.source);
    map.set(key, entry);
  });

  const duplicates = [];
  for (const [, v] of map.entries()) {
    if (v.count > 1) {
      duplicates.push({
        type: v.event.type,
        name: v.event.name,
        count: v.count,
        sources: Array.from(v.sources),
      });
    }
  }

  return duplicates;
}

/**
 * Valida parámetros requeridos + genera issues tipo German
 */
function validateEventParameters(events) {
  const issues = [];

  const requiredParams = {
    // GA4
    purchase: ["transaction_id", "value", "currency"],
    add_to_cart: ["currency", "value"],
    begin_checkout: ["currency", "value"],

    // Meta Pixel
    Purchase: ["value", "currency"],
    AddToCart: ["value", "currency"],
    InitiateCheckout: ["value", "currency"],
  };

  const list = Array.isArray(events) ? events : [];

  // Duplicados
  const dup = findDuplicateEvents(list);
  dup.forEach((d) => {
    issues.push(
      makeIssue(
        "duplicate_event",
        `Evento duplicado: ${d.type} / ${d.name}`,
        "medium",
        `Se detectó el evento más de una vez (${d.count}). Esto puede inflar métricas o duplicar conversiones.`,
        { duplicate: d }
      )
    );
  });

  // Missing params
  list.forEach((event) => {
    const required = requiredParams[event.name];
    if (!required) return;

    const missingParams = [];
    required.forEach((param) => {
      if (!event.params || !(param in event.params)) missingParams.push(param);
    });

    if (missingParams.length > 0) {
      const sev =
        event.name === "purchase" || event.name === "Purchase" ? "high" : "medium";

      issues.push(
        makeIssue(
          "missing_params",
          `Parámetros faltantes en ${event.type} / ${event.name}`,
          sev,
          `El evento requiere estos parámetros para medir correctamente: ${missingParams.join(
            ", "
          )}.`,
          { event, missingParams }
        )
      );
    }
  });

  return issues;
}
