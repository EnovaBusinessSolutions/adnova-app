// backend/jobs/metaAuditJob.js
'use strict';

const axios = require('axios');
const MetaAccount = require('../models/MetaAccount');
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';

/**
 * Auditoría de Meta Ads
 */
async function generarAuditoriaMetaIA(userId, { accountId, datePreset = 'last_30d' } = {}) {
  try {
    const meta = await MetaAccount
      .findOne({ $or: [{ user: userId }, { userId }] })
      .select('+access_token +longlivedToken +longLivedToken +accessToken')
      .lean();

    const token = meta?.access_token || meta?.longlivedToken || meta?.longLivedToken || meta?.accessToken;
    if (!token) {
      return {
        productsAnalizados: 0,
        resumen: 'No hay token de Meta conectado.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
      };
    }
    const useAccountId = (accountId || meta?.defaultAccountId || meta?.ad_accounts?.[0]?.id || meta?.adAccounts?.[0]?.id || '').toString().replace(/^act_/, '');
    if (!useAccountId) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontraron cuentas publicitarias en Meta.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
      };
    }

    const fields = [
      'campaign_id','campaign_name',
      'spend','impressions','clicks','ctr','cpc','cpm','frequency',
      'actions','action_values'
    ].join(',');

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/act_${useAccountId}/insights`;
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

    const rows = data?.data || [];
    const productos = [{ nombre: 'GLOBAL', hallazgos: [] }];
    const flat = { ux: [], seo: [], performance: [], media: [] };
    const actionCenter = [];

    let totalSpend = 0, totalImpr = 0, totalClicks = 0;

    const push = (area, issue) => {
      const it = { area, ...issue };
      productos[0].hallazgos.push(it);
      const key = area.toLowerCase();
      if (flat[key]) flat[key].push(it);
      if (issue.severity === 'high') {
        actionCenter.push({
          title: `[${issue.title}]`,
          description: issue.description,
          severity: 'high',
          button: 'Ver detalle',
        });
      }
    };

    for (const r of rows) {
      const spend = Number(r.spend || 0);
      const impr  = Number(r.impressions || 0);
      const clicks= Number(r.clicks || 0);
      const ctr   = Number(r.ctr || 0); // %
      const cpm   = Number(r.cpm || 0);
      const freq  = Number(r.frequency || 0);
      totalSpend += spend; totalImpr += impr; totalClicks += clicks;

      if (impr > 0) {
        if (ctr < 0.8) {
          push('Performance', {
            title: `CTR bajo - ${r.campaign_name}`,
            description: `CTR ${ctr.toFixed(2)}% (< 0.8% recomendado).`,
            severity: 'medium',
            recommendation: 'Itera creatividades/hook y prueba ubicaciones.'
          });
        }
        if (cpm > 20) {
          push('Performance', {
            title: `CPM elevado - ${r.campaign_name}`,
            description: `CPM ${cpm.toFixed(2)} alto para el periodo.`,
            severity: 'medium',
            recommendation: 'Revisa segmentación y saturación de audiencia.'
          });
        }
      }

      if (freq >= 4 && ctr < 1.0) {
        push('Media', {
          title: `Posible fatiga creativa - ${r.campaign_name}`,
          description: `Frecuencia ${freq.toFixed(1)} con CTR ${ctr.toFixed(2)}%.`,
          severity: 'medium',
          recommendation: 'Rota creatividades y ajusta límites de frecuencia.'
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
      issues: { productos, ...flat },
    };
  } catch (err) {
    console.error('❌ Meta audit error:', err?.response?.data || err);
    return {
      productsAnalizados: 0,
      resumen: 'Error al consultar Meta.',
      actionCenter: [],
      issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
    };
  }
}

module.exports = { generarAuditoriaMetaIA };
