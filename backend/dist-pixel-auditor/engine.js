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
function safeStr(v) {
    return typeof v === "string" ? v : "";
}
/**
 * Extrae IDs de GTM desde src/content.
 * (Ya tienes extractGtmIds en crawler, pero aquí lo dejamos local para no depender de otra firma.)
 */
function extractGtmIdsFromScripts(scripts) {
    const ids = new Set();
    const patterns = [
        /['"](GTM-[A-Z0-9]+)['"]/gi,
        /\bid\s*=\s*['"]?(GTM-[A-Z0-9]+)['"]?/gi,
        /\bgtm\.js\?id=(GTM-[A-Z0-9]+)/gi,
    ];
    for (const s of scripts) {
        const src = safeStr(s.src);
        if (src) {
            const m = /[?&]id=(GTM-[A-Z0-9]+)/i.exec(src);
            if (m?.[1])
                ids.add(m[1]);
        }
        const content = safeStr(s.content);
        if (!content)
            continue;
        for (const p of patterns) {
            let m;
            while ((m = p.exec(content)) !== null) {
                if (m?.[1])
                    ids.add(m[1]);
            }
        }
    }
    return Array.from(ids);
}
function generateSummary(args) {
    const recommendations = [];
    let issuesFound = 0;
    let score = 100;
    // GA4
    if (!args.ga4?.detected) {
        recommendations.push("Google Analytics 4 no está instalado.");
        score -= 20;
    }
    else {
        issuesFound += args.ga4?.errors?.length ?? 0;
        const errors = args.ga4?.errors ?? [];
        if (errors.includes("multiple_ga4_ids")) {
            recommendations.push("Se detectaron múltiples IDs de GA4. Conserva solo el principal.");
            score -= 10;
        }
        if (errors.includes("ga4_script_without_config")) {
            recommendations.push("GA4 parece cargarse sin configuración (gtag('config')). Revisa implementación.");
            score -= 15;
        }
    }
    // GTM
    if (!args.gtm?.detected) {
        recommendations.push("Considera implementar Google Tag Manager para administrar etiquetas.");
        score -= 5;
    }
    else {
        issuesFound += args.gtm?.errors?.length ?? 0;
        const errors = args.gtm?.errors ?? [];
        if (errors.includes("duplicate_container")) {
            recommendations.push("Se detectó contenedor GTM duplicado. Elimina duplicados.");
            score -= 15;
        }
        if (errors.includes("datalayer_not_initialized")) {
            recommendations.push("dataLayer no está inicializado antes de GTM. Ajusta el orden de carga.");
            score -= 10;
        }
    }
    // Meta Pixel
    if (!args.metaPixel?.detected) {
        recommendations.push("Meta Pixel no está instalado.");
        score -= 10;
    }
    else {
        issuesFound += args.metaPixel?.errors?.length ?? 0;
        const errors = args.metaPixel?.errors ?? [];
        if (errors.includes("multiple_pixel_ids")) {
            recommendations.push("Se detectaron múltiples Pixel IDs. Elimina duplicados.");
            score -= 10;
        }
    }
    // Google Ads
    if (args.googleAds?.detected) {
        issuesFound += args.googleAds?.errors?.length ?? 0;
    }
    // Duplicados
    if (args.duplicateEvents?.length) {
        const unique = new Set(args.duplicateEvents.map((e) => `${e?.type ?? ""}:${e?.name ?? ""}`));
        if (unique.size > 0) {
            recommendations.push(`Se encontraron ${unique.size} evento(s) duplicado(s).`);
            issuesFound += unique.size;
            score -= unique.size * 5;
        }
    }
    // Params faltantes
    if (args.eventsWithMissingParams?.length) {
        for (const it of args.eventsWithMissingParams) {
            const ev = it?.event;
            const missing = it?.missingParams ?? [];
            if (ev?.name && missing.length) {
                recommendations.push(`El evento "${ev.name}" no incluye: ${missing.join(", ")}.`);
                issuesFound += 1;
                score -= 8;
            }
        }
    }
    // Shopify
    if (args.shopify?.isShopify && args.shopify?.hasWebPixelsManager) {
        recommendations.push("Shopify Web Pixels Manager detectado.");
    }
    score = Math.max(0, Math.min(100, score));
    if (issuesFound === 0 && score === 100) {
        recommendations.push("Excelente: no se detectaron problemas importantes.");
    }
    return {
        trackingHealthScore: score,
        issuesFound,
        recommendations,
    };
}
function extractScriptsFromHTML(html) {
    const scripts = { inline: [], external: [] };
    const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
        const attributes = match[1] || "";
        const content = match[2] || "";
        const srcMatch = /src=["']([^"']+)["']/i.exec(attributes);
        if (srcMatch?.[1])
            scripts.external.push({ src: srcMatch[1] });
        else if (content.trim())
            scripts.inline.push(content);
    }
    return scripts;
}
async function runPixelAudit(input, includeDetailsLegacy = false) {
    const traceId = typeof input === "object" && input ? input.traceId : undefined;
    const url = typeof input === "string" ? input : (input?.url || "").trim();
    const html = typeof input === "object" && input ? (input.html || "").trim() : "";
    // ✅ Default TRUE estilo German (solo se apaga si viene explícitamente false en firma moderna)
    const includeDetails = typeof input === "string" ? !!includeDetailsLegacy : input.includeDetails === false ? false : true;
    if (!url && !html)
        throw new Error("URL_OR_HTML_REQUIRED");
    // 1) Obtener PageContent (URL o HTML)
    let page;
    if (html) {
        page = { html, scripts: extractScriptsFromHTML(html) };
    }
    else {
        page = await (0, fetchPage_1.fetchPage)(url);
    }
    // 2) Unificar scripts inline + refs externas
    const allScripts = (0, extractScripts_1.getAllScripts)(page);
    // 3) Inyectar GTM container (como German)
    const gtmIds = extractGtmIdsFromScripts(allScripts);
    const injectedGtmScripts = gtmIds.map((id) => ({
        src: `https://www.googletagmanager.com/gtm.js?id=${id}`,
        content: "",
    }));
    // 4) Lista externa única (refs + inyectados)
    const scriptsWithSrc = allScripts
        .filter((s) => typeof s.src === "string" && safeStr(s.src))
        .map((s) => ({ src: safeStr(s.src), content: safeStr(s.content) }));
    const combinedExternal = [...scriptsWithSrc, ...injectedGtmScripts];
    const uniqueExternal = Array.from(new Map(combinedExternal.map((s) => [String(s.src).toLowerCase(), s])).values());
    globalThis.__PIXEL_AUDITOR_HTML__ = page.html;
    // ✅ CLAVE: descargar externos relevantes SIEMPRE para no perder detección real
    const externalScripts = await (0, extractScripts_1.fetchRelevantExternalScripts)(uniqueExternal, url || undefined);
    delete globalThis.__PIXEL_AUDITOR_HTML__;
    // 5) Merge de descargas dentro de allScripts
    for (const downloaded of externalScripts) {
        const src = safeStr(downloaded?.src);
        const content = safeStr(downloaded?.content);
        if (!src || !content)
            continue;
        const existing = allScripts.find((s) => safeStr(s.src) === src);
        if (existing) {
            existing.content = content;
            if (downloaded?.excludeFromEvents != null) {
                existing.excludeFromEvents = downloaded.excludeFromEvents;
            }
        }
        else {
            allScripts.push({
                type: "external",
                src,
                content,
                excludeFromEvents: downloaded?.excludeFromEvents,
            });
        }
    }
    // 6) Detectores principales
    const ga4 = (0, ga4_1.detectGA4)(page, allScripts);
    const gtm = (0, gtm_1.detectGTM)(page, allScripts);
    const metaPixel = (0, metaPixel_1.detectMetaPixel)(page, allScripts);
    const googleAds = (0, googleAds_1.detectGoogleAds)(page, allScripts);
    // 7) Shopify
    const shopifySignals = (0, shopifyPixels_1.detectShopifyTrackingPatterns)(page.html);
    const isShopify = !!shopifySignals.hasWebPixelsManager ||
        !!shopifySignals.hasMonorailTracking ||
        !!shopifySignals.hasTrekkieTracking ||
        ((shopifySignals.shopifyAppsDetected?.length ?? 0) > 0);
    const shopify = {
        ...shopifySignals,
        isShopify,
        appsDetected: shopifySignals.shopifyAppsDetected ?? [],
        tiktokPixelIds: [],
    };
    // 8) Eventos
    const events = (0, events_1.extractEvents)(page, allScripts);
    const duplicateEvents = (0, events_1.findDuplicateEvents)(events);
    const eventsWithMissingParams = (0, events_1.validateEventParameters)(events);
    // 9) Summary
    const summary = generateSummary({
        ga4,
        gtm,
        metaPixel,
        googleAds,
        shopify,
        events,
        duplicateEvents,
        eventsWithMissingParams,
    });
    // 10) Respuesta final
    const result = {
        status: "ok",
        url: url || "manual-html-input",
        ga4,
        gtm,
        metaPixel,
        googleAds,
        merchantCenter: { detected: false, ids: [], errors: [] },
        shopify,
        events,
        summary,
    };
    // 11) Extras
    if (includeDetails) {
        result.externalScripts = externalScripts;
        result.duplicates = duplicateEvents;
        result.analysis = eventsWithMissingParams;
        if (traceId)
            result.traceId = traceId;
    }
    return result;
}
