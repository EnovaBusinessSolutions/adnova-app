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
        errors: [],
    };
    // Combinar todo el contenido para análisis
    const allContent = [
        pageContent.html,
        ...scripts.map(s => s.content),
    ].join('\n');
    // Patrón 1: Script de Google Ads via gtag.js
    const googleAdsScriptPattern = /googletagmanager\.com\/gtag\/js\?id=(AW-\d+)/gi;
    const scriptMatches = (0, extractScripts_1.extractAllMatches)(allContent, googleAdsScriptPattern);
    // Patrón 2: gtag config con AW-
    const gtagConfigPattern = /gtag\s*\(\s*['"]config['"]\s*,\s*['"](AW-\d+)['"]/gi;
    const configMatches = (0, extractScripts_1.extractAllMatches)(allContent, gtagConfigPattern);
    // Patrón 3: Conversion tracking con send_to
    const conversionPattern = /gtag\s*\(\s*['"]event['"]\s*,\s*['"]conversion['"]\s*,\s*\{[^}]*['"]send_to['"]\s*:\s*['"](AW-\d+(?:\/[^'"]+)?)['"]/gi;
    const conversionMatches = (0, extractScripts_1.extractAllMatches)(allContent, conversionPattern);
    // Patrón 4: gtag_report_conversion function (común en sitios)
    const reportConversionPattern = /gtag_report_conversion\s*\([^)]*\)|function\s+gtag_report_conversion/gi;
    const hasReportConversion = reportConversionPattern.test(allContent);
    // Patrón 5: AW- ID en cualquier contexto de gtag
    const anyAwIdPattern = /['"](AW-\d{9,12})['"]/gi;
    const anyAwMatches = (0, extractScripts_1.extractAllMatches)(allContent, anyAwIdPattern);
    // Patrón 6: Google Ads conversion linker
    const conversionLinkerPattern = /googleads\.g\.doubleclick\.net|www\.googleadservices\.com\/pagead\/conversion\/(AW-?\d+|\d+)/gi;
    const linkerMatches = (0, extractScripts_1.extractAllMatches)(allContent, conversionLinkerPattern);
    // Patrón 7: data-attributes con AW ID
    const dataAttrPattern = /data-(?:google-?ads?|conversion|aw)=['"]?(AW-\d+)['"]?/gi;
    const dataAttrMatches = (0, extractScripts_1.extractAllMatches)(allContent, dataAttrPattern);
    // Patrón 8: Variables JS con AW ID
    const jsVarPattern = /(?:var|let|const)\s+(?:google_?ads?_?id|aw_?id|conversion_?id)\s*=\s*['"](AW-\d+)['"]/gi;
    const jsVarMatches = (0, extractScripts_1.extractAllMatches)(allContent, jsVarPattern);
    // Patrón 9: Google Ads en JSON config
    const jsonConfigPattern = /"(?:google_?ads?|aw_?id|adwords)":\s*"(AW-\d+)"/gi;
    const jsonConfigMatches = (0, extractScripts_1.extractAllMatches)(allContent, jsonConfigPattern);
    // Patrón 10: Conversion ID numérico (sin prefijo AW-)
    const numericConversionPattern = /googleadservices\.com\/pagead\/conversion\/(\d{9,12})/gi;
    const numericMatches = (0, extractScripts_1.extractAllMatches)(allContent, numericConversionPattern);
    // Patrón 11: goog_report_conversion
    const googReportPattern = /goog_report_conversion\s*\(\s*['"](AW-\d+)/gi;
    const googReportMatches = (0, extractScripts_1.extractAllMatches)(allContent, googReportPattern);
    // Recolectar todos los IDs únicos
    const allIds = new Set();
    [scriptMatches, configMatches, anyAwMatches, dataAttrMatches,
        jsVarMatches, jsonConfigMatches, googReportMatches].forEach(matches => {
        matches.forEach(match => {
            if (match[1])
                allIds.add(match[1]);
        });
    });
    // Agregar IDs de conversiones (extraer base ID)
    conversionMatches.forEach(match => {
        if (match[1]) {
            const baseId = match[1].split('/')[0];
            allIds.add(baseId);
        }
    });
    // Agregar IDs numéricos con formato AW-
    numericMatches.forEach(match => {
        if (match[1])
            allIds.add(`AW-${match[1]}`);
    });
    // Agregar IDs del linker
    linkerMatches.forEach(match => {
        if (match[1]) {
            const id = match[1].startsWith('AW-') ? match[1] : `AW-${match[1]}`;
            if (/^AW-\d{9,12}$/.test(id))
                allIds.add(id);
        }
    });
    result.ids = Array.from(allIds);
    result.detected = result.ids.length > 0 || hasReportConversion;
    // Detectar conversiones configuradas
    const allConversions = [];
    conversionMatches.forEach(match => {
        if (match[1])
            allConversions.push(match[1]);
    });
    if (allConversions.length > 0) {
        result.conversions = allConversions;
    }
    // Detección de errores
    if (result.detected) {
        // Error: Script cargado pero no configurado
        const hasScript = scriptMatches.length > 0;
        const hasConfig = configMatches.length > 0;
        if (hasScript && !hasConfig) {
            result.errors.push('google_ads_script_without_config');
        }
        // Error: Configurado pero sin script (y no hay gtag de otra fuente)
        const hasAnyGtagScript = /googletagmanager\.com\/gtag\/js/i.test(allContent);
        if (!hasAnyGtagScript && hasConfig) {
            result.errors.push('google_ads_config_without_script');
        }
    }
    return result;
}
/**
 * Verifica si un ID de Google Ads es válido
 * @param id - ID a verificar
 * @returns true si es válido
 */
function isValidGoogleAdsId(id) {
    return /^AW-[0-9]{9,12}$/.test(id);
}
/**
 * Extrae la configuración de Google Ads de una página
 * @param content - Contenido a analizar
 * @returns Configuración encontrada
 */
function extractGoogleAdsConfig(content) {
    const ids = [];
    const conversions = [];
    // Extraer IDs
    const idPattern = /['"]?(AW-[0-9]+)['"]?/gi;
    let match;
    while ((match = idPattern.exec(content)) !== null) {
        if (!ids.includes(match[1])) {
            ids.push(match[1]);
        }
    }
    // Extraer conversiones
    const conversionPattern = /AW-[0-9]+\/[A-Za-z0-9_-]+/g;
    while ((match = conversionPattern.exec(content)) !== null) {
        if (!conversions.includes(match[0])) {
            conversions.push(match[0]);
        }
    }
    // Verificar enhanced conversions
    const hasEnhancedConversions = /allow_enhanced_conversions\s*:\s*true/i.test(content);
    // Verificar remarketing tag
    const hasRemarketingTag = /remarketing_only\s*:\s*true/i.test(content) ||
        /google_remarketing_only/i.test(content);
    return {
        ids,
        conversions,
        hasEnhancedConversions,
        hasRemarketingTag,
    };
}
