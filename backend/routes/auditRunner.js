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
try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema, model } = mongoose;
  MetaAccount =
    mongoose.models.MetaAccount ||
    model('MetaAccount', new Schema({}, { strict: false, collection: 'metaaccounts' }));
}
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch {
  const { Schema, model } = mongoose;
  GoogleAccount =
    mongoose.models.GoogleAccount ||
    model('GoogleAccount', new Schema({}, { strict: false, collection: 'googleaccounts' }));
}
try {
  ShopConnections = require('../models/ShopConnections');
} catch {
  const { Schema, model } = mongoose;
  ShopConnections =
    mongoose.models.ShopConnections ||
    model('ShopConnections', new Schema({}, { strict: false, collection: 'shopconnections' }));
}

// Scope de lectura de GA4 (para detectar conexión de Analytics)
const GA_SCOPE_READ = 'https://www.googleapis.com/auth/analytics.readonly';

/* ============== auth ============== */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

/* ============== helpers ============== */
const VALID_TYPES = new Set(['meta', 'google', 'shopify', 'ga4', 'ga']);
const isValidType = (t) => VALID_TYPES.has(String(t));

async function detectConnectedSources(userId) {
  const [meta, google, shop] = await Promise.all([
    MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
      .select('access_token token accessToken longLivedToken longlivedToken')
      .lean(),
    GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
      .select('refreshToken accessToken scope')
      .lean(),
    ShopConnections.findOne({ $or: [{ user: userId }, { userId }] })
      .select('shop access_token accessToken')
      .lean(),
  ]);

  const metaConnected =
    !!(
      meta &&
      (meta.access_token ||
        meta.token ||
        meta.accessToken ||
        meta.longLivedToken ||
        meta.longlivedToken)
    );

  const googleAdsConnected = !!(google && (google.refreshToken || google.accessToken));
  const shopifyConnected = !!(shop && shop.shop && (shop.access_token || shop.accessToken));

  // GA4 conectado = GoogleAccount con token + scope analytics.readonly
  const googleScopes = Array.isArray(google?.scope)
    ? google.scope.map((s) => String(s))
    : [];
  const ga4Connected = googleAdsConnected && googleScopes.includes(GA_SCOPE_READ);

  const types = [];
  if (metaConnected) types.push('meta');
  if (googleAdsConnected) types.push('google');
  if (ga4Connected) types.push('ga4');
  if (shopifyConnected) types.push('shopify');
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
    origin: doc.origin || null, // para distinguir onboarding/panel
  };
}

/* ============== job map (in-memory) ============== */
const jobs = new Map();
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ===========================================================
 * POST /api/audits/:type/run
 * Lanza una auditoría individual (uso puntual; por defecto ONBOARDING)
 * =========================================================*/
router.post('/:type/run', requireAuth, express.json(), async (req, res) => {
  try {
    const type = String(req.params.type || '').toLowerCase();
    if (!isValidType(type)) {
      return res.status(400).json({ ok: false, error: 'INVALID_TYPE' });
    }

    // ★ Por defecto consideramos este endpoint como de ONBOARDING
    const source = (req.body && req.body.source) || 'onboarding';

    // Checa conexión antes de correr (evita errores raros)
    const connectedTypes = await detectConnectedSources(req.user._id);
    if (!connectedTypes.includes(type)) {
      return res.status(400).json({
        ok: false,
        error: 'SOURCE_NOT_CONNECTED',
        type,
      });
    }

    // Pasamos también 'source' (el job/modelo lo usará como origin)
    const ok = await runAuditFor({ userId: req.user._id, type, source });

    const latest = await fetchLatestAuditSummary(req.user._id, type);

    return res.json({
      ok: !!ok,
      type,
      source,
      latestAudit: latest,
    });
  } catch (e) {
    console.error('audit run error:', e);
    return res.status(500).json({
      ok: false,
      error: 'RUN_ERROR',
      detail: e?.message || String(e),
    });
  }
});

/* ===========================================================
 * POST /api/audits/start
 * { types: ['meta','google','shopify'], source?: 'panel' | 'onboarding' }
 *  |  { types: 'auto' }  (usa detectConnectedSources)
 *
 * - Onboarding3 manda source: "onboarding"
 * - El panel de "Generar Auditoría con IA" puede mandar source: "panel"
 *   (por defecto usamos "panel" aquí)
 * =========================================================*/
router.post('/start', requireAuth, express.json(), async (req, res) => {
  try {
    // ★ Por defecto asumimos que este endpoint viene del PANEL
    const source = (req.body && req.body.source) || 'panel';

    // 1) Qué fuentes están REALMENTE conectadas
    const connectedTypes = await detectConnectedSources(req.user._id);

    // 2) Qué pidió el frontend
    const rawTypes = Array.isArray(req.body?.types)
      ? req.body.types.map((t) => String(t).toLowerCase()).filter(isValidType)
      : null;

    let types = [];
    const skippedByConnection = {};

    if (req.body?.types === 'auto' || !rawTypes) {
      // Modo automático → usamos SOLO las conectadas
      types = [...connectedTypes];

      // Y registramos como "skipped" todas las válidas que NO están conectadas
      for (const t of VALID_TYPES) {
        const tt = String(t);
        if (!connectedTypes.includes(tt)) {
          skippedByConnection[tt] = 'NOT_CONNECTED';
        }
      }
    } else {
      // El front pidió tipos concretos → intersectamos con las conectadas
      for (const t of rawTypes) {
        if (connectedTypes.includes(t)) {
          types.push(t);
        } else {
          skippedByConnection[t] = 'NOT_CONNECTED';
        }
      }
    }

    // 3) Si no hay nada que auditar, no lanzamos job
    if (!types.length) {
      return res.status(400).json({
        ok: false,
        error: 'NO_TYPES_CONNECTED',
        detail:
          'No hay integraciones conectadas para auditar (Google Ads, Meta Ads, GA4 o Shopify).',
        skippedByConnection,
      });
    }

    const jobId = newId();
    const state = {
      id: jobId,
      // guardamos el ObjectId real, no string
      userId: req.user._id,
      startedAt: Date.now(),
      source, // guardamos el origen del job (onboarding/panel)
      items: {},
    };
    for (const t of types) {
      state.items[t] = {
        status: 'pending',
        ok: null,
        error: null,
        source,
      };
    }

    jobs.set(jobId, state);

    // devolvemos info básica al front
    res.json({
      ok: true,
      jobId,
      types,
      source,
      skippedByConnection, // 👈 útil si quieres pintar "No conectado" desde esta respuesta
    });

    // Ejecuta asíncrono, uno por tipo
    setImmediate(async () => {
      for (const t of types) {
        state.items[t].status = 'running';
        try {
          // Pasamos 'source' para que el job y Audit guarden origin correcto
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
    return res.status(500).json({ ok: false, error: 'START_ERROR' });
  }
});

/* ===========================================================
 * GET /api/audits/progress?jobId=...
 * Devuelve estado + %; llega a 100 cuando los docs ya existen.
 * =========================================================*/
router.get('/progress', requireAuth, async (req, res) => {
  const jobId = String(req.query.jobId || '');
  const s = jobs.get(jobId);
  if (!s) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });

  const items = s.items;
  const total = Object.keys(items).length;
  const done = Object.values(items).filter((x) => x.status === 'done').length;

  // porcentaje suave (hasta 90 cuando terminan tareas; luego 97→100 cuando ya están en DB)
  let percent = Math.round((done / total) * 90);

  if (done === total) {
    percent = 95;

    // ★ Filtramos también por origin = s.source para evitar mezclar
    // auditorías antiguas de otro flujo.
    const query = {
      userId: s.userId,
      generatedAt: { $gte: new Date(s.startedAt - 60 * 1000) },
    };
    if (s.source) {
      query.origin = s.source;
    }
    // opcional: acotar a los tipos del job
    query.type = { $in: Object.keys(items) };

    const docs = await Audit.find(query)
      .select('type generatedAt origin')
      .lean();

    const have = new Set((docs || []).map((d) => d.type));
    const allPersisted = Object.keys(items).every((t) => have.has(t));
    percent = allPersisted ? 100 : 97;
    if (allPersisted) s.finishedAt = Date.now();
  }

  res.json({
    ok: true,
    jobId,
    source: s.source || null,
    items,
    percent,
    finished: percent >= 100,
  });
});

module.exports = router;
