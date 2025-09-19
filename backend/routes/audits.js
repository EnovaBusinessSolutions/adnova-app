// backend/routes/audits.js
'use strict';

const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const MetaAccount = require('../models/MetaAccount');
const GoogleAccount = require('../models/GoogleAccount');
const ShopConnections = require('../models/ShopConnections');

const { generarAuditoriaIA } = require('../jobs/auditJob');             // Shopify
const { generarAuditoriaMetaIA } = require('../jobs/metaAuditJob');     // Meta
const { generarAuditoriaGoogleIA } = require('../jobs/googleAuditJob'); // Google

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

/** Guarda una auditoría con forma estándar. */
async function saveAudit({ userId, type, payload }) {
  const doc = new Audit({
    userId,
    type, // <- campo extra, el Schema tiene strict:false, OK
    generatedAt: new Date(),
    actionCenter: payload.actionCenter || [],
    issues: payload.issues || { productos: [], ux: [], seo: [], performance: [], media: [] },
    salesLast30: payload.salesLast30,
    ordersLast30: payload.ordersLast30,
    avgOrderValue: payload.avgOrderValue,
    topProducts: payload.topProducts || [],
    customerStats: payload.customerStats || {},
    resumen: payload.resumen || '',
    productsAnalizados: payload.productsAnalizados || 0,
  });
  await doc.save();
  return doc;
}

/**
 * POST /api/audits/run
 * Lanza auditorías para TODAS las conexiones disponibles del usuario actual (Shopify/Meta/Google).
 * Devuelve el resumen y cuántas se guardaron.
 */
router.post('/run', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // detectar conexiones
    const [shopConn, metaAcc, googleAcc] = await Promise.all([
      ShopConnections.findOne({ matchedToUserId: userId }).lean(),
      MetaAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean(),
      GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean(),
    ]);

    const tasks = [];

    if (shopConn) {
      tasks.push(
        (async () => {
          const payload = await generarAuditoriaIA(shopConn.shop, shopConn.accessToken);
          const saved = await saveAudit({ userId, type: 'shopify', payload });
          return { type: 'shopify', ok: true, id: saved._id, resumen: payload.resumen };
        })().catch(err => ({ type: 'shopify', ok: false, error: err?.message || 'shopify_audit_failed' }))
      );
    }

    if (metaAcc) {
      tasks.push(
        (async () => {
          const payload = await generarAuditoriaMetaIA(userId, {});
          const saved = await saveAudit({ userId, type: 'meta', payload });
          return { type: 'meta', ok: true, id: saved._id, resumen: payload.resumen };
        })().catch(err => ({ type: 'meta', ok: false, error: err?.message || 'meta_audit_failed' }))
      );
    }

    if (googleAcc) {
      tasks.push(
        (async () => {
          const payload = await generarAuditoriaGoogleIA(userId, {});
          const saved = await saveAudit({ userId, type: 'google', payload });
          return { type: 'google', ok: true, id: saved._id, resumen: payload.resumen };
        })().catch(err => ({ type: 'google', ok: false, error: err?.message || 'google_audit_failed' }))
      );
    }

    if (tasks.length === 0) {
      return res.json({ ok: true, saved: 0, results: [], detail: 'NO_CONNECTIONS' });
    }

    const results = await Promise.all(tasks);
    const savedCount = results.filter(r => r.ok).length;

    res.json({ ok: true, saved: savedCount, results });
  } catch (err) {
    console.error('audits/run error:', err);
    res.status(500).json({ ok: false, error: 'AUDIT_RUN_ERROR', detail: err?.message || String(err) });
  }
});

/**
 * GET /api/audits/latest
 * Devuelve la última auditoría POR TIPO (shopify/meta/google) para el usuario.
 */
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const [shopify, meta, google] = await Promise.all([
      Audit.findOne({ userId, type: 'shopify' }).sort({ generatedAt: -1 }).lean(),
      Audit.findOne({ userId, type: 'meta' }).sort({ generatedAt: -1 }).lean(),
      Audit.findOne({ userId, type: 'google' }).sort({ generatedAt: -1 }).lean(),
    ]);

    res.json({
      ok: true,
      data: { shopify, meta, google },
    });
  } catch (err) {
    console.error('audits/latest error:', err);
    res.status(500).json({ ok: false, error: 'AUDIT_LATEST_ERROR', detail: err?.message || String(err) });
  }
});

/**
 * GET /api/audits/action-center
 * Aplana recomendaciones de las últimas auditorías (por tipo) para mostrar en el widget.
 */
router.get('/action-center', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Toma las últimas 3 por tipo y aplana
    const docs = await Audit.find({ userId })
      .sort({ generatedAt: -1 })
      .limit(9)
      .lean();

    const items = [];
    for (const d of docs) {
      for (const a of (d.actionCenter || [])) {
        items.push({
          type: d.type || 'unknown',
          title: a.title,
          description: a.description,
          severity: a.severity || 'medium',
          button: a.button || 'Revisar',
          generatedAt: d.generatedAt,
          auditId: d._id,
        });
      }
    }

    res.json({ ok: true, items });
  } catch (err) {
    console.error('audits/action-center error:', err);
    res.status(500).json({ ok: false, error: 'AUDIT_ACTION_CENTER_ERROR', detail: err?.message || String(err) });
  }
});

module.exports = router;
