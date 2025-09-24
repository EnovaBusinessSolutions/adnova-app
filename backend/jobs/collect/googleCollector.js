'use strict';


const axios = require('axios');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const ADS_API = 'https://googleads.googleapis.com/v16';
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID, // opcional (MCC)
} = process.env;

/* =====================  Modelo  ===================== */
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
      scope:        { type: [String], default: [] },
      expiresAt:    { type: Date },
      customers:         { type: Array, default: [] },
      defaultCustomerId: { type: String },
      managerCustomerId: { type: String },
      updatedAt:         { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );
  schema.pre('save', function (n) { this.updatedAt = new Date(); n(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* =====================  Utils  ===================== */
const normId = (s='') => String(s).replace(/-/g, '').trim();
const microsTo = (micros) => Number(micros || 0) / 1_000_000;
const safeDiv = (n, d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);
const todayISO   = () => new Date().toISOString().slice(0,10);
const daysAgoISO = (n) => { const d=new Date(); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); };

function oauth() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

async function ensureAccessToken(gaDoc) {
  if (gaDoc?.accessToken) return { accessToken: gaDoc.accessToken, refreshed: false };
  if (!gaDoc?.refreshToken) return { accessToken: null, refreshed: false };

  const client = oauth();
  client.setCredentials({ refresh_token: gaDoc.refreshToken });
  // (compatible) – en versiones nuevas usar client.getAccessToken()
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

async function getCustomerInfo(accessToken, customerId) {
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
  };
}

/* =====================  Collector  ===================== */
async function collectGoogle(userId) {
  // 1) doc del usuario
  const ga = await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
    .select('+accessToken +refreshToken scope customers defaultCustomerId managerCustomerId')
    .lean();

  if (!ga) {
    return {
      notAuthorized: true,
      reason: 'NO_GOOGLE_ACCOUNT',
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions:0, clicks:0, cost:0, conversions:0, convValue:0 },
      byCampaign: [],
      series: [],
      accountIds: [],
    };
  }

  // 2) validar scope adwords
  const scopes = Array.isArray(ga.scope) ? ga.scope : [];
  const hasAdwords = scopes.some(s => String(s).includes('/auth/adwords'));
  if (!hasAdwords) {
    return {
      notAuthorized: true,
      reason: 'MISSING_SCOPE_ADWORDS',
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions:0, clicks:0, cost:0, conversions:0, convValue:0 },
      byCampaign: [],
      series: [],
      accountIds: [],
      hint: 'Re-conecta Google y acepta el permiso Google Ads (/auth/adwords).',
    };
  }

  // 3) access token
  let { accessToken } = await ensureAccessToken(ga);
  if (!accessToken) {
    return {
      notAuthorized: true,
      reason: 'NO_ACCESS_TOKEN',
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions:0, clicks:0, cost:0, conversions:0, convValue:0 },
      byCampaign: [],
      series: [],
      accountIds: [],
    };
  }

  // 4) customers a consultar
  const ids = [];
  if (ga.defaultCustomerId) ids.push(normId(ga.defaultCustomerId));
  for (const c of (ga.customers || [])) {
    const cid = normId(c.id || c.customerId);
    if (cid && !ids.includes(cid)) ids.push(cid);
    if (ids.length >= 2) break; // seguridad
  }
  if (ids.length === 0) {
    return {
      notAuthorized: false,
      reason: 'NO_CUSTOMERS',
      currency: null,
      timeRange: { from: null, to: null },
      kpis: { impressions:0, clicks:0, cost:0, conversions:0, convValue:0 },
      byCampaign: [],
      series: [],
      accountIds: [],
    };
  }

  const loginCustomerId = normId(ga.managerCustomerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
  const since = daysAgoISO(30);
  const until = todayISO();

  // 5) acumuladores
  let G_impr=0, G_clicks=0, G_cost=0, G_conv=0, G_value=0;
  const seriesMap = new Map(); // date -> agg
  const byCampaign = [];
  let currency = null;

  for (const customerId of ids) {
    // currency
    try {
      const info = await getCustomerInfo(accessToken, customerId);
      if (!currency) currency = info.currencyCode || currency;
    } catch (e) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        return {
          notAuthorized: true,
          reason: 'DENIED_OR_BAD_MCC',
          currency: null,
          timeRange: { from: null, to: null },
          kpis: { impressions:0, clicks:0, cost:0, conversions:0, convValue:0 },
          byCampaign: [],
          series: [],
          accountIds: ids,
          hint: 'Verifica MCC (login-customer-id) y vínculo del cliente.',
        };
      }
    }

    const query = `
      SELECT
        segments.date,
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM   campaign
      WHERE  segments.date BETWEEN '${since}' AND '${until}'
      ORDER BY segments.date ASC
    `;

    let rows = [];
    try {
      rows = await gaqlSearchStream({
        accessToken,
        customerId,
        loginCustomerId: loginCustomerId || undefined,
        query,
      });
    } catch (e) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        // 1 reintento con refresh
        try {
          const fresh = await ensureAccessToken({ ...ga, accessToken: null });
          accessToken = fresh.accessToken;
          rows = await gaqlSearchStream({
            accessToken,
            customerId,
            loginCustomerId: loginCustomerId || undefined,
            query,
          });
        } catch {
          return {
            notAuthorized: true,
            reason: 'DENIED_AFTER_REFRESH',
            currency: null,
            timeRange: { from: null, to: null },
            kpis: { impressions:0, clicks:0, cost:0, conversions:0, convValue:0 },
            byCampaign: [],
            series: [],
            accountIds: ids,
          };
        }
      } else {
        // otro error → continuar con otro customer
        continue;
      }
    }

    const limited = rows.slice(0, 2000);
    const byCampAgg = new Map();

    for (const r of limited) {
      const date  = r.segments?.date;
      const campId = r.campaign?.id || null;
      const name  = r.campaign?.name || 'Untitled';

      const impressions = Number(r.metrics?.impressions || 0);
      const clicks      = Number(r.metrics?.clicks || 0);
      const cost        = microsTo(r.metrics?.cost_micros);
      const conversions = Number(r.metrics?.conversions || 0);
      const convValue   = Number(r.metrics?.conversions_value || 0);

      G_impr += impressions; G_clicks += clicks; G_cost += cost; G_conv += conversions; G_value += convValue;

      if (date) {
        const cur = seriesMap.get(date) || { impressions:0, clicks:0, cost:0, conversions:0, conv_value:0 };
        cur.impressions += impressions;
        cur.clicks      += clicks;
        cur.cost        += cost;
        cur.conversions += conversions;
        cur.conv_value  += convValue;
        seriesMap.set(date, cur);
      }

      if (campId) {
        const agg = byCampAgg.get(campId) || { name, impressions:0, clicks:0, cost:0, conversions:0, convValue:0 };
        agg.impressions += impressions;
        agg.clicks      += clicks;
        agg.cost        += cost;
        agg.conversions += conversions;
        agg.convValue   += convValue;
        byCampAgg.set(campId, agg);
      }
    }

    for (const [cid, v] of byCampAgg.entries()) {
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
          cpc:  safeDiv(v.cost, v.clicks),
          cpa:  safeDiv(v.cost, v.conversions),
          roas: safeDiv(v.convValue, v.cost),
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
      cpc:  safeDiv(G_cost, G_clicks),
      cpa:  safeDiv(G_cost, G_conv),
      roas: safeDiv(G_value, G_cost),
    },
    byCampaign,
    series,
    accountIds: ids,
  };
}

module.exports = { collectGoogle };
