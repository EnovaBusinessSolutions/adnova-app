// backend/jobs/metaAuditJob.js
'use strict';

const axios = require('axios');
const MetaAccount = require('../models/MetaAccount');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';


const pickToken = (doc = {}) =>
  doc.access_token || doc.longlivedToken || doc.longLivedToken || doc.accessToken || null;

const normActId = (s = '') => String(s).replace(/^act_/, '').trim();

function pct(n) {
  return Number.isFinite(n) ? Number(n) : 0;
}

/**
 * Auditoría de Meta Ads
 * @param {string} userId
 * @param {{accountId?: string, datePreset?: string}} opts
 * @returns {Promise<{productsAnalizados:number,resumen:string,actionCenter:any[],issues:any}>}
 */
async function generarAuditoriaMetaIA(
  userId,
  { accountId, datePreset = 'last_30d' } = {}
) {
  try {
    
    const meta = await MetaAccount
      .findOne({ $or: [{ user: userId }, { userId }] })
      .select('+access_token +longlivedToken +longLivedToken +accessToken ad_accounts adAccounts defaultAccountId')
      .lean();

    const token = pickToken(meta);
    if (!token) {
      return {
        productsAnalizados: 0,
        resumen: 'No hay token de Meta conectado.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [], metaads: [] },
      };
    }

    const useAccountId =
      normActId(
        accountId ||
        meta?.defaultAccountId ||
        meta?.ad_accounts?.[0]?.account_id ||
        meta?.ad_accounts?.[0]?.id ||
        meta?.adAccounts?.[0]?.account_id ||
        meta?.adAccounts?.[0]?.id ||
        ''
      );

    if (!useAccountId) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontraron cuentas publicitarias en Meta.',
        actionCenter: [{
          title: '[Meta] Selecciona una cuenta publicitaria',
          description: 'Sin cuenta por defecto no podemos auditar campañas.',
          severity: 'high',
          button: 'Seleccionar cuenta',
        }],
        issues: {
          productos: [],
          ux: [],
          seo: [],
          performance: [],
          media: [],
          metaads: [{
            title: 'Falta seleccionar cuenta publicitaria',
            description: 'Configura una cuenta por defecto en Conexiones → Meta.',
            severity: 'high',
            recommendation: 'Elige la cuenta (act_XXXX) que desees auditar.',
          }],
        },
      };
    }

   
    const fields = [
      'campaign_id', 'campaign_name',
      'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'frequency',
      'actions', 'action_values'
    ].join(',');

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/act_${useAccountId}/insights`;

    let rows = [];
    try {
      const { data } = await axios.get(url, {
        params: {
          access_token: token,
          date_preset: datePreset,
          level: 'campaign',
          fields,
          time_increment: 1,
          limit: 500,
        },
        timeout: 30000,
      });
      rows = data?.data || [];
    } catch (e) {
      
      const code = e?.response?.data?.error?.code;
      const sub  = e?.response?.data?.error?.error_subcode;
      const msg  = e?.response?.data?.error?.message || e.message;

      console.warn('Meta insights error:', { code, sub, msg });
      return {
        productsAnalizados: 0,
        resumen: 'No fue posible leer Insights de Meta (token/permisos).',
        actionCenter: [{
          title: '[Meta] Vuelve a conectar la cuenta',
          description: 'El token pudo expirar o faltan permisos para leer insights.',
          severity: 'high',
          button: 'Reconectar',
        }],
        issues: {
          productos: [],
          ux: [],
          seo: [],
          performance: [],
          media: [],
          metaads: [{
            title: 'Sin acceso a Insights',
            description: 'Token inválido/expirado o permisos insuficientes.',
            severity: 'high',
            recommendation: 'Vuelve a conectar Meta y acepta ads_read/ads_management.',
          }],
        },
      };
    }

    
    const productos = [{ nombre: 'Campañas (últimos 30 días)', hallazgos: [] }];
    const flat = { ux: [], seo: [], performance: [], media: [], metaads: [] };
    const actionCenter = [];

    let totalSpend = 0, totalImpr = 0, totalClicks = 0;

    const push = (area, issue) => {
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

    for (const r of rows) {
      const name  = r.campaign_name || 'Campaña';
      const spend = Number(r.spend || 0);
      const impr  = Number(r.impressions || 0);
      const clicks= Number(r.clicks || 0);
      const ctr   = pct(r.ctr);      
      const cpc   = Number(r.cpc || 0);
      const cpm   = Number(r.cpm || 0);
      const freq  = Number(r.frequency || 0);

      
      let purchases = 0;
      let purchaseValue = 0;
      if (Array.isArray(r.actions)) {
        const purchase = r.actions.find(a => a.action_type === 'purchase');
        if (purchase) purchases = Number(purchase.value || 0);
      }
      if (Array.isArray(r.action_values)) {
        const pv = r.action_values.find(a => a.action_type === 'purchase');
        if (pv) purchaseValue = Number(pv.value || 0);
      }

      totalSpend += spend; totalImpr += impr; totalClicks += clicks;

      
      if (impr > 0) {
        if (ctr < 0.8) {
          push('Performance', {
            title: `CTR bajo · ${name}`,
            description: `CTR ${ctr.toFixed(2)}% (< 0.8% recomendado) con ${impr} imp. y ${clicks} clics.`,
            severity: 'medium',
            recommendation: 'Itera creatividades/hook en 2–3s, prueba ubicaciones y audiencias.',
          });
        }
        if (cpm > 20) {
          push('Performance', {
            title: `CPM elevado · ${name}`,
            description: `CPM ${cpm.toFixed(2)} alto para el periodo.`,
            severity: 'medium',
            recommendation: 'Revisa segmentación, ubicaciones y saturación de la audiencia.',
          });
        }
      }

      if (clicks >= 150 && purchases === 0 && spend > 0) {
        push('UX', {
          title: `Gasto sin compras · ${name}`,
          description: `Clicks ${clicks}, gasto ${spend.toFixed(2)} y 0 compras.`,
          severity: 'high',
          recommendation: 'Revisa evento Purchase, calidad de landing, velocidad y tracking.',
        });
      }

      if (freq >= 4 && ctr < 1.0) {
        push('Media', {
          title: `Fatiga creativa · ${name}`,
          description: `Frecuencia ${freq.toFixed(1)} con CTR ${ctr.toFixed(2)}%.`,
          severity: 'medium',
          recommendation: 'Rota creatividades, ajusta límites de frecuencia y refresca ángulos.',
        });
      }

      if (cpc > 1.5 && ctr < 1.2) {
        push('Performance', {
          title: `CPC alto · ${name}`,
          description: `CPC ${cpc.toFixed(2)} y CTR ${ctr.toFixed(2)}%.`,
          severity: 'medium',
          recommendation: 'Prueba audiencias lookalike y optimiza copy/creativos para bajar CPC.',
        });
      }

      const roas = spend > 0 ? purchaseValue / spend : 0;
      if (purchaseValue > 0 && roas < 1.0 && spend > 50) {
        push('Performance', {
          title: `ROAS bajo · ${name}`,
          description: `ROAS ${roas.toFixed(2)} con gasto ${spend.toFixed(2)}.`,
          severity: 'medium',
          recommendation: 'Optimiza segmentación/creativos y evalúa objetivos de campaña.',
        });
      }
    }

    const avgCTR = totalImpr ? (totalClicks / totalImpr) * 100 : 0;
    const cpcAvg = totalClicks ? (totalSpend / totalClicks) : null;
    const resumen = `Analizadas ${rows.length} campañas. CTR medio ${avgCTR.toFixed(2)}%. CPC promedio ${cpcAvg?.toFixed(2) ?? 'N/A'}.`;

    return {
      productsAnalizados: rows.length,
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
