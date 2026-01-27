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
      const mod = require(p);
      if (typeof mod?.runPixelAudit === "function") return mod.runPixelAudit;
    }
  }

  throw new Error(`PIXEL_ENGINE_NOT_FOUND. Busqué: ${candidates.join(" | ")}`);
}

/* =========================
 * Normalización (clave para UI simple)
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
    // casos típicos: { ids: [...] } o { id: "..." }
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

  const tracking = [
    {
      key: "ga4",
      label: "Google Analytics 4",
      installed: ga4Ids.length > 0,
      ids: ga4Ids,
    },
    {
      key: "gtm",
      label: "Google Tag Manager",
      installed: gtmIds.length > 0,
      ids: gtmIds,
    },
    {
      key: "gads",
      label: "Google Ads",
      installed: gadsIds.length > 0,
      ids: gadsIds,
    },
    {
      key: "meta",
      label: "Meta Pixel",
      installed: metaIds.length > 0,
      ids: metaIds,
    },
  ];

  return tracking;
}

function computeHealth(tracking) {
  // ✅ Para parecerse al tool “simple”:
  // - GA4 es lo más importante
  // - Meta Pixel también es core para ecommerce/leads
  // - GTM/GAds se recomiendan, pero NO penalizan fuerte
  const hasGA4 = tracking.find((x) => x.key === "ga4")?.installed;
  const hasMeta = tracking.find((x) => x.key === "meta")?.installed;

  let score = 100;

  // Penalizaciones principales
  if (!hasGA4) score -= 25; // si falta GA4: típicamente baja a 75
  if (!hasMeta) score -= 25;

  // Clamp
  score = Math.max(0, Math.min(100, score));

  const healthLabel = score >= 80 ? "Bueno" : score >= 60 ? "Regular" : "Crítico";
  return { healthScore: score, healthLabel };
}

function buildRecommendations(tracking) {
  const map = Object.fromEntries(tracking.map((t) => [t.key, t]));

  const recs = [];

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

  return recs;
}

function normalizePixelAuditResult(rawResult, auditedUrl, includeDetails) {
  const tracking = normalizeTracking(rawResult);
  const { healthScore, healthLabel } = computeHealth(tracking);

  const issuesCount =
    (Array.isArray(rawResult?.issues) && rawResult.issues.length) ||
    rawResult?.summary?.issuesCount ||
    rawResult?.issuesCount ||
    0;

  const eventsCount =
    rawResult?.eventsCount ||
    rawResult?.summary?.eventsCount ||
    (Array.isArray(rawResult?.events) ? rawResult.events.length : 0) ||
    0;

  const recommendations = buildRecommendations(tracking);

  const normalized = {
    auditedUrl: rawResult?.url || rawResult?.auditedUrl || auditedUrl,
    healthScore,
    healthLabel,
    tracking, // <- lo que vas a pintar como cards (GA4/GTM/GAds/Meta)
    recommendations,
    issuesCount,
    eventsCount,
  };

  if (includeDetails) normalized.raw = rawResult; // opcional para debug / “modo detallado”
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

    // ✅ Siempre responde con shape estable
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
