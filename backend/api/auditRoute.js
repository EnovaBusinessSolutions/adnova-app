// backend/api/auditRoute.js
const express = require('express');
const router = express.Router();
const { generarAuditoriaIA, procesarAuditoria } = require('../jobs/auditJob');

// Ruta para iniciar la auditoría
router.post('/start', async (req, res) => {
  const { shop, accessToken, userId } = req.body;
  if (!shop || !accessToken)
    return res.status(400).json({ error: 'shop y token requeridos' });

  try {
    if (userId) {
      // OPCIÓN IDEAL: Guarda auditoría en Mongo y responde "saved"
      await procesarAuditoria(userId, shop, accessToken);
      res.json({ ok: true, saved: true });
    } else {
      // Solo genera auditoría y la responde (no guarda en Mongo)
      const resultado = await generarAuditoriaIA(shop, accessToken);
      res.json({ ok: true, resultado });
    }
  } catch (err) {
    console.error('Error en auditoría:', err);
    res.status(500).json({ error: 'Fallo la auditoría' });
  }
});

module.exports = router;
