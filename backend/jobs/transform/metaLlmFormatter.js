'use strict';

/**
 * Meta LLM Formatter
 *
 * Objetivo:
 * - Tomar los chunks MCP de Meta Ads ya compactados
 * - Generar una vista AI-ready más rica y accionable para LLM
 * - Preservar nombres de campañas, KPIs, status, objective y segmentación
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

  const since = safeDateStr(range?.since || range?.from);
  const until = safeDateStr(range?.until || range?.to);
  const days = toNum(range?.days);

  return {
    since,
    until,
    from: since,
    to: until,
    days,
    tz: safeStr(range?.tz || '') || null,
  };
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

function filterRowsByContextRange(rows, contextRangeDays, explicitRange) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  const rangeDays = clampInt(contextRangeDays || 30, 1, 3650);
  const explicitTo = safeDateStr(explicitRange?.until || explicitRange?.to);
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
      reach: round2(kpis.reach),
      frequency: round2(kpis.frequency),
      clicks: round2(kpis.clicks),
      link_clicks: round2(kpis.link_clicks),
      landing_page_views: round2(kpis.landing_page_views),
      purchases: round2(kpis.purchases),
      purchase_value: round2(kpis.purchase_value),
      add_to_cart: round2(kpis.add_to_cart),
      initiate_checkout: round2(kpis.initiate_checkout),
      view_content: round2(kpis.view_content),
      roas: round2(kpis.roas),
      cpa: round2(kpis.cpa),
      cpc: round2(kpis.cpc),
      ctr: round2(kpis.ctr),
      cpm: round2(kpis.cpm),
      conversion_rate: round2(kpis.conversion_rate),
      aov: round2(kpis.aov),
      lpv_rate: round2(kpis.lpv_rate),
      mer: round2(kpis.mer),
      blended_cac: round2(kpis.blended_cac),
      new_customer_cac: round2(kpis.new_customer_cac),
      profit: round2(kpis.profit),
      contribution_margin: round2(kpis.contribution_margin),
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

function normalizeCampaignIdentity(c) {
  return {
    campaign_id: nonEmptyStr(c?.campaign_id) || null,
    campaign_name: nonEmptyStr(c?.campaign_name || c?.name) || null,
    campaign_type: nonEmptyStr(c?.campaign_type) || null,
    objective: nonEmptyStr(c?.objective) || null,
    objective_norm: nonEmptyStr(c?.objective_norm) || null,
    optimization_goal: nonEmptyStr(c?.optimization_goal) || null,
    status: nonEmptyStr(c?.status) || null,
    start_date: safeDateStr(c?.start_date),
  };
}

function buildKpisFromRaw(raw) {
  const k = raw?.kpis || raw || {};
  const spend = round2(k.spend);
  const impressions = round2(k.impressions);
  const reach = round2(k.reach);
  const frequency = round2(k.frequency);
  const clicks = round2(k.clicks);
  const link_clicks = round2(k.link_clicks);
  const landing_page_views = round2(k.landing_page_views);
  const purchases = round2(k.purchases);
  const purchase_value = round2(k.purchase_value);
  const add_to_cart = round2(k.add_to_cart);
  const initiate_checkout = round2(k.initiate_checkout);
  const view_content = round2(k.view_content);

  const roas = round2(k.roas || ratio(purchase_value, spend));
  const cpa = round2(k.cpa || ratio(spend, purchases));
  const cpc = round2(k.cpc || ratio(spend, clicks));
  const ctr = round2(k.ctr || ratio(clicks * 100, impressions));
  const cpm = round2(k.cpm || ratio(spend * 1000, impressions));
  const conversion_rate = round2(k.conversion_rate || ratio(purchases * 100, clicks));
  const aov = round2(k.aov || ratio(purchase_value, purchases));
  const lpv_rate = round2(k.lpv_rate || ratio(landing_page_views * 100, clicks));
  const mer = round2(k.mer);
  const blended_cac = round2(k.blended_cac);
  const new_customer_cac = round2(k.new_customer_cac);
  const profit = round2(k.profit);
  const contribution_margin = round2(k.contribution_margin);

  return {
    spend,
    impressions,
    reach,
    frequency,
    clicks,
    link_clicks,
    landing_page_views,
    purchases,
    purchase_value,
    add_to_cart,
    initiate_checkout,
    view_content,
    roas,
    cpa,
    cpc,
    ctr,
    cpm,
    conversion_rate,
    aov,
    lpv_rate,
    mer,
    blended_cac,
    new_customer_cac,
    profit,
    contribution_margin,
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

function pickCampaignsByStatus(campaigns, status, max = 6) {
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
    rows = rows.filter((c) => nonEmptyStr(c?.status).toUpperCase() === 'ACTIVE');
  }

  rows.sort((a, b) => {
    const av = toNum(a?.kpis?.[metric]);
    const bv = toNum(b?.kpis?.[metric]);
    return bv - av;
  });

  return compactArray(rows, max);
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
    link_clicks: round2(x?.link_clicks),
    landing_page_views: round2(x?.landing_page_views),
    conversion_rate: round2(x?.conversion_rate),
    aov: round2(x?.aov),
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
    country_top: compactArray(breakdownsData?.country_top || [], topN)
      .map(compactBreakdownRow)
      .filter((x) => x.key),
    region_top: compactArray(breakdownsData?.region_top || [], topN)
      .map(compactBreakdownRow)
      .filter((x) => x.key),
    creative_type_top: compactArray(breakdownsData?.creative_type_top || [], topN)
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
  const rawTotalsByDay = sortRowsByDateAsc(dailyData?.totals_by_day || []);
  const rawCampaignsDaily = Array.isArray(dailyData?.campaigns_daily) ? dailyData.campaigns_daily : [];

  const inferredRange = normalizeRange(dailyData?.meta?.range);
  const totalsByDay = sortRowsByDateAsc(filterRowsByContextRange(rawTotalsByDay, contextRangeDays, inferredRange));
  const campaignsDaily = sortRowsByDateAsc(filterRowsByContextRange(rawCampaignsDaily, contextRangeDays, inferredRange));

  const recentTotals = totalsByDay.slice(-14).map((d) => ({
    date: safeDateStr(d?.date),
    spend: round2(d?.kpis?.spend),
    purchases: round2(d?.kpis?.purchases),
    purchase_value: round2(d?.kpis?.purchase_value),
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
      rows: [],
    };

    existing.rows.push(row);

    if (!existing.campaign_name && campaignName) existing.campaign_name = campaignName;
    if (!existing.campaign_id && campaignId) existing.campaign_id = campaignId;
    if (!existing.status && row?.status) existing.status = nonEmptyStr(row?.status);
    if (!existing.objective_norm && row?.objective_norm) existing.objective_norm = nonEmptyStr(row?.objective_norm);

    grouped.set(groupKey, existing);
  }

  const topCampaignTrendBlocks = [];

  for (const group of grouped.values()) {
    const sorted = sortRowsByDateAsc(group.rows);

    const spendSeries = sorted.map((r) => toNum(r?.kpis?.spend));
    const revenueSeries = sorted.map((r) => toNum(r?.kpis?.purchase_value));
    const purchasesSeries = sorted.map((r) => toNum(r?.kpis?.purchases));
    const clicksSeries = sorted.map((r) => toNum(r?.kpis?.clicks));

    const totalSpend = spendSeries.reduce((a, b) => a + b, 0);
    const totalRevenue = revenueSeries.reduce((a, b) => a + b, 0);
    const totalPurchases = purchasesSeries.reduce((a, b) => a + b, 0);
    const totalClicks = clicksSeries.reduce((a, b) => a + b, 0);

    topCampaignTrendBlocks.push({
      campaign_id: group.campaign_id || null,
      campaign_name: group.campaign_name || null,
      status: group.status || null,
      objective_norm: group.objective_norm || null,
      total_spend: round2(totalSpend),
      total_purchase_value: round2(totalRevenue),
      total_purchases: round2(totalPurchases),
      total_clicks: round2(totalClicks),
      roas: totalSpend > 0 ? round2(totalRevenue / totalSpend) : 0,
      cpa: totalPurchases > 0 ? round2(totalSpend / totalPurchases) : 0,
      conversion_rate: totalClicks > 0 ? round2((totalPurchases / totalClicks) * 100) : 0,
      spend_trend: summarizeTrend(spendSeries),
      revenue_trend: summarizeTrend(revenueSeries),
      purchase_trend: summarizeTrend(purchasesSeries),
      recent_days: sorted.slice(-7).map((r) => ({
        date: safeDateStr(r?.date),
        spend: round2(r?.kpis?.spend),
        purchases: round2(r?.kpis?.purchases),
        purchase_value: round2(r?.kpis?.purchase_value),
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

function buildCampaignViews(rankedCampaigns, signals) {
  const all = Array.isArray(rankedCampaigns) ? rankedCampaigns : [];
  const winners = Array.isArray(signals?.winners) ? signals.winners : [];
  const risks = Array.isArray(signals?.risks) ? signals.risks : [];

  const active_campaigns_top = sortCampaignsByMetric(all, 'roas', 8, true);
  const active_campaigns_by_purchase_value = (() => {
    const rows = all
      .filter((c) => nonEmptyStr(c?.status).toUpperCase() === 'ACTIVE')
      .slice()
      .sort((a, b) => toNum(b?.kpis?.purchase_value) - toNum(a?.kpis?.purchase_value));
    return compactArray(rows, 8);
  })();

  const paused_winners = winners.filter((c) => nonEmptyStr(c?.status).toUpperCase() === 'PAUSED').slice(0, 6);
  const active_risks = risks.filter((c) => nonEmptyStr(c?.status).toUpperCase() === 'ACTIVE').slice(0, 6);

  const best_active_by_roas = active_campaigns_top[0] || null;
  const best_active_by_purchase_value = active_campaigns_by_purchase_value[0] || null;

  return {
    active_campaigns_top,
    active_campaigns_by_purchase_value,
    paused_winners,
    active_risks,
    best_active_by_roas,
    best_active_by_purchase_value,
    campaign_count: all.length,
    active_count: pickCampaignsByStatus(all, 'ACTIVE', 9999).length,
    paused_count: pickCampaignsByStatus(all, 'PAUSED', 9999).length,
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

  const bestActive = payload?.campaign_views?.best_active_by_roas || null;

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

  if (bestActive?.campaign_name) {
    out.positives.push(
      `The strongest active Meta campaign by ROAS appears to be "${bestActive.campaign_name}" with ROAS ${round2(bestActive?.kpis?.roas)}.`
    );
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

  if (bestActive?.campaign_name) {
    out.actions.push(`Validate whether "${bestActive.campaign_name}" can absorb incremental budget without damaging ROAS or CPA.`);
  }

  return {
    positives: uniqStrings(out.positives, 6),
    negatives: uniqStrings(out.negatives, 6),
    actions: uniqStrings(out.actions, 8),
  };
}

function buildDataQuality(meta, payload, contextRangeDays) {
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
    storageRangeDays: toNum(meta?.storageRangeDays) || null,
    contextRangeDays: toNum(contextRangeDays) || toNum(meta?.contextRangeDays) || null,
    windowType: nonEmptyStr(meta?.windowType) || 'context',
    datasetsPresent: {
      executive_summary: !!payload?.executive_summary,
      ranked_campaigns: rankedCount > 0,
      breakdowns:
        (payload?.breakdowns?.device_top || []).length > 0 ||
        (payload?.breakdowns?.placement_top || []).length > 0 ||
        (payload?.breakdowns?.country_top || []).length > 0 ||
        (payload?.breakdowns?.region_top || []).length > 0 ||
        (payload?.breakdowns?.creative_type_top || []).length > 0,
      signals:
        winnersCount > 0 ||
        risksCount > 0 ||
        (payload?.signals?.quick_wins || []).length > 0 ||
        (payload?.signals?.insights || []).length > 0,
      daily_trends: dailyCount > 0,
      campaign_views: !!payload?.campaign_views,
    },
  };
}

function buildLlmPromptHints(payload) {
  const hints = [];

  const spend = toNum(payload?.executive_summary?.headline_kpis?.spend);
  const roas = toNum(payload?.executive_summary?.headline_kpis?.roas);
  const purchases = toNum(payload?.executive_summary?.headline_kpis?.purchases);
  const last7 = payload?.executive_summary?.deltas?.last7_vs_prev7 || null;

  const bestActive = payload?.campaign_views?.best_active_by_roas || null;
  const activeRisks = Array.isArray(payload?.campaign_views?.active_risks) ? payload.campaign_views.active_risks : [];
  const topDevices = Array.isArray(payload?.breakdowns?.device_top) ? payload.breakdowns.device_top : [];
  const topPlacements = Array.isArray(payload?.breakdowns?.placement_top) ? payload.breakdowns.placement_top : [];

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

  if (bestActive?.campaign_name) {
    hints.push(`Use "${bestActive.campaign_name}" as a reference point when identifying the strongest active Meta campaign.`);
  }

  if (activeRisks.length > 0) {
    hints.push('Review active risk campaigns before scaling spend because they are likely creating inefficiency right now.');
  }

  if (topDevices.length > 0) {
    hints.push('Compare device performance to determine whether mobile or desktop is carrying conversion volume and efficiency.');
  }

  if (topPlacements.length > 0) {
    hints.push('Use placement-level performance to identify which inventory is supporting revenue and which is dragging returns.');
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

  return uniqStrings(hints, 10);
}

function buildKpiDefinitions() {
  return {
    spend_delivery: [
      'spend',
      'impressions',
      'reach',
      'frequency',
      'clicks',
      'link_clicks',
      'landing_page_views',
      'cpm',
      'cpc',
      'ctr',
      'lpv_rate',
    ],
    revenue_conversion: [
      'purchases',
      'purchase_value',
      'add_to_cart',
      'initiate_checkout',
      'view_content',
      'conversion_rate',
      'aov',
    ],
    efficiency: [
      'roas',
      'cpa',
      'mer',
      'blended_cac',
      'new_customer_cac',
      'profit',
      'contribution_margin',
    ],
    structure_segmentation: [
      'platform',
      'campaign_id',
      'campaign_name',
      'campaign_type',
      'objective',
      'objective_norm',
      'optimization_goal',
      'status',
      'device',
      'placement',
      'country',
      'region',
      'creative_type',
    ],
  };
}

/**
 * Formatea datasets MCP de Meta a una vista AI-ready compacta
 */
function formatMetaForLlm({
  datasets = [],
  contextRangeDays = 60,
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
  const effectiveContextRangeDays =
    clampInt(contextRangeDays || meta?.contextRangeDays || range?.days || 30, 7, 3650);

  const ranked_campaigns = buildRankedCampaigns(rankedData, Math.max(topCampaigns, 12));
  const breakdowns = buildBreakdowns(breakdownsData, topBreakdowns);
  const signals = buildSignals(signalsData);
  const daily_trends = buildDailyTrends(dailyData, topTrendCampaigns, effectiveContextRangeDays);

  const payload = {
    meta: {
      schema: 'adray.meta.llm.v4',
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
      storageRangeDays: toNum(meta?.storageRangeDays) || null,
      contextRangeDays: effectiveContextRangeDays,
      windowType: nonEmptyStr(meta?.windowType) || 'context',
      currency: nonEmptyStr(meta?.currency) || null,
      latestSnapshotId: nonEmptyStr(meta?.latestSnapshotId) || null,
      collectorVersion: nonEmptyStr(meta?.version) || null,
      platform: 'meta',
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
  payload.data_quality = buildDataQuality(meta, payload, effectiveContextRangeDays);
  payload.llm_hints = buildLlmPromptHints(payload);

  return payload;
}

/**
 * Devuelve un resumen corto pero con suficiente detalle para preguntas de campañas.
 */
function formatMetaForLlmMini({
  datasets = [],
  contextRangeDays = 60,
  topCampaigns = 6,
} = {}) {
  const full = formatMetaForLlm({
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
    active_campaigns_by_purchase_value: compactArray(full.campaign_views?.active_campaigns_by_purchase_value || [], 5),
    paused_winners: compactArray(full.campaign_views?.paused_winners || [], 4),
    active_risks: compactArray(full.campaign_views?.active_risks || [], 4),
    best_active_by_roas: full.campaign_views?.best_active_by_roas || null,
    best_active_by_purchase_value: full.campaign_views?.best_active_by_purchase_value || null,

    winners: compactArray(full.signals?.winners || [], 4),
    risks: compactArray(full.signals?.risks || [], 4),
    quick_wins: compactArray(full.signals?.quick_wins || [], 4),

    top_devices: compactArray(full.breakdowns?.device_top || [], 4),
    top_placements: compactArray(full.breakdowns?.placement_top || [], 4),
    top_countries: compactArray(full.breakdowns?.country_top || [], 4),
    top_regions: compactArray(full.breakdowns?.region_top || [], 4),
    top_creative_types: compactArray(full.breakdowns?.creative_type_top || [], 4),

    campaign_trends: compactArray(full.daily_trends?.campaign_trends || [], 4),
    priority_summary: full.priority_summary || { positives: [], negatives: [], actions: [] },
    llm_hints: compactArray(full.llm_hints || [], 6),
  };
}

module.exports = {
  formatMetaForLlm,
  formatMetaForLlmMini,
};