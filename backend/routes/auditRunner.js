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

/* ============== auth ============== */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

/* ============== helpers ============== */
const MAX_SELECT = 1;

// Tipos válidos (aceptamos alias "ga" pero lo normalizamos a "ga4")
const VALID_TYPES = new Set(['meta', 'google', 'shopify', 'ga4', 'ga']);
const normalizeType = (t) => {
  const x = String(t || '').toLowerCase();
  return x === 'ga' ? 'ga4' : x;
};
const isValidType = (t) => VALID_TYPES.has(String(t));

const normActId = (s = '') => String(s).trim().replace(/^act_/, '');
const normGaId  = (s = '') => String(s).trim().replace(/^customers\//, '').replace(/[^\d]/g, '');
const normGA4Id = (s = '') => {
  const raw = String(s || '').trim();
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits || raw.replace(/^properties\//, '').trim();
};

const uniq = (arr = []) => [...new Set((arr || []).filter(Boolean))];

function hasAnyMetaToken(metaDoc) {
  return !!(metaDoc?.access_token || metaDoc?.token || metaDoc?.accessToken || metaDoc?.longLivedToken || metaDoc?.longlivedToken);
}
function hasGoogleOAuth(gaDoc) {
  return !!(gaDoc?.refreshToken || gaDoc?.accessToken);
}

function metaAvailableIds(metaDoc) {
  const list = Array.isArray(metaDoc?.ad_accounts) ? metaDoc.ad_accounts
            : Array.isArray(metaDoc?.adAccounts)  ? metaDoc.adAccounts
            : [];
  return uniq(list.map(a => normActId(a?.id || a?.account_id || '')).filter(Boolean));
}

function googleAdsAvailableIds(gaDoc) {
  const fromAd = (Array.isArray(gaDoc?.ad_accounts) ? gaDoc.ad_accounts : [])
    .map(a => normGaId(a?.id))
    .filter(Boolean);
  const fromCu = (Array.isArray(gaDoc?.customers) ? gaDoc.customers : [])
    .map(c => normGaId(c?.id))
    .filter(Boolean);
  return uniq([...fromAd, ...fromCu]);
}

function ga4AvailableIds(gaDoc) {
  const props = Array.isArray(gaDoc?.gaProperties) ? gaDoc.gaProperties : [];
  const ids = props.map(p => normGA4Id(p?.propertyId || p?.property_id || p?.name || '')).filter(Boolean);
  return uniq(ids);
}

// Selecciones (doc > legacy user)
function selectedMetaIds(metaDoc, userDoc) {
  const fromDoc = Array.isArray(metaDoc?.selectedAccountIds) ? metaDoc.selectedAccountIds.map(normActId) : [];
  if (fromDoc.length) return uniq(fromDoc).slice(0, MAX_SELECT);
  const legacy = Array.isArray(userDoc?.selectedMetaAccounts) ? userDoc.selectedMetaAccounts.map(normActId) : [];
  return uniq(legacy).slice(0, MAX_SELECT);
}

function selectedGoogleAdsIds(gaDoc, userDoc) {
  const fromDoc = Array.isArray(gaDoc?.selectedCustomerIds) ? gaDoc.selectedCustomerIds.map(normGaId) : [];
  if (fromDoc.length) return uniq(fromDoc).slice(0, MAX_SELECT);
  const legacy = Array.isArray(userDoc?.selectedGoogleAccounts) ? userDoc.selectedGoogleAccounts.map(normGaId) : [];
  return uniq(legacy).slice(0, MAX_SELECT);
}

function selectedGA4Ids(gaDoc, userDoc) {
  const fromDoc = Array.isArray(gaDoc?.selectedPropertyIds) ? gaDoc.selectedPropertyIds.map(normGA4Id) : [];
  if (fromDoc.length) return uniq(fromDoc).slice(0, MAX_SELECT);

  const def = gaDoc?.defaultPropertyId ? normGA4Id(gaDoc.defaultPropertyId) : '';
  if (def) return [def];

  const legacy = Array.isArray(userDoc?.selectedGAProperties) ? userDoc.selectedGAProperties.map(normGA4Id) : [];
  return uniq(legacy).slice(0, MAX_SELECT);
}

function needsSelection(availableCount, selectedCount) {
  return availableCount > MAX_SELECT && selectedCount === 0;
}

/**
 * Detecta:
 * - connected: hay OAuth/token válido
 * - requiredSelection: hay >1 opción y no hay selección persistida
 * - ready: connected && !requiredSelection
 *
 * Nota: GA4 NO se detecta por scopes; se detecta por OAuth + gaProperties disponibles.
 */
async function getSourcesState(userId) {
  const [meta, google, shop, user] = await Promise.all([
    MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
      .select('access_token token accessToken longLivedToken longlivedToken ad_accounts adAccounts selectedAccountIds')
      .lean(),
    GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
      .select('refreshToken accessToken ad_accounts customers gaProperties selectedCustomerIds defaultCustomerId selectedPropertyIds defaultPropertyId')
      .lean(),
    ShopConnections.findOne({ $or: [{ user: userId }, { userId }] })
      .select('shop access_token accessToken')
      .lean(),
    User
      ? User.findById(userId).select('selectedMetaAccounts selectedGoogleAccounts selectedGAProperties').lean()
      : Promise.resolve(null),
  ]);

  // META
  const metaConnected = !!(meta && hasAnyMetaToken(meta));
  const metaAvail = meta ? metaAvailableIds(meta) : [];
  const metaSel  = meta ? selectedMetaIds(meta, user) : selectedMetaIds({}, user);
  const metaReq  = metaConnected && needsSelection(metaAvail.length, metaSel.length);

  // GOOGLE ADS
  const googleConnected = !!(google && hasGoogleOAuth(google));
  const gAdsAvail = google ? googleAdsAvailableIds(google) : [];
  const gAdsSel   = google ? selectedGoogleAdsIds(google, user) : selectedGoogleAdsIds({}, user);
  const gAdsReq   = googleConnected && needsSelection(gAdsAvail.length, gAdsSel.length);

  // GA4 (depende de OAuth + props disponibles)
  const ga4Avail = google ? ga4AvailableIds(google) : [];
  const ga4Connected = !!(googleConnected && ga4Avail.length > 0);
  const ga4Sel = google ? selectedGA4Ids(google, user) : selectedGA4Ids({}, user);
  const ga4Req = ga4Connected && needsSelection(ga4Avail.length, ga4Sel.length);

  // SHOPIFY
  const shopifyConnected = !!(shop && shop.shop && (shop.access_token || shop.accessToken));

  const state = {
    meta: {
      connected: metaConnected,
      requiredSelection: metaReq,
      ready: metaConnected && !metaReq,
      availableCount: metaAvail.length,
      selectedCount: metaSel.length,
      selected: metaSel,
    },
    google: {
      connected: googleConnected,
      requiredSelection: gAdsReq,
      ready: googleConnected && !gAdsReq,
      availableCount: gAdsAvail.length,
      selectedCount: gAdsSel.length,
      selected: gAdsSel,
    },
    ga4: {
      connected: ga4Connected,
      requiredSelection: ga4Req,
      ready: ga4Connected && !ga4Req,
      availableCount: ga4Avail.length,
      selectedCount: ga4Sel.length,
      selected: ga4Sel,
    },
    shopify: {
      connected: shopifyConnected,
      requiredSelection: false,
      ready: shopifyConnected,
      availableCount: shopifyConnected ? 1 : 0,
      selectedCount: shopifyConnected ? 1 : 0,
      selected: shopifyConnected ? ['shopify'] : [],
    },
  };

  return state;
}

/**
 * Devuelve tipos conectados “listos” para auditar.
 * Si están conectados pero falta selección, los dejamos como skipped con razón SELECTION_REQUIRED.
 */
async function detectReadySources(userId) {
  const state = await getSourcesState(userId);

  const typesReady = [];
  const skipped = {};

  for (const t of ['meta', 'google', 'ga4', 'shopify']) {
    const st = state[t];
    if (!st?.connected) {
      skipped[t] = 'NOT_CONNECTED';
      continue;
    }
    if (st.requiredSelection) {
      skipped[t] = 'SELECTION_REQUIRED';
      continue;
    }
    if (st.ready) {
      typesReady.push(t);
      continue;
    }
    skipped[t] = 'NOT_READY';
  }

  return { state, typesReady, skipped };
}

async function fetchLatestAuditSummary(userId, type) {
  const doc = await Audit.findOne({ userId, type })
    .sort({ generatedAt: -1 })
    .select('_id type generatedAt summary issues origin notifications')
    .lean();
  if (!doc) return null;
  return {
    id: String(doc._id),
    type: doc.type,
    generatedAt: doc.generatedAt,
    summary: doc.summary,
    issuesCount: Array.isArray(doc.issues) ? doc.issues.length : 0,
    origin: doc.origin || null,
    // ✅ útil para debug E2E email
    notifiedAt: doc?.notifications?.auditReadyEmailSentAt || null,
  };
}

async function fetchLatestAuditsByTypes(userId, types = []) {
  const wanted = (types || []).map((t) => normalizeType(t)).filter(Boolean);
  if (!wanted.length) return {};

  const docs = await Audit.find({ userId, type: { $in: wanted } })
    .sort({ generatedAt: -1 })
    .limit(50)
    .select('_id type generatedAt summary issues origin notifications')
    .lean();

  const out = {};
  for (const d of docs) {
    const t = String(d.type || '').toLowerCase();
    if (!out[t]) {
      out[t] = {
        id: String(d._id),
        type: t,
        generatedAt: d.generatedAt,
        summary: d.summary,
        issuesCount: Array.isArray(d.issues) ? d.issues.length : 0,
        origin: d.origin || null,
        notifiedAt: d?.notifications?.auditReadyEmailSentAt || null,
      };
    }
  }
  return out;
}

/* ============== job map (in-memory) ============== */
const jobs = new Map();
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ✅ idempotencia básica: evitar doble click que dispare dos jobs */
const LAST_START = new Map(); // userId -> { at:number, key:string }
const START_DEDUP_MS = Number(process.env.AUDIT_START_DEDUP_MS || 12_000);

function buildStartKey({ userId, source, types }) {
  const t = (types || []).slice().sort().join(',');
  return `${String(userId)}|${String(source || '')}|${t}`;
}

/* ===========================================================
 * POST /api/audits/:type/run
 * =========================================================*/
router.post('/:type/run', requireAuth, express.json(), async (req, res) => {
  try {
    const typeRaw = String(req.params.type || '').toLowerCase();
    if (!isValidType(typeRaw)) {
      return res.status(400).json({ ok: false, error: 'INVALID_TYPE' });
    }

    const type = normalizeType(typeRaw);
    const source = (req.body && req.body.source) || 'onboarding';

    const state = await getSourcesState(req.user._id);
    const st = state[type];

    if (!st?.connected) {
      return res.status(400).json({ ok: false, error: 'SOURCE_NOT_CONNECTED', type });
    }

    if (st.requiredSelection) {
      return res.status(409).json({
        ok: false,
        error: 'SELECTION_REQUIRED',
        type,
        detail: 'Debes seleccionar 1 cuenta/propiedad antes de generar la auditoría.',
        availableCount: st.availableCount,
        selectedCount: st.selectedCount,
      });
    }

    const ok = await runAuditFor({ userId: req.user._id, type, source });
    const latest = await fetchLatestAuditSummary(req.user._id, type);

    return res.json({ ok: !!ok, type, source, latestAudit: latest });
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
 * =========================================================*/
router.post('/start', requireAuth, express.json(), async (req, res) => {
  try {
    const source = (req.body && req.body.source) || 'panel';

    // ✅ Tipos listos (conectados y sin requerir selección)
    const { state, typesReady, skipped } = await detectReadySources(req.user._id);

    // 2) Qué pidió el frontend
    const rawTypes = Array.isArray(req.body?.types)
      ? req.body.types
          .map((t) => normalizeType(String(t)))
          .filter((t) => ['meta','google','shopify','ga4'].includes(t))
      : null;

    let types = [];
    const skippedByConnection = { ...skipped };

    if (req.body?.types === 'auto' || !rawTypes) {
      // Modo auto: SOLO los ready
      types = [...typesReady];
    } else {
      // Intersección: lo pedido vs lo que está listo
      for (const t of rawTypes) {
        if (typesReady.includes(t)) types.push(t);
        else if (!skippedByConnection[t]) skippedByConnection[t] = 'NOT_READY';
      }
    }

    if (!types.length) {
      return res.status(400).json({
        ok: false,
        error: 'NO_TYPES_READY',
        detail:
          'No hay integraciones listas para auditar. Si tienes varias cuentas/propiedades, selecciona cuál auditar.',
        skippedByConnection: skippedByConnection,
        state: {
          meta: state.meta,
          google: state.google,
          ga4: state.ga4,
          shopify: state.shopify,
        },
      });
    }

    // ✅ idempotencia (anti doble-click)
    const key = buildStartKey({ userId: req.user._id, source, types });
    const prev = LAST_START.get(String(req.user._id));
    const now = Date.now();

    if (prev && prev.key === key && (now - prev.at) < START_DEDUP_MS) {
      return res.json({
        ok: true,
        deduped: true,
        jobId: prev.jobId,
        types,
        source,
        skippedByConnection,
      });
    }

    const jobId = newId();
    LAST_START.set(String(req.user._id), { at: now, key, jobId });

    const stateJob = {
      id: jobId,
      userId: req.user._id,
      startedAt: Date.now(),
      source,
      items: {},
      types: [...types],
    };

    for (const t of types) {
      stateJob.items[t] = {
        status: 'pending',
        ok: null,
        error: null,
        source,
      };
    }

    jobs.set(jobId, stateJob);

    res.json({
      ok: true,
      jobId,
      types,
      source,
      skippedByConnection,
    });

    setImmediate(async () => {
      for (const t of types) {
        stateJob.items[t].status = 'running';
        try {
          const ok = await runAuditFor({ userId: req.user._id, type: t, source });
          stateJob.items[t].status = 'done';
          stateJob.items[t].ok = !!ok;
        } catch (e) {
          stateJob.items[t].status = 'done';
          stateJob.items[t].ok = false;
          stateJob.items[t].error = e?.message || String(e);
        }
      }
      stateJob.finishedAt = Date.now();
    });
  } catch (e) {
    console.error('audits/start error:', e);
    return res.status(500).json({ ok: false, error: 'START_ERROR' });
  }
});

/* ===========================================================
 * GET /api/audits/progress?jobId=...
 * =========================================================*/
router.get('/progress', requireAuth, async (req, res) => {
  const jobId = String(req.query.jobId || '');
  const s = jobs.get(jobId);
  if (!s) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });

  const items = s.items;
  const total = Object.keys(items).length || 1;
  const done = Object.values(items).filter((x) => x.status === 'done').length;

  let percent = Math.round((done / total) * 90);

  let latestAudits = null;

  if (done === total) {
    percent = 95;

    const query = {
      userId: s.userId,
      generatedAt: { $gte: new Date(s.startedAt - 10 * 60 * 1000) }, // -10 min
      type: { $in: Object.keys(items) },
    };
    if (s.source) query.origin = s.source;

    const docs = await Audit.find(query).select('type generatedAt origin').lean();

    const have = new Set((docs || []).map((d) => d.type));
    const allPersisted = Object.keys(items).every((t) => have.has(t));
    percent = allPersisted ? 100 : 97;

    if (allPersisted) {
      s.finishedAt = Date.now();
      // ✅ traer resumen final para el front
      latestAudits = await fetchLatestAuditsByTypes(s.userId, Object.keys(items));
    }
  }

  res.json({
    ok: true,
    jobId,
    source: s.source || null,
    items,
    percent,
    finished: percent >= 100,
    latestAudits, // ✅ null hasta 100%
  });
});

/* ===========================================================
 * GET /api/audits/latest?type=all|google|meta|ga4|shopify&origin=onboarding|panel
 * =========================================================*/
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const typeQ = String(req.query.type || 'all').toLowerCase();
    const originQ = req.query.origin ? String(req.query.origin) : null;

    const wantedTypes =
      typeQ === 'all'
        ? ['google', 'meta', 'ga4', 'shopify']
        : [typeQ];

    const allowed = new Set(['google', 'meta', 'ga4', 'shopify', 'all']);
    if (!allowed.has(typeQ)) {
      return res.status(400).json({ ok: false, error: 'INVALID_TYPE' });
    }

    const query = {
      userId: req.user._id,
      type: { $in: wantedTypes },
    };
    if (originQ) query.origin = originQ;

    const docs = await Audit.find(query)
      .sort({ generatedAt: -1 })
      .limit(50)
      .select('type generatedAt summary issues inputSnapshot origin notifications')
      .lean();

    const data = {};
    for (const d of docs) {
      const t = String(d.type || '').toLowerCase();
      if (!data[t]) data[t] = d;
    }

    return res.json({
      ok: true,
      data,
      items: Object.values(data),
    });
  } catch (e) {
    console.error('audits/latest error:', e);
    return res.status(500).json({ ok: false, error: 'LATEST_ERROR' });
  }
});

module.exports = router;
