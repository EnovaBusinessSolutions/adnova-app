// backend/api/dashboardRoute.js
const express = require('express');
const router = express.Router();
const { generarAuditoriaIA } = require('../jobs/auditJob');
const Audit = require('../models/Audit');

// Resolver contexto desde sesión o query/body/headers
function resolveContext(req) {
  const tokenFromHeader = req.headers['x-shopify-access-token'];

  if (req.isAuthenticated && req.isAuthenticated()) {
    return {
      mode: 'session',
      userId: req.user?._id,
      shop: req.user?.shop,
      accessToken: req.body?.accessToken || tokenFromHeader || null,
    };
  }

  return {
    mode: 'api',
    userId: req.body?.userId || req.query?.userId || null,
    shop: req.body?.shop || req.query?.shop || null,
    accessToken:
      req.body?.accessToken ||
      req.query?.accessToken ||
      tokenFromHeader ||
      null,
  };
}

async function handler(req, res) {
  try {
    const { mode, shop, accessToken, userId } = resolveContext(req);

    if (!shop) return res.status(400).json({ error: 'shop ausente' });
    if (mode === 'api' && !accessToken) {
      return res.status(400).json({ error: 'accessToken requerido en modo API' });
    }

    // Ejecuta la auditoría (si hay token lo usa; en sesión puede ir undefined)
    const resultado = await generarAuditoriaIA(shop, accessToken || undefined);

    // Si hay userId guardamos la auditoría (útil cuando es desde el dashboard)
    if (userId) {
      await Audit.create({
        userId,
        shopDomain: shop,
        productsAnalizados: resultado.productsAnalizados,
        actionCenter: resultado.actionCenter,
        issues: resultado.issues,
        createdAt: new Date(),
      });
    }

    res.json({ ok: true, mode, resultado });
  } catch (err) {
    console.error('Error auditando tienda:', err);
    res.status(500).json({ error: 'Error auditando tienda' });
  }
}

// Mantén compatibilidad: admite GET y POST
router.get('/audit', handler);
router.post('/audit', handler);

module.exports = router;
