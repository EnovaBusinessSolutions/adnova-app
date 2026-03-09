'use strict';

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

function getGoogleHeader(dsMap) {
  return (
    getData(dsMap, 'google.insights_summary')?.meta ||
    getData(dsMap, 'google.campaigns_ranked')?.meta ||
    getData(dsMap, 'google.breakdowns_top')?.meta ||
    getData(dsMap, 'google.optimization_signals')?.meta ||
    getData(dsMap, 'google.daily_trends_ai')?.meta ||
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
      conversions: round2(kpis.conversions),
      conversion_value: round2(kpis.conversion_value),
      roas: round2(kpis.roas),
      cpa: round2(kpis.cpa),
      cpc: round2(kpis.cpc),
      ctr: round2(kpis.ctr),
    },
    comparison_windows: {
      last_7_days: last7
        ? {
            spend: round2(last7.spend),
            conversions: round2(last7.conversions),
            conversion_value: round2(last7.conversion_value),
            roas: round2(last7.roas),
            cpa: round2(last7.cpa),
          }
        : null,
      prev_7_days: prev7
        ? {
            spend: round2(prev7.spend),
            conversions: round2(prev7.conversions),
            conversion_value: round2(prev7.conversion_value),
            roas: round2(prev7.roas),
            cpa: round2(prev7.cpa),
          }
        : null,
      last_30_days: last30
        ? {
            spend: round2(last30.spend),
            conversions: round2(last30.conversions),
            conversion_value: round2(last30.conversion_value),
            roas: round2(last30.roas),
            cpa: round2(last30.cpa),
          }
        : null,
      prev_30_days: prev30
        ? {
            spend: round2(prev30.spend),
            conversions: round2(prev30.conversions),
            conversion_value: round2(prev30.conversion_value),
            roas: round2(prev30.roas),
            cpa: round2(prev30.cpa),
          }
        : null,
    },
    deltas: {
      last7_vs_prev7: deltas?.last7_vs_prev7
        ? {
            spend_pct: round2(deltas.last7_vs_prev7.spend_pct),
            conversions_pct: round2(deltas.last7_vs_prev7.conversions_pct),
            conversion_value_pct: round2(deltas.last7_vs_prev7.conversion_value_pct),
            roas_diff: round2(deltas.last7_vs_prev7.roas_diff),
            cpa_diff: round2(deltas.last7_vs_prev7.cpa_diff),
          }
        : null,
      last30_vs_prev30: deltas?.last30_vs_prev30
        ? {
            spend_pct: round2(deltas.last30_vs_prev30.spend_pct),
            conversions_pct: round2(deltas.last30_vs_prev30.conversions_pct),
            conversion_value_pct: round2(deltas.last30_vs_prev30.conversion_value_pct),
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
      conversions: round2(k.conversions),
      conversion_value: round2(k.conversion_value),
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
    conversions: round2(x?.conversions),
    conversion_value: round2(x?.conversion_value),
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
    network_top: compactArray(breakdownsData?.network_top || [], topN).map(compactBreakdownRow),
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

function buildDailyTrends(dailyData, topCampaignRows = 5) {
  const totalsByDay = Array.isArray(dailyData?.totals_by_day) ? dailyData.totals_by_day : [];
  const campaignsDaily = Array.isArray(dailyData?.campaigns_daily) ? dailyData.campaigns_daily : [];

  const recentTotals = compactArray(totalsByDay, 14).map((d) => ({
    date: safeStr(d?.date) || null,
    spend: round2(d?.kpis?.spend),
    conversions: round2(d?.kpis?.conversions),
    conversion_value: round2(d?.kpis?.conversion_value),
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
    const convValueSeries = sorted.map((r) => toNum(r?.kpis?.conversion_value));
    const convSeries = sorted.map((r) => toNum(r?.kpis?.conversions));

    const totalSpend = spendSeries.reduce((a, b) => a + b, 0);
    const totalConvValue = convValueSeries.reduce((a, b) => a + b, 0);
    const totalConv = convSeries.reduce((a, b) => a + b, 0);

    topCampaignTrendBlocks.push({
      campaign_id: campaignId || null,
      campaign_name: campaignName || null,
      total_spend: round2(totalSpend),
      total_conversion_value: round2(totalConvValue),
      total_conversions: round2(totalConv),
      roas: totalSpend > 0 ? round2(totalConvValue / totalSpend) : 0,
      spend_trend: summarizeTrend(spendSeries),
      conversion_value_trend: summarizeTrend(convValueSeries),
      recent_days: compactArray(
        sorted.map((r) => ({
          date: safeStr(r?.date) || null,
          spend: round2(r?.kpis?.spend),
          conversions: round2(r?.kpis?.conversions),
          conversion_value: round2(r?.kpis?.conversion_value),
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

function buildDataQuality(payload) {
  const accountCount = Array.isArray(payload?.meta?.accounts) ? payload.meta.accounts.length : 0;
  const hasExecutive = !!payload?.executive_summary?.headline_kpis;
  const hasCampaigns = Array.isArray(payload?.ranked_campaigns) && payload.ranked_campaigns.length > 0;
  const hasBreakdowns =
    (Array.isArray(payload?.breakdowns?.device_top) && payload.breakdowns.device_top.length > 0) ||
    (Array.isArray(payload?.breakdowns?.network_top) && payload.breakdowns.network_top.length > 0);
  const hasSignals =
    (Array.isArray(payload?.signals?.winners) && payload.signals.winners.length > 0) ||
    (Array.isArray(payload?.signals?.risks) && payload.signals.risks.length > 0) ||
    (Array.isArray(payload?.signals?.quick_wins) && payload.signals.quick_wins.length > 0);
  const hasDaily =
    Array.isArray(payload?.daily_trends?.totals_by_day) && payload.daily_trends.totals_by_day.length > 0;

  return {
    hasAnyData: !!(hasExecutive || hasCampaigns || hasBreakdowns || hasSignals || hasDaily),
    accountCount,
    range: payload?.meta?.range || null,
    datasetsPresent: {
      executive_summary: hasExecutive,
      ranked_campaigns: hasCampaigns,
      breakdowns: hasBreakdowns,
      signals: hasSignals,
      daily_trends: hasDaily,
    },
  };
}

function buildPrioritySummary(payload) {
  const positives = [];
  const negatives = [];
  const actions = [];

  const headline = payload?.executive_summary?.headline_kpis || {};
  const winners = payload?.signals?.winners || [];
  const risks = payload?.signals?.risks || [];
  const quickWins = payload?.signals?.quick_wins || [];
  const delta7 = payload?.executive_summary?.deltas?.last7_vs_prev7 || null;

  const conversions = toNum(headline.conversions);
  const roas = toNum(headline.roas);
  const cpa = toNum(headline.cpa);

  if (conversions > 0) {
    positives.push(`The account is generating conversions from paid traffic (${round2(conversions)} total conversions).`);
  }
  if (roas >= 2) {
    positives.push(`Overall Google Ads ROAS looks profitable at ${round2(roas)}.`);
  }
  if (winners.length > 0) {
    positives.push(`There are ${winners.length} winner campaigns with strong scaling potential.`);
  }

  if (roas > 0 && roas < 1) {
    negatives.push('Overall Google Ads ROAS is below break-even.');
  }
  if (risks.length > 0) {
    negatives.push(`There are ${risks.length} risk campaigns consuming spend with weak return signals.`);
  }
  if (delta7 && toNum(delta7.conversions_pct) < 0) {
    negatives.push('Conversions declined in the last 7 days versus the previous 7-day window.');
  }

  if (risks.length > 0) {
    actions.push('Review the top risk campaigns first for the fastest efficiency gains.');
  }
  if (quickWins.length > 0) {
    actions.push('Shift incremental budget toward quick-win campaigns with stronger CTR or efficient CPA.');
  }
  if (cpa > 0) {
    actions.push(`Use current CPA (${round2(cpa)}) as the operating benchmark when deciding which campaigns to keep or cut.`);
  }

  return {
    positives: compactArray(positives, 4),
    negatives: compactArray(negatives, 4),
    actions: compactArray(actions, 4),
  };
}

function buildLlmPromptHints(payload) {
  const hints = [];

  const spend = toNum(payload?.executive_summary?.headline_kpis?.spend);
  const roas = toNum(payload?.executive_summary?.headline_kpis?.roas);
  const conversions = toNum(payload?.executive_summary?.headline_kpis?.conversions);

  if (spend > 0) {
    hints.push('Focus on spend efficiency, ROAS, CPA, CTR, and conversion-driving campaigns.');
  }
  if (conversions > 0) {
    hints.push('Prioritize identifying scalable winners and wasteful spend pockets.');
  }
  if (roas > 0 && roas < 1) {
    hints.push('Overall Google Ads ROAS is below break-even; emphasize loss reduction and budget reallocation.');
  }
  if (roas >= 2) {
    hints.push('There are signs of profitable performance; emphasize careful scaling opportunities.');
  }
  if ((payload?.signals?.risks || []).length > 0) {
    hints.push('Review risk campaigns first because they are likely dragging efficiency.');
  }
  if ((payload?.signals?.quick_wins || []).length > 0) {
    hints.push('Quick wins may improve results without requiring a full account rebuild.');
  }

  return compactArray(hints, 6);
}

function formatGoogleAdsForLlm({
  datasets = [],
  topCampaigns = 8,
  topBreakdowns = 5,
  topTrendCampaigns = 5,
} = {}) {
  const dsMap = indexDatasets(datasets);

  const summaryData = getData(dsMap, 'google.insights_summary');
  const rankedData = getData(dsMap, 'google.campaigns_ranked');
  const breakdownsData = getData(dsMap, 'google.breakdowns_top');
  const signalsData = getData(dsMap, 'google.optimization_signals');
  const dailyData = getData(dsMap, 'google.daily_trends_ai');

  const meta = getGoogleHeader(dsMap);

  const payload = {
    meta: {
      schema: 'adray.google_ads.llm.v1',
      source: 'googleAds',
      generatedAt: new Date().toISOString(),
      accountIds: Array.isArray(meta?.accountIds) ? meta.accountIds : [],
      accountCount: Array.isArray(meta?.accounts) ? meta.accounts.length : 0,
      accounts: compactArray(meta?.accounts || [], 3).map((a) => ({
        id: safeStr(a?.id) || null,
        name: safeStr(a?.name) || null,
        currency: safeStr(a?.currency) || null,
        timezone_name: safeStr(a?.timezone_name) || null,
      })),
      range: isObj(meta?.range) ? meta.range : null,
      currency: safeStr(meta?.currency) || null,
      latestSnapshotId: safeStr(meta?.latestSnapshotId) || null,
      collectorVersion: safeStr(meta?.version) || null,
    },
    executive_summary: buildExecutiveSummary(summaryData),
    ranked_campaigns: buildRankedCampaigns(rankedData, topCampaigns),
    breakdowns: buildBreakdowns(breakdownsData, topBreakdowns),
    signals: buildSignals(signalsData),
    daily_trends: buildDailyTrends(dailyData, topTrendCampaigns),
  };

  payload.priority_summary = buildPrioritySummary(payload);
  payload.data_quality = buildDataQuality(payload);
  payload.llm_hints = buildLlmPromptHints(payload);

  return payload;
}

function formatGoogleAdsForLlmMini({
  datasets = [],
  topCampaigns = 5,
} = {}) {
  const full = formatGoogleAdsForLlm({
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
    top_networks: compactArray(full.breakdowns?.network_top || [], 3),
    priority_summary: full.priority_summary || { positives: [], negatives: [], actions: [] },
    llm_hints: compactArray(full.llm_hints || [], 4),
  };
}

module.exports = {
  formatGoogleAdsForLlm,
  formatGoogleAdsForLlmMini,
};