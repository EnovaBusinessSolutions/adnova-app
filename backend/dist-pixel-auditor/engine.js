"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPixelAudit = runPixelAudit;
// backend/pixel-auditor/engine.ts
const fetchPage_1 = require("./lib/crawler/fetchPage");
const extractScripts_1 = require("./lib/crawler/extractScripts");
const ga4_1 = require("./lib/auditor/ga4");
const gtm_1 = require("./lib/auditor/gtm");
const metaPixel_1 = require("./lib/auditor/metaPixel");
const googleAds_1 = require("./lib/auditor/googleAds");
const shopifyPixels_1 = require("./lib/auditor/shopifyPixels");
const events_1 = require("./lib/auditor/events");
async function runPixelAudit(url, includeDetails = false) {
    // 1) Descargar HTML + metadatos
    const page = await (0, fetchPage_1.fetchPage)(url);
    // 2) Extraer scripts (internos + externos)
    const allScripts = (0, extractScripts_1.getAllScripts)(page);
    // 3) (Opcional) descargar contenido de scripts externos relevantes (para detectores que lo usen)
    //    OJO: algunos detectores NO lo necesitan, pero lo dejamos listo para "modo detallado".
    const scriptsWithSrc = allScripts
        .filter((s) => typeof s.src === "string" && s.src.length > 0)
        .map((s) => ({ src: s.src, content: s.content }));
    // Solo lo bajamos si el caller pidió detalle (así no haces crawling pesado siempre)
    const externalScripts = includeDetails
        ? await (0, extractScripts_1.fetchRelevantExternalScripts)(scriptsWithSrc)
        : [];
    // 4) Detectores principales (estos esperan: (page, scripts))
    const ga4 = (0, ga4_1.detectGA4)(page, allScripts);
    const gtm = (0, gtm_1.detectGTM)(page, allScripts);
    const metaPixel = (0, metaPixel_1.detectMetaPixel)(page, allScripts);
    const googleAds = (0, googleAds_1.detectGoogleAds)(page, allScripts);
    // 5) Shopify: tu detector actual regresa "señales", pero el type ShopifyInfo exige campos extra
    const shopifySignals = (0, shopifyPixels_1.detectShopifyTrackingPatterns)(page.html);
    const isShopify = !!shopifySignals.hasWebPixelsManager ||
        !!shopifySignals.hasMonorailTracking ||
        !!shopifySignals.hasTrekkieTracking ||
        (shopifySignals.shopifyAppsDetected?.length ?? 0) > 0;
    const shopify = {
        ...shopifySignals,
        isShopify,
        appsDetected: shopifySignals.shopifyAppsDetected ?? [],
        tiktokPixelIds: [],
    };
    // 6) Eventos
    const events = (0, events_1.extractEvents)(page, allScripts);
    const duplicateEvents = (0, events_1.findDuplicateEvents)(events);
    const eventAnalysis = (0, events_1.validateEventParameters)(events);
    // 7) Construir respuesta (sin teoría, puro resultado)
    const result = {
        status: "ok",
        url, // ✅ NO uses page.url (no existe en PageContent)
        ga4,
        gtm,
        metaPixel,
        googleAds,
        // Si tu type lo exige, lo dejamos “neutral”
        merchantCenter: { detected: false, ids: [], errors: [] },
        shopify,
        events,
        summary: {
            trackingHealthScore: 0,
            issuesFound: 0,
            recommendations: [],
        },
    };
    // 8) Si tu AuditResult soporta extras en modo detallado, los anexamos sin romper tipos
    if (includeDetails) {
        result.externalScripts = externalScripts;
        result.duplicates = duplicateEvents;
        result.analysis = eventAnalysis;
    }
    return result;
}
