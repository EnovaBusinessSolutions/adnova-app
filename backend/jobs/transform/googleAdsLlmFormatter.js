'use strict';

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

function ratio(num, den) {
  const d = toNum(den);
  if (!d) return 0;
  return round2(toNum(num) / d);
}

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function parseYmdToUtcDate(ymd) {
  const s = safeDateStr(ymd);
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

function normalizeRange(range) {
  if (!isObj(range)) return null;

  const from = safeDateStr(range?.from || range?.since);
  const to = safeDateStr(range?.to || range?.until);

  return {
    from,
    to,
    since: from,
    until: to,
    tz: safeDateStr(range?.tz),
    days: toNum(range?.days),
  };
}

function filterRowsByContextRange(rows, contextRangeDays, explicitRange) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  const rangeDays = clampInt(contextRangeDays || 60, 1, 3650);
  const explicitTo = safeDateStr(explicitRange?.to || explicitRange?.until);
  const computedLatest = list
    .map((r) => safeDateStr(r?.date))
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  const endDate = explicitTo || computedLatest;
  if (!endDate) return list.slice();

  const startDate = addDaysYmd(endDate, -(rangeDays - 1));
  if (!startDate) return list.slice();

  return list.filter((r) => {
    const d = safeDateStr(r?.date);
    if (!d) return false;
    return d >= startDate && d <= endDate;
  });
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
      cpm: round2(kpis.cpm),
      conversion_rate: round2(kpis.conversion_rate),
      avg_order_value: round2(kpis.avg_order_value),
      all_conversions: round2(kpis.all_conversions),
      cost_per_all_conversion: round2(kpis.cost_per_all_conversion),
      search_impression_share: round2(kpis.search_impression_share),
      search_top_impression_share: round2(kpis.search_top_impression_share),
      search_absolute_top_impression_share: round2(kpis.search_absolute_top_impression_share),
      budget_lost_impression_share: round2(kpis.budget_lost_impression_share),
      rank_lost_impression_share: round2(kpis.rank_lost_impression_share),
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

function normalizeCampaignIdentity(c) {
  return {
    campaign_id: nonEmptyStr(c?.campaign_id) || null,
    campaign_name: nonEmptyStr(c?.campaign_name || c?.name) || null,
    campaign_type: nonEmptyStr(c?.campaign_type) || null,
    objective: nonEmptyStr(c?.objective) || null,
    objective_norm: nonEmptyStr(c?.objective_norm) || null,
    bidding_strategy: nonEmptyStr(c?.bidding_strategy || c?.bidding_strategy_type) || null,
    optimization_goal: nonEmptyStr(c?.optimization_goal) || null,
    status: nonEmptyStr(c?.status) || null,
    channel_type: nonEmptyStr(c?.channel_type) || null,
    channel_sub_type: nonEmptyStr(c?.channel_sub_type) || null,
    start_date: safeDateStr(c?.start_date),
  };
}

function buildKpisFromRaw(raw) {
  const k = raw?.kpis || raw || {};

  const spend = round2(k.spend);
  const impressions = round2(k.impressions);
  const clicks = round2(k.clicks);
  const conversions = round2(k.conversions);
  const conversion_value = round2(k.conversion_value);
  const all_conversions = round2(k.all_conversions);

  const roas = round2(k.roas || ratio(conversion_value, spend));
  const cpa = round2(k.cpa || ratio(spend, conversions));
  const cpc = round2(k.cpc || ratio(spend, clicks));
  const ctr = round2(k.ctr || ratio(clicks * 100, impressions));
  const cpm = round2(k.cpm || ratio(spend * 1000, impressions));
  const conversion_rate = round2(k.conversion_rate || ratio(conversions * 100, clicks));
  const avg_order_value = round2(k.avg_order_value || ratio(conversion_value, conversions));
  const cost_per_all_conversion = round2(k.cost_per_all_conversion || ratio(spend, all_conversions));

  return {
    spend,
    impressions,
    clicks,
    conversions,
    conversion_value,
    all_conversions,
    roas,
    cpa,
    cpc,
    ctr,
    cpm,
    conversion_rate,
    avg_order_value,
    cost_per_all_conversion,
    search_impression_share: round2(k.search_impression_share),
    search_top_impression_share: round2(k.search_top_impression_share),
    search_absolute_top_impression_share: round2(k.search_absolute_top_impression_share),
    budget_lost_impression_share: round2(k.budget_lost_impression_share),
    rank_lost_impression_share: round2(k.rank_lost_impression_share),
  };
}

function compactCampaign(c) {
  return {
    ...normalizeCampaignIdentity(c),
    health: nonEmptyStr(c?.health) || null,
    ranking_score: round2(c?.ranking_score),
    tags: uniqStrings(c?.tags || [], 8),
    kpis: buildKpisFromRaw(c),
  };
}

function buildRankedCampaigns(rankedData, topN = 8) {
  const ranked = compactArray(rankedData?.campaigns_ranked || [], topN);
  return ranked
    .map(compactCampaign)
    .filter((c) => c.campaign_id || c.campaign_name);
}

function compactBreakdownRow(x) {
  return {
    key: nonEmptyStr(x?.key) || null,
    spend: round2(x?.spend),
    conversions: round2(x?.conversions),
    conversion_value: round2(x?.conversion_value),
    roas: round2(x?.roas),
    cpa: round2(x?.cpa),
    ctr: round2(x?.ctr),
    cpc: round2(x?.cpc),
    cpm: round2(x?.cpm),
    clicks: round2(x?.clicks),
    impressions: round2(x?.impressions),
    conversion_rate: round2(x?.conversion_rate),
  };
}

function buildBreakdowns(breakdownsData, topN = 5) {
  return {
    device_top: compactArray(breakdownsData?.device_top || [], topN)
      .map(compactBreakdownRow)
      .filter((x) => x.key),
    network_top: compactArray(breakdownsData?.network_top || [], topN)
      .map(compactBreakdownRow)
      .filter((x) => x.key),
    match_type_top: compactArray(breakdownsData?.match_type_top || [], topN)
      .map(compactBreakdownRow)
      .filter((x) => x.key),
    country_top: compactArray(breakdownsData?.country_top || [], topN)
      .map(compactBreakdownRow)
      .filter((x) => x.key),
  };
}

function buildSignals(signalsData) {
  const s = signalsData?.optimization_signals || {};
  return {
    winners: compactArray(s?.winners || [], 5)
      .map(compactCampaign)
      .filter((c) => c.campaign_id || c.campaign_name),
    risks: compactArray(s?.risks || [], 5)
      .map(compactCampaign)
      .filter((c) => c.campaign_id || c.campaign_name),
    quick_wins: compactArray(s?.quick_wins || [], 5)
      .map(compactCampaign)
      .filter((c) => c.campaign_id || c.campaign_name),
    insights: uniqStrings(s?.insights || [], 8),
    recommendations: uniqStrings(s?.recommendations || [], 8),
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

function buildDailyTrends(dailyData, topCampaignRows = 5, contextRangeDays = 60) {
  const inferredRange = normalizeRange(dailyData?.meta?.range);
  const rawTotalsByDay = sortRowsByDateAsc(dailyData?.totals_by_day || []);
  const rawCampaignsDaily = Array.isArray(dailyData?.campaigns_daily) ? dailyData.campaigns_daily : [];

  const totalsByDay = sortRowsByDateAsc(filterRowsByContextRange(rawTotalsByDay, contextRangeDays, inferredRange));
  const campaignsDaily = sortRowsByDateAsc(filterRowsByContextRange(rawCampaignsDaily, contextRangeDays, inferredRange));

  const recentTotals = totalsByDay.slice(-14).map((d) => ({
    date: safeDateStr(d?.date),
    spend: round2(d?.kpis?.spend),
    conversions: round2(d?.kpis?.conversions),
    conversion_value: round2(d?.kpis?.conversion_value),
    roas: round2(d?.kpis?.roas),
    cpa: round2(d?.kpis?.cpa),
    clicks: round2(d?.kpis?.clicks),
    impressions: round2(d?.kpis?.impressions),
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
      status: nonEmptyStr(row?.status) || null,
      objective_norm: nonEmptyStr(row?.objective_norm) || null,
      channel_type: nonEmptyStr(row?.channel_type) || null,
      rows: [],
    };

    existing.rows.push(row);

    if (!existing.campaign_name && campaignName) existing.campaign_name = campaignName;
    if (!existing.campaign_id && campaignId) existing.campaign_id = campaignId;
    if (!existing.status && row?.status) existing.status = nonEmptyStr(row?.status);
    if (!existing.objective_norm && row?.objective_norm) existing.objective_norm = nonEmptyStr(row?.objective_norm);
    if (!existing.channel_type && row?.channel_type) existing.channel_type = nonEmptyStr(row?.channel_type);

    grouped.set(groupKey, existing);
  }

  const topCampaignTrendBlocks = [];

  for (const group of grouped.values()) {
    const sorted = sortRowsByDateAsc(group.rows);

    const spendSeries = sorted.map((r) => toNum(r?.kpis?.spend));
    const conversionValueSeries = sorted.map((r) => toNum(r?.kpis?.conversion_value));
    const conversionsSeries = sorted.map((r) => toNum(r?.kpis?.conversions));
    const clicksSeries = sorted.map((r) => toNum(r?.kpis?.clicks));

    const totalSpend = spendSeries.reduce((a, b) => a + b, 0);
    const totalConversionValue = conversionValueSeries.reduce((a, b) => a + b, 0);
    const totalConversions = conversionsSeries.reduce((a, b) => a + b, 0);
    const totalClicks = clicksSeries.reduce((a, b) => a + b, 0);

    topCampaignTrendBlocks.push({
      campaign_id: group.campaign_id || null,
      campaign_name: group.campaign_name || null,
      status: group.status || null,
      objective_norm: group.objective_norm || null,
      channel_type: group.channel_type || null,
      total_spend: round2(totalSpend),
      total_conversion_value: round2(totalConversionValue),
      total_conversions: round2(totalConversions),
      total_clicks: round2(totalClicks),
      roas: totalSpend > 0 ? round2(totalConversionValue / totalSpend) : 0,
      cpa: totalConversions > 0 ? round2(totalSpend / totalConversions) : 0,
      conversion_rate: totalClicks > 0 ? round2((totalConversions / totalClicks) * 100) : 0,
      spend_trend: summarizeTrend(spendSeries),
      conversion_value_trend: summarizeTrend(conversionValueSeries),
      conversion_trend: summarizeTrend(conversionsSeries),
      recent_days: sorted.slice(-7).map((r) => ({
        date: safeDateStr(r?.date),
        spend: round2(r?.kpis?.spend),
        conversions: round2(r?.kpis?.conversions),
        conversion_value: round2(r?.kpis?.conversion_value),
        clicks: round2(r?.kpis?.clicks),
      })),
    });
  }

  topCampaignTrendBlocks.sort((a, b) => toNum(b.total_spend) - toNum(a.total_spend));

  return {
    totals_by_day: recentTotals,
    campaign_trends: compactArray(topCampaignTrendBlocks, Math.max(1, topCampaignRows)),
  };
}

function pickCampaignsByStatus(campaigns, status, max = 9999) {
  return compactArray(
    (Array.isArray(campaigns) ? campaigns : []).filter(
      (c) => nonEmptyStr(c?.status).toUpperCase() === String(status).toUpperCase()
    ),
    max
  );
}

function sortCampaignsByMetric(campaigns, metric = 'roas', max = 6, activeOnly = false) {
  let rows = Array.isArray(campaigns) ? campaigns.slice() : [];

  if (activeOnly) {
    rows = rows.filter((c) => {
      const s = nonEmptyStr(c?.status).toUpperCase();
      return s === 'ENABLED' || s === 'ACTIVE';
    });
  }

  rows.sort((a, b) => {
    const av = toNum(a?.kpis?.[metric]);
    const bv = toNum(b?.kpis?.[metric]);
    return bv - av;
  });

  return compactArray(rows, max);
}

function buildCampaignViews(rankedCampaigns, signals) {
  const all = Array.isArray(rankedCampaigns) ? rankedCampaigns : [];
  const winners = Array.isArray(signals?.winners) ? signals.winners : [];
  const risks = Array.isArray(signals?.risks) ? signals.risks : [];

  const active_campaigns_top = sortCampaignsByMetric(all, 'roas', 8, true);

  const active_campaigns_by_conversion_value = (() => {
    const rows = all
      .filter((c) => {
        const s = nonEmptyStr(c?.status).toUpperCase();
        return s === 'ENABLED' || s === 'ACTIVE';
      })
      .slice()
      .sort((a, b) => toNum(b?.kpis?.conversion_value) - toNum(a?.kpis?.conversion_value));
    return compactArray(rows, 8);
  })();

  const paused_winners = winners.filter((c) => {
    const s = nonEmptyStr(c?.status).toUpperCase();
    return s === 'PAUSED';
  }).slice(0, 6);

  const active_risks = risks.filter((c) => {
    const s = nonEmptyStr(c?.status).toUpperCase();
    return s === 'ENABLED' || s === 'ACTIVE';
  }).slice(0, 6);

  const best_active_by_roas = active_campaigns_top[0] || null;
  const best_active_by_conversion_value = active_campaigns_by_conversion_value[0] || null;

  return {
    active_campaigns_top,
    active_campaigns_by_conversion_value,
    paused_winners,
    active_risks,
    best_active_by_roas,
    best_active_by_conversion_value,
    campaign_count: all.length,
    active_count: pickCampaignsByStatus(all, 'ENABLED', 9999).length + pickCampaignsByStatus(all, 'ACTIVE', 9999).length,
    paused_count: pickCampaignsByStatus(all, 'PAUSED', 9999).length,
  };
}

function buildDataQuality(payload, contextRangeDays) {
  const accountCount = Array.isArray(payload?.meta?.accounts) ? payload.meta.accounts.length : 0;
  const hasExecutive = !!payload?.executive_summary?.headline_kpis;
  const hasCampaigns = Array.isArray(payload?.ranked_campaigns) && payload.ranked_campaigns.length > 0;
  const hasBreakdowns =
    (Array.isArray(payload?.breakdowns?.device_top) && payload.breakdowns.device_top.length > 0) ||
    (Array.isArray(payload?.breakdowns?.network_top) && payload.breakdowns.network_top.length > 0) ||
    (Array.isArray(payload?.breakdowns?.match_type_top) && payload.breakdowns.match_type_top.length > 0) ||
    (Array.isArray(payload?.breakdowns?.country_top) && payload.breakdowns.country_top.length > 0);
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
    storageRangeDays: toNum(payload?.meta?.storageRangeDays) || null,
    contextRangeDays: toNum(contextRangeDays) || toNum(payload?.meta?.contextRangeDays) || null,
    windowType: nonEmptyStr(payload?.meta?.windowType) || 'context',
    datasetsPresent: {
      executive_summary: hasExecutive,
      ranked_campaigns: hasCampaigns,
      breakdowns: hasBreakdowns,
      signals: hasSignals,
      daily_trends: hasDaily,
      campaign_views: !!payload?.campaign_views,
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
  const bestActive = payload?.campaign_views?.best_active_by_roas || null;

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
  if (bestActive?.campaign_name) {
    positives.push(
      `The strongest active Google Ads campaign by ROAS appears to be "${bestActive.campaign_name}" with ROAS ${round2(bestActive?.kpis?.roas)}.`
    );
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
  if (bestActive?.campaign_name) {
    actions.push(`Validate whether "${bestActive.campaign_name}" can absorb more spend without degrading ROAS or CPA.`);
  }

  return {
    positives: uniqStrings(positives, 6),
    negatives: uniqStrings(negatives, 6),
    actions: uniqStrings(actions, 8),
  };
}

function buildLlmPromptHints(payload) {
  const hints = [];

  const spend = toNum(payload?.executive_summary?.headline_kpis?.spend);
  const roas = toNum(payload?.executive_summary?.headline_kpis?.roas);
  const conversions = toNum(payload?.executive_summary?.headline_kpis?.conversions);

  const bestActive = payload?.campaign_views?.best_active_by_roas || null;
  const activeRisks = Array.isArray(payload?.campaign_views?.active_risks) ? payload.campaign_views.active_risks : [];
  const topDevices = Array.isArray(payload?.breakdowns?.device_top) ? payload.breakdowns.device_top : [];
  const topNetworks = Array.isArray(payload?.breakdowns?.network_top) ? payload.breakdowns.network_top : [];
  const topMatchTypes = Array.isArray(payload?.breakdowns?.match_type_top) ? payload.breakdowns.match_type_top : [];

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
  if (bestActive?.campaign_name) {
    hints.push(`Use "${bestActive.campaign_name}" as a reference point when identifying the strongest active Google Ads campaign.`);
  }
  if (activeRisks.length > 0) {
    hints.push('Review active risk campaigns first because they are likely dragging current account efficiency.');
  }
  if (topDevices.length > 0) {
    hints.push('Compare device performance to identify which device category is driving the strongest conversion economics.');
  }
  if (topNetworks.length > 0) {
    hints.push('Use network-level performance to determine whether Search, Display, Video, or other inventory is creating waste or profit.');
  }
  if (topMatchTypes.length > 0) {
    hints.push('Match type performance may explain efficiency gaps between query intent and conversion quality.');
  }

  return uniqStrings(hints, 10);
}

function buildKpiDefinitions() {
  return {
    spend_delivery: [
      'spend',
      'impressions',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'search_impression_share',
      'search_top_impression_share',
      'search_absolute_top_impression_share',
      'budget_lost_impression_share',
      'rank_lost_impression_share',
    ],
    revenue_conversion: [
      'conversions',
      'conversion_value',
      'all_conversions',
      'conversion_rate',
      'avg_order_value',
      'cost_per_all_conversion',
    ],
    efficiency: [
      'roas',
      'cpa',
    ],
    structure_segmentation: [
      'platform',
      'campaign_id',
      'campaign_name',
      'campaign_type',
      'objective',
      'objective_norm',
      'bidding_strategy',
      'optimization_goal',
      'status',
      'channel_type',
      'channel_sub_type',
      'device',
      'network',
      'match_type',
      'country',
    ],
  };
}

function formatGoogleAdsForLlm({
  datasets = [],
  contextRangeDays = 60,
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
  const normalizedRange = normalizeRange(meta?.range);
  const effectiveContextRangeDays =
    clampInt(contextRangeDays || meta?.contextRangeDays || normalizedRange?.days || 60, 7, 3650);

  const ranked_campaigns = buildRankedCampaigns(rankedData, Math.max(topCampaigns, 12));
  const breakdowns = buildBreakdowns(breakdownsData, topBreakdowns);
  const signals = buildSignals(signalsData);
  const daily_trends = buildDailyTrends(dailyData, topTrendCampaigns, effectiveContextRangeDays);

  const payload = {
    meta: {
      schema: 'adray.google_ads.llm.v3',
      source: 'googleAds',
      generatedAt: new Date().toISOString(),
      accountIds: Array.isArray(meta?.accountIds) ? meta.accountIds : [],
      accountCount: Array.isArray(meta?.accounts) ? meta.accounts.length : 0,
      accounts: compactArray(meta?.accounts || [], 3).map((a) => ({
        id: nonEmptyStr(a?.id) || null,
        name: nonEmptyStr(a?.name) || null,
        currency: nonEmptyStr(a?.currency) || null,
        timezone_name: nonEmptyStr(a?.timezone_name) || null,
      })),
      range: normalizedRange,
      currency: nonEmptyStr(meta?.currency) || null,
      latestSnapshotId: nonEmptyStr(meta?.latestSnapshotId) || null,
      collectorVersion: nonEmptyStr(meta?.version) || null,
      storageRangeDays: toNum(meta?.storageRangeDays) || null,
      contextRangeDays: effectiveContextRangeDays,
      windowType: nonEmptyStr(meta?.windowType) || 'context',
      platform: 'google_ads',
    },
    context_window: {
      rangeDays: effectiveContextRangeDays,
      storageRangeDays: toNum(meta?.storageRangeDays) || null,
      windowType: nonEmptyStr(meta?.windowType) || 'context',
    },
    executive_summary: buildExecutiveSummary(summaryData),
    kpi_definitions: buildKpiDefinitions(),
    ranked_campaigns,
    campaign_views: buildCampaignViews(ranked_campaigns, signals),
    breakdowns,
    signals,
    daily_trends,
  };

  payload.priority_summary = buildPrioritySummary(payload);
  payload.data_quality = buildDataQuality(payload, effectiveContextRangeDays);
  payload.llm_hints = buildLlmPromptHints(payload);

  return payload;
}

function formatGoogleAdsForLlmMini({
  datasets = [],
  contextRangeDays = 60,
  topCampaigns = 5,
} = {}) {
  const full = formatGoogleAdsForLlm({
    datasets,
    contextRangeDays,
    topCampaigns: Math.max(topCampaigns, 10),
    topBreakdowns: 4,
    topTrendCampaigns: 4,
  });

  return {
    meta: full.meta,
    context_window: full.context_window,
    data_quality: full.data_quality,
    kpi_definitions: full.kpi_definitions,
    headline_kpis: full.executive_summary?.headline_kpis || {},
    last7_vs_prev7: full.executive_summary?.deltas?.last7_vs_prev7 || null,

    top_campaigns: compactArray(full.ranked_campaigns || [], topCampaigns),
    active_campaigns_top: compactArray(full.campaign_views?.active_campaigns_top || [], 5),
    active_campaigns_by_conversion_value: compactArray(full.campaign_views?.active_campaigns_by_conversion_value || [], 5),
    paused_winners: compactArray(full.campaign_views?.paused_winners || [], 4),
    active_risks: compactArray(full.campaign_views?.active_risks || [], 4),
    best_active_by_roas: full.campaign_views?.best_active_by_roas || null,
    best_active_by_conversion_value: full.campaign_views?.best_active_by_conversion_value || null,

    winners: compactArray(full.signals?.winners || [], 4),
    risks: compactArray(full.signals?.risks || [], 4),
    quick_wins: compactArray(full.signals?.quick_wins || [], 4),

    top_devices: compactArray(full.breakdowns?.device_top || [], 4),
    top_networks: compactArray(full.breakdowns?.network_top || [], 4),
    top_match_types: compactArray(full.breakdowns?.match_type_top || [], 4),
    top_countries: compactArray(full.breakdowns?.country_top || [], 4),

    campaign_trends: compactArray(full.daily_trends?.campaign_trends || [], 4),
    priority_summary: full.priority_summary || { positives: [], negatives: [], actions: [] },
    llm_hints: compactArray(full.llm_hints || [], 6),
  };
}

module.exports = {
  formatGoogleAdsForLlm,
  formatGoogleAdsForLlmMini,
};