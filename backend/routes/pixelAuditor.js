// backend/routes/pixelAuditor.js
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

const router = express.Router();

function loadRunPixelAudit() {
  // ✅ Rutas reales (ya confirmadas en Render Shell)
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

  // Debug ultra claro en logs
  throw new Error(
    `PIXEL_ENGINE_NOT_FOUND. Busqué: ${candidates.join(" | ")}`
  );
}

router.post("/auditor", async (req, res) => {
  try {
    const { url, includeDetails } = req.body || {};

    if (!url || typeof url !== "string") {
      return res.status(400).json({ ok: false, error: "URL requerida" });
    }

    const runPixelAudit = loadRunPixelAudit();
    const result = await runPixelAudit(url, !!includeDetails);

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
