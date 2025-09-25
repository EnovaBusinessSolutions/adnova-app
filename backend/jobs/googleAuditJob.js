// backend/jobs/googleAuditJob.js
'use strict';

const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const GoogleAccount = require('../models/GoogleAccount');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  GOOGLE_ADS_API_VERSION = 'v17', 
} = process.env;


function oauth() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

async function refreshAccessToken(doc) {
  const client = oauth();
  client.setCredentials({ refresh_token: doc.refreshToken, access_token: doc.accessToken });
  try {
    const { credentials } = await client.refreshAccessToken();
    return credentials.access_token || doc.accessToken;
  } catch {
    
    return doc.accessToken;
  }
}


function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)); }
function last30dRange() {
  const today = new Date();
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const until = addDays(base, -1);
  const since = addDays(until, -29);
  return { since: ymd(since), until: ymd(until) };
}


async function runGAQL({ accessToken, customerId, gaql, managerId }) {
  if (!GOOGLE_DEVELOPER_TOKEN) throw new Error('GOOGLE_DEVELOPER_TOKEN missing');

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  const loginId = String(managerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '').trim();
  if (loginId) headers['login-customer-id'] = loginId;

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const { data } = await axios.post(url, { query: gaql }, { headers, timeout: 30000 });
  return data?.results || [];
}


async function generarAuditoriaGoogleIA(userId, { datePreset = 'last_30d' } = {}) {
  try {
    
    const ga = await GoogleAccount
      .findOne({ $or: [{ user: userId }, { userId }] })
      .select('+refreshToken +accessToken customers defaultCustomerId managerCustomerId objective')
      .lean();

    if (!ga || (!ga.refreshToken && !ga.accessToken)) {
      return {
        productsAnalizados: 0,
        resumen: 'No hay refresh_token de Google Ads.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [], googleads: [] },
      };
    }

    
    const customerId =
      (ga.defaultCustomerId && String(ga.defaultCustomerId).replace(/-/g, '')) ||
      (ga.customers?.[0]?.id && String(ga.customers[0].id).replace(/-/g, '')) ||
      '';

    if (!customerId) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontró customerId de Google Ads.',
        actionCenter: [{
          title: '[Google Ads] Selecciona una cuenta por defecto',
          description: 'Sin customerId seleccionado no podemos auditar campañas.',
          severity: 'high',
          button: 'Seleccionar cuenta'
        }],
        issues: {
          productos: [],
          ux: [],
          seo: [],
          performance: [],
          media: [],
          googleads: [{
            title: 'Sin cuenta por defecto',
            description: 'Configura un customerId por defecto para iniciar el análisis.',
            severity: 'high',
            recommendation: 'Ve a Conexiones → Google y selecciona una cuenta.'
          }]
        },
      };
    }

    const accessToken = await refreshAccessToken(ga);
    const ranges = last30dRange();

    
    const gaql = `
      SELECT
        segments.date,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.cpc,
        metrics.cpm
      FROM campaign
      WHERE segments.date BETWEEN '${ranges.since}' AND '${ranges.until}'
      ORDER BY segments.date
    `;

    let rows = [];
    try {
      rows = await runGAQL({
        accessToken,
        customerId,
        gaql,
        managerId: ga.managerCustomerId,
      });
    } catch (e) {
      
      console.warn('GAQL error:', e?.response?.data || e.message);
      rows = [];
    }

    
    const productos = [{ nombre: 'Campañas (últimos 30 días)', hallazgos: [] }];
    const flat = { ux: [], seo: [], performance: [], media: [], googleads: [] };
    const actionCenter = [];

    
    const agg = new Map(); 
    for (const r of rows) {
      const id    = r?.campaign?.id;
      const name  = r?.campaign?.name || `Campaign ${id}`;
      const imp   = Number(r?.metrics?.impressions ?? 0);
      const clk   = Number(r?.metrics?.clicks ?? 0);
      
      const cost  = Number(r?.metrics?.costMicros ?? 0) / 1e6;
      const conv  = Number(r?.metrics?.conversions ?? 0);
      const cval  = Number(r?.metrics?.conversionsValue ?? 0);

      if (!agg.has(id)) agg.set(id, { name, spend: 0, impr: 0, clicks: 0, conv: 0, convValue: 0 });
      const a = agg.get(id);
      a.spend += cost; a.impr += imp; a.clicks += clk; a.conv += conv; a.convValue += cval;
    }

    let totalImpr = 0, totalClicks = 0, totalSpend = 0;
    for (const [, a] of agg) {
      totalImpr += a.impr; totalClicks += a.clicks; totalSpend += a.spend;

      const ctr = a.impr > 0 ? (a.clicks / a.impr) * 100 : 0;
      const roas = a.spend > 0 ? (a.convValue / a.spend) : 0;

      
      if (a.impr > 1000 && ctr < 1.0) {
        const issue = {
          title: `CTR bajo · ${a.name}`,
          description: `CTR ${ctr.toFixed(2)}% con ${a.impr} impresiones y ${a.clicks} clics.`,
          severity: 'medium',
          recommendation: 'Mejora RSA, extensiones y relevancia de keywords. Testea creatividades.'
        };
        productos[0].hallazgos.push({ area: 'Performance', ...issue });
        flat.performance.push(issue);
        flat.googleads.push(issue);
      }

      if (a.clicks >= 150 && a.conv === 0 && a.spend > 0) {
        const issue = {
          title: `Gasto sin conversiones · ${a.name}`,
          description: `Clicks ${a.clicks}, coste ${a.spend.toFixed(2)} y 0 conversiones.`,
          severity: 'high',
          recommendation: 'Revisa términos de búsqueda, negativas, concordancias y la landing.'
        };
        productos[0].hallazgos.push({ area: 'UX', ...issue });
        flat.ux.push(issue);
        flat.googleads.push(issue);
        actionCenter.push({
          title: '[Google Ads] Reducir gasto sin conversiones',
          description: `Detectado en ${a.name}. Revisar Search Terms y aplicar negativas.`,
          severity: 'high',
          button: 'Ver pasos'
        });
      }

      
      if (roas > 0 && roas < 1.0 && a.spend > 100) {
        const issue = {
          title: `ROAS bajo · ${a.name}`,
          description: `ROAS ${roas.toFixed(2)} con gasto ${a.spend.toFixed(2)}.`,
          severity: 'medium',
          recommendation: 'Ajusta pujas, audiencias y creatividades. Evalúa excluir ubicaciones pobres.'
        };
        productos[0].hallazgos.push({ area: 'Performance', ...issue });
        flat.performance.push(issue);
        flat.googleads.push(issue);
      }
    }

    const avgCTR = totalImpr ? (totalClicks / totalImpr) * 100 : 0;
    const cpcAvg = totalClicks ? (totalSpend / totalClicks) : null;
    const resumen = `Analizadas ${agg.size} campañas. CTR medio ${avgCTR.toFixed(2)}%. CPC promedio ${cpcAvg?.toFixed(2) ?? 'N/A'}.`;

    return {
      productsAnalizados: agg.size,
      resumen,
      actionCenter,
      issues: { productos, ux: flat.ux, seo: flat.seo, performance: flat.performance, media: flat.media, googleads: flat.googleads },
    };
  } catch (err) {
    console.error('❌ Google audit error:', err?.response?.data || err);
    return {
      productsAnalizados: 0,
      resumen: 'Error al consultar Google Ads.',
      actionCenter: [],
      issues: { productos: [], ux: [], seo: [], performance: [], media: [], googleads: [] },
    };
  }
}

module.exports = { generarAuditoriaGoogleIA };
