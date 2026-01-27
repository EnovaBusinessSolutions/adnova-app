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

  // Buffer (típico cuando hay express.raw para application/json)
  if (Buffer.isBuffer(b)) {
    try {
      return JSON.parse(b.toString("utf8") || "{}");
    } catch {
      return {};
    }
  }

  // string
  if (typeof b === "string") {
    try {
      return JSON.parse(b || "{}");
    } catch {
      return {};
    }
  }

  // objeto normal
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
      // require por path absoluto también funciona, pero Node cachea:
      // si redeploy, siempre será nuevo contenedor, OK.
      const mod = require(p);
      if (typeof mod?.runPixelAudit === "function") return mod.runPixelAudit;
    }
  }

  throw new Error(`PIXEL_ENGINE_NOT_FOUND. Busqué: ${candidates.join(" | ")}`);
}

router.post("/auditor", async (req, res) => {
  try {
    const body = readBody(req);

    // Acepta url por body o por query (por si pruebas rápido)
    const url =
      (typeof body.url === "string" && body.url.trim()) ||
      (typeof req.query.url === "string" && req.query.url.trim()) ||
      "";

    const includeDetails = !!(body.includeDetails ?? body.include_details);

    if (!url) {
      return res.status(400).json({ ok: false, error: "URL requerida" });
    }

    const runPixelAudit = loadRunPixelAudit();
    const result = await runPixelAudit(url, includeDetails);

    return res.json({ ok: true, data: result });
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
