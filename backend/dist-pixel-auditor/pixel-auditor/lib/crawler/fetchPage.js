"use strict";
/**
 * Pixel Auditor AI™ - Page Fetcher
 * Módulo para descargar y procesar páginas web
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPage = fetchPage;
exports.fetchExternalScript = fetchExternalScript;

/**
 * Headers “humanos” para reducir bloqueos / HTML incompleto
 */
function browserLikeHeaders(extra) {
  return Object.assign(
    {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
      // más estable en Node/proxies (evita br en algunos entornos)
      "Accept-Encoding": "gzip, deflate",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
    extra || {}
  );
}

/**
 * Descarga una página web y retorna el HTML completo
 * @param url - URL de la página a auditar
 * @returns Contenido HTML de la página
 */
async function fetchPage(url) {
  try {
    // Validar URL
    const validUrl = new URL(url);

    // Descargar página con timeout de 20 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(validUrl.href, {
      signal: controller.signal,
      headers: browserLikeHeaders(),
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Extraer scripts inline y externos
    const scripts = extractScriptsFromHTML(html);

    // ✅ finalUrl es CLAVE para resolver scripts relativos luego ( /assets/app.js, etc )
    const finalUrl = response.url || validUrl.href;

    return {
      html,
      scripts,
      finalUrl,
      status: response.status,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error("Request timeout: La página tardó más de 20 segundos en responder");
      }
      throw new Error(`Error fetching page: ${error.message}`);
    }
    throw new Error("Unknown error fetching page");
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
  // Captura tanto scripts inline como externos
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const attributes = match[1] || "";
    const content = match[2] || "";

    // Buscar atributo src
    const srcMatch = /src=["']([^"']+)["']/i.exec(attributes);
    if (srcMatch) {
      scripts.external.push({ src: srcMatch[1] });
    } else if (content.trim()) {
      scripts.inline.push(content);
    }
  }

  return scripts;
}

/**
 * Descarga el contenido de un script externo
 * @param scriptUrl - URL del script (de preferencia absoluta; si no, pásale absoluta desde extractScripts)
 * @returns Contenido del script o null si falla
 */
async function fetchExternalScript(scriptUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(scriptUrl, {
      signal: controller.signal,
      headers: browserLikeHeaders({
        // para scripts mejor pedir */*
        Accept: "*/*",
      }),
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch (error) {
    return null;
  }
}
