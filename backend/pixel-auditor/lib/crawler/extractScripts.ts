/**
 * Pixel Auditor AI™ - Script Extractor
 * Módulo para extraer y procesar scripts de páginas web
 */

import { PageContent, ScriptInfo } from "../../type/AuditResult";
import { fetchExternalScript } from "./fetchPage";

/**
 * Convierte el contenido de una página en una lista unificada de scripts
 */
export function getAllScripts(pageContent: PageContent): ScriptInfo[] {
  const allScripts: ScriptInfo[] = [];

  // Inline
  pageContent.scripts.inline.forEach((content, index) => {
    allScripts.push({
      type: "inline",
      content,
      line: index + 1,
    });
  });

  // Externos (refs)
  pageContent.scripts.external.forEach((script, index) => {
    allScripts.push({
      type: "external",
      content: (script as any).content || "",
      src: script.src,
      line: pageContent.scripts.inline.length + index + 1,
    });
  });

  return allScripts;
}

/**
 * Resolver URLs relativas con base en siteUrl:
 * - usa URL() real para soportar ../, ./, ?v=, etc.
 * - //cdn... => https:
 */
function resolveScriptUrl(src: string, siteUrl?: string): string {
  const s = (src || "").trim();
  if (!s) return "";

  // evita "javascript:" o data:
  const low = s.toLowerCase();
  if (low.startsWith("javascript:") || low.startsWith("data:")) return "";

  try {
    // soporte para //cdn...
    if (s.startsWith("//")) return "https:" + s;

    // si ya es absoluta
    if (s.startsWith("http://") || s.startsWith("https://")) return s;

    // si tenemos siteUrl, resolvemos de verdad
    if (siteUrl) {
      const base = new URL(siteUrl);
      return new URL(s, base).toString();
    }

    // si no tenemos base, devolvemos tal cual (mejor que romper)
    return s;
  } catch {
    return s;
  }
}

/**
 * Dominio base (ej: www.shop.webmentor.app -> webmentor.app)
 */
function getBaseDomain(hostname: string): string {
  const clean = (hostname || "").replace(/^www\./i, "").trim();
  if (!clean) return "";
  const parts = clean.split(".");
  if (parts.length <= 2) return clean;
  return parts.slice(-2).join(".");
}

function isSameBaseDomain(scriptUrl: string, baseDomain: string): boolean {
  if (!baseDomain) return false;
  try {
    const u = new URL(scriptUrl);
    const host = u.hostname.replace(/^www\./i, "");
    return host === baseDomain || host.endsWith("." + baseDomain);
  } catch {
    return false;
  }
}

/**
 * Heurística: scripts “tracking” que vale la pena bajar aunque sean terceros
 * (porque contienen IDs/config que detectores necesitan).
 *
 * ✅ Aquí está el “gap killer”: dominios y rutas que German suele bajar.
 */
function isTrackingScript(url: string): boolean {
  const u = (url || "").toLowerCase();

  // Google / GA / GTM / Ads
  if (
    u.includes("googletagmanager.com/gtm.js") ||
    u.includes("googletagmanager.com/gtag/js") ||
    u.includes("googletagmanager.com/ns.html") ||
    u.includes("gtm.js?id=") ||
    u.includes("gtag/js?id=") ||
    u.includes("google-analytics.com") ||
    u.includes("analytics.google.com") ||
    u.includes("g.doubleclick.net") ||
    u.includes("googleads.g.doubleclick.net") ||
    u.includes("stats.g.doubleclick.net") ||
    u.includes("doubleclick.net") ||
    u.includes("googleadservices.com") ||
    u.includes("googlesyndication.com") ||
    u.includes("gstatic.com")
  ) {
    return true;
  }

  // Meta
  if (
    u.includes("connect.facebook.net") ||
    u.includes("facebook.net") ||
    u.includes("facebook.com/tr") || // noscript pixel
    u.includes("fbevents.js")
  ) {
    return true;
  }

  // Otros trackers comunes que suelen aparecer en sitios reales (y German detecta más)
  if (
    u.includes("snap.licdn.com") ||          // LinkedIn Insight Tag
    u.includes("px.ads.linkedin.com") ||     // LinkedIn pixel
    u.includes("static.ads-twitter.com") ||  // Twitter/X pixel
    u.includes("tiktok.com") ||              // TikTok pixel
    u.includes("pinterest.com") ||           // Pinterest tag
    u.includes("cdn.segment.com") ||
    u.includes("cdn.amplitude.com") ||
    u.includes("cdn.mxpnl.com") ||           // Mixpanel
    u.includes("hotjar.com") ||
    u.includes("clarity.ms") ||
    u.includes("intercom.io") ||
    u.includes("crisp.chat") ||
    u.includes("tawk.to")
  ) {
    return true;
  }

  return false;
}

/**
 * Scripts que NO deberían contaminar el análisis de eventos del sitio
 * (pero igual se descargan para detección de IDs/estado)
 */
const EXCLUDE_FROM_EVENT_ANALYSIS = [
  "facebook.net",
  "connect.facebook.net",
  "fbevents.js",
  "facebook.com/tr",
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com/gtag/js",
  "googleadservices.com",
  "doubleclick.net",
  "g.doubleclick.net",
  "googleads.g.doubleclick.net",
  "stats.g.doubleclick.net",
  "googlesyndication.com",
  "gstatic.com",
  "cdn.segment.com",
  "cdn.amplitude.com",
  "cdn.mxpnl.com",
  "hotjar.com",
  "clarity.ms",
  "intercom.io",
  "crisp.chat",
  "tawk.to",
  "snap.licdn.com",
  "px.ads.linkedin.com",
  "static.ads-twitter.com",
  "tiktok.com",
  "pinterest.com",
];

/**
 * Dedupe por URL normalizada
 */
function normalizeKey(url: string) {
  return (url || "").trim().toLowerCase();
}

/**
 * ✅ EXTRA CANDIDATES (gap killer):
 * - noscript pixel (img src facebook.com/tr)
 * - gtm noscript iframe (googletagmanager.com/ns.html?id=GTM-xxx)
 * - preload as="script" href=...
 * - script src dentro del HTML ya lo tienes, pero esto completa lo que NO es script tag
 */
function extractExtraTrackingUrlsFromHtml(html: string): string[] {
  const out: string[] = [];
  if (!html) return out;

  const patterns: RegExp[] = [
    // <img src="https://www.facebook.com/tr?...">
    /<img[^>]+src=["']([^"']*facebook\.com\/tr[^"']+)["']/gi,
    // <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX">
    /<iframe[^>]+src=["']([^"']*googletagmanager\.com\/ns\.html[^"']+)["']/gi,
    // <link rel="preload" as="script" href="...">
    /<link[^>]+rel=["']preload["'][^>]+as=["']script["'][^>]+href=["']([^"']+)["']/gi,
    // import("https://...") dentro de inline scripts
    /import\(\s*["'](https?:\/\/[^"']+)["']\s*\)/gi,
  ];

  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(html)) !== null) {
      if (m?.[1]) out.push(m[1]);
    }
  }

  return out;
}

/**
 * Descarga el contenido de scripts externos relevantes para auditoría
 * - Baja scripts del mismo dominio base (para eventos reales del sitio)
 * - Baja scripts “tracking” (GTM/gtag/fb/ads) aunque sean terceros (para detectar IDs)
 * - Incluye extra candidates del HTML (noscript/iframe/preload/import)
 * - Dedupe
 * - Límite de concurrencia
 */
export async function fetchRelevantExternalScripts(
  externalScripts: { src: string; content?: string }[],
  siteUrl?: string
): Promise<{ src: string; content: string; excludeFromEvents?: boolean }[]> {
  const relevantScripts: { src: string; content: string; excludeFromEvents?: boolean }[] = [];

  // Info del sitio
  let siteBaseDomain = "";
  if (siteUrl) {
    try {
      const u = new URL(siteUrl);
      siteBaseDomain = getBaseDomain(u.hostname);
    } catch {}
  }

  // 1) Resolver URLs de scripts externos
  const resolvedFromScripts = externalScripts
    .map((s) => resolveScriptUrl(s.src, siteUrl))
    .filter(Boolean);

  // 2) EXTRA candidates del HTML (cierra gap)
  //    (si no viene html, no pasa nada)
  const htmlCandidates = extractExtraTrackingUrlsFromHtml((globalThis as any).__PIXEL_AUDITOR_HTML__ || "");

  // Nota: si no quieres usar global, puedes ignorar esto.
  // Como tú ya tienes PageContent.html en engine, lo ideal es pasarla aquí,
  // pero para no cambiar firmas, dejamos un hook opcional (ver nota al final).
  const resolvedFromHtml = htmlCandidates
    .map((s) => resolveScriptUrl(s, siteUrl))
    .filter(Boolean);

  // 3) Dedupe global
  const allResolved = [...resolvedFromScripts, ...resolvedFromHtml];
  const uniqueUrls = Array.from(new Set(allResolved.map(normalizeKey)))
    .map((k) => allResolved.find((u) => normalizeKey(u) === k)!)
    .filter(Boolean);

  // 4) Filtrar: mismo sitio OR tracking script
  const candidates = uniqueUrls.filter((fullUrl) => {
    const sameSite = isSameBaseDomain(fullUrl, siteBaseDomain);
    return sameSite || isTrackingScript(fullUrl);
  });

  // 5) Concurrencia limitada
  const CONCURRENCY = 8;
  let idx = 0;

  async function worker() {
    while (idx < candidates.length) {
      const current = candidates[idx++];
      const lower = current.toLowerCase();

      const isExcludedFromEvents = EXCLUDE_FROM_EVENT_ANALYSIS.some((p) => lower.includes(p.toLowerCase()));

      // ✅ GTM container sí lo queremos analizar para eventos
      const isGtmContainer =
        lower.includes("googletagmanager.com/gtm.js") ||
        lower.includes("gtm.js?id=");

      const shouldExclude = isExcludedFromEvents && !isGtmContainer;

      try {
        const content = await fetchExternalScript(current);
        if (content) {
          relevantScripts.push({
            src: current,
            content,
            excludeFromEvents: shouldExclude,
          });
        }
      } catch {
        // silencioso
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker());
  await Promise.all(workers);

  return relevantScripts;
}

/**
 * Busca un patrón en todos los scripts
 */
export function searchInScripts(
  scripts: ScriptInfo[],
  pattern: RegExp
): Array<{ match: string; script: ScriptInfo; index: number }> {
  const results: Array<{ match: string; script: ScriptInfo; index: number }> = [];

  scripts.forEach((script) => {
    if (!script.content) return;

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
 */
export function extractAllMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];

  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const globalPattern = new RegExp(pattern.source, flags);

  let match: RegExpExecArray | null;
  while ((match = globalPattern.exec(text)) !== null) {
    matches.push(match);
  }

  return matches;
}

/**
 * Extrae IDs de GTM en los scripts para descargar sus contenedores
 */
export function extractGtmIds(scripts: ScriptInfo[]): string[] {
  const gtmIds = new Set<string>();

  const patterns = [
    /['"](GTM-[A-Z0-9]+)['"]/gi,
    /id=(GTM-[A-Z0-9]+)/gi,
    /gtm\.js\?id=(GTM-[A-Z0-9]+)/gi,
  ];

  scripts.forEach((script) => {
    if (script.type === "external" && (script as any).src) {
      const urlMatch = /id=(GTM-[A-Z0-9]+)/i.exec(String((script as any).src));
      if (urlMatch?.[1]) gtmIds.add(urlMatch[1]);
    }

    if (!script.content) return;

    patterns.forEach((pattern) => {
      const matches = extractAllMatches(script.content!, pattern);
      matches.forEach((m) => {
        if (m?.[1]) gtmIds.add(m[1]);
      });
    });
  });

  return Array.from(gtmIds);
}
