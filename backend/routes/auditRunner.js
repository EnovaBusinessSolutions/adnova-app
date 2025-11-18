// backend/routes/auditRunner.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { runAuditFor } = require('../jobs/auditJob');
const Audit = require('../models/Audit');

// ★ (opcional, para futuros usos de límites / usos por usuario)
let User = null;
try {
  User = require('../models/User');
} catch {}

// Modelos para detección de conexiones (auto)
let MetaAccount, GoogleAccount, ShopConnections;
try { MetaAccount = require('../models/MetaAccount'); } catch {
  const { Schema, model } = mongoose;
  MetaAccount = mongoose.models.MetaAccount ||
    model('MetaAccount', new Schema({}, { strict:false, collection:'metaaccounts' }));
}
try { GoogleAccount = require('../models/GoogleAccount'); } catch {
  const { Schema, model } = mongoose;
  GoogleAccount = mongoose.models.GoogleAccount ||
    model('GoogleAccount', new Schema({}, { strict:false, collection:'googleaccounts' }));
}
try { ShopConnections = require('../models/ShopConnections'); } catch {
  const { Schema, model } = mongoose;
  ShopConnections = mongoose.models.ShopConnections ||
    model('ShopConnections', new Schema({}, { strict:false, collection:'shopconnections' }));
}

/* ============== auth ============== */
function requireAuth(req,res,next){
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok:false, error:'UNAUTHORIZED' });
}

/* ============== helpers ============== */
const VALID_TYPES = new Set(['meta','google','shopify']);
const isValidType = (t) => VALID_TYPES.has(String(t));

async function detectConnectedSources(userId) {
  const [meta, google, shop] = await Promise.all([
    MetaAccount.findOne({ $or:[{user:userId},{userId}] })
      .select('access_token token accessToken longLivedToken longlivedToken')
      .lean(),
    GoogleAccount.findOne({ $or:[{user:userId},{userId}] })
      .select('refreshToken accessToken')
      .lean(),
    ShopConnections.findOne({ $or:[{user:userId},{userId}] })
      .select('shop access_token accessToken')
      .lean()
  ]);

  const metaConnected   = !!(meta && (meta.access_token || meta.token || meta.accessToken || meta.longLivedToken || meta.longlivedToken));
  const googleConnected = !!(google && (google.refreshToken || google.accessToken));
  const shopifyConnected= !!(shop && shop.shop && (shop.access_token || shop.accessToken));

  const types = [];
  if (metaConnected)   types.push('meta');
  if (googleConnected) types.push('google');
  if (shopifyConnected)types.push('shopify');
  return types;
}

async function fetchLatestAuditSummary(userId, type) {
  const doc = await Audit.findOne({ userId, type })
    .sort({ generatedAt: -1 })
    .select('_id type generatedAt summary issues origin')
    .lean();
  if (!doc) return null;
  return {
    id: String(doc._id),
    type: doc.type,
    generatedAt: doc.generatedAt,
    summary: doc.summary,
    issuesCount: Array.isArray(doc.issues) ? doc.issues.length : 0,
    origin: doc.origin || null,       // ★ para distinguir onboarding/manual si el modelo lo guarda
  };
}

/* ============== job map (in-memory) ============== */
const jobs = new Map();
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ===========================================================
 * POST /api/audits/:type/run
 * Lanza una auditoría individual (usado por onboarding3.js)
 * =========================================================*/
router.post('/:type/run', requireAuth, async (req, res) => {
  try {
    const type = String(req.params.type || '').toLowerCase();
    if (!isValidType(type)) {
      return res.status(400).json({ ok:false, error:'INVALID_TYPE' });
    }

    // ★ origen: por defecto consideramos que este endpoint se usa en ONBOARDING
    const source = (req.body && req.body.source) || 'onboarding';

    // Checa conexión antes de correr (evita “errores confusos”)
    const connectedTypes = await detectConnectedSources(req.user._id);
    if (!connectedTypes.includes(type)) {
      return res.status(400).json({
        ok:false,
        error:'SOURCE_NOT_CONNECTED',
        type,
      });
    }

    // ★ Pasamos también el 'source' a runAuditFor (no rompe nada si la función lo ignora)
    const ok = await runAuditFor({ userId: req.user._id, type, source });

    const latest = await fetchLatestAuditSummary(req.user._id, type);

    return res.json({
      ok: !!ok,
      type,
      source,              // ★ para que el front sepa de dónde viene
      latestAudit: latest,
    });
  } catch (e) {
    console.error('audit run error:', e);
    return res.status(500).json({
      ok:false,
      error:'RUN_ERROR',
      detail: e?.message || String(e),
    });
  }
});

/* ===========================================================
 * POST /api/audits/start
 * { types: ['meta','google','shopify'], source?: 'manual' | 'onboarding' }
 *  |  { types: 'auto' }  (usa detectConnectedSources)
 * Crea un job y corre en background; /progress para consultar.
 * =========================================================*/
router.post('/start', requireAuth, express.json(), async (req,res) => {
  try {
    let types = [];

    // ★ origen: este endpoint se utilizará normalmente desde el panel
    // "Generar Auditoría con IA" → lo marcamos como 'manual' por defecto
    const source = (req.body && req.body.source) || 'manual';

    if (req.body?.types === 'auto' || !Array.isArray(req.body?.types)) {
      types = await detectConnectedSources(req.user._id);
    } else {
      types = req.body.types
        .map(t => String(t).toLowerCase())
        .filter(isValidType);
    }

    if (!types.length) {
      return res.status(400).json({ ok:false, error:'NO_TYPES' });
    }

    const jobId = newId();
    const state = {
      id: jobId,
      userId: String(req.user._id),
      startedAt: Date.now(),
      source,              // ★ guardamos el origen del job
      items: {}
    };
    for (const t of types) {
      state.items[t] = {
        status: 'pending',
        ok: null,
        error: null,
        source,            // ★ opcional, por claridad
      };
    }

    jobs.set(jobId, state);

    // devolvemos info básica al front
    res.json({
      ok: true,
      jobId,
      types,
      source,
    });

    // Ejecuta asíncrono, uno por tipo
    setImmediate(async () => {
      for (const t of types) {
        state.items[t].status = 'running';
        try {
          // ★ Pasamos 'source' para que el job e incluso el modelo Audit
          // puedan marcar origin: 'manual' | 'onboarding'
          const ok = await runAuditFor({ userId: req.user._id, type: t, source });
          state.items[t].status = 'done';
          state.items[t].ok = !!ok;
        } catch (e) {
          state.items[t].status = 'done';
          state.items[t].ok = false;
          state.items[t].error = e?.message || String(e);
        }
      }
    });
  } catch (e) {
    console.error('audits/start error:', e);
    return res.status(500).json({ ok:false, error:'START_ERROR' });
  }
});

/* ===========================================================
 * GET /api/audits/progress?jobId=...
 * Devuelve estado + %; llega a 100 cuando los docs ya existen.
 * =========================================================*/
router.get('/progress', requireAuth, async (req,res) => {
  const jobId = String(req.query.jobId || '');
  const s = jobs.get(jobId);
  if (!s) return res.status(404).json({ ok:false, error:'JOB_NOT_FOUND' });

  const items = s.items;
  const total = Object.keys(items).length;
  const done  = Object.values(items).filter(x=>x.status==='done').length;

  // porcentaje suave (hasta 90 cuando terminan tareas; luego 97→100 cuando ya están en DB)
  let percent = Math.round((done / total) * 90);

  if (done === total) {
    percent = 95;
    const docs = await Audit.find({
      userId: s.userId,
      generatedAt: { $gte: new Date(s.startedAt - 60 * 1000) }
    })
    .select('type generatedAt')
    .lean();

    const have = new Set((docs || []).map(d => d.type));
    const allPersisted = Object.keys(items).every(t => have.has(t));
    percent = allPersisted ? 100 : 97;
    if (allPersisted) s.finishedAt = Date.now();
  }

  res.json({
    ok:true,
    jobId,
    source: s.source || null,   // ★ devolvemos también el origen del job
    items,
    percent,
    finished: percent >= 100
  });
});

module.exports = router;
