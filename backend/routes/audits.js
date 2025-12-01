// backend/routes/audits.js
'use strict';

const express = require('express');
const router = express.Router();

// ---------------- Models ----------------
const Audit = require('../models/Audit');
const User  = require('../models/User');

// ---------------- Motor de auditorías (nuevo núcleo) ----------------
const { runAuditFor } = require('../jobs/auditJob');

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
  // 1 auditoría IA al día
  gratis: {
    limit: 1,
    period: 'daily',
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

function getWindowForPeriod(period) {
  const now = new Date();
  const start = new Date(now);
  const end   = new Date(now);

  if (period === 'daily') {
    // Ventana: hoy 00:00 → mañana 00:00 (hora local del servidor)
    start.setHours(0, 0, 0, 0);
    end.setDate(start.getDate() + 1);
    end.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
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
    // Rolling 15 días
    start.setDate(start.getDate() - 15);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    // unlimited
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

// ===== Fallback: si no hay issues, espejar actionCenter =====
function mirrorActionCenterToIssues(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  const hasIssues = Array.isArray(out.issues) && out.issues.length > 0;
  const ac = Array.isArray(out.actionCenter) ? out.actionCenter : [];
  if (!hasIssues && ac.length) {
    out.issues = ac.map((x, i) =>
      normalizeIssue(
        {
          title: x.title,
          evidence: x.evidence || x.description || x.detail || '',
          recommendation: x.recommendation || x.action || '',
          severity: toSev(x.severity || 'media'),
          area: x.area || 'performance',
          campaignRef: x.campaignRef,
          metrics: x.metrics,
        },
        i,
        out.type || 'google'
      )
    );
  }
  return out;
}

/* ================= Helpers para ordenar por severidad ================= */
function sortIssuesBySeverityThenImpact(issues) {
  return [...issues].sort((a, b) => {
    const s = (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
    if (s !== 0) return s;
    const ib = b.estimatedImpact === 'alto' ? 3 : b.estimatedImpact === 'medio' ? 2 : b.estimatedImpact === 'bajo' ? 1 : 0;
    const ia = a.estimatedImpact === 'alto' ? 3 : a.estimatedImpact === 'medio' ? 2 : a.estimatedImpact === 'bajo' ? 1 : 0;
    return ib - ia;
  });
}

// ---------------- Alias de fuentes (entrada) ----------------
const SOURCE_ALIASES = {
  ga: 'ga4',
  ga4: 'ga4',
  analytics: 'ga4',
  'google-analytics': 'ga4',
  googleanalytics: 'ga4',
};

// Valores válidos que se guardan en BD
const VALID_SOURCES_DB = ['google','meta','ga4'];

function normalizeSource(src = '') {
  const v = String(src).toLowerCase().trim();
  return SOURCE_ALIASES[v] || v;
}

/* ===================================================================== */
/* (0) USO DE AUDITORÍAS (para GenerateAudit.tsx)                        */
/* ===================================================================== */

// GET /api/audits/usage
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // 👇 Importante: leemos también auditUsageResetAt para reiniciar al cambiar de plan
    const user = await User.findById(userId)
      .lean()
      .select('plan auditUsageResetAt createdAt');

    if (!user) {
      return res.status(401).json({ error: 'NO_USER' });
    }

    const planKey = normalizePlan(user.plan);
    const cfg = PLAN_CONFIG[planKey] || PLAN_CONFIG.gratis;

    let used = 0;
    let nextResetAt = null;

    if (!cfg.unlimited) {
      // 1) Ventana del periodo (mensual, semanal, etc.)
      let { start, end } = getWindowForPeriod(cfg.period);

      // 2) Si tenemos un "reset" (cambio de plan), empezamos a contar desde ahí
      let resetAt = null;
      if (user.auditUsageResetAt instanceof Date) {
        resetAt = user.auditUsageResetAt;
      } else if (user.auditUsageResetAt) {
        resetAt = new Date(user.auditUsageResetAt);
      }

      if (resetAt && resetAt > start && resetAt < end) {
        start = resetAt;
      }

      const range = { $gte: start, $lt: end };

      // 3) Traemos SOLO auditorías manuales/panel (excluimos onboarding)
      const docs = await Audit.find({
        userId,
        origin: { $ne: 'onboarding' }, // ← onboarding no suma uso
        $or: [
          { generatedAt: range },
          { createdAt: range },
        ],
      })
        .select('generatedAt createdAt origin')
        .sort({ generatedAt: 1, createdAt: 1 })
        .lean();

      // 4) Agrupamos docs en "sesiones" (un clic en Generar Auditoría)
      //    google/meta/ga4 se crean casi al mismo tiempo, así que:
      //    - si la diferencia entre docs es < 30s → misma sesión
      //    - si es > 30s → nueva sesión (nuevo clic)
      const MAX_GAP_MS = 30 * 1000; // 30 segundos
      let sessions = 0;
      let lastTs = null;

      for (const d of docs) {
        const base = d.generatedAt || d.createdAt;
        if (!base) continue;

        const ts = base instanceof Date ? base.getTime() : new Date(base).getTime();
        if (!Number.isFinite(ts)) continue;

        if (!lastTs || ts - lastTs > MAX_GAP_MS) {
          sessions++; // nueva sesión de auditoría
        }
        lastTs = ts;
      }

      used = sessions;
      nextResetAt = end.toISOString();
    }

    return res.json({
      plan: planKey,      // "gratis" | "emprendedor" | "crecimiento" | "pro"
      limit: cfg.limit,   // número de auditorías IA del plan
      used,               // usos en el periodo
      period: cfg.period, // "monthly" | "weekly" | ...
      nextResetAt,        // cuándo se reinicia el periodo
      unlimited: cfg.unlimited,
    });
  } catch (e) {
    console.error('AUDIT_USAGE_ERROR:', e);
    return res.status(500).json({ error: 'FETCH_FAIL' });
  }
});

/* ===================================================================== */
/* (A) Ejecutar TODAS las fuentes (Google, Meta, GA4)                    */
/* ===================================================================== */

router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;

  try {
    // Desde el panel de "Generar Auditoría" lo más lógico es marcar origen "panel"
    const origin = req.body?.source || 'panel';

    const results = [];
    for (const type of VALID_SOURCES_DB) {
      try {
        const ok = await runAuditFor({ userId, type, source: origin });
        results.push({ type, ok: !!ok });
      } catch (e) {
        console.error('AUDIT_RUN_SOURCE_ERROR:', type, e?.message || e);
        results.push({ type, ok: false, error: e?.message || 'RUN_ERROR' });
      }
    }

    const anyOk = results.some(r => r.ok);
    return res.json({ ok: anyOk, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

/* ===================================================================== */
/* (B) Ejecutar SOLO una fuente                                          */
/* ===================================================================== */

router.post('/:source/run', requireAuth, async (req, res) => {
  const userId = req.user._id;
  const normalized = normalizeSource(req.params.source);

  if (!VALID_SOURCES_DB.includes(normalized)) {
    return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
  }

  try {
    const origin = req.body?.source || 'panel';
    const ok = await runAuditFor({ userId, type: normalized, source: origin });

    if (!ok) {
      return res.status(400).json({ ok: false, error: 'AUDIT_FAILED' });
    }

    return res.json({ ok: true, type: normalized });
  } catch (e) {
    console.error('AUDIT_SINGLE_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

/* ===================================================================== */
/* (C) Últimas auditorías (soporta ?type=all | google | meta | ga | ga4) */
/* ===================================================================== */

router.get('/latest', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const qType = (req.query?.type ? normalizeSource(req.query.type) : 'all');

    if (qType === 'all') {
      const [googleDoc, metaDoc, gaDoc] = await Promise.all(
        ['google','meta','ga4'].map((t) =>
          Audit.findOne({ userId, type: t }).sort({ generatedAt: -1 }).lean()
        )
      );

      const items = [googleDoc, metaDoc, gaDoc]
        .map(mirrorActionCenterToIssues)
        .filter(Boolean);

      return res.json({
        ok: true,
        data: {
          google: items.find(d => d?.type === 'google') || null,
          meta:   items.find(d => d?.type === 'meta')   || null,
          ga4:    items.find(d => d?.type === 'ga4')    || null,
        },
        items
      });
    }

    if (!VALID_SOURCES_DB.includes(qType)) {
      return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
    }

    const doc = await Audit.findOne({ userId, type: qType }).sort({ generatedAt: -1 }).lean();
    const finalDoc = mirrorActionCenterToIssues(doc) || null;
    return res.json({
      ok: true,
      data: finalDoc,
      items: finalDoc ? [finalDoc] : []
    });
  } catch (e) {
    console.error('LATEST_ERROR:', e);
    return res.status(400).json({ ok: false, error: 'LATEST_ERROR', detail: e?.message });
  }
});

/* ===================================================================== */
/* (C.1) Historial de auditorías por fuente (para panel de sitio)        */
/* ===================================================================== */

// GET /api/audits/site/history?type=google&limit=5
router.get('/site/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const rawType = req.query?.type || 'google';
    const normalized = normalizeSource(rawType);

    if (!VALID_SOURCES_DB.includes(normalized)) {
      return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
    }

    let limit = Number(req.query?.limit || 5);
    if (!Number.isFinite(limit) || limit <= 0) limit = 5;
    if (limit > 30) limit = 30; // tope sano

    const docs = await Audit.find({ userId, type: normalized })
      .sort({ generatedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const audits = docs
      .map(mirrorActionCenterToIssues)
      .filter(Boolean);

    return res.json({
      ok: true,
      type: normalized,
      count: audits.length,
      audits,
    });
  } catch (e) {
    console.error('HISTORY_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'HISTORY_ERROR', detail: e?.message || 'Unexpected error' });
  }
});

/* ===================================================================== */
/* (D) Última por fuente (compat legacy)                                 */
/* ===================================================================== */

router.get('/:source/latest', requireAuth, async (req, res) => {
  const normalized = normalizeSource(req.params.source);

  if (!VALID_SOURCES_DB.includes(normalized)) {
    return res.status(400).json({ ok: false, error: 'INVALID_SOURCE' });
  }
  try {
    const userId = req.user._id;
    const doc = await Audit.findOne({ userId, type: normalized }).sort({ generatedAt: -1 }).lean();
    const finalDoc = mirrorActionCenterToIssues(doc);
    if (!finalDoc) return res.json({ summary: null, findings: [], createdAt: null });

    return res.json({
      summary: finalDoc.summary || finalDoc.resumen || null,
      findings: Array.isArray(finalDoc.issues) ? finalDoc.issues : [],
      createdAt: finalDoc.generatedAt || finalDoc.createdAt || null,
    });
  } catch (e) {
    console.error('LATEST_SINGLE_ERROR:', e);
    return res.status(400).json({ ok: false, error: 'LATEST_SINGLE_ERROR', detail: e?.message });
  }
});

/* ===================================================================== */
/* (E) Action Center                                                     */
/* ===================================================================== */

router.get('/action-center', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const audits = await Audit.find({ userId }).sort({ generatedAt: -1 }).limit(6).lean();

    const items = [];
    for (const a of audits) {
      const list = Array.isArray(a.actionCenter) ? a.actionCenter : [];
      for (const it of list) {
        items.push({
          title: it.title || '(Sin título)',
          description: it.evidence || it.recommendation || '',
          severity: toSev(it.severity),
          type: a.type,
          at: a.generatedAt,
          button: null,
          estimated: it.estimatedImpact || null,
        });
      }
    }

    items.sort((x, y) => {
      const s = (sevRank[y.severity] || 0) - (sevRank[x.severity] || 0);
      if (s !== 0) return s;
      return new Date(y.at) - new Date(x.at);
    });

    return res.json({ ok: true, items: items.slice(0, 30) });
  } catch (e) {
    console.error('ACTION_CENTER_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'ACTION_CENTER_ERROR', detail: e?.message });
  }
});

module.exports = router;
