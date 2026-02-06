"use strict";
/**
 * Pixel Auditor AI™ - Page Fetcher
 * Módulo para descargar y procesar páginas web
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPage = fetchPage;
exports.extractScriptsFromHTML = extractScriptsFromHTML;
exports.fetchExternalScript = fetchExternalScript;
/**
 * Descarga una página web y retorna el HTML completo
 * Soporta modo fallback HTML manual (estilo German)
 *
 * @param url - URL de la página a auditar (puede ser "manual-html-input" si viene html)
 * @param opts - Opciones (html manual, traceId, timeout)
 */
async function fetchPage(url, opts) {
    const htmlManual = typeof opts?.html === "string" ? opts.html.trim() : "";
    const timeoutMs = Number.isFinite(opts?.timeoutMs) ? Number(opts.timeoutMs) : 20000;
    // ✅ Modo HTML manual (fallback): no hacemos fetch
    if (htmlManual) {
        const scripts = extractScriptsFromHTML(htmlManual);
        return { html: htmlManual, scripts };
    }
    try {
        // Validar URL (solo si vamos a fetchear)
        const validUrl = new URL(url);
        // Descargar página con timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(validUrl.href, {
            signal: controller.signal,
            headers: {
                // ✅ UA más "browser-like" (mejora acceso en sitios que bloquean crawlers obvios)
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
            },
            redirect: "follow",
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            // Mensaje útil tipo German para fallback HTML
            throw new Error(`HTTP ${response.status}: No se pudo acceder. Usa el modo HTML manual.`);
        }
        const html = await response.text();
        // Extraer scripts inline y externos
        const scripts = extractScriptsFromHTML(html);
        return { html, scripts };
    }
    catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(`Timeout: La página tardó más de ${Math.round(timeoutMs / 1000)}s. Usa el modo HTML manual.`);
        }
        const msg = error instanceof Error ? error.message : "Unknown error fetching page";
        throw new Error(msg);
    }
}
/**
 * Extrae todos los scripts (inline y externos) del HTML
 * @param html - Contenido HTML de la página
 * @returns Objeto con scripts inline y externos
 */
function extractScriptsFromHTML(html) {
    const scripts = {
        inline: [],
        external: [],
    };
    // RegEx para extraer tags <script>
    const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
        const attributes = match[1] || "";
        const content = match[2] || "";
        // Buscar atributo src
        const srcMatch = /src=["']([^"']+)["']/i.exec(attributes);
        if (srcMatch?.[1]) {
            scripts.external.push({ src: srcMatch[1] });
        }
        else if (content.trim()) {
            scripts.inline.push(content);
        }
    }
    return scripts;
}
/**
 * Descarga el contenido de un script externo
 * @param scriptUrl - URL del script
 * @returns Contenido del script o null si falla
 */
async function fetchExternalScript(scriptUrl) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(scriptUrl, {
            signal: controller.signal,
            headers: {
                // ✅ UA coherente con fetchPage
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "*/*",
            },
            redirect: "follow",
        });
        clearTimeout(timeoutId);
        if (!response.ok)
            return null;
        return await response.text();
    }
    catch {
        return null;
    }
}
