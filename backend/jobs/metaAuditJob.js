// backend/jobs/metaAuditJob.js
const axios = require('axios');
const MetaAccount = require('../models/MetaAccount'); // debe existir en tu proyecto
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';

/**
 * Devuelve un objeto con la misma forma que generarAuditoriaIA (Shopify):
 * { productsAnalizados, resumen, actionCenter, issues }
 */
async function generarAuditoriaMetaIA(userId, { accountId, datePreset = 'last_30d' } = {}) {
  try {
    // 1) Token y cuenta
    const meta = await MetaAccount.findOne({ user: userId }).lean();
    if (!meta || !meta.access_token) {
      return {
        productsAnalizados: 0,
        resumen: 'No hay token de Meta conectado.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
      };
    }
    const token = meta.access_token;
    const useAccountId = accountId || (meta.ad_accounts?.[0]?.id);
    if (!useAccountId) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontraron cuentas publicitarias en Meta.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
      };
    }

    // 2) Insights campañas
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
        limit: 500
      }
    });

    const rows = data?.data || [];
    const productos = [{ nombre: 'GLOBAL', hallazgos: [] }];
    const flat = { ux: [], seo: [], performance: [], media: [] };
    const actionCenter = [];

    let totalSpend = 0, totalImpr = 0, totalClicks = 0, totalConv = 0;

    const pushHallazgo = (area, h) => {
      const item = { area, ...h };
      productos[0].hallazgos.push(item);
      const key = area.toLowerCase();
      if (flat[key]) flat[key].push(item);
      if (h.severity === 'high') {
        actionCenter.push({
          title: `[${h.title}]`,
          description: h.description,
          severity: 'high',
          button: 'Ver detalle'
        });
      }
    };

    for (const r of rows) {
      const spend = Number(r.spend || 0);
      const impr  = Number(r.impressions || 0);
      const clicks= Number(r.clicks || 0);
      const ctr   = Number(r.ctr || 0);    // Meta retorna % ya calculado
      const cpc   = Number(r.cpc || 0);
      const cpm   = Number(r.cpm || 0);
      const freq  = Number(r.frequency || 0);

      let conv = 0;
      if (Array.isArray(r.actions)) {
        const purchase = r.actions.find(a => a.action_type === 'purchase');
        conv = purchase ? Number(purchase.value || 0) : 0;
      }

      totalSpend += spend; totalImpr += impr; totalClicks += clicks; totalConv += conv;

      // Heurísticas:
      if (impr > 0) {
        if (ctr < 0.8) {
          pushHallazgo('Performance', {
            title: `CTR bajo - ${r.campaign_name}`,
            description: `CTR ${ctr.toFixed(2)}% (< 0.8% recomendado).`,
            severity: 'medium',
            recommendation: 'Probar creatividades nuevas, hooks más claros en 2–3s, revisar públicos.'
          });
        }
        if (cpm > 20) {
          pushHallazgo('Performance', {
            title: `CPM elevado - ${r.campaign_name}`,
            description: `CPM ${cpm.toFixed(2)} alto para el periodo.`,
            severity: 'medium',
            recommendation: 'Revisar segmentación, ubicaciones, y saturación de audiencia.'
          });
        }
      }

      if (clicks >= 150 && conv === 0 && spend > 0) {
        pushHallazgo('UX', {
          title: `Gasto sin compras - ${r.campaign_name}`,
          description: `Clicks ${clicks}, gasto ${spend.toFixed(2)} y 0 compras.`,
          severity: 'high',
          recommendation: 'Revisar evento Purchase, calidad de landing, velocidad y tracking.'
        });
      }

      if (freq >= 4 && ctr < 1.0) {
        pushHallazgo('Media', {
          title: `Fatiga creativa - ${r.campaign_name}`,
          description: `Frecuencia ${freq.toFixed(1)} y CTR ${ctr.toFixed(2)}%.`,
          severity: 'medium',
          recommendation: 'Rotar creatividades y ajustar límites de frecuencia.'
        });
      }
    }

    const avgCTR = totalImpr ? (totalClicks / totalImpr) * 100 : 0;
    const cpcAvg = totalClicks ? (totalSpend / totalClicks) : null;
    const resumen = `Analizadas ${rows.length} campañas. CTR medio ${avgCTR.toFixed(2)}%. CPC promedio ${cpcAvg?.toFixed(2) ?? 'N/A'}.`;

    const issues = { productos, ...flat };

    return {
      productsAnalizados: rows.length,
      resumen,
      actionCenter,
      issues
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
