// backend/api/auditRoute.js

const express = require('express');
const router = express.Router();
const { generarAuditoriaIA, procesarAuditoria } = require('../jobs/auditJob');
const Audit = require('../models/Audit');

// 1. Dispara auditoría directamente (sin queue)
router.post('/start', async (req, res) => {
  const { shop, accessToken, userId } = req.body;
  if (!shop || !accessToken)
    return res.status(400).json({ error: 'shop y token requeridos' });

  try {
    // Llama directo a la función de IA
    const resultado = await generarAuditoriaIA(shop, accessToken);

    // Si hay userId, guarda la auditoría en Mongo
    if (userId) {
      await Audit.create({
        userId,
        shopDomain: shop,
        productsAnalizados: resultado.productsAnalizados,
        actionCenter: resultado.actionCenter,
        issues: resultado.issues,
        createdAt: new Date()
        // Puedes agregar otros campos como métricas si tienes
      });
    }

    res.json({ ok: true, resultado });
  } catch (err) {
    console.error('Error en auditoría:', err);
    res.status(500).json({ error: 'Fallo la auditoría' });
  }
});

// 2. Obtener la auditoría más reciente de un usuario/shop
router.get('/latest', async (req, res) => {
  const userId = req.query.userId;
  const shop = req.query.shop;

  if (!userId || !shop)
    return res.status(400).json({ error: 'userId y shop requeridos' });

  try {
    const audit = await Audit.findOne({ userId, shopDomain: shop })
      .sort({ createdAt: -1 });

    if (!audit) return res.status(404).json({ error: 'No se encontró auditoría' });

    res.json({ ok: true, audit });
  } catch (err) {
    res.status(500).json({ error: 'Error al recuperar auditoría' });
  }
});

// --- Aquí puedes agregar más endpoints como "listar todas las auditorías" si lo necesitas

module.exports = router;
