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
    pageContent.scripts.inline.forEach((content, index) => {
        allScripts.push({
            type: 'inline',
            content,
            line: index + 1,
        });
    });
    // Agregar scripts externos (solo la referencia, sin descargar aún)
    pageContent.scripts.external.forEach((script, index) => {
        allScripts.push({
            type: 'external',
            content: script.content || '',
            src: script.src,
            line: pageContent.scripts.inline.length + index + 1,
        });
    });
    return allScripts;
}
/**
 * Descarga el contenido de scripts externos relevantes para auditoría
 * @param scripts - Array de scripts externos
 * @param siteUrl - URL del sitio para identificar scripts del mismo dominio
 * @returns Scripts con contenido descargado
 */
async function fetchRelevantExternalScripts(externalScripts, siteUrl) {
    const relevantScripts = [];
    // Obtener info del sitio
    let siteOrigin = '';
    let siteDomain = '';
    let siteBaseDomain = '';
    if (siteUrl) {
        try {
            const url = new URL(siteUrl);
            siteOrigin = url.origin;
            siteDomain = url.hostname;
            // Extraer dominio base (ej: webmentor.app de www.webmentor.app)
            const parts = siteDomain.replace('www.', '').split('.');
            siteBaseDomain = parts.slice(-2).join('.');
        }
        catch (e) { }
    }
    // Lista de dominios de terceros para excluir de análisis de eventos
    const excludeFromEventAnalysis = [
        'facebook.net',
        'connect.facebook.net',
        'fbevents.js',
        'google-analytics.com',
        'googleadservices.com',
        'doubleclick.net',
        'googlesyndication.com',
        'cdn.segment.com',
        'cdn.amplitude.com',
        'cdn.mxpnl.com',
        'hotjar.com',
        'clarity.ms',
        'intercom.io',
        'crisp.chat',
        'tawk.to',
    ];
    await Promise.all(externalScripts.map(async (script) => {
        let fullScriptUrl = script.src;
        // Resolver URLs relativas
        if (!script.src.startsWith('http')) {
            if (script.src.startsWith('//')) {
                fullScriptUrl = 'https:' + script.src;
            }
            else if (script.src.startsWith('/')) {
                fullScriptUrl = siteOrigin + script.src;
            }
            else {
                fullScriptUrl = siteOrigin + '/' + script.src;
            }
        }
        // Verificar si es un script de terceros a excluir de eventos
        const isExcludedFromEvents = excludeFromEventAnalysis.some(pattern => fullScriptUrl.toLowerCase().includes(pattern.toLowerCase()));
        // Verificar si es del mismo dominio/sitio
        let isSameSite = false;
        try {
            const scriptUrl = new URL(fullScriptUrl);
            const scriptDomain = scriptUrl.hostname;
            // Comparar dominio base (webmentor.app == cdn.webmentor.app)
            isSameSite = !!(siteBaseDomain && scriptDomain.includes(siteBaseDomain));
        }
        catch (e) { }
        // Descargar TODOS los scripts del mismo sitio (para encontrar eventos)
        // Y algunos de terceros que necesitamos para detectar IDs
        const isIsGtmOrTracking = fullScriptUrl.includes('googletagmanager.com') ||
            fullScriptUrl.includes('gtag/js') ||
            fullScriptUrl.includes('gtm.js');
        if (isSameSite || isIsGtmOrTracking) {
            try {
                const content = await (0, fetchPage_1.fetchExternalScript)(fullScriptUrl);
                if (content) {
                    // Si es GTM/Tracking, NO excluirlo de eventos (queremos analizar el contenedor)
                    // Pero si está en la lista de exclusión general (ads, analytics, etc) sí excluirlo
                    const shouldExclude = isExcludedFromEvents && !isIsGtmOrTracking;
                    relevantScripts.push({
                        src: fullScriptUrl,
                        content,
                        excludeFromEvents: shouldExclude,
                    });
                }
            }
            catch (error) {
                console.error(`Failed to fetch ${fullScriptUrl}`);
            }
        }
    }));
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
    scripts.forEach(script => {
        if (!script.content)
            return;
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
 * @param pattern - Patrón regex con flags 'g'
 * @returns Array de matches con grupos de captura
 */
function extractAllMatches(text, pattern) {
    const matches = [];
    let match;
    // Asegurar que el patrón tiene flag 'g'
    const globalPattern = new RegExp(pattern.source, 'gi');
    while ((match = globalPattern.exec(text)) !== null) {
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
    // Patrones comunes para encontrar IDs de GTM
    const patterns = [
        /['"](GTM-[A-Z0-9]+)['"]/gi, // "GTM-XXXX"
        /id=(GTM-[A-Z0-9]+)/gi, // id=GTM-XXXX
        /gtm\.js\?id=(GTM-[A-Z0-9]+)/gi // gtm.js?id=GTM-XXXX
    ];
    scripts.forEach(script => {
        if (!script.content)
            return;
        // Si es un script externo de GTM, intentar sacar el ID de la URL src
        if (script.type === 'external' && script.src) {
            const urlMatch = /id=(GTM-[A-Z0-9]+)/i.exec(script.src);
            if (urlMatch)
                gtmIds.add(urlMatch[1]);
        }
        // Buscar en el contenido
        patterns.forEach(pattern => {
            const matches = extractAllMatches(script.content, pattern);
            matches.forEach(match => {
                if (match[1])
                    gtmIds.add(match[1]);
            });
        });
    });
    return Array.from(gtmIds);
}
