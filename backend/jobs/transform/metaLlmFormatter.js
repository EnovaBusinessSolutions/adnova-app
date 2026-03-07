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

function nonEmptyStr(v) {
  const s = safeStr(v).trim();
  return s || '';
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

function uniqStrings(arr, max = 20) {
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(arr) ? arr : []) {
    const s = nonEmptyStr(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }

  return out;
}

function safeDateStr(v) {
  const s = nonEmptyStr(v);
  return s || null;
}

function safePct(v) {
  return round2(v);
}

function indexDatasets(datasets) {
  const map = new Map();

  for (const ds of Array.isArray(datasets) ? datasets : []) {
    const key = nonEmptyStr(ds?.dataset);
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

function normalizeRange(range) {
  if (!isObj(range)) return null;

  return {
    since: safeDateStr(range?.since),
    until: safeDateStr(range?.until),
    days: toNum(range?.days),
  };
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
            spend_pct: safePct(deltas.last7_vs_prev7.spend_pct),
            purchases_pct: safePct(deltas.last7_vs_prev7.purchases_pct),
            purchase_value_pct: safePct(deltas.last7_vs_prev7.purchase_value_pct),
            roas_diff: round2(deltas.last7_vs_prev7.roas_diff),
            cpa_diff: round2(deltas.last7_vs_prev7.cpa_diff),
          }
        : null,
      last30_vs_prev30: deltas?.last30_vs_prev30
        ? {
            spend_pct: safePct(deltas.last30_vs_prev30.spend_pct),
            purchases_pct: safePct(deltas.last30_vs_prev30.purchases_pct),
            purchase_value_pct: safePct(deltas.last30_vs_prev30.purchase_value_pct),
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
    campaign_id: nonEmptyStr(c?.campaign_id) || null,
    name: nonEmptyStr(c?.name) || null,
    objective_norm: nonEmptyStr(c?.objective_norm) || null,
    status: nonEmptyStr(c?.status) || null,
    health: nonEmptyStr(c?.health) || null,
    ranking_score: round2(c?.ranking_score),
    tags: uniqStrings(c?.tags || [], 8),
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
  return ranked
    .map(compactCampaign)
    .filter((c) => c.campaign_id || c.name);
}

function compactBreakdownRow(x) {
  return {
    key: nonEmptyStr(x?.key) || null,
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
    device_top: compactArray(breakdownsData?.device_top || [], topN)
      .map(compactBreakdownRow)
      .filter((x) => x.key),
    placement_top: compactArray(breakdownsData?.placement_top || [], topN)
      .map(compactBreakdownRow)
      .filter((x) => x.key),
  };
}

function buildSignals(signalsData) {
  const s = signalsData?.optimization_signals || {};

  return {
    winners: compactArray(s?.winners || [], 4)
      .map(compactCampaign)
      .filter((c) => c.campaign_id || c.name),
    risks: compactArray(s?.risks || [], 4)
      .map(compactCampaign)
      .filter((c) => c.campaign_id || c.name),
    quick_wins: compactArray(s?.quick_wins || [], 4)
      .map(compactCampaign)
      .filter((c) => c.campaign_id || c.name),
    insights: uniqStrings(s?.insights || [], 6),
    recommendations: uniqStrings(s?.recommendations || [], 5),
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

function sortRowsByDateAsc(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => safeStr(a?.date).localeCompare(safeStr(b?.date)));
}

function buildDailyTrends(dailyData, topCampaignRows = 5) {
  const totalsByDay = sortRowsByDateAsc(dailyData?.totals_by_day || []);
  const campaignsDaily = Array.isArray(dailyData?.campaigns_daily) ? dailyData.campaigns_daily : [];

  const recentTotals = totalsByDay.slice(-10).map((d) => ({
    date: safeDateStr(d?.date),
    spend: round2(d?.kpis?.spend),
    purchases: round2(d?.kpis?.purchases),
    purchase_value: round2(d?.kpis?.purchase_value),
    roas: round2(d?.kpis?.roas),
    cpa: round2(d?.kpis?.cpa),
  }));

  const grouped = new Map();

  for (const row of campaignsDaily) {
    const campaignId = nonEmptyStr(row?.campaign_id);
    const campaignName = nonEmptyStr(row?.campaign_name);

    if (!campaignId && !campaignName) continue;

    const groupKey = campaignId || `name:${campaignName}`;
    const existing = grouped.get(groupKey) || {
      campaign_id: campaignId || null,
      campaign_name: campaignName || null,
      rows: [],
    };

    existing.rows.push(row);

    if (!existing.campaign_name && campaignName) {
      existing.campaign_name = campaignName;
    }
    if (!existing.campaign_id && campaignId) {
      existing.campaign_id = campaignId;
    }

    grouped.set(groupKey, existing);
  }

  const topCampaignTrendBlocks = [];

  for (const group of grouped.values()) {
    const sorted = sortRowsByDateAsc(group.rows);

    const spendSeries = sorted.map((r) => toNum(r?.kpis?.spend));
    const purchaseValueSeries = sorted.map((r) => toNum(r?.kpis?.purchase_value));
    const purchasesSeries = sorted.map((r) => toNum(r?.kpis?.purchases));

    const totalSpend = spendSeries.reduce((a, b) => a + b, 0);
    const totalPurchaseValue = purchaseValueSeries.reduce((a, b) => a + b, 0);
    const totalPurchases = purchasesSeries.reduce((a, b) => a + b, 0);

    topCampaignTrendBlocks.push({
      campaign_id: group.campaign_id || null,
      campaign_name: group.campaign_name || null,
      total_spend: round2(totalSpend),
      total_purchase_value: round2(totalPurchaseValue),
      total_purchases: round2(totalPurchases),
      roas: totalSpend > 0 ? round2(totalPurchaseValue / totalSpend) : 0,
      spend_trend: summarizeTrend(spendSeries),
      revenue_trend: summarizeTrend(purchaseValueSeries),
      recent_days: sorted.slice(-7).map((r) => ({
        date: safeDateStr(r?.date),
        spend: round2(r?.kpis?.spend),
        purchases: round2(r?.kpis?.purchases),
        purchase_value: round2(r?.kpis?.purchase_value),
      })),
    });
  }

  topCampaignTrendBlocks.sort((a, b) => toNum(b.total_spend) - toNum(a.total_spend));

  return {
    totals_by_day: recentTotals,
    campaign_trends: compactArray(topCampaignTrendBlocks, Math.max(1, topCampaignRows)),
  };
}

function buildPrioritySummary(payload) {
  const out = {
    positives: [],
    negatives: [],
    actions: [],
  };

  const kpis = payload?.executive_summary?.headline_kpis || {};
  const last7 = payload?.executive_summary?.deltas?.last7_vs_prev7 || null;

  const roas = toNum(kpis?.roas);
  const cpa = toNum(kpis?.cpa);
  const spend = toNum(kpis?.spend);
  const purchases = toNum(kpis?.purchases);

  const winnersCount = Array.isArray(payload?.signals?.winners) ? payload.signals.winners.length : 0;
  const risksCount = Array.isArray(payload?.signals?.risks) ? payload.signals.risks.length : 0;
  const quickWinsCount = Array.isArray(payload?.signals?.quick_wins) ? payload.signals.quick_wins.length : 0;

  if (spend > 0 && purchases > 0) {
    out.positives.push(`The account is generating purchases from paid traffic (${round2(purchases)} total purchases).`);
  }

  if (roas >= 2) {
    out.positives.push(`Overall ROAS looks healthy at ${round2(roas)}.`);
  } else if (roas > 0 && roas < 1) {
    out.negatives.push(`Overall ROAS is below 1 (${round2(roas)}), suggesting unprofitable spend.`);
  }

  if (winnersCount > 0) {
    out.positives.push(`There are ${winnersCount} winner campaigns that may support scaling.`);
  }

  if (risksCount > 0) {
    out.negatives.push(`There are ${risksCount} risk campaigns consuming budget inefficiently.`);
  }

  if (last7) {
    const purchasesPct = toNum(last7?.purchases_pct);
    const purchaseValuePct = toNum(last7?.purchase_value_pct);
    const spendPct = toNum(last7?.spend_pct);
    const roasDiff = toNum(last7?.roas_diff);

    if (purchasesPct > 15 || purchaseValuePct > 15) {
      out.positives.push('Recent 7-day conversion performance improved versus the previous 7-day window.');
    }

    if (spendPct > 20 && roasDiff < 0) {
      out.negatives.push('Spend increased recently while ROAS deteriorated, which may indicate waste.');
    }
  }

  if (quickWinsCount > 0) {
    out.actions.push(`Review the ${quickWinsCount} quick-win campaigns first for the fastest efficiency gains.`);
  }

  if (risksCount > 0) {
    out.actions.push('Audit risk campaigns for budget cuts, creative fatigue, audience mismatch, or poor offer alignment.');
  }

  if (roas > 0 && roas < 1) {
    out.actions.push('Prioritize loss reduction before scaling spend.');
  } else if (roas >= 2) {
    out.actions.push('Consider careful scaling on winners while protecting efficiency.');
  }

  if (cpa > 0) {
    out.actions.push(`Use current CPA (${round2(cpa)}) as a benchmark when deciding which campaigns to keep or cut.`);
  }

  return {
    positives: uniqStrings(out.positives, 4),
    negatives: uniqStrings(out.negatives, 4),
    actions: uniqStrings(out.actions, 5),
  };
}

function buildDataQuality(meta, payload) {
  const accounts = Array.isArray(meta?.accounts) ? meta.accounts : [];
  const range = normalizeRange(meta?.range);

  const rankedCount = Array.isArray(payload?.ranked_campaigns) ? payload.ranked_campaigns.length : 0;
  const dailyCount = Array.isArray(payload?.daily_trends?.totals_by_day) ? payload.daily_trends.totals_by_day.length : 0;
  const winnersCount = Array.isArray(payload?.signals?.winners) ? payload.signals.winners.length : 0;
  const risksCount = Array.isArray(payload?.signals?.risks) ? payload.signals.risks.length : 0;

  return {
    hasAnyData:
      rankedCount > 0 ||
      dailyCount > 0 ||
      winnersCount > 0 ||
      risksCount > 0 ||
      toNum(payload?.executive_summary?.headline_kpis?.spend) > 0,
    accountCount: accounts.length,
    range,
    datasetsPresent: {
      executive_summary: !!payload?.executive_summary,
      ranked_campaigns: rankedCount > 0,
      breakdowns:
        (payload?.breakdowns?.device_top || []).length > 0 ||
        (payload?.breakdowns?.placement_top || []).length > 0,
      signals:
        winnersCount > 0 ||
        risksCount > 0 ||
        (payload?.signals?.quick_wins || []).length > 0 ||
        (payload?.signals?.insights || []).length > 0,
      daily_trends: dailyCount > 0,
    },
  };
}

function buildLlmPromptHints(payload) {
  const hints = [];

  const spend = toNum(payload?.executive_summary?.headline_kpis?.spend);
  const roas = toNum(payload?.executive_summary?.headline_kpis?.roas);
  const purchases = toNum(payload?.executive_summary?.headline_kpis?.purchases);
  const last7 = payload?.executive_summary?.deltas?.last7_vs_prev7 || null;

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

  if (last7) {
    const spendPct = toNum(last7?.spend_pct);
    const purchaseValuePct = toNum(last7?.purchase_value_pct);
    const roasDiff = toNum(last7?.roas_diff);

    if (spendPct > 20 && roasDiff < 0) {
      hints.push('Recent scaling may have hurt efficiency; validate whether increased spend is actually producing profitable revenue.');
    }

    if (purchaseValuePct > 15 && roasDiff >= 0) {
      hints.push('Recent momentum is positive; identify whether winning campaigns can be scaled safely.');
    }
  }

  return uniqStrings(hints, 6);
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
  const range = normalizeRange(meta?.range);

  const payload = {
    meta: {
      schema: 'adray.meta.llm.v2',
      source: 'metaAds',
      generatedAt: new Date().toISOString(),
      accountIds: Array.isArray(meta?.accountIds) ? meta.accountIds : [],
      accountCount: Array.isArray(meta?.accounts) ? meta.accounts.length : 0,
      accounts: compactArray(meta?.accounts || [], 3).map((a) => ({
        id: nonEmptyStr(a?.id) || null,
        name: nonEmptyStr(a?.name) || null,
        currency: nonEmptyStr(a?.currency) || null,
        timezone_name: nonEmptyStr(a?.timezone_name) || null,
      })),
      range,
      rangeDays: toNum(meta?.rangeDays || range?.days),
      currency: nonEmptyStr(meta?.currency) || null,
      latestSnapshotId: nonEmptyStr(meta?.latestSnapshotId) || null,
      collectorVersion: nonEmptyStr(meta?.version) || null,
    },
    executive_summary: buildExecutiveSummary(summaryData),
    ranked_campaigns: buildRankedCampaigns(rankedData, topCampaigns),
    breakdowns: buildBreakdowns(breakdownsData, topBreakdowns),
    signals: buildSignals(signalsData),
    daily_trends: buildDailyTrends(dailyData, topTrendCampaigns),
  };

  payload.priority_summary = buildPrioritySummary(payload);
  payload.data_quality = buildDataQuality(meta, payload);
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
    data_quality: full.data_quality,
    headline_kpis: full.executive_summary?.headline_kpis || {},
    last7_vs_prev7: full.executive_summary?.deltas?.last7_vs_prev7 || null,
    top_campaigns: compactArray(full.ranked_campaigns || [], topCampaigns),
    winners: compactArray(full.signals?.winners || [], 3),
    risks: compactArray(full.signals?.risks || [], 3),
    quick_wins: compactArray(full.signals?.quick_wins || [], 3),
    top_devices: compactArray(full.breakdowns?.device_top || [], 3),
    top_placements: compactArray(full.breakdowns?.placement_top || [], 3),
    priority_summary: full.priority_summary || { positives: [], negatives: [], actions: [] },
    llm_hints: compactArray(full.llm_hints || [], 4),
  };
}

module.exports = {
  formatMetaForLlm,
  formatMetaForLlmMini,
};