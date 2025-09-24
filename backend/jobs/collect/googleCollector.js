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
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,  // opcional (MCC) sin guiones
} = process.env;

// ===== Modelo =====
let GoogleAccount;
try {
  GoogleAccount = require('../../models/GoogleAccount');
} catch (_) {
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
      scope:             { type: [String], default: [] },
      updatedAt:         { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );
  schema.pre('save', function (next) { this.updatedAt = new Date(); next(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

// ===== Utils =====
const normId = (s='') => String(s).replace(/-/g, '').trim();
function todayISO() { return new Date().toISOString().slice(0,10); }
function daysAgoISO(n) { const d = new Date(); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); }
function safeDiv(n,d){ const N=+n||0, D=+d||0; return D?N/D:0; }
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
  if (gaDoc?.accessToken) return { accessToken: gaDoc.accessToken, refreshed: false };
  if (!gaDoc?.refreshToken) return { accessToken: null, refreshed: false };

  const client = oauth();
  client.setCredentials({ refresh_token: gaDoc.refreshToken });
  // Nota: en libs nuevas usa client.getAccessToken(); esto sigue funcionando.
  const { credentials } = await client.refreshAccessToken();
  const token = credentials?.access_token || null;

  if (token) {
    await GoogleAccount.updateOne(
      { _id: gaDoc._id },
      { $set: {
          accessToken: token,
          expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
          updatedAt: new Date()
        } }
    );
  }
  return { accessToken: token, refreshed: true };
}

// ===== Google Ads REST =====
async function listAccessibleCustomers(accessToken) {
  const { data } = await axios.get(`${ADS_API}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': GOOGLE_DEVELOPER_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });
  const rns = Array.isArray(data?.resourceNames) ? data.resourceNames : [];
  // ["customers/1234567890", ...] -> [{id, resourceName}]
  return rns.map(rn => ({ id: rn.split('/')[1], resourceName: rn }));
}

async function fetchCustomer(accessToken, cid, loginCustomerId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId);

  const { data } = await axios.get(`${ADS_API}/customers/${cid}`, { headers, timeout: 15000 });
  return {
    id: normId(cid),
    resourceName: data?.resourceName || `customers/${cid}`,
    descriptiveName: data?.descriptiveName || null,
    currencyCode: data?.currencyCode || null,
    timeZone: data?.timeZone || null,
  };
}

async function gaqlSearchStream({ accessToken, customerId, loginCustomerId, query }) {
  const url = `${ADS_API}/customers/${customerId}/googleAds:searchStream`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId);

  const { data } = await axios.post(url, { query }, { headers, timeout: 45000 });
  const rows = [];
  for (const chunk of (Array.isArray(data) ? data : [])) {
    if (Array.isArray(chunk.results)) rows.push(...chunk.results);
  }
  return rows;
}

// Descubre y guarda customers si no hay en DB
async function ensureCustomers(accessToken, ga) {
  if (Array.isArray(ga.customers) && ga.customers.length) return ga.customers;

  let list = [];
  try {
    const rns = await listAccessibleCustomers(accessToken);
    const loginCustomerId = normId(ga.managerCustomerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
    // enriquecemos con nombre/moneda (opcional)
    for (const c of rns.slice(0, 25)) {
      try { list.push(await fetchCustomer(accessToken, c.id, loginCustomerId)); }
      catch { list.push({ id: c.id, resourceName: c.resourceName }); }
    }
  } catch (e) {
    // si falla, devolvemos []
  }

  if (list.length) {
    await GoogleAccount.updateOne(
      { _id: ga._id },
      { $set: { customers: list, defaultCustomerId: list[0]?.id || ga.defaultCustomerId || null, updatedAt: new Date() } }
    );
  }
  return list;
}

// ===== Collector principal =====
async function collectGoogle(userId) {
  // 1) carga doc
  const ga = await GoogleAccount.findOne({
    $or: [{ user: userId }, { userId }],
  })
    .select('+accessToken +refreshToken customers defaultCustomerId managerCustomerId scope')
    .lean();

  // salida base
  const base = (reason, extra={}) => ({
    notAuthorized: reason === 'NO_SCOPE_OR_DENIED' || reason === 'NO_ACCESS_TOKEN',
    reason,
    currency: null,
    timeRange: { from: null, to: null },
    kpis: { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0, cpc: 0, cpa: 0, roas: 0 },
    byCampaign: [],
    series: [],
    accountIds: [],
    ...extra,
  });

  if (!ga) return base('NO_GOOGLEACCOUNT_DOC');

  // 2) access token (y refresh si hace falta)
  let { accessToken } = await ensureAccessToken(ga);
  if (!accessToken) return base('NO_ACCESS_TOKEN');

  // 3) comprobar scope adwords
  const scopes = Array.isArray(ga.scope) ? ga.scope : [];
  const hasAdwords = scopes.some(s => s.includes('/auth/adwords'));
  // No bloqueo si no está, pero marcamos hint (puede venir en tokens.scope y no guardado)
  const scopeHint = hasAdwords ? undefined : 'El scope /auth/adwords no está en DB. Reautentica si falla.';

  // 4) customers: si no hay, los descubrimos y persistimos
  let customers = await ensureCustomers(accessToken, ga);
  if (!customers || customers.length === 0) return base('NO_CUSTOMERS', { hint: 'No hay cuentas de Ads accesibles para este usuario.' });

  // 5) elegimos hasta 2 customers (seguridad)
  const ids = [];
  const def = normId(ga.defaultCustomerId || customers[0]?.id || '');
  if (def) ids.push(def);
  for (const c of customers) {
    const cid = normId(c.id);
    if (cid && !ids.includes(cid)) ids.push(cid);
    if (ids.length >= 2) break;
  }

  // 6) rango (últimos 30 días)
  const until = todayISO();
  const since = daysAgoISO(30);

  // 7) acumuladores
  let G_impr = 0, G_clicks = 0, G_cost = 0, G_conv = 0, G_value = 0;
  const seriesMap = new Map(); // date -> {impressions, clicks, cost, conversions, conv_value}
  const byCampaign = [];
  let currency = null;

  const loginCustomerId = normId(ga.managerCustomerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');

  for (const customerId of ids) {
    // currency / timezone
    try {
      const info = await fetchCustomer(accessToken, customerId, loginCustomerId || undefined);
      currency = currency || info.currencyCode || null;
    } catch (e) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        return base('NO_SCOPE_OR_DENIED', { accountIds: ids, hint: 'Revisa developer token y login-customer-id (MCC).' });
      }
    }

    // Por día y campaña
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
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
      ORDER BY segments.date ASC
    `;

    let rows;
    try {
      rows = await gaqlSearchStream({ accessToken, customerId, loginCustomerId: loginCustomerId || undefined, query });
    } catch (e) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        // 1 retry refrescando
        try {
          const refreshed = await ensureAccessToken({ ...ga, accessToken: null });
          accessToken = refreshed.accessToken;
          rows = await gaqlSearchStream({ accessToken, customerId, loginCustomerId: loginCustomerId || undefined, query });
        } catch {
          return base('NO_SCOPE_OR_DENIED', { accountIds: ids, hint: 'El token no tiene permisos suficientes o el MCC no está vinculado.' });
        }
      } else {
        // otro error: seguimos con el siguiente customer
        continue;
      }
    }

    const limited = rows.slice(0, 2000);

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

      G_impr += impressions; G_clicks += clicks; G_cost += cost; G_conv += conversions; G_value += convValue;

      if (date) {
        const cur = seriesMap.get(date) || { impressions: 0, clicks: 0, cost: 0, conversions: 0, conv_value: 0 };
        cur.impressions += impressions;
        cur.clicks      += clicks;
        cur.cost        += cost;
        cur.conversions += conversions;
        cur.conv_value  += convValue;
        seriesMap.set(date, cur);
      }

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
    hint: scopeHint,
  };
}

module.exports = { collectGoogle };
