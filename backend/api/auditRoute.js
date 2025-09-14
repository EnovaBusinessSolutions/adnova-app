// backend/api/auditRoute.js
const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User  = require('../models/User');

const { generarAuditoriaIA }       = require('../jobs/auditJob');          // Shopify
const { generarAuditoriaMetaIA }   = require('../jobs/metaAuditJob');      // Meta
const { generarAuditoriaGoogleIA } = require('../jobs/googleAuditJob');    // Google

// ------------------------ Helpers ------------------------
function resolveContext(req) {
  const tokenFromHeader = req.headers['x-shopify-access-token'];

  if (req.isAuthenticated && req.isAuthenticated()) {
    return {
      mode: 'session',
      userId: req.user?._id,
      shop: req.user?.shop || null,
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

function isAuthed(req) {
  return !!(req.isAuthenticated && req.isAuthenticated());
}

// ------------------------ Shopify Audit ------------------------
router.post('/start', async (req, res) => {
  try {
    const { mode, shop, userId, accessToken } = resolveContext(req);

    if (!shop) return res.status(400).json({ error: 'shop ausente' });
    if (mode === 'api' && !accessToken) {
      return res.status(400).json({ error: 'accessToken requerido en modo API' });
    }

    const resultado = await generarAuditoriaIA(shop, accessToken || undefined);

    if (userId) {
      await Audit.create({
        type: 'shopify',
        userId,
        shopDomain: shop,
        productsAnalizados: resultado.productsAnalizados,
        actionCenter: resultado.actionCenter,
        issues: resultado.issues,
        resumen: resultado.resumen,
        createdAt: new Date(),
      });
    }

    res.json({ ok: true, mode, resultado });
  } catch (err) {
    console.error('Error en auditoría Shopify:', err);
    res.status(500).json({ error: 'Falló la auditoría' });
  }
});

// ------------------------ Meta Audit ------------------------
router.post('/meta/start', async (req, res) => {
  try {
    if (!isAuthed(req)) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    const userId = req.user._id;
    const shop   = req.user?.shop || null;

    const { accountId, datePreset } = req.body || {};
    const resultado = await generarAuditoriaMetaIA(userId, { accountId, datePreset });

    await Audit.create({
      type: 'meta',
      userId,
      shopDomain: shop, // mantenemos compatibilidad con /api/audits/usage si decides contar por shop
      productsAnalizados: resultado.productsAnalizados,
      actionCenter: resultado.actionCenter,
      issues: resultado.issues,
      resumen: resultado.resumen,
      createdAt: new Date(),
    });

    res.json({ ok: true, mode: 'session', resultado });
  } catch (err) {
    console.error('Error en auditoría Meta:', err);
    res.status(500).json({ error: 'Falló la auditoría Meta' });
  }
});

// ------------------------ Google Ads Audit ------------------------
router.post('/google/start', async (req, res) => {
  try {
    if (!isAuthed(req)) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    const userId = req.user._id;
    const shop   = req.user?.shop || null;

    const { client_customer_id, date_range } = req.body || {};
    const user = await User.findById(userId).lean();

    const resultado = await generarAuditoriaGoogleIA(user, {
      customerId: (client_customer_id || '').replace(/-/g, ''),
      dateRange: date_range || 'LAST_30_DAYS',
    });

    await Audit.create({
      type: 'google',
      userId,
      shopDomain: shop,
      productsAnalizados: resultado.productsAnalizados,
      actionCenter: resultado.actionCenter,
      issues: resultado.issues,
      resumen: resultado.resumen,
      createdAt: new Date(),
    });

    res.json({ ok: true, mode: 'session', resultado });
  } catch (err) {
    console.error('Error en auditoría Google:', err);
    res.status(500).json({ error: 'Falló la auditoría Google' });
  }
});

// ------------------------ Latest Audit (por tipo) ------------------------
router.get('/latest', async (req, res) => {
  try {
    const ctx    = resolveContext(req);
    let   userId = ctx.userId || req.query?.userId || null;

    // Si hay sesión, prioriza el userId de sesión (más seguro)
    if (isAuthed(req)) userId = req.user._id;

    const type = (req.query?.type || 'shopify').toLowerCase();
    if (!userId) {
      return res.status(400).json({ error: 'userId requerido (o sesión activa)' });
    }

    const filter = { userId, type };
    if (type === 'shopify') {
      const shop = ctx.shop || req.query?.shop || (isAuthed(req) ? req.user?.shop : null);
      if (!shop) return res.status(400).json({ error: 'shop requerido para type=shopify' });
      filter.shopDomain = shop;
    }

    const audit = await Audit.findOne(filter).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, audit: audit || null });
  } catch (err) {
    console.error('latest audit error:', err);
    res.status(500).json({ error: 'Error al recuperar auditoría' });
  }
});

module.exports = router;
