// backend/jobs/auditJob.js
'use strict';

const Audit = require('../models/Audit');
const User  = require('../models/User');

// <<< NUEVO: preferir selección desde los conectores >>>
const MetaAccount    = require('../models/MetaAccount');
const GoogleAccount  = require('../models/GoogleAccount');

const { collectGoogle } = require('./collect/googleCollector');
const { collectMeta }   = require('./collect/metaCollector');
const { collectShopify }= require('./collect/shopifyCollector');
const generateAudit     = require('./llm/generateAudit');

/* ---------- normalizadores ---------- */
const normMeta   = (s='') => String(s).trim().replace(/^act_/, '');
const normGoogle = (s='') => String(s).trim().replace(/^customers\//,'').replace(/-/g,'');

/* ---------- helpers kpis tras filtro ---------- */
const safeDiv = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);

function recomputeGoogle(snapshot) {
  const G = (snapshot.byCampaign || []).reduce((a,c)=>({
    impr: a.impr + Number(c?.kpis?.impressions||0),
    clk:  a.clk  + Number(c?.kpis?.clicks||0),
    cost: a.cost + Number(c?.kpis?.cost||0),
    conv: a.conv + Number(c?.kpis?.conversions||0),
    val:  a.val  + Number(c?.kpis?.conv_value||0),
  }), { impr:0,clk:0,cost:0,conv:0,val:0 });

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

function recomputeMeta(snapshot) {
  const G = (snapshot.byCampaign || []).reduce((a,c)=>({
    impr: a.impr + Number(c?.kpis?.impressions||0),
    clk:  a.clk  + Number(c?.kpis?.clicks||0),
    cost: a.cost + Number(c?.kpis?.spend||0),
    val:  a.val  + Number(c?.kpis?.purchase_value || c?.kpis?.conv_value || 0),
  }), { impr:0,clk:0,cost:0,val:0 });

  return {
    impressions: G.impr,
    clicks:      G.clk,
    cost:        G.cost,
    cpc: safeDiv(G.cost, G.clk),
    roas: safeDiv(G.val, G.cost),
  };
}

/* ---------- util: filtrar snapshot por cuentas ---------- */
function filterSnapshot(type, snapshot, allowedIds = []) {
  if (!snapshot || !Array.isArray(allowedIds) || allowedIds.length === 0) return snapshot;

  const norm = type === 'meta' ? normMeta : normGoogle;
  const allow = new Set(allowedIds.map(norm));

  const byCampaign = (snapshot.byCampaign || []).filter(c => allow.has(norm(c.account_id)));
  const accounts   = (snapshot.accounts || []).filter(a => allow.has(norm(a.id)));
  const accountIds = (snapshot.accountIds || []).filter(id => allow.has(norm(id)));

  let kpis = snapshot.kpis || {};
  if (type === 'google') kpis = recomputeGoogle({ ...snapshot, byCampaign });
  if (type === 'meta')   kpis = recomputeMeta({ ...snapshot, byCampaign });

  return { ...snapshot, byCampaign, accounts, accountIds, kpis };
}

/* ---------- escoger subconjunto seguro si no hay selección ---------- */
function autoPickIds(type, snapshot, max = 3) {
  const norm = type === 'meta' ? normMeta : normGoogle;

  const idsFromArray = (arr=[]) => arr
    .map(x => (typeof x === 'string' ? x : x?.id))
    .map(norm).filter(Boolean);

  const ids = new Set();
  const def = norm(snapshot?.defaultAccountId || '');

  if (def) ids.add(def);

  // intenta de accountIds primero
  for (const id of idsFromArray(snapshot?.accountIds || [])) {
    if (ids.size >= max) break; ids.add(id);
  }
  // luego de accounts
  for (const id of idsFromArray(snapshot?.accounts || [])) {
    if (ids.size >= max) break; ids.add(id);
  }
  // como último recurso: por campañas (account_id)
  for (const c of (snapshot.byCampaign || [])) {
    if (ids.size >= max) break;
    const id = norm(c.account_id || '');
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/* ---------- MAIN ---------- */
async function runAuditFor({ userId, type }) {
  try {
    // Cargamos usuario (fallback legacy) y, NUEVO, los conectores para preferir su selección
    const user = await User.findById(userId)
      .select('selectedGoogleAccounts selectedMetaAccounts')
      .lean();

    const [metaDoc, googleDoc] = await Promise.all([
      MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
        .select('selectedAccountIds')
        .lean(),
      GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
        .select('selectedCustomerIds')
        .lean(),
    ]);

    // Preferir campos del conector; caer a los del User si vienen vacíos
    const selMeta = (Array.isArray(metaDoc?.selectedAccountIds) && metaDoc.selectedAccountIds.length
                      ? metaDoc.selectedAccountIds
                      : (user?.selectedMetaAccounts || [])
                    ).map(normMeta);

    const selGoogle = (Array.isArray(googleDoc?.selectedCustomerIds) && googleDoc.selectedCustomerIds.length
                        ? googleDoc.selectedCustomerIds
                        : (user?.selectedGoogleAccounts || [])
                      ).map(normGoogle);

    let raw = null;
    let snapshot = null;
    let selectionNote = null;

    if (type === 'google') {
      raw = await collectGoogle(userId);

      const total = (raw?.accountIds && raw.accountIds.length) ||
                    (raw?.accounts && raw.accounts.length) || 0;

      if (selGoogle.length) {
        snapshot = filterSnapshot('google', raw, selGoogle);
      } else if (total > 3) {
        // soft-gate: limitar a subconjunto y continuar
        const picked = autoPickIds('google', raw, 3);
        snapshot = filterSnapshot('google', raw, picked);
        selectionNote = {
          title: 'Auditoría limitada a 3 cuentas',
          area: 'setup',
          severity: 'media',
          evidence: `Se detectaron ${total} cuentas de Google Ads y aún no has seleccionado. Se auditó: ${picked.join(', ')}.`,
          recommendation: 'En Ajustes → Conexiones elige explícitamente las cuentas a auditar.',
          estimatedImpact: 'medio'
        };
      } else {
        snapshot = raw;
      }
    }

    if (type === 'meta') {
      raw = await collectMeta(userId);

      // “total” tolera varias formas
      const total = (raw?.accountIds && raw.accountIds.length) ||
                    (raw?.accounts && raw.accounts.length) || 0;

      if (selMeta.length) {
        snapshot = filterSnapshot('meta', raw, selMeta);
      } else if (total > 3) {
        const picked = autoPickIds('meta', raw, 3);
        snapshot = filterSnapshot('meta', raw, picked);
        selectionNote = {
          title: 'Auditoría limitada a 3 cuentas',
          area: 'setup',
          severity: 'media',
          evidence: `Se detectaron ${total} cuentas de Meta Ads y aún no has seleccionado. Se auditó: ${picked.map(x=>'act_'+x).join(', ')}.`,
          recommendation: 'En Ajustes → Conexiones elige explícitamente las cuentas a auditar.',
          estimatedImpact: 'medio'
        };
      } else {
        snapshot = raw;
      }
    }

    if (type === 'shopify') {
      snapshot = await collectShopify(userId);
    }

    if (!snapshot) throw new Error('SNAPSHOT_EMPTY');

    // Si no hay datos después del filtrado, registra setup claro (pero sin abortar antes)
    const hasAdsData = Array.isArray(snapshot.byCampaign) && snapshot.byCampaign.length > 0;
    const hasGAData  = Array.isArray(snapshot.channels)   && snapshot.channels.length > 0;
    const noData = (type === 'google' || type === 'meta') ? !hasAdsData : !hasGAData;

    let auditJson = { summary: '', issues: [] };
    if (!noData) {
      auditJson = await generateAudit({ type, inputSnapshot: snapshot });
    }

    // anexa nota de “autolimitado” si aplicó
    if (selectionNote) {
      auditJson.issues = Array.isArray(auditJson.issues) ? auditJson.issues : [];
      auditJson.issues.unshift(selectionNote);
    }

    const auditDoc = {
      userId,
      type,
      generatedAt: new Date(),
      summary: auditJson?.summary || (noData ? 'No hay datos suficientes en el periodo.' : 'Auditoría generada'),
      issues: auditJson?.issues || [],
      actionCenter: auditJson?.actionCenter || (auditJson?.issues || []).slice(0, 3),
      topProducts: auditJson?.topProducts || [],
      inputSnapshot: snapshot,
      version: 'audits@1.0.1',
    };

    await Audit.create(auditDoc);
    return true;

  } catch (e) {
    // siempre escribe un doc, para que el frontend vea el motivo
    await Audit.create({
      userId, type, generatedAt: new Date(),
      summary: 'No se pudo generar la auditoría',
      issues: [{
        id: 'setup_incompleto',
        area: 'setup', severity: 'alta',
        title: 'Faltan datos o permisos',
        evidence: String(e && (e.message || e)),
        recommendation: 'Verifica conexión y permisos. Si tienes varias cuentas, elige cuáles auditar en Ajustes.',
        estimatedImpact: 'alto'
      }],
      actionCenter: [],
      inputSnapshot: {}
    });
    return false;
  }
}

module.exports = { runAuditFor };
