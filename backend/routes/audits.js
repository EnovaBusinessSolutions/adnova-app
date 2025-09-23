// backend/routes/audits.js
const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User  = require('../models/User');

let generateAudit;
try {
  generateAudit = require('../jobs/llm/generateAudit'); // opcional
} catch { generateAudit = null; }

// ----------------------------- helpers auth -----------------------------
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
}
const safeStr = (v, fb = '') => (typeof v === 'string' && v.trim() ? v.trim() : fb);

// ------------------------- normalizadores VM ----------------------------
// El schema de Audit exige issues como lista con: id, area, title, severity.
// Aseguramos eso aquí, antes del create(), sin pedirle nada extra a los jobs.

const { v4: uuidv4 } = require('uuid');

function normSeverity(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'alta' || v === 'high')   return 'alta';
  if (v === 'baja' || v === 'low')    return 'baja';
  return 'media'; // default
}

function normalizeIssueVM(i = {}, idx = 0, prefix = 'gen') {
  const o = typeof i === 'object' && i !== null ? i : {};
  return {
    id: String(o.id || `${prefix}-${idx}-${Date.now()}-${uuidv4()}`),
    area: String(o.area || 'otros'),
    title: safeStr(o.title || o.nombre || o.titulo, 'Hallazgo'),
    severity: normSeverity(o.severity || o.gravedad),
    evidence: o.evidence || o.description || o.descripcion || '',
    metrics: o.metrics || undefined,
    recommendation: o.recommendation || o.recomendacion || undefined,
    estimatedImpact: o.estimatedImpact || undefined,
    blockers: Array.isArray(o.blockers) ? o.blockers : undefined,
    links: Array.isArray(o.links) ? o.links : undefined,
  };
}

// Convierte buckets legacy -> lista de issues VM
function legacyBucketsToIssues(buckets = {}) {
  const out = [];
  const push = (arr, area) => {
    (arr || []).forEach((it, idx) => {
      out.push(
        normalizeIssueVM(
          {
            title: it?.title,
            severity: it?.severity,
            evidence: it?.description,
            recommendation: it?.recommendation,
            area,
          },
          idx,
          `legacy-${area}`
        )
      );
    });
  };

  push(buckets.ux, 'ux');
  push(buckets.seo, 'seo');
  push(buckets.performance, 'performance');
  push(buckets.media, 'media');

  // productos: [{nombre, hallazgos:[...]}]
  (buckets.productos || []).forEach((p, pidx) => {
    (p?.hallazgos || []).forEach((it, idx) => {
      out.push(
        normalizeIssueVM(
          {
            title: it?.title || `Producto: ${p?.nombre || ''}`,
            severity: it?.severity,
            evidence: it?.description,
            recommendation: it?.recommendation,
            area: 'performance',
          },
          `${pidx}-${idx}`,
          'legacy-prod'
        )
      );
    });
  });

  // específicos (si existen)
  const copyArray = (arr, area) =>
    (arr || []).map((it, idx) => normalizeIssueVM({ ...it, area }, idx, `legacy-${area}`));
  if (Array.isArray(buckets.googleads)) out.push(...copyArray(buckets.googleads, 'performance'));
  if (Array.isArray(buckets.metaads))   out.push(...copyArray(buckets.metaads,   'performance'));
  if (Array.isArray(buckets.googleanalytics)) out.push(...copyArray(buckets.googleanalytics, 'otros'));

  return out;
}

// fallback para que siempre exista al menos 1 issue
function withFallbackIssues(arr, prefix = 'gen') {
  const items = Array.isArray(arr) ? arr : [];
  if (items.length) return items.map((it, i) => normalizeIssueVM(it, i, prefix));
  return [
    normalizeIssueVM(
      {
        title: 'Sin datos suficientes para generar recomendaciones',
        area: 'otros',
        severity: 'baja',
        evidence: 'No se detectó actividad reciente o conexiones incompletas.',
        recommendation: 'Revisa las conexiones y confirma que existan campañas activas con datos.',
      },
      0,
      `${prefix}-fallback`
    ),
  ];
}

function normalizeActionCenter(arr, prefix = 'ac') {
  const items = Array.isArray(arr) ? arr : [];
  if (items.length) {
    return items.map((it, i) =>
      normalizeIssueVM(
        {
          title: it?.title || 'Acción recomendada',
          severity: it?.severity,
          evidence: it?.description,
          recommendation: it?.button ? `${it?.description}\nBotón: ${it?.button}` : it?.description,
          area: 'otros',
        },
        i,
        prefix
      )
    );
  }
  return [];
}

// Construye doc VM homogéneo a partir de “algo” (LLM v2 o legacy)
function buildDocFromAny(type, base, prefix) {
  // v2: summary + issues como array VM
  if (Array.isArray(base?.issues) && typeof base?.summary === 'string') {
    return {
      type,
      generatedAt: base.generatedAt || new Date().toISOString(),
      summary: safeStr(base.summary, 'Sin resumen'),
      issues: withFallbackIssues(base.issues, prefix),
      actionCenter: normalizeActionCenter(base.actionCenter, `${prefix}-ac`),
      topProducts: base.topProducts,
      raw: base,
    };
  }

  // legacy: resumen + issues en buckets
  const issuesList = legacyBucketsToIssues(base?.issues || {});
  const acList     = normalizeActionCenter(base?.actionCenter, `${prefix}-ac`);
  return {
    type,
    generatedAt: base?.generatedAt || new Date().toISOString(),
    summary: safeStr(base?.resumen, 'Sin resumen'),
    issues: withFallbackIssues(issuesList, prefix),
    actionCenter: acList.length ? acList : issuesList.slice(0, 3).map((x, i) => normalizeIssueVM(x, i, `${prefix}-ac`)),
    topProducts: base?.topProducts,
    raw: base,
  };
}

function buildEmptyDoc(type, reason) {
  return {
    type,
    generatedAt: new Date().toISOString(),
    summary: reason ? `Omitido: ${reason}` : 'Sin datos.',
    issues: withFallbackIssues([], `empty-${type}`),
    actionCenter: [],
    topProducts: [],
  };
}

// --------------------------- POST /run ---------------------------
router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;
  const user   = await User.findById(userId).lean();

  const flags = {
    google:  !!(req.body?.googleConnected  ?? user?.googleConnected),
    meta:    !!(req.body?.metaConnected    ?? user?.metaConnected),
    shopify: !!(req.body?.shopifyConnected ?? user?.shopifyConnected),
  };

  const types = ['google', 'meta', 'shopify'];
  const results = [];

  try {
    for (const type of types) {
      if (!flags[type]) {
        results.push({ type, ok: false, error: 'NOT_CONNECTED' });
        continue;
      }

      // 1) base vacío
      let doc = buildEmptyDoc(type);

      // 2) colectores propios (opcional) -> rawData
      // const rawData = await collectSomething(type, userId); // si lo tienes

      // 3) IA opcional
      if (generateAudit) {
        try {
          const enriched = await generateAudit({
            type,
            // kpis / products / etc. si los tuvieras:
            kpis: {}, products: [],
            user: { id: String(userId), email: user?.email },
          });

          if (enriched && typeof enriched === 'object') {
            doc = buildDocFromAny(type, enriched, type);
          }
        } catch (e) {
          // si la IA falla, mantenemos doc vacío ya con fallback issue
          results.push({ type, ok: false, error: 'LLM_FAILED', detail: e?.message });
        }
      }

      // 4) persiste SIEMPRE con issues normalizados
      const saved = await Audit.create({
        userId,
        type: doc.type,
        generatedAt: doc.generatedAt,
        resumen: doc.summary, // compat con schema legacy
        productsAnalizados: 0,
        actionCenter: doc.actionCenter.map((x) => ({
          title: x.title,
          description: x.evidence || '',
          severity: x.severity,
          button: undefined,
          estimated: x.estimatedImpact,
        })),
        // Para compatibilidad con el schema legacy que tenía buckets:
        // guardamos “issues” como objeto con un bucket plano “ux” (o “otros”)
        // y además incluimos una copia “flatIssues” si tu schema lo permite.
        issues: { ux: doc.issues.map((x) => ({
          title: x.title,
          description: x.evidence,
          severity: x.severity === 'alta' ? 'high' : x.severity === 'baja' ? 'low' : 'medium',
          recommendation: x.recommendation,
        })) },
        // campos opcionales:
        salesLast30: undefined,
        ordersLast30: undefined,
        avgOrderValue: undefined,
        topProducts: doc.topProducts || [],
        customerStats: undefined,
        // si tu modelo admite un “raw” o “vm”, puedes guardarlo:
        vm: doc, // <-- si tu schema no lo tiene, quita esta línea
      });

      results.push({ type, ok: true, auditId: saved._id });
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

// -------------------------- GET /latest ---------------------------
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const [google, meta, shopify] = await Promise.all(
      ['google', 'meta', 'shopify'].map((t) =>
        Audit.findOne({ userId, type: t }).sort({ generatedAt: -1 }).lean()
      )
    );
    return res.json({ ok: true, data: { google: google || null, meta: meta || null, shopify: shopify || null } });
  } catch (e) {
    console.error('LATEST_ERROR:', e);
    return res.status(400).json({ ok: false, error: 'INVALID_TYPE', detail: e?.message });
  }
});

// ---------------------- GET /action-center -----------------------
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
    const sevRank = { high: 3, medium: 2, low: 1, alta: 3, media: 2, baja: 1 };
    items.sort((a, b) => {
      const s = (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
      if (s) return s;
      return new Date(b.at) - new Date(a.at);
    });

    return res.json({ ok: true, items });
  } catch (e) {
    console.error('ACTION_CENTER_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'ACTION_CENTER_ERROR', detail: e?.message });
  }
});

module.exports = router;
