// backend/routes/pixelAuditor.js
"use strict";

const express = require("express");
const router = express.Router();

// OJO: ajusta el path según tu build (dist) o ts-node.
// Si estás compilando TS a /dist-pixel-auditor, normalmente importarías desde ahí.
let runPixelAudit;

try {
  // ✅ Si ya estás compilando a JS dentro del backend (recomendado)
  // Ajusta la ruta a donde te salga el engine compilado
  ({ runPixelAudit } = require("../dist-pixel-auditor/engine"));
} catch (e) {
  // ✅ Fallback por si lo estás ejecutando en TS (solo dev)
  ({ runPixelAudit } = require("../pixel-auditor/engine"));
}

router.post("/auditor", async (req, res) => {
  try {
    const { url, includeDetails } = req.body || {};

    if (!url || typeof url !== "string") {
      return res.status(400).json({ ok: false, error: "URL requerida" });
    }

    const result = await runPixelAudit(url, !!includeDetails);

    return res.json({ ok: true, data: result });
  } catch (err) {
    console.error("[PIXEL_AUDITOR_ERROR]", err);
    return res.status(500).json({
      ok: false,
      error: "No se pudo ejecutar la auditoría",
    });
  }
});

module.exports = router;
