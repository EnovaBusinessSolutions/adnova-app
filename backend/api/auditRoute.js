const express = require('express');
const router = express.Router();
const { generarAuditoriaIA } = require('../jobs/auditJob');

// 1. Dispara auditoría directamente (sin queue)
router.post('/start', async (req, res) => {
  const { shop, accessToken } = req.body;
  if (!shop || !accessToken)
    return res.status(400).json({ error: 'shop y token requeridos' });

  try {
    // Llama directo a la función de IA
    const resultado = await generarAuditoriaIA(shop, accessToken);
    res.json({ ok: true, resultado });
  } catch (err) {
    console.error('Error en auditoría:', err);
    res.status(500).json({ error: 'Fallo la auditoría' });
  }
});

module.exports = router;
