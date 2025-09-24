'use strict';

const axios = require('axios');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

// ===== ENV / Config =====
const ADS_API = 'https://googleads.googleapis.com/v16';
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,   // redirect URI
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID, // opcional (MCC)
} = process.env;

// ===== Modelo =====
let GoogleAccount;
try {
  GoogleAccount = require('../../models/GoogleAccount');
} catch (_) {
  // Fallback mínimo si no está el modelo
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user:   { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      accessToken:  { type: String, select: false },
      refreshToken: { type: String, select: false },
      expiresAt:    { type: Date },
      customers:         { type: Array, default: [] },
      defaultCustomerId: { type: String },
      managerCustomerId: { type: String },
      objective:         { type: String, enum: ['ventas','alcance','leads'], default: null },
      updatedAt:         { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );
  schema.pre('save', function (next) { this.updatedAt = new Date(); next(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

// ===== Utils =====
const normId = (s='') => String(s).replace(/-/g, '').trim();
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function daysAgoISO(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0,10);
}
function safeDiv(n, d) {
  const N = Number(n || 0);
  const D = Number(d || 0);
  if (!D) return 0;
  return N / D;
}
const microsTo = (micros) => Number(micros || 0) / 1_000_000;

// ===== OAuth helper =====
function oauth() {
  return new OAuth2Client({
    clientId:     GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri:  GOOGLE_CONNECT_CALLBACK_URL,
  });
}

async function ensureAccessToken(gaDoc) {
  // Si ya hay accessToken, úsalo. Si hay refreshToken, podemos renovarlo si falla.
  if (gaDoc?.accessToken) return { accessToken: gaDoc.accessToken, refreshed: false };

  if (!gaDoc?.refreshToken) return { accessToken: null, refreshed: false };

  const client = oauth();
  client.setCredentials({ refresh_token: gaDoc.refreshToken });
  const { credentials } = await client.refreshAccessToken(); // deprecated in v8, pero funciona; alternativa: client.getAccessToken()
  const token = credentials?.access_token || null;

  if (token) {
    // guarda accessToken y expiresAt
    await GoogleAccount.updateOne(
      { _id: gaDoc._id },
      { $set: { accessToken: token, expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null, updatedAt: new Date() } }
    );
  }

  return { accessToken: token, refreshed: true };
}

// ===== Google Ads REST calls =====
async function getCustomerInfo(accessToken, customerId) {
  // GET customers/{id} para currency/timezone
  const { data } = await axios.get(`${ADS_API}/customers/${customerId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': GOOGLE_DEVELOPER_TOKEN,
    },
    timeout: 15000,
  });
  return {
    currencyCode: data?.currencyCode || null,
    timeZone: data?.timeZone || null,
    descriptiveName: data?.descriptiveName || null,
    resourceName: data?.resourceName || `customers/${customerId}`,
  };
}

async function gaqlSearchStream({ accessToken, customerId, loginCustomerId, query }) {
  // POST customers/{cid}/googleAds:searchStream
  const url = `${ADS_API}/customers/${customerId}/googleAds:searchStream`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId);

  const { data } = await axios.post(url, { query }, { headers, timeout: 45000 });
  // data es un array de "stream" chunks con .results
  const rows = [];
  for (const chunk of (Array.isArray(data) ? data : [])) {
    if (Array.isArray(chunk.results)) rows.push(...chunk.results);
  }
  return rows;
}

// ===== Collector principal =====
async function collectGoogle(userId) {
  // 1) carga doc
  const ga = await GoogleAccount.findOne({
    $or: [{ user: userId }, { userId }],
  })
    .select('+accessToken +refreshToken customers defaultCustomerId managerCustomerId')
    .lean();

  if (!ga) {
    return {
      notAuthorized: true,
      reason: 'NO_GOOGLEACCOUNT_DOC',
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 },
      byCampaign: [],
      series: [],
      accountIds: [],
    };
  }

  // 2) access token
  let { accessToken } = await ensureAccessToken(ga);
  if (!accessToken) {
    return {
      notAuthorized: true,
      reason: 'NO_ACCESS_TOKEN',
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 },
      byCampaign: [],
      series: [],
      accountIds: [],
    };
  }

  // 3) elegimos customers a consultar
  const ids = [];
  if (ga.defaultCustomerId) ids.push(normId(ga.defaultCustomerId));
  for (const c of (ga.customers || [])) {
    const cid = normId(c.id || c.customerId);
    if (cid && !ids.includes(cid)) ids.push(cid);
    if (ids.length >= 2) break; // seguridad (puedes subir a 3 si quieres)
  }
  if (ids.length === 0) {
    return {
      notAuthorized: false,
      reason: 'NO_CUSTOMERS',
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 },
      byCampaign: [],
      series: [],
      accountIds: [],
    };
  }

  // 4) rango (últimos 30 días)
  const until = todayISO();
  const since = daysAgoISO(30);

  // 5) acumuladores
  let G_impr = 0, G_clicks = 0, G_cost = 0, G_conv = 0, G_value = 0;
  const seriesMap = new Map(); // date -> {impressions, clicks, cost, conversions, conv_value}
  const byCampaign = [];
  let currency = null;

  const loginCustomerId = normId(ga.managerCustomerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');

  // 6) consulta customers
  for (const customerId of ids) {
    // currency / timezone
    try {
      const info = await getCustomerInfo(accessToken, customerId);
      if (!currency) currency = info.currencyCode || currency;
    } catch (e) {
      // Si 403 aquí, quizá falta vincular a MCC
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        return {
          notAuthorized: true,
          reason: 'NO_SCOPE_OR_DENIED',
          currency: null,
          timeRange: { from: null, to: null },
          kpis: { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 },
          byCampaign: [],
          series: [],
          accountIds: ids,
          hint: 'Verifica ads_read/adwords scope y el login-customer-id (MCC) configurado.',
        };
      }
    }

    // GAQL: por día y campaña
    const query = `
      SELECT
        segments.date,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM   campaign
      WHERE  segments.date BETWEEN '${since}' AND '${until}'
      ORDER BY segments.date ASC
    `;

    let rows;
    try {
      rows = await gaqlSearchStream({
        accessToken,
        customerId,
        loginCustomerId: loginCustomerId || undefined,
        query,
      });
    } catch (e) {
      // Intento 2: refrescar token y reintentar una vez
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        try {
          const refreshed = await ensureAccessToken({ ...ga, accessToken: null });
          accessToken = refreshed.accessToken;
          rows = await gaqlSearchStream({
            accessToken,
            customerId,
            loginCustomerId: loginCustomerId || undefined,
            query,
          });
        } catch (e2) {
          // sin permisos reales → snapshot autorizado=false, sin inventar métricas
          return {
            notAuthorized: true,
            reason: 'NO_SCOPE_OR_DENIED',
            currency: null,
            timeRange: { from: null, to: null },
            kpis: { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 },
            byCampaign: [],
            series: [],
            accountIds: ids,
          };
        }
      } else {
        // otro error → seguimos con el siguiente customer
        continue;
      }
    }

    // Limitar filas por seguridad
    const limited = rows.slice(0, 2000);

    // Agregar métricas
    const byCampAgg = new Map(); // campId -> {name, impr, clicks, cost, conv, value}
    for (const r of limited) {
      const date  = r.segments?.date;
      const name  = r.campaign?.name || 'Untitled';
      const campId = r.campaign?.id || null;

      const impressions = Number(r.metrics?.impressions || 0);
      const clicks      = Number(r.metrics?.clicks || 0);
      const cost        = microsTo(r.metrics?.cost_micros);
      const conversions = Number(r.metrics?.conversions || 0);
      const convValue   = Number(r.metrics?.conversions_value || 0);

      // global
      G_impr += impressions; G_clicks += clicks; G_cost += cost; G_conv += conversions; G_value += convValue;

      // serie
      if (date) {
        const cur = seriesMap.get(date) || { impressions: 0, clicks: 0, cost: 0, conversions: 0, conv_value: 0 };
        cur.impressions += impressions;
        cur.clicks      += clicks;
        cur.cost        += cost;
        cur.conversions += conversions;
        cur.conv_value  += convValue;
        seriesMap.set(date, cur);
      }

      // campaña
      if (campId) {
        const agg = byCampAgg.get(campId) || { name, impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 };
        agg.impressions += impressions;
        agg.clicks      += clicks;
        agg.cost        += cost;
        agg.conversions += conversions;
        agg.convValue   += convValue;
        byCampAgg.set(campId, agg);
      }
    }

    // sale lista de campañas de este customer
    for (const [cid, v] of byCampAgg.entries()) {
      const cpc  = safeDiv(v.cost, v.clicks);
      const cpa  = safeDiv(v.cost, v.conversions);
      const roas = safeDiv(v.convValue, v.cost);
      byCampaign.push({
        account_id: customerId,
        id: cid,
        name: v.name,
        kpis: {
          impressions: v.impressions,
          clicks: v.clicks,
          cost: v.cost,
          conversions: v.conversions,
          conv_value: v.convValue,
          cpc, cpa, roas,
        },
        period: { since, until },
      });
    }
  }

  // Ordena serie por fecha ascendente
  const allDates = Array.from(seriesMap.keys()).sort();
  const series = allDates.map(d => ({ date: d, ...seriesMap.get(d) }));

  return {
    notAuthorized: false,
    currency: currency || 'USD',
    timeRange: { from: since, to: until },
    kpis: {
      impressions: G_impr,
      clicks: G_clicks,
      cost: G_cost,
      conversions: G_conv,
      convValue: G_value,
      cpc: safeDiv(G_cost, G_clicks),
      cpa: safeDiv(G_cost, G_conv),
      roas: safeDiv(G_value, G_cost),
    },
    byCampaign,
    series,
    accountIds: ids,
  };
}

module.exports = { collectGoogle };
