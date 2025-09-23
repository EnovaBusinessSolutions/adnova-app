const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User  = require('../models/User');

// Collectors (Google / Meta)
const { collectGoogle } = require('../jobs/collect/googleCollector');
const { collectMeta }   = require('../jobs/collect/metaCollector');

// IA opcional (acepta export default o { generateAudit })
let generateAudit;
try {
  generateAudit = require('../jobs/llm/generateAudit');
  if (generateAudit && generateAudit.generateAudit) {
    generateAudit = generateAudit.generateAudit;
  }
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
  if (!anyIssues) return [];

  if (Array.isArray(anyIssues)) {
    return anyIssues.map((it, idx) => {
      const id    = it?.id || `iss-${Date.now()}-${idx}`;
      const title = it?.title || 'Hallazgo';
      const area  = (it?.area || defaultArea).toString();
      const rawSev = (it?.severity || 'medium').toString().toLowerCase();
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

  // buckets legacy
  const out = [];
  const pushFromBucket = (arr, bucketArea) => {
    (arr || []).forEach((it, i) => {
      const id = `iss-${bucketArea}-${Date.now()}-${i}`;
      const title  = it?.title || 'Hallazgo';
      const rawSev = (it?.severity || 'medium').toString().toLowerCase();
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
  pushFromBucket(b.ux, 'ux');
  pushFromBucket(b.seo, 'seo');
  pushFromBucket(b.performance, 'performance');
  pushFromBucket(b.media, 'media');

  (b.productos || []).forEach((p, pi) => {
    (p?.hallazgos || []).forEach((it, i) => {
      const id = `iss-prod-${Date.now()}-${pi}-${i}`;
      const rawSev = (it?.severity || 'medium').toString().toLowerCase();
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
      (it?.severity === 'high' || it?.severity === 'alta') ? 'high' :
      (it?.severity === 'low'  || it?.severity === 'baja') ? 'low'  : 'medium',
    button: it?.button || null,
    estimated: it?.estimated || it?.estimatedImpact || null,
  }));
}

function buildEmptyAudit({ userId, type, reason }) {
  return {
    userId,
    type,                              // "google" | "meta" | "shopify"
    generatedAt: new Date(),
    resumen: reason ? `Omitido: ${reason}` : 'Sin datos.',
    productsAnalizados: 0,
    actionCenter: [],
    issues: [],                        // ARRAY (conforme a tu schema)
    inputSnapshot: {},                 // útil para depurar
    version: 'audits@1.0.0',
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

      let auditDoc = buildEmptyAudit({ userId, type });
      let inputSnapshot = {};

      // 1) Snapshot por tipo
      try {
        if (type === 'google') {
          inputSnapshot = await collectGoogle(userId);
        } else if (type === 'meta') {
          inputSnapshot = await collectMeta(userId);
        } else if (type === 'shopify') {
          inputSnapshot = { topProducts: [], kpis: {} };
        }
      } catch (e) {
        // Si el collector falla, registramos pero no rompemos el flujo
        results.push({ type, ok: false, error: String(e.message || e) });
      }

      // 2) IA con datos reales (si está disponible)
      let enriched = null;
      if (generateAudit) {
        try {
          enriched = await generateAudit({ type, inputSnapshot });
        } catch (e) {
          results.push({ type, ok: false, error: 'LLM_FAILED', detail: e?.message });
        }
      }

      // 3) Merge + normalización → compatible con tu schema
      if (enriched && typeof enriched === 'object') {
        auditDoc.resumen       = safeStr(enriched.resumen || enriched.summary, auditDoc.resumen);
        auditDoc.actionCenter  = normalizeActionCenter(enriched.actionCenter);
        auditDoc.issues        = normalizeIssues(enriched.issues, type);
        auditDoc.topProducts   = Array.isArray(enriched.topProducts) ? enriched.topProducts : [];
      } else {
        auditDoc.issues = normalizeIssues([], type);
      }

      auditDoc.inputSnapshot = inputSnapshot;

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
