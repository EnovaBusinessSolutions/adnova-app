// backend/jobs/transform/metaLlmFormatter.js
'use strict';

/**
 * Meta LLM Formatter
 *
 * Objetivo:
 * - Tomar los chunks MCP de Meta Ads ya compactados
 * - Generar una vista aún más corta, priorizada y útil para LLM
 * - Mantener muchísimo valor analítico con menos tokens
 *
 * Espera datasets como:
 * - meta.insights_summary
 * - meta.campaigns_ranked
 * - meta.breakdowns_top
 * - meta.optimization_signals
 * - meta.daily_trends_ai
 */

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeStr(v) {
  return v == null ? '' : String(v);
}

function round2(v) {
  return Number(toNum(v).toFixed(2));
}

function compactArray(arr, max = 10) {
  return Array.isArray(arr) ? arr.slice(0, Math.max(0, max)) : [];
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function indexDatasets(datasets) {
  const map = new Map();
  for (const ds of Array.isArray(datasets) ? datasets : []) {
    const key = safeStr(ds?.dataset).trim();
    if (!key) continue;
    map.set(key, ds);
  }
  return map;
}

function getData(dsMap, name) {
  return dsMap.get(name)?.data || null;
}

function getMetaHeader(dsMap) {
  return (
    getData(dsMap, 'meta.insights_summary')?.meta ||
    getData(dsMap, 'meta.campaigns_ranked')?.meta ||
    getData(dsMap, 'meta.breakdowns_top')?.meta ||
    getData(dsMap, 'meta.optimization_signals')?.meta ||
    getData(dsMap, 'meta.daily_trends_ai')?.meta ||
    null
  );
}

function buildExecutiveSummary(summaryData) {
  const summary = summaryData?.summary || {};
  const kpis = summary?.kpis || {};
  const deltas = summary?.deltas || {};
  const last7 = summary?.windows?.last_7_days || null;
  const prev7 = summary?.windows?.prev_7_days || null;
  const last30 = summary?.windows?.last_30_days || null;
  const prev30 = summary?.windows?.prev_30_days || null;

  return {
    headline_kpis: {
      spend: round2(kpis.spend),
      impressions: round2(kpis.impressions),
      clicks: round2(kpis.clicks),
      purchases: round2(kpis.purchases),
      purchase_value: round2(kpis.purchase_value),
      roas: round2(kpis.roas),
      cpa: round2(kpis.cpa),
      cpc: round2(kpis.cpc),
      ctr: round2(kpis.ctr),
      cpm: round2(kpis.cpm),
    },
    comparison_windows: {
      last_7_days: last7
        ? {
            spend: round2(last7.spend),
            purchases: round2(last7.purchases),
            purchase_value: round2(last7.purchase_value),
            roas: round2(last7.roas),
            cpa: round2(last7.cpa),
          }
        : null,
      prev_7_days: prev7
        ? {
            spend: round2(prev7.spend),
            purchases: round2(prev7.purchases),
            purchase_value: round2(prev7.purchase_value),
            roas: round2(prev7.roas),
            cpa: round2(prev7.cpa),
          }
        : null,
      last_30_days: last30
        ? {
            spend: round2(last30.spend),
            purchases: round2(last30.purchases),
            purchase_value: round2(last30.purchase_value),
            roas: round2(last30.roas),
            cpa: round2(last30.cpa),
          }
        : null,
      prev_30_days: prev30
        ? {
            spend: round2(prev30.spend),
            purchases: round2(prev30.purchases),
            purchase_value: round2(prev30.purchase_value),
            roas: round2(prev30.roas),
            cpa: round2(prev30.cpa),
          }
        : null,
    },
    deltas: {
      last7_vs_prev7: deltas?.last7_vs_prev7
        ? {
            spend_pct: round2(deltas.last7_vs_prev7.spend_pct),
            purchases_pct: round2(deltas.last7_vs_prev7.purchases_pct),
            purchase_value_pct: round2(deltas.last7_vs_prev7.purchase_value_pct),
            roas_diff: round2(deltas.last7_vs_prev7.roas_diff),
            cpa_diff: round2(deltas.last7_vs_prev7.cpa_diff),
          }
        : null,
      last30_vs_prev30: deltas?.last30_vs_prev30
        ? {
            spend_pct: round2(deltas.last30_vs_prev30.spend_pct),
            purchases_pct: round2(deltas.last30_vs_prev30.purchases_pct),
            purchase_value_pct: round2(deltas.last30_vs_prev30.purchase_value_pct),
            roas_diff: round2(deltas.last30_vs_prev30.roas_diff),
            cpa_diff: round2(deltas.last30_vs_prev30.cpa_diff),
          }
        : null,
    },
  };
}

function compactCampaign(c) {
  const k = c?.kpis || {};
  return {
    campaign_id: safeStr(c?.campaign_id) || null,
    name: safeStr(c?.name) || null,
    objective_norm: safeStr(c?.objective_norm) || null,
    status: safeStr(c?.status) || null,
    health: safeStr(c?.health) || null,
    ranking_score: round2(c?.ranking_score),
    tags: compactArray(c?.tags || [], 8),
    kpis: {
      spend: round2(k.spend),
      purchases: round2(k.purchases),
      purchase_value: round2(k.purchase_value),
      roas: round2(k.roas),
      cpa: round2(k.cpa),
      ctr: round2(k.ctr),
      clicks: round2(k.clicks),
      impressions: round2(k.impressions),
    },
  };
}

function buildRankedCampaigns(rankedData, topN = 8) {
  const ranked = compactArray(rankedData?.campaigns_ranked || [], topN);
  return ranked.map(compactCampaign);
}

function compactBreakdownRow(x) {
  return {
    key: safeStr(x?.key) || null,
    spend: round2(x?.spend),
    purchases: round2(x?.purchases),
    purchase_value: round2(x?.purchase_value),
    roas: round2(x?.roas),
    cpa: round2(x?.cpa),
    ctr: round2(x?.ctr),
    clicks: round2(x?.clicks),
    impressions: round2(x?.impressions),
  };
}

function buildBreakdowns(breakdownsData, topN = 5) {
  return {
    device_top: compactArray(breakdownsData?.device_top || [], topN).map(compactBreakdownRow),
    placement_top: compactArray(breakdownsData?.placement_top || [], topN).map(compactBreakdownRow),
  };
}

function buildSignals(signalsData) {
  const s = signalsData?.optimization_signals || {};
  return {
    winners: compactArray(s?.winners || [], 4).map(compactCampaign),
    risks: compactArray(s?.risks || [], 4).map(compactCampaign),
    quick_wins: compactArray(s?.quick_wins || [], 4).map(compactCampaign),
    insights: compactArray(s?.insights || [], 6).map((x) => safeStr(x)).filter(Boolean),
    recommendations: compactArray(s?.recommendations || [], 5).map((x) => safeStr(x)).filter(Boolean),
  };
}

function summarizeTrend(values) {
  if (!Array.isArray(values) || values.length < 2) return 'flat';
  const first = toNum(values[0]);
  const last = toNum(values[values.length - 1]);
  const diff = last - first;
  if (Math.abs(diff) < 0.0001) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

function buildDailyTrends(dailyData, topCampaignRows = 20) {
  const totalsByDay = Array.isArray(dailyData?.totals_by_day) ? dailyData.totals_by_day : [];
  const campaignsDaily = Array.isArray(dailyData?.campaigns_daily) ? dailyData.campaigns_daily : [];

  const recentTotals = compactArray(totalsByDay, 10).map((d) => ({
    date: safeStr(d?.date) || null,
    spend: round2(d?.kpis?.spend),
    purchases: round2(d?.kpis?.purchases),
    purchase_value: round2(d?.kpis?.purchase_value),
    roas: round2(d?.kpis?.roas),
    cpa: round2(d?.kpis?.cpa),
  }));

  const grouped = new Map();
  for (const row of campaignsDaily) {
    const id = safeStr(row?.campaign_id);
    if (!id) continue;
    const key = `${id}__${safeStr(row?.campaign_name)}`;
    const arr = grouped.get(key) || [];
    arr.push(row);
    grouped.set(key, arr);
  }

  const topCampaignTrendBlocks = [];
  for (const [key, rows] of grouped.entries()) {
    const [campaignId, campaignName] = key.split('__');
    const sorted = rows
      .slice()
      .sort((a, b) => safeStr(a?.date).localeCompare(safeStr(b?.date)));

    const spendSeries = sorted.map((r) => toNum(r?.kpis?.spend));
    const purchaseValueSeries = sorted.map((r) => toNum(r?.kpis?.purchase_value));
    const purchasesSeries = sorted.map((r) => toNum(r?.kpis?.purchases));

    const totalSpend = spendSeries.reduce((a, b) => a + b, 0);
    const totalPurchaseValue = purchaseValueSeries.reduce((a, b) => a + b, 0);
    const totalPurchases = purchasesSeries.reduce((a, b) => a + b, 0);

    topCampaignTrendBlocks.push({
      campaign_id: campaignId || null,
      campaign_name: campaignName || null,
      total_spend: round2(totalSpend),
      total_purchase_value: round2(totalPurchaseValue),
      total_purchases: round2(totalPurchases),
      roas: totalSpend > 0 ? round2(totalPurchaseValue / totalSpend) : 0,
      spend_trend: summarizeTrend(spendSeries),
      revenue_trend: summarizeTrend(purchaseValueSeries),
      recent_days: compactArray(
        sorted.map((r) => ({
          date: safeStr(r?.date) || null,
          spend: round2(r?.kpis?.spend),
          purchases: round2(r?.kpis?.purchases),
          purchase_value: round2(r?.kpis?.purchase_value),
        })),
        7
      ),
    });
  }

  topCampaignTrendBlocks.sort((a, b) => toNum(b.total_spend) - toNum(a.total_spend));

  return {
    totals_by_day: recentTotals,
    campaign_trends: compactArray(topCampaignTrendBlocks, Math.max(1, topCampaignRows)),
  };
}

function buildLlmPromptHints(payload) {
  const hints = [];

  const spend = toNum(payload?.executive_summary?.headline_kpis?.spend);
  const roas = toNum(payload?.executive_summary?.headline_kpis?.roas);
  const purchases = toNum(payload?.executive_summary?.headline_kpis?.purchases);

  if (spend > 0) {
    hints.push('Focus on budget efficiency, ROAS, CPA, and conversion-driving campaigns.');
  }
  if (purchases > 0) {
    hints.push('Prioritize identifying scalable winners and underperforming spend pockets.');
  }
  if (roas > 0 && roas < 1) {
    hints.push('Overall ROAS is below break-even; emphasize loss reduction and budget reallocation.');
  }
  if (roas >= 2) {
    hints.push('There are signs of profitable performance; emphasize scaling opportunities carefully.');
  }

  if ((payload?.signals?.risks || []).length > 0) {
    hints.push('Review risk campaigns first because they are consuming budget inefficiently.');
  }
  if ((payload?.signals?.quick_wins || []).length > 0) {
    hints.push('Quick wins may be the fastest path to improve efficiency without large creative changes.');
  }

  return compactArray(hints, 6);
}

/**
 * Formatea datasets MCP de Meta a una vista AI-ready compacta
 *
 * @param {Object} params
 * @param {Array} params.datasets - lista de documentos chunk o lista de payloads dataset
 * @param {number} [params.topCampaigns=8]
 * @param {number} [params.topBreakdowns=5]
 * @param {number} [params.topTrendCampaigns=5]
 * @returns {Object}
 */
function formatMetaForLlm({
  datasets = [],
  topCampaigns = 8,
  topBreakdowns = 5,
  topTrendCampaigns = 5,
} = {}) {
  const dsMap = indexDatasets(datasets);

  const summaryData = getData(dsMap, 'meta.insights_summary');
  const rankedData = getData(dsMap, 'meta.campaigns_ranked');
  const breakdownsData = getData(dsMap, 'meta.breakdowns_top');
  const signalsData = getData(dsMap, 'meta.optimization_signals');
  const dailyData = getData(dsMap, 'meta.daily_trends_ai');

  const meta = getMetaHeader(dsMap);

  const payload = {
    meta: {
      schema: 'adray.meta.llm.v1',
      source: 'metaAds',
      generatedAt: new Date().toISOString(),
      accountIds: Array.isArray(meta?.accountIds) ? meta.accountIds : [],
      accounts: compactArray(meta?.accounts || [], 3).map((a) => ({
        id: safeStr(a?.id) || null,
        name: safeStr(a?.name) || null,
        currency: safeStr(a?.currency) || null,
        timezone_name: safeStr(a?.timezone_name) || null,
      })),
      range: isObj(meta?.range) ? meta.range : null,
      currency: safeStr(meta?.currency) || null,
      collectorVersion: safeStr(meta?.version) || null,
    },
    executive_summary: buildExecutiveSummary(summaryData),
    ranked_campaigns: buildRankedCampaigns(rankedData, topCampaigns),
    breakdowns: buildBreakdowns(breakdownsData, topBreakdowns),
    signals: buildSignals(signalsData),
    daily_trends: buildDailyTrends(dailyData, topTrendCampaigns),
  };

  payload.llm_hints = buildLlmPromptHints(payload);

  return payload;
}

/**
 * Devuelve un resumen ultra corto todavía más compacto
 * útil para prompts muy pequeños
 */
function formatMetaForLlmMini({
  datasets = [],
  topCampaigns = 5,
} = {}) {
  const full = formatMetaForLlm({
    datasets,
    topCampaigns,
    topBreakdowns: 3,
    topTrendCampaigns: 3,
  });

  return {
    meta: full.meta,
    headline_kpis: full.executive_summary?.headline_kpis || {},
    last7_vs_prev7: full.executive_summary?.deltas?.last7_vs_prev7 || null,
    top_campaigns: compactArray(full.ranked_campaigns || [], topCampaigns),
    winners: compactArray(full.signals?.winners || [], 3),
    risks: compactArray(full.signals?.risks || [], 3),
    top_devices: compactArray(full.breakdowns?.device_top || [], 3),
    top_placements: compactArray(full.breakdowns?.placement_top || [], 3),
    llm_hints: compactArray(full.llm_hints || [], 4),
  };
}

module.exports = {
  formatMetaForLlm,
  formatMetaForLlmMini,
};