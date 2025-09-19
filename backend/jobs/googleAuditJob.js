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
  const { credentials } = await client.refreshAccessToken();
  return credentials.access_token || doc.accessToken;
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
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  const loginId = String(managerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g,'').trim();
  if (loginId) headers['login-customer-id'] = loginId;

  const { data } = await axios.post(
    `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:search`,
    { query: gaql },
    { headers, timeout: 30000 }
  );
  return data?.results || [];
}

/**
 * Auditoría de Google Ads
 */
async function generarAuditoriaGoogleIA(userId, { datePreset = 'last_30d' } = {}) {
  try {
    // 1) Cuenta y token
    const ga = await GoogleAccount
      .findOne({ $or: [{ user: userId }, { userId }] })
      .select('+refreshToken +accessToken customers defaultCustomerId managerCustomerId objective')
      .lean();

    if (!ga || (!ga.refreshToken && !ga.accessToken)) {
      return {
        productsAnalizados: 0,
        resumen: 'No hay refresh_token de Google Ads.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] },
      };
    }

    const customerId =
      (ga.defaultCustomerId && ga.defaultCustomerId.replace(/-/g, '')) ||
      (ga.customers?.[0]?.id && String(ga.customers[0].id).replace(/-/g,'')) ||
      '';

    if (!customerId) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontró customerId de Google Ads.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [] },
      };
    }

    const accessToken = await refreshAccessToken(ga);
    const ranges = last30dRange();

    // 2) Traer campañas
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

    const rows = await runGAQL({
      accessToken,
      customerId,
      gaql,
      managerId: ga.managerCustomerId,
    }).catch(() => []);

    // 3) Heurísticas
    const productos = [{ nombre: 'Campañas (últimos 30 días)', hallazgos: [] }];
    const flat = { ux: [], seo: [], performance: [], media: [] };
    const actionCenter = [];

    const agg = new Map(); // campaignId -> { name, spend, impr, clicks, conv, convValue }
    for (const r of rows) {
      const id    = r?.campaign?.id;
      const name  = r?.campaign?.name || `Campaign ${id}`;
      const imp   = Number(r?.metrics?.impressions || 0);
      const clk   = Number(r?.metrics?.clicks || 0);
      const cost  = Number(r?.metrics?.costMicros || 0) / 1e6;
      const conv  = Number(r?.metrics?.conversions || 0);
      const cval  = Number(r?.metrics?.conversionsValue || 0);
      if (!agg.has(id)) agg.set(id, { name, spend: 0, impr: 0, clicks: 0, conv: 0, convValue: 0 });
      const a = agg.get(id);
      a.spend += cost; a.impr += imp; a.clicks += clk; a.conv += conv; a.convValue += cval;
    }

    let totalImpr = 0, totalClicks = 0, totalSpend = 0;
    for (const [, a] of agg) {
      totalImpr += a.impr; totalClicks += a.clicks; totalSpend += a.spend;

      const ctr = a.impr > 0 ? (a.clicks / a.impr) * 100 : 0;
      const cpc = a.clicks > 0 ? (a.spend / a.clicks) : 0;
      const roas = a.spend > 0 ? (a.convValue / a.spend) : 0;

      if (a.impr > 1000 && ctr < 1.0) {
        const issue = {
          title: `CTR bajo - ${a.name}`,
          description: `CTR ${ctr.toFixed(2)}% con ${a.impr} imp. y ${a.clicks} clics.`,
          severity: 'medium',
          recommendation: 'Mejora anuncios y QS: palabra clave, anuncios RSA y extensiones.'
        };
        productos[0].hallazgos.push({ area: 'Performance', ...issue });
        flat.performance.push(issue);
      }
      if (a.clicks >= 150 && a.conv === 0 && a.spend > 0) {
        const issue = {
          title: `Gasto sin conversiones - ${a.name}`,
          description: `Clicks ${a.clicks}, coste ${a.spend.toFixed(2)} y 0 conv.`,
          severity: 'high',
          recommendation: 'Revisar concordancias/negativas, landing y tracking de conversiones.'
        };
        productos[0].hallazgos.push({ area: 'UX', ...issue });
        flat.ux.push(issue);
        actionCenter.push({
          title: 'Reducir gasto sin conversiones',
          description: `Detectado en ${a.name}. Añade negativas y revisa términos de búsqueda.`,
          severity: 'high',
          button: 'Ver pasos'
        });
      }
      if (roas > 0 && roas < 1.0 && a.spend > 100) {
        const issue = {
          title: `ROAS bajo - ${a.name}`,
          description: `ROAS ${roas.toFixed(2)} con gasto ${a.spend.toFixed(2)}.`,
          severity: 'medium',
          recommendation: 'Optimiza pujas/criterios, audiencias, y prueba variantes de anuncio.'
        };
        productos[0].hallazgos.push({ area: 'Performance', ...issue });
        flat.performance.push(issue);
      }
    }

    const avgCTR = totalImpr ? (totalClicks / totalImpr) * 100 : 0;
    const cpcAvg = totalClicks ? (totalSpend / totalClicks) : null;
    const resumen = `Analizadas ${agg.size} campañas. CTR medio ${avgCTR.toFixed(2)}%. CPC promedio ${cpcAvg?.toFixed(2) ?? 'N/A'}.`;

    return {
      productsAnalizados: agg.size,
      resumen,
      actionCenter,
      issues: { productos, ...flat },
    };
  } catch (err) {
    console.error('❌ Google audit error:', err?.response?.data || err);
    return {
      productsAnalizados: 0,
      resumen: 'Error al consultar Google Ads.',
      actionCenter: [],
      issues: { productos: [], ux: [], seo: [], performance: [], media: [] },
    };
  }
}

module.exports = { generarAuditoriaGoogleIA };
