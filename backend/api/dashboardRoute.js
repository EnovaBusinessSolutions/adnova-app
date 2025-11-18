// backend/api/dashboardRoute.js
'use strict';

const express = require('express');
const router = express.Router();

const { generarAuditoriaIA } = require('../jobs/auditJob');
const Audit = require('../models/Audit');

/**
 * Resuelve el contexto de la petición:
 *  - modo "session": usuario logueado en el SAAS (req.user)
 *  - modo "api": llamada externa con shop + accessToken
 */
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

    if (!shop) {
      return res.status(400).json({ ok: false, error: 'SHOP_MISSING' });
    }

    // En modo API exigimos accessToken explícito
    if (mode === 'api' && !accessToken) {
      return res
        .status(400)
        .json({ ok: false, error: 'ACCESS_TOKEN_REQUIRED_API' });
    }

    // 1) Ejecuta auditoría IA de Shopify
    const resultado = await generarAuditoriaIA(shop, accessToken || undefined);
    // Esperamos algo tipo:
    // {
    //   resumen, summary,
    //   productsAnalizados: [...],
    //   issues: [...],
    //   actionCenter: [...],
    //   snapshot: {...}
    // }

    // 2) Si tenemos userId, persistimos en colección Audit usando el formato estándar
    if (userId) {
      const now = new Date();

      const summary =
        (resultado && (resultado.summary || resultado.resumen)) ||
        'Auditoría generada para la tienda Shopify.';

      const issues = Array.isArray(resultado?.issues)
        ? resultado.issues
        : [];

      const actionCenter = Array.isArray(resultado?.actionCenter)
        ? resultado.actionCenter
        : [];

      // topProducts: usamos productsAnalizados si viene, si no, array vacío
      const topProducts = Array.isArray(resultado?.productsAnalizados)
        ? resultado.productsAnalizados
        : [];

      // snapshot: si generarAuditoriaIA devuelve algo tipo snapshot/rawData
      const inputSnapshot =
        (resultado && (resultado.snapshot || resultado.raw || resultado.data)) ||
        { shopDomain: shop };

      await Audit.create({
        userId,
        type: 'shopify',
        generatedAt: now,

        resumen: summary,
        summary,
        issues,
        actionCenter,
        topProducts,
        inputSnapshot,

        // extra útil para debugging / filtros
        shopDomain: shop,
        version: 'audits@1.1.3-shopify',
      });
    }

    return res.json({
      ok: true,
      mode,
      shop,
      hasUser: !!userId,
      resultado,
    });
  } catch (err) {
    console.error('Error auditando tienda Shopify en /api/dashboard/audit:', err);
    return res.status(500).json({ ok: false, error: 'SHOPIFY_AUDIT_ERROR' });
  }
}

// GET y POST por compatibilidad
router.get('/audit', handler);
router.post('/audit', handler);

module.exports = router;
