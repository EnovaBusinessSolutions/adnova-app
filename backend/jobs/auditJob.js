// backend/jobs/auditJob.js
'use strict';

const Audit = require('../models/Audit');
const User  = require('../models/User');

const { collectGoogle } = require('./collect/googleCollector');
const { collectMeta }   = require('./collect/metaCollector');
const { collectShopify }= require('./collect/shopifyCollector');
const generateAudit = require('./llm/generateAudit');

/* ---------- helpers de normalización ---------- */
const normMeta   = (s='') => String(s).trim().replace(/^act_/, '');
const normGoogle = (s='') => String(s).trim().replace(/^customers\//, '').replace(/-/g, '');

/* ---------- presencia de datos ---------- */
const hasAdsData = (snap) => Array.isArray(snap?.byCampaign) && snap.byCampaign.length > 0;
const hasGAData  = (snap) => Array.isArray(snap?.channels)   && snap.channels.length > 0;

/* ---------- util: recomputar KPIs Google tras filtrar ---------- */
function recomputeGoogle(snapshot) {
  const safeDiv = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);
  const G = (snapshot.byCampaign || []).reduce((a, c) => {
    a.impr += Number(c?.kpis?.impressions || 0);
    a.clk  += Number(c?.kpis?.clicks || 0);
    a.cost += Number(c?.kpis?.cost || 0);
    a.conv += Number(c?.kpis?.conversions || 0);
    a.val  += Number(c?.kpis?.conv_value || 0);
    return a;
  }, { impr:0, clk:0, cost:0, conv:0, val:0 });

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
    roas: safeDiv(G.val, G.cost),
  };
}

/* ---------- util: filtrar snapshot por cuentas permitidas ---------- */
function filterSnapshot(type, snapshot, allowedIds = []) {
  if (!snapshot || !Array.isArray(allowedIds) || allowedIds.length === 0) return snapshot;

  const allow = new Set(allowedIds.map(id => type === 'meta' ? normMeta(id) : normGoogle(id)));

  const byCampaign = (snapshot.byCampaign || []).filter(c =>
    allow.has(type === 'meta' ? normMeta(c.account_id) : normGoogle(c.account_id))
  );
  const accounts   = (snapshot.accounts || []).filter(a =>
    allow.has(type === 'meta' ? normMeta(a.id) : normGoogle(a.id))
  );
  const accountIds = (snapshot.accountIds || []).filter(id =>
    allow.has(type === 'meta' ? normMeta(id) : normGoogle(id))
  );

  let kpis = snapshot.kpis || {};
  if (type === 'google') kpis = recomputeGoogle({ ...snapshot, byCampaign });
  if (type === 'meta')   kpis = recomputeMeta({ ...snapshot, byCampaign });

  const series = Array.isArray(snapshot.series) ? snapshot.series : undefined;

  return { ...snapshot, byCampaign, accounts, accountIds, kpis, series };
}

/* ---------- regla: selección obligatoria si >3 cuentas ---------- */
const mustRequireSelection = (totalAccounts, selectedCount) => totalAccounts > 3 && selectedCount === 0;

/* ---------- mapear reason → issue setup claro ---------- */
function reasonToSetupIssue(type, snapshot, customTitle) {
  const reason = String(snapshot?.reason || 'UNKNOWN').toUpperCase();

  const extras = [];
  if (type === 'google') {
    if (reason.includes('SELECTION_REQUIRED')) extras.push('Más de 3 cuentas sin selección.');
    if (reason.includes('MISSING_DEVELOPER_TOKEN')) extras.push('Falta GOOGLE_ADS_DEVELOPER_TOKEN.');
    if (reason.includes('NO_ACCESS_TOKEN')) extras.push('Token inválido/expirado; no se pudo refrescar.');
    if (reason.includes('ACCOUNT_NOT_ALLOWED')) extras.push('La cuenta solicitada no está en la selección permitida.');
    if (reason.includes('PERMISSION')) extras.push('Permisos insuficientes en Google Ads.');
  } else if (type === 'meta') {
    if (reason.includes('SELECTION_REQUIRED')) extras.push('Más de 3 cuentas sin selección.');
    if (reason.includes('META_NOT_CONNECTED')) extras.push('No hay token de Meta conectado.');
    if (reason.includes('NO_AD_ACCOUNT')) extras.push('No hay cuenta publicitaria por defecto.');
    if (reason.includes('META_INSIGHTS_ERROR')) extras.push('Error al leer insights (token/permisos).');
    if (reason.includes('ACCOUNT_NOT_ALLOWED')) extras.push('Cuenta fuera de la selección permitida.');
  } else if (type === 'ga' || type === 'ga4') {
    if (reason.includes('NO_REFRESH_TOKEN')) extras.push('Falta refresh token de GA4.');
    if (reason.includes('MISSING_SCOPE')) extras.push('Falta scope analytics.readonly.');
    if (reason.includes('NO_DEFAULT_PROPERTY')) extras.push('No hay propiedad por defecto.');
    if (reason.includes('PERMISSION')) extras.push('Permisos insuficientes para la propiedad.');
  }

  const extraStr = extras.length ? ` | ${extras.join(' | ')}` : '';
  return {
    id: 'setup_incompleto',
    area: 'setup',
    severity: 'alta',
    title: customTitle || 'Permisos insuficientes o configuración incompleta',
    evidence: `reason: ${reason}${extraStr}`,
    recommendation:
      type === 'google'
        ? 'Ve a Conexiones → Google. Vincula developer token, otorga el scope adwords y selecciona una cuenta por defecto.'
        : type === 'meta'
          ? 'Ve a Conexiones → Meta. Vuelve a conectar (ads_read/ads_management) y selecciona una cuenta por defecto.'
          : 'Ve a Conexiones → Google Analytics. Otorga analytics.readonly y selecciona una propiedad por defecto.'
  };
}

async function persistSetupAudit({ userId, type, snapshot, title }) {
  const issue = reasonToSetupIssue(type, snapshot, title);
  await Audit.create({
    userId,
    type,
    generatedAt: new Date(),
    summary: 'No se pudo generar la auditoría: configuración o permisos pendientes.',
    issues: [issue],
    actionCenter: [{
      id: 'fix_setup',
      title: issue.title,
      description: issue.recommendation,
      severity: 'high'
    }],
    inputSnapshot: snapshot || {},
    version: 'audits@1.0.0'
  });
}

/* ---------- main ---------- */
async function runAuditFor({ userId, type }) {
  try {
    const user = await User.findById(userId).lean();
    const selectedGoogle = (user?.selectedGoogleAccounts || []).map(normGoogle);
    const selectedMeta   = (user?.selectedMetaAccounts   || []).map(normMeta);

    let snapshot = null;

    if (type === 'google') {
      const raw = await collectGoogle(userId);
      const total = (raw?.accountIds || []).length;

      if (mustRequireSelection(total, selectedGoogle.length)) {
        await persistSetupAudit({
          userId, type,
          snapshot: { ...(raw || {}), reason: 'SELECTION_REQUIRED(>3_ACCOUNTS)' },
          title: 'Selecciona qué cuentas de Google Ads auditar'
        });
        return true;
      }

      snapshot = selectedGoogle.length ? filterSnapshot('google', raw, selectedGoogle) : raw;
    }

    if (type === 'meta') {
      const raw = await collectMeta(userId);
      const total =
        (Array.isArray(raw?.accountIds) && raw.accountIds.length) ||
        (Array.isArray(raw?.accounts) && raw.accounts.length) || 0;

      if (mustRequireSelection(total, selectedMeta.length)) {
        await persistSetupAudit({
          userId, type,
          snapshot: { ...(raw || {}), reason: 'SELECTION_REQUIRED(>3_ACCOUNTS)' },
          title: 'Selecciona qué cuentas de Meta Ads auditar'
        });
        return true;
      }

      snapshot = selectedMeta.length ? filterSnapshot('meta', raw, selectedMeta) : raw;
    }

    if (type === 'shopify') {
      snapshot = await collectShopify(userId);
    }

    if (!snapshot) throw new Error('SNAPSHOT_EMPTY');

    // ---- Casos de setup / sin datos: crear auditoría de setup y salir
    const noData =
      (type === 'google' || type === 'meta') ? !hasAdsData(snapshot) :
      (type === 'ga' || type === 'ga4') ? !hasGAData(snapshot) : false;

    if (snapshot.notAuthorized || noData) {
      await persistSetupAudit({ userId, type, snapshot });
      return true;
    }

    // ---- Hay datos: generar con LLM
    const auditJson = await generateAudit({ type, inputSnapshot: snapshot });

    await Audit.create({
      userId,
      type,
      generatedAt: new Date(),
      summary: auditJson?.summary || 'Auditoría generada',
      issues: Array.isArray(auditJson?.issues) ? auditJson.issues : [],
      actionCenter: auditJson?.actionCenter || (auditJson?.issues || []).slice(0, 3),
      topProducts: auditJson?.topProducts || [],
      inputSnapshot: snapshot,
      version: 'audits@1.0.0',
    });

    return true;
  } catch (e) {
    await Audit.create({
      userId,
      type,
      generatedAt: new Date(),
      summary: 'No se pudo generar la auditoría',
      issues: [{
        id: 'setup_incompleto',
        area: 'setup',
        severity: 'alta',
        title: 'Faltan datos o permisos',
        evidence: String(e?.message || e),
        recommendation:
          'Verifica la conexión y permisos. Si tienes más de 3 cuentas, selecciona cuáles auditar en el onboarding o en ajustes.',
      }],
      actionCenter: [],
      inputSnapshot: {},
      version: 'audits@1.0.0',
    });
    return false;
  }
}

module.exports = { runAuditFor };
