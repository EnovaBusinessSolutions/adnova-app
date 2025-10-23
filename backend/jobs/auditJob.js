// backend/jobs/auditJob.js
'use strict';

const Audit = require('../models/Audit');
const User  = require('../models/User');

const { collectGoogle } = require('./collect/googleCollector');
const { collectMeta }   = require('./collect/metaCollector');
const { collectShopify }= require('./collect/shopifyCollector');
const { generateAudit } = require('./llm/generateAudit');

/* ---------- helpers de normalización ---------- */
const normMeta   = (s='') => String(s).trim().replace(/^act_/, '');
const normGoogle = (s='') => String(s).trim().replace(/^customers\//, '').replace(/-/g, '');

/* ---------- util: recomputar KPIs Google tras filtrar ---------- */
function recomputeGoogle(snapshot) {
  const safeDiv = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);

  // Acumular KPIs globales
  const G = (snapshot.byCampaign || []).reduce((a, c) => {
    a.impr += Number(c?.kpis?.impressions || 0);
    a.clk  += Number(c?.kpis?.clicks || 0);
    a.cost += Number(c?.kpis?.cost || 0);
    a.conv += Number(c?.kpis?.conversions || 0);
    a.val  += Number(c?.kpis?.conv_value || 0);
    return a;
  }, { impr:0, clk:0, cost:0, conv:0, val:0 });

  // Reagregar la serie por fecha (si existe)
  const map = new Map();
  for (const r of snapshot.byCampaign || []) {
    const since = r?.period?.since;
    const until = r?.period?.until;
    // si no hay series por cuenta, usamos la ventana global y omitimos
    // (el collector original ya trae snapshot.series — pero al filtrar podemos recalcular)
  }
  // Si ya teníamos series, recalcúlala desde campañas
  if (Array.isArray(snapshot.series)) {
    const sMap = new Map();
    for (const c of snapshot.byCampaign || []) {
      // No hay fecha por fila, así que usamos la serie existente como base cuando exista
      // Si no hay series, dejamos snapshot.series como estaba (o vacía)
    }
    // Si quieres forzar 0, deja así; si prefieres conservar la serie original, no la toques
  }

  return {
    impressions: G.impr,
    clicks:      G.clk,
    cost:        G.cost,
    conversions: G.conv,
    conv_value:  G.val,
    ctr: safeDiv(G.clk, G.impr) * 100,
    cpc: safeDiv(G.cost, G.clk),
    cpa: safeDiv(G.cost, G.conv),
    roas: safeDiv(G.val, G.cost),
  };
}

/* ---------- util: recomputar KPIs Meta tras filtrar ---------- */
function recomputeMeta(snapshot) {
  const safeDiv = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);
  const G = (snapshot.byCampaign || []).reduce((a, c) => {
    a.impr += Number(c?.kpis?.impressions || 0);
    a.clk  += Number(c?.kpis?.clicks || 0);
    a.cost += Number(c?.kpis?.spend || 0);
    a.val  += Number(c?.kpis?.purchase_value || c?.kpis?.conv_value || 0);
    return a;
  }, { impr:0, clk:0, cost:0, val:0 });

  return {
    impressions: G.impr,
    clicks:      G.clk,
    cost:        G.cost,
    cpc: safeDiv(G.cost, G.clk),
    // roas aproximado si existe purchase_value en campañas
    roas: safeDiv(G.val, G.cost),
  };
}

/* ---------- util: filtrar snapshot por cuentas permitidas ---------- */
function filterSnapshot(type, snapshot, allowedIds = []) {
  if (!snapshot || !Array.isArray(allowedIds) || allowedIds.length === 0) return snapshot;

  const allow = new Set(allowedIds.map(id => type === 'meta' ? normMeta(id) : normGoogle(id)));

  // Filtrar byCampaign
  const byCampaign = (snapshot.byCampaign || []).filter(c =>
    allow.has(type === 'meta' ? normMeta(c.account_id) : normGoogle(c.account_id))
  );

  // Filtrar accounts y accountIds
  const accounts   = (snapshot.accounts || []).filter(a =>
    allow.has(type === 'meta' ? normMeta(a.id) : normGoogle(a.id))
  );
  const accountIds = (snapshot.accountIds || []).filter(id =>
    allow.has(type === 'meta' ? normMeta(id) : normGoogle(id))
  );

  // Recalcular KPIs globales
  let kpis = snapshot.kpis || {};
  if (type === 'google') kpis = recomputeGoogle({ ...snapshot, byCampaign });
  if (type === 'meta')   kpis = recomputeMeta({ ...snapshot, byCampaign });

  // Serie (Google ya la trae). Si quieres recalcularla 100%, aquí podrías
  // volver a agregar por fecha; conservamos la original si existe.
  const series = Array.isArray(snapshot.series)
    ? snapshot.series // mantener tal cual (o recalcular si tienes fecha por campaña)
    : undefined;

  return {
    ...snapshot,
    byCampaign,
    accounts,
    accountIds,
    kpis,
    series,
  };
}

/* ---------- regla: si hay >3 cuentas y no hay selección, NO auditar ---------- */
function mustRequireSelection(totalAccounts, selectedCount) {
  return totalAccounts > 3 && selectedCount === 0;
}

async function runAuditFor({ userId, type }) {
  try {
    // Trae selección del usuario
    const user = await User.findById(userId).lean();
    const selectedGoogle = (user?.selectedGoogleAccounts || []).map(normGoogle);
    const selectedMeta   = (user?.selectedMetaAccounts   || []).map(normMeta);

    let inputSnapshot = null;

    if (type === 'google') {
      const raw = await collectGoogle(userId);      // snapshot original
      const total = (raw?.accountIds || []).length;

      if (mustRequireSelection(total, selectedGoogle.length)) {
        throw new Error('SELECCION_REQUERIDA_GOOGLE: Tienes más de 3 cuentas. Elige cuáles auditar.');
      }

      inputSnapshot = selectedGoogle.length
        ? filterSnapshot('google', raw, selectedGoogle)
        : raw;
    }

    if (type === 'meta') {
      const raw = await collectMeta(userId);        // snapshot original
      const total = (raw?.accountIds || raw?.accounts || []).length
        || (raw?.accounts ? raw.accounts.length : 0);

      if (mustRequireSelection(total, selectedMeta.length)) {
        throw new Error('SELECCION_REQUERIDA_META: Tienes más de 3 cuentas. Elige cuáles auditar.');
      }

      inputSnapshot = selectedMeta.length
        ? filterSnapshot('meta', raw, selectedMeta)
        : raw;
    }

    if (type === 'shopify') {
      inputSnapshot = await collectShopify(userId);
    }

    if (!inputSnapshot) throw new Error('SNAPSHOT_EMPTY');

    const auditJson = await generateAudit({ type, inputSnapshot });

    const auditDoc = {
      userId,
      type,
      generatedAt: new Date(),
      summary: auditJson?.summary || 'Auditoría generada',
      issues: auditJson?.issues || [],
      actionCenter: auditJson?.actionCenter || (auditJson?.issues || []).slice(0, 3),
      topProducts: auditJson?.topProducts || [],
      inputSnapshot,
      version: 'audits@1.0.0',
    };

    await Audit.create(auditDoc);
    return true;
  } catch (e) {
    await Audit.create({
      userId,
      type,
      generatedAt: new Date(),
      summary: 'No se pudo generar la auditoría',
      issues: [
        {
          id: 'setup_incompleto',
          area: 'setup',
          severity: 'alta',
          title: 'Faltan datos o permisos',
          evidence: String(e.message || e),
          recommendation:
            'Verifica la conexión y permisos. Si tienes más de 3 cuentas, selecciona cuáles auditar en el onboarding o en ajustes.',
        },
      ],
      actionCenter: [],
      inputSnapshot: {},
      version: 'audits@1.0.0',
    });
    return false;
  }
}

module.exports = { runAuditFor };
