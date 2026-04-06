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
const HARD_LIMIT = 3;

const MAX_BY_RULE = Math.min(
  HARD_LIMIT,
  Number(process.env.GADS_AUDIT_MAX || HARD_LIMIT)
);

const MAX_ACCOUNTS_FETCH = Number(process.env.GOOGLE_MAX_ACCOUNTS || 12);

/* ====================== Defaults MCP ====================== */
const DEFAULT_STORAGE_RANGE_DAYS = clampInt(
  process.env.MCP_STORAGE_RANGE_DAYS || 730,
  30,
  3650
);

const DEFAULT_CONTEXT_RANGE_DAYS = clampInt(
  process.env.MCP_CONTEXT_RANGE_DAYS || 60,
  7,
  365
);

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

const round2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;
const microsToCurrency = (micros) => round2(Number(micros || 0) / 1_000_000);

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function safeStr(v) {
  return v == null ? '' : String(v);
}

function compactArray(arr, max = 10) {
  return Array.isArray(arr) ? arr.slice(0, Math.max(0, max)) : [];
}

function uniqStrings(arr, max = 20) {
  const out = [];
  const seen = new Set();

  for (const x of Array.isArray(arr) ? arr : []) {
    const s = safeStr(x).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }

  return out;
}

/**
 * Formatea YYYY-MM-DD en una zona horaria
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

function parseYmdToUtcDate(ymd) {
  const s = safeStr(ymd).trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [yy, mm, dd] = s.split('-').map(Number);
  return new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0));
}

function addDaysYmd(ymd, deltaDays) {
  const d = parseYmdToUtcDate(ymd);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return d.toISOString().slice(0, 10);
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

function monthKeyFromDate(dateStr) {
  const s = safeStr(dateStr).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 7) : 'unknown';
}

function partitionRowsByMonth(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = monthKeyFromDate(row?.date);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
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

/* ====================== Health / ranking / signals ====================== */
function computeCampaignKpisFromMicros(row) {
  const spend = microsToCurrency(row.cost_micros);
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const conversions = Number(row.conversions || 0);
  const conversion_value = Number(row.conv_value || 0);

  return {
    spend,
    impressions,
    clicks,
    conversions,
    conversion_value: round2(conversion_value),
    ctr: round2(safeDiv(clicks, impressions) * 100),
    cpc: round2(safeDiv(spend, clicks)),
    cpa: round2(safeDiv(spend, conversions)),
    roas: round2(safeDiv(conversion_value, spend)),
  };
}

function deriveCampaignHealth(kpis) {
  const spend = Number(kpis?.spend || 0);
  const roas = Number(kpis?.roas || 0);
  const conversions = Number(kpis?.conversions || 0);
  const ctr = Number(kpis?.ctr || 0);
  const cpa = Number(kpis?.cpa || 0);

  if (spend <= 0) return 'NEUTRAL';

  if (conversions >= 3 && roas >= 3) return 'WINNER';
  if (conversions >= 1 && roas >= 2) return 'WINNER';

  if (spend >= 100 && conversions === 0) return 'RISK';
  if (spend >= 100 && roas > 0 && roas < 1) return 'RISK';
  if (spend >= 100 && ctr < 1) return 'RISK';
  if (spend >= 100 && conversions > 0 && cpa > 0 && roas < 1.2) return 'RISK';

  if (roas >= 1.2 || ctr >= 2 || conversions >= 1) return 'PROMISING';

  return 'NEUTRAL';
}

function deriveCampaignTags(kpis, globalKpis) {
  const tags = [];

  const spend = Number(kpis?.spend || 0);
  const conversions = Number(kpis?.conversions || 0);
  const roas = Number(kpis?.roas || 0);
  const ctr = Number(kpis?.ctr || 0);
  const cpa = Number(kpis?.cpa || 0);

  const gCtr = Number(globalKpis?.ctr || 0);
  const gCpa = Number(globalKpis?.cpa || 0);
  const gRoas = Number(globalKpis?.roas || 0);

  if (spend > 0) tags.push('active_spend');
  if (spend >= 500) tags.push('top_spend');
  if (conversions >= 10) tags.push('top_conversions');
  if (roas >= Math.max(2, gRoas)) tags.push('high_roas');
  if (ctr >= Math.max(2, gCtr * 1.15)) tags.push('strong_ctr');
  if (cpa > 0 && gCpa > 0 && cpa <= gCpa * 0.85) tags.push('efficient_cpa');
  if (conversions === 0 && spend >= 100) tags.push('zero_conversion_spend');
  if (roas > 0 && roas < 1) tags.push('low_roas');

  return uniqStrings(tags, 8);
}

function computeCampaignRankingScore(row, globalKpis) {
  const k = computeCampaignKpisFromMicros(row);

  const spend = Number(k.spend || 0);
  const conversions = Number(k.conversions || 0);
  const roas = Number(k.roas || 0);
  const ctr = Number(k.ctr || 0);

  const gCtr = Number(globalKpis?.ctr || 0);
  const gRoas = Number(globalKpis?.roas || 0);

  let score = 0;

  score += Math.min(spend, 5000) * 2.2;
  score += conversions * 220;
  score += roas * 900;
  score += ctr * 70;

  if (roas >= Math.max(2, gRoas)) score += 1200;
  if (ctr >= Math.max(2, gCtr)) score += 300;
  if (conversions === 0 && spend >= 100) score -= 900;
  if (roas > 0 && roas < 1) score -= 700;

  return round2(score);
}

function compactCampaignRanked(row, globalKpis) {
  const kpis = computeCampaignKpisFromMicros(row);
  const health = deriveCampaignHealth(kpis);
  const tags = deriveCampaignTags(kpis, globalKpis);
  const ranking_score = computeCampaignRankingScore(row, globalKpis);

  return {
    account_id: row.account_id,
    campaign_id: row.campaign_id,
    campaign_name: row.name || row.campaignName || null,
    name: row.name || row.campaignName || null,
    objective: row.objective || null,
    objective_norm: row.objective || null,
    status: row.status || null,
    channel_type: row.channelType || null,
    channel_sub_type: row.channelSubType || null,
    bidding_strategy_type: row.biddingStrategyType || null,
    health,
    ranking_score,
    tags,
    kpis,
  };
}

function buildOptimizationSignals(campaignsRanked, globalKpis) {
  const winners = campaignsRanked
    .filter((c) => c.health === 'WINNER')
    .sort((a, b) => Number(b.ranking_score || 0) - Number(a.ranking_score || 0))
    .slice(0, 4);

  const risks = campaignsRanked
    .filter((c) => c.health === 'RISK')
    .sort((a, b) => Number(b.kpis?.spend || 0) - Number(a.kpis?.spend || 0))
    .slice(0, 4);

  const quick_wins = campaignsRanked
    .filter((c) => c.health === 'PROMISING' || c.tags.includes('strong_ctr') || c.tags.includes('efficient_cpa'))
    .sort((a, b) => Number(b.ranking_score || 0) - Number(a.ranking_score || 0))
    .slice(0, 4);

  const insights = [];
  const recommendations = [];

  if (winners.length) {
    insights.push(`There are ${winners.length} Google Ads winner campaigns with strong efficiency signals.`);
    recommendations.push('Protect and carefully scale the best-performing winner campaigns first.');
  }

  if (risks.length) {
    insights.push(`There are ${risks.length} risk campaigns absorbing spend with weak return signals.`);
    recommendations.push('Review risk campaigns for budget cuts, bidding issues, weak search intent, or offer mismatch.');
  }

  const roas = Number(globalKpis?.roas || 0);
  const ctr = Number(globalKpis?.ctr || 0);
  const cpa = Number(globalKpis?.cpa || 0);

  if (roas > 0 && roas < 1) {
    insights.push('Overall Google Ads ROAS is below break-even.');
    recommendations.push('Prioritize efficiency recovery before increasing spend.');
  } else if (roas >= 2) {
    insights.push('Overall Google Ads performance shows profitable scaling potential.');
    recommendations.push('Scale profitable campaigns gradually while monitoring search quality and CPA.');
  }

  if (ctr > 0 && ctr < 1.5) {
    recommendations.push('Audit keywords, search terms, ad relevance, and creatives to improve CTR.');
  }

  if (cpa > 0) {
    recommendations.push(`Use current account CPA (${round2(cpa)}) as the operating benchmark for optimization decisions.`);
  }

  if (quick_wins.length) {
    recommendations.push('Test incremental budget shifts toward promising campaigns with strong CTR or efficient CPA.');
  }

  return {
    winners,
    risks,
    quick_wins,
    insights: uniqStrings(insights, 6),
    recommendations: uniqStrings(recommendations, 6),
  };
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
  byDateMap,
  byCampaignDateMap,
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
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM campaign
    WHERE
      segments.date BETWEEN '${since}' AND '${until}'
      AND metrics.impressions > 0
    ORDER BY segments.date
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

    const base_conversions = Number(met.conversions || 0);
    const all_conversions = Number(met.allConversions ?? met.all_conversions ?? row?.metrics?.all_conversions ?? 0);
    const conversions = Math.max(base_conversions, all_conversions);

    const base_conv_value = Number(met.conversionsValue ?? met.conversions_value ?? 0);
    const all_conv_value = Number(met.allConversionsValue ?? met.all_conversions_value ?? row?.metrics?.all_conversions_value ?? 0);
    const conv_value = Math.max(base_conv_value, all_conv_value);

    const device = seg.device || 'UNSPECIFIED';
    const network = seg.adNetworkType || seg.ad_network_type || 'UNSPECIFIED';

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

    const keyD = `${cid}|${device}`;
    let d = byCampaignDeviceMap.get(keyD);

    if (!d) {
      d = {
        account_id: cid,
        device,
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

    const keyN = `${cid}|${network}`;
    let n = byCampaignNetworkMap.get(keyN);

    if (!n) {
      n = {
        account_id: cid,
        network,
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

      const keyCD = `${cid}|${id}|${date}`;
      const curCD = byCampaignDateMap.get(keyCD) || {
        account_id: cid,
        campaign_id: id,
        campaign_name: name,
        objective,
        status,
        date,
        impressions: 0,
        clicks: 0,
        cost_micros: 0,
        conversions: 0,
        conv_value: 0,
      };
      curCD.impressions += impressions;
      curCD.clicks += clicks;
      curCD.cost_micros += costMicrosNum;
      curCD.conversions += conversions;
      curCD.conv_value += conv_value;
      byCampaignDateMap.set(keyCD, curCD);
    }
  }
}

/* ====================== Compact helpers ====================== */
function makeGoogleHeader({
  userId,
  accountIds,
  accounts,
  range,
  currency,
  timeZone,
  version,
  windowType,
  storageRangeDays,
  contextRangeDays,
  latestSnapshotId = null,
}) {
  return {
    schema: 'adray.mcp.v2',
    source: 'googleAds',
    generatedAt: new Date().toISOString(),
    userId: String(userId),
    accountIds: Array.isArray(accountIds) ? accountIds : [],
    accounts: Array.isArray(accounts) ? accounts : [],
    range,
    currency: currency || null,
    timeZone: timeZone || null,
    version: version || null,
    windowType: windowType || 'context',
    storageRangeDays: Number(storageRangeDays || 0) || null,
    contextRangeDays: Number(contextRangeDays || 0) || null,
    latestSnapshotId: latestSnapshotId || null,
  };
}

function computeDeltas(cur, prev) {
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : (a ? 100 : 0));
  return {
    spend_pct: pct(cur.spend, prev.spend),
    impressions_pct: pct(cur.impressions, prev.impressions),
    clicks_pct: pct(cur.clicks, prev.clicks),
    conversions_pct: pct(cur.conversions, prev.conversions),
    conversion_value_pct: pct(cur.conversion_value, prev.conversion_value),
    roas_diff: (cur.roas || 0) - (prev.roas || 0),
    cpa_diff: (cur.cpa || 0) - (prev.cpa || 0),
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
    const spend = microsToCurrency(x.cost_micros);
    return {
      key: x.key,
      spend,
      conversions: x.conversions,
      conversion_value: round2(x.conv_value),
      roas: round2(safeDiv(x.conv_value, spend)),
      cpa: round2(safeDiv(spend, x.conversions)),
      ctr: round2(safeDiv(x.clicks, x.impressions) * 100),
      clicks: x.clicks,
      impressions: x.impressions,
    };
  });

  arr.sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
  return arr.slice(0, Math.max(0, topNCount || 10));
}

function sortByDateAsc(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
}

function buildAccountAggFromDaily(byDateMap) {
  const byAccountAgg = new Map();

  for (const row of Array.from(byDateMap.values())) {
    const cid = normId(row?.account_id);
    if (!cid) continue;

    const cur = byAccountAgg.get(cid) || {
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
      conversion_value: 0,
      ctr: 0,
      cpc: 0,
      cpa: 0,
      roas: 0,
    };

    const spend = microsToCurrency(row.cost_micros);

    cur.impressions += Number(row.impressions || 0);
    cur.clicks += Number(row.clicks || 0);
    cur.spend += Number(spend || 0);
    cur.conversions += Number(row.conversions || 0);
    cur.conversion_value += Number(row.conv_value || 0);

    byAccountAgg.set(cid, cur);
  }

  for (const [cid, k] of byAccountAgg.entries()) {
    k.spend = round2(k.spend);
    k.conversion_value = round2(k.conversion_value);
    k.ctr = round2(safeDiv(k.clicks, k.impressions) * 100);
    k.cpc = round2(safeDiv(k.spend, k.clicks));
    k.cpa = round2(safeDiv(k.spend, k.conversions));
    k.roas = round2(safeDiv(k.conversion_value, k.spend));
    byAccountAgg.set(cid, k);
  }

  return byAccountAgg;
}

function buildDailyTotalsRows(byDateMap) {
  return sortByDateAsc(Array.from(byDateMap.values())).map((x) => {
    const spend = microsToCurrency(x.cost_micros);
    return {
      date: x.date,
      kpis: {
        spend,
        impressions: x.impressions,
        clicks: x.clicks,
        conversions: x.conversions,
        conversion_value: round2(x.conv_value),
        ctr: round2(safeDiv(x.clicks, x.impressions) * 100),
        cpc: round2(safeDiv(spend, x.clicks)),
        cpa: round2(safeDiv(spend, x.conversions)),
        roas: round2(safeDiv(x.conv_value, spend)),
      },
    };
  });
}

function buildCampaignsDailyRows(byCampaignDateMap) {
  return sortByDateAsc(Array.from(byCampaignDateMap.values())).map((x) => {
    const spend = microsToCurrency(x.cost_micros);
    return {
      account_id: x.account_id,
      campaign_id: x.campaign_id,
      campaign_name: x.campaign_name,
      objective: x.objective || null,
      objective_norm: x.objective || null,
      status: x.status || null,
      date: x.date,
      kpis: {
        spend,
        impressions: x.impressions,
        clicks: x.clicks,
        conversions: x.conversions,
        conversion_value: round2(x.conv_value),
        ctr: round2(safeDiv(x.clicks, x.impressions) * 100),
        cpc: round2(safeDiv(spend, x.clicks)),
        cpa: round2(safeDiv(spend, x.conversions)),
        roas: round2(safeDiv(x.conv_value, spend)),
      },
    };
  });
}

function aggregateWindowFromTotals(totalsByDay, endDate, days) {
  const end = safeStr(endDate).trim();
  if (!end) {
    return {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversion_value: 0,
      ctr: 0,
      cpc: 0,
      cpa: 0,
      roas: 0,
    };
  }

  const start = addDaysYmd(end, -(Number(days || 1) - 1));
  const rows = (Array.isArray(totalsByDay) ? totalsByDay : []).filter((r) => r.date >= start && r.date <= end);

  const k = rows.reduce((a, r) => {
    const x = r.kpis || {};
    a.spend += Number(x.spend || 0);
    a.impressions += Number(x.impressions || 0);
    a.clicks += Number(x.clicks || 0);
    a.conversions += Number(x.conversions || 0);
    a.conversion_value += Number(x.conversion_value || 0);
    return a;
  }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 });

  k.spend = round2(k.spend);
  k.conversion_value = round2(k.conversion_value);
  k.ctr = round2(safeDiv(k.clicks, k.impressions) * 100);
  k.cpc = round2(safeDiv(k.spend, k.clicks));
  k.cpa = round2(safeDiv(k.spend, k.conversions));
  k.roas = round2(safeDiv(k.conversion_value, k.spend));
  return k;
}

/* ====================== Collector principal ====================== */
async function collectGoogle(userId, opts = {}) {
  const {
    account_id,
    rangeDays, // compat legacy => contexto
    contextRangeDays = rangeDays || DEFAULT_CONTEXT_RANGE_DAYS,
    storageRangeDays = DEFAULT_STORAGE_RANGE_DAYS,
    range,
    storageRange,
    topCampaignsN = 25,
    topBreakdownsN = 10,
    buildHistoricalDatasets = (
      opts.buildHistoricalDatasets !== undefined
        ? !!opts.buildHistoricalDatasets
        : String(process.env.GOOGLE_BUILD_HISTORICAL_DATASETS || 'true').toLowerCase() === 'true'
    ),
    historyIncludeCampaignDaily = (
      opts.historyIncludeCampaignDaily !== undefined
        ? !!opts.historyIncludeCampaignDaily
        : String(process.env.GOOGLE_HISTORY_INCLUDE_CAMPAIGN_DAILY || 'true').toLowerCase() === 'true'
    ),
  } = opts || {};

  const contextDays = clampInt(contextRangeDays || DEFAULT_CONTEXT_RANGE_DAYS, 7, 365);
  const storageDays = clampInt(storageRangeDays || DEFAULT_STORAGE_RANGE_DAYS, Math.max(contextDays, 30), 3650);

  if (!DEV_TOKEN) {
    return { ok: false, notAuthorized: true, reason: 'MISSING_DEVELOPER_TOKEN' };
  }

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

  let accessToken = await ensureAccessToken(gaDoc);
  if (!accessToken) {
    return { ok: false, notAuthorized: true, reason: 'NO_ACCESS_TOKEN' };
  }

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

  const accountsMeta = new Map();

  const byCampaignMap = new Map();
  const byCampaignDeviceMap = new Map();
  const byCampaignNetworkMap = new Map();
  const byDateMap = new Map();
  const byCampaignDateMap = new Map();

  const histByDateMap = new Map();
  const histByCampaignDateMap = new Map();

  let currency = 'USD';
  let timeZone = null;

  let contextSinceGlobal = null;
  let contextUntilGlobal = null;
  let storageSinceGlobal = null;
  let storageUntilGlobal = null;

  const explicitContextRange = range && range.from && range.to ? {
    since: String(range.from),
    until: String(range.to),
    tz: range.tz || null,
  } : null;

  const explicitStorageRange = storageRange && storageRange.from && storageRange.to ? {
    since: String(storageRange.from),
    until: String(storageRange.to),
    tz: storageRange.tz || null,
  } : null;

  for (const customerId of idsToAudit) {
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

    const contextStrictRange = explicitContextRange
      ? { since: explicitContextRange.since, until: explicitContextRange.until }
      : getStrictLastNdRangeTZ(tzForThis, contextDays);

    const storageStrictRange = explicitStorageRange
      ? { since: explicitStorageRange.since, until: explicitStorageRange.until }
      : getStrictLastNdRangeTZ(tzForThis, storageDays);

    if (!contextSinceGlobal || contextStrictRange.since < contextSinceGlobal) contextSinceGlobal = contextStrictRange.since;
    if (!contextUntilGlobal || contextStrictRange.until > contextUntilGlobal) contextUntilGlobal = contextStrictRange.until;

    if (!storageSinceGlobal || storageStrictRange.since < storageSinceGlobal) storageSinceGlobal = storageStrictRange.since;
    if (!storageUntilGlobal || storageStrictRange.until > storageUntilGlobal) storageUntilGlobal = storageStrictRange.until;

    await accumulateCampaignBreakdowns({
      accessToken,
      customerId,
      since: contextStrictRange.since,
      until: contextStrictRange.until,
      byCampaignMap,
      byCampaignDeviceMap,
      byCampaignNetworkMap,
      byDateMap,
      byCampaignDateMap,
    });

    if (buildHistoricalDatasets) {
      await accumulateCampaignBreakdowns({
        accessToken,
        customerId,
        since: storageStrictRange.since,
        until: storageStrictRange.until,
        byCampaignMap: new Map(), // histórico no necesita ranked por ahora
        byCampaignDeviceMap: new Map(),
        byCampaignNetworkMap: new Map(),
        byDateMap: histByDateMap,
        byCampaignDateMap: histByCampaignDateMap,
      });
    }
  }

  if (!contextSinceGlobal || !contextUntilGlobal) {
    const fallback = getStrictLastNdRangeTZ(timeZone || 'UTC', contextDays);
    contextSinceGlobal = contextSinceGlobal || fallback.since;
    contextUntilGlobal = contextUntilGlobal || fallback.until;
  }

  if (!storageSinceGlobal || !storageUntilGlobal) {
    const fallback = getStrictLastNdRangeTZ(timeZone || 'UTC', storageDays);
    storageSinceGlobal = storageSinceGlobal || fallback.since;
    storageUntilGlobal = storageUntilGlobal || fallback.until;
  }

  const byAccountAgg = buildAccountAggFromDaily(byDateMap);

  const accounts = idsToAudit.map((cid) => {
    const m = accountsMeta.get(cid) || {};
    const a = byAccountAgg.get(cid) || {
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
      conversion_value: 0,
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

  const G = accounts.reduce((acc, a) => {
    const k = a.kpis || {};
    acc.impressions += Number(k.impressions || 0);
    acc.clicks += Number(k.clicks || 0);
    acc.spend += Number(k.spend || 0);
    acc.conversions += Number(k.conversions || 0);
    acc.conversion_value += Number(k.conversion_value || 0);
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversion_value: 0 });

  const globalKpis = {
    impressions: G.impressions,
    clicks: G.clicks,
    spend: round2(G.spend),
    conversions: G.conversions,
    conversion_value: round2(G.conversion_value),
    ctr: round2(safeDiv(G.clicks, G.impressions) * 100),
    cpc: round2(safeDiv(G.spend, G.clicks)),
    cpa: round2(safeDiv(G.spend, G.conversions)),
    roas: round2(safeDiv(G.conversion_value, G.spend)),
  };

  const byCampaignArr = Array.from(byCampaignMap.values());
  const campaignsRanked = byCampaignArr
    .map((row) => compactCampaignRanked(row, globalKpis))
    .filter((x) => x.campaign_id || x.name)
    .sort((a, b) => Number(b.ranking_score || 0) - Number(a.ranking_score || 0));

  const deviceTop = aggregateTopBreakdown(Array.from(byCampaignDeviceMap.values()), 'device', topBreakdownsN);
  const networkTop = aggregateTopBreakdown(Array.from(byCampaignNetworkMap.values()), 'network', topBreakdownsN);

  const breakdownsTop = {
    device_top: deviceTop,
    network_top: networkTop,
  };

  const totalsByDay = buildDailyTotalsRows(byDateMap);
  const campaignsDaily = buildCampaignsDailyRows(byCampaignDateMap);

  const histTotalsByDay = buildDailyTotalsRows(histByDateMap);
  const histCampaignsDaily = buildCampaignsDailyRows(histByCampaignDateMap);

  const last7 = aggregateWindowFromTotals(totalsByDay, contextUntilGlobal, 7);
  const prev7 = aggregateWindowFromTotals(totalsByDay, addDaysYmd(contextUntilGlobal, -7), 7);
  const last30 = aggregateWindowFromTotals(totalsByDay, contextUntilGlobal, 30);
  const prev30 = aggregateWindowFromTotals(totalsByDay, addDaysYmd(contextUntilGlobal, -30), 30);

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

  const optimization_signals = buildOptimizationSignals(campaignsRanked, globalKpis);

  const contextRangeOut = { from: contextSinceGlobal, to: contextUntilGlobal, tz: timeZone || null };
  const storageRangeOut = { from: storageSinceGlobal, to: storageUntilGlobal, tz: timeZone || null };

  const contextHeader = makeGoogleHeader({
    userId,
    accountIds: idsToAudit,
    accounts,
    range: contextRangeOut,
    currency,
    timeZone,
    version: 'gadsCollector@mcp-v4(storage+context)',
    windowType: 'context',
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  const historyHeader = makeGoogleHeader({
    userId,
    accountIds: idsToAudit,
    accounts,
    range: storageRangeOut,
    currency,
    timeZone,
    version: 'gadsCollector@mcp-v4(storage+context)',
    windowType: 'storage',
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  const datasets = [
    {
      source: 'googleAds',
      dataset: 'google.insights_summary',
      range: contextRangeOut,
      data: { meta: contextHeader, summary },
    },
    {
      source: 'googleAds',
      dataset: 'google.campaigns_ranked',
      range: contextRangeOut,
      data: {
        meta: contextHeader,
        campaigns_ranked: compactArray(campaignsRanked, Math.max(1, topCampaignsN)),
      },
    },
    {
      source: 'googleAds',
      dataset: 'google.breakdowns_top',
      range: contextRangeOut,
      data: { meta: contextHeader, ...breakdownsTop },
    },
    {
      source: 'googleAds',
      dataset: 'google.optimization_signals',
      range: contextRangeOut,
      data: {
        meta: contextHeader,
        optimization_signals,
      },
    },
    {
      source: 'googleAds',
      dataset: 'google.daily_trends_ai',
      range: contextRangeOut,
      data: {
        meta: contextHeader,
        totals_by_day: totalsByDay,
        campaigns_daily: campaignsDaily,
      },
    },
  ];

  if (buildHistoricalDatasets) {
    datasets.push({
      source: 'googleAds',
      dataset: 'google.history.daily_account_totals',
      range: storageRangeOut,
      data: {
        meta: historyHeader,
        totals_by_day: histTotalsByDay,
      },
    });

    if (historyIncludeCampaignDaily && histCampaignsDaily.length > 0) {
      const byMonth = partitionRowsByMonth(histCampaignsDaily);

      for (const [monthKey, rows] of byMonth.entries()) {
        datasets.push({
          source: 'googleAds',
          dataset: `google.history.daily_campaigns.${monthKey}`,
          range: {
            from: rows[0]?.date || storageRangeOut.from,
            to: rows[rows.length - 1]?.date || storageRangeOut.to,
            tz: timeZone || null,
          },
          data: {
            meta: {
              ...historyHeader,
              partition: monthKey,
            },
            campaigns_daily: rows,
          },
        });
      }
    }
  }

  return {
    ok: true,
    notAuthorized: false,
    reason: null,
    currency,
    timeZone,

    // compat
    timeRange: { from: contextSinceGlobal, to: contextUntilGlobal },

    // nuevos metadatos
    contextTimeRange: {
      from: contextSinceGlobal,
      to: contextUntilGlobal,
      since: contextSinceGlobal,
      until: contextUntilGlobal,
      tz: timeZone || null,
      days: contextDays,
    },
    storageTimeRange: {
      from: storageSinceGlobal,
      to: storageUntilGlobal,
      since: storageSinceGlobal,
      until: storageUntilGlobal,
      tz: timeZone || null,
      days: storageDays,
    },
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,

    accountIds: idsToAudit,
    accounts,
    datasets,
  };
}

module.exports = { collectGoogle };
