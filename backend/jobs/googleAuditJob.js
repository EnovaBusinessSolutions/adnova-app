// backend/jobs/googleAuditJob.js
const axios = require('axios');
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const LOGIN_CID       = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
const ADS_BASE        = 'https://googleads.googleapis.com/v16';

/**
 * Obtiene access_token desde refresh_token guardado en user.google.refresh_token
 */
async function getAccessToken({ client_id, client_secret, refresh_token }) {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    client_id, client_secret, refresh_token, grant_type: 'refresh_token'
  });
  return data.access_token;
}

async function gaqlSearchStream({ accessToken, customerId, query }) {
  const url = `${ADS_BASE}/customers/${customerId}/googleAds:searchStream`;
  const { data } = await axios.post(url, { query }, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': DEVELOPER_TOKEN,
      'login-customer-id': LOGIN_CID
    }
  });
  const rows = [];
  for (const chunk of data) for (const r of (chunk.results || [])) rows.push(r);
  return rows;
}

/**
 * Devuelve { productsAnalizados, resumen, actionCenter, issues }
 * customerId = CLIENT_CUSTOMER_ID de la cuenta hija (sin guiones)
 */
async function generarAuditoriaGoogleIA(user, { customerId, dateRange = 'LAST_30_DAYS' } = {}) {
  try {
    const refresh_token = user?.google?.refresh_token;
    if (!refresh_token) {
      return {
        productsAnalizados: 0,
        resumen: 'No hay refresh_token de Google Ads.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
      };
    }
    if (!DEVELOPER_TOKEN || !LOGIN_CID) {
      return {
        productsAnalizados: 0,
        resumen: 'Falta GOOGLE_ADS_DEVELOPER_TOKEN o GOOGLE_ADS_LOGIN_CUSTOMER_ID.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
      };
    }
    if (!customerId) {
      return {
        productsAnalizados: 0,
        resumen: 'client_customer_id requerido.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
      };
    }

    const accessToken = await getAccessToken({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token
    });

    const query = `
      SELECT
        campaign.id, campaign.name, campaign.status,
        metrics.impressions, metrics.clicks, metrics.ctr,
        metrics.cost_micros, metrics.conversions, metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING ${dateRange}
      AND campaign.status = 'ENABLED'
    `;

    const rows = await gaqlSearchStream({ accessToken, customerId, query });

    const productos = [{ nombre: 'GLOBAL', hallazgos: [] }];
    const flat = { ux: [], seo: [], performance: [], media: [] };
    const actionCenter = [];

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

    let spend = 0, clicks = 0, impr = 0, conv = 0;
    for (const r of rows) {
      const m = r.metrics || {};
      const c = r.campaign || {};
      const cost = Number(m.costMicros || m.cost_micros || 0) / 1e6;
      const i    = Number(m.impressions || 0);
      const ck   = Number(m.clicks || 0);
      const cv   = Number(m.conversions || 0);
      const ctr  = Number(m.ctr || (i ? (ck / i) * 100 : 0));
      const avgCpc = Number(m.averageCpc || m.average_cpc || (ck ? cost / ck : 0));

      spend += cost; clicks += ck; impr += i; conv += cv;

      if (i > 0 && ctr < 2) {
        pushHallazgo('Performance', {
          title: `CTR bajo - ${c.name}`,
          description: `CTR ${ctr.toFixed(2)}% (< 2% recomendado).`,
          severity: 'medium',
          recommendation: 'Mejorar relevancia anuncio-palabra clave; usar extensiones; revisar términos.'
        });
      }
      if (avgCpc > 1.2) {
        pushHallazgo('Performance', {
          title: `CPC alto - ${c.name}`,
          description: `Avg CPC ${avgCpc.toFixed(2)}.`,
          severity: 'medium',
          recommendation: 'Ajustar pujas/estrategias, negativizar términos caros de bajo valor.'
        });
      }
      if (cost > 0 && cv === 0 && ck >= 120) {
        pushHallazgo('UX', {
          title: `Gasto sin conversiones - ${c.name}`,
          description: `Clicks ${ck}, gasto ${cost.toFixed(2)} y 0 conversiones.`,
          severity: 'high',
          recommendation: 'Revisar etiqueta de conversión, intención de keywords y la landing.'
        });
      }
    }

    const avgCTR = impr ? (clicks / impr) * 100 : 0;
    const cpc    = clicks ? (spend / clicks) : null;
    const resumen = `Analizadas ${rows.length} campañas. CTR medio ${avgCTR.toFixed(2)}%. CPC promedio ${cpc?.toFixed(2) ?? 'N/A'}.`;

    const issues = { productos, ...flat };

    return {
      productsAnalizados: rows.length,
      resumen,
      actionCenter,
      issues
    };
  } catch (err) {
    console.error('❌ Google audit error:', err?.response?.data || err);
    return {
      productsAnalizados: 0,
      resumen: 'Error al consultar Google Ads.',
      actionCenter: [],
      issues: { productos: [], ux: [], seo: [], performance: [], media: [] }
    };
  }
}

module.exports = { generarAuditoriaGoogleIA };
