// backend/routes/audits.js
'use strict';

const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User  = require('../models/User');

// Jobs (si quieres “disparar” auditorías desde aquí)
let generateShopifyAudit, generateMetaAudit, generateGoogleAudit;
try { generateShopifyAudit = require('../jobs/auditJob'); } catch {}
try { generateMetaAudit    = require('../jobs/metaAuditJob'); } catch {}
try { generateGoogleAudit  = require('../jobs/googleAuditJob'); } catch {}

/* Helpers */
function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok:false, error:'UNAUTHORIZED' });
}

function asSafeAction(a) {
  if (!a) return [];
  // normaliza un Action Center Item
  return (Array.isArray(a) ? a : []).map(x => ({
    title:        x.title || x.titulo || 'Recomendación',
    description:  x.description || x.descripcion || '',
    severity:     x.severity || x.prioridad || 'medium',
    button:       x.button || x.cta || undefined,
    estimated:    x.estimated || x.tiempo || undefined,
  }));
}

function byTypeOrNull(doc, type) {
  return doc && (doc.type === type ? doc : null);
}

async function getLatestByType(userId, type) {
  return Audit.findOne({ userId, type }).sort({ generatedAt: -1 }).lean();
}

/* ============================================================
   POST /api/audits/run
   (opcional) Dispara los jobs de auditoría que tengas disponibles
   ============================================================ */
router.post('/run', ensureAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Dispara en paralelo lo que exista instalado
    const tasks = [];
    if (generateShopifyAudit) tasks.push(generateShopifyAudit(null, null, userId).catch(()=>null));
    if (generateMetaAudit)    tasks.push(generateMetaAudit(null, null, userId).catch(()=>null));
    if (generateGoogleAudit)  tasks.push(generateGoogleAudit(null, null, userId).catch(()=>null));

    // Si no hay jobs instalados, simplemente responde OK
    if (!tasks.length) {
      return res.json({ ok: true, message: 'No audit jobs found (noop)' });
    }

    await Promise.allSettled(tasks);
    return res.json({ ok: true });
  } catch (err) {
    console.error('audits/run error:', err);
    return res.status(500).json({ ok:false, error:'RUN_ERROR' });
  }
});

/* ============================================================
   GET /api/audits/latest
   -> Devuelve { shopify, meta, google } (o null si no hay)
   NO requiere query params.
   ============================================================ */
router.get('/latest', ensureAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const [gDoc, mDoc, sDoc] = await Promise.all([
      getLatestByType(userId, 'google'),
      getLatestByType(userId, 'meta'),
      getLatestByType(userId, 'shopify'),
    ]);

    return res.json({
      ok: true,
      data: {
        google:  gDoc || null,
        meta:    mDoc || null,
        shopify: sDoc || null,
      }
    });
  } catch (err) {
    console.error('audits/latest error:', err);
    return res.status(500).json({ ok:false, error:'LATEST_ERROR' });
  }
});

/* ============================================================
   GET /api/audits/action-center
   -> Fusiona Action Center de las últimas auditorías (si hay)
   Formato: { items: ActionCenterItem[] }
   ============================================================ */
router.get('/action-center', ensureAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const [gDoc, mDoc, sDoc] = await Promise.all([
      getLatestByType(userId, 'google'),
      getLatestByType(userId, 'meta'),
      getLatestByType(userId, 'shopify'),
    ]);

    const items = [
      ...asSafeAction(gDoc?.actionCenter),
      ...asSafeAction(mDoc?.actionCenter),
      ...asSafeAction(sDoc?.actionCenter),
    ];

    return res.json({ ok: true, items });
  } catch (err) {
    console.error('audits/action-center error:', err);
    return res.status(500).json({ ok:false, error:'ACTION_CENTER_ERROR' });
  }
});

/* ============================================================
   GET /api/audits/by-type?type=google|meta|shopify
   -> Útil si alguna pantalla quiere pedir solo uno
   ============================================================ */
router.get('/by-type', ensureAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const type   = String(req.query.type || '').toLowerCase();

    if (!['google','meta','shopify'].includes(type)) {
      // En lugar de 400, responde vacío para no romper el front
      return res.json({ ok:true, data:null });
    }

    const doc = await getLatestByType(userId, type);
    return res.json({ ok:true, data: doc || null });
  } catch (err) {
    console.error('audits/by-type error:', err);
    return res.status(500).json({ ok:false, error:'BY_TYPE_ERROR' });
  }
});

module.exports = router;
