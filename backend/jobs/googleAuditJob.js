// backend/jobs/googleAuditJob.js
'use strict';

const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const GoogleAccount = require('../models/GoogleAccount');
const User = require('../models/User');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  GOOGLE_ADS_API_VERSION = 'v17',
} = process.env;

/* ================= helpers ================= */
const normId = (s = '') =>
  String(s).trim().replace(/^customers\//, '').replace(/-/g, '');

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
    // si falla, intenta con el que ya teníamos
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

function headersFor(accessToken, managerId) {
  const h = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const loginId = String(managerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '').trim();
  if (loginId) h['login-customer-id'] = loginId;
  return h;
}

async function runGAQL({ accessToken, customerId, gaql, managerId }) {
  if (!GOOGLE_DEVELOPER_TOKEN) throw new Error('GOOGLE_DEVELOPER_TOKEN missing');
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const { data } = await axios.post(url, { query: gaql }, { headers: headersFor(accessToken, managerId), timeout: 30000 });
  return data?.results || [];
}

/* =============== principal (respeta selección) =============== */
async function generarAuditoriaGoogleIA(userId, { datePreset = 'last_30d' } = {}) {
  try {
    // 1) Cargar cuenta Google Ads y selección del usuario
    const [ga, user] = await Promise.all([
      GoogleAccount
        .findOne({ $or: [{ user: userId }, { userId }] })
        .select('+refreshToken +accessToken customers defaultCustomerId managerCustomerId objective')
        .lean(),
      User.findById(userId).select('selectedGoogleAccounts').lean(),
    ]);

    if (!ga || (!ga.refreshToken && !ga.accessToken)) {
      return {
        productsAnalizados: 0,
        resumen: 'No hay refresh_token de Google Ads.',
        actionCenter: [],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [], googleads: [] },
      };
    }

    // 2) Resolver lista de cuentas disponibles y selección efectiva
    const available = Array.isArray(ga.customers) ? ga.customers.map(c => normId(c.id || c.customerId)) : [];
    const selectedRaw = Array.isArray(user?.selectedGoogleAccounts) ? user.selectedGoogleAccounts : [];
    const selected = [...new Set(selectedRaw.map(normId).filter(Boolean))];

    // Regla: si el usuario tiene >3 cuentas y no seleccionó ninguna → no auditar
    if (available.length > 3 && selected.length === 0) {
      return {
        productsAnalizados: 0,
        resumen: 'Tienes más de 3 cuentas de Google Ads vinculadas. Selecciona cuáles auditar.',
        actionCenter: [{
          title: 'Selecciona tus cuentas de Google Ads',
          description: 'Para evitar analizar todas las cuentas por error, elige los customer IDs a auditar.',
          severity: 'high',
          button: 'Seleccionar cuentas',
        }],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [], googleads: [] },
      };
    }

    // Construir lista final a auditar
    let toAudit = selected.length
      ? selected.filter(id => available.includes(id))
      : [];

    if (toAudit.length === 0) {
      const def = normId(ga.defaultCustomerId || '');
      if (def) toAudit = [def];
      else if (available[0]) toAudit = [available[0]];
    }

    if (toAudit.length === 0) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontró customerId de Google Ads.',
        actionCenter: [{
          title: '[Google Ads] Selecciona una cuenta por defecto',
          description: 'Sin customerId seleccionado no podemos auditar campañas.',
          severity: 'high',
          button: 'Seleccionar cuenta',
        }],
        issues: { productos: [], ux: [], seo: [], performance: [], media: [], googleads: [] },
      };
    }

    // 3) Token y rangos
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

    // 4) Ejecutar para cada cuenta seleccionada y consolidar
    const agg = new Map(); // key: accountId:campaignId
    const perAccountMeta = new Map(); // accountId -> { name? }

    for (const customerId of toAudit) {
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

      // opcional: intenta leer el nombre de la cuenta
      try {
        const metaRows = await runGAQL({
          accessToken,
          customerId,
          gaql: `SELECT customer.descriptive_name FROM customer LIMIT 1`,
          managerId: ga.managerCustomerId,
        });
        const nm = metaRows?.[0]?.customer?.descriptiveName || null;
        if (nm) perAccountMeta.set(customerId, { name: nm });
      } catch { /* noop */ }

      for (const r of rows) {
        const campId = r?.campaign?.id;
        const campName = r?.campaign?.name || `Campaign ${campId}`;
        const key = `${customerId}:${campId}`;

        const imp  = Number(r?.metrics?.impressions ?? 0);
        const clk  = Number(r?.metrics?.clicks ?? 0);
        const cost = Number(r?.metrics?.costMicros ?? 0) / 1e6;
        const conv = Number(r?.metrics?.conversions ?? 0);
        const cval = Number(r?.metrics?.conversionsValue ?? 0);

        if (!agg.has(key)) {
          // Prefija nombre con cuenta si hay múltiples cuentas
          const label =
            toAudit.length > 1
              ? `${campName} · ${customerId}`
              : campName;
          agg.set(key, { accountId: customerId, name: label, spend: 0, impr: 0, clicks: 0, conv: 0, convValue: 0 });
        }
        const a = agg.get(key);
        a.spend += cost; a.impr += imp; a.clicks += clk; a.conv += conv; a.convValue += cval;
      }
    }

    // 5) Generar issues / action center
    const productos = [{ nombre: 'Campañas (últimos 30 días)', hallazgos: [] }];
    const flat = { ux: [], seo: [], performance: [], media: [], googleads: [] };
    const actionCenter = [];

    let totalImpr = 0, totalClicks = 0, totalSpend = 0;

    for (const [, a] of agg) {
      totalImpr += a.impr; totalClicks += a.clicks; totalSpend += a.spend;

      const ctr  = a.impr > 0 ? (a.clicks / a.impr) * 100 : 0;
      const roas = a.spend > 0 ? (a.convValue / a.spend) : 0;

      if (a.impr > 1000 && ctr < 1.0) {
        const issue = {
          title: `CTR bajo · ${a.name}`,
          description: `CTR ${ctr.toFixed(2)}% con ${a.impr} impresiones y ${a.clicks} clics.`,
          severity: 'medium',
          recommendation: 'Mejora RSA, extensiones y relevancia de keywords. Testea creatividades.',
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
          recommendation: 'Revisa términos de búsqueda, negativas, concordancias y la landing.',
        };
        productos[0].hallazgos.push({ area: 'UX', ...issue });
        flat.ux.push(issue);
        flat.googleads.push(issue);
        actionCenter.push({
          title: '[Google Ads] Reducir gasto sin conversiones',
          description: `Detectado en ${a.name}. Revisar Search Terms y aplicar negativas.`,
          severity: 'high',
          button: 'Ver pasos',
        });
      }

      if (roas > 0 && roas < 1.0 && a.spend > 100) {
        const issue = {
          title: `ROAS bajo · ${a.name}`,
          description: `ROAS ${roas.toFixed(2)} con gasto ${a.spend.toFixed(2)}.`,
          severity: 'medium',
          recommendation: 'Ajusta pujas, audiencias y creatividades. Evalúa excluir ubicaciones pobres.',
        };
        productos[0].hallazgos.push({ area: 'Performance', ...issue });
        flat.performance.push(issue);
        flat.googleads.push(issue);
      }
    }

    const avgCTR = totalImpr ? (totalClicks / totalImpr) * 100 : 0;
    const cpcAvg = totalClicks ? (totalSpend / totalClicks) : null;
    const resumen = `Analizadas ${agg.size} campañas en ${toAudit.length} cuenta(s). CTR medio ${avgCTR.toFixed(2)}%. CPC promedio ${cpcAvg?.toFixed(2) ?? 'N/A'}.`;

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
