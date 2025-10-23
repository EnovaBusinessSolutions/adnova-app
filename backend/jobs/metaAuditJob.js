// backend/jobs/metaAuditJob.js
'use strict';

const axios = require('axios');
const MetaAccount = require('../models/MetaAccount');
const User = require('../models/User');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || process.env.FACEBOOK_API_VERSION || 'v19.0';
const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/* ================= helpers ================= */
const normActId = (s = '') => String(s || '').replace(/^act_/, '').trim();
const pct = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

const pickToken = (doc = {}) =>
  doc.longLivedToken || doc.longlivedToken ||
  doc.access_token   || doc.accessToken    ||
  doc.token          || null;

const accountsFromDoc = (doc = {}) => {
  const arr = [
    ...(Array.isArray(doc.ad_accounts) ? doc.ad_accounts : []),
    ...(Array.isArray(doc.adAccounts)  ? doc.adAccounts  : []),
  ];
  // normaliza a {id, name?}
  return arr
    .map(a => {
      const id = normActId(a?.id || a?.account_id || '');
      if (!id) return null;
      return {
        id,
        name: a?.name || a?.account_name || `act_${id}`,
        currency: a?.currency || a?.account_currency || null,
        timezone: a?.timezone_name || a?.timezone || null,
      };
    })
    .filter(Boolean);
};

async function fetchAllInsights({ accountId, accessToken, datePreset = 'last_30d' }) {
  const fields = [
    'date_start','date_stop',
    'campaign_id','campaign_name',
    'spend','impressions','clicks','ctr','cpc','cpm','frequency',
    'actions','action_values'
  ].join(',');

  const baseUrl = `${FB_GRAPH}/act_${accountId}/insights`;
  const baseParams = {
    access_token: accessToken,
    level: 'campaign',
    date_preset: datePreset,
    fields,
    time_increment: 1,
    limit: 5000,
    use_unified_attribution_setting: true,
    action_report_time: 'conversion',
  };

  const out = [];
  let url = baseUrl;
  let params = { ...baseParams };
  let guards = 0;

  while (url && guards < 12) {
    const { data } = await axios.get(url, { params, timeout: 30000 });
    if (Array.isArray(data?.data)) out.push(...data.data);
    const next = data?.paging?.next;
    if (!next) break;
    url = next;      // siguiente página ya trae querystring completo
    params = null;   // evita duplicar params
    guards += 1;
  }
  return out;
}

/* =========================================================
 * Auditoría de Meta Ads — respeta selección de cuentas
 * ========================================================= */
async function generarAuditoriaMetaIA(userId, { accountId, datePreset = 'last_30d' } = {}) {
  try {
    // 1) Cargar documento y selección del usuario
    const [meta, user] = await Promise.all([
      MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
        .select('+access_token +longlivedToken +longLivedToken +accessToken ad_accounts adAccounts defaultAccountId objective')
        .lean(),
      User.findById(userId).select('selectedMetaAccounts').lean(),
    ]);

    const token = pickToken(meta || {});
    if (!meta || !token) {
      return {
        productsAnalizados: 0,
        resumen: 'No hay token de Meta conectado.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [], metaads: [] },
      };
    }

    // 2) Resolver cuentas disponibles y la selección efectiva
    const available = accountsFromDoc(meta);
    const availableIds = new Set(available.map(a => a.id));

    // si viene forzado por parámetro, respétalo (pero validado)
    let forced = accountId ? normActId(accountId) : '';
    if (forced && !availableIds.has(forced)) forced = '';

    const selectedRaw = Array.isArray(user?.selectedMetaAccounts) ? user.selectedMetaAccounts : [];
    const selected = [...new Set(selectedRaw.map(normActId).filter(id => availableIds.has(id)))];

    // Regla: si el usuario tiene >3 cuentas y no seleccionó ninguna → no auditar
    if (available.length > 3 && selected.length === 0 && !forced) {
      return {
        productsAnalizados: 0,
        resumen: 'Tienes más de 3 cuentas de Meta Ads vinculadas. Selecciona cuáles auditar.',
        actionCenter: [{
          title: 'Selecciona tus cuentas de Meta Ads',
          description: 'Para evitar analizar todas las cuentas por error, elige los IDs de cuenta publicitaria a auditar.',
          severity: 'high',
          button: 'Seleccionar cuentas',
        }],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [], metaads: [] },
      };
    }

    // Lista final a auditar
    let toAudit = [];
    if (forced) {
      toAudit = [forced];
    } else if (selected.length) {
      toAudit = selected;
    } else {
      const d = normActId(meta.defaultAccountId || '');
      toAudit = d ? [d] : (available[0] ? [available[0].id] : []);
    }

    if (!toAudit.length) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontraron cuentas publicitarias en Meta.',
        actionCenter: [{
          title: '[Meta] Selecciona una cuenta publicitaria',
          description: 'Sin cuenta por defecto no podemos auditar campañas.',
          severity: 'high',
          button: 'Seleccionar cuenta',
        }],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [], metaads: [] },
      };
    }

    // 3) Recopilar insights para cada cuenta seleccionada
    const productos = [{ nombre: 'Campañas (últimos 30 días)', hallazgos: [] }];
    const flat = { ux: [], seo: [], performance: [], media: [], metaads: [] };
    const actionCenter = [];
    let totalSpend = 0, totalImpr = 0, totalClicks = 0;
    let campaignsCount = 0;

    const pushIssue = (area, issue) => {
      const item = { area, ...issue };
      productos[0].hallazgos.push(item);
      const key = area.toLowerCase();
      if (flat[key]) flat[key].push(issue);
      flat.metaads.push(issue);
      if (issue.severity === 'high') {
        actionCenter.push({
          title: `[Meta] ${issue.title}`,
          description: issue.description,
          severity: 'high',
          button: 'Ver detalle',
        });
      }
    };

    for (const actId of toAudit) {
      let rows = [];
      try {
        rows = await fetchAllInsights({ accountId: actId, accessToken: token, datePreset });
      } catch (e) {
        const err = e?.response?.data?.error || {};
        console.warn('Meta insights error:', { code: err.code, sub: err.error_subcode, msg: err.message });
        // si una cuenta falla por permisos, continuamos con las demás
        continue;
      }

      campaignsCount += rows.length;

      // Etiqueta de cuenta para distinguir si hay más de una
      const acctName = available.find(a => a.id === actId)?.name || `act_${actId}`;
      const prefix = (toAudit.length > 1) ? `(${acctName}) ` : '';

      for (const r of rows) {
        const name  = r.campaign_name || 'Campaña';
        const spend = Number(r.spend || 0);
        const impr  = Number(r.impressions || 0);
        const clicks= Number(r.clicks || 0);
        const ctr   = pct(r.ctr);     // % ya viene en puntos (ej. "1.23")
        const cpc   = Number(r.cpc || 0);
        const cpm   = Number(r.cpm || 0);
        const freq  = Number(r.frequency || 0);

        // compras/valor (considera campos típicos)
        let purchases = 0;
        let purchaseValue = 0;
        if (Array.isArray(r.actions)) {
          const purchase = r.actions.find(a =>
            ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase','onsite_conversion.purchase']
              .includes(String(a.action_type || ''))
          );
          if (purchase) purchases = Number(purchase.value || 0);
        }
        if (Array.isArray(r.action_values)) {
          const pv = r.action_values.find(a =>
            ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase','onsite_conversion.purchase']
              .includes(String(a.action_type || ''))
          );
          if (pv) purchaseValue = Number(pv.value || 0);
        }

        totalSpend += spend; totalImpr += impr; totalClicks += clicks;

        // Heurísticas
        if (impr > 0) {
          if (ctr < 0.8) {
            pushIssue('Performance', {
              title: `${prefix}CTR bajo · ${name}`,
              description: `CTR ${ctr.toFixed(2)}% (< 0.8% recomendado) con ${impr} imp. y ${clicks} clics.`,
              severity: 'medium',
              recommendation: 'Itera creatividades/hook en 2–3s, prueba ubicaciones y audiencias.',
            });
          }
          if (cpm > 20) {
            pushIssue('Performance', {
              title: `${prefix}CPM elevado · ${name}`,
              description: `CPM ${cpm.toFixed(2)} alto para el periodo.`,
              severity: 'medium',
              recommendation: 'Revisa segmentación, ubicaciones y saturación de la audiencia.',
            });
          }
        }

        if (clicks >= 150 && purchases === 0 && spend > 0) {
          pushIssue('UX', {
            title: `${prefix}Gasto sin compras · ${name}`,
            description: `Clicks ${clicks}, gasto ${spend.toFixed(2)} y 0 compras.`,
            severity: 'high',
            recommendation: 'Revisa evento Purchase, calidad de landing, velocidad y tracking.',
          });
        }

        if (freq >= 4 && ctr < 1.0) {
          pushIssue('Media', {
            title: `${prefix}Fatiga creativa · ${name}`,
            description: `Frecuencia ${freq.toFixed(1)} con CTR ${ctr.toFixed(2)}%.`,
            severity: 'medium',
            recommendation: 'Rota creatividades, ajusta límites de frecuencia y refresca ángulos.',
          });
        }

        if (cpc > 1.5 && ctr < 1.2) {
          pushIssue('Performance', {
            title: `${prefix}CPC alto · ${name}`,
            description: `CPC ${cpc.toFixed(2)} y CTR ${ctr.toFixed(2)}%.`,
            severity: 'medium',
            recommendation: 'Prueba audiencias lookalike y optimiza copy/creativos para bajar CPC.',
          });
        }

        const roas = spend > 0 ? purchaseValue / spend : 0;
        if (purchaseValue > 0 && roas < 1.0 && spend > 50) {
          pushIssue('Performance', {
            title: `${prefix}ROAS bajo · ${name}`,
            description: `ROAS ${roas.toFixed(2)} con gasto ${spend.toFixed(2)}.`,
            severity: 'medium',
            recommendation: 'Optimiza segmentación/creativos y evalúa objetivos de campaña.',
          });
        }
      }
    }

    const avgCTR = totalImpr ? (totalClicks / totalImpr) * 100 : 0;
    const cpcAvg = totalClicks ? (totalSpend / totalClicks) : null;
    const resumen =
      `Analizadas ${campaignsCount} campañas en ${toAudit.length} cuenta(s). ` +
      `CTR medio ${avgCTR.toFixed(2)}%. CPC promedio ${cpcAvg?.toFixed(2) ?? 'N/A'}.`;

    return {
      productsAnalizados: campaignsCount,
      resumen,
      actionCenter,
      issues: { productos, ux: flat.ux, seo: flat.seo, performance: flat.performance, media: flat.media, metaads: flat.metaads },
    };
  } catch (err) {
    console.error('❌ Meta audit error:', err?.response?.data || err);
    return {
      productsAnalizados: 0,
      resumen: 'Error al consultar Meta.',
      actionCenter: [],
      issues: { productos: [], ux: [], seo: [], performance: [], media: [], metaads: [] },
    };
  }
}

module.exports = { generarAuditoriaMetaIA };
