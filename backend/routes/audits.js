// backend/routes/audits.js
const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User = require('../models/User');

// IA opcional
let generateAudit;
try {
  generateAudit = require('../jobs/llm/generateAudit');
} catch { generateAudit = null; }

/* ------------------------ helpers ------------------------ */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
}

function safeStr(v, fallback = '') {
  return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
}

/**
 * Convierte cualquier forma de "issues" (buckets v1, array v2, null)
 * a un array que cumple con el schema:
 *   { id: string, title: string, area: string, severity: "high"|"medium"|"low", ...opcionales }
 */
function normalizeIssues(anyIssues, defaultArea = 'otros') {
  // si viene null/undefined → array vacío
  if (!anyIssues) return [];

  // v2 (array): rellena faltantes
  if (Array.isArray(anyIssues)) {
    return anyIssues.map((it, idx) => {
      const id = it?.id || `iss-${Date.now()}-${idx}`;
      const title = it?.title || 'Hallazgo';
      const area = (it?.area || defaultArea).toString();
      // mapea severidad flexible a high/medium/low
      const rawSev = (it?.severity || 'medium').toString().toLowerCase();
      const severity =
        rawSev === 'alta' || rawSev === 'high'   ? 'high'   :
        rawSev === 'baja' || rawSev === 'low'    ? 'low'    :
                                                     'medium';

      return {
        id,
        title,
        area,
        severity,
        // campos opcionales que quieras persistir
        description: it?.description || it?.evidence || '',
        recommendation: it?.recommendation,
        metrics: it?.metrics,
        estimatedImpact: it?.estimatedImpact,
        blockers: it?.blockers,
        links: it?.links,
      };
    });
  }

  // v1 (buckets objeto): aplanar
  // buckets esperados: ux, seo, performance, media, productos[…], etc.
  const out = [];

  const pushFromBucket = (arr, bucketArea) => {
    (arr || []).forEach((it, i) => {
      const id = `iss-${bucketArea}-${Date.now()}-${i}`;
      const title = it?.title || 'Hallazgo';
      const rawSev = (it?.severity || 'medium').toString().toLowerCase();
      const severity =
        rawSev === 'alta' || rawSev === 'high'   ? 'high'   :
        rawSev === 'baja' || rawSev === 'low'    ? 'low'    :
                                                     'medium';
      out.push({
        id,
        title,
        area: bucketArea,
        severity,
        description: it?.description || '',
        recommendation: it?.recommendation,
      });
    });
  };

  const b = anyIssues || {};
  pushFromBucket(b.ux, 'ux');
  pushFromBucket(b.seo, 'seo');
  pushFromBucket(b.performance, 'performance');
  pushFromBucket(b.media, 'media');

  // productos: [{ nombre, hallazgos: LegacyIssue[] }]
  (b.productos || []).forEach((p, pi) => {
    (p?.hallazgos || []).forEach((it, i) => {
      const id = `iss-prod-${Date.now()}-${pi}-${i}`;
      const rawSev = (it?.severity || 'medium').toString().toLowerCase();
      const severity =
        rawSev === 'alta' || rawSev === 'high'   ? 'high'   :
        rawSev === 'baja' || rawSev === 'low'    ? 'low'    :
                                                     'medium';
      out.push({
        id,
        title: it?.title || `Producto: ${p?.nombre || 'N/D'}`,
        area: 'performance',
        severity,
        description: it?.description || '',
        recommendation: it?.recommendation,
      });
    });
  });

  return out;
}

/**
 * Normaliza el actionCenter en formato simple (sin restricciones duras en el schema).
 */
function normalizeActionCenter(anyAC) {
  if (!Array.isArray(anyAC)) return [];
  return anyAC.map((it, i) => ({
    title: safeStr(it?.title, 'Acción recomendada'),
    description: safeStr(it?.description || it?.evidence, ''),
    severity: (it?.severity === 'high' || it?.severity === 'alta') ? 'high'
            : (it?.severity === 'low'  || it?.severity === 'baja') ? 'low'
            : 'medium',
    button: it?.button || null,
    estimated: it?.estimated || it?.estimatedImpact || null,
  }));
}

function buildEmptyAudit({ userId, type, reason }) {
  return {
    userId,
    type,                                           // "google" | "meta" | "shopify"
    generatedAt: new Date(),
    resumen: reason ? `Omitido: ${reason}` : 'Sin datos.',
    productsAnalizados: 0,
    actionCenter: [],
    issues: [],                                     // <- array (no objeto) para cumplir con el schema estrictamente
  };
}

/* ------------------------ POST /api/audits/run ------------------------ */
router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;
  const user = await User.findById(userId).lean();

  const flags = {
    google:  !!(req.body?.googleConnected  ?? user?.googleConnected),
    meta:    !!(req.body?.metaConnected    ?? user?.metaConnected),
    shopify: !!(req.body?.shopifyConnected ?? user?.shopifyConnected),
  };

  const results = [];
  const types = ['google', 'meta', 'shopify'];

  try {
    for (const type of types) {
      if (!flags[type]) {
        results.push({ type, ok: false, error: 'NOT_CONNECTED' });
        continue;
      }

      // base
      let auditDoc = buildEmptyAudit({ userId, type });

      // (si tuvieras colectores por tipo, colócalos aquí; no son obligatorios para que funcione)
      // let collected = null;
      // if (type === 'google') collected = await collectGoogle(userId);

      // IA opcional
      let enriched = null;
      if (generateAudit) {
        try {
          enriched = await generateAudit({
            type,
            kpis: {}, products: [],
            user: { id: String(userId), email: user?.email },
          });
        } catch (e) {
          // No rompas el flujo por fallo de IA
          results.push({ type, ok: false, error: 'LLM_FAILED', detail: e?.message });
        }
      }

      // merge seguro
      if (enriched && typeof enriched === 'object') {
        auditDoc.resumen = safeStr(enriched.resumen || enriched.summary, auditDoc.resumen);
        auditDoc.actionCenter = normalizeActionCenter(enriched.actionCenter);
        // ¡La clave! Normalizamos SIEMPRE a array válido
        auditDoc.issues = normalizeIssues(enriched.issues, type);
        auditDoc.salesLast30 = enriched.salesLast30;
        auditDoc.ordersLast30 = enriched.ordersLast30;
        auditDoc.avgOrderValue = enriched.avgOrderValue;
        auditDoc.topProducts = Array.isArray(enriched.topProducts) ? enriched.topProducts : auditDoc.topProducts;
        auditDoc.customerStats = enriched.customerStats || auditDoc.customerStats;
      } else {
        // sin IA: issues vacíos (válido para el schema)
        auditDoc.issues = [];
      }

      // guarda
      const saved = await Audit.create(auditDoc);
      results.push({ type, ok: true, auditId: saved._id });
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

/* ------------------------ GET /api/audits/latest ------------------------ */
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

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

/* --------------------- GET /api/audits/action-center -------------------- */
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
          type: a.type,
          at: a.generatedAt,
          button: it.button || null,
          estimated: it.estimated || null,
        });
      }
    }

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
