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
  GOOGLE_ADS_LOGIN_CUSTOMER_ID, // opcional (tu MCC)
} = process.env;

/* --------- Modelo resiliente --------- */
let GoogleAccount;
try {
  GoogleAccount = require('../../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    expiresAt: { type: Date },
    scope: { type: [String], default: [] },
    customers: { type: Array, default: [] },
    defaultCustomerId: String,
    managerCustomerId: String,
    objective: { type: String, enum: ['ventas','alcance','leads'], default: null },
    updatedAt: { type: Date, default: Date.now },
  }, { collection: 'googleaccounts' });
  schema.pre('save', function(n){ this.updatedAt = new Date(); n(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* --------- Helpers --------- */
const normId = (s='') => String(s).replace(/-/g,'').trim();
const microsTo = v => Number(v||0)/1_000_000;
const safeDiv  = (n,d) => (Number(d||0) ? Number(n||0)/Number(d||0) : 0);
const todayISO = () => new Date().toISOString().slice(0,10);
const daysAgoISO = (n) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10);
};

function oauth() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

async function ensureAccessToken(gaDoc) {
  if (gaDoc?.accessToken) return gaDoc.accessToken;
  if (!gaDoc?.refreshToken) return null;
  const client = oauth();
  client.setCredentials({ refresh_token: gaDoc.refreshToken });
  const { credentials } = await client.refreshAccessToken();
  const token = credentials?.access_token || null;
  if (token) {
    await GoogleAccount.updateOne(
      { _id: gaDoc._id },
      { $set: {
          accessToken: token,
          expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
          updatedAt: new Date(),
        }
      }
    );
  }
  return token;
}

async function listAccessibleCustomers(accessToken) {
  const { data } = await axios.get(`${ADS_API}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': GOOGLE_DEVELOPER_TOKEN,
    },
    timeout: 20000,
  });
  const rns = Array.isArray(data?.resourceNames) ? data.resourceNames : [];
  return rns.map(r => r.split('/')[1]).filter(Boolean);
}

async function getCustomer(accessToken, cid) {
  const { data } = await axios.get(`${ADS_API}/customers/${cid}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': GOOGLE_DEVELOPER_TOKEN,
    },
    timeout: 15000,
  });
  return {
    id: normId(cid),
    resourceName: data?.resourceName || `customers/${cid}`,
    descriptiveName: data?.descriptiveName || null,
    currencyCode: data?.currencyCode || 'USD',
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

  const { data } = await axios.post(url, { query }, { headers, timeout: 60000 });
  const out = [];
  for (const chunk of (Array.isArray(data) ? data : [])) {
    if (Array.isArray(chunk.results)) out.push(...chunk.results);
  }
  return out;
}

/* --------- Colector principal --------- */
async function collectGoogle(userId) {
  // 1) cargar cuenta y scopes
  const ga = await GoogleAccount.findOne({
    $or: [{ user: userId }, { userId }],
  })
    .select('+accessToken +refreshToken customers defaultCustomerId managerCustomerId scope')
    .lean();

  if (!ga) {
    return { notAuthorized: true, reason: 'NO_GOOGLEACCOUNT', currency: null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], series:[], accountIds:[] };
  }

  const scopes = new Set((ga.scope || []).map(String));
  if (!scopes.has('https://www.googleapis.com/auth/adwords')) {
    return { notAuthorized: true, reason: 'MISSING_ADWORDS_SCOPE', currency: null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], series:[], accountIds:[] };
  }

  // 2) token válido
  let accessToken = await ensureAccessToken(ga);
  if (!accessToken) {
    return { notAuthorized: true, reason: 'NO_ACCESS_TOKEN', currency: null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], series:[], accountIds:[] };
  }

  // 3) elegir customers
  let ids = [];
  if (ga.defaultCustomerId) ids.push(normId(ga.defaultCustomerId));
  for (const c of (ga.customers || [])) {
    const cid = normId(c.id || c.customerId);
    if (cid && !ids.includes(cid)) ids.push(cid);
  }
  if (ids.length === 0) {
    try {
      const discover = await listAccessibleCustomers(accessToken);
      ids = discover.slice(0, 3).map(normId);
      if (ids.length && (!ga.customers || ga.customers.length === 0)) {
        // guarda algunos customers de referencia
        const fetched = await Promise.all(ids.map(cid => getCustomer(accessToken, cid).catch(()=>null)));
        await GoogleAccount.updateOne({ _id: ga._id }, { $set: { customers: fetched.filter(Boolean), updatedAt: new Date() } });
      }
    } catch {}
  }
  if (ids.length === 0) {
    return { notAuthorized: false, reason: 'NO_CUSTOMERS', currency: null, timeRange:{from:null,to:null}, kpis:{}, byCampaign:[], series:[], accountIds:[] };
  }

  const loginCustomerId = normId(ga.managerCustomerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
  const until = todayISO();
  const since = daysAgoISO(30);

  // 4) acumular métricas multi-cuenta
  let G = { impr:0, clk:0, cost:0, conv:0, val:0 };
  const seriesMap = new Map(); // date -> {..}
  const byCampaign = [];
  let currency = 'USD';

  for (const customerId of ids) {
    // currency (no es crítico si falla)
    try {
      const cInfo = await getCustomer(accessToken, customerId);
      currency = cInfo.currencyCode || currency;
    } catch {}

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
      // reintenta refrescando token si fue 401/403
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        accessToken = await ensureAccessToken({ ...ga, accessToken: null });
        rows = await gaqlSearchStream({ accessToken, customerId, loginCustomerId: loginCustomerId || undefined, query });
      } else {
        // sigue con siguiente customer
        continue;
      }
    }

    const byCampAgg = new Map();
    for (const r of rows.slice(0, 3000)) {
      const d = r.segments?.date;
      const campId = r.campaign?.id;
      const name = r.campaign?.name || 'Untitled';

      const impr  = Number(r.metrics?.impressions || 0);
      const clk   = Number(r.metrics?.clicks || 0);
      const cost  = microsTo(r.metrics?.cost_micros);
      const conv  = Number(r.metrics?.conversions || 0);
      const value = Number(r.metrics?.conversions_value || 0);

      G.impr += impr; G.clk += clk; G.cost += cost; G.conv += conv; G.val += value;

      if (d) {
        const cur = seriesMap.get(d) || { impressions:0, clicks:0, cost:0, conversions:0, conv_value:0 };
        cur.impressions += impr; cur.clicks += clk; cur.cost += cost; cur.conversions += conv; cur.conv_value += value;
        seriesMap.set(d, cur);
      }

      if (campId) {
        const agg = byCampAgg.get(campId) || { name, impressions:0, clicks:0, cost:0, conversions:0, convValue:0 };
        agg.impressions += impr; agg.clicks += clk; agg.cost += cost; agg.conversions += conv; agg.convValue += value;
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

  const series = Array.from(seriesMap.keys()).sort().map(d => ({ date:d, ...seriesMap.get(d) }));

  return {
    notAuthorized: false,
    currency,
    timeRange: { from: since, to: until },
    kpis: {
      impressions: G.impr,
      clicks: G.clk,
      cost: G.cost,
      conversions: G.conv,
      convValue: G.val,
      cpc:  safeDiv(G.cost, G.clk),
      cpa:  safeDiv(G.cost, G.conv),
      roas: safeDiv(G.val,  G.cost),
    },
    byCampaign,
    series,
    accountIds: ids,
    targets: { cpaHigh: 15 },
  };
}

module.exports = { collectGoogle };
