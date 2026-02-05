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
 * NOTA:
 * - NO forzamos Accept-Encoding=identity. Dejamos que el runtime negocie (muchos sitios esperan gzip/br).
 * - Agregamos headers tipo navegador (sec-ch-ua, sec-fetch-*) para reducir bot detection.
 */
function browserLikeHeaders(extra) {
  return Object.assign(
    {
      // UA moderno y consistente
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",

      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "es-419,es;q=0.9,en;q=0.8",

      // Deja que fetch/undici maneje encoding correctamente (gzip/deflate/br según soporte)
      // "Accept-Encoding": "gzip, deflate, br",

      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Upgrade-Insecure-Requests": "1",
      DNT: "1",

      // Headers típicos de navegación real
      "Sec-CH-UA": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    },
    extra || {}
  );
}

/**
 * Extrae cookies de headers "set-cookie" y arma un header Cookie simple.
 * Esto NO es un cookie jar perfecto, pero ayuda muchísimo con anti-bot suave.
 */
function mergeSetCookieIntoJar(jar, setCookieArr) {
  const out = Object.assign({}, jar || {});
  const list = Array.isArray(setCookieArr) ? setCookieArr : [];

  list.forEach((sc) => {
    const v = String(sc || "").trim();
    if (!v) return;
    // "name=value; Path=/; Secure; HttpOnly"
    const first = v.split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) return;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) return;
    out[name] = value;
  });

  return out;
}

function jarToCookieHeader(jar) {
  if (!jar || typeof jar !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(jar)) {
    if (!k) continue;
    parts.push(`${k}=${v}`);
  }
  return parts.join("; ");
}

/**
 * Heurística simple para detectar páginas de challenge/blocked
 */
function detectBlockedHint(html, statusCode, contentType) {
  const h = String(html || "");
  const ct = String(contentType || "").toLowerCase();
  const status = Number(statusCode || 0);

  // Si no es HTML, mala señal para auditoría
  if (ct && !ct.includes("text/html") && !ct.includes("application/xhtml")) {
    return { blocked: true, reason: `non_html_content_type:${ct}` };
  }

  // Status típicos
  if (status === 401 || status === 403 || status === 429 || status === 503) {
    // puede ser challenge, rate limit o bloqueo
    // revisamos strings comunes
    const lower = h.toLowerCase();
    if (
      lower.includes("access denied") ||
      lower.includes("request blocked") ||
      lower.includes("bot") ||
      lower.includes("captcha") ||
      lower.includes("security") ||
      lower.includes("challenge") ||
      lower.includes("akamai") ||
      lower.includes("imperva") ||
      lower.includes("cloudflare")
    ) {
      return { blocked: true, reason: `http_${status}_challenge` };
    }
    // aunque no detectemos string, sigue siendo “probable bloqueo”
    return { blocked: true, reason: `http_${status}` };
  }

  const lower = h.toLowerCase();

  // Señales comunes de challenge pages
  const patterns = [
    "cf-chl", // Cloudflare challenge
    "cloudflare",
    "checking your browser",
    "ddos protection",
    "attention required",
    "enable javascript and cookies",
    "captcha",
    "bot protection",
    "akamai",
    "imperva",
    "incapsula",
    "datadome",
    "perimeterx",
    "px-captcha",
    "access denied",
    "request blocked",
  ];

  const hit = patterns.find((p) => lower.includes(p));
  if (hit) return { blocked: true, reason: `challenge:${hit}` };

  // HTML demasiado pequeño suele ser “interstitial”
  if (h.length > 0 && h.length < 1200) {
    return { blocked: true, reason: "html_too_short" };
  }

  return { blocked: false, reason: "" };
}

/**
 * Descarga una página web y retorna el HTML completo (+ debug)
 * @param url - URL de la página a auditar
 * @returns Contenido HTML de la página
 */
async function fetchPage(url) {
  const validUrl = new URL(String(url || "").trim());

  // Timeout 20s
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  let response;
  let html = "";
  let cookieJar = {};

  const startedAt = Date.now();

  try {
    // 1) Primer intento (sin cookies)
    response = await fetch(validUrl.href, {
      signal: controller.signal,
      headers: browserLikeHeaders(),
      redirect: "follow",
      method: "GET",
    });

    // Captura set-cookie para reintento
    // Node fetch/undici: headers.getSetCookie() existe en versiones recientes;
    // fallback: headers.get("set-cookie") puede venir concatenado (no ideal).
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : (response.headers.get("set-cookie")
            ? [response.headers.get("set-cookie")]
            : []);

    cookieJar = mergeSetCookieIntoJar(cookieJar, setCookies);

    html = await response.text();

    const finalUrl = response.url || validUrl.href;
    const statusCode = response.status || 0;
    const statusText = response.statusText || "";
    const contentType =
      (response.headers && response.headers.get("content-type")) || "";

    // Heurística de bloqueo/challenge
    let blockedInfo = detectBlockedHint(html, statusCode, contentType);

    // 2) Reintento si parece bloqueado y tenemos cookies (o aunque no, igual vale)
    //    Cambiamos Sec-Fetch-Site a "same-origin" y mandamos Cookie si hay.
    if (blockedInfo.blocked) {
      const cookieHeader = jarToCookieHeader(cookieJar);
      const retryHeaders = browserLikeHeaders({
        "Sec-Fetch-Site": "same-origin",
        Referer: finalUrl,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      });

      const retry = await fetch(validUrl.href, {
        signal: controller.signal,
        headers: retryHeaders,
        redirect: "follow",
        method: "GET",
      });

      const retrySetCookies =
        typeof retry.headers.getSetCookie === "function"
          ? retry.headers.getSetCookie()
          : (retry.headers.get("set-cookie") ? [retry.headers.get("set-cookie")] : []);

      cookieJar = mergeSetCookieIntoJar(cookieJar, retrySetCookies);

      const retryHtml = await retry.text();

      // Si el segundo intento es “mejor” (más largo / diferente) lo tomamos
      if (typeof retryHtml === "string" && retryHtml.length > html.length) {
        response = retry;
        html = retryHtml;
        blockedInfo = detectBlockedHint(
          html,
          retry.status || 0,
          (retry.headers && retry.headers.get("content-type")) || ""
        );
      }
    }

    clearTimeout(timeoutId);

    const htmlLength = typeof html === "string" ? html.length : 0;
    const htmlSnippet = typeof html === "string" ? html.slice(0, 600) : "";

    // Extraer scripts del HTML que llegó (aunque sea challenge)
    const scripts = extractScriptsFromHTML(html || "");

    return {
      html: html || "",
      scripts,
      finalUrl: response?.url || validUrl.href,
      status: response?.status || 0,
      statusText: response?.statusText || "",
      contentType:
        (response?.headers && response.headers.get("content-type")) || "",

      // Debug útil para engine.js
      htmlLength,
      htmlSnippet,
      blocked: blockedInfo.blocked,
      blockedReason: blockedInfo.reason,

      // Extra debug opcional
      _fetchDebug: {
        tookMs: Date.now() - startedAt,
        cookiesCount: Object.keys(cookieJar || {}).length,
      },
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Request timeout: La página tardó más de 20 segundos en responder"
      );
    }

    if (error instanceof Error) {
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
  const scripts = { inline: [], external: [] };

  // <script ...>...</script>
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const attributes = match[1] || "";
    const content = match[2] || "";

    const srcMatch = /src=["']([^"']+)["']/i.exec(attributes);
    if (srcMatch && srcMatch[1]) {
      scripts.external.push({ src: srcMatch[1] });
    } else if (content && content.trim()) {
      scripts.inline.push(content);
    }
  }

  return scripts;
}

/**
 * Descarga el contenido de un script externo
 * @param scriptUrl - URL del script (idealmente absoluta)
 * @returns Contenido del script o null si falla
 */
async function fetchExternalScript(scriptUrl) {
  try {
    const u = String(scriptUrl || "").trim();
    if (!u) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(u, {
      signal: controller.signal,
      headers: browserLikeHeaders({
        Accept: "*/*",
        // Referer real debería ser el sitio base, pero no lo tenemos aquí
        // (engine/extractScripts ya puede pasar scripts con contexto si lo deseas).
      }),
      redirect: "follow",
      method: "GET",
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    return await response.text();
  } catch {
    return null;
  }
}
