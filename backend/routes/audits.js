// backend/routes/audits.js
'use strict';

const express = require('express');
const router = express.Router();

const Audit = require('../models/Audit');
const User  = require('../models/User');


const { collectGoogle } = require('../jobs/collect/googleCollector');
const { collectMeta   } = require('../jobs/collect/metaCollector');


let generateAudit = null;
try { generateAudit = require('../jobs/llm/generateAudit'); } catch { generateAudit = null; }


function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
}

const OK_AREAS = new Set(['setup', 'performance', 'creative', 'tracking', 'budget', 'bidding']);
const OK_SEV   = new Set(['alta', 'media', 'baja']);

const sevRank  = { alta: 3, media: 2, baja: 1 };

const safeStr  = (v, fb = '') => (typeof v === 'string' ? v : fb);
const cap      = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
const toSev    = (s) => {
  const v = String(s || '').toLowerCase().trim();
  if (v === 'alta' || v === 'high')  return 'alta';
  if (v === 'baja' || v === 'low')   return 'baja';
  return 'media';
};
const toArea   = (a) => (OK_AREAS.has(a) ? a : 'performance');

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
    estimatedImpact: ['alto', 'medio', 'bajo'].includes(raw?.estimatedImpact) ? raw.estimatedImpact : null,
    blockers: Array.isArray(raw?.blockers) ? raw.blockers.map(String) : [],
    links: Array.isArray(raw?.links)
      ? raw.links.map(l => ({ label: safeStr(l?.label, ''), url: safeStr(l?.url, '') }))
      : [],
  };

  
  if (raw?.campaignRef && typeof raw.campaignRef === 'object') {
    base.metrics = { ...base.metrics, campaignRef: {
      id:   safeStr(raw.campaignRef.id, ''),
      name: safeStr(raw.campaignRef.name, ''),
    }};
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
    area: 'setup',
    title,
    severity: 'alta',
    evidence,
    recommendation:
      type === 'google'
        ? 'Revisa los permisos (scope "adwords") y asegúrate de tener campañas activas o historial. Si trabajas vía MCC, revisa el login-customer-id y la vinculación de la cuenta al MCC.'
        : type === 'meta'
        ? 'Revisa los permisos (ads_read/ads_management) y confirma que hay cuentas con campañas activas. Valida también el píxel/eventos en Events Manager.'
        : 'Conecta la fuente y confirma que hay datos disponibles en el rango de fechas.',
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


router.post('/run', requireAuth, async (req, res) => {
  const userId = req.user._id;

  try {
    
    const user = await User.findById(userId).lean();
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

      
      let inputSnapshot = {};
      try {
        if (type === 'google')  inputSnapshot = await collectGoogle(userId);
        if (type === 'meta')    inputSnapshot = await collectMeta(userId);
        if (type === 'shopify') inputSnapshot = {}; 
      } catch (e) {
        inputSnapshot = {};
      }

      
      let issues = [];
      let summary = '';
      const hasCampaigns = Array.isArray(inputSnapshot?.byCampaign) && inputSnapshot.byCampaign.length > 0;
      const authorized   = !inputSnapshot?.notAuthorized;

      if (!authorized) {
        issues.push(buildSetupIssue({
          type,
          title: 'Permisos insuficientes o acceso denegado',
          evidence: `Motivo: ${inputSnapshot?.reason || 'no autorizado'}. Afecta a cuentas: ${(inputSnapshot?.accountIds || []).join(', ') || 'N/D'}`,
        }));
        summary = 'No fue posible auditar por permisos insuficientes.';
      } else if (!hasCampaigns) {
        issues.push(buildSetupIssue({
          type,
          title: 'No se detectaron campañas ni datos recientes',
          evidence: 'El snapshot no contiene campañas activas ni histórico en el rango consultado.',
        }));
        summary = 'No hay campañas activas ni datos para auditar.';
      } else {
        
        if (generateAudit) {
          try {
            const ai = await generateAudit({ type, inputSnapshot });
            summary = safeStr(ai?.summary, '');
            issues  = normalizeIssues(ai?.issues, type, 10);
          } catch (e) {
            
            summary = summary || '';
            issues  = normalizeIssues(issues, type, 10);
          }
        }
      }

      
      issues = normalizeIssues(issues, type, 10);
      const top3 = sortIssuesBySeverityThenImpact(issues).slice(0, 3);

      
      const doc = await Audit.create({
        userId,
        type,
        generatedAt: new Date(),
        
        resumen: summary,          
        summary,                   
        issues,                    
        actionCenter: top3,         
        topProducts: Array.isArray(inputSnapshot?.topProducts) ? inputSnapshot.topProducts : [],
        inputSnapshot,              
        version: 'audits@1.1.0',
      });

      results.push({ type, ok: true, auditId: doc._id });
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('AUDIT_RUN_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'RUN_ERROR', detail: e?.message || 'Unexpected error' });
  }
});


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
    return res.status(400).json({ ok: false, error: 'LATEST_ERROR', detail: e?.message });
  }
});


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
