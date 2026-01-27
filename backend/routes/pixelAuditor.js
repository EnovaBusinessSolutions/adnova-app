// backend/routes/pixelAuditor.js
"use strict";

const express = require("express");
const router = express.Router();

function normalizeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

let runPixelAudit;

function loadEngine() {
  // ✅ Producción (Render): compilado por tsc
  try {
    const mod = require("../pixel-auditor-dist/engine");
    if (mod?.runPixelAudit) return mod.runPixelAudit;
  } catch (_) {}

  // ✅ Fallback (solo si estás corriendo TS en dev)
  try {
    const mod = require("../pixel-auditor/engine");
    if (mod?.runPixelAudit) return mod.runPixelAudit;
  } catch (_) {}

  return null;
}

runPixelAudit = loadEngine();

router.post("/auditor", async (req, res) => {
  try {
    if (!runPixelAudit) {
      return res.status(500).json({
        ok: false,
        error: "PIXEL_AUDITOR_ENGINE_NOT_FOUND",
        message:
          "No se encontró el engine del Pixel Auditor. Asegura que el build generó backend/pixel-auditor-dist/engine.js y que Render corre el comando de build.",
      });
    }

    const { url, includeDetails } = req.body || {};
    const safeUrl = normalizeUrl(url);

    if (!safeUrl) {
      return res.status(400).json({ ok: false, error: "URL_REQUIRED", message: "URL requerida" });
    }

    // validación básica (evita inputs basura)
    let u;
    try {
      u = new URL(safeUrl);
      if (!u.hostname) throw new Error("no-host");
    } catch {
      return res.status(400).json({
        ok: false,
        error: "URL_INVALID",
        message: "Pon una URL válida. Ej: https://tusitio.com",
      });
    }

    const result = await runPixelAudit(safeUrl, !!includeDetails);

    return res.json({ ok: true, data: result });
  } catch (err) {
    console.error("[PIXEL_AUDITOR_ERROR]", err);

    return res.status(500).json({
      ok: false,
      error: "PIXEL_AUDITOR_FAILED",
      message: "No se pudo ejecutar la auditoría",
    });
  }
});

module.exports = router;
