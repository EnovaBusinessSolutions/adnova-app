// backend/routes/audits.js
'use strict';

const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User  = require('../models/User');

// IA opcional (exporta una función: module.exports = generateAudit)
let generateAudit = null;
try {
  generateAudit = require('../jobs/llm/generateAudit');
} catch {
  generateAudit = null;
}

/* ------------------------ helpers ------------------------ */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
}

function safeStr(v, fallback = '') {
  return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
}

function normalizeIssues(anyIssues, defaultArea = 'otros') {
  // si viene null/undefined → array vacío
  if (!anyIssues) return [];

  // v2 (array): rellena faltantes y mapea severidad a high/medium/low
  if (Array.isArray(anyIssues)) {
    return anyIssues.map((it, idx) => {
      const id    = (it && it.id && String(it.id).trim()) || `iss-${Date.now()}-${idx}`;
      const title = (it && it.title) || 'Hallazgo';
      const area  = (it && it.area) ? String(it.area) : defaultArea;

      const rawSev = String(it?.severity ?? 'medium').toLowerCase();
      const severity =
        rawSev === 'alta' || rawSev === 'high' ? 'high' :
        rawSev === 'baja' || rawSev === 'low'  ? 'low'  : 'medium';

      return {
        id,
        title,
        area,
        severity,
        description: it?.description || it?.evidence || '',
        recommendation: it?.recommendation,
        metrics: it?.metrics,
        estimatedImpact: it?.estimatedImpact,
        blockers: it?.blockers,
        links: it?.links,
      };
    });
  }

  // v1 (buckets objeto): aplanar a lista
  const out = [];
  const pushFromBucket = (arr, bucketArea) => {
    (arr || []).forEach((it, i) => {
      const id    = `iss-${bucketArea}-${Date.now()}-${i}`;
      const title = it?.title || 'Hallazgo';
      const rawSev = String(it?.severity ?? 'medium').toLowerCase();
      const severity =
        rawSev === 'alta' || rawSev === 'high' ? 'high' :
        rawSev === 'baja' || rawSev === 'low'  ? 'low'  : 'medium';

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
  pushFromBucket(b.ux,          'ux');
  pushFromBucket(b.seo,         'seo');
  pushFromBucket(b.performance, 'performance');
  pushFromBucket(b.media,       'media');

  // productos: [{ nombre, hallazgos: LegacyIssue[] }]
  (b.productos || []).forEach((p, pi) => {
    (p?.hallazgos || []).forEach((it, i) => {
      const id    = `iss-prod-${Date.now()}-${pi}-${i}`;
      const rawSev = String(it?.severity ?? 'medium').toLowerCase();
      const severity =
        rawSev === 'alta' || rawSev === 'high' ? 'high' :
        rawSev === 'baja' || rawSev === 'low'  ? 'low'  : 'medium';

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

function normalizeActionCenter(anyAC) {
  if (!Array.isArray(anyAC)) return [];
  return anyAC.map((it) => ({
    title: safeStr(it?.title, 'Acción recomendada'),
    description: safeStr(it?.description || it?.evidence, ''),
    severity:
      (String(it?.severity).toLowerCase() === 'alta' || String(it?.severity).toLowerCase() === 'high')
        ? 'high'
        : (String(it?.severity).toLowerCase() === 'baja' || String(it?.severity).toLowerCase() === 'low')
        ? 'low'
        : 'medium',
    button: it?.button || null,
    estimated: it?.estimated || it?.estimatedImpact || null,
  }));
}

function buildEmptyAudit({ userId, type, reason }) {
  return {
    userId,
    type,                               // "google" | "meta" | "shopify"
    generatedAt: new Date(),
    resumen: reason ? `Omitido: ${reason}` : 'Sin datos.',
    productsAnalizados: 0,
    actionCenter: [],
    issues: [],                          // SIEMPRE lista (evitamos validaciones fallidas)
  };
}

/* ------------------------ POST /api/audits/run ------------------------ */
router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;
  const user   = await User.findById(userId).lean();

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

      // Documento base
      let auditDoc = buildEmptyAudit({ userId, type });

      // Snapshot de entrada (pon aquí datos reales si ya tienes colectores)
      const inputSnapshot = {
        kpis: {},               // clicks, cost, cpc, roas, etc. si los tienes
        products: [],           // topProducts si existen
        user: { id: String(userId), email: user?.email },
        // pixelHealth, series, currency, timeZone, etc.
      };

      let enriched = null;
      if (generateAudit) {
        try {
          enriched = await generateAudit({
            type,
            inputSnapshot,       // *** clave: el LLM espera inputSnapshot ***
          });
        } catch (e) {
          // no rompas el flujo: reporta y sigue guardando el audit base
          results.push({ type, ok: false, error: 'LLM_FAILED', detail: e?.message });
        }
      }

      // Merge seguro (normalizaciones para cumplir el schema)
      if (enriched && typeof enriched === 'object') {
        auditDoc.resumen       = safeStr(enriched.summary || enriched.resumen, auditDoc.resumen);
        auditDoc.actionCenter  = normalizeActionCenter(enriched.actionCenter);
        auditDoc.issues        = normalizeIssues(enriched.issues, type); // ← siempre array válido
        auditDoc.salesLast30   = enriched.salesLast30;
        auditDoc.ordersLast30  = enriched.ordersLast30;
        auditDoc.avgOrderValue = enriched.avgOrderValue;
        auditDoc.topProducts   = Array.isArray(enriched.topProducts) ? enriched.topProducts : auditDoc.topProducts;
        auditDoc.customerStats = enriched.customerStats || auditDoc.customerStats;
      } else {
        auditDoc.issues = []; // fallback seguro
      }

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
router.get('/latest', requireAuth, async (_req, res) => {
  try {
    const userId = _req.user._id;

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
