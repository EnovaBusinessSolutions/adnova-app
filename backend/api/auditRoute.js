// backend/api/auditRoutes.js
const express = require('express');
const router = express.Router();
const { procesarAuditoria } = require('../jobs/auditJob');

// Llama y guarda la auditoría (flujo recomendado)
router.post('/start', async (req, res) => {
  const { shop, accessToken, userId } = req.body;
  if (!shop || !accessToken || !userId) {
    return res.status(400).json({ error: 'shop, token y userId requeridos' });
  }

  try {
    // Genera la auditoría, la guarda en Mongo y devuelve resultado simple
    const resultado = await procesarAuditoria(userId, shop, accessToken);
    res.json({ ok: true, resultado });
  } catch (err) {
    console.error('Error en auditoría:', err);
    res.status(500).json({ error: 'Falló la auditoría' });
  }
});

module.exports = router;
