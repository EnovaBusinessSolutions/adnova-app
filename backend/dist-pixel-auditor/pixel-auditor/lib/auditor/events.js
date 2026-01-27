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
 * @param pageContent - Contenido de la página
 * @param scripts - Scripts procesados
 * @returns Array de eventos detectados
 */
function extractEvents(pageContent, scripts) {
    const events = [];
    // pageContent.html ya contiene los scripts inline (están en el HTML)
    // Solo agregamos scripts externos del mismo dominio que no sean de terceros
    // Esto evita duplicar eventos que aparecen en scripts inline
    // Incluir scripts externos que NO están marcados como excluidos (del mismo dominio)
    const siteExternalScripts = scripts
        .filter(s => s.type === 'external' && !s.excludeFromEvents && s.content)
        .map(s => s.content)
        .join('\n');
    const siteContent = pageContent.html + '\n' + siteExternalScripts;
    // Extraer eventos de GA4
    const ga4Events = extractGA4Events(siteContent);
    events.push(...ga4Events);
    // Extraer eventos de GTM (dataLayer)
    const gtmEvents = extractGTMEvents(siteContent);
    events.push(...gtmEvents);
    // Extraer eventos de Meta Pixel
    const pixelEvents = extractMetaPixelEvents(siteContent);
    events.push(...pixelEvents);
    return events;
}
/**
 * Extrae eventos de Google Analytics 4
 * @param content - Contenido donde buscar
 * @returns Array de eventos GA4
 */
function extractGA4Events(content) {
    const events = [];
    const foundEvents = new Set();
    // Patrón 1: gtag('event', 'event_name') - EXACTO
    const gtagEventPattern = /gtag\s*\(\s*['"]event['"]\s*,\s*['"]([a-zA-Z][a-zA-Z0-9_]+)['"](?:\s*,\s*(\{[^}]*\}))?\s*\)/gi;
    const matches = (0, extractScripts_1.extractAllMatches)(content, gtagEventPattern);
    matches.forEach(match => {
        const eventName = match[1];
        if (!foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            let params = {};
            if (match[2]) {
                try {
                    const paramsStr = match[2]
                        .replace(/'/g, '"')
                        .replace(/(\w+):/g, '"$1":')
                        .replace(/,\s*}/g, '}');
                    params = JSON.parse(paramsStr);
                }
                catch (e) {
                    params = extractParametersManually(match[2]);
                }
            }
            events.push({
                type: 'GA4',
                name: eventName,
                params,
            });
        }
    });
    // Patrón 2: Código minificado - funciones de gtag minificadas
    // Solo captura si parece ser gtag (identificador más largo o patrones específicos)
    // Evitamos identificadores de 1-2 chars que causan falsos positivos
    const minifiedPattern = /(?:gtag|dataLayer\.push|\w{3,10})\s*\(\s*['"]event['"]\s*,\s*['"]([a-zA-Z][a-zA-Z0-9_]+)['"](?:\s*,|\s*\))/gi;
    const minifiedMatches = (0, extractScripts_1.extractAllMatches)(content, minifiedPattern);
    minifiedMatches.forEach(match => {
        const eventName = match[1];
        // Filtrar palabras reservadas de JS y nombres que no parecen eventos
        const jsReserved = new Set(['config', 'set', 'get', 'consent', 'js', 'true', 'false', 'null', 'undefined', 'conversion']);
        if (!jsReserved.has(eventName.toLowerCase()) && !foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            events.push({
                type: 'GA4',
                name: eventName,
            });
        }
    });
    // Patrón 3: Buscar gtag/dataLayer con "event" seguido de nombre snake_case (muy común en GA4)
    // Requiere contexto de gtag o dataLayer para evitar falsos positivos
    const snakeCasePattern = /(?:gtag|dataLayer)\s*(?:\.\s*push\s*)?\(\s*(?:\{[^}]*)?['"]event['"]\s*[,:]\s*['"]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)['"](?:\s*,|\s*\)|\s*[,}])/gi;
    const snakeMatches = (0, extractScripts_1.extractAllMatches)(content, snakeCasePattern);
    snakeMatches.forEach(match => {
        const eventName = match[1];
        // Excluir nombres que no son eventos reales
        const excluded = new Set(['conversion', 'consent', 'config']);
        if (!foundEvents.has(eventName) && !excluded.has(eventName.toLowerCase())) {
            foundEvents.add(eventName);
            events.push({
                type: 'GA4',
                name: eventName,
            });
        }
    });
    return events;
}
/**
 * Extrae eventos de Google Tag Manager (dataLayer)
 * @param content - Contenido donde buscar
 * @returns Array de eventos GTM
 */
function extractGTMEvents(content) {
    const events = [];
    // Patrón: dataLayer.push({ event: 'event_name', ... })
    const dataLayerPattern = /dataLayer\.push\s*\(\s*(\{[^}]*event[^}]*\})\s*\)/gi;
    const matches = (0, extractScripts_1.extractAllMatches)(content, dataLayerPattern);
    matches.forEach(match => {
        try {
            // Intentar parsear el objeto
            const objStr = match[1]
                .replace(/'/g, '"')
                .replace(/(\w+):/g, '"$1":')
                .replace(/,\s*}/g, '}');
            const obj = JSON.parse(objStr);
            if (obj.event) {
                events.push({
                    type: 'GTM',
                    name: obj.event,
                    params: { ...obj, event: undefined }, // Excluir 'event' de params
                });
            }
        }
        catch (e) {
            // Si falla el parse, intentar extraer el nombre del evento manualmente
            const eventNameMatch = /['"]event['"]\s*:\s*['"]([^'"]+)['"]/i.exec(match[1]);
            if (eventNameMatch && eventNameMatch[1]) {
                events.push({
                    type: 'GTM',
                    name: eventNameMatch[1],
                    params: extractParametersManually(match[1]),
                });
            }
        }
    });
    return events;
}
/**
 * Extrae eventos de Meta Pixel
 * @param content - Contenido donde buscar
 * @returns Array de eventos Meta Pixel
 */
function extractMetaPixelEvents(content) {
    const events = [];
    const foundEvents = new Set();
    // Palabras reservadas que NO son eventos (solo las de JS/tracking)
    const reserved = new Set([
        'init', 'track', 'trackCustom', 'trackSingle', 'trackSingleCustom',
        'true', 'false', 'null', 'undefined', 'function', 'return'
    ]);
    // Patrón 1: fbq('track', 'EventName') - EXACTO
    // Soporta:
    // - Comillas simples/dobles/escapadas: 'PageView', "PageView", \'PageView\'
    // - Variables GTM: {{EventName}}, '{{EventName}}'
    // - Espacios flexibles
    const fbqTrackPattern = /fbq\s*\(\s*(?:['"]|\\['"])\s*track\s*(?:['"]|\\['"])\s*,\s*(?:['"]|\\['"])?((?:[A-Za-z][A-Za-z0-9_]+)|(?:\{\{.*?\}\}))(?:['"]|\\['"])?(?:\s*,\s*(\{[^}]*\}))?\s*\)/gi;
    const trackMatches = (0, extractScripts_1.extractAllMatches)(content, fbqTrackPattern);
    trackMatches.forEach(match => {
        let eventName = match[1];
        // Limpiar variables GTM para que se vean mejor
        if (eventName.startsWith('{{') && eventName.endsWith('}}')) {
            eventName = `[Dynamic] ${eventName}`;
        }
        if (!reserved.has(eventName.toLowerCase()) && !foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            let params = {};
            if (match[2]) {
                try {
                    // Limpiar escapes extras de GTM
                    const paramsStr = match[2]
                        .replace(/\\'|\\"/g, '"')
                        .replace(/'/g, '"')
                        .replace(/(\w+):/g, '"$1":')
                        .replace(/,\s*}/g, '}');
                    params = JSON.parse(paramsStr);
                }
                catch (e) {
                    params = extractParametersManually(match[2]);
                }
            }
            events.push({
                type: 'MetaPixel',
                name: eventName,
                params,
            });
        }
    });
    // Detección especial para WooCommerce Pixel Manager (wpmDataLayer)
    // Este plugin configura eventos dinámicamente, al menos detectamos PageView si está activo
    if (content.includes('wpmDataLayer') && content.includes('pixel_id')) {
        if (!foundEvents.has('PageView')) {
            foundEvents.add('PageView');
            events.push({
                type: 'MetaPixel',
                name: 'PageView',
                params: { _source: 'WooCommerce Pixel Manager' }
            });
        }
    }
    // Patrón 2: fbq('trackCustom', 'CustomEventName')
    const fbqCustomPattern = /fbq\s*\(\s*(?:['"]|\\['"])\s*trackCustom\s*(?:['"]|\\['"])\s*,\s*(?:['"]|\\['"])([A-Za-z][A-Za-z0-9_]+)(?:['"]|\\['"])(?:\s*,\s*(\{[^}]*\}))?\s*\)/gi;
    const customMatches = (0, extractScripts_1.extractAllMatches)(content, fbqCustomPattern);
    customMatches.forEach(match => {
        const eventName = match[1];
        if (!reserved.has(eventName.toLowerCase()) && !foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            let params = {};
            if (match[2]) {
                try {
                    const paramsStr = match[2]
                        .replace(/'/g, '"')
                        .replace(/(\w+):/g, '"$1":')
                        .replace(/,\s*}/g, '}');
                    params = JSON.parse(paramsStr);
                }
                catch (e) {
                    params = extractParametersManually(match[2]);
                }
            }
            events.push({
                type: 'MetaPixel',
                name: `Custom: ${eventName}`,
                params,
            });
        }
    });
    // Lista de eventos estándar de Meta Pixel (estos nombres son muy específicos)
    const metaStandardEvents = new Set([
        'PageView', 'ViewContent', 'Search', 'AddToCart', 'AddToWishlist',
        'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead', 'CompleteRegistration',
        'Contact', 'CustomizeProduct', 'Donate', 'FindLocation', 'Schedule',
        'StartTrial', 'SubmitApplication', 'Subscribe'
    ]);
    // Patrón 3: Código minificado - funciones fbq minificadas
    // Solo captura fbq, _fbq o nombres que terminan en fbq/pixel
    // Evitamos identificadores genéricos que causan falsos positivos como "tt"
    const minifiedTrackPattern = /(?:fbq|_fbq|(?:\w*fbq)|(?:\w*[Pp]ixel))\s*\(\s*['"]track['"]\s*,\s*['"]([A-Za-z][A-Za-z0-9_]+)['"](?:\s*,|\s*\))/gi;
    const minifiedTrackMatches = (0, extractScripts_1.extractAllMatches)(content, minifiedTrackPattern);
    minifiedTrackMatches.forEach(match => {
        const eventName = match[1];
        if (!reserved.has(eventName.toLowerCase()) && !foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            events.push({
                type: 'MetaPixel',
                name: eventName,
            });
        }
    });
    // Patrón 4: Código minificado - funciones fbq con trackCustom
    // Solo captura fbq, _fbq o nombres que terminan en fbq/pixel
    const minifiedCustomPattern = /(?:fbq|_fbq|(?:\w*fbq)|(?:\w*[Pp]ixel))\s*\(\s*['"]trackCustom['"]\s*,\s*['"]([A-Za-z][A-Za-z0-9_]+)['"](?:\s*,|\s*\))/gi;
    const minifiedCustomMatches = (0, extractScripts_1.extractAllMatches)(content, minifiedCustomPattern);
    minifiedCustomMatches.forEach(match => {
        const eventName = match[1];
        if (!reserved.has(eventName.toLowerCase()) && !foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            events.push({
                type: 'MetaPixel',
                name: `Custom: ${eventName}`,
            });
        }
    });
    // Patrón 5: Capturar eventos estándar de Meta incluso en código muy minificado
    // Esto permite capturar n("track","PageView") donde n puede ser cualquier identificador corto
    // Solo aceptamos si el nombre del evento es uno de los estándar de Meta (muy específicos)
    const anyMinifiedStandardPattern = /\w{1,3}\s*\(\s*['"]track['"]\s*,\s*['"]([A-Z][a-zA-Z]+)['"](?:\s*,|\s*\))/gi;
    const anyMinifiedMatches = (0, extractScripts_1.extractAllMatches)(content, anyMinifiedStandardPattern);
    anyMinifiedMatches.forEach(match => {
        const eventName = match[1];
        // Solo aceptar si es un evento estándar de Meta (evita falsos positivos)
        if (metaStandardEvents.has(eventName) && !foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            events.push({
                type: 'MetaPixel',
                name: eventName,
            });
        }
    });
    // Patrón 6: Buscar fbq/"track" seguido de evento PascalCase (común en Meta)
    // Requiere contexto de fbq para evitar falsos positivos
    const pascalCasePattern = /(?:fbq|_fbq)\s*\(\s*['"]track['"]\s*,\s*['"]([A-Z][a-zA-Z0-9]+)['"](?:\s*,|\s*\))/gi;
    const pascalMatches = (0, extractScripts_1.extractAllMatches)(content, pascalCasePattern);
    pascalMatches.forEach(match => {
        const eventName = match[1];
        if (!reserved.has(eventName.toLowerCase()) && !foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            events.push({
                type: 'MetaPixel',
                name: eventName,
            });
        }
    });
    // Patrón 7: Buscar fbq/"trackCustom" seguido de cualquier nombre
    // Requiere contexto de fbq para evitar falsos positivos
    const customCasePattern = /(?:fbq|_fbq)\s*\(\s*['"]trackCustom['"]\s*,\s*['"]([A-Za-z][A-Za-z0-9_]+)['"](?:\s*,|\s*\))/gi;
    const customCaseMatches = (0, extractScripts_1.extractAllMatches)(content, customCasePattern);
    customCaseMatches.forEach(match => {
        const eventName = match[1];
        if (!reserved.has(eventName.toLowerCase()) && !foundEvents.has(eventName)) {
            foundEvents.add(eventName);
            events.push({
                type: 'MetaPixel',
                name: `Custom: ${eventName}`,
            });
        }
    });
    // Patrón 8: Detectar PageView automático cuando el Pixel está inicializado
    // Meta Pixel dispara PageView automáticamente al inicializar con fbq('init', 'ID')
    // Buscamos tanto en formato normal como minificado
    const pixelInitPattern = /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi;
    const initMatches = (0, extractScripts_1.extractAllMatches)(content, pixelInitPattern);
    // También buscar init en código minificado (ej: n("init","123456"))
    const minifiedInitPattern = /\w{1,3}\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi;
    const minifiedInitMatches = (0, extractScripts_1.extractAllMatches)(content, minifiedInitPattern);
    const hasPixelInit = initMatches.length > 0 || minifiedInitMatches.length > 0;
    if (hasPixelInit && !foundEvents.has('PageView')) {
        // Si hay init, verificar si hay track de PageView de cualquier forma:
        // 1. fbq('track', 'PageView') explícito
        const hasExplicitPageView = /fbq\s*\(\s*['"]track['"]\s*,\s*['"]PageView['"]/gi.test(content);
        // 2. Minificado: n("track","PageView")
        const hasMinifiedPageView = /\w{1,3}\s*\(\s*['"]track['"]\s*,\s*['"]PageView['"]/gi.test(content);
        // 3. NoScript pixel con ev=PageView
        const hasNoScriptPixel = /facebook\.com\/tr\?[^"']*id=\d+[^"']*ev=PageView/gi.test(content) ||
            /facebook\.com\/tr\?[^"']*ev=PageView[^"']*id=\d+/gi.test(content);
        // 4. URL de tracking con PageView
        const hasTrackingUrl = /facebook\.com\/tr\/\?[^"']*ev=PageView/gi.test(content);
        if (hasExplicitPageView || hasMinifiedPageView || hasNoScriptPixel || hasTrackingUrl) {
            foundEvents.add('PageView');
            events.push({
                type: 'MetaPixel',
                name: 'PageView',
                params: { _auto: true },
            });
        }
    }
    return events;
}
/**
 * Extrae parámetros manualmente cuando JSON.parse falla
 * @param paramsStr - String con parámetros
 * @returns Objeto con parámetros extraídos
 */
function extractParametersManually(paramsStr) {
    const params = {};
    // Buscar pares clave:valor
    const paramPattern = /['"]?(\w+)['"]?\s*:\s*['"]?([^,}'"]+)['"]?/g;
    let match;
    while ((match = paramPattern.exec(paramsStr)) !== null) {
        const key = match[1];
        let value = match[2].trim();
        // Intentar convertir a número o booleano
        if (value === 'true')
            value = true;
        else if (value === 'false')
            value = false;
        else if (!isNaN(Number(value)) && value !== '')
            value = Number(value);
        params[key] = value;
    }
    return params;
}
/**
 * Detecta eventos duplicados
 * @param events - Array de eventos
 * @returns Array de eventos duplicados
 */
function findDuplicateEvents(events) {
    const seen = new Map();
    const duplicates = [];
    events.forEach(event => {
        const key = `${event.type}:${event.name}`;
        const count = seen.get(key) || 0;
        seen.set(key, count + 1);
        if (count > 0) {
            duplicates.push(event);
        }
    });
    return duplicates;
}
/**
 * Valida que los eventos tengan los parámetros requeridos
 * @param events - Array de eventos
 * @returns Array de eventos con parámetros faltantes
 */
function validateEventParameters(events) {
    const issues = [];
    // Parámetros requeridos por tipo de evento
    const requiredParams = {
        // GA4
        'purchase': ['transaction_id', 'value', 'currency'],
        'add_to_cart': ['currency', 'value'],
        'begin_checkout': ['currency', 'value'],
        // Meta Pixel
        'Purchase': ['value', 'currency'],
        'AddToCart': ['value', 'currency'],
        'InitiateCheckout': ['value', 'currency'],
    };
    events.forEach(event => {
        const required = requiredParams[event.name];
        if (!required)
            return;
        const missingParams = [];
        required.forEach(param => {
            if (!event.params || !(param in event.params)) {
                missingParams.push(param);
            }
        });
        if (missingParams.length > 0) {
            issues.push({ event, missingParams });
        }
    });
    return issues;
}
