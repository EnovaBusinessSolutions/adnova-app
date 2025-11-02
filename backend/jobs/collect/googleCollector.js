// backend/jobs/collect/googleCollector.js
'use strict';

const axios = require('axios');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const ADS_API_VERSION = process.env.GADS_API_VERSION || 'v17';
const ADS_API = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,

  // Acepta ambos nombres para el developer token
  GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_DEVELOPER_TOKEN,

  // Opcional: MCC (login-customer-id)
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
} = process.env;

const DEV_TOKEN = GOOGLE_ADS_DEVELOPER_TOKEN || GOOGLE_DEVELOPER_TOKEN;

// Límite de seguridad del collector (la lógica de “hasta 3” ahora está en auditJob)
const MAX_ACCOUNTS = Number(process.env.GOOGLE_MAX_ACCOUNTS || 12);

/* ---------------- modelos ---------------- */
let GoogleAccount;
try {
  GoogleAccount = require('../../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      accessToken: { type: String, select: false },
      refreshToken: { type: String, select: false },
      scope: { type: [String], default: [] },
      customers: { type: Array, default: [] }, // [{id, descriptiveName, currencyCode, timeZone}]
      ad_accounts: { type: Array, default: [] }, // enriquecidas si existen
      defaultCustomerId: String,
      managerCustomerId: String,
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );
  schema.pre('save', function (n) { this.updatedAt = new Date(); n(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* ---------------- utilidades ---------------- */
const normId   = (s = '') => String(s).replace(/^customers\//,'').replace(/[^\d]/g, '').trim();
const microsTo = (v) => Number(v || 0) / 1_000_000;
const safeDiv  = (n, d) => (Number(d || 0) ? Number(n || 0) / Number(d || 0) : 0);

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

function oauth() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/** Refresca el access token si es necesario y lo persiste */
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
      {
        $set: {
          accessToken: token,
          expiresAt: credentials?.expiry_date ? new Date(credentials.expiry_date) : null,
          updatedAt: new Date(),
        },
      }
    );
  }
  return token;
}

/** Lista customers accesibles (IDs) para el usuario actual */
async function listAccessibleCustomers(accessToken) {
  const { data } = await axios.get(`${ADS_API}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN },
    timeout: 20000,
  });
  const rns = Array.isArray(data?.resourceNames) ? data.resourceNames : [];
  return rns.map((r) => r.split('/')[1]).filter(Boolean);
}

/** Lee metadata de un customer */
async function getCustomer(accessToken, cid, loginCustomerId) {
  const headers = { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN };
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId);
  const { data } = await axios.get(`${ADS_API}/customers/${cid}`, { headers, timeout: 15000 });
  return {
    id: normId(cid),
    resourceName: data?.resourceName || `customers/${cid}`,
    descriptiveName: data?.descriptiveName || null,
    currencyCode: data?.currencyCode || 'USD',
    timeZone: data?.timeZone || null,
  };
}

/** Ejecuta GAQL por streaming y concatena resultados */
async function gaqlSearchStream({ accessToken, customerId, loginCustomerId, query }) {
  const url = `${ADS_API}/customers/${customerId}/googleAds:searchStream`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
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

/** 🔎 Lista hijos directos (nivel 1) de un MCC usando GAQL sobre customer_client */
async function listMccChildren({ accessToken, managerId }) {
  const q = `
    SELECT
      customer_client.client_customer,
      customer_client.descriptive_name,
      customer_client.level,
      customer_client.currency_code,
      customer_client.time_zone
    FROM customer_client
    WHERE customer_client.level = 1
  `;
  const rows = await gaqlSearchStream({
    accessToken,
    customerId: managerId,
    loginCustomerId: managerId,
    query: q,
  });

  const out = [];
  for (const r of rows || []) {
    const res = r.customerClient?.clientCustomer; // "customers/1234567890"
    const id = res ? String(res).split('/')[1] : null;
    if (!id) continue;
    out.push({
      id: normId(id),
      name: r.customerClient?.descriptiveName || null,
      currencyCode: r.customerClient?.currencyCode || null,
      timeZone: r.customerClient?.timeZone || null,
    });
  }
  return out;
}

/* ---------------- collector principal (sin gating) ---------------- */

async function collectGoogle(userId, opts = {}) {
  const { account_id } = opts || {};

  // 0) Developer Token obligatorio
  if (!DEV_TOKEN) {
    return {
      notAuthorized: true,
      reason: 'MISSING_DEVELOPER_TOKEN',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {}, byCampaign: [], series: [], accountIds: [],
      defaultCustomerId: null,
      accounts: [],
    };
  }

  // 1) Trae el GoogleAccount con tokens (usa static del modelo real si existe)
  const gaDoc =
    typeof GoogleAccount.findWithTokens === 'function'
      ? await GoogleAccount.findWithTokens({ $or: [{ user: userId }, { userId }] })
      : await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).select(
          '+accessToken +refreshToken customers ad_accounts defaultCustomerId managerCustomerId scope'
        );

  if (!gaDoc) {
    return {
      notAuthorized: true,
      reason: 'NO_GOOGLEACCOUNT',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {}, byCampaign: [], series: [], accountIds: [],
      defaultCustomerId: null,
      accounts: [],
    };
  }

  const scopes = new Set((gaDoc.scope || []).map(String));
  if (!scopes.has('https://www.googleapis.com/auth/adwords')) {
    return {
      notAuthorized: true,
      reason: 'MISSING_ADWORDS_SCOPE',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {}, byCampaign: [], series: [], accountIds: [],
      defaultCustomerId: gaDoc.defaultCustomerId || null,
      accounts: [],
    };
  }

  // 2) Asegura access token
  let accessToken = await ensureAccessToken(gaDoc);
  if (!accessToken) {
    return {
      notAuthorized: true,
      reason: 'NO_ACCESS_TOKEN',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {}, byCampaign: [], series: [], accountIds: [],
      defaultCustomerId: gaDoc.defaultCustomerId || null,
      accounts: [],
    };
  }

  const loginCustomerIdHeader = normId(gaDoc.managerCustomerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');

  // 3) Descubrir universo de cuentas accesibles (union de guardadas + descubiertas)
  const universeIds = new Set();

  // ad_accounts enriquecidas
  if (Array.isArray(gaDoc.ad_accounts)) {
    for (const a of gaDoc.ad_accounts) {
      const cid = normId(a?.id);
      if (cid) universeIds.add(cid);
    }
  }

  // customers guardados
  if (Array.isArray(gaDoc.customers)) {
    for (const c of gaDoc.customers) {
      const cid = normId(c?.id);
      if (cid) universeIds.add(cid);
    }
  }

  // listAccessibleCustomers
  try {
    const accessible = await listAccessibleCustomers(accessToken);
    for (const id of accessible) universeIds.add(normId(id));
  } catch { /* noop */ }

  // Hijos de MCC si aplica
  if (loginCustomerIdHeader) {
    try {
      const children = await listMccChildren({ accessToken, managerId: loginCustomerIdHeader });
      for (const c of children) universeIds.add(normId(c.id));
      if ((!gaDoc.customers || gaDoc.customers.length === 0) && children.length) {
        await GoogleAccount.updateOne(
          { _id: gaDoc._id },
          { $set: { customers: children, defaultCustomerId: children[0]?.id || gaDoc.defaultCustomerId || null, updatedAt: new Date() } }
        );
      }
    } catch { /* noop */ }
  }

  const allIds = Array.from(universeIds);
  if (allIds.length === 0) {
    return {
      notAuthorized: false,
      reason: 'NO_CUSTOMERS',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {}, byCampaign: [], series: [],
      accountIds: [],
      defaultCustomerId: gaDoc.defaultCustomerId || null,
      accounts: [],
    };
  }

  // 4) Determinar ids a auditar en el collector:
  // - Si mandan account_id → solo ese
  // - Si no, todas las disponibles (cap por MAX_ACCOUNTS)
  const idsToAudit = account_id
    ? [normId(account_id)].filter(Boolean)
    : allIds.slice(0, Math.max(1, MAX_ACCOUNTS));

  // 5) Parámetros globales y acumuladores
  const untilGlobal = todayISO();

  let G = { impr: 0, clk: 0, cost: 0, conv: 0, val: 0 };
  const seriesMap = new Map(); // date -> agg
  const byCampaign = [];
  let currency = 'USD';
  let timeZone = null;
  let lastSinceUsed = null;

  // Para construir "accounts" al final
  const accountsMeta = new Map(); // id -> { name, currencyCode, timeZone }

  // 6) Recorre cada customer a auditar
  for (const customerId of idsToAudit) {
    // currency/timezone/desc por customer
    try {
      const cInfo = await getCustomer(accessToken, customerId, loginCustomerIdHeader);
      accountsMeta.set(customerId, {
        name: cInfo.descriptiveName || `Cuenta ${customerId}`,
        currencyCode: cInfo.currencyCode || null,
        timeZone: cInfo.timeZone || null,
      });
      currency = cInfo.currencyCode || currency;
      timeZone = cInfo.timeZone || timeZone;
    } catch {
      // seguimos aun si falla metadata
      if (!accountsMeta.has(customerId)) {
        accountsMeta.set(customerId, { name: `Cuenta ${customerId}`, currencyCode: null, timeZone: null });
      }
    }

    // — intentos de rango: 30d → 180d → 365d (campañas habilitadas)
    const ranges = [
      { since: daysAgoISO(30),  until: untilGlobal, where: '' },
      { since: daysAgoISO(180), until: untilGlobal, where: '' },
      { since: daysAgoISO(365), until: untilGlobal, where: "AND campaign.status = ENABLED" },
    ];

    let rows = [];
    let gotRows = false;
    let actualSince = ranges[0].since;

    // función ejecutora con reintentos de auth y header MCC
    const runQuery = async (query) => {
      try {
        return await gaqlSearchStream({
          accessToken,
          customerId,
          loginCustomerId: loginCustomerIdHeader || undefined,
          query,
        });
      } catch (e) {
        if (e?.response?.status === 401 || e?.response?.status === 403) {
          accessToken = await ensureAccessToken({ ...(gaDoc.toObject?.() || {}), _id: gaDoc._id, accessToken: null });
          try {
            return await gaqlSearchStream({
              accessToken,
              customerId,
              loginCustomerId: loginCustomerIdHeader || undefined,
              query,
            });
          } catch {
            // Último intento: sin login-customer-id
            return await gaqlSearchStream({ accessToken, customerId, loginCustomerId: undefined, query });
          }
        }
        throw e;
      }
    };

    for (const rg of ranges) {
      const query = `
        SELECT
          segments.date,
          campaign.id,
          campaign.name,
          campaign.advertising_channel_type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${rg.since}' AND '${rg.until}'
        ${rg.where}
        ORDER BY segments.date ASC
      `;
      try {
        rows = await runQuery(query);
        gotRows = Array.isArray(rows) && rows.length > 0;
        actualSince = rg.since;
        if (gotRows) break;
      } catch {
        // probar siguiente rango
      }
    }

    if (!gotRows) continue;

    lastSinceUsed = actualSince;

    const byCampAgg = new Map();

    for (const r of rows.slice(0, 5000)) {
      const d      = r.segments?.date;
      const campId = r.campaign?.id;
      const name   = r.campaign?.name || 'Untitled';
      const chType = r.campaign?.advertisingChannelType || null;

      const impr  = Number(r.metrics?.impressions || 0);
      const clk   = Number(r.metrics?.clicks || 0);
      const cost  = microsTo(r.metrics?.cost_micros);
      const conv  = Number(r.metrics?.conversions || 0);
      const value = Number(r.metrics?.conversions_value || 0);

      G.impr += impr; G.clk += clk; G.cost += cost; G.conv += conv; G.val += value;

      if (d) {
        const cur = seriesMap.get(d) || { impressions: 0, clicks: 0, cost: 0, conversions: 0, conv_value: 0 };
        cur.impressions += impr;
        cur.clicks      += clk;
        cur.cost        += cost;
        cur.conversions += conv;
        cur.conv_value  += value;
        seriesMap.set(d, cur);
      }

      if (campId) {
        const agg =
          byCampAgg.get(campId) || {
            name,
            channel: chType,
            impressions: 0,
            clicks: 0,
            cost: 0,
            conversions: 0,
            convValue: 0,
          };
        agg.impressions += impr;
        agg.clicks      += clk;
        agg.cost        += cost;
        agg.conversions += conv;
        agg.convValue   += value;
        byCampAgg.set(campId, agg);
      }
    }

    // Exporta campañas agregadas del customer
    for (const [cid, v] of byCampAgg.entries()) {
      byCampaign.push({
        account_id: customerId,
        id: cid,
        name: v.name,
        channel: v.channel,
        kpis: {
          impressions: v.impressions,
          clicks: v.clicks,
          cost: v.cost,
          conversions: v.conversions,
          conv_value: v.convValue,
          ctr: safeDiv(v.clicks, v.impressions) * 100,
          cpc: safeDiv(v.cost, v.clicks),
          cpa: safeDiv(v.cost, v.conversions),
          roas: safeDiv(v.convValue, v.cost),
        },
        period: { since: actualSince, until: untilGlobal },
      });
    }
  }

  const series = Array.from(seriesMap.keys())
    .sort()
    .map((d) => ({ date: d, ...seriesMap.get(d) }));

  const sinceGlobal = lastSinceUsed || daysAgoISO(30);
  const untilGlobalFinal = todayISO();

  // Construir listado de cuentas (para UI/LLM)
  const accounts = [];
  for (const cid of (account_id ? [normId(account_id)] : Array.from(new Set(allIds)))) {
    // No es crítico tener name/timezone aquí; auditJob filtra/recostea después.
    accounts.push({
      id: cid,
      name: undefined,
      currency: undefined,
      timezone_name: undefined,
    });
  }

  return {
    notAuthorized: false,
    currency,
    timeZone,
    timeRange: { from: sinceGlobal, to: untilGlobalFinal },
    kpis: {
      impressions: G.impr,
      clicks: G.clk,
      cost: G.cost,
      conversions: G.conv,
      conv_value: G.val,
      ctr: safeDiv(G.clk, G.impr) * 100,
      cpc: safeDiv(G.cost, G.clk),
      cpa: safeDiv(G.cost, G.conv),
      roas: safeDiv(G.val, G.cost),
    },
    byCampaign,
    series,
    accountIds: account_id ? [normId(account_id)] : Array.from(new Set(allIds)), // universo visible para auditJob
    defaultCustomerId: gaDoc.defaultCustomerId ? normId(gaDoc.defaultCustomerId) : null,
    accounts,
    targets: { cpaHigh: 15 },
  };
}

module.exports = { collectGoogle };
