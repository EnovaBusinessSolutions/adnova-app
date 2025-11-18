// backend/routes/audits.js
'use strict';

const express = require('express');
const router = express.Router();

// ---------------- Models ----------------
const Audit = require('../models/Audit');
const User  = require('../models/User');

// ---------------- Collectors ----------------
const { collectGoogle } = require('../jobs/collect/googleCollector'); // Google Ads
const { collectMeta   } = require('../jobs/collect/metaCollector');   // Meta Ads

// GA4 (aceptamos varios paths por compatibilidad)
let collectGA4 = null;
try { ({ collectGA4 } = require('../jobs/collect/ga4Collector')); }
catch (_) {
  try { ({ collectGA4 } = require('../jobs/collect/googleAnalyticsCollector')); }
  catch (_) {
    try { ({ collectGA4 } = require('../jobs/collect/googleAnalytics')); }
    catch (_) { collectGA4 = null; }
  }
}

// ---------------- LLM (opcional; con fallback heurístico) ----------------
let generateAudit = null;
try { generateAudit = require('../jobs/llm/generateAudit'); } catch { generateAudit = null; }

// ---------------- Auth ----------------
function requireAuth(req, _res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return next({ status: 401, message: 'UNAUTHENTICATED' });
}

// ---------------- Normalizadores / Utils ----------------
const OK_AREAS = new Set(['setup','performance','creative','tracking','budget','bidding','otros']);
const sevRank  = { alta: 3, media: 2, baja: 1 };

const safeStr = (v, fb = '') => (typeof v === 'string' ? v : fb);
const cap     = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);

/* ========= CONFIG DE PLANES (uso de auditorías) =========
 *
 * Claves internas de plan que mandaremos al frontend:
 *  - gratis
 *  - emprendedor
 *  - crecimiento
 *  - pro
 *
 * Puedes ajustar los límites cuando quieras.
 */
const PLAN_CONFIG = {
  // 1 auditoría IA al mes
  gratis: {
    limit: 1,
    period: 'monthly',
    unlimited: false,
  },
  // 2 auditorías IA al mes
  emprendedor: {
    limit: 2,
    period: 'monthly',
    unlimited: false,
  },
  // Auditorías semanales (1 por semana)
  crecimiento: {
    limit: 1,
    period: 'weekly',
    unlimited: false,
  },
  // Auditorías ilimitadas
  pro: {
    limit: null,
    period: 'unlimited',
    unlimited: true,
  },
};

/**
 * Normaliza el plan guardado en Mongo a nuestras claves internas.
 * Soporta variantes tipo: "free", "gratis", "growth", "crecimiento", etc.
 */
function normalizePlan(rawPlan) {
  const v = String(rawPlan || '').toLowerCase().trim();

  if (['free', 'gratis', 'plan_free', 'plan_gratis'].includes(v)) return 'gratis';
  if (['emprendedor', 'entrepreneur', 'starter', 'plan_emprendedor'].includes(v)) return 'emprendedor';
  if (['crecimiento', 'growth', 'growth_plus', 'plan_crecimiento'].includes(v)) return 'crecimiento';
  if (['pro', 'plan_pro'].includes(v)) return 'pro';

  // fallback por defecto
  return 'gratis';
}

/**
 * Calcula ventana de fechas según el periodo del plan.
 * Devuelve { start, end } en Date.
 */
function getWindowForPeriod(period) {
  const now = new Date();
  const start = new Date(now);
  const end   = new Date(now);

  if (period === 'weekly') {
    // Semana tipo lunes-domingo
    const day = start.getDay(); // 0 dom, 1 lun...
    const diffToMonday = (day + 6) % 7;
    start.setDate(start.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);

    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
    end.setHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    // Mes calendario
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    end.setMonth(start.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);
  } else if (period === 'rolling') {
    // Rolling 15 días (por si algún día lo quieres así)
    start.setDate(start.getDate() - 15);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    // unlimited -> ventana muy amplia sólo para devolver nextResetAt null
    start.setTime(0);
    end.setFullYear(now.getFullYear() + 10);
  }

  return { start, end };
}

const toSev = (s) => {
  const v = String(s || '').toLowerCase().trim();
  if (v === 'alta' || v === 'high')  return 'alta';
  if (v === 'baja' || v === 'low')   return 'baja';
  return 'media';
};
const toArea = (a) => {
  const v = String(a || '').toLowerCase().trim();
  return OK_AREAS.has(v) ? v : 'performance';
};

function normalizeIssue(raw, i = 0, type = 'google') {
  const id    = safeStr(raw?.id, `iss-${type}-${Date.now()}-${i}`).trim();
  const area  = toArea(raw?.area);
  const title = safeStr(raw?.title, 'Hallazgo').trim();
  const sev   = toSev(raw?.severity);

  const base = {
    id,
    area,
    title,
    severity: sev,
    evidence: safeStr(raw?.evidence, ''),
    metrics: raw?.metrics && typeof raw.metrics === 'object' ? raw.metrics : {},
    recommendation: safeStr(raw?.recommendation, ''),
    estimatedImpact: ['alto','medio','bajo'].includes(String(raw?.estimatedImpact || '').toLowerCase())
      ? String(raw.estimatedImpact).toLowerCase()
      : null,
    blockers: Array.isArray(raw?.blockers) ? raw.blockers.map(String) : [],
    links: Array.isArray(raw?.links)
      ? raw.links.map(l => ({ label: safeStr(l?.label, ''), url: safeStr(l?.url, '') }))
      : [],
  };

  // compat: campaignRef → guardado dentro de metrics
  if (raw?.campaignRef && typeof raw.campaignRef === 'object') {
    base.metrics = {
      ...base.metrics,
      campaignRef: {
        id:   safeStr(raw.campaignRef.id, ''),
        name: safeStr(raw.campaignRef.name, ''),
      }
    };
  }
  // GA (segmentRef)
  if (raw?.segmentRef && typeof raw.segmentRef === 'object') {
    base.metrics = {
      ...base.metrics,
      segmentRef: {
        type: safeStr(raw.segmentRef.type, ''),
        name: safeStr(raw.segmentRef.name, ''),
      }
    };
  }
  return base;
}

function normalizeIssues(list, type = 'google', limit = 10) {
  if (!Array.isArray(list)) return [];
  return cap(list, limit).map((it, i) => normalizeIssue(it, i, type));
}

function buildSetupIssue({ title, evidence, type }) {
  return normalizeIssue({
    id: `setup-${type}-${Date.now()}`,
//...
    area: 'setup',
    title,
    severity: 'alta',
    evidence,
    recommendation:
      type === 'google'
        ? 'Revisa los permisos (scope "adwords") y asegúrate de tener campañas activas o histórico. Si trabajas vía MCC, valida login-customer-id y el vínculo MCC.'
        : type === 'meta'
        ? 'Revisa permisos (ads_read/ads_management) y confirma que hay cuentas con campañas activas. Valida el píxel/eventos en Events Manager.'
        : 'Conecta la propiedad de GA4 y confirma que hay datos en el rango de fechas.',
  }, 0, type);
}

function sortIssuesBySeverityThenImpact(issues) {
  return [...issues].sort((a, b) => {
    const s = (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
    if (s !== 0) return s;
    const ib = b.estimatedImpact === 'alto' ? 3 : b.estimatedImpact === 'medio' ? 2 : b.estimatedImpact === 'bajo' ? 1 : 0;
    const ia = a.estimatedImpact === 'alto' ? 3 : a.estimatedImpact === 'medio' ? 2 : a.estimatedImpact === 'bajo' ? 1 : 0;
    return ib - ia;
  });
}

/* ================= Helpers para repartir 6/3-3/2-2-2 por cuenta ================= */

function computeQuota(num) {
  if (num <= 1) return { per: 6, takeAccounts: 1 };
  if (num === 2) return { per: 3, takeAccounts: 2 };
  return { per: 2, takeAccounts: 3 };
}

function accountKeyFromIssue(it) {
  return (
    it.metrics?.campaignRef?.accountId || // si el LLM lo incluyera
    it.metrics?.accountId ||
    it.metrics?.account ||
    null
  );
}

function annotateTitleWithAccount(issue, label) {
  if (!label) return issue;
  const t = String(issue.title || '').trim();
  if (!t.startsWith('[')) issue.title = `[${label}] ${t}`;
  return issue;
}

function distributeByAccounts(issues, selectedIds = [], accountMap = {}) {
  const cleanSelected = Array.isArray(selectedIds) ? [...new Set(selectedIds.map(String))] : [];
  const { per, takeAccounts } = computeQuota(cleanSelected.length || 1);

  // bucket: accountId -> issues[]
  const bucket = new Map();
  for (const id of cleanSelected.slice(0, takeAccounts)) bucket.set(String(id), []);
  if (bucket.size === 0) bucket.set('default', []);

  const ranked = sortIssuesBySeverityThenImpact(issues);

  // Asignación por accountKey
  for (const it of ranked) {
    const k = accountKeyFromIssue(it);
    if (k && bucket.has(String(k)) && bucket.get(String(k)).length < per) {
      bucket.get(String(k)).push(it);
    }
  }

  // Relleno round-robin
  const leftovers = ranked.filter(it => ![...bucket.values()].some(arr => arr.includes(it)));
  const order = [...bucket.keys()];
  let idx = 0;
  for (const it of leftovers) {
    let placed = false;
    for (let tries = 0; tries < order.length; tries++) {
      const key = order[idx % order.length];
      const arr = bucket.get(key);
      if (arr.length < per) {
        arr.push(it);
        placed = true;
        idx++;
        break;
      }
      idx++;
    }
    if (!placed) break;
  }

  const out = [];
  for (const [key, arr] of bucket.entries()) {
    const label =
      key === 'default'
        ? null
        : (accountMap[key]?.name || accountMap[key]?.label || `Cuenta ${key}`);
    for (const it of arr) out.push(annotateTitleWithAccount(it, label));
  }

  return out.slice(0, 6);
}

/** Extrae entidades del snapshot para mapear ids->nombre por fuente */
function extractEntitiesForSnapshot(type, snap) {
// ...
  // (contenido igual que el tuyo)
}
// ... resto de helpers GA4 / injectAccountOnIssues / mirrorActionCenter etc
// (los mantengo tal cual, solo recorté arriba para no repetir 700 líneas en este mensaje,
// pero en tu archivo final deben seguir EXACTAMENTE como los tienes.)

// --------------------------------------------------------------------
// ⚠️ A PARTIR DE AQUÍ VIENEN LOS CAMBIOS IMPORTANTES
// --------------------------------------------------------------------

// ---------------- Núcleo: ejecutar una auditoría ----------------
async function runSingleAudit({ userId, type, flags, source = 'manual' }) {   // ★ añadimos source
  const persistType = SOURCE_ALIASES[type] || type;

  // 1) Si la fuente no está conectada → placeholder
  if (!flags[persistType]) {
    const doc = await Audit.create({
      userId,
      type: persistType,
      origin: source || 'manual',                                        // ★ origen
      generatedAt: new Date(),
      resumen: 'Fuente no conectada',
      summary: 'Fuente no conectada',
      issues: [buildSetupIssue({ type: persistType, title: 'Fuente no conectada', evidence: 'Conecta la cuenta para auditar.' })],
      actionCenter: [],
      inputSnapshot: { notAuthorized: true, reason: 'NOT_CONNECTED' },
      version: 'audits@1.1.2',
    });
    return { type: persistType, ok: true, auditId: doc._id };
  }

  // 2) Colecta
  let snap = {};
  try {
    if (persistType === 'google') snap = await collectGoogle(userId);
    else if (persistType === 'meta') snap = await collectMeta(userId);
    else if (persistType === 'ga4') {
      if (typeof collectGA4 === 'function') snap = await collectGA4(userId);
      else return { type: persistType, ok: false, error: 'SOURCE_NOT_READY' };
    }
  } catch (e) {
    console.warn('COLLECTOR_ERROR', persistType, e?.message || e);
    snap = {};
  }

  // ... TODA TU LÓGICA DE authorized/hasData/LLM/heurísticas queda igual ...

  // 6) Normaliza, ordena y persiste
  issues = normalizeIssues(issues, persistType, 10);
  const top3 = sortIssuesBySeverityThenImpact(issues).slice(0, 3);

  const doc = await Audit.create({
    userId,
    type: persistType,
    origin: source || 'manual',                                   // ★ marcamos de dónde viene
    generatedAt: new Date(),
    resumen: summary,
    summary,
    issues,
    actionCenter: top3,
    topProducts: Array.isArray(snap?.topProducts) ? snap.topProducts : [],
    inputSnapshot: snap,
    version: 'audits@1.1.3',
  });

  return { type: persistType, ok: true, auditId: doc._id };
}

// =====================================================
// RUTAS
// =====================================================

// (0) USO DE AUDITORÍAS (para GenerateAudit.tsx)
// GET /api/audits/usage
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).lean().select('plan');
    if (!user) {
      return res.status(401).json({ error: 'NO_USER' });
    }

    const planKey = normalizePlan(user.plan);
    const cfg = PLAN_CONFIG[planKey] || PLAN_CONFIG.gratis;

    let used = 0;
    let nextResetAt = null;

    if (!cfg.unlimited) {
      const { start, end } = getWindowForPeriod(cfg.period);

      // ★ IMPORTANTE:
      // Contamos SOLO auditorías "manuales".
      // Ignoramos las que vengan marcadas como origin: 'onboarding'.
      used = await Audit.countDocuments({
        userId,
        generatedAt: { $gte: start, $lt: end },
        origin: { $ne: 'onboarding' },        // ← la auditoría inicial ya no cuenta
      });

      nextResetAt = end.toISOString();
    }

    return res.json({
      plan: planKey,          // "gratis" | "emprendedor" | "crecimiento" | "pro"
      limit: cfg.limit,       // number | null
      used,                   // número de auditorías usadas en el periodo
      period: cfg.period,     // "monthly" | "weekly" | "rolling" | "unlimited"
      nextResetAt,            // ISO string o null
      unlimited: cfg.unlimited,
    });
  } catch (e) {
    console.error('AUDIT_USAGE_ERROR:', e);
    return res.status(500).json({ error: 'FETCH_FAIL' });
  }
});

// (A) Ejecutar TODAS
router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId).lean();
    const flags = {
      google:  !!(req.body?.googleConnected  ?? user?.googleConnected),
      meta:    !!(req.body?.metaConnected    ?? user?.metaConnected),
      ga4:     !!(req.body?.googleConnected  ?? user?.googleConnected), // GA comparte login Google
    };

    const source = req.body?.source || 'manual';          // ★ por si quieres forzar origen desde el front

    const results = [];
    for (const type of VALID_SOURCES_DB) {
      const r = await runSingleAudit({ userId, type, flags, source });  // ★ pasamos source
      results.push(r);
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

// (B) Ejecutar UNA (con alias de entrada)
router.post('/:source/run', requireAuth, async (req, res) => {
  const userId = req.user._id;
  const normalized = normalizeSource(req.params.source);

  if (!VALID_SOURCES_DB.includes(normalized)) {
    return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
  }

  try {
    const user = await User.findById(userId).lean();
    const flags = {
      google: !!user?.googleConnected,
      meta:   !!user?.metaConnected,
      ga4:    !!user?.googleConnected,
    };

    const source = req.body?.source || 'manual';          // ★ origen manual por defecto

    const r = await runSingleAudit({ userId, type: normalized, flags, source });
    if (!r.ok) return res.status(400).json(r);
    return res.json({ ok: true, ...r });
  } catch (e) {
    console.error('AUDIT_SINGLE_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

// (C), (D), (E) se quedan igual que los tienes (solo leen audits), no afectan al conteo.
// ----------------------------------------------------------------

module.exports = router;
