"use strict";
/**
 * Pixel Auditor AI™ - Shopify Web Pixels Detector
 * Detecta configuración de tracking en tiendas Shopify
 *
 * Shopify usa "Web Pixels Manager" que encapsula toda la configuración
 * de tracking (GA4, Google Ads, Meta Pixel, etc.) en un JSON llamado
 * webPixelsConfigList. Esta configuración no es visible directamente
 * como scripts tradicionales.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractShopifyPixelsConfig = extractShopifyPixelsConfig;
exports.detectShopifyTrackingPatterns = detectShopifyTrackingPatterns;
/**
 * Detecta y extrae configuración de Shopify Web Pixels
 * @param html - HTML completo de la página
 * @returns Configuración de pixels de Shopify
 */
function extractShopifyPixelsConfig(html) {
    const result = {
        ga4Ids: [],
        googleAdsIds: [],
        googleTagIds: [],
        merchantCenterIds: [],
        metaPixelIds: [],
        tiktokPixelIds: [],
        configuredEvents: [],
        hasMetaPixelApp: false,
        otherPixels: [],
        isShopify: false,
    };
    // Detectar si es Shopify
    const isShopify = /Shopify\.(shop|theme|locale|currency)|shopify\.com|myshopify\.com|web-pixels-manager/i.test(html);
    result.isShopify = isShopify;
    // Patrón 1: webPixelsConfigList JSON
    // Este es el principal método que Shopify usa para cargar pixels
    const webPixelsMatch = /webPixelsConfigList:\s*\[([\s\S]*?)\](?=,\s*(?:isMerchantRequest|initData|$))/i.exec(html);
    if (webPixelsMatch) {
        try {
            // Limpiar y parsear el JSON
            const jsonStr = '[' + webPixelsMatch[1] + ']';
            const pixelsConfig = JSON.parse(jsonStr);
            pixelsConfig.forEach((pixel) => {
                if (!pixel.configuration)
                    return;
                let config;
                try {
                    config = JSON.parse(pixel.configuration);
                }
                catch {
                    config = { raw: pixel.configuration };
                }
                // Extraer IDs de Google (GA4, AW, GT, MC)
                if (config.config) {
                    try {
                        const innerConfig = JSON.parse(config.config);
                        // google_tag_ids contiene todos los IDs de Google
                        if (innerConfig.google_tag_ids) {
                            innerConfig.google_tag_ids.forEach((id) => {
                                if (id.startsWith('G-')) {
                                    result.ga4Ids.push(id);
                                }
                                else if (id.startsWith('AW-')) {
                                    result.googleAdsIds.push(id);
                                }
                                else if (id.startsWith('GT-')) {
                                    result.googleTagIds.push(id);
                                }
                                else if (id.startsWith('MC-')) {
                                    result.merchantCenterIds.push(id);
                                }
                            });
                        }
                        // También buscar en gtag_events para IDs adicionales y eventos configurados
                        if (innerConfig.gtag_events) {
                            innerConfig.gtag_events.forEach((event) => {
                                // Guardar el evento configurado
                                if (event.type) {
                                    const eventConfig = {
                                        type: event.type,
                                        actionLabels: event.action_label || [],
                                        platform: 'GA4',
                                    };
                                    result.configuredEvents.push(eventConfig);
                                }
                                if (event.action_label) {
                                    event.action_label.forEach((label) => {
                                        // Extraer base ID de labels como "AW-123/xyz"
                                        const baseId = label.split('/')[0];
                                        if (baseId.startsWith('G-') && !result.ga4Ids.includes(baseId)) {
                                            result.ga4Ids.push(baseId);
                                        }
                                        else if (baseId.startsWith('AW-') && !result.googleAdsIds.includes(baseId)) {
                                            result.googleAdsIds.push(baseId);
                                        }
                                        else if (baseId.startsWith('GT-') && !result.googleTagIds.includes(baseId)) {
                                            result.googleTagIds.push(baseId);
                                        }
                                        else if (baseId.startsWith('MC-') && !result.merchantCenterIds.includes(baseId)) {
                                            result.merchantCenterIds.push(baseId);
                                        }
                                    });
                                }
                            });
                        }
                    }
                    catch (e) {
                        // Si falla el parsing interno, buscar con regex
                        extractGoogleIdsFromString(config.config, result);
                    }
                }
                // Meta Pixel (app oficial de Meta/Facebook)
                if (config.pixel_id && config.pixel_type === 'facebook_pixel') {
                    result.metaPixelIds.push(config.pixel_id);
                    result.hasMetaPixelApp = true;
                    // Cuando Meta Pixel está instalado via la app oficial de Shopify,
                    // automáticamente dispara estos eventos estándar de e-commerce
                    const metaStandardEvents = [
                        'PageView',
                        'ViewContent',
                        'AddToCart',
                        'InitiateCheckout',
                        'AddPaymentInfo',
                        'Purchase',
                        'Search',
                    ];
                    metaStandardEvents.forEach(eventName => {
                        result.configuredEvents.push({
                            type: eventName,
                            actionLabels: [config.pixel_id],
                            platform: 'MetaPixel',
                        });
                    });
                }
                // TikTok Pixel
                if (config.pixelCode && pixel.apiClientId === 4383523) {
                    result.tiktokPixelIds.push(config.pixelCode);
                }
                // Otros pixels de apps
                if (config.accountID && pixel.type === 'APP') {
                    result.otherPixels.push({
                        type: 'shopify_app',
                        id: config.accountID,
                        apiClientId: pixel.apiClientId,
                    });
                }
            });
        }
        catch (e) {
            // Si falla el parsing, intentar con regex
            extractGoogleIdsFromString(webPixelsMatch[1], result);
        }
    }
    // Patrón 2: Buscar IDs directamente en el HTML (método tradicional)
    extractGoogleIdsFromString(html, result);
    // Patrón 3: Shopify checkout/storefront config
    const storefrontConfig = /storefrontAccessToken['":\s]+['"]([^'"]+)['"]|checkout-api-token['":\s]+content=['"]([^'"]+)['"]/gi;
    // No extraemos estos, pero los usamos para confirmar que es Shopify
    // Eliminar duplicados
    result.ga4Ids = [...new Set(result.ga4Ids)];
    result.googleAdsIds = [...new Set(result.googleAdsIds)];
    result.googleTagIds = [...new Set(result.googleTagIds)];
    result.merchantCenterIds = [...new Set(result.merchantCenterIds)];
    result.metaPixelIds = [...new Set(result.metaPixelIds)];
    result.tiktokPixelIds = [...new Set(result.tiktokPixelIds)];
    return result;
}
/**
 * Extrae IDs de Google de un string usando regex
 */
function extractGoogleIdsFromString(content, result) {
    // Lista de falsos positivos conocidos que coinciden con el patrón G-XXXX
    const ga4FalsePositives = new Set([
        'G-RECAPTCHA', 'G-SAMPLING', 'G-ANIMATION',
        'G-ANIMATION', 'G-IMAGE', 'G-VIDEO', 'G-AUDIO',
    ]);
    // GA4 IDs (G-XXXXXXXXXX)
    // Un ID válido de GA4 tiene exactamente formato G-[A-Z0-9]{10} (10 caracteres alfanuméricos)
    // y típicamente contiene al menos un número
    const ga4Pattern = /['"\\]?(G-[A-Z0-9]{8,12})['"\\]?/gi;
    let match;
    while ((match = ga4Pattern.exec(content)) !== null) {
        const originalId = match[1];
        const id = originalId.toUpperCase();
        // Detectar IDs sospechosos con mezcla irregular de mayúsculas/minúsculas
        // Los IDs reales de Google son consistentemente mayúsculas
        const hasSuspiciousCasing = /[a-z]/.test(originalId) && /[A-Z]/.test(originalId.substring(2));
        // Filtrar: debe tener al menos un dígito y no ser un falso positivo conocido
        if (!result.ga4Ids.includes(id) &&
            /^G-[A-Z0-9]{8,12}$/.test(id) &&
            /\d/.test(id) && // Debe contener al menos un dígito
            !ga4FalsePositives.has(id) &&
            !/^G-[A-Z]+$/i.test(id) && // No puede ser solo letras
            !hasSuspiciousCasing) { // No mezcla irregular de mayúsculas/minúsculas
            result.ga4Ids.push(id);
        }
    }
    // Google Ads IDs (AW-XXXXXXXXXXX)
    const adsPattern = /['"\\]?(AW-\d{9,12})['"\\]?/gi;
    while ((match = adsPattern.exec(content)) !== null) {
        const id = match[1];
        if (!result.googleAdsIds.includes(id)) {
            result.googleAdsIds.push(id);
        }
    }
    // Google Tag IDs (GT-XXXXXXXXX) - Nuevo formato
    const gtPattern = /['"\\]?(GT-[A-Z0-9]{6,12})['"\\]?/gi;
    while ((match = gtPattern.exec(content)) !== null) {
        const id = match[1].toUpperCase();
        if (!result.googleTagIds.includes(id)) {
            result.googleTagIds.push(id);
        }
    }
    // Merchant Center IDs (MC-XXXXXXXXXXX)
    const mcPattern = /['"\\]?(MC-[A-Z0-9]{8,12})['"\\]?/gi;
    while ((match = mcPattern.exec(content)) !== null) {
        const id = match[1].toUpperCase();
        if (!result.merchantCenterIds.includes(id)) {
            result.merchantCenterIds.push(id);
        }
    }
    // Meta Pixel IDs (solo números, 15-16 dígitos)
    const metaPattern = /pixel_id['":\s\\]+['"\\]?(\d{15,16})['"\\]?/gi;
    while ((match = metaPattern.exec(content)) !== null) {
        if (!result.metaPixelIds.includes(match[1])) {
            result.metaPixelIds.push(match[1]);
        }
    }
}
/**
 * Detecta patrones específicos de Shopify que inyectan tracking
 * @param html - HTML de la página
 * @returns Información adicional de tracking de Shopify
 */
function detectShopifyTrackingPatterns(html) {
    return {
        hasWebPixelsManager: /web-pixels-manager|webPixelsManager/i.test(html),
        hasMonorailTracking: /monorail-edge\.shopifysvc\.com/i.test(html),
        hasTrekkieTracking: /trekkie|shopify-analytics/i.test(html),
        shopifyAppsDetected: extractShopifyAppNames(html),
    };
}
/**
 * Extrae nombres de apps de Shopify que manejan tracking
 */
function extractShopifyAppNames(html) {
    const apps = [];
    // Detectar apps conocidas por su apiClientId
    const appMappings = {
        1780363: 'Google & YouTube (Official)',
        2329312: 'Meta Pixel (Facebook)',
        4383523: 'TikTok Pixel',
        12388204545: 'Third-party Analytics App',
        2775569: 'Shopify Analytics',
        123074: 'Klaviyo',
    };
    const apiClientPattern = /"apiClientId":\s*(\d+)/g;
    let match;
    while ((match = apiClientPattern.exec(html)) !== null) {
        const clientId = parseInt(match[1]);
        if (appMappings[clientId] && !apps.includes(appMappings[clientId])) {
            apps.push(appMappings[clientId]);
        }
    }
    return apps;
}
