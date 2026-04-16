// backend/jobs/collect/metaCollector.js
'use strict';

const fetch = require('node-fetch');
const mongoose = require('mongoose');

const API_VER = process.env.FACEBOOK_API_VERSION || 'v19.0';

const HARD_LIMIT = 3;
const MAX_ACCOUNTS = Math.min(
  HARD_LIMIT,
  Number(process.env.META_MAX_ACCOUNTS || HARD_LIMIT)
);

let MetaAccount, User;
try {
  MetaAccount = require('../../models/MetaAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
      access_token: String,
      token: String,
      accessToken: String,
      longLivedToken: String,
      longlivedToken: String,
      defaultAccountId: String,
      ad_accounts: { type: Array, default: [] },
      adAccounts: { type: Array, default: [] },
      scopes: { type: [String], default: [] },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'metaaccounts' }
  );
  schema.pre('save', function (n) {
    this.updatedAt = new Date();
    n();
  });
  MetaAccount = mongoose.models.MetaAccount || model('MetaAccount', schema);
}

try {
  User = require('../../models/User');
} catch (_) {
  const { Schema, model } = mongoose;
  User = mongoose.models.User || model('User', new Schema({}, { strict: false, collection: 'users' }));
}

/* ---------------- utils ---------------- */
const toNum = (v) => Number(v || 0);
const safeDiv = (n, d) => (Number(d || 0) ? Number(n || 0) / Number(d || 0) : 0);
const normAct = (s = '') => String(s).replace(/^act_/, '').replace(/[^\d]/g, '').trim();
const minorToUnit = (v) => (v == null ? null : Number(v) / 100);

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function pickToken(acc) {
  return (
    acc?.longLivedToken ||
    acc?.longlivedToken ||
    acc?.access_token ||
    acc?.accessToken ||
    acc?.token ||
    null
  );
}

function pickDefaultAccountId(acc) {
  let id = normAct(acc?.defaultAccountId || '');
  if (id) return id;

  const first =
    (Array.isArray(acc?.ad_accounts) && (acc.ad_accounts[0]?.id || acc.ad_accounts[0])) ||
    (Array.isArray(acc?.adAccounts) && (acc.adAccounts[0]?.id || acc.adAccounts[0])) ||
    null;

  if (first) return normAct(first);
  return '';
}

function ymdInTimeZone(date, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}

function addDaysYMD(ymd, deltaDays) {
  const [yy, mm, dd] = String(ymd).split('-').map(Number);
  const base = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0));
  base.setUTCDate(base.getUTCDate() + Number(deltaDays || 0));
  return base.toISOString().slice(0, 10);
}

function getStrictRangeForTZ(timeZone, rangeDays, includeToday) {
  const todayYMD = ymdInTimeZone(new Date(), timeZone || 'UTC');
  const end = includeToday ? todayYMD : addDaysYMD(todayYMD, -1);
  const days = clampInt(rangeDays || 30, 1, 3650);
  const start = addDaysYMD(end, -(days - 1));
  return { since: start, until: end };
}

function normalizeMetaObjective(raw) {
  const o = String(raw || '').toUpperCase().trim();
  if (!o) return 'OTHER';

  if (
    o.includes('OUTCOME_SALES') ||
    o === 'CONVERSIONS' ||
    o.includes('PURCHASE') ||
    o.includes('CATALOG_SALES') ||
    o.includes('PRODUCT_CATALOG_SALES')
  ) return 'SALES';

  if (
    o.includes('OUTCOME_LEADS') ||
    o.includes('LEAD') ||
    o.includes('LEAD_GENERATION')
  ) return 'LEADS';

  if (
    o.includes('OUTCOME_TRAFFIC') ||
    o === 'TRAFFIC' ||
    o.includes('LINK_CLICKS') ||
    o.includes('LANDING_PAGE_VIEWS')
  ) return 'TRAFFIC';

  if (
    o.includes('OUTCOME_AWARENESS') ||
    o.includes('AWARENESS') ||
    o.includes('BRAND_AWARENESS') ||
    o === 'REACH'
  ) return 'AWARENESS';

  if (
    o.includes('ENGAGEMENT') ||
    o.includes('OUTCOME_ENGAGEMENT') ||
    o.includes('VIDEO_VIEWS') ||
    o.includes('POST_ENGAGEMENT')
  ) return 'ENGAGEMENT';

  if (o.includes('MESSAGES')) return 'MESSAGES';
  if (o.includes('APP')) return 'APP';
  return 'OTHER';
}

const META_CLICK_METRIC = String(process.env.META_CLICK_METRIC || 'link').toLowerCase();

function pickClicks(x) {
  const all = toNum(x?.clicks);
  const hasLink = x?.inline_link_clicks != null && x?.inline_link_clicks !== '';
  const link = hasLink ? toNum(x?.inline_link_clicks) : null;

  const chosen =
    META_CLICK_METRIC === 'all'
      ? all
      : (hasLink ? link : all);

  return {
    clicks: toNum(chosen),
    clicks_all: all,
    clicks_link: (link == null ? null : toNum(link)),
  };
}

async function fetchJSON(url, { retries = 1 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { timeout: 30000 });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const code = j?.error?.code || r.status;
        if ((code === 4 || code === 17 || String(code).startsWith('5')) && i < retries) {
          await new Promise((res) => setTimeout(res, 800 + i * 500));
          continue;
        }
        const msg = j?.error?.message || `HTTP_${r.status}`;
        const err = new Error(msg);
        err._meta = j?.error || {};
        throw err;
      }
      return j;
    } catch (e) {
      lastErr = e;
      if (i === retries) throw e;
    }
  }
  throw lastErr || new Error('unknown_error');
}

async function pageAllInsights(baseUrl) {
  const out = [];
  let next = baseUrl;
  let guard = 0;
  while (next && guard < 40) {
    guard += 1;
    const j = await fetchJSON(next, { retries: 1 });
    const data = Array.isArray(j?.data) ? j.data : [];
    out.push(...data);
    next = j?.paging?.next || null;
  }
  return out;
}

/* ---------------- purchases/value without double count ---------------- */
const PURCHASE_ACTION_PRIORITY = [
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
  'purchase',
  'offsite_conversion.custom.217343460920409',
  'offsite_conversion', // Broad fallback
  'lead',               // Oftentimes setups track purchases as leads
];

function pickActionValue(list, priority) {
  const arr = Array.isArray(list) ? list : [];
  const byType = new Map();
  for (const a of arr) {
    const t = String(a?.action_type || '').toLowerCase();
    if (!t) continue;
    byType.set(t, a?.value);
  }
  for (const p of priority) {
    const v = byType.get(String(p).toLowerCase());
    if (v != null && v !== '') {
      const n = Number(v);
      if (!Number.isNaN(n)) return { value: n, type: p };
    }
  }
  return { value: null, type: null };
}

function extractPurchaseMetrics(x) {
  const actions = x?.actions;
  const actionValues = x?.action_values;

  const p = pickActionValue(actions, PURCHASE_ACTION_PRIORITY);
  const v = pickActionValue(actionValues, PURCHASE_ACTION_PRIORITY);

  return {
    purchases: p.value,
    purchase_value: v.value,
    purchase_action_type: p.type || v.type || null,
  };
}

/* ---------------- accounts helpers ---------------- */
function getAllAvailableAccounts(accDoc) {
  const raw = [
    ...(Array.isArray(accDoc?.ad_accounts) ? accDoc.ad_accounts : []),
    ...(Array.isArray(accDoc?.adAccounts) ? accDoc.adAccounts : []),
  ];
  return raw
    .map((x) => {
      const id = normAct(x?.id || x || '');
      const name = x?.name || x?.account_name || null;
      return id ? { id, name } : null;
    })
    .filter(Boolean);
}

async function fetchAllCampaignMeta(actId, token) {
  const map = new Map();
  let next = `https://graph.facebook.com/${API_VER}/act_${actId}/campaigns?fields=id,name,status,effective_status,objective,buying_type,bid_strategy,daily_budget,lifetime_budget,special_ad_category&limit=500&access_token=${encodeURIComponent(token)}`;
  let guard = 0;

  while (next && guard < 40) {
    guard += 1;
    const j = await fetchJSON(next, { retries: 1 });
    const data = Array.isArray(j?.data) ? j.data : [];
    for (const c of data) {
      const id = normAct(c.id || '');
      if (!id) continue;

      const rawObj = c.objective || null;
      map.set(id, {
        id,
        name: c.name || null,
        status: c.status || null,
        effective_status: c.effective_status || null,
        objective: rawObj,
        objective_norm: normalizeMetaObjective(rawObj),
        buying_type: c.buying_type || null,
        bid_strategy: c.bid_strategy || null,
        daily_budget: minorToUnit(c.daily_budget),
        lifetime_budget: minorToUnit(c.lifetime_budget),
        special_ad_category: c.special_ad_category || null,
      });
    }
    next = j?.paging?.next || null;
  }

  return map;
}

/* ---------------- compact helpers ---------------- */
function sumKpis(rows) {
  const out = {
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    link_clicks: 0,
    landing_page_views: 0,
    purchases: 0,
    purchase_value: 0,
    add_to_cart: 0,
    initiate_checkout: 0,
    view_content: 0,
  };

  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r?.kpis || r?.metrics || r || {};
    out.spend += toNum(k.spend ?? k.cost);
    out.impressions += toNum(k.impressions);
    out.reach += toNum(k.reach);
    out.clicks += toNum(k.clicks);
    out.link_clicks += toNum(k.link_clicks ?? k.clicks);
    out.landing_page_views += toNum(k.landing_page_views);
    out.purchases += toNum(k.purchases);
    out.purchase_value += toNum(k.purchase_value ?? k.revenue);
    out.add_to_cart += toNum(k.add_to_cart);
    out.initiate_checkout += toNum(k.initiate_checkout);
    out.view_content += toNum(k.view_content);
  }

  out.frequency = out.reach > 0 ? safeDiv(out.impressions, out.reach) : 0;
  out.cpc = safeDiv(out.spend, out.clicks);
  out.roas = out.purchase_value && out.spend ? safeDiv(out.purchase_value, out.spend) : 0;
  out.cpm = out.impressions ? (out.spend / out.impressions) * 1000 : 0;
  out.ctr = out.impressions ? (out.clicks / out.impressions) * 100 : 0;
  out.cpa = safeDiv(out.spend, out.purchases);
  out.conversion_rate = out.clicks ? (out.purchases / out.clicks) * 100 : 0;
  out.aov = safeDiv(out.purchase_value, out.purchases);
  out.lpv_rate = out.clicks ? (out.landing_page_views / out.clicks) * 100 : 0;
  out.mer = 0;
  out.blended_cac = 0;
  out.new_customer_cac = 0;
  out.profit = 0;
  out.contribution_margin = 0;

  return out;
}

function topN(list, n, scoreFn) {
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.sort((a, b) => scoreFn(b) - scoreFn(a));
  return arr.slice(0, Math.max(0, n));
}

function trimText(v, max = 120) {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function makeMetaHeader({
  userId,
  accountIds,
  accounts,
  range,
  currency,
  version,
  windowType,
  storageRangeDays,
  contextRangeDays,
  latestSnapshotId = null,
}) {
  return {
    schema: 'adray.mcp.v3',
    source: 'metaAds',
    generatedAt: new Date().toISOString(),
    userId: String(userId),
    accountIds: Array.isArray(accountIds) ? accountIds : [],
    accounts: Array.isArray(accounts) ? accounts : [],
    range,
    currency: currency || null,
    version: version || null,
    windowType: windowType || 'context',
    storageRangeDays: toNum(storageRangeDays),
    contextRangeDays: toNum(contextRangeDays),
    latestSnapshotId: latestSnapshotId || null,
  };
}

function computeDeltas(cur, prev) {
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : (a ? 100 : 0));
  return {
    spend_pct: pct(cur.spend, prev.spend),
    impressions_pct: pct(cur.impressions, prev.impressions),
    clicks_pct: pct(cur.clicks, prev.clicks),
    purchases_pct: pct(cur.purchases, prev.purchases),
    purchase_value_pct: pct(cur.purchase_value, prev.purchase_value),
    roas_diff: (cur.roas || 0) - (prev.roas || 0),
    cpa_diff: (cur.cpa || 0) - (prev.cpa || 0),
  };
}

function scoreCampaignForRanking(c) {
  const k = c?.kpis || {};
  const spend = toNum(k.spend);
  const purchases = toNum(k.purchases);
  const roas = toNum(k.roas);
  const ctr = toNum(k.ctr);
  const cpa = toNum(k.cpa);

  return (
    spend * 0.35 +
    purchases * 25 +
    roas * 120 +
    ctr * 10 -
    cpa * 0.2
  );
}

function campaignHealthLabel(c) {
  const k = c?.kpis || {};
  const spend = toNum(k.spend);
  const roas = toNum(k.roas);
  const purchases = toNum(k.purchases);
  const cpa = toNum(k.cpa);

  if (spend <= 0) return 'NO_SPEND';
  if (purchases >= 3 && roas >= 2.5) return 'WINNER';
  if (purchases >= 1 && roas >= 1.5) return 'PROMISING';
  if (spend >= 100 && purchases === 0) return 'RISK';
  if (cpa > 0 && roas < 1) return 'INEFFICIENT';
  return 'MIXED';
}

function campaignTags(c, topSets = {}) {
  const tags = [];
  const id = String(c?.campaign_id || '');
  const k = c?.kpis || {};
  const spend = toNum(k.spend);
  const purchases = toNum(k.purchases);
  const roas = toNum(k.roas);
  const cpa = toNum(k.cpa);
  const ctr = toNum(k.ctr);

  if (topSets.bySpend?.has(id)) tags.push('top_spend');
  if (topSets.byPurchases?.has(id)) tags.push('top_purchases');
  if (topSets.byRoas?.has(id)) tags.push('top_roas');

  if (campaignHealthLabel(c) === 'WINNER') tags.push('winner');
  if (campaignHealthLabel(c) === 'PROMISING') tags.push('promising');
  if (campaignHealthLabel(c) === 'RISK') tags.push('risk');
  if (campaignHealthLabel(c) === 'INEFFICIENT') tags.push('inefficient');

  if (spend > 0 && purchases === 0) tags.push('spend_without_purchases');
  if (roas >= 3) tags.push('high_roas');
  if (roas > 0 && roas < 1) tags.push('low_roas');
  if (cpa >= 150 && purchases > 0) tags.push('high_cpa');
  if (ctr >= 2) tags.push('strong_ctr');
  if (ctr > 0 && ctr < 0.8) tags.push('weak_ctr');

  return Array.from(new Set(tags));
}

function slimCampaign(c, topSets) {
  const k = c.kpis || {};
  return {
    account_id: c.account_id,
    campaign_id: c.campaign_id,
    campaign_name: trimText(c.name || 'Sin nombre', 120),
    name: trimText(c.name || 'Sin nombre', 120),
    objective: c.objective || null,
    objective_norm: c.objective_norm,
    status: c.status || null,
    buying_type: c.buying_type || null,
    bid_strategy: c.bid_strategy || null,
    health: campaignHealthLabel(c),
    ranking_score: Number(scoreCampaignForRanking(c).toFixed(2)),
    tags: campaignTags(c, topSets),
    kpis: {
      spend: toNum(k.spend),
      impressions: toNum(k.impressions),
      reach: toNum(k.reach),
      frequency: toNum(k.frequency),
      clicks: toNum(k.clicks),
      link_clicks: toNum(k.link_clicks),
      landing_page_views: toNum(k.landing_page_views),
      purchases: toNum(k.purchases),
      purchase_value: toNum(k.purchase_value),
      add_to_cart: toNum(k.add_to_cart),
      initiate_checkout: toNum(k.initiate_checkout),
      view_content: toNum(k.view_content),
      roas: toNum(k.roas),
      cpa: toNum(k.cpa),
      cpc: toNum(k.cpc),
      ctr: toNum(k.ctr),
      cpm: toNum(k.cpm),
      conversion_rate: toNum(k.conversion_rate),
      aov: toNum(k.aov),
      lpv_rate: toNum(k.lpv_rate),
    },
  };
}

function aggregateBreakdown(rows, keyName, n) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = String(r?.[keyName] || '').trim();
    if (!key) continue;
    const k = r?.kpis || {};
    const cur = map.get(key) || {
      key,
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchase_value: 0,
      link_clicks: 0,
      landing_page_views: 0,
    };
    cur.spend += toNum(k.spend);
    cur.impressions += toNum(k.impressions);
    cur.clicks += toNum(k.clicks);
    cur.purchases += toNum(k.purchases);
    cur.purchase_value += toNum(k.purchase_value);
    cur.link_clicks += toNum(k.link_clicks);
    cur.landing_page_views += toNum(k.landing_page_views);
    map.set(key, cur);
  }
  const arr = Array.from(map.values()).map((x) => ({
    ...x,
    roas: x.purchase_value && x.spend ? safeDiv(x.purchase_value, x.spend) : 0,
    cpa: safeDiv(x.spend, x.purchases),
    cpc: safeDiv(x.spend, x.clicks),
    ctr: x.impressions ? (x.clicks / x.impressions) * 100 : 0,
    conversion_rate: x.clicks ? (x.purchases / x.clicks) * 100 : 0,
    aov: safeDiv(x.purchase_value, x.purchases),
  }));
  arr.sort((a, b) => b.spend - a.spend);
  return arr.slice(0, n);
}

function buildOptimizationSignals({ rankedCampaigns, deviceTop, placementTop, summary }) {
  const winners = rankedCampaigns
    .filter((c) => c.health === 'WINNER' || c.health === 'PROMISING')
    .slice(0, 5);

  const risks = rankedCampaigns
    .filter((c) => c.tags.includes('risk') || c.tags.includes('inefficient') || c.tags.includes('spend_without_purchases'))
    .slice(0, 5);

  const quickWins = rankedCampaigns
    .filter((c) => c.tags.includes('top_roas') && !c.tags.includes('top_spend'))
    .slice(0, 5);

  const deviceWinner = deviceTop[0] || null;
  const placementWinner = placementTop[0] || null;

  const insights = [];
  if (summary?.deltas?.last7_vs_prev7?.purchase_value_pct > 0) {
    insights.push('Revenue improved in the last 7 days versus the previous 7-day window.');
  }
  if (summary?.deltas?.last7_vs_prev7?.purchase_value_pct < 0) {
    insights.push('Revenue declined in the last 7 days versus the previous 7-day window.');
  }
  if (deviceWinner?.key) {
    insights.push(`Best-performing device by spend concentration is ${deviceWinner.key}.`);
  }
  if (placementWinner?.key) {
    insights.push(`Top placement by spend concentration is ${placementWinner.key}.`);
  }
  if (winners.length) {
    insights.push(`Top winner campaign is ${winners[0].campaign_name || winners[0].name}.`);
  }
  if (risks.length) {
    insights.push(`Main efficiency risk campaign is ${risks[0].campaign_name || risks[0].name}.`);
  }

  const recommendations = [];
  if (quickWins.length) {
    recommendations.push('Consider shifting more budget toward efficient campaigns with strong ROAS but lower current spend.');
  }
  if (risks.length) {
    recommendations.push('Review campaigns spending without purchases and reduce budget or refresh creatives/audiences.');
  }
  if (deviceWinner?.roas > 0) {
    recommendations.push(`Prioritize creatives and placements aligned to ${deviceWinner.key} if it continues outperforming.`);
  }
  if (placementWinner?.roas > 0) {
    recommendations.push(`Audit delivery on ${placementWinner.key} to see if scaling there preserves ROAS.`);
  }

  return {
    winners,
    risks,
    quick_wins: quickWins,
    insights: insights.slice(0, 6),
    recommendations: recommendations.slice(0, 5),
  };
}

function aggregateDailyTotals(rows) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = String(r?.date || '').trim();
    if (!d) continue;
    const k = r?.kpis || {};
    const cur = map.get(d) || {
      date: d,
      kpis: {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0,
        link_clicks: 0,
        landing_page_views: 0,
      },
    };
    cur.kpis.spend += toNum(k.spend);
    cur.kpis.impressions += toNum(k.impressions);
    cur.kpis.clicks += toNum(k.clicks);
    cur.kpis.purchases += toNum(k.purchases);
    cur.kpis.purchase_value += toNum(k.purchase_value);
    cur.kpis.link_clicks += toNum(k.link_clicks);
    cur.kpis.landing_page_views += toNum(k.landing_page_views);
    map.set(d, cur);
  }

  const out = Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const x of out) {
    x.kpis.roas = x.kpis.spend > 0 ? safeDiv(x.kpis.purchase_value, x.kpis.spend) : 0;
    x.kpis.cpa = safeDiv(x.kpis.spend, x.kpis.purchases);
    x.kpis.cpc = safeDiv(x.kpis.spend, x.kpis.clicks);
    x.kpis.ctr = x.kpis.impressions ? (x.kpis.clicks / x.kpis.impressions) * 100 : 0;
    x.kpis.conversion_rate = x.kpis.clicks ? (x.kpis.purchases / x.kpis.clicks) * 100 : 0;
    x.kpis.aov = safeDiv(x.kpis.purchase_value, x.kpis.purchases);
  }
  return out;
}

function monthKeyFromDate(dateStr) {
  const s = String(dateStr || '').trim();
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

function buildContextKpisFromInsightsRows(rows) {
  const agg = {
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    link_clicks: 0,
    landing_page_views: 0,
    purchases: 0,
    purchase_value: 0,
    add_to_cart: 0,
    initiate_checkout: 0,
    view_content: 0,
  };

  for (const x of Array.isArray(rows) ? rows : []) {
    const cx = pickClicks(x);
    const { purchases, purchase_value } = extractPurchaseMetrics(x);

    agg.spend += toNum(x.spend);
    agg.impressions += toNum(x.impressions);
    agg.reach += toNum(x.reach);
    agg.clicks += toNum(cx.clicks);
    agg.link_clicks += toNum(x.inline_link_clicks != null ? x.inline_link_clicks : cx.clicks);
    agg.purchases += purchases == null ? 0 : toNum(purchases);
    agg.purchase_value += purchase_value == null ? 0 : toNum(purchase_value);

    const actions = Array.isArray(x?.actions) ? x.actions : [];
    const lpv = actions.find((a) => String(a?.action_type || '').toLowerCase() === 'landing_page_view');
    const atc = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('add_to_cart'));
    const ic = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('initiate_checkout'));
    const vc = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('view_content'));

    agg.landing_page_views += lpv?.value == null ? 0 : toNum(lpv.value);
    agg.add_to_cart += atc?.value == null ? 0 : toNum(atc.value);
    agg.initiate_checkout += ic?.value == null ? 0 : toNum(ic.value);
    agg.view_content += vc?.value == null ? 0 : toNum(vc.value);
  }

  agg.frequency = agg.reach > 0 ? safeDiv(agg.impressions, agg.reach) : 0;
  agg.cpc = safeDiv(agg.spend, agg.clicks);
  agg.roas = agg.purchase_value && agg.spend ? safeDiv(agg.purchase_value, agg.spend) : 0;
  agg.cpm = agg.impressions ? (agg.spend / agg.impressions) * 1000 : 0;
  agg.ctr = agg.impressions ? (agg.clicks / agg.impressions) * 100 : 0;
  agg.cpa = safeDiv(agg.spend, agg.purchases);
  agg.conversion_rate = agg.clicks ? (agg.purchases / agg.clicks) * 100 : 0;
  agg.aov = safeDiv(agg.purchase_value, agg.purchases);
  agg.lpv_rate = agg.clicks ? (agg.landing_page_views / agg.clicks) * 100 : 0;
  agg.mer = 0;
  agg.blended_cac = 0;
  agg.new_customer_cac = 0;
  agg.profit = 0;
  agg.contribution_margin = 0;

  return agg;
}

/* ---------------- collector core ---------------- */
async function collectMeta(userId, opts = {}) {
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

  const {
    account_id,
    rangeDays, // compat legacy: lo tomamos como contextRangeDays
    contextRangeDays = rangeDays || DEFAULT_CONTEXT_RANGE_DAYS,
    storageRangeDays = DEFAULT_STORAGE_RANGE_DAYS,
    range, // rango explícito para contexto AI-ready
    storageRange, // opcional rango explícito para storage
    level = 'campaign',
    fields: userFields,
    strict = true,
    include_today = (
      opts.include_today !== undefined
        ? !!opts.include_today
        : (String(process.env.META_INCLUDE_TODAY || 'false').toLowerCase() === 'true')
    ),
    topCampaignsN = 15,
    topBreakdownsN = 8,
    buildDailySeries = true,
    dailySeriesDays,
    aiDailyTopCampaigns = 5,
    buildHistoricalDatasets = (
      opts.buildHistoricalDatasets !== undefined
        ? !!opts.buildHistoricalDatasets
        : String(process.env.META_BUILD_HISTORICAL_DATASETS || 'true').toLowerCase() === 'true'
    ),
    historyIncludeCampaignDaily = (
      opts.historyIncludeCampaignDaily !== undefined
        ? !!opts.historyIncludeCampaignDaily
        : String(process.env.META_HISTORY_INCLUDE_CAMPAIGN_DAILY || 'true').toLowerCase() === 'true'
    ),
  } = opts;

  const buildAdSets = opts.buildAdSets !== undefined
    ? !!opts.buildAdSets
    : (Array.isArray(opts.granularity)
        ? opts.granularity.includes('ad_sets')
        : true);

  const buildAds = opts.buildAds !== undefined
    ? !!opts.buildAds
    : (Array.isArray(opts.granularity)
        ? opts.granularity.includes('ads')
        : true);

  const contextDays = clampInt(contextRangeDays || DEFAULT_CONTEXT_RANGE_DAYS, 7, 365);
  const storageDays = clampInt(storageRangeDays || DEFAULT_STORAGE_RANGE_DAYS, Math.max(contextDays, 30), 3650);
  const contextDailyDays = clampInt(dailySeriesDays || contextDays, 7, 180);

  const [acc, user] = await Promise.all([
    MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
      .select('+access_token +token +accessToken +longLivedToken +longlivedToken scopes ad_accounts adAccounts defaultAccountId selectedAccountIds')
      .lean(),
    User.findById(userId).lean(),
  ]);

  if (!acc) {
    return { ok: false, notAuthorized: true, reason: 'NO_METAACCOUNT' };
  }

  const token = pickToken(acc);
  if (!token) {
    return { ok: false, notAuthorized: true, reason: 'NO_TOKEN' };
  }

  const scopes = Array.isArray(acc.scopes) ? acc.scopes.map((s) => String(s || '').toLowerCase()) : [];
  const hasRead = scopes.includes('ads_read') || scopes.includes('ads_management');
  if (!hasRead) {
    return { ok: false, notAuthorized: true, reason: 'MISSING_SCOPES(ads_read|ads_management)' };
  }

  const available = getAllAvailableAccounts(acc);
  const availById = new Map(available.map((a) => [a.id, a]));
  const availSet = new Set(available.map((a) => a.id));

  let accountsToAudit = [];

  if (account_id) {
    const id = normAct(account_id);
    if (!id) return { ok: false, notAuthorized: true, reason: 'INVALID_ACCOUNT_ID' };
    if (availSet.has(id)) accountsToAudit = [{ id, name: availById.get(id)?.name || null }];
  } else {
    const metaSel = Array.isArray(acc?.selectedAccountIds) ? acc.selectedAccountIds : [];
    const legacySel = Array.isArray(user?.selectedMetaAccounts) ? user.selectedMetaAccounts : [];
    const prefSel = Array.isArray(user?.preferences?.meta?.auditAccountIds) ? user.preferences.meta.auditAccountIds : [];
    const merged = [...metaSel, ...legacySel, ...prefSel]
      .map(normAct)
      .filter((id) => id && availSet.has(id));

    const seen = new Set();
    const ordered = [];
    for (const id of merged) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
      if (ordered.length >= MAX_ACCOUNTS) break;
    }

    if (ordered.length) {
      accountsToAudit = ordered.map((id) => ({ id, name: availById.get(id)?.name || null }));
    } else {
      const fallback = pickDefaultAccountId(acc);
      if (fallback && availSet.has(fallback)) {
        accountsToAudit = [{ id: fallback, name: availById.get(fallback)?.name || null }];
      } else {
        accountsToAudit = available.slice(0, Math.max(1, MAX_ACCOUNTS));
      }
    }
  }

  if (!accountsToAudit.length && available.length) accountsToAudit = available.slice(0, 1);

  const baseFields = [
    'date_start', 'date_stop',
    'campaign_id', 'campaign_name', 'objective',
    'spend', 'impressions', 'reach', 'frequency',
    'clicks', 'cpm', 'cpc', 'ctr',
    'unique_clicks', 'inline_link_clicks',
    'actions', 'action_values',
  ];
  const fields = Array.isArray(userFields) && userFields.length ? userFields : baseFields;

  const mkUrl = (actId, timeRangeObj, extra = {}) => {
    const qp = new URLSearchParams();
    qp.set('time_range', JSON.stringify(timeRangeObj));
    qp.set('level', level);
    qp.set('fields', fields.join(','));
    qp.set('limit', '5000');
    qp.set('action_report_time', process.env.META_ACTION_REPORT_TIME || 'conversion');
    qp.set('use_unified_attribution_setting', 'true');

    if (extra.breakdowns) qp.set('breakdowns', extra.breakdowns);
    if (extra.time_increment != null) qp.set('time_increment', String(extra.time_increment));

    qp.set('access_token', token);
    return `https://graph.facebook.com/${API_VER}/act_${actId}/insights?${qp.toString()}`;
  };

  async function getAccountMeta(actId) {
    try {
      const u = `https://graph.facebook.com/${API_VER}/act_${actId}?fields=currency,name,timezone_name&access_token=${encodeURIComponent(token)}`;
      const j = await fetchJSON(u);
      return {
        currency: j?.currency || null,
        accountName: j?.name || null,
        timezone_name: j?.timezone_name || null,
      };
    } catch {
      return { currency: null, accountName: null, timezone_name: null };
    }
  }

  const byCampaignRaw = [];
  const byCampaignDeviceRaw = [];
  const byCampaignPlacementRaw = [];
  const contextRawRows = [];
  const historyCampaignsDaily = [];

  const accountIds = [];
  const accountCurrency = new Map();
  const accountNameMap = new Map();
  const accountTzMap = new Map();
  const campaignMetaByAccount = new Map();

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

  const contextRangeByAccount = new Map();
  const storageRangeByAccount = new Map();

  for (const acct of accountsToAudit) {
    const actId = acct.id;
    accountIds.push(actId);

    const meta = await getAccountMeta(actId);
    accountCurrency.set(actId, meta.currency);
    accountNameMap.set(actId, acct.name || meta.accountName || null);
    accountTzMap.set(actId, meta.timezone_name || 'UTC');

    const tz = accountTzMap.get(actId) || 'UTC';

    const contextTimeRangeObj = explicitContextRange
      ? { since: explicitContextRange.since, until: explicitContextRange.until }
      : getStrictRangeForTZ(tz, contextDays, !!include_today);

    const storageTimeRangeObj = explicitStorageRange
      ? { since: explicitStorageRange.since, until: explicitStorageRange.until }
      : getStrictRangeForTZ(tz, storageDays, !!include_today);

    contextRangeByAccount.set(actId, contextTimeRangeObj);
    storageRangeByAccount.set(actId, storageTimeRangeObj);

    let campMeta = new Map();
    try {
      campMeta = await fetchAllCampaignMeta(actId, token);
    } catch {
      campMeta = new Map();
    }
    campaignMetaByAccount.set(actId, campMeta);

    let data = [];
    try {
      data = await pageAllInsights(mkUrl(actId, contextTimeRangeObj));
    } catch (e) {
      const code = e?._meta?.code;
      const subcode = e?._meta?.error_subcode;
      const isAuth = code === 190 || subcode === 463 || subcode === 467;
      const reason = isAuth ? 'TOKEN_INVALID_OR_EXPIRED' : (e?.message || 'Meta insights failed');
      return { ok: false, notAuthorized: true, reason };
    }

    contextRawRows.push(...data);

    const byCampAgg = new Map();

    for (const x of data) {
      const { purchases, purchase_value } = extractPurchaseMetrics(x);
      const campIdNorm = normAct(x.campaign_id || '');
      const metaInfo = campMeta.get(campIdNorm) || {};
      const rawObjective = x.objective || metaInfo.objective || null;
      const objective_norm = metaInfo.objective_norm || normalizeMetaObjective(rawObjective);
      const key = campIdNorm || x.campaign_id || 'unknown';

      const cur = byCampAgg.get(key) || {
        account_id: actId,
        campaign_id: campIdNorm || x.campaign_id,
        name: x.campaign_name || metaInfo.name || 'Sin nombre',
        objective: rawObjective,
        objective_norm,
        status: metaInfo.status || metaInfo.effective_status || null,
        buying_type: metaInfo.buying_type || null,
        bid_strategy: metaInfo.bid_strategy || null,
        budget: { daily: metaInfo.daily_budget || null, lifetime: metaInfo.lifetime_budget || null },
        kpis: {
          spend: 0,
          impressions: 0,
          reach: 0,
          frequency: 0,
          clicks: 0,
          link_clicks: 0,
          landing_page_views: 0,
          purchases: 0,
          purchase_value: 0,
          add_to_cart: 0,
          initiate_checkout: 0,
          view_content: 0,
          cpm: 0,
          cpc: 0,
          ctr: 0,
          roas: 0,
          cpa: 0,
          conversion_rate: 0,
          aov: 0,
          lpv_rate: 0,
        },
      };

      const k = cur.kpis;
      k.spend += toNum(x.spend);
      k.impressions += toNum(x.impressions);
      k.reach += toNum(x.reach);

      const cx = pickClicks(x);
      k.clicks += cx.clicks;
      k.link_clicks += toNum(x.inline_link_clicks != null ? x.inline_link_clicks : cx.clicks);

      if (purchases != null) k.purchases += purchases;
      if (purchase_value != null) k.purchase_value += purchase_value;

      const actions = Array.isArray(x?.actions) ? x.actions : [];
      const lpv = actions.find((a) => String(a?.action_type || '').toLowerCase() === 'landing_page_view');
      const atc = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('add_to_cart'));
      const ic = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('initiate_checkout'));
      const vc = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('view_content'));

      k.landing_page_views += lpv?.value == null ? 0 : toNum(lpv.value);
      k.add_to_cart += atc?.value == null ? 0 : toNum(atc.value);
      k.initiate_checkout += ic?.value == null ? 0 : toNum(ic.value);
      k.view_content += vc?.value == null ? 0 : toNum(vc.value);

      k.frequency = k.reach > 0 ? safeDiv(k.impressions, k.reach) : 0;
      k.cpm = k.impressions ? (k.spend / k.impressions) * 1000 : 0;
      k.cpc = k.clicks ? (k.spend / k.clicks) : 0;
      k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
      k.roas = (k.purchase_value && k.spend) ? safeDiv(k.purchase_value, k.spend) : 0;
      k.cpa = safeDiv(k.spend, k.purchases);
      k.conversion_rate = k.clicks ? (k.purchases / k.clicks) * 100 : 0;
      k.aov = safeDiv(k.purchase_value, k.purchases);
      k.lpv_rate = k.clicks ? (k.landing_page_views / k.clicks) * 100 : 0;

      byCampAgg.set(key, cur);
    }

    const byCampDeviceAgg = new Map();
    try {
      const devData = await pageAllInsights(mkUrl(actId, contextTimeRangeObj, { breakdowns: 'impression_device' }));
      for (const x of devData) {
        const campIdNorm = normAct(x.campaign_id || '');
        if (!campIdNorm) continue;

        const device = x.impression_device || null;
        if (!device) continue;

        const metaInfo = campMeta.get(campIdNorm) || {};
        const rawObjective = x.objective || metaInfo.objective || null;
        const objective_norm = metaInfo.objective_norm || normalizeMetaObjective(rawObjective);

        const { purchases, purchase_value } = extractPurchaseMetrics(x);

        const dupKey = `${campIdNorm}::${device}`;
        const cur = byCampDeviceAgg.get(dupKey) || {
          account_id: actId,
          campaign_id: campIdNorm,
          objective: rawObjective,
          objective_norm,
          device,
          kpis: {
            spend: 0,
            impressions: 0,
            clicks: 0,
            link_clicks: 0,
            landing_page_views: 0,
            purchases: 0,
            purchase_value: 0,
            roas: 0,
            cpa: 0,
            ctr: 0,
            cpc: 0,
            conversion_rate: 0,
            aov: 0,
          },
        };

        const k = cur.kpis;
        k.spend += toNum(x.spend);
        k.impressions += toNum(x.impressions);
        const cx = pickClicks(x);
        k.clicks += cx.clicks;
        k.link_clicks += toNum(x.inline_link_clicks != null ? x.inline_link_clicks : cx.clicks);
        if (purchases != null) k.purchases += purchases;
        if (purchase_value != null) k.purchase_value += purchase_value;
        k.roas = (k.purchase_value && k.spend) ? safeDiv(k.purchase_value, k.spend) : 0;
        k.cpa = safeDiv(k.spend, k.purchases);
        k.cpc = safeDiv(k.spend, k.clicks);
        k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
        k.conversion_rate = k.clicks ? (k.purchases / k.clicks) * 100 : 0;
        k.aov = safeDiv(k.purchase_value, k.purchases);

        byCampDeviceAgg.set(dupKey, cur);
      }
    } catch {}

    const byCampPlacementAgg = new Map();
    try {
      const plData = await pageAllInsights(mkUrl(actId, contextTimeRangeObj, { breakdowns: 'publisher_platform' }));
      for (const x of plData) {
        const campIdNorm = normAct(x.campaign_id || '');
        if (!campIdNorm) continue;

        const platform = x.publisher_platform || null;
        if (!platform) continue;

        const metaInfo = campMeta.get(campIdNorm) || {};
        const rawObjective = x.objective || metaInfo.objective || null;
        const objective_norm = metaInfo.objective_norm || normalizeMetaObjective(rawObjective);

        const { purchases, purchase_value } = extractPurchaseMetrics(x);

        const dupKey = `${campIdNorm}::${platform}`;
        const cur = byCampPlacementAgg.get(dupKey) || {
          account_id: actId,
          campaign_id: campIdNorm,
          objective: rawObjective,
          objective_norm,
          platform,
          kpis: {
            spend: 0,
            impressions: 0,
            clicks: 0,
            link_clicks: 0,
            landing_page_views: 0,
            purchases: 0,
            purchase_value: 0,
            roas: 0,
            cpa: 0,
            ctr: 0,
            cpc: 0,
            conversion_rate: 0,
            aov: 0,
          },
        };

        const k = cur.kpis;
        k.spend += toNum(x.spend);
        k.impressions += toNum(x.impressions);
        const cx = pickClicks(x);
        k.clicks += cx.clicks;
        k.link_clicks += toNum(x.inline_link_clicks != null ? x.inline_link_clicks : cx.clicks);
        if (purchases != null) k.purchases += purchases;
        if (purchase_value != null) k.purchase_value += purchase_value;
        k.roas = (k.purchase_value && k.spend) ? safeDiv(k.purchase_value, k.spend) : 0;
        k.cpa = safeDiv(k.spend, k.purchases);
        k.cpc = safeDiv(k.spend, k.clicks);
        k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
        k.conversion_rate = k.clicks ? (k.purchases / k.clicks) * 100 : 0;
        k.aov = safeDiv(k.purchase_value, k.purchases);

        byCampPlacementAgg.set(dupKey, cur);
      }
    } catch {}

    for (const [, v] of byCampAgg.entries()) {
      byCampaignRaw.push({
        account_id: v.account_id,
        campaign_id: v.campaign_id,
        name: v.name,
        objective: v.objective,
        objective_norm: v.objective_norm,
        status: v.status,
        buying_type: v.buying_type,
        bid_strategy: v.bid_strategy,
        budget: v.budget,
        kpis: v.kpis,
        accountMeta: {
          name: accountNameMap.get(actId) || null,
          currency: accountCurrency.get(actId) || null,
          timezone_name: accountTzMap.get(actId) || null,
        },
      });
    }

    for (const [, v] of byCampDeviceAgg.entries()) byCampaignDeviceRaw.push(v);
    for (const [, v] of byCampPlacementAgg.entries()) byCampaignPlacementRaw.push(v);

    if (buildHistoricalDatasets && historyIncludeCampaignDaily) {
      const qp = new URLSearchParams();
      qp.set('time_range', JSON.stringify(storageTimeRangeObj));
      qp.set('level', 'campaign');
      qp.set('time_increment', '1');
      qp.set(
        'fields',
        [
          'date_start',
          'campaign_id',
          'campaign_name',
          'objective',
          'spend',
          'impressions',
          'reach',
          'frequency',
          'clicks',
          'inline_link_clicks',
          'actions',
          'action_values',
        ].join(',')
      );
      qp.set('limit', '5000');
      qp.set('action_report_time', process.env.META_ACTION_REPORT_TIME || 'conversion');
      qp.set('use_unified_attribution_setting', 'true');
      qp.set('access_token', token);

      const url = `https://graph.facebook.com/${API_VER}/act_${actId}/insights?${qp.toString()}`;
      let rows = [];
      try {
        rows = await pageAllInsights(url);
      } catch {
        rows = [];
      }

      for (const x of rows) {
        const cid = normAct(x.campaign_id || '');
        if (!cid) continue;

        const metaInfo = campMeta.get(cid) || {};
        const rawObjective = x.objective || metaInfo.objective || null;
        const objective_norm = metaInfo.objective_norm || normalizeMetaObjective(rawObjective);
        const { purchases, purchase_value } = extractPurchaseMetrics(x);
        const cx = pickClicks(x);

        const actions = Array.isArray(x?.actions) ? x.actions : [];
        const lpv = actions.find((a) => String(a?.action_type || '').toLowerCase() === 'landing_page_view');
        const atc = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('add_to_cart'));
        const ic = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('initiate_checkout'));
        const vc = actions.find((a) => String(a?.action_type || '').toLowerCase().includes('view_content'));

        const spend = toNum(x.spend);
        const impressions = toNum(x.impressions);
        const reach = toNum(x.reach);

        historyCampaignsDaily.push({
          date: x.date_start,
          account_id: actId,
          campaign_id: cid,
          campaign_name: trimText(x.campaign_name || metaInfo.name || '', 120) || null,
          objective: rawObjective || null,
          objective_norm,
          status: metaInfo.status || metaInfo.effective_status || null,
          kpis: {
            spend,
            impressions,
            reach,
            frequency: reach > 0 ? safeDiv(impressions, reach) : 0,
            clicks: cx.clicks,
            link_clicks: toNum(x.inline_link_clicks != null ? x.inline_link_clicks : cx.clicks),
            landing_page_views: lpv?.value == null ? 0 : toNum(lpv.value),
            purchases: purchases == null ? 0 : toNum(purchases),
            purchase_value: purchase_value == null ? 0 : toNum(purchase_value),
            add_to_cart: atc?.value == null ? 0 : toNum(atc.value),
            initiate_checkout: ic?.value == null ? 0 : toNum(ic.value),
            view_content: vc?.value == null ? 0 : toNum(vc.value),
            roas: spend > 0 ? safeDiv(purchase_value, spend) : 0,
            cpa: safeDiv(spend, purchases),
            cpc: safeDiv(spend, cx.clicks),
            ctr: impressions > 0 ? (cx.clicks / impressions) * 100 : 0,
            conversion_rate: cx.clicks > 0 ? ((purchases == null ? 0 : toNum(purchases)) / cx.clicks) * 100 : 0,
            aov: safeDiv(purchase_value, purchases),
            lpv_rate: cx.clicks > 0 ? ((lpv?.value == null ? 0 : toNum(lpv.value)) / cx.clicks) * 100 : 0,
          },
        });
      }
    }
  }

  const uniqueCurrencies = Array.from(new Set(accountIds.map((id) => accountCurrency.get(id)).filter(Boolean)));
  const unifiedCurrency = uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : null;

  const accounts = accountIds.map((id) => ({
    id,
    name: accountNameMap.get(id) || null,
    currency: accountCurrency.get(id) || null,
    timezone_name: accountTzMap.get(id) || null,
  }));

  const firstTz = accountIds.length ? (accountTzMap.get(accountIds[0]) || 'UTC') : 'UTC';

  const firstContextRange = explicitContextRange
    ? { since: explicitContextRange.since, until: explicitContextRange.until }
    : getStrictRangeForTZ(firstTz, contextDays, !!include_today);

  const firstStorageRange = explicitStorageRange
    ? { since: explicitStorageRange.since, until: explicitStorageRange.until }
    : getStrictRangeForTZ(firstTz, storageDays, !!include_today);

  const contextFrom = firstContextRange.since;
  const contextTo = firstContextRange.until;
  const storageFrom = firstStorageRange.since;
  const storageTo = firstStorageRange.until;

  const contextRangeOut = { from: contextFrom, to: contextTo, tz: firstTz };
  const storageRangeOut = { from: storageFrom, to: storageTo, tz: firstTz };

  const allKpis = buildContextKpisFromInsightsRows(contextRawRows);

  const deltaWindows = {
    last7: { since: addDaysYMD(contextTo, -6), until: contextTo },
    prev7: { since: addDaysYMD(contextTo, -13), until: addDaysYMD(contextTo, -7) },
    last30: { since: addDaysYMD(contextTo, -29), until: contextTo },
    prev30: { since: addDaysYMD(contextTo, -59), until: addDaysYMD(contextTo, -30) },
  };

  async function fetchAggForWindow(window) {
    const agg = {
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchase_value: 0,
      landing_page_views: 0,
      add_to_cart: 0,
      initiate_checkout: 0,
      view_content: 0,
    };

    for (const a of accountIds) {
      const qp = new URLSearchParams();
      qp.set('time_range', JSON.stringify(window));
      qp.set('level', 'campaign');
      qp.set(
        'fields',
        [
          'spend',
          'impressions',
          'clicks',
          'inline_link_clicks',
          'actions',
          'action_values',
        ].join(',')
      );
      qp.set('limit', '5000');
      qp.set('action_report_time', process.env.META_ACTION_REPORT_TIME || 'conversion');
      qp.set('use_unified_attribution_setting', 'true');
      qp.set('access_token', pickToken(acc));
      const url = `https://graph.facebook.com/${API_VER}/act_${a}/insights?${qp.toString()}`;

      const rows = await pageAllInsights(url);
      for (const x of rows) {
        const { purchases, purchase_value } = extractPurchaseMetrics(x);
        const cx = pickClicks(x);
        const actions = Array.isArray(x?.actions) ? x.actions : [];
        const lpv = actions.find((r) => String(r?.action_type || '').toLowerCase() === 'landing_page_view');
        const atc = actions.find((r) => String(r?.action_type || '').toLowerCase().includes('add_to_cart'));
        const ic = actions.find((r) => String(r?.action_type || '').toLowerCase().includes('initiate_checkout'));
        const vc = actions.find((r) => String(r?.action_type || '').toLowerCase().includes('view_content'));

        agg.spend += toNum(x.spend);
        agg.impressions += toNum(x.impressions);
        agg.clicks += cx.clicks;
        agg.purchases += purchases == null ? 0 : toNum(purchases);
        agg.purchase_value += purchase_value == null ? 0 : toNum(purchase_value);
        agg.landing_page_views += lpv?.value == null ? 0 : toNum(lpv.value);
        agg.add_to_cart += atc?.value == null ? 0 : toNum(atc.value);
        agg.initiate_checkout += ic?.value == null ? 0 : toNum(ic.value);
        agg.view_content += vc?.value == null ? 0 : toNum(vc.value);
      }
    }

    agg.cpc = safeDiv(agg.spend, agg.clicks);
    agg.roas = agg.purchase_value && agg.spend ? safeDiv(agg.purchase_value, agg.spend) : 0;
    agg.cpm = agg.impressions ? (agg.spend / agg.impressions) * 1000 : 0;
    agg.ctr = agg.impressions ? (agg.clicks / agg.impressions) * 100 : 0;
    agg.cpa = safeDiv(agg.spend, agg.purchases);
    agg.conversion_rate = agg.clicks ? (agg.purchases / agg.clicks) * 100 : 0;
    agg.aov = safeDiv(agg.purchase_value, agg.purchases);
    agg.lpv_rate = agg.clicks ? (agg.landing_page_views / agg.clicks) * 100 : 0;
    agg.frequency = 0;
    agg.reach = 0;
    agg.mer = 0;
    agg.blended_cac = 0;
    agg.new_customer_cac = 0;
    agg.profit = 0;
    agg.contribution_margin = 0;

    return agg;
  }

  let last7 = null;
  let prev7 = null;
  let last30 = null;
  let prev30 = null;
  try {
    last7 = await fetchAggForWindow(deltaWindows.last7);
    prev7 = await fetchAggForWindow(deltaWindows.prev7);
    last30 = await fetchAggForWindow(deltaWindows.last30);
    prev30 = await fetchAggForWindow(deltaWindows.prev30);
  } catch {}

  const summary = {
    kpis: allKpis,
    windows: {
      last_7_days: last7,
      prev_7_days: prev7,
      last_30_days: last30,
      prev_30_days: prev30,
    },
    deltas: {
      last7_vs_prev7: (last7 && prev7) ? computeDeltas(last7, prev7) : null,
      last30_vs_prev30: (last30 && prev30) ? computeDeltas(last30, prev30) : null,
    },
  };

  const tops = {
    by_spend: topN(byCampaignRaw, topCampaignsN, (x) => toNum(x?.kpis?.spend)),
    by_purchases: topN(byCampaignRaw, topCampaignsN, (x) => toNum(x?.kpis?.purchases)),
    by_roas: topN(byCampaignRaw.filter((x) => toNum(x?.kpis?.spend) > 0), topCampaignsN, (x) => toNum(x?.kpis?.roas)),
  };

  const topSets = {
    bySpend: new Set(tops.by_spend.map((x) => String(x.campaign_id))),
    byPurchases: new Set(tops.by_purchases.map((x) => String(x.campaign_id))),
    byRoas: new Set(tops.by_roas.map((x) => String(x.campaign_id))),
  };

  const campaignMap = new Map();
  for (const c of byCampaignRaw) {
    const id = String(c?.campaign_id || '').trim();
    if (!id) continue;
    campaignMap.set(id, c);
  }

  const rankedCampaigns = Array.from(campaignMap.values())
    .map((c) => slimCampaign(c, topSets))
    .sort((a, b) => b.ranking_score - a.ranking_score)
    .slice(0, topCampaignsN);

  const breakdownsTop = {
    device_top: aggregateBreakdown(byCampaignDeviceRaw, 'device', topBreakdownsN),
    placement_top: aggregateBreakdown(byCampaignPlacementRaw, 'platform', topBreakdownsN),
  };

  const optimizationSignals = buildOptimizationSignals({
    rankedCampaigns,
    deviceTop: breakdownsTop.device_top,
    placementTop: breakdownsTop.placement_top,
    summary,
  });

  const aiDailyRange = { since: addDaysYMD(contextTo, -(contextDailyDays - 1)), until: contextTo };

  const aiDailyTopIds = new Set(
    rankedCampaigns
      .slice(0, clampInt(aiDailyTopCampaigns || 5, 3, 10))
      .map((c) => String(c.campaign_id))
  );

  const dailySeries = { campaigns_daily: [] };
  if (buildDailySeries && aiDailyTopIds.size > 0) {
    for (const a of accountIds) {
      const qp = new URLSearchParams();
      qp.set('time_range', JSON.stringify(aiDailyRange));
      qp.set('level', 'campaign');
      qp.set('time_increment', '1');
      qp.set(
        'fields',
        [
          'date_start',
          'campaign_id',
          'campaign_name',
          'objective',
          'spend',
          'impressions',
          'reach',
          'frequency',
          'clicks',
          'inline_link_clicks',
          'actions',
          'action_values',
        ].join(',')
      );
      qp.set('limit', '5000');
      qp.set('action_report_time', process.env.META_ACTION_REPORT_TIME || 'conversion');
      qp.set('use_unified_attribution_setting', 'true');
      qp.set('access_token', pickToken(acc));

      const url = `https://graph.facebook.com/${API_VER}/act_${a}/insights?${qp.toString()}`;
      let rows = [];
      try {
        rows = await pageAllInsights(url);
      } catch {
        rows = [];
      }

      const campMeta = campaignMetaByAccount.get(a) || new Map();

      for (const x of rows) {
        const cid = normAct(x.campaign_id || '');
        if (!cid || !aiDailyTopIds.has(String(cid))) continue;

        const metaInfo = campMeta.get(cid) || {};
        const rawObjective = x.objective || metaInfo.objective || null;
        const objective_norm = metaInfo.objective_norm || normalizeMetaObjective(rawObjective);
        const { purchases, purchase_value } = extractPurchaseMetrics(x);
        const cx = pickClicks(x);
        const actions = Array.isArray(x?.actions) ? x.actions : [];
        const lpv = actions.find((r) => String(r?.action_type || '').toLowerCase() === 'landing_page_view');
        const atc = actions.find((r) => String(r?.action_type || '').toLowerCase().includes('add_to_cart'));
        const ic = actions.find((r) => String(r?.action_type || '').toLowerCase().includes('initiate_checkout'));
        const vc = actions.find((r) => String(r?.action_type || '').toLowerCase().includes('view_content'));

        const spend = toNum(x.spend);
        const impressions = toNum(x.impressions);
        const reach = toNum(x.reach);

        dailySeries.campaigns_daily.push({
          date: x.date_start,
          account_id: a,
          campaign_id: cid,
          campaign_name: trimText(x.campaign_name || metaInfo.name || '', 120) || null,
          objective: rawObjective || null,
          objective_norm,
          status: metaInfo.status || metaInfo.effective_status || null,
          kpis: {
            spend,
            impressions,
            reach,
            frequency: reach > 0 ? safeDiv(impressions, reach) : 0,
            clicks: cx.clicks,
            link_clicks: toNum(x.inline_link_clicks != null ? x.inline_link_clicks : cx.clicks),
            landing_page_views: lpv?.value == null ? 0 : toNum(lpv.value),
            purchases: purchases == null ? 0 : toNum(purchases),
            purchase_value: purchase_value == null ? 0 : toNum(purchase_value),
            add_to_cart: atc?.value == null ? 0 : toNum(atc.value),
            initiate_checkout: ic?.value == null ? 0 : toNum(ic.value),
            view_content: vc?.value == null ? 0 : toNum(vc.value),
            roas: spend > 0 ? safeDiv(purchase_value, spend) : 0,
            cpa: safeDiv(spend, purchases),
            cpc: safeDiv(spend, cx.clicks),
            ctr: impressions > 0 ? (cx.clicks / impressions) * 100 : 0,
            conversion_rate: cx.clicks > 0 ? ((purchases == null ? 0 : toNum(purchases)) / cx.clicks) * 100 : 0,
            aov: safeDiv(purchase_value, purchases),
            lpv_rate: cx.clicks > 0 ? ((lpv?.value == null ? 0 : toNum(lpv.value)) / cx.clicks) * 100 : 0,
          },
        });
      }
    }
  }

  const totalsByDay = aggregateDailyTotals(dailySeries.campaigns_daily);
  const historyTotalsByDay = aggregateDailyTotals(historyCampaignsDaily);

  const contextHeader = makeMetaHeader({
    userId,
    accountIds,
    accounts,
    range: contextRangeOut,
    currency: unifiedCurrency,
    version: `metaCollector@mcp-v3(clicks=${META_CLICK_METRIC},include_today=${!!include_today})`,
    windowType: 'context',
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  const historyHeader = makeMetaHeader({
    userId,
    accountIds,
    accounts,
    range: storageRangeOut,
    currency: unifiedCurrency,
    version: `metaCollector@mcp-v3(clicks=${META_CLICK_METRIC},include_today=${!!include_today})`,
    windowType: 'storage',
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  // --- 3a: Fetch ad sets with insights ---
  let adSetsData = [];
  if (buildAdSets) {
    try {
      for (const a of accountIds) {
        const adSetsList = await pageAllInsights(
          `https://graph.facebook.com/${API_VER}/act_${a}/adsets?fields=id,name,campaign_id,status,effective_status,bid_strategy,bid_amount,daily_budget,lifetime_budget,optimization_goal&limit=500&access_token=${encodeURIComponent(token)}`
        );

        const insights7Url = `https://graph.facebook.com/${API_VER}/act_${a}/insights?fields=adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,frequency,reach,actions,action_values&level=adset&date_preset=last_7d&limit=500&access_token=${encodeURIComponent(token)}`;
        const insights7 = await pageAllInsights(insights7Url);
        const insights30 = await pageAllInsights(insights7Url.replace('last_7d', 'last_30d'));

        const insightsMap7 = new Map(insights7.map((r) => [r.adset_id, r]));
        const insightsMap30 = new Map(insights30.map((r) => [r.adset_id, r]));

        for (const adSet of adSetsList) {
          const i7 = insightsMap7.get(adSet.id) || {};
          const i30 = insightsMap30.get(adSet.id) || {};
          const spend7 = toNum(i7.spend);
          const purchases7 = pickActionValue(i7.actions, PURCHASE_ACTION_PRIORITY).value;
          const spend30 = toNum(i30.spend);
          const purchases30 = pickActionValue(i30.actions, PURCHASE_ACTION_PRIORITY).value;

          adSetsData.push({
            ad_set_id: adSet.id,
            ad_set_name: adSet.name,
            campaign_id: adSet.campaign_id,
            status: adSet.effective_status || adSet.status,
            bid_strategy: adSet.bid_strategy || null,
            bid_amount: adSet.bid_amount ? minorToUnit(adSet.bid_amount) : null,
            daily_budget: adSet.daily_budget ? minorToUnit(adSet.daily_budget) : null,
            optimization_goal: adSet.optimization_goal || null,
            last_7: {
              spend: round2(spend7),
              impressions: toNum(i7.impressions),
              clicks: toNum(i7.clicks),
              ctr: toNum(i7.ctr),
              cpc: toNum(i7.cpc),
              reach: toNum(i7.reach),
              frequency: toNum(i7.frequency),
              conversions: purchases7,
            },
            last_30: {
              spend: round2(spend30),
              impressions: toNum(i30.impressions),
              clicks: toNum(i30.clicks),
              ctr: toNum(i30.ctr),
              cpc: toNum(i30.cpc),
              frequency: toNum(i30.frequency),
              conversions: purchases30,
            },
            cpa_7d: spend7 > 0 && purchases7 > 0 ? round2(spend7 / purchases7) : null,
            cpa_30d: spend30 > 0 && purchases30 > 0 ? round2(spend30 / purchases30) : null,
            frequency_warning: toNum(i7.frequency) > 3.5,
          });
        }
      }
    } catch (e) {
      adSetsData = [];
    }
  }

  // --- 3b: Fetch ads with insights ---
  let adsData = [];
  if (buildAds) {
    try {
      for (const a of accountIds) {
        const adsList = await pageAllInsights(
          `https://graph.facebook.com/${API_VER}/act_${a}/ads?fields=id,name,adset_id,campaign_id,status,effective_status,creative{id,title,object_type}&limit=500&access_token=${encodeURIComponent(token)}`
        );

        const adInsights7Url = `https://graph.facebook.com/${API_VER}/act_${a}/insights?fields=ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,frequency,actions,action_values&level=ad&date_preset=last_7d&limit=500&access_token=${encodeURIComponent(token)}`;
        const adInsights7 = await pageAllInsights(adInsights7Url);
        const adInsights30 = await pageAllInsights(adInsights7Url.replace('last_7d', 'last_30d'));

        const adInsightsMap7 = new Map(adInsights7.map((r) => [r.ad_id, r]));
        const adInsightsMap30 = new Map(adInsights30.map((r) => [r.ad_id, r]));

        const allRoas7 = adInsights7
          .map((r) => {
            const s = toNum(r.spend);
            const v = pickActionValue(r.action_values, PURCHASE_ACTION_PRIORITY).value;
            return s > 0 && v != null ? v / s : null;
          })
          .filter((v) => v != null);
        const accountAvgRoas7 = allRoas7.length > 0
          ? allRoas7.reduce((acc, b) => acc + b, 0) / allRoas7.length : null;

        const allCtr7 = adInsights7.map((r) => toNum(r.ctr)).filter((v) => v > 0);
        const accountAvgCtr7 = allCtr7.length > 0
          ? allCtr7.reduce((acc, b) => acc + b, 0) / allCtr7.length : null;

        for (const ad of adsList) {
          const i7 = adInsightsMap7.get(ad.id) || {};
          const i30 = adInsightsMap30.get(ad.id) || {};
          const spend7 = toNum(i7.spend);
          const purchaseValue7 = pickActionValue(i7.action_values, PURCHASE_ACTION_PRIORITY).value;
          const roas7 = spend7 > 0 && purchaseValue7 != null ? round2(purchaseValue7 / spend7) : null;
          const ctr7 = toNum(i7.ctr);
          const freq7 = toNum(i7.frequency);
          const spend30 = toNum(i30.spend);
          const purchaseValue30 = pickActionValue(i30.action_values, PURCHASE_ACTION_PRIORITY).value;

          adsData.push({
            ad_id: ad.id,
            ad_name: ad.name,
            adset_id: ad.adset_id,
            campaign_id: ad.campaign_id,
            status: ad.effective_status || ad.status,
            creative_type: ad.creative?.object_type || null,
            headline: ad.creative?.title || null,
            last_7_spend: round2(spend7),
            last_7_impressions: toNum(i7.impressions),
            last_7_ctr: round2(ctr7),
            last_7_roas_platform: roas7,
            last_7_frequency: freq7 > 0 ? round2(freq7) : null,
            last_30_ctr: round2(toNum(i30.ctr)),
            last_30_roas_platform: spend30 > 0 && purchaseValue30 != null
              ? round2(purchaseValue30 / spend30) : null,
            ctr_vs_account_avg: accountAvgCtr7 && ctr7 > 0
              ? round2(ctr7 / accountAvgCtr7) : null,
            roas_vs_account_avg: accountAvgRoas7 && roas7 != null
              ? round2(roas7 / accountAvgRoas7) : null,
            fatigue_flag: freq7 > 3 && toNum(i30.ctr) > 0 && ctr7 < toNum(i30.ctr),
            top_performer_flag: roas7 != null && accountAvgRoas7 != null && spend7 >= 100
              ? roas7 >= accountAvgRoas7 * 1.2 : false,
          });
        }
      }
    } catch (e) {
      adsData = [];
    }
  }

  const summaryStats = {
    rows: 1,
    bytes: 0,
  };

  const rankedStats = {
    rows: rankedCampaigns.length,
    bytes: 0,
  };

  const breakdownStats = {
    rows: breakdownsTop.device_top.length + breakdownsTop.placement_top.length,
    bytes: 0,
  };

  const signalStats = {
    rows:
      optimizationSignals.winners.length +
      optimizationSignals.risks.length +
      optimizationSignals.quick_wins.length,
    bytes: 0,
  };

  const dailyAiStats = {
    rows:
      (Array.isArray(dailySeries.campaigns_daily) ? dailySeries.campaigns_daily.length : 0) +
      (Array.isArray(totalsByDay) ? totalsByDay.length : 0),
    bytes: 0,
  };

  const historyTotalsStats = {
    rows: Array.isArray(historyTotalsByDay) ? historyTotalsByDay.length : 0,
    bytes: 0,
  };

  const datasets = [
    {
      source: 'metaAds',
      dataset: 'meta.insights_summary',
      range: contextRangeOut,
      stats: summaryStats,
      data: { meta: contextHeader, summary },
    },
    {
      source: 'metaAds',
      dataset: 'meta.campaigns_ranked',
      range: contextRangeOut,
      stats: rankedStats,
      data: {
        meta: contextHeader,
        campaigns_ranked: rankedCampaigns,
      },
    },
    {
      source: 'metaAds',
      dataset: 'meta.breakdowns_top',
      range: contextRangeOut,
      stats: breakdownStats,
      data: { meta: contextHeader, ...breakdownsTop },
    },
    {
      source: 'metaAds',
      dataset: 'meta.optimization_signals',
      range: contextRangeOut,
      stats: signalStats,
      data: {
        meta: contextHeader,
        optimization_signals: optimizationSignals,
      },
    },
  ];

  if (buildDailySeries) {
    datasets.push({
      source: 'metaAds',
      dataset: 'meta.daily_trends_ai',
      range: { from: aiDailyRange.since, to: aiDailyRange.until, tz: firstTz },
      stats: dailyAiStats,
      data: {
        meta: {
          ...contextHeader,
          range: { from: aiDailyRange.since, to: aiDailyRange.until, tz: firstTz },
          dailyWindowDays: contextDailyDays,
        },
        totals_by_day: totalsByDay,
        campaigns_daily: dailySeries.campaigns_daily,
      },
    });
  }

  if (buildHistoricalDatasets) {
    datasets.push({
      source: 'metaAds',
      dataset: 'meta.history.daily_account_totals',
      range: storageRangeOut,
      stats: historyTotalsStats,
      data: {
        meta: historyHeader,
        totals_by_day: historyTotalsByDay,
      },
    });

    if (historyIncludeCampaignDaily && historyCampaignsDaily.length > 0) {
      const byMonth = partitionRowsByMonth(historyCampaignsDaily);

      for (const [monthKey, rows] of byMonth.entries()) {
        datasets.push({
          source: 'metaAds',
          dataset: `meta.history.daily_campaigns.${monthKey}`,
          range: {
            from: rows[0]?.date || storageRangeOut.from,
            to: rows[rows.length - 1]?.date || storageRangeOut.to,
            tz: firstTz,
          },
          stats: {
            rows: rows.length,
            bytes: 0,
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

  if (buildAdSets && adSetsData.length > 0) {
    datasets.push({
      source: 'metaAds',
      dataset: 'meta.ad_sets',
      range: contextRangeOut,
      stats: { rows: adSetsData.length, bytes: 0 },
      data: {
        meta: contextHeader,
        ad_sets: adSetsData,
      },
    });
  }

  if (buildAds && adsData.length > 0) {
    datasets.push({
      source: 'metaAds',
      dataset: 'meta.ads',
      range: contextRangeOut,
      stats: { rows: adsData.length, bytes: 0 },
      data: {
        meta: contextHeader,
        ads: adsData,
      },
    });
  }

  return {
    ok: true,
    notAuthorized: false,
    reason: null,
    defaultAccountId: pickDefaultAccountId(acc) || null,
    currency: unifiedCurrency,

    // compat actual
    timeRange: {
      from: contextFrom,
      to: contextTo,
      since: contextFrom,
      until: contextTo,
    },

    // nuevos metadatos para futura orquestación
    contextTimeRange: {
      from: contextFrom,
      to: contextTo,
      since: contextFrom,
      until: contextTo,
      tz: firstTz,
      days: contextDays,
    },
    storageTimeRange: {
      from: storageFrom,
      to: storageTo,
      since: storageFrom,
      until: storageTo,
      tz: firstTz,
      days: storageDays,
    },
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,

    accountIds,
    accounts,
    datasets,
  };
}

module.exports = { collectMeta };