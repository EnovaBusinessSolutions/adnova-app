'use strict';

/**
 * Resolución snapshot-first compartida entre MCP tools y el espejo REST /gpt/v1.
 * Usa los mismos nombres de tool que MCP_SNAPSHOT_FIRST_TOOLS para que el filtro por env sea coherente.
 */

const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const shopifyAdapter = require('../adapters/shopify');
const { resolveSnapshotFirstData } = require('../snapshot/runSnapshotFirst');
const { buildAdPerformanceSnapshot, buildCampaignPerformanceSnapshot } = require('../snapshot/builders');

const TOOL_AD = 'get_ad_performance';
const TOOL_CAMP = 'get_campaign_performance';
const TOOL_CH = 'get_channel_summary';
const TOOL_DC = 'get_date_comparison';

/** Respuesta estable cuando no hay snapshot y la API en vivo falla (p. ej. Google 403). */
function emptyAdPerformance(channel, dateFrom, dateTo, granularity) {
  const gran = granularity || 'total';
  return {
    channel,
    spend: 0,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    currency: 'USD',
    date_from: dateFrom,
    date_to: dateTo,
    rows: gran && gran !== 'total' ? [] : [],
  };
}

function emptyCampaignPerformance(channel, dateFrom, dateTo, _limit, _status) {
  return {
    channel,
    campaigns: [],
    total_spend: 0,
    currency: 'USD',
    date_from: dateFrom,
    date_to: dateTo,
  };
}

function round(n, d = 2) {
  return Number(Number(n || 0).toFixed(d));
}

function direction(a, b) {
  if (b > a) return 'up';
  if (b < a) return 'down';
  return 'flat';
}

function compareAdMetrics(periodA, periodB) {
  const metricNames = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'];
  return metricNames.map((name) => {
    const valA = Number(periodA?.[name] || 0);
    const valB = Number(periodB?.[name] || 0);
    return {
      name,
      period_a_value: round(valA),
      period_b_value: round(valB),
      change_absolute: round(valB - valA),
      change_pct: round(valA ? ((valB - valA) / valA) * 100 : valB ? 100 : 0),
      direction: direction(valA, valB),
    };
  });
}

function compareShopifyMetrics(periodA, periodB) {
  const metricNames = ['total_revenue', 'net_revenue', 'total_orders', 'average_order_value'];
  return metricNames.map((name) => {
    const valA = Number(periodA?.[name] || 0);
    const valB = Number(periodB?.[name] || 0);
    return {
      name,
      period_a_value: round(valA),
      period_b_value: round(valB),
      change_absolute: round(valB - valA),
      change_pct: round(valA ? ((valB - valA) / valA) * 100 : valB ? 100 : 0),
      direction: direction(valA, valB),
    };
  });
}

/**
 * @param {'meta'|'google'} channel
 */
async function resolveAdPerformance(userId, channel, dateFrom, dateTo, granularity) {
  const gran = granularity || 'total';
  if (channel === 'meta') {
    try {
      return await resolveSnapshotFirstData({
        toolName: TOOL_AD,
        userId,
        refreshSource: 'metaAds',
        buildSnapshot: () =>
          buildAdPerformanceSnapshot(userId, 'metaAds', 'meta', dateFrom, dateTo, gran),
        execLive: () => metaAdapter.getAdPerformance(userId, dateFrom, dateTo, gran),
      });
    } catch (e) {
      if (e?.code === 'ACCOUNT_NOT_CONNECTED') throw e;
      return emptyAdPerformance('meta', dateFrom, dateTo, gran);
    }
  }
  try {
    return await resolveSnapshotFirstData({
      toolName: TOOL_AD,
      userId,
      refreshSource: 'googleAds',
      buildSnapshot: () =>
        buildAdPerformanceSnapshot(userId, 'googleAds', 'google', dateFrom, dateTo, gran),
      execLive: () => googleAdapter.getAdPerformance(userId, dateFrom, dateTo, gran),
    });
  } catch (e) {
    if (e?.code === 'ACCOUNT_NOT_CONNECTED') throw e;
    return emptyAdPerformance('google', dateFrom, dateTo, gran);
  }
}

/**
 * Meta + Google; errores por canal se ignoran (misma semántica que antes en REST).
 */
async function resolveAdPerformanceAll(userId, dateFrom, dateTo, granularity) {
  const gran = granularity || 'total';
  const results = [];
  try {
    results.push(await resolveAdPerformance(userId, 'meta', dateFrom, dateTo, gran));
  } catch {}
  try {
    results.push(await resolveAdPerformance(userId, 'google', dateFrom, dateTo, gran));
  } catch {}
  return results;
}

/**
 * @param {'meta'|'google'} channel
 */
async function resolveCampaignPerformance(userId, channel, dateFrom, dateTo, limit, status) {
  const lim = Number(limit) || 10;
  const st = status || 'all';
  if (channel === 'meta') {
    try {
      return await resolveSnapshotFirstData({
        toolName: TOOL_CAMP,
        userId,
        refreshSource: 'metaAds',
        buildSnapshot: () =>
          buildCampaignPerformanceSnapshot(userId, 'metaAds', 'meta', dateFrom, dateTo, lim, st),
        execLive: () => metaAdapter.getCampaignPerformance(userId, dateFrom, dateTo, lim, st),
      });
    } catch (e) {
      if (e?.code === 'ACCOUNT_NOT_CONNECTED') throw e;
      return emptyCampaignPerformance('meta', dateFrom, dateTo, lim, st);
    }
  }
  try {
    return await resolveSnapshotFirstData({
      toolName: TOOL_CAMP,
      userId,
      refreshSource: 'googleAds',
      buildSnapshot: () =>
        buildCampaignPerformanceSnapshot(userId, 'googleAds', 'google', dateFrom, dateTo, lim, st),
      execLive: () => googleAdapter.getCampaignPerformance(userId, dateFrom, dateTo, lim, st),
    });
  } catch {
    return emptyCampaignPerformance('google', dateFrom, dateTo, lim, st);
  }
}

async function resolveChannelSummaryPayload(userId, dateFrom, dateTo) {
  const channels = [];
  const currencies = new Set();

  try {
    let meta;
    try {
      meta = await resolveSnapshotFirstData({
        toolName: TOOL_CH,
        userId,
        refreshSource: 'metaAds',
        buildSnapshot: () =>
          buildAdPerformanceSnapshot(userId, 'metaAds', 'meta', dateFrom, dateTo, 'total'),
        execLive: () => metaAdapter.getAdPerformance(userId, dateFrom, dateTo, 'total'),
      });
    } catch (e) {
      if (e?.code === 'ACCOUNT_NOT_CONNECTED') throw e;
      meta = emptyAdPerformance('meta', dateFrom, dateTo, 'total');
    }
    channels.push({
      channel: 'meta',
      spend: meta.spend,
      impressions: meta.impressions,
      clicks: meta.clicks,
      ctr: meta.ctr,
      conversions: 0,
      roas_reported: 0,
      currency: meta.currency,
    });
    currencies.add(meta.currency);
  } catch {}

  try {
    let google;
    try {
      google = await resolveSnapshotFirstData({
        toolName: TOOL_CH,
        userId,
        refreshSource: 'googleAds',
        buildSnapshot: () =>
          buildAdPerformanceSnapshot(userId, 'googleAds', 'google', dateFrom, dateTo, 'total'),
        execLive: () => googleAdapter.getAdPerformance(userId, dateFrom, dateTo, 'total'),
      });
    } catch (e) {
      if (e?.code === 'ACCOUNT_NOT_CONNECTED') throw e;
      google = emptyAdPerformance('google', dateFrom, dateTo, 'total');
    }
    channels.push({
      channel: 'google',
      spend: google.spend,
      impressions: google.impressions,
      clicks: google.clicks,
      ctr: google.ctr,
      conversions: 0,
      roas_reported: 0,
      currency: google.currency,
    });
    currencies.add(google.currency);
  } catch {}

  const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
  for (const ch of channels) {
    ch.spend_pct = round(totalSpend ? (ch.spend / totalSpend) * 100 : 0);
  }

  const result = { date_from: dateFrom, date_to: dateTo, channels };
  if (currencies.size <= 1) {
    result.total_spend = round(totalSpend);
    result.currency = currencies.values().next().value || 'USD';
  } else {
    result.currency_note =
      'Accounts use different currencies. Per-channel totals are shown in their native currency. Cross-channel total requires currency normalization.';
  }
  return result;
}

/**
 * Misma forma que la tool get_date_comparison (objeto plano antes de createToolResponse).
 */
async function resolveDateComparisonPayload(
  userId,
  channel,
  period_a_from,
  period_a_to,
  period_b_from,
  period_b_to
) {
  const result = {
    channel,
    period_a: { from: period_a_from, to: period_a_to },
    period_b: { from: period_b_from, to: period_b_to },
    metrics: [],
  };

  if (channel === 'meta' || channel === 'all') {
    try {
      const [aRaw, bRaw] = await Promise.all([
        resolveSnapshotFirstData({
          toolName: TOOL_DC,
          userId,
          refreshSource: 'metaAds',
          buildSnapshot: () =>
            buildAdPerformanceSnapshot(
              userId,
              'metaAds',
              'meta',
              period_a_from,
              period_a_to,
              'total'
            ),
          execLive: () =>
            metaAdapter.getAdPerformance(userId, period_a_from, period_a_to, 'total'),
        }).catch(() => null),
        resolveSnapshotFirstData({
          toolName: TOOL_DC,
          userId,
          refreshSource: 'metaAds',
          buildSnapshot: () =>
            buildAdPerformanceSnapshot(
              userId,
              'metaAds',
              'meta',
              period_b_from,
              period_b_to,
              'total'
            ),
          execLive: () =>
            metaAdapter.getAdPerformance(userId, period_b_from, period_b_to, 'total'),
        }).catch(() => null),
      ]);
      const a = aRaw ?? emptyAdPerformance('meta', period_a_from, period_a_to, 'total');
      const b = bRaw ?? emptyAdPerformance('meta', period_b_from, period_b_to, 'total');
      if (channel === 'all') result.meta = { metrics: compareAdMetrics(a, b) };
      else result.metrics = compareAdMetrics(a, b);
    } catch {}
  }

  if (channel === 'google' || channel === 'all') {
    try {
      const [aRaw, bRaw] = await Promise.all([
        resolveSnapshotFirstData({
          toolName: TOOL_DC,
          userId,
          refreshSource: 'googleAds',
          buildSnapshot: () =>
            buildAdPerformanceSnapshot(
              userId,
              'googleAds',
              'google',
              period_a_from,
              period_a_to,
              'total'
            ),
          execLive: () =>
            googleAdapter.getAdPerformance(userId, period_a_from, period_a_to, 'total'),
        }).catch(() => null),
        resolveSnapshotFirstData({
          toolName: TOOL_DC,
          userId,
          refreshSource: 'googleAds',
          buildSnapshot: () =>
            buildAdPerformanceSnapshot(
              userId,
              'googleAds',
              'google',
              period_b_from,
              period_b_to,
              'total'
            ),
          execLive: () =>
            googleAdapter.getAdPerformance(userId, period_b_from, period_b_to, 'total'),
        }).catch(() => null),
      ]);
      const a = aRaw ?? emptyAdPerformance('google', period_a_from, period_a_to, 'total');
      const b = bRaw ?? emptyAdPerformance('google', period_b_from, period_b_to, 'total');
      if (channel === 'all') result.google = { metrics: compareAdMetrics(a, b) };
      else result.metrics = compareAdMetrics(a, b);
    } catch {}
  }

  if (channel === 'shopify' || channel === 'all') {
    try {
      const [a, b] = await Promise.all([
        shopifyAdapter.getShopifyRevenue(userId, period_a_from, period_a_to, 'total'),
        shopifyAdapter.getShopifyRevenue(userId, period_b_from, period_b_to, 'total'),
      ]);
      if (channel === 'all') result.shopify = { metrics: compareShopifyMetrics(a, b) };
      else result.metrics = compareShopifyMetrics(a, b);
    } catch {}
  }

  return result;
}

/**
 * Opciones para runSnapshotFirstTool desde las tools MCP (canal único).
 */
function adPerformanceSnapshotOpts(userId, channel, dateFrom, dateTo, gran) {
  const g = gran || 'total';
  if (channel === 'meta') {
    return {
      toolName: TOOL_AD,
      userId,
      refreshSource: 'metaAds',
      buildSnapshot: () =>
        buildAdPerformanceSnapshot(userId, 'metaAds', 'meta', dateFrom, dateTo, g),
      execLive: () => metaAdapter.getAdPerformance(userId, dateFrom, dateTo, g),
      emptyFallback: () => emptyAdPerformance('meta', dateFrom, dateTo, g),
    };
  }
  return {
    toolName: TOOL_AD,
    userId,
    refreshSource: 'googleAds',
    buildSnapshot: () =>
      buildAdPerformanceSnapshot(userId, 'googleAds', 'google', dateFrom, dateTo, g),
    execLive: () => googleAdapter.getAdPerformance(userId, dateFrom, dateTo, g),
    emptyFallback: () => emptyAdPerformance('google', dateFrom, dateTo, g),
  };
}

function campaignPerformanceSnapshotOpts(userId, channel, dateFrom, dateTo, limit, status) {
  const lim = limit || 10;
  const st = status || 'all';
  if (channel === 'meta') {
    return {
      toolName: TOOL_CAMP,
      userId,
      refreshSource: 'metaAds',
      buildSnapshot: () =>
        buildCampaignPerformanceSnapshot(userId, 'metaAds', 'meta', dateFrom, dateTo, lim, st),
      execLive: () => metaAdapter.getCampaignPerformance(userId, dateFrom, dateTo, lim, st),
      emptyFallback: () => emptyCampaignPerformance('meta', dateFrom, dateTo, lim, st),
    };
  }
  return {
    toolName: TOOL_CAMP,
    userId,
    refreshSource: 'googleAds',
    buildSnapshot: () =>
      buildCampaignPerformanceSnapshot(userId, 'googleAds', 'google', dateFrom, dateTo, lim, st),
    execLive: () => googleAdapter.getCampaignPerformance(userId, dateFrom, dateTo, lim, st),
    emptyFallback: () => emptyCampaignPerformance('google', dateFrom, dateTo, lim, st),
  };
}

module.exports = {
  TOOL_AD,
  TOOL_CAMP,
  TOOL_CH,
  TOOL_DC,
  emptyAdPerformance,
  emptyCampaignPerformance,
  resolveAdPerformance,
  resolveAdPerformanceAll,
  resolveCampaignPerformance,
  resolveChannelSummaryPayload,
  resolveDateComparisonPayload,
  adPerformanceSnapshotOpts,
  campaignPerformanceSnapshotOpts,
  compareAdMetrics,
  compareShopifyMetrics,
  round,
};
