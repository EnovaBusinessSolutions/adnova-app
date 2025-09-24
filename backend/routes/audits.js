// backend/routes/audits.js
'use strict';

const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User  = require('../models/User');

// Collectors (devuelven "inputSnapshot" consistente por fuente)
const { collectGoogle } = require('../jobs/collect/googleCollector');
const { collectMeta   } = require('../jobs/collect/metaCollector');

// IA opcional (pulido de texto sin inventar datos)
let generateAudit = null;
try {
  generateAudit = require('../jobs/llm/generateAudit');
} catch {
  generateAudit = null;
}

/* ========================================================
   Helpers
   ======================================================== */

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
}

const OK_AREAS = new Set([
  'setup', 'performance', 'creative', 'tracking', 'budget', 'bidding'
]);
const OK_SEV = new Set(['alta', 'media', 'baja']);

function safeStr(v, fb = '') {
  return typeof v === 'string' ? v : fb;
}
function cap10(arr) {
  return Array.isArray(arr) ? arr.slice(0, 10) : [];
}


function normalizeIssue(raw, i = 0, type = 'google') {
  const id  = safeStr(raw?.id, `iss-${type}-${Date.now()}-${i}`).trim();
  const area = OK_AREAS.has(raw?.area) ? raw.area : 'performance';
  const title = safeStr(raw?.title, 'Hallazgo').trim();
  const sevIn = safeStr(raw?.severity, 'media').toLowerCase();
  const severity = OK_SEV.has(sevIn) ? sevIn : 'media';

  return {
    id,
    area,
    title,
    severity,                                // 'alta'|'media'|'baja'
    evidence: safeStr(raw?.evidence, ''),
    metrics: raw?.metrics && typeof raw.metrics === 'object' ? raw.metrics : {},
    recommendation: safeStr(raw?.recommendation, ''),
    estimatedImpact: (['alto', 'medio', 'bajo'].includes(raw?.estimatedImpact) ? raw.estimatedImpact : 'medio'),
    blockers: Array.isArray(raw?.blockers) ? raw.blockers.map(String) : [],
    links: Array.isArray(raw?.links)
      ? raw.links.map(l => ({ label: safeStr(l?.label, ''), url: safeStr(l?.url, '') }))
      : [],
    // NO está en el schema pero lo guardamos dentro de metrics si llega:
    // campaignRef: { id, name }
    ...(raw?.campaignRef ? { metrics: { ...raw.metrics, campaignRef: raw.campaignRef } } : {})
  };
}

function normalizeIssues(list, type = 'google') {
  if (!Array.isArray(list)) return [];
  return cap10(list).map((it, i) => normalizeIssue(it, i, type));
}

/* ========================================================
   POST /api/audits/run
   Lanza auditorías por cada fuente conectada.
   ======================================================== */

router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId).lean();

    // Flags reales (si el front no los manda, tomamos User.*Connected)
    const flags = {
      google:  !!(req.body?.googleConnected  ?? user?.googleConnected),
      meta:    !!(req.body?.metaConnected    ?? user?.metaConnected),
      shopify: !!(req.body?.shopifyConnected ?? user?.shopifyConnected),
    };

    const results = [];
    for (const type of ['google', 'meta', 'shopify']) {
      if (!flags[type]) {
        results.push({ type, ok: false, error: 'NOT_CONNECTED' });
        continue;
      }

      // 1) Snapshot por fuente
      let inputSnapshot = {};
      try {
        if (type === 'google')  inputSnapshot = await collectGoogle(userId);
        if (type === 'meta')    inputSnapshot = await collectMeta(userId);
        if (type === 'shopify') inputSnapshot = {}; // Integrar tu colector real si lo tienes
      } catch (e) {
        // Si el colector falla no rompemos el flujo
        inputSnapshot = {};
      }

      // 2) Generar auditoría (determinística + pulido IA si OPENAI_API_KEY)
      let enriched = null;
      try {
        if (generateAudit) {
          enriched = await generateAudit({ type, inputSnapshot });
        } else {
          // Seguridad: si por alguna razón no se cargó el módulo
          enriched = { summary: '', issues: [], actionCenter: [], topProducts: [] };
        }
      } catch (e) {
        // Sin bloquear el resto
        enriched = { summary: '', issues: [], actionCenter: [], topProducts: [] };
        results.push({ type, ok: false, error: 'LLM_FAILED', detail: e?.message });
      }

      // 3) Normalización dura (cumplir Mongoose IssueSchema) + caps
      const issues = normalizeIssues(enriched?.issues, type);
      const actionCenter = issues.slice(0, 3);
      const topProducts = Array.isArray(enriched?.topProducts) ? enriched.topProducts : [];

      // 4) Guardar
      const auditDoc = {
        userId,
        type,
        generatedAt: new Date(),
        summary: safeStr(enriched?.summary, ''),
        issues,
        actionCenter,
        topProducts,
        inputSnapshot,                      // para trazabilidad en DB
        version: 'audits@1.0.0',
      };

      const saved = await Audit.create(auditDoc);
      results.push({ type, ok: true, auditId: saved._id });
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

/* ========================================================
   GET /api/audits/latest
   Devuelve el último documento por tipo del usuario.
   ======================================================== */

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
      data: {
        google:  google  || null,
        meta:    meta    || null,
        shopify: shopify || null,
      },
    });
  } catch (e) {
    console.error('LATEST_ERROR:', e);
    return res.status(400).json({ ok: false, error: 'LATEST_ERROR', detail: e?.message });
  }
});

/* ========================================================
   GET /api/audits/action-center
   Combina las 6 últimas auditorías y devuelve top acciones.
   ======================================================== */

router.get('/action-center', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const audits = await Audit
      .find({ userId })
      .sort({ generatedAt: -1 })
      .limit(6)
      .lean();

    const items = [];
    for (const a of audits) {
      const list = Array.isArray(a.actionCenter) ? a.actionCenter : [];
      for (const it of list) {
        items.push({
          title: it.title || '(Sin título)',
          description: it.evidence || it.recommendation || '',
          severity: it.severity || 'media', // 'alta'|'media'|'baja'
          type: a.type,
          at: a.generatedAt,
          button: null,
          estimated: it.estimatedImpact || null,
        });
      }
    }

    // Ordenar: alta > media > baja, y luego por fecha desc
    const sevRank = { alta: 3, media: 2, baja: 1 };
    items.sort((a, b) => {
      const s = (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
      if (s !== 0) return s;
      return new Date(b.at) - new Date(a.at);
    });

    // Cap por si se dispara
    return res.json({ ok: true, items: items.slice(0, 30) });
  } catch (e) {
    console.error('ACTION_CENTER_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'ACTION_CENTER_ERROR', detail: e?.message });
  }
});

module.exports = router;
