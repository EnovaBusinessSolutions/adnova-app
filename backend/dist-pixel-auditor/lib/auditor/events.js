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
/**
 * Extrae todos los eventos encontrados en la página
 */
function extractEvents(pageContent, scripts) {
    const events = [];
    // ✅ 1) JS real: inline + externos descargados no excluidos
    const inlineJs = (pageContent.scripts?.inline || []).join("\n");
    const externalJs = scripts
        .filter((s) => s.type === "external" && !s.excludeFromEvents && !!s.content)
        .map((s) => s.content)
        .join("\n");
    const jsContent = inlineJs + "\n" + externalJs;
    // ✅ 2) HTML solo para señales tipo noscript / urls
    const htmlContent = pageContent.html || "";
    // Control anti-spam: permite duplicados (para detectarlos), pero con límite por key
    const seenCount = new Map();
    const MAX_PER_EVENT = 5;
    function pushEvent(e) {
        const key = `${e.type}:${e.name}`;
        const c = (seenCount.get(key) || 0) + 1;
        seenCount.set(key, c);
        if (c <= MAX_PER_EVENT)
            events.push(e);
    }
    // GA4 (JS)
    extractGA4Events(jsContent).forEach(pushEvent);
    // GTM (JS)
    extractGTMEvents(jsContent).forEach(pushEvent);
    // Meta Pixel (JS + HTML para noscript/urls)
    extractMetaPixelEvents(jsContent, htmlContent).forEach(pushEvent);
    return events;
}
/* =========================
 * Helpers de parsing
 * ========================= */
/**
 * Extrae el primer objeto literal "{...}" a partir de un índice dentro de un string.
 * Es un balanceo simple de llaves, suficiente para params típicos.
 */
function extractObjectLiteral(text, startIndex) {
    const start = text.indexOf("{", startIndex);
    if (start < 0)
        return null;
    let depth = 0;
    let inString = null;
    let escape = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (ch === "\\") {
                escape = true;
                continue;
            }
            if (ch === inString)
                inString = null;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") {
            inString = ch;
            continue;
        }
        if (ch === "{")
            depth++;
        if (ch === "}")
            depth--;
        if (depth === 0) {
            return text.slice(start, i + 1);
        }
    }
    return null;
}
/**
 * Intenta parsear objeto JS-like a JSON.
 * Si falla, hace extracción manual de pares clave/valor.
 */
function parseParamsObject(objLiteral) {
    try {
        // Normaliza:
        // - keys sin comillas: foo: -> "foo":
        // - comillas simples -> dobles
        // - trailing commas
        const jsonish = objLiteral
            .replace(/\\'|\\"/g, '"')
            .replace(/'/g, '"')
            .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
            .replace(/,\s*}/g, "}");
        return JSON.parse(jsonish);
    }
    catch {
        return extractParametersManually(objLiteral);
    }
}
/**
 * Extrae parámetros manualmente cuando JSON.parse falla
 */
function extractParametersManually(paramsStr) {
    const params = {};
    const paramPattern = /['"]?([A-Za-z0-9_]+)['"]?\s*:\s*(['"][^'"]*['"]|[^,}]+)/g;
    let match;
    while ((match = paramPattern.exec(paramsStr)) !== null) {
        const key = match[1];
        let raw = (match[2] || "").trim();
        // quitar comillas si existen
        if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
            raw = raw.slice(1, -1);
        }
        let value = raw;
        if (raw === "true")
            value = true;
        else if (raw === "false")
            value = false;
        else if (raw === "null")
            value = null;
        else if (!isNaN(Number(raw)) && raw !== "")
            value = Number(raw);
        params[key] = value;
    }
    return params;
}
/* =========================
 * GA4
 * ========================= */
function extractGA4Events(js) {
    const events = [];
    // Patrón robusto: gtag('event', 'name' ... )
    const gtagEventPattern = /gtag\s*\(\s*['"]event['"]\s*,\s*['"]([a-zA-Z][a-zA-Z0-9_]+)['"]/gi;
    const matches = (0, extractScripts_1.extractAllMatches)(js, gtagEventPattern);
    matches.forEach((m) => {
        const eventName = m[1];
        const at = m.index ?? 0;
        // Buscar params después del match
        const after = at + m[0].length;
        const obj = extractObjectLiteral(js, after);
        const params = obj ? parseParamsObject(obj) : undefined;
        events.push({
            type: "GA4",
            name: eventName,
            params: params || {},
        });
    });
    // dataLayer.push({ event: '...' }) a veces se usa como GA4 proxy (snake_case)
    // Solo agrega si el nombre parece snake_case típico
    const snakeCasePattern = /dataLayer\.push\s*\(\s*\{[\s\S]*?['"]event['"]\s*:\s*['"]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)['"]/gi;
    const snakeMatches = (0, extractScripts_1.extractAllMatches)(js, snakeCasePattern);
    snakeMatches.forEach((m) => {
        const name = m[1];
        events.push({ type: "GA4", name });
    });
    return events;
}
/* =========================
 * GTM
 * ========================= */
function extractGTMEvents(js) {
    const events = [];
    // Patrón 1: dataLayer.push({ event: 'x', ... })
    // (captura flexible, no asume "}" simple)
    const dataLayerPushPattern = /dataLayer\.push\s*\(\s*\{/gi;
    const starts = (0, extractScripts_1.extractAllMatches)(js, dataLayerPushPattern);
    starts.forEach((m) => {
        const startIdx = (m.index ?? 0);
        const obj = extractObjectLiteral(js, startIdx);
        if (!obj)
            return;
        // Extraer event: '...'
        const nameMatch = /['"]event['"]\s*:\s*['"]([^'"]+)['"]/i.exec(obj);
        if (!nameMatch?.[1])
            return;
        const params = parseParamsObject(obj);
        delete params.event;
        events.push({
            type: "GTM",
            name: nameMatch[1],
            params,
        });
    });
    return events;
}
/* =========================
 * META PIXEL
 * ========================= */
function extractMetaPixelEvents(js, html) {
    const events = [];
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
    const fbqTrackPattern = /fbq\s*\(\s*(?:['"]|\\['"])\s*track\s*(?:['"]|\\['"])\s*,\s*(?:['"]|\\['"])?((?:[A-Za-z][A-Za-z0-9_]+)|(?:\{\{.*?\}\}))(?:['"]|\\['"])?/gi;
    const trackMatches = (0, extractScripts_1.extractAllMatches)(js, fbqTrackPattern);
    trackMatches.forEach((m) => {
        let eventName = m[1];
        if (eventName.startsWith("{{") && eventName.endsWith("}}")) {
            eventName = `[Dynamic] ${eventName}`;
        }
        if (reserved.has(eventName.toLowerCase()))
            return;
        const at = m.index ?? 0;
        const after = at + m[0].length;
        const obj = extractObjectLiteral(js, after);
        const params = obj ? parseParamsObject(obj) : undefined;
        events.push({
            type: "MetaPixel",
            name: eventName,
            params: params || {},
        });
    });
    // fbq('trackCustom', 'CustomEvent', {...})
    const fbqCustomPattern = /fbq\s*\(\s*(?:['"]|\\['"])\s*trackCustom\s*(?:['"]|\\['"])\s*,\s*(?:['"]|\\['"])([A-Za-z][A-Za-z0-9_]+)(?:['"]|\\['"])/gi;
    const customMatches = (0, extractScripts_1.extractAllMatches)(js, fbqCustomPattern);
    customMatches.forEach((m) => {
        const name = m[1];
        if (reserved.has(name.toLowerCase()))
            return;
        const at = m.index ?? 0;
        const after = at + m[0].length;
        const obj = extractObjectLiteral(js, after);
        const params = obj ? parseParamsObject(obj) : undefined;
        events.push({
            type: "MetaPixel",
            name: `Custom: ${name}`,
            params: params || {},
        });
    });
    // PageView por noscript / tracking URL en HTML
    const hasNoScriptPageView = /facebook\.com\/tr\?[^"']*ev=PageView/i.test(html) ||
        /facebook\.com\/tr\/\?[^"']*ev=PageView/i.test(html);
    if (hasNoScriptPageView) {
        events.push({
            type: "MetaPixel",
            name: "PageView",
            params: { _source: "noscript_or_url" },
        });
    }
    // WooCommerce Pixel Manager señal
    if (js.includes("wpmDataLayer") && js.includes("pixel_id")) {
        events.push({
            type: "MetaPixel",
            name: "PageView",
            params: { _source: "WooCommerce Pixel Manager" },
        });
    }
    return events;
}
/* =========================
 * Duplicados + validación
 * ========================= */
function findDuplicateEvents(events) {
    const seen = new Map();
    const duplicates = [];
    events.forEach((event) => {
        const key = `${event.type}:${event.name}`;
        const count = seen.get(key) || 0;
        seen.set(key, count + 1);
        if (count > 0)
            duplicates.push(event);
    });
    return duplicates;
}
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
    events.forEach((event) => {
        const required = requiredParams[event.name];
        if (!required)
            return;
        const missing = required.filter((p) => !event.params || !(p in event.params));
        if (missing.length)
            issues.push({ event, missingParams: missing });
    });
    return issues;
}
