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

// [★] Límite duro por requerimiento (3). Se puede “bajar” por env, pero nunca >3.
const HARD_LIMIT = 3;
const MAX_BY_RULE = Math.min(
  HARD_LIMIT,
  Number(process.env.GADS_AUDIT_MAX || HARD_LIMIT)
);

// Límite de seguridad de requests (no afecta la regla 3 máx. para auditoría)
const MAX_ACCOUNTS_FETCH = Number(process.env.GOOGLE_MAX_ACCOUNTS || 12);

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

// [★] Leer preferencia/selección guardada en User.preferences.googleAds.auditCustomerIds
let UserModel = null;
try { UserModel = require('../../models/User'); } catch (_) {
  const { Schema, model } = mongoose;
  UserModel = mongoose.models.User || model('User', new Schema({}, { strict: false, collection: 'users' }));
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

/* ---------------- helpers selección (respeta preferencias) ---------------- */

function intersect(aSet, ids) {
  const out = [];
  for (const id of ids) if (aSet.has(id)) out.push(id);
  return out;
}

/* ---------------- collector principal ---------------- */

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
      defaultCustomerId: null, accounts: [],
    };
  }

  // 1) Trae el GoogleAccount con tokens
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
      defaultCustomerId: null, accounts: [],
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
      defaultCustomerId: gaDoc.defaultCustomerId || null, accounts: [],
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
      defaultCustomerId: gaDoc.defaultCustomerId || null, accounts: [],
    };
  }

  const loginCustomerIdHeader = normId(gaDoc.managerCustomerId || GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');

  // 3) Descubrir universo de cuentas accesibles (unión de guardadas + descubiertas)
  const universeIds = new Set();

  if (Array.isArray(gaDoc.ad_accounts)) {
    for (const a of gaDoc.ad_accounts) {
      const cid = normId(a?.id);
      if (cid) universeIds.add(cid);
    }
  }
  if (Array.isArray(gaDoc.customers)) {
    for (const c of gaDoc.customers) {
      const cid = normId(c?.id);
      if (cid) universeIds.add(cid);
    }
  }
  try {
    const accessible = await listAccessibleCustomers(accessToken);
    for (const id of accessible) universeIds.add(normId(id));
  } catch { /* noop */ }

  if (loginCustomerIdHeader) {
    try {
      const children = await listMccChildren({ accessToken, managerId: loginCustomerIdHeader });
      for (const c of children) universeIds.add(normId(c.id));
      // persistir si no tenías customers guardados
      if ((!gaDoc.customers || gaDoc.customers.length === 0) && children.length) {
        await GoogleAccount.updateOne(
          { _id: gaDoc._id },
          {
            $set: {
              customers: children,
              defaultCustomerId: children[0]?.id || gaDoc.defaultCustomerId || null,
              updatedAt: new Date()
            }
          }
        );
      }
    } catch { /* noop */ }
  }

  const universe = Array.from(universeIds).slice(0, MAX_ACCOUNTS_FETCH);
  if (universe.length === 0) {
    return {
      notAuthorized: false,
      reason: 'NO_CUSTOMERS',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {}, byCampaign: [], series: [],
      accountIds: [], defaultCustomerId: gaDoc.defaultCustomerId || null, accounts: [],
    };
  }

  // 4) Resolver cuentas a auditar
  let idsToAudit = [];

  // 4.a) override del caller
  if (account_id) {
    const forced = normId(account_id);
    if (forced) idsToAudit = [forced];
  }

  // 4.b) si no hay override, usar selección de usuario si existe
  if (idsToAudit.length === 0 && UserModel && userId) {
    try {
      const user = await UserModel.findById(userId).lean().select('preferences selectedGoogleAccounts');
      // preferencia nueva y alias legado
      let selected = Array.isArray(user?.preferences?.googleAds?.auditCustomerIds)
        ? user.preferences.googleAds.auditCustomerIds
        : (Array.isArray(user?.selectedGoogleAccounts) ? user.selectedGoogleAccounts : []);
      selected = selected.map(normId).filter(Boolean);
      const picked = intersect(new Set(universe), [...new Set(selected)]).slice(0, MAX_BY_RULE);
      if (picked.length) idsToAudit = picked;
    } catch { /* noop */ }
  }

  // 4.c) sin selección: si universo <=3, usa todas; si >3, pedimos selección explícita
  if (idsToAudit.length === 0) {
    if (universe.length <= MAX_BY_RULE) {
      idsToAudit = universe;
    } else {
      return {
        notAuthorized: true,
        reason: 'SELECTION_REQUIRED(>3_CUSTOMERS)',
        requiredSelection: true,
        availableCount: universe.length,
        accountIds: universe,
        defaultCustomerId: gaDoc.defaultCustomerId ? normId(gaDoc.defaultCustomerId) : null,
      };
    }
  }

  // 5) Parámetros globales y acumuladores
  const untilGlobal = todayISO();

  let G = { impr: 0, clk: 0, cost: 0, conv: 0, val: 0, allConv: 0, allVal: 0 };
  const seriesMap = new Map(); // date -> agg
  const byCampaign = [];
  const byCampaignDevice = [];   // 👈 nuevo
  const byCampaignNetwork = [];  // 👈 nuevo

  let currency = 'USD';
  let timeZone = null;
  let lastSinceUsed = null;

  // Para construir "accounts" y KPI por cuenta al final
  const accountsMeta = new Map();   // id -> { name, currencyCode, timeZone }
  const byAccountAgg = new Map();   // id -> agg kpis

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
          segments.device,
          segments.ad_network_type,
          campaign.id,
          campaign.name,
          campaign.advertising_channel_type,
          campaign.advertising_channel_sub_type,
          campaign.status,
          campaign.serving_status,
          campaign.bidding_strategy_type,
          campaign.target_cpa_micros,
          campaign.target_roas,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.all_conversions,
          metrics.all_conversions_value
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
      } catch { /* probar siguiente rango */ }
    }

    if (!gotRows) continue;

    lastSinceUsed = actualSince;

    const byCampAgg = new Map();
    const byCampDeviceAgg = new Map();   // campId::device -> agg
    const byCampNetworkAgg = new Map();  // campId::network -> agg

    for (const r of rows.slice(0, 5000)) {
      const d      = r.segments?.date;
      const device = r.segments?.device || null;
      const network = r.segments?.adNetworkType || null;

      const campId = r.campaign?.id;
      const name   = r.campaign?.name || 'Untitled';
      const chType = r.campaign?.advertisingChannelType || null;
      const chSub  = r.campaign?.advertisingChannelSubType || null;
      const status = r.campaign?.status || null;
      const servingStatus = r.campaign?.servingStatus || null;
      const biddingType = r.campaign?.biddingStrategyType || null;
      const targetCpaMicros = r.campaign?.targetCpaMicros ?? null;
      const targetRoas = r.campaign?.targetRoas ?? null;

      const impr  = Number(r.metrics?.impressions || 0);
      const clk   = Number(r.metrics?.clicks || 0);
      const cost  = microsTo(r.metrics?.costMicros ?? r.metrics?.cost_micros);
      const conv  = Number(
        r.metrics?.conversions ??
        r.metrics?.conversions_value ?? // por si llegaron mal mapeados
        r.metrics?.conversionsValue ??
        0
      );
      const convValue = Number(
        r.metrics?.conversions_value ??
        r.metrics?.conversionsValue ??
        0
      );
      const allConv = Number(r.metrics?.allConversions ?? r.metrics?.all_conversions ?? 0);
      const allVal  = Number(r.metrics?.allConversionsValue ?? r.metrics?.all_conversions_value ?? 0);

      // totales globales (todas las cuentas)
      G.impr += impr; G.clk += clk; G.cost += cost; G.conv += conv; G.val += convValue;
      G.allConv += allConv; G.allVal += allVal;

      // serie diaria global
      if (d) {
        const cur = seriesMap.get(d) || {
          impressions: 0, clicks: 0, cost: 0,
          conversions: 0, conv_value: 0,
          all_conversions: 0, all_conv_value: 0
        };
        cur.impressions += impr;
        cur.clicks      += clk;
        cur.cost        += cost;
        cur.conversions += conv;
        cur.conv_value  += convValue;
        cur.all_conversions  += allConv;
        cur.all_conv_value   += allVal;
        seriesMap.set(d, cur);
      }

      // agregación por campaña
      if (campId) {
        const agg =
          byCampAgg.get(campId) || {
            name,
            channel: chType,
            channelSubType: chSub,
            status,
            servingStatus,
            bidding: {
              type: biddingType,
              target_cpa: targetCpaMicros != null ? microsTo(targetCpaMicros) : null,
              target_roas: targetRoas != null ? Number(targetRoas) : null,
            },
            impressions: 0,
            clicks: 0,
            cost: 0,
            conversions: 0,
            convValue: 0,
            allConversions: 0,
            allConvValue: 0,
          };
        agg.impressions    += impr;
        agg.clicks         += clk;
        agg.cost           += cost;
        agg.conversions    += conv;
        agg.convValue      += convValue;
        agg.allConversions += allConv;
        agg.allConvValue   += allVal;
        byCampAgg.set(campId, agg);

        // desglose por dispositivo
        if (device) {
          const key = `${campId}::${device}`;
          const dv = byCampDeviceAgg.get(key) || {
            device,
            impressions: 0, clicks: 0, cost: 0,
            conversions: 0, convValue: 0,
            allConversions: 0, allConvValue: 0,
          };
          dv.impressions    += impr;
          dv.clicks         += clk;
          dv.cost           += cost;
          dv.conversions    += conv;
          dv.convValue      += convValue;
          dv.allConversions += allConv;
          dv.allConvValue   += allVal;
          byCampDeviceAgg.set(key, dv);
        }

        // desglose por red (Search, Display, YouTube, etc.)
        if (network) {
          const key = `${campId}::${network}`;
          const nw = byCampNetworkAgg.get(key) || {
            network,
            impressions: 0, clicks: 0, cost: 0,
            conversions: 0, convValue: 0,
            allConversions: 0, allConvValue: 0,
          };
          nw.impressions    += impr;
          nw.clicks         += clk;
          nw.cost           += cost;
          nw.conversions    += conv;
          nw.convValue      += convValue;
          nw.allConversions += allConv;
          nw.allConvValue   += allVal;
          byCampNetworkAgg.set(key, nw);
        }
      }
    }

    // Exporta campañas agregadas del customer
    for (const [cid, v] of byCampAgg.entries()) {
      byCampaign.push({
        account_id: customerId,
        id: cid,
        name: v.name,
        channel: v.channel,
        channelSubType: v.channelSubType || null,
        status: v.status || null,
        servingStatus: v.servingStatus || null,
        bidding: v.bidding || null,
        kpis: {
          impressions: v.impressions,
          clicks: v.clicks,
          cost: v.cost,
          conversions: v.conversions,
          conv_value: v.convValue,
          all_conversions: v.allConversions,
          all_conv_value: v.allConvValue,
          ctr: safeDiv(v.clicks, v.impressions) * 100,
          cpc: safeDiv(v.cost, v.clicks),
          cpa: safeDiv(v.cost, v.conversions),
          roas: safeDiv(v.convValue, v.cost),
          all_roas: safeDiv(v.allConvValue, v.cost),
        },
        period: { since: actualSince, until: untilGlobal },
        accountMeta: accountsMeta.get(customerId) || null,
      });
    }

    // Exporta desglose por dispositivo
    for (const [key, v] of byCampDeviceAgg.entries()) {
      const [campId] = key.split('::');
      byCampaignDevice.push({
        account_id: customerId,
        campaign_id: campId,
        device: v.device,
        kpis: {
          impressions: v.impressions,
          clicks: v.clicks,
          cost: v.cost,
          conversions: v.conversions,
          conv_value: v.convValue,
          all_conversions: v.allConversions,
          all_conv_value: v.allConvValue,
          ctr: safeDiv(v.clicks, v.impressions) * 100,
          cpc: safeDiv(v.cost, v.clicks),
          cpa: safeDiv(v.cost, v.conversions),
          roas: safeDiv(v.convValue, v.cost),
          all_roas: safeDiv(v.allConvValue, v.cost),
        },
        period: { since: actualSince, until: untilGlobal },
      });
    }

    // Exporta desglose por red
    for (const [key, v] of byCampNetworkAgg.entries()) {
      const [campId] = key.split('::');
      byCampaignNetwork.push({
        account_id: customerId,
        campaign_id: campId,
        network: v.network,
        kpis: {
          impressions: v.impressions,
          clicks: v.clicks,
          cost: v.cost,
          conversions: v.conversions,
          conv_value: v.convValue,
          all_conversions: v.allConversions,
          all_conv_value: v.allConvValue,
          ctr: safeDiv(v.clicks, v.impressions) * 100,
          cpc: safeDiv(v.cost, v.clicks),
          cpa: safeDiv(v.cost, v.conversions),
          roas: safeDiv(v.convValue, v.cost),
          all_roas: safeDiv(v.allConvValue, v.cost),
        },
        period: { since: actualSince, until: untilGlobal },
      });
    }

    // KPI por cuenta (suma de campañas)
    let accAgg = byAccountAgg.get(customerId) || {
      impressions: 0, clicks: 0, cost: 0,
      conversions: 0, convValue: 0,
      allConversions: 0, allConvValue: 0,
    };
    for (const [, v] of byCampAgg.entries()) {
      accAgg.impressions    += v.impressions;
      accAgg.clicks         += v.clicks;
      accAgg.cost           += v.cost;
      accAgg.conversions    += v.conversions;
      accAgg.convValue      += v.convValue;
      accAgg.allConversions += v.allConversions;
      accAgg.allConvValue   += v.allConvValue;
    }
    byAccountAgg.set(customerId, accAgg);
  }

  const series = Array.from(seriesMap.keys())
    .sort()
    .map((d) => ({ date: d, ...seriesMap.get(d) }));

  const sinceGlobal = lastSinceUsed || daysAgoISO(30);
  const untilGlobalFinal = todayISO();

  // Construir listado de cuentas (para UI/LLM) con KPI por cuenta
  const accounts = idsToAudit.map(cid => {
    const m = accountsMeta.get(cid) || {};
    const agg = byAccountAgg.get(cid) || {
      impressions: 0, clicks: 0, cost: 0,
      conversions: 0, convValue: 0,
      allConversions: 0, allConvValue: 0,
    };
    return {
      id: cid,
      name: m.name || `Cuenta ${cid}`,
      currency: m.currencyCode || null,
      timezone_name: m.timeZone || null,
      kpis: {
        impressions: agg.impressions,
        clicks: agg.clicks,
        cost: agg.cost,
        conversions: agg.conversions,
        conv_value: agg.convValue,
        all_conversions: agg.allConversions,
        all_conv_value: agg.allConvValue,
        ctr: safeDiv(agg.clicks, agg.impressions) * 100,
        cpc: safeDiv(agg.cost, agg.clicks),
        cpa: safeDiv(agg.cost, agg.conversions),
        roas: safeDiv(agg.convValue, agg.cost),
        all_roas: safeDiv(agg.allConvValue, agg.cost),
      },
    };
  });

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
      all_conversions: G.allConv,
      all_conv_value: G.allVal,
      ctr: safeDiv(G.clk, G.impr) * 100,
      cpc: safeDiv(G.cost, G.clk),
      cpa: safeDiv(G.cost, G.conv),
      roas: safeDiv(G.val, G.cost),
      all_roas: safeDiv(G.allVal, G.cost),
    },
    byCampaign,
    byCampaignDevice,   // 👈 NUEVO: desglose por dispositivo
    byCampaignNetwork,  // 👈 NUEVO: desglose por red
    series,
    accountIds: idsToAudit, // <- las realmente auditadas (máx. 3)
    defaultCustomerId: gaDoc.defaultCustomerId ? normId(gaDoc.defaultCustomerId) : null,
    accounts, // [{id,name,currency,timezone_name,kpis}] para distribuir recomendaciones
    targets: { cpaHigh: 15 },
    version: 'gadsCollector@multi-accounts+status',
  };
}

module.exports = { collectGoogle };
