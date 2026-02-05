// backend/routes/pixelAuditor.js
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/**
 * Lee el body aunque llegue como Buffer (caso express.raw),
 * string, o ya como objeto (express.json).
 */
function readBody(req) {
  const b = req.body;
  if (!b) return {};

  if (Buffer.isBuffer(b)) {
    try {
      return JSON.parse(b.toString("utf8") || "{}");
    } catch {
      return {};
    }
  }

  if (typeof b === "string") {
    try {
      return JSON.parse(b || "{}");
    } catch {
      return {};
    }
  }

  if (typeof b === "object") return b;
  return {};
}

function loadRunPixelAudit() {
  // ✅ Rutas reales (confirmadas en Render Shell)
  const candidates = [
    path.join(__dirname, "..", "dist-pixel-auditor", "engine.js"),
    path.join(__dirname, "..", "dist-pixel-auditor", "pixel-auditor", "engine.js"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      // OJO: require cache. En dev, si reinicias server no hay problema.
      const mod = require(p);
      if (typeof mod?.runPixelAudit === "function") return mod.runPixelAudit;
    }
  }

  throw new Error(`PIXEL_ENGINE_NOT_FOUND. Busqué: ${candidates.join(" | ")}`);
}

/* =========================
 * Normalización (clave para UI)
 * ========================= */

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function toIdList(v) {
  // acepta string | number | array | object con ids
  if (!v) return [];
  if (Array.isArray(v)) return uniq(v.map(String));
  if (typeof v === "string" || typeof v === "number") return [String(v)];
  if (typeof v === "object") {
    if (Array.isArray(v.ids)) return uniq(v.ids.map(String));
    if (v.id != null) return [String(v.id)];
    if (v.pixelId != null) return [String(v.pixelId)];
    if (v.measurementId != null) return [String(v.measurementId)];
  }
  return [];
}

function pickCoverage(result) {
  // engine podría usar coverage / platforms / tracking / detected / summary.coverage
  return (
    result?.coverage ||
    result?.platforms ||
    result?.tracking ||
    result?.detected ||
    result?.summary?.coverage ||
    {}
  );
}

function isTruthy(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * Intenta inferir "presencia" aunque no haya IDs.
 * Esto es necesario para parecerse a German:
 * - ejemplo: Meta script cargado pero sin init => instalado=true, ids=[], issues>0
 */
function detectPresence(raw) {
  if (!raw) return false;

  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw.trim().length > 0; // por si viene "G-XXXX" etc.
  if (typeof raw === "number") return true;

  if (typeof raw === "object") {
    // llaves comunes en auditores
    if (isTruthy(raw.installed)) return true;
    if (isTruthy(raw.detected)) return true;
    if (isTruthy(raw.present)) return true;
    if (isTruthy(raw.found)) return true;
    if (isTruthy(raw.hasTag)) return true;
    if (isTruthy(raw.hasScript)) return true;

    // si trae arrays/ids aunque sea vacío a veces significa presencia
    if (Array.isArray(raw.ids) && raw.ids.length > 0) return true;

    // heurística: algunos detectores guardan url del script
    if (typeof raw.src === "string" && raw.src) return true;
    if (typeof raw.scriptUrl === "string" && raw.scriptUrl) return true;

    // si trae "errors/issues" puede ser porque detectó algo mal implementado
    if (Array.isArray(raw.issues) && raw.issues.length > 0) return true;
    if (Array.isArray(raw.errors) && raw.errors.length > 0) return true;
  }

  return false;
}

function normalizeTracking(result) {
  const cov = pickCoverage(result);

  // Intentamos reconocer llaves comunes del engine
  const ga4Raw =
    cov.ga4 ||
    cov.GA4 ||
    cov.googleAnalytics4 ||
    cov.google_analytics_4 ||
    result?.ga4 ||
    result?.measurementId ||
    result?.measurement_id;

  const gtmRaw =
    cov.gtm ||
    cov.GTM ||
    cov.googleTagManager ||
    cov.google_tag_manager ||
    result?.gtm ||
    result?.containerId ||
    result?.container_id;

  const gadsRaw =
    cov.googleAds ||
    cov.google_ads ||
    cov.gads ||
    cov.GADS ||
    cov.adwords ||
    cov.AW ||
    result?.googleAds ||
    result?.google_ads;

  const metaRaw =
    cov.metaPixel ||
    cov.meta_pixel ||
    cov.meta ||
    cov.facebookPixel ||
    cov.facebook_pixel ||
    cov.fbPixel ||
    result?.metaPixel ||
    result?.pixelId ||
    result?.pixel_id;

  const ga4Ids = toIdList(ga4Raw);
  const gtmIds = toIdList(gtmRaw);
  const gadsIds = toIdList(gadsRaw);
  const metaIds = toIdList(metaRaw);

  // ✅ installed debe considerar presencia aunque no haya IDs
  const ga4Installed = ga4Ids.length > 0 || detectPresence(ga4Raw);
  const gtmInstalled = gtmIds.length > 0 || detectPresence(gtmRaw);
  const gadsInstalled = gadsIds.length > 0 || detectPresence(gadsRaw);
  const metaInstalled = metaIds.length > 0 || detectPresence(metaRaw);

  return [
    { key: "ga4", label: "Google Analytics 4", installed: !!ga4Installed, ids: ga4Ids },
    { key: "gtm", label: "Google Tag Manager", installed: !!gtmInstalled, ids: gtmIds },
    { key: "gads", label: "Google Ads", installed: !!gadsInstalled, ids: gadsIds },
    { key: "meta", label: "Meta Pixel", installed: !!metaInstalled, ids: metaIds },
  ];
}

/**
 * Usa score real del engine si viene; si no, fallback simple.
 */
function computeHealth(tracking, rawResult) {
  const engineScore =
    rawResult?.healthScore ??
    rawResult?.score ??
    rawResult?.trackingHealthScore ??
    rawResult?.summary?.trackingHealthScore ??
    rawResult?.summary?.healthScore;

  if (Number.isFinite(Number(engineScore))) {
    const s = Math.max(0, Math.min(100, Number(engineScore)));
    const label = s >= 80 ? "Bueno" : s >= 60 ? "Regular" : "Crítico";
    return { healthScore: s, healthLabel: label, usedEngineScore: true };
  }

  // fallback “simple”
  const hasGA4 = tracking.find((x) => x.key === "ga4")?.installed;
  const hasMeta = tracking.find((x) => x.key === "meta")?.installed;

  let score = 100;
  if (!hasGA4) score -= 25;
  if (!hasMeta) score -= 25;

  score = Math.max(0, Math.min(100, score));
  const healthLabel = score >= 80 ? "Bueno" : score >= 60 ? "Regular" : "Crítico";
  return { healthScore: score, healthLabel, usedEngineScore: false };
}

function buildRecommendations(tracking, issues) {
  const map = Object.fromEntries(tracking.map((t) => [t.key, t]));
  const recs = [];

  // recomendaciones base por instalación
  if (!map.ga4?.installed) {
    recs.push(
      "Google Analytics 4 no está instalado. Instálalo para medir visitas, comportamiento y conversiones."
    );
  }
  if (!map.gtm?.installed) {
    recs.push(
      "Considera implementar Google Tag Manager para administrar etiquetas sin tocar el código en cada cambio."
    );
  }
  if (!map.gads?.installed) {
    recs.push(
      "Si haces campañas en Google Ads, instala la etiqueta/conversiones para medir rendimiento y remarketing."
    );
  }
  if (!map.meta?.installed) {
    recs.push(
      "Meta Pixel no está instalado. Instálalo para remarketing y medición de conversiones en Meta Ads."
    );
  }

  // ✅ si el engine manda recomendaciones, úsalas también
  const fromIssues =
    Array.isArray(issues) && issues.length
      ? issues
          .map((x) => (typeof x === "string" ? x : x?.message || x?.title || ""))
          .filter(Boolean)
      : [];

  // no spamear: solo añade si hay algo útil y diferente
  fromIssues.slice(0, 3).forEach((m) => {
    if (!recs.some((r) => r.toLowerCase() === String(m).toLowerCase())) recs.push(String(m));
  });

  return recs;
}

function normalizeArray(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object") {
    // casos: { items: [] } o { list: [] }
    if (Array.isArray(x.items)) return x.items;
    if (Array.isArray(x.list)) return x.list;
  }
  return [];
}

function normalizePixelAuditResult(rawResult, auditedUrl, includeDetails) {
  const tracking = normalizeTracking(rawResult);

  // ✅ issues/events completos (para UI como German)
  const issues =
    normalizeArray(rawResult?.issues) ||
    normalizeArray(rawResult?.summary?.issues) ||
    [];

  const events =
    normalizeArray(rawResult?.events) ||
    normalizeArray(rawResult?.summary?.events) ||
    [];

  const { healthScore, healthLabel } = computeHealth(tracking, rawResult);

  const issuesCount =
    (Array.isArray(issues) && issues.length) ||
    rawResult?.summary?.issuesCount ||
    rawResult?.issuesCount ||
    rawResult?.summary?.issuesFound ||
    rawResult?.summary?.issues_found ||
    0;

  const eventsCount =
    rawResult?.eventsCount ||
    rawResult?.summary?.eventsCount ||
    (Array.isArray(events) ? events.length : 0) ||
    0;

  // ✅ si engine trae recomendaciones, úsalo; si no, genera
  const engineRecs =
    normalizeArray(rawResult?.recommendations) ||
    normalizeArray(rawResult?.summary?.recommendations) ||
    [];

  const recommendations =
    (engineRecs && engineRecs.length)
      ? engineRecs
      : buildRecommendations(tracking, issues);

  const normalized = {
    auditedUrl: rawResult?.url || rawResult?.auditedUrl || auditedUrl,
    healthScore,
    healthLabel,
    tracking,
    recommendations,
    issuesCount,
    eventsCount,

    // ✅ NUEVO: listas completas
    issues,
    events,
  };

  if (includeDetails) normalized.raw = rawResult; // opcional debug
  return normalized;
}

/* =========================
 * Endpoint
 * ========================= */
router.post("/auditor", async (req, res) => {
  try {
    const body = readBody(req);

    const url =
      (typeof body.url === "string" && body.url.trim()) ||
      (typeof req.query.url === "string" && req.query.url.trim()) ||
      "";

    const includeDetails = !!(body.includeDetails ?? body.include_details);

    if (!url) {
      return res.status(400).json({ ok: false, error: "URL requerida" });
    }

    const runPixelAudit = loadRunPixelAudit();
    const rawResult = await runPixelAudit(url, includeDetails);

    const data = normalizePixelAuditResult(rawResult, url, includeDetails);

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[PIXEL_AUDITOR_ERROR]", err);
    return res.status(500).json({
      ok: false,
      error: "No se pudo ejecutar la auditoría",
      details: String(err?.message || err),
    });
  }
});

module.exports = router;
