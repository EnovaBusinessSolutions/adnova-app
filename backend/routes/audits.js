// backend/routes/audits.js
const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User = require('../models/User');

// IA (opcional): genera un resumen / actionCenter a partir de datos básicos
let generateAudit;
try {
  generateAudit = require('../jobs/llm/generateAudit'); // si no existe, seguimos sin IA
} catch { generateAudit = null; }

// --- helpers ---
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
}

function safeStr(v, fallback = '') {
  return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
}

function buildEmptyAudit({ userId, type, reason }) {
  return {
    userId,
    type,                                           // "google" | "meta" | "shopify"
    generatedAt: new Date(),
    resumen: reason ? `Omitido: ${reason}` : 'Sin datos.',
    productsAnalizados: 0,
    actionCenter: [],
    issues: {},
  };
}

// --- POST /api/audits/run ---
// Lanza todas las auditorías posibles con base en lo conectado.
// body puede incluir: { googleConnected?, metaConnected?, shopifyConnected? }
router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;
  let user = await User.findById(userId).lean();

  // flags reales por si el front no los mandó
  const flags = {
    google:  !!(req.body?.googleConnected ?? user?.googleConnected),
    meta:    !!(req.body?.metaConnected ?? user?.metaConnected),
    shopify: !!(req.body?.shopifyConnected ?? user?.shopifyConnected),
  };

  const results = [];
  const types = /** orden fijo para UI */ ['google', 'meta', 'shopify'];

  try {
    for (const type of types) {
      if (!flags[type]) {
        // no conectado → no romper; solo marcar omitido
        results.push({ type, ok: false, error: 'NOT_CONNECTED' });
        continue;
      }

      // base audit (sin datos reales aún)
      let auditDoc = buildEmptyAudit({ userId, type });

      // si tienes colectores de datos, colócalos aquí (try/catch individual por tipo)
      // por ejemplo:
      // if (type === 'google') { const raw = await collectGoogle(userId); ... }

      // IA opcional (si hay clave y módulo)
      if (generateAudit) {
        try {
          const enriched = await generateAudit({
            type,
            // pasa aquí datos agregados/estadísticos si los tuvieras
            kpis: {}, products: [],
            user: { id: String(userId), email: user?.email },
          });
          // merge seguro
          if (enriched && typeof enriched === 'object') {
            auditDoc = {
              ...auditDoc,
              resumen: safeStr(enriched.resumen, auditDoc.resumen),
              actionCenter: Array.isArray(enriched.actionCenter) ? enriched.actionCenter : auditDoc.actionCenter,
              issues: (enriched.issues && typeof enriched.issues === 'object') ? enriched.issues : auditDoc.issues,
              salesLast30: enriched.salesLast30,
              ordersLast30: enriched.ordersLast30,
              avgOrderValue: enriched.avgOrderValue,
              topProducts: Array.isArray(enriched.topProducts) ? enriched.topProducts : auditDoc.topProducts,
              customerStats: enriched.customerStats || auditDoc.customerStats,
            };
          }
        } catch (e) {
          // IA falló → seguimos con audit básico
          results.push({ type, ok: false, error: 'LLM_FAILED', detail: e?.message });
        }
      }

      // guarda cada audit
      const saved = await Audit.create(auditDoc);
      results.push({ type, ok: true, auditId: saved._id });
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({
      ok: false,
      error: 'RUN_ERROR',
      detail: e?.message || 'Unexpected error',
    });
  }
});

// --- GET /api/audits/latest ---
// Devuelve el último documento por tipo para el usuario logueado.
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // obtenemos el más reciente por tipo (google, meta, shopify)
    const [google, meta, shopify] = await Promise.all(
      ['google', 'meta', 'shopify'].map((t) =>
        Audit.findOne({ userId, type: t }).sort({ generatedAt: -1 }).lean()
      )
    );

    return res.json({
      ok: true,
      data: { google: google || null, meta: meta || null, shopify: shopify || null },
    });
  } catch (e) {
    console.error('LATEST_ERROR:', e);
    return res.status(400).json({ ok: false, error: 'INVALID_TYPE', detail: e?.message });
  }
});

// --- GET /api/audits/action-center ---
// Une recomendaciones de los últimos audits y las ordena por severidad/recencia.
router.get('/action-center', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const audits = await Audit.find({ userId }).sort({ generatedAt: -1 }).limit(6).lean();

    const items = [];
    for (const a of audits) {
      const ac = Array.isArray(a.actionCenter) ? a.actionCenter : [];
      for (const it of ac) {
        items.push({
          title: it.title || '(Sin título)',
          description: it.description || '',
          severity: it.severity || 'medium',
          source: a.type,
          at: a.generatedAt,
          button: it.button || null,
          estimated: it.estimated || null,
        });
      }
    }

    // orden: high > medium > low, luego más reciente primero
    const sevRank = { high: 3, medium: 2, low: 1 };
    items.sort((a, b) => {
      const s = (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
      if (s !== 0) return s;
      return new Date(b.at) - new Date(a.at);
    });

    return res.json({ ok: true, items });
  } catch (e) {
    console.error('ACTION_CENTER_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'ACTION_CENTER_ERROR', detail: e?.message });
  }
});

module.exports = router;
