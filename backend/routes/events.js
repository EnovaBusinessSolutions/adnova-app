"use strict";

const express = require("express");
const router = express.Router();

// ✅ Usamos el helper NUEVO que escribe en AnalyticsEvent.
// Si aún no existe, créalo tal como te lo pasé (backend/services/analytics.js).
let trackEvent = null;
try {
  const { trackEvent } = require("../services/trackEvent");
} catch (e) {
  // fallback suave: no romper app si falta el servicio
  trackEvent = async () => null;
}

// Helpers
function safeStr(v, max = 120) {
  if (v === undefined || v === null) return "";
  return String(v).slice(0, max);
}

function safeName(v) {
  const s = safeStr(v, 80).trim();
  // allowlist básico de caracteres para evitar basura
  return s.replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function safeObj(v) {
  if (!v || typeof v !== "object") return {};
  // evita payloads gigantes
  try {
    const json = JSON.stringify(v);
    if (json.length > 30_000) return { _truncated: true };
    return v;
  } catch {
    return {};
  }
}

/**
 * POST /api/events/track
 * Body: { name, props?, dedupeKey? }
 *
 * ✅ Permite:
 * - con sesión: userId se toma de req.user
 * - sin sesión: userId=null pero guarda sessionId para análisis
 *
 * Nota: Esto NO debe bloquear UX nunca.
 */
router.post("/events/track", async (req, res) => {
  try {
    const body = req.body || {};

    const name = safeName(body.name);
    if (!name) return res.status(400).json({ ok: false, error: "NAME_REQUIRED" });

    const props = safeObj(body.props);
    const dedupeKey = body.dedupeKey ? safeStr(body.dedupeKey, 200) : undefined;

    const userId = req.user?._id || null;
    const sessionId = req.sessionID || null;

    // Opcional: captura “source” si lo mandas (landing/app/server)
    const source = body.source ? safeStr(body.source, 40) : "app";

    await trackEvent({
      name,
      userId,
      sessionId,
      source,
      props,
      dedupeKey,
    });

    return res.json({ ok: true });
  } catch {
    // No rompas la UX por analítica
    return res.json({ ok: true });
  }
});

/**
 * GET /api/events/ping
 * Útil para verificar rápido que está montado.
 */
router.get("/events/ping", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

module.exports = router;
