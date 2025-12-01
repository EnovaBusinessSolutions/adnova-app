// backend/jobs/collect/googleCollector.js
'use strict';

const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const Ads = require('../../services/googleAdsService');
const logger = require('../../utils/logger');

// ENV
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_DEVELOPER_TOKEN,
} = process.env;

const DEV_TOKEN = GOOGLE_ADS_DEVELOPER_TOKEN || GOOGLE_DEVELOPER_TOKEN;

// Reglas de límites (máx 3 cuentas por auditoría)
const HARD_LIMIT = 3;
const MAX_BY_RULE = Math.min(
  HARD_LIMIT,
  Number(process.env.GADS_AUDIT_MAX || HARD_LIMIT)
);
const MAX_ACCOUNTS_FETCH = Number(process.env.GOOGLE_MAX_ACCOUNTS || 12);

/* ====================== Modelos ====================== */

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
      customers: { type: Array, default: [] },
      ad_accounts: { type: Array, default: [] },
      defaultCustomerId: String,
      managerCustomerId: String,
      loginCustomerId: String,
      expiresAt: Date,
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );
  schema.pre('save', function (n) { this.updatedAt = new Date(); n(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

let UserModel;
try {
  UserModel = require('../../models/User');
} catch (_) {
  const { Schema, model } = mongoose;
  UserModel = mongoose.models.User || model('User', new Schema({}, { strict: false, collection: 'users' }));
}

/* ====================== Utils ====================== */

const normId   = (s = '') => String(s).replace(/^customers\//, '').replace(/[^\d]/g, '').trim();
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
  if (gaDoc?.accessToken && gaDoc?.expiresAt) {
    const ms = new Date(gaDoc.expiresAt).getTime() - Date.now();
    if (ms > 60_000) return gaDoc.accessToken; // válido > 60s
  }

  if (!gaDoc?.refreshToken && !gaDoc?.accessToken) return null;

  const client = oauth();
  client.setCredentials({
    refresh_token: gaDoc?.refreshToken || undefined,
    access_token:  gaDoc?.accessToken  || undefined,
  });

  try {
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
      return token;
    }
  } catch (e) {
    logger.warn('[gadsCollector] refreshAccessToken fallo, intentamos con accessToken existente', {
      error: e?.message || String(e),
    });
  }

  return gaDoc?.accessToken || null;
}

/** Customers accesibles vía helper de Ads (multiusuario, sin MCC obligatorio) */
async function listAccessibleCustomers(accessToken) {
  const rns = await Ads.listAccessibleCustomers(accessToken);
  return (Array.isArray(rns) ? rns : [])
    .map((r) => String(r).split('/').pop())
    .filter(Boolean);
}

/** Metadata básica del customer */
async function getCustomer(accessToken, cid) {
  const data = await Ads.getCustomer(accessToken, cid);
  return {
    id: normId(cid),
    resourceName: data?.resourceName || `customers/${cid}`,
    descriptiveName: data?.descriptiveName || null,
    currencyCode: data?.currencyCode || 'USD',
    timeZone: data?.timeZone || null,
  };
}

function intersect(aSet, ids) {
  const out = [];
  for (const id of ids) if (aSet.has(id)) out.push(id);
  return out;
}

/* ====================== Collector principal ====================== */

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
      kpis: {},
      byCampaign: [],
      byCampaignDevice: [],
      byCampaignNetwork: [],
      series: [],
      accountIds: [],
      defaultCustomerId: null,
      accounts: [],
    };
  }

  // 1) Trae el GoogleAccount con tokens
  const gaDoc =
    typeof GoogleAccount.findWithTokens === 'function'
      ? await GoogleAccount.findWithTokens({ $or: [{ user: userId }, { userId }] })
      : await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).select(
          '+accessToken +refreshToken customers ad_accounts defaultCustomerId managerCustomerId loginCustomerId scope expiresAt'
        );

  if (!gaDoc) {
    return {
      notAuthorized: true,
      reason: 'NO_GOOGLEACCOUNT',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {},
      byCampaign: [],
      byCampaignDevice: [],
      byCampaignNetwork: [],
      series: [],
      accountIds: [],
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
      kpis: {},
      byCampaign: [],
      byCampaignDevice: [],
      byCampaignNetwork: [],
      series: [],
      accountIds: [],
      defaultCustomerId: gaDoc.defaultCustomerId || null,
      accounts: [],
    };
  }

  // 2) Asegura accessToken
  let accessToken = await ensureAccessToken(gaDoc);
  if (!accessToken) {
    return {
      notAuthorized: true,
      reason: 'NO_ACCESS_TOKEN',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {},
      byCampaign: [],
      byCampaignDevice: [],
      byCampaignNetwork: [],
      series: [],
      accountIds: [],
      defaultCustomerId: gaDoc.defaultCustomerId || null,
      accounts: [],
    };
  }

  // 3) Universo de cuentas accesibles (guardadas + discover)
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
  } catch (e) {
    logger.warn('[gadsCollector] listAccessibleCustomers fallo, seguimos con universo guardado', {
      error: e?.message || String(e),
    });
  }

  const universe = Array.from(universeIds).slice(0, MAX_ACCOUNTS_FETCH);

  if (universe.length === 0) {
    return {
      notAuthorized: false,
      reason: 'NO_CUSTOMERS',
      currency: null,
      timeZone: null,
      timeRange: { from: null, to: null },
      kpis: {},
      byCampaign: [],
      byCampaignDevice: [],
      byCampaignNetwork: [],
      series: [],
      accountIds: [],
      defaultCustomerId: gaDoc.defaultCustomerId || null,
      accounts: [],
    };
  }

  // 4) Resolver cuentas a auditar (misma regla que en el panel)
  let idsToAudit = [];

  // 4.a) override explícito
  if (account_id) {
    const forced = normId(account_id);
    if (forced) idsToAudit = [forced];
  }

  // 4.b) selección del usuario
  if (idsToAudit.length === 0 && UserModel && userId) {
    try {
      const user = await UserModel.findById(userId).lean().select('preferences selectedGoogleAccounts');
      let selected = Array.isArray(user?.preferences?.googleAds?.auditCustomerIds)
        ? user.preferences.googleAds.auditCustomerIds
        : (Array.isArray(user?.selectedGoogleAccounts) ? user.selectedGoogleAccounts : []);
      selected = selected.map(normId).filter(Boolean);
      const picked = intersect(new Set(universe), [...new Set(selected)]).slice(0, MAX_BY_RULE);
      if (picked.length) idsToAudit = picked;
    } catch {
      // noop
    }
  }

  // 4.c) sin selección explícita
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

  if (process.env.DEBUG_GOOGLE_COLLECTOR) {
    logger.info('[gadsCollector] userId / universo / idsToAudit', {
      userId: String(userId),
      universe,
      idsToAudit,
    });
  }

  /* ====================== Acumuladores globales ====================== */

  const untilGlobal = todayISO();

  let G = { impr: 0, clk: 0, cost: 0, conv: 0, val: 0, allConv: 0, allVal: 0 };
  const seriesMap = new Map(); // date -> agg

  let currency = 'USD';
  let timeZone = null;
  let lastSinceUsed = null;

  const accountsMeta = new Map(); // id -> { name, currencyCode, timeZone }
  const byAccountAgg = new Map(); // id -> agg kpis

  const byCampaign = [];          // Dejamos vacío por ahora (sin GAQL manual)
  const byCampaignDevice = [];
  const byCampaignNetwork = [];

  /* ====================== Loop por cuenta (fetchInsights) ====================== */

  for (const customerId of idsToAudit) {
    // 1) Metadata básica del customer
    try {
      const cInfo = await getCustomer(accessToken, customerId);
      accountsMeta.set(customerId, {
        name: cInfo.descriptiveName || `Cuenta ${customerId}`,
        currencyCode: cInfo.currencyCode || null,
        timeZone: cInfo.timeZone || null,
      });
      currency = cInfo.currencyCode || currency;
      timeZone = cInfo.timeZone || timeZone;
    } catch (e) {
      logger.warn('[gadsCollector] getCustomer fallo, usamos metadata mínima', {
        customerId,
        error: e?.message || String(e),
      });
      if (!accountsMeta.has(customerId)) {
        accountsMeta.set(customerId, { name: `Cuenta ${customerId}`, currencyCode: null, timeZone: null });
      }
    }

    // 2) Traer métricas reales usando EXACTAMENTE el mismo helper que el panel
    let payload;
    try {
      payload = await Ads.fetchInsights({
        accessToken,
        customerId,
        datePreset: 'last_30d',
        range: null,
        includeToday: false,
        objective: 'ventas',
        compareMode: null,
      });
    } catch (e) {
      // Si es error de auth, intentamos refrescar una vez
      if (e?.status === 401 || e?.status === 403) {
        logger.warn('[gadsCollector] fetchInsights auth error, reintentando con token refrescado', {
          customerId,
          status: e?.status,
        });
        accessToken = await ensureAccessToken(gaDoc);
        if (accessToken) {
          try {
            payload = await Ads.fetchInsights({
              accessToken,
              customerId,
              datePreset: 'last_30d',
              range: null,
              includeToday: false,
              objective: 'ventas',
              compareMode: null,
            });
          } catch (err2) {
            logger.error('[gadsCollector] fetchInsights fallo incluso tras refrescar token', {
              customerId,
              status: err2?.status,
              detail: err2?.response?.data || err2?.api?.error || err2.message,
            });
            continue; // saltamos esta cuenta
          }
        } else {
          continue;
        }
      } else {
        logger.error('[gadsCollector] fetchInsights error', {
          customerId,
          status: e?.status,
          detail: e?.response?.data || e?.api?.error || e.message,
        });
        continue;
      }
    }

    if (!payload || !payload.kpis) {
      logger.warn('[gadsCollector] payload vacío o sin kpis para account', { customerId });
      continue;
    }

    const k = payload.kpis || {};

    const impr = Number(k.impressions || 0);
    const clk  = Number(k.clicks || 0);
    const cost = Number(k.cost || 0);
    const conv = Number(k.conversions || 0);
    const val  = Number(k.conv_value || k.conversions_value || 0);
    const allC = Number(k.all_conversions || 0);
    const allV = Number(k.all_conv_value || k.all_conversions_value || 0);

    // Totales globales
    G.impr += impr;
    G.clk  += clk;
    G.cost += cost;
    G.conv += conv;
    G.val  += val;
    G.allConv += allC;
    G.allVal  += allV;

    // Serie diaria global (si el helper la trae)
    const seriesArr = Array.isArray(payload.series) ? payload.series : [];
    for (const p of seriesArr) {
      const d = p.date || p.day || p.segment_date || p['segments.date'];
      if (!d) continue;
      const cur = seriesMap.get(d) || {
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0,
        conv_value: 0,
        all_conversions: 0,
        all_conv_value: 0,
      };
      cur.impressions      += Number(p.impressions || 0);
      cur.clicks           += Number(p.clicks || 0);
      cur.cost             += Number(p.cost || 0);
      cur.conversions      += Number(p.conversions || 0);
      cur.conv_value       += Number(p.conv_value || p.conversions_value || 0);
      cur.all_conversions  += Number(p.all_conversions || 0);
      cur.all_conv_value   += Number(p.all_conv_value || p.all_conversions_value || 0);
      seriesMap.set(d, cur);
    }

    lastSinceUsed = payload?.timeRange?.from
      || payload?.range?.from
      || payload?.dateRange?.from
      || daysAgoISO(30);

    // KPI agregados por cuenta
    const accAgg = {
      impressions: impr,
      clicks: clk,
      cost,
      conversions: conv,
      convValue: val,
      allConversions: allC,
      allConvValue: allV,
    };
    byAccountAgg.set(customerId, accAgg);

    if (process.env.DEBUG_GOOGLE_COLLECTOR) {
      logger.info('[gadsCollector] account payload para auditoría', {
        customerId,
        kpis: accAgg,
        timeRange: payload.timeRange || payload.range || payload.dateRange || null,
      });
    }

    // NOTA: si en el futuro Ads.fetchInsights devuelve campañas,
    // aquí podríamos mapear a byCampaign / byCampaignDevice / byCampaignNetwork.
  }

  // Serie final ordenada
  const series = Array.from(seriesMap.keys())
    .sort()
    .map((d) => ({ date: d, ...seriesMap.get(d) }));

  const sinceGlobal = lastSinceUsed || daysAgoISO(30);
  const untilGlobalFinal = todayISO();

  // Construir listado de cuentas con KPIs por cuenta
  const accounts = idsToAudit.map((cid) => {
    const m = accountsMeta.get(cid) || {};
    const agg = byAccountAgg.get(cid) || {
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      convValue: 0,
      allConversions: 0,
      allConvValue: 0,
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
    byCampaign,          // de momento vacío (sin GAQL manual)
    byCampaignDevice,
    byCampaignNetwork,
    series,
    accountIds: idsToAudit,
    defaultCustomerId: gaDoc.defaultCustomerId ? normId(gaDoc.defaultCustomerId) : null,
    accounts,
    targets: { cpaHigh: 15 },
    version: 'gadsCollector@fetchInsights-no-mcc',
  };
}

module.exports = { collectGoogle };
