// backend/jobs/auditJob.js
'use strict';

const Audit = require('../models/Audit');
const User  = require('../models/User');

const { collectGoogle }  = require('./collect/googleCollector');
const { collectMeta }    = require('./collect/metaCollector');
const { collectShopify } = require('./collect/shopifyCollector');
const generateAudit = require('./llm/generateAudit');

/* ---------- normalizadores ---------- */
const normMeta   = (s='') => String(s).trim().replace(/^act_/, '');
const normGoogle = (s='') => String(s).trim().replace(/^customers\//, '').replace(/-/g, '');

/* ---------- util: recomputar KPIs tras filtrar ---------- */
function recomputeFromCampaigns(snapshot, { platform }) {
  const safeDiv = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);
  const sum = (snapshot.byCampaign || []).reduce((acc, c) => {
    const k = c.kpis || {};
    acc.impr += Number(k.impressions || 0);
    acc.clk  += Number(k.clicks || 0);
    if (platform === 'google') {
      acc.cost += Number(k.cost || 0);
      acc.conv += Number(k.conversions || 0);
      acc.val  += Number(k.conv_value || 0);
    } else {
      acc.cost += Number(k.spend || 0);
      acc.val  += Number(k.purchase_value || k.conv_value || 0);
    }
    return acc;
  }, { impr:0, clk:0, cost:0, conv:0, val:0 });

  if (platform === 'google') {
    return {
      impressions: sum.impr,
      clicks:      sum.clk,
      cost:        sum.cost,
      conversions: sum.conv,
      conv_value:  sum.val,
      ctr:  safeDiv(sum.clk, sum.impr) * 100,
      cpc:  safeDiv(sum.cost, sum.clk),
      cpa:  safeDiv(sum.cost, sum.conv),
      roas: safeDiv(sum.val, sum.cost),
    };
  }
  return {
    impressions: sum.impr,
    clicks:      sum.clk,
    cost:        sum.cost,
    cpc:  safeDiv(sum.cost, sum.clk),
    roas: safeDiv(sum.val, sum.cost),
  };
}

/* ---------- util: filtrar snapshot por cuentas permitidas ---------- */
function filterSnapshot(type, snapshot, allowedIds = []) {
  if (!snapshot || !Array.isArray(allowedIds) || allowedIds.length === 0) return snapshot;
  const norm = type === 'meta' ? normMeta : normGoogle;
  const allow = new Set(allowedIds.map(norm));

  const byCampaign = (snapshot.byCampaign || []).filter(c => allow.has(norm(c.account_id)));
  const accounts   = (snapshot.accounts   || []).filter(a => allow.has(norm(a.id)));
  const accountIds = (snapshot.accountIds || []).filter(id => allow.has(norm(id)));

  const platform = type === 'google' ? 'google' : 'meta';
  const kpis = recomputeFromCampaigns({ ...snapshot, byCampaign }, { platform });

  return { ...snapshot, byCampaign, accounts, accountIds, kpis };
}

/* ---------- util: IDs únicos en snapshot ---------- */
function uniqueAccountIds(snapshot, type) {
  const norm = type === 'meta' ? normMeta : normGoogle;
  const set = new Set();
  (snapshot?.accountIds || []).forEach(id => set.add(norm(id)));
  (snapshot?.accounts   || []).forEach(a  => set.add(norm(a.id)));
  (snapshot?.byCampaign || []).forEach(c  => set.add(norm(c.account_id)));
  return Array.from(set);
}

/* ---------- util: top N cuentas por gasto ---------- */
function topAccountsBySpend(snapshot, type, limit = 3) {
  const norm = type === 'meta' ? normMeta : normGoogle;
  const spendKey = type === 'meta' ? 'spend' : 'cost';
  const map = new Map();
  for (const c of snapshot.byCampaign || []) {
    const id = norm(c.account_id || '');
    if (!id) continue;
    const k = c.kpis || {};
    map.set(id, (map.get(id) || 0) + Number(k[spendKey] || 0));
  }
  const ranked = Array.from(map.entries()).sort((a,b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  return ranked.length ? ranked : uniqueAccountIds(snapshot, type).slice(0, limit);
}

/* ---------- auditor ---------- */
async function runAuditFor({ userId, type }) {
  try {
    const user = await User.findById(userId).lean();
    const selectedGoogle = (user?.selectedGoogleAccounts || []).map(normGoogle);
    const selectedMeta   = (user?.selectedMetaAccounts   || []).map(normMeta);

    let inputSnapshot = null;
    const setupIssues = [];

    if (type === 'google') {
      const raw = await collectGoogle(userId);
      if (!raw) throw new Error('SNAPSHOT_EMPTY_GOOGLE');
      if (raw.notAuthorized) {
        setupIssues.push({
          id: 'ga_not_authorized',
          area: 'setup', severity: 'alta',
          title: 'Google Ads no autorizado',
          evidence: String(raw.reason || 'Falta permiso o token'),
          recommendation: 'Vuelve a conectar Google Ads y otorga permisos. Selecciona una cuenta por defecto si es necesario.',
          estimatedImpact: 'alto'
        });
      }
      const allIds = uniqueAccountIds(raw, 'google');
      const haveSelection = selectedGoogle.length > 0;

      if (allIds.length > 3 && !haveSelection) {
        const auto = topAccountsBySpend(raw, 'google', 3);
        inputSnapshot = filterSnapshot('google', raw, auto);
        setupIssues.push({
          id: 'auto_sample_google_top3',
          area: 'setup', severity: 'media',
          title: 'Se auditaron las 3 cuentas con mayor gasto (Google)',
          evidence: `Cuentas totales: ${allIds.length}. Muestra: ${auto.join(', ')}`,
          recommendation: 'En Conexiones → Google elige las cuentas exactas a auditar.',
          estimatedImpact: 'medio'
        });
      } else {
        inputSnapshot = haveSelection ? filterSnapshot('google', raw, selectedGoogle) : raw;
      }
    }

    if (type === 'meta') {
      const raw = await collectMeta(userId);
      if (!raw) throw new Error('SNAPSHOT_EMPTY_META');
      if (raw.notAuthorized) {
        setupIssues.push({
          id: 'meta_not_authorized',
          area: 'setup', severity: 'alta',
          title: 'Meta Ads no autorizado',
          evidence: String(raw.reason || 'Falta permiso o token'),
          recommendation: 'Vuelve a conectar Meta y acepta ads_read/ads_management.',
          estimatedImpact: 'alto'
        });
      }
      const allIds = uniqueAccountIds(raw, 'meta');
      const haveSelection = selectedMeta.length > 0;

      if (allIds.length > 3 && !haveSelection) {
        const auto = topAccountsBySpend(raw, 'meta', 3);
        inputSnapshot = filterSnapshot('meta', raw, auto);
        setupIssues.push({
          id: 'auto_sample_meta_top3',
          area: 'setup', severity: 'media',
          title: 'Se auditaron las 3 cuentas con mayor gasto (Meta)',
          evidence: `Cuentas totales: ${allIds.length}. Muestra: ${auto.map(a=>`act_${a}`).join(', ')}`,
          recommendation: 'En Conexiones → Meta selecciona las cuentas a auditar.',
          estimatedImpact: 'medio'
        });
      } else {
        inputSnapshot = haveSelection ? filterSnapshot('meta', raw, selectedMeta) : raw;
      }
    }

    if (type === 'shopify') {
      inputSnapshot = await collectShopify(userId);
    }

    if (!inputSnapshot) throw new Error('SNAPSHOT_EMPTY');

    // Si no hay datos reales, guarda auditoría de setup y termina
    const noAdsData  = Array.isArray(inputSnapshot.byCampaign) && inputSnapshot.byCampaign.length === 0;
    const noGAData   = Array.isArray(inputSnapshot.channels)   && inputSnapshot.channels.length === 0;
    const isGA       = type === 'ga' || type === 'ga4';
    if ((isGA && noGAData) || (!isGA && noAdsData)) {
      await Audit.create({
        userId, type, generatedAt: new Date(),
        summary: 'No hay datos suficientes para analizar',
        issues: setupIssues.length ? setupIssues : [{
          id: 'no_data',
          area: 'setup', severity: 'media',
          title: 'Sin datos en el periodo',
          evidence: 'No se encontraron campañas/canales con actividad.',
          recommendation: 'Asegura que hay campañas activas y eventos/objetivos configurados.',
          estimatedImpact: 'medio'
        }],
        actionCenter: (setupIssues.length ? setupIssues : []).slice(0,3),
        inputSnapshot,
        version: 'audits@1.0.0',
      });
      return true;
    }

    // Auditoría vía LLM
    const auditJson = await generateAudit({ type, inputSnapshot });

    const mergedIssues = [
      ...setupIssues,
      ...(Array.isArray(auditJson?.issues) ? auditJson.issues : [])
    ];

    await Audit.create({
      userId,
      type,
      generatedAt: new Date(),
      summary: auditJson?.summary || (setupIssues[0]?.title || 'Auditoría generada'),
      issues: mergedIssues,
      actionCenter: mergedIssues.slice(0, 3),
      topProducts: auditJson?.topProducts || [],
      inputSnapshot,
      version: 'audits@1.0.0',
    });

    return true;
  } catch (e) {
    await Audit.create({
      userId, type, generatedAt: new Date(),
      summary: 'No se pudo generar la auditoría',
      issues: [{
        id: 'setup_incompleto',
        area: 'setup', severity: 'alta',
        title: 'Faltan datos o permisos',
        evidence: String(e.message || e),
        recommendation: 'Revisa conexión/permisos. Si tienes varias cuentas, selecciona las que quieres auditar.',
        estimatedImpact: 'alto'
      }],
      actionCenter: [],
      inputSnapshot: {},
      version: 'audits@1.0.0',
    });
    return false;
  }
}

module.exports = { runAuditFor };
