// backend/jobs/collect/googleCollector.js
'use strict';

const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const Ads = require('../../services/googleAdsService');
const logger = require('../../utils/logger');

/* ====================== ENV ====================== */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,
  GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_DEVELOPER_TOKEN,
} = process.env;

const DEV_TOKEN = GOOGLE_ADS_DEVELOPER_TOKEN || GOOGLE_DEVELOPER_TOKEN;

/* ====================== Reglas de límites ====================== */
// máx 3 cuentas por auditoría (hard)
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

  schema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
  });

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
const normId = (s = '') =>
  String(s)
    .replace(/^customers\//, '')
    .replace(/[^\d]/g, '')
    .trim();

const safeDiv = (n, d) => (Number(d || 0) ? Number(n || 0) / Number(d || 0) : 0);

/**
 * ⚠️ IMPORTANTE:
 * Para alinear 1:1 con Google Ads UI:
 * - acumular SIEMPRE costo en micros (enteros)
 * - convertir y redondear a 2 decimales SOLO al final
 */
const round2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;
const microsToCurrency = (micros) => round2(Number(micros || 0) / 1_000_000);

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

/**
 * Formatea YYYY-MM-DD en una zona horaria (evita adelantarse por UTC)
 */
function isoInTZ(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
}

/**
 * Rango estricto N días completos:
 * - termina AYER en TZ del customer
 */
function getStrictLastNdRangeTZ(timeZone, days) {
  const now = new Date();
  const end = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const endISO = isoInTZ(end, timeZone);

  const d = clampInt(days || 30, 1, 3650);
  const start = new Date(end.getTime() - (d - 1) * 24 * 60 * 60 * 1000);
  const startISO = isoInTZ(start, timeZone);

  return { since: startISO, until: endISO };
}

function oauth() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/**
 * Refresca el access token si es necesario y lo persiste
 */
async function ensureAccessToken(gaDoc) {
  if (gaDoc?.accessToken && gaDoc?.expiresAt) {
    const ms = new Date(gaDoc.expiresAt).getTime() - Date.now();
    if (ms > 60_000) return gaDoc.accessToken;
  }

  if (!gaDoc?.refreshToken && !gaDoc?.accessToken) return null;

  const client = oauth();
  client.setCredentials({
    refresh_token: gaDoc?.refreshToken || undefined,
    access_token: gaDoc?.accessToken || undefined,
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

/**
 * Customers accesibles
 */
async function listAccessibleCustomers(accessToken) {
  const rns = await Ads.listAccessibleCustomers(accessToken);
  return (Array.isArray(rns) ? rns : [])
    .map((r) => String(r).split('/').pop())
    .filter(Boolean);
}

/**
 * Metadata básica del customer
 */
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

/* ====================== Objective (derivado) ====================== */
function deriveGoogleCampaignObjective({ channelType, channelSubType, biddingStrategyType }) {
  const ct = String(channelType || '').toUpperCase();
  const cst = String(channelSubType || '').toUpperCase();
  const bst = String(biddingStrategyType || '').toUpperCase();

  if (ct === 'PERFORMANCE_MAX' || cst.includes('SHOPPING') || ct === 'SHOPPING') return 'SALES';
  if (bst.includes('MAXIMIZE_CONVERSION_VALUE') || bst.includes('TARGET_ROAS')) return 'SALES';
  if (bst.includes('MAXIMIZE_CONVERSIONS') || bst.includes('TARGET_CPA')) return 'LEADS';
  if (bst.includes('MAXIMIZE_CLICKS')) return 'TRAFFIC';
  if (bst.includes('TARGET_IMPRESSION_SHARE') || bst.includes('TARGET_CPM') || bst.includes('MANUAL_CPM')) return 'AWARENESS';
  if (ct === 'VIDEO' || bst.includes('MANUAL_CPV') || bst.includes('TARGET_CPV')) return 'VIDEO_VIEWS';
  if (ct === 'DISPLAY') return 'AWARENESS';
  return 'OTHER';
}

/* ====================== GAQL por campañas ====================== */
async function accumulateCampaignBreakdowns({
  accessToken,
  customerId,
  since,
  until,
  byCampaignMap,
  byCampaignDeviceMap,
  byCampaignNetworkMap,
  byDateMap, // NEW: date -> agg micros
}) {
  const cid = normId(customerId);
  if (!cid || !since || !until) return;

  const GAQL = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
      campaign.bidding_strategy_type,
      segments.date,
      segments.device,
      segments.ad_network_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE
      segments.date BETWEEN '${since}' AND '${until}'
      AND metrics.impressions > 0
    ORDER BY metrics.impressions DESC
  `.trim();

  let rows;
  try {
    rows = await Ads.searchGAQLStream(accessToken, cid, GAQL);
  } catch (e) {
    logger.error('[gadsCollector] campaigns GAQL error', {
      customerId: cid,
      status: e?.status,
      code: e?.code,
      message: e?.message,
      apiError: e?.data?.error || e?.api?.error,
    });
    return;
  }

  for (const r of rows) {
    const camp = r.campaign || {};
    const seg = r.segments || {};
    const met = r.metrics || {};

    const id = normId(camp.id);
    if (!id) continue;

    const name = camp.name || `Campaña ${id || '?'}`;
    const status = camp.status || 'UNSPECIFIED';

    const channelType =
      camp.advertisingChannelType ||
      camp.advertising_channel_type ||
      camp.advertisingChannelTypeEnum ||
      null;

    const channelSubType = camp.advertisingChannelSubType || camp.advertising_channel_sub_type || null;
    const biddingStrategyType = camp.biddingStrategyType || camp.bidding_strategy_type || null;

    const objective = deriveGoogleCampaignObjective({ channelType, channelSubType, biddingStrategyType });

    const date = seg.date || seg['segments.date'] || null;
    const impressions = Number(met.impressions || 0);
    const clicks = Number(met.clicks || 0);

    const costMicros = met.costMicros ?? met.cost_micros ?? 0;
    const costMicrosNum = Number(costMicros || 0);

    const conversions = Number(met.conversions || 0);
    const conv_value = Number(met.conversionsValue ?? met.conversions_value ?? 0);

    const device = seg.device || 'UNSPECIFIED';
    const network = seg.adNetworkType || seg.ad_network_type || 'UNSPECIFIED';

    // --- Por campaña ---
    const keyC = `${cid}|${id}`;
    let c = byCampaignMap.get(keyC);

    if (!c) {
      c = {
        account_id: cid,
        campaign_id: id,
        name,
        status,
        channelType: channelType ? String(channelType) : null,
        channelSubType: channelSubType ? String(channelSubType) : null,
        biddingStrategyType: biddingStrategyType ? String(biddingStrategyType) : null,
        objective,
        impressions: 0,
        clicks: 0,
        cost_micros: 0,
        conversions: 0,
        conv_value: 0,
      };
      byCampaignMap.set(keyC, c);
    }

    c.impressions += impressions;
    c.clicks += clicks;
    c.cost_micros += costMicrosNum;
    c.conversions += conversions;
    c.conv_value += conv_value;

    // --- Por campaña + device ---
    const keyD = `${cid}|${id}|${device}`;
    let d = byCampaignDeviceMap.get(keyD);

    if (!d) {
      d = {
        account_id: cid,
        campaign_id: id,
        campaignName: name,
        device,
        objective,
        impressions: 0,
        clicks: 0,
        cost_micros: 0,
        conversions: 0,
        conv_value: 0,
      };
      byCampaignDeviceMap.set(keyD, d);
    }

    d.impressions += impressions;
    d.clicks += clicks;
    d.cost_micros += costMicrosNum;
    d.conversions += conversions;
    d.conv_value += conv_value;

    // --- Por campaña + network ---
    const keyN = `${cid}|${id}|${network}`;
    let n = byCampaignNetworkMap.get(keyN);

    if (!n) {
      n = {
        account_id: cid,
        campaign_id: id,
        campaignName: name,
        network,
        objective,
        impressions: 0,
        clicks: 0,
        cost_micros: 0,
        conversions: 0,
        conv_value: 0,
      };
      byCampaignNetworkMap.set(keyN, n);
    }

    n.impressions += impressions;
    n.clicks += clicks;
    n.cost_micros += costMicrosNum;
    n.conversions += conversions;
    n.conv_value += conv_value;

    // --- Daily agg (account-level) ---
    if (date) {
      const key = `${cid}|${date}`;
      const cur = byDateMap.get(key) || {
        account_id: cid,
        date,
        impressions: 0,
        clicks: 0,
        cost_micros: 0,
        conversions: 0,
        conv_value: 0,
      };
      cur.impressions += impressions;
      cur.clicks += clicks;
      cur.cost_micros += costMicrosNum;
      cur.conversions += conversions;
      cur.conv_value += conv_value;
      byDateMap.set(key, cur);
    }
  }
}

/* ====================== Compact helpers ====================== */
function makeGoogleHeader({ userId, accountIds, accounts, range, currency, timeZone, version }) {
  return {
    schema: 'adray.mcp.v1',
    source: 'googleAds',
    generatedAt: new Date().toISOString(),
    userId: String(userId),
    accountIds: Array.isArray(accountIds) ? accountIds : [],
    accounts: Array.isArray(accounts) ? accounts : [],
    range,
    currency: currency || null,
    timeZone: timeZone || null,
    version: version || null,
  };
}

function computeDeltas(cur, prev) {
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : (a ? 100 : 0));
  return {
    cost_pct: pct(cur.cost, prev.cost),
    impressions_pct: pct(cur.impressions, prev.impressions),
    clicks_pct: pct(cur.clicks, prev.clicks),
    conversions_pct: pct(cur.conversions, prev.conversions),
    conv_value_pct: pct(cur.conv_value, prev.conv_value),
    roas_diff: (cur.roas || 0) - (prev.roas || 0),
    cpa_diff: (cur.cpa || 0) - (prev.cpa || 0),
  };
}

function topN(arr, n, scoreFn) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  a.sort((x, y) => scoreFn(y) - scoreFn(x));
  return a.slice(0, Math.max(0, n));
}

function slimCampaignRow(c) {
  const cost = microsToCurrency(c.cost_micros);
  const impressions = Number(c.impressions || 0);
  const clicks = Number(c.clicks || 0);
  const conversions = Number(c.conversions || 0);
  const conv_value = Number(c.conv_value || 0);

  return {
    account_id: c.account_id,
    campaign_id: c.campaign_id,
    name: c.name || c.campaignName || null,
    objective: c.objective || null,
    status: c.status || null,
    kpis: {
      cost,
      impressions,
      clicks,
      conversions,
      conv_value,
      ctr: safeDiv(clicks, impressions) * 100,
      cpc: safeDiv(cost, clicks),
      cpa: safeDiv(cost, conversions),
      roas: safeDiv(conv_value, cost),
    },
  };
}

function aggregateTopBreakdown(rows, keyField, topNCount) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = String(r?.[keyField] || '').trim();
    if (!key) continue;

    const cur = map.get(key) || {
      key,
      impressions: 0,
      clicks: 0,
      cost_micros: 0,
      conversions: 0,
      conv_value: 0,
    };
    cur.impressions += Number(r.impressions || 0);
    cur.clicks += Number(r.clicks || 0);
    cur.cost_micros += Number(r.cost_micros || 0);
    cur.conversions += Number(r.conversions || 0);
    cur.conv_value += Number(r.conv_value || 0);
    map.set(key, cur);
  }

  const arr = Array.from(map.values()).map((x) => {
    const cost = microsToCurrency(x.cost_micros);
    return {
      key: x.key,
      kpis: {
        cost,
        impressions: x.impressions,
        clicks: x.clicks,
        conversions: x.conversions,
        conv_value: x.conv_value,
        ctr: safeDiv(x.clicks, x.impressions) * 100,
        cpc: safeDiv(cost, x.clicks),
        cpa: safeDiv(cost, x.conversions),
        roas: safeDiv(x.conv_value, cost),
      },
    };
  });

  arr.sort((a, b) => (b.kpis.cost - a.kpis.cost));
  return arr.slice(0, Math.max(0, topNCount || 10));
}

/* ====================== Collector principal ====================== */
async function collectGoogle(userId, opts = {}) {
  const {
    account_id,

    // NEW: windows/retention
    rangeDays = 30,
    range, // optional override { from,to,tz }

    // compact knobs
    topCampaignsN = 25,
    topBreakdownsN = 10,
  } = opts || {};

  // 0) Developer Token obligatorio
  if (!DEV_TOKEN) {
    return { ok: false, notAuthorized: true, reason: 'MISSING_DEVELOPER_TOKEN' };
  }

  // 1) Trae GoogleAccount con tokens
  const gaDoc =
    typeof GoogleAccount.findWithTokens === 'function'
      ? await GoogleAccount.findWithTokens({ $or: [{ user: userId }, { userId }] })
      : await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).select(
          '+accessToken +refreshToken customers ad_accounts defaultCustomerId managerCustomerId loginCustomerId scope expiresAt'
        );

  if (!gaDoc) {
    return { ok: false, notAuthorized: true, reason: 'NO_GOOGLEACCOUNT' };
  }

  const scopes = new Set((gaDoc.scope || []).map(String));
  if (!scopes.has('https://www.googleapis.com/auth/adwords')) {
    return { ok: false, notAuthorized: true, reason: 'MISSING_ADWORDS_SCOPE' };
  }

  // 2) Asegura accessToken
  let accessToken = await ensureAccessToken(gaDoc);
  if (!accessToken) {
    return { ok: false, notAuthorized: true, reason: 'NO_ACCESS_TOKEN' };
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
    return { ok: true, notAuthorized: false, reason: 'NO_CUSTOMERS', datasets: [] };
  }

  // 4) Resolver cuentas a auditar
  let idsToAudit = [];

  if (account_id) {
    const forced = normId(account_id);
    if (forced) idsToAudit = [forced];
  }

  if (idsToAudit.length === 0 && UserModel && userId) {
    try {
      const user = await UserModel.findById(userId).lean().select('preferences selectedGoogleAccounts');

      let selected = Array.isArray(user?.preferences?.googleAds?.auditCustomerIds)
        ? user.preferences.googleAds.auditCustomerIds
        : Array.isArray(user?.selectedGoogleAccounts)
          ? user.selectedGoogleAccounts
          : [];

      selected = selected.map(normId).filter(Boolean);

      const picked = intersect(new Set(universe), [...new Set(selected)]).slice(0, MAX_BY_RULE);
      if (picked.length) idsToAudit = picked;
    } catch {}
  }

  if (idsToAudit.length === 0) {
    if (universe.length <= MAX_BY_RULE) {
      idsToAudit = universe;
    } else {
      return {
        ok: false,
        notAuthorized: true,
        reason: 'SELECTION_REQUIRED(>3_CUSTOMERS)',
        requiredSelection: true,
        availableCount: universe.length,
        accountIds: universe,
        defaultCustomerId: gaDoc.defaultCustomerId ? normId(gaDoc.defaultCustomerId) : null,
      };
    }
  }

  // acumuladores
  const accountsMeta = new Map(); // cid -> { name, currencyCode, timeZone }
  const byAccountAgg = new Map(); // cid -> kpis money (rounded)
  const byCampaignMap = new Map();
  const byCampaignDeviceMap = new Map();
  const byCampaignNetworkMap = new Map();
  const byDateMap = new Map(); // cid|date -> agg micros

  let currency = 'USD';
  let timeZone = null;

  let globalSince = null;
  let globalUntil = null;

  // explicit range override
  const explicitRange = range && range.from && range.to ? {
    since: String(range.from),
    until: String(range.to),
    tz: range.tz || null,
  } : null;

  // loop
  for (const customerId of idsToAudit) {
    // 1) metadata
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
      logger.warn('[gadsCollector] getCustomer fallo', {
        customerId,
        error: e?.message || String(e),
      });

      if (!accountsMeta.has(customerId)) {
        accountsMeta.set(customerId, { name: `Cuenta ${customerId}`, currencyCode: null, timeZone: null });
      }
    }

    const tzForThis = accountsMeta.get(customerId)?.timeZone || timeZone || 'UTC';
    const strictRange = explicitRange ? { since: explicitRange.since, until: explicitRange.until } : getStrictLastNdRangeTZ(tzForThis, rangeDays);

    const sinceThis = strictRange.since;
    const untilThis = strictRange.until;

    if (!globalSince || sinceThis < globalSince) globalSince = sinceThis;
    if (!globalUntil || untilThis > globalUntil) globalUntil = untilThis;

    // 2) fetchInsights (try range first, fallback to last_30d)
    let payload = null;

    try {
      payload = await Ads.fetchInsights({
        accessToken,
        customerId,
        datePreset: null,
        range: { since: sinceThis, until: untilThis }, // ✅ variable
        includeToday: false,
        objective: 'ventas',
        compareMode: null,
      });
    } catch (e) {
      // fallback: legacy behavior
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
      } catch (e2) {
        // one retry on auth
        if (e2?.status === 401 || e2?.status === 403) {
          accessToken = await ensureAccessToken(gaDoc);
          if (!accessToken) continue;
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
          } catch {
            continue;
          }
        } else {
          continue;
        }
      }
    }

    if (!payload || !payload.kpis) continue;

    // KPIs por cuenta
    const k = payload.kpis || {};
    const impr = Number(k.impressions || 0);
    const clk = Number(k.clicks || 0);
    const cost = Number(k.cost || 0);
    const conv = Number(k.conversions || 0);
    const val = Number(k.conv_value || k.conversions_value || 0);

    byAccountAgg.set(customerId, {
      impressions: impr,
      clicks: clk,
      cost,
      conversions: conv,
      conv_value: val,
      ctr: safeDiv(clk, impr) * 100,
      cpc: safeDiv(cost, clk),
      cpa: safeDiv(cost, conv),
      roas: safeDiv(val, cost),
    });

    // 3) campañas + breakdowns (GAQL) usando rango real
    await accumulateCampaignBreakdowns({
      accessToken,
      customerId,
      since: sinceThis,
      until: untilThis,
      byCampaignMap,
      byCampaignDeviceMap,
      byCampaignNetworkMap,
      byDateMap,
    });
  }

  if (!globalSince || !globalUntil) {
    const fallback = getStrictLastNdRangeTZ(timeZone || 'UTC', rangeDays);
    globalSince = globalSince || fallback.since;
    globalUntil = globalUntil || fallback.until;
  }

  // accounts list compact
  const accounts = idsToAudit.map((cid) => {
    const m = accountsMeta.get(cid) || {};
    const a = byAccountAgg.get(cid) || {
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      conv_value: 0,
      ctr: 0,
      cpc: 0,
      cpa: 0,
      roas: 0,
    };

    return {
      id: cid,
      name: m.name || `Cuenta ${cid}`,
      currency: m.currencyCode || null,
      timezone_name: m.timeZone || null,
      kpis: a,
    };
  });

  // global kpis from accountAgg
  const G = accounts.reduce((acc, a) => {
    const k = a.kpis || {};
    acc.impressions += Number(k.impressions || 0);
    acc.clicks += Number(k.clicks || 0);
    acc.cost += Number(k.cost || 0);
    acc.conversions += Number(k.conversions || 0);
    acc.conv_value += Number(k.conv_value || 0);
    return acc;
  }, { impressions: 0, clicks: 0, cost: 0, conversions: 0, conv_value: 0 });

  const globalKpis = {
    impressions: G.impressions,
    clicks: G.clicks,
    cost: round2(G.cost),
    conversions: G.conversions,
    conv_value: round2(G.conv_value),
    ctr: safeDiv(G.clicks, G.impressions) * 100,
    cpc: safeDiv(G.cost, G.clicks),
    cpa: safeDiv(G.cost, G.conversions),
    roas: safeDiv(G.conv_value, G.cost),
  };

  // top campaigns (from byCampaignMap)
  const byCampaignArr = Array.from(byCampaignMap.values());
  const topByCost = topN(byCampaignArr, topCampaignsN, (c) => Number(c.cost_micros || 0));
  const topByConv = topN(byCampaignArr, topCampaignsN, (c) => Number(c.conversions || 0));
  const topByRoas = topN(byCampaignArr.filter(c => Number(c.cost_micros || 0) > 0), topCampaignsN, (c) => {
    const cost = microsToCurrency(c.cost_micros);
    return safeDiv(Number(c.conv_value || 0), cost);
  });

  const campaignsTop = {
    top_campaigns: {
      by_cost: topByCost.map(slimCampaignRow),
      by_conversions: topByConv.map(slimCampaignRow),
      by_roas: topByRoas.map(slimCampaignRow),
    }
  };

  // breakdowns top (aggregate across campaigns)
  const deviceTop = aggregateTopBreakdown(Array.from(byCampaignDeviceMap.values()), 'device', topBreakdownsN);
  const networkTop = aggregateTopBreakdown(Array.from(byCampaignNetworkMap.values()), 'network', topBreakdownsN);

  const breakdownsTop = {
    device_top: deviceTop,
    network_top: networkTop,
  };

  // daily series (account-level) from GAQL agg
  const accountDaily = Array.from(byDateMap.values())
    .map((x) => {
      const cost = microsToCurrency(x.cost_micros);
      return {
        date: x.date,
        account_id: x.account_id,
        kpis: {
          cost,
          impressions: x.impressions,
          clicks: x.clicks,
          conversions: x.conversions,
          conv_value: x.conv_value,
          ctr: safeDiv(x.clicks, x.impressions) * 100,
          cpc: safeDiv(cost, x.clicks),
          cpa: safeDiv(cost, x.conversions),
          roas: safeDiv(x.conv_value, cost),
        }
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // deltas (7/30) from daily series (more deterministic)
  function aggWindowDaily(days) {
    const end = globalUntil;
    const start = (() => {
      const [yy, mm, dd] = String(end).split('-').map(Number);
      const base = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0));
      base.setUTCDate(base.getUTCDate() - (days - 1));
      return base.toISOString().slice(0, 10);
    })();

    const rows = accountDaily.filter(r => r.date >= start && r.date <= end);
    const k = rows.reduce((a, r) => {
      const x = r.kpis || {};
      a.cost += Number(x.cost || 0);
      a.impressions += Number(x.impressions || 0);
      a.clicks += Number(x.clicks || 0);
      a.conversions += Number(x.conversions || 0);
      a.conv_value += Number(x.conv_value || 0);
      return a;
    }, { cost: 0, impressions: 0, clicks: 0, conversions: 0, conv_value: 0 });

    k.ctr = safeDiv(k.clicks, k.impressions) * 100;
    k.cpc = safeDiv(k.cost, k.clicks);
    k.cpa = safeDiv(k.cost, k.conversions);
    k.roas = safeDiv(k.conv_value, k.cost);
    return k;
  }

  function prevWindowDaily(days) {
    const end = globalUntil;
    const endPrev = (() => {
      const [yy, mm, dd] = String(end).split('-').map(Number);
      const base = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0));
      base.setUTCDate(base.getUTCDate() - days);
      return base.toISOString().slice(0, 10);
    })();
    const startPrev = (() => {
      const [yy, mm, dd] = String(endPrev).split('-').map(Number);
      const base = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0));
      base.setUTCDate(base.getUTCDate() - (days - 1));
      return base.toISOString().slice(0, 10);
    })();

    const rows = accountDaily.filter(r => r.date >= startPrev && r.date <= endPrev);
    const k = rows.reduce((a, r) => {
      const x = r.kpis || {};
      a.cost += Number(x.cost || 0);
      a.impressions += Number(x.impressions || 0);
      a.clicks += Number(x.clicks || 0);
      a.conversions += Number(x.conversions || 0);
      a.conv_value += Number(x.conv_value || 0);
      return a;
    }, { cost: 0, impressions: 0, clicks: 0, conversions: 0, conv_value: 0 });

    k.ctr = safeDiv(k.clicks, k.impressions) * 100;
    k.cpc = safeDiv(k.cost, k.clicks);
    k.cpa = safeDiv(k.cost, k.conversions);
    k.roas = safeDiv(k.conv_value, k.cost);
    return k;
  }

  const last7 = aggWindowDaily(7);
  const prev7 = prevWindowDaily(7);
  const last30 = aggWindowDaily(30);
  const prev30 = prevWindowDaily(30);

  const summary = {
    kpis: globalKpis,
    windows: {
      last_7_days: last7,
      prev_7_days: prev7,
      last_30_days: last30,
      prev_30_days: prev30,
    },
    deltas: {
      last7_vs_prev7: computeDeltas(last7, prev7),
      last30_vs_prev30: computeDeltas(last30, prev30),
    },
  };

  const rangeOut = { from: globalSince, to: globalUntil, tz: timeZone || null };

  const header = makeGoogleHeader({
    userId,
    accountIds: idsToAudit,
    accounts,
    range: rangeOut,
    currency,
    timeZone,
    version: 'gadsCollector@mcp-v1(costMicros+gaqlDaily+topN)',
  });

  const datasets = [
    {
      source: 'googleAds',
      dataset: 'google.insights_summary',
      range: rangeOut,
      data: { meta: header, summary },
    },
    {
      source: 'googleAds',
      dataset: 'google.campaigns_top',
      range: rangeOut,
      data: { meta: header, ...campaignsTop },
    },
    {
      source: 'googleAds',
      dataset: 'google.breakdowns_top',
      range: rangeOut,
      data: { meta: header, ...breakdownsTop },
    },
    {
      source: 'googleAds',
      dataset: 'google.account_daily',
      range: rangeOut,
      data: { meta: header, account_daily: accountDaily },
    },
  ];

  return {
    ok: true,
    notAuthorized: false,
    reason: null,
    currency,
    timeZone,
    timeRange: { from: globalSince, to: globalUntil },
    accountIds: idsToAudit,
    accounts,
    datasets,
  };
}

module.exports = { collectGoogle };