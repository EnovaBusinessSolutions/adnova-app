// backend/jobs/collect/googleCollector.js
'use strict';

const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

// Usaremos SIEMPRE el mismo servicio que el panel
const Ads = require('../../services/googleAdsService');

// =========================
//  Constantes / configuración
// =========================

// Límite duro por requerimiento (3). Se puede “bajar” por env, pero nunca >3.
const HARD_LIMIT = 3;
const MAX_BY_RULE = Math.min(
  HARD_LIMIT,
  Number(process.env.GADS_AUDIT_MAX || HARD_LIMIT)
);

// Límite de seguridad de requests (no afecta la regla 3 máx. para auditoría)
const MAX_ACCOUNTS_FETCH = Number(process.env.GOOGLE_MAX_ACCOUNTS || 12);

// =========================
//  Modelos
// =========================

let GoogleAccount;
try {
  GoogleAccount = require('../../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;

  const AdAccountSchema = new Schema({
    id: String,
    name: String,
    currencyCode: String,
    timeZone: String,
    status: String,
  }, { _id: false });

  const schema = new Schema(
    {
      user:  { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId:{ type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },

      accessToken:  { type: String, select: false },
      refreshToken: { type: String, select: false },
      scope:        { type: [String], default: [] },

      customers:         { type: Array, default: [] },
      ad_accounts:       { type: [AdAccountSchema], default: [] },
      defaultCustomerId: { type: String },
      managerCustomerId: { type: String },
      loginCustomerId:   { type: String },
      selectedCustomerIds: { type: [String], default: [] },

      expiresAt: { type: Date },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts', timestamps: true }
  );
  schema.pre('save', function (n) { this.updatedAt = new Date(); n(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

let UserModel = null;
try {
  UserModel = require('../../models/User');
} catch (_) {
  const { Schema, model } = mongoose;
  UserModel = mongoose.models.User || model(
    'User',
    new Schema({}, { strict: false, collection: 'users' })
  );
}

// =========================
//  Helpers genéricos
// =========================

const normId   = (s = '') => String(s).replace(/^customers\//,'').replace(/[^\d]/g, '').trim();
const microsTo = (v) => Number(v || 0) / 1_000_000;
const safeDiv  = (n, d) => (Number(d || 0) ? Number(n || 0) / Number(d || 0) : 0);

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

function oauth() {
  return new OAuth2Client({
    clientId:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri:  process.env.GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/**
 * Refresca access_token como en googleAdsInsights.js
 */
async function getFreshAccessToken(gaDoc) {
  if (gaDoc?.accessToken && gaDoc?.expiresAt) {
    const ms = new Date(gaDoc.expiresAt).getTime() - Date.now();
    if (ms > 60_000) return gaDoc.accessToken; // válido > 60s
  }

  const client = oauth();
  client.setCredentials({
    refresh_token: gaDoc?.refreshToken || undefined,
    access_token:  gaDoc?.accessToken  || undefined,
  });

  // 1) refreshAccessToken (con expiry)
  try {
    const { credentials } = await client.refreshAccessToken();
    const access = credentials.access_token;
    if (access) {
      await GoogleAccount.updateOne(
        { _id: gaDoc._id },
        {
          $set: {
            accessToken: access,
            expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
            updatedAt: new Date(),
          },
        }
      );
      return access;
    }
  } catch (_) {
    // ignoramos y probamos getAccessToken
  }

  // 2) getAccessToken (sin expiry)
  const t = await client.getAccessToken().catch(() => null);
  if (t?.token) return t.token;

  if (gaDoc?.accessToken) return gaDoc.accessToken;
  throw new Error('NO_ACCESS_OR_REFRESH_TOKEN');
}

// === selección: helpers (mismo concepto que en googleAdsInsights.js) ===
function selectedFromDocOrUser(gaDoc, userDoc) {
  const fromDoc = Array.isArray(gaDoc?.selectedCustomerIds) && gaDoc.selectedCustomerIds.length
    ? gaDoc.selectedCustomerIds.map(normId)
    : [];
  if (fromDoc.length) return [...new Set(fromDoc.filter(Boolean))];

  const legacy = Array.isArray(userDoc?.selectedGoogleAccounts)
    ? userDoc.selectedGoogleAccounts.map(normId)
    : [];
  return [...new Set(legacy.filter(Boolean))];
}

function availableAccountIds(gaDoc) {
  const fromAdAcc = (Array.isArray(gaDoc?.ad_accounts) ? gaDoc.ad_accounts : [])
    .map(a => normId(a.id))
    .filter(Boolean);
  const fromCust  = (Array.isArray(gaDoc?.customers) ? gaDoc.customers : [])
    .map(c => normId(c.id))
    .filter(Boolean);
  const set = new Set([...fromAdAcc, ...fromCust]);
  return [...set];
}

// =========================
//  Collector principal
// =========================

async function collectGoogle(userId, opts = {}) {
  const { account_id } = opts || {};

  // 1) Traer el GoogleAccount con tokens
  const gaDoc = await GoogleAccount.findOne({
    $or: [{ user: userId }, { userId }],
  }).select(
    '+accessToken +refreshToken scope customers ad_accounts defaultCustomerId managerCustomerId loginCustomerId selectedCustomerIds expiresAt'
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
      targets: { cpaHigh: 15 },
      version: 'gadsCollector@no-account',
    };
  }

  // 2) Validar scope adwords
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
      targets: { cpaHigh: 15 },
      version: 'gadsCollector@no-scope',
    };
  }

  // 3) Refrescar access_token con la misma lógica del panel
  let accessToken;
  try {
    accessToken = await getFreshAccessToken(gaDoc);
  } catch (_) {
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
      targets: { cpaHigh: 15 },
      version: 'gadsCollector@token-error',
    };
  }

  // 4) Universo de cuentas accesibles (igual filosofía que el panel, PERO SIN MCC)
  const universeIds = new Set(availableAccountIds(gaDoc));

  try {
    // Reutilizamos listAccessibleCustomers del servicio
    const extra = await Ads.listAccessibleCustomers(accessToken);
    if (Array.isArray(extra)) {
      for (const r of extra) {
        let id;
        if (typeof r === 'string') {
          id = r.split('/')[1];
        } else {
          id = normId(r.resourceName || r.resource_name || r.id || '');
        }
        if (id) universeIds.add(normId(id));
      }
    }
  } catch {
    // si falla, seguimos con lo que haya en BD
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
      targets: { cpaHigh: 15 },
      version: 'gadsCollector@no-customers',
    };
  }

  // 5) Resolver cuentas a auditar (máx. 3)
  let idsToAudit = [];

  // 5.a) override explícito
  if (account_id) {
    const forced = normId(account_id);
    if (forced) idsToAudit = [forced];
  }

  // 5.b) si no hay override, usar selección del usuario
  if (idsToAudit.length === 0 && UserModel && userId) {
    try {
      const user = await UserModel.findById(userId).lean().select('preferences selectedGoogleAccounts');
      let selected = Array.isArray(gaDoc.selectedCustomerIds) && gaDoc.selectedCustomerIds.length
        ? gaDoc.selectedCustomerIds
        : (Array.isArray(user?.selectedGoogleAccounts) ? user.selectedGoogleAccounts : []);
      selected = selected.map(normId).filter(Boolean);

      const set = new Set(universe);
      const picked = [...new Set(selected)].filter(id => set.has(id)).slice(0, MAX_BY_RULE);
      if (picked.length) idsToAudit = picked;
    } catch {
      // noop
    }
  }

  // 5.c) si aún no hay selección: si universo <=3 usamos todas; si >3 pedimos selección
  if (idsToAudit.length === 0) {
    if (universe.length <= MAX_BY_RULE) {
      idsToAudit = universe.slice(0, MAX_BY_RULE);
    } else {
      return {
        notAuthorized: true,
        reason: 'SELECTION_REQUIRED(>3_CUSTOMERS)',
        requiredSelection: true,
        availableCount: universe.length,
        accountIds: universe,
        defaultCustomerId: gaDoc.defaultCustomerId ? normId(gaDoc.defaultCustomerId) : null,
        accounts: [],
        targets: { cpaHigh: 15 },
        version: 'gadsCollector@selection-required',
      };
    }
  }

  // =========================
  //  Agregación de datos
  // =========================

  const untilGlobal = todayISO();

  let G = { impr: 0, clk: 0, cost: 0, conv: 0, val: 0, allConv: 0, allVal: 0 };
  const seriesMap = new Map(); // date -> agg
  const byCampaign = [];
  const byCampaignDevice = [];
  const byCampaignNetwork = [];

  let currency = 'USD';
  let timeZone = null;
  let lastSinceUsed = null;

  const accountsMeta = new Map(); // id -> { name, currencyCode, timeZone }
  const byAccountAgg = new Map(); // id -> agg

  // Recorremos cada cuenta a auditar
  for (const customerId of idsToAudit) {
    // 1) Metadata de la cuenta usando el mismo servicio que el panel
    try {
      const cInfo = await Ads.getCustomer(accessToken, customerId);
      accountsMeta.set(customerId, {
        name: cInfo.descriptiveName || cInfo.name || `Cuenta ${customerId}`,
        currencyCode: cInfo.currencyCode || cInfo.currency || null,
        timeZone: cInfo.timeZone || cInfo.timezone || null,
      });
      currency = cInfo.currencyCode || currency;
      timeZone = cInfo.timeZone || timeZone;
    } catch {
      if (!accountsMeta.has(customerId)) {
        accountsMeta.set(customerId, { name: `Cuenta ${customerId}`, currencyCode: null, timeZone: null });
      }
    }

    // 2) Intentos de rango: 30d → 180d → 365d
    const ranges = [
      { since: daysAgoISO(30),  until: untilGlobal, where: '' },
      { since: daysAgoISO(180), until: untilGlobal, where: '' },
      { since: daysAgoISO(365), until: untilGlobal, where: "AND campaign.status = ENABLED" },
    ];

    let rows = [];
    let gotRows = false;
    let actualSince = ranges[0].since;

    for (const rg of ranges) {
      const GAQL = `
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
        rows = await Ads.searchGAQLStream(accessToken, customerId, GAQL);
        gotRows = Array.isArray(rows) && rows.length > 0;
        actualSince = rg.since;
        if (gotRows) break;
      } catch {
        // probamos siguiente rango
      }
    }

    if (!gotRows) continue;

    lastSinceUsed = actualSince;

    const byCampAgg = new Map();
    const byCampDeviceAgg = new Map();   // campId::device -> agg
    const byCampNetworkAgg = new Map();  // campId::network -> agg

    for (const r of rows.slice(0, 5000)) {
      const d       = r.segments?.date;
      const device  = r.segments?.device || null;
      const network = r.segments?.adNetworkType || r.segments?.ad_network_type || null;

      const campId = r.campaign?.id;
      const name   = r.campaign?.name || 'Untitled';
      const chType = r.campaign?.advertisingChannelType || r.campaign?.advertising_channel_type || null;
      const chSub  = r.campaign?.advertisingChannelSubType || r.campaign?.advertising_channel_sub_type || null;
      const status = r.campaign?.status || null;
      const servingStatus = r.campaign?.servingStatus || r.campaign?.serving_status || null;
      const biddingType   = r.campaign?.biddingStrategyType || r.campaign?.bidding_strategy_type || null;
      const targetCpaMicros = r.campaign?.targetCpaMicros ?? r.campaign?.target_cpa_micros ?? null;
      const targetRoas      = r.campaign?.targetRoas ?? r.campaign?.target_roas ?? null;

      const impr  = Number(r.metrics?.impressions || 0);
      const clk   = Number(r.metrics?.clicks || 0);
      const cost  = microsTo(r.metrics?.costMicros ?? r.metrics?.cost_micros);
      const conv  = Number(
        r.metrics?.conversions ??
        r.metrics?.conversions_value ??
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
        cur.impressions     += impr;
        cur.clicks          += clk;
        cur.cost            += cost;
        cur.conversions     += conv;
        cur.conv_value      += convValue;
        cur.all_conversions += allConv;
        cur.all_conv_value  += allVal;
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

  // Serie global
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
    byCampaignDevice,
    byCampaignNetwork,
    series,
    accountIds: idsToAudit, // <- las realmente auditadas (máx. 3)
    defaultCustomerId: gaDoc.defaultCustomerId ? normId(gaDoc.defaultCustomerId) : null,
    accounts, // [{id,name,currency,timezone_name,kpis}]
    targets: { cpaHigh: 15 },
    version: 'gadsCollector@multi-accounts+no-mcc',
  };
}

module.exports = { collectGoogle };
