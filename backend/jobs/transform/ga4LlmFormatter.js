'use strict';

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round((toNum(v) + Number.EPSILON) * 100) / 100;
}

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
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

function compactArray(arr, max = 10) {
  return Array.isArray(arr) ? arr.slice(0, Math.max(0, max)) : [];
}

function sortByDateAsc(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => safeStr(a?.date).localeCompare(safeStr(b?.date)));
}

function getDatasetMap(datasets) {
  const map = new Map();

  for (const ds of Array.isArray(datasets) ? datasets : []) {
    const key = safeStr(ds?.dataset).trim();
    if (!key) continue;
    map.set(key, ds);
  }

  return map;
}

function getData(ds) {
  return ds && typeof ds === 'object' ? (ds.data || {}) : {};
}

function getSnapshotIdFromDatasets(datasets) {
  for (const ds of Array.isArray(datasets) ? datasets : []) {
    const sid = safeStr(ds?.snapshotId).trim();
    if (sid) return sid;
  }
  return null;
}

function getMetaFromDatasets(map) {
  const candidates = [
    'ga4.insights_summary',
    'ga4.daily_trends_ai',
    'ga4.kpis_daily',
    'ga4.channels_top',
    'ga4.devices_top',
    'ga4.landing_pages_top',
    'ga4.source_medium_top',
    'ga4.events_top',
    'ga4.optimization_signals',
  ];

  for (const key of candidates) {
    const meta = getData(map.get(key))?.meta;
    if (meta && typeof meta === 'object') return meta;
  }

  return {};
}

function normalizeSummary(summary) {
  const k = summary?.kpis || {};
  const w = summary?.windows || {};
  const d = summary?.deltas || {};

  return {
    kpis: {
      users: toNum(k.users),
      sessions: toNum(k.sessions),
      conversions: toNum(k.conversions),
      revenue: round2(k.revenue),
      newUsers: toNum(k.newUsers),
      engagedSessions: toNum(k.engagedSessions),
      engagementRate: round2(k.engagementRate),
    },
    windows: {
      last_7_days: normalizeWindow(w.last_7_days),
      prev_7_days: normalizeWindow(w.prev_7_days),
      last_30_days: normalizeWindow(w.last_30_days),
      prev_30_days: normalizeWindow(w.prev_30_days),
    },
    deltas: {
      last7_vs_prev7: normalizeDeltas(d.last7_vs_prev7),
      last30_vs_prev30: normalizeDeltas(d.last30_vs_prev30),
    },
  };
}

function normalizeWindow(w) {
  return {
    users: toNum(w?.users),
    sessions: toNum(w?.sessions),
    conversions: toNum(w?.conversions),
    revenue: round2(w?.revenue),
    engagedSessions: toNum(w?.engagedSessions),
    engagementRate: round2(w?.engagementRate),
  };
}

function normalizeDeltas(d) {
  return {
    users_pct: round2(d?.users_pct),
    sessions_pct: round2(d?.sessions_pct),
    conversions_pct: round2(d?.conversions_pct),
    revenue_pct: round2(d?.revenue_pct),
    engagementRate_diff: round2(d?.engagementRate_diff),
  };
}

function normalizeChannelRow(row) {
  return {
    channel: safeStr(row?.channel) || '(other)',
    users: toNum(row?.users),
    sessions: toNum(row?.sessions),
    conversions: toNum(row?.conversions),
    revenue: round2(row?.revenue),
    newUsers: toNum(row?.newUsers),
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
  };
}

function normalizeDeviceRow(row) {
  return {
    device: safeStr(row?.device) || '(other)',
    users: toNum(row?.users),
    sessions: toNum(row?.sessions),
    conversions: toNum(row?.conversions),
    revenue: round2(row?.revenue),
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
  };
}

function normalizeLandingRow(row) {
  return {
    page: safeStr(row?.page) || '(not set)',
    sessions: toNum(row?.sessions),
    conversions: toNum(row?.conversions),
    revenue: round2(row?.revenue),
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
  };
}

function normalizeSourceMediumRow(row) {
  return {
    source: safeStr(row?.source) || '(direct)',
    medium: safeStr(row?.medium) || '(none)',
    sessions: toNum(row?.sessions),
    conversions: toNum(row?.conversions),
    revenue: round2(row?.revenue),
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
  };
}

function normalizeEventRow(row) {
  return {
    event: safeStr(row?.event) || '(not set)',
    eventCount: toNum(row?.eventCount),
    conversions: toNum(row?.conversions),
  };
}

function normalizeDailyRow(row) {
  const revenue =
    row?.revenue != null ? row.revenue :
    row?.purchaseRevenue != null ? row.purchaseRevenue :
    row?.conversion_value != null ? row.conversion_value :
    0;

  return {
    date: safeStr(row?.date),
    users: toNum(row?.users),
    sessions: toNum(row?.sessions),
    conversions: toNum(row?.conversions),
    revenue: round2(revenue),
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
  };
}

function extractDatasets(map) {
  const summary = normalizeSummary(getData(map.get('ga4.insights_summary'))?.summary || {});
  const channelsTop = (getData(map.get('ga4.channels_top'))?.channels_top || []).map(normalizeChannelRow);
  const devicesTop = (getData(map.get('ga4.devices_top'))?.devices_top || []).map(normalizeDeviceRow);
  const landingPagesTop = (getData(map.get('ga4.landing_pages_top'))?.landing_pages_top || []).map(normalizeLandingRow);
  const sourceMediumTop = (getData(map.get('ga4.source_medium_top'))?.source_medium_top || []).map(normalizeSourceMediumRow);
  const eventsTop = (getData(map.get('ga4.events_top'))?.events_top || []).map(normalizeEventRow);

  const optimizationSignalsRaw =
    getData(map.get('ga4.optimization_signals'))?.optimization_signals || null;

  let dailyTrends =
    getData(map.get('ga4.daily_trends_ai'))?.totals_by_day ||
    getData(map.get('ga4.kpis_daily'))?.kpis_daily ||
    [];

  dailyTrends = sortByDateAsc(dailyTrends.map(normalizeDailyRow)).filter((x) => x.date);

  return {
    summary,
    channelsTop,
    devicesTop,
    landingPagesTop,
    sourceMediumTop,
    eventsTop,
    optimizationSignalsRaw,
    dailyTrends,
  };
}

function buildHeadlineKpis(summary) {
  const k = summary?.kpis || {};
  const d7 = summary?.deltas?.last7_vs_prev7 || {};
  const d30 = summary?.deltas?.last30_vs_prev30 || {};

  return {
    users: k.users,
    sessions: k.sessions,
    conversions: k.conversions,
    revenue: k.revenue,
    engagementRate: k.engagementRate,
    last7_vs_prev7: {
      users_pct: round2(d7.users_pct),
      sessions_pct: round2(d7.sessions_pct),
      conversions_pct: round2(d7.conversions_pct),
      revenue_pct: round2(d7.revenue_pct),
      engagementRate_diff: round2(d7.engagementRate_diff),
    },
    last30_vs_prev30: {
      users_pct: round2(d30.users_pct),
      sessions_pct: round2(d30.sessions_pct),
      conversions_pct: round2(d30.conversions_pct),
      revenue_pct: round2(d30.revenue_pct),
      engagementRate_diff: round2(d30.engagementRate_diff),
    },
  };
}

function buildTopChannels(channelsTop, topNCount) {
  return compactArray(
    (Array.isArray(channelsTop) ? channelsTop : []).map((x) => ({
      channel: x.channel,
      sessions: x.sessions,
      conversions: x.conversions,
      revenue: round2(x.revenue),
      engagementRate: round2(x.engagementRate),
      users: x.users,
    })),
    topNCount
  );
}

function buildTopDevices(devicesTop, topNCount) {
  return compactArray(
    (Array.isArray(devicesTop) ? devicesTop : []).map((x) => ({
      device: x.device,
      sessions: x.sessions,
      conversions: x.conversions,
      revenue: round2(x.revenue),
      engagementRate: round2(x.engagementRate),
      users: x.users,
    })),
    topNCount
  );
}

function buildTopLandingPages(landingPagesTop, topNCount) {
  return compactArray(
    (Array.isArray(landingPagesTop) ? landingPagesTop : []).map((x) => ({
      page: x.page,
      sessions: x.sessions,
      conversions: x.conversions,
      revenue: round2(x.revenue),
      engagementRate: round2(x.engagementRate),
    })),
    topNCount
  );
}

function buildTopSourceMedium(sourceMediumTop, topNCount) {
  return compactArray(
    (Array.isArray(sourceMediumTop) ? sourceMediumTop : []).map((x) => ({
      source: x.source,
      medium: x.medium,
      sessions: x.sessions,
      conversions: x.conversions,
      revenue: round2(x.revenue),
      engagementRate: round2(x.engagementRate),
    })),
    topNCount
  );
}

function buildTopEvents(eventsTop, topNCount) {
  return compactArray(
    (Array.isArray(eventsTop) ? eventsTop : []).map((x) => ({
      event: x.event,
      eventCount: x.eventCount,
      conversions: x.conversions,
    })),
    topNCount
  );
}

function isMeaningfulDailyRow(r) {
  return (
    toNum(r?.users) > 0 ||
    toNum(r?.sessions) > 0 ||
    toNum(r?.conversions) > 0 ||
    toNum(r?.revenue) > 0 ||
    toNum(r?.engagedSessions) > 0
  );
}

function trimDailyRows(dailyRows, maxDays) {
  const rows = sortByDateAsc(Array.isArray(dailyRows) ? dailyRows : []);
  if (!rows.length) return [];

  const meaningful = rows.filter(isMeaningfulDailyRow);

  // Si sí hay datos reales, preferimos solo días útiles
  if (meaningful.length > 0) {
    return meaningful.slice(-Math.max(1, maxDays));
  }

  // Si todo viene en 0, al menos no mandar 60-90 filas vacías
  return rows.slice(-Math.min(Math.max(1, maxDays), 7));
}

function buildDailyTrendPack(dailyRows, maxDays) {
  const rows = trimDailyRows(dailyRows, maxDays);

  let prev = null;
  return rows.map((r) => {
    const row = {
      date: r.date,
      users: r.users,
      sessions: r.sessions,
      conversions: r.conversions,
      revenue: round2(r.revenue),
      engagementRate: round2(r.engagementRate),
    };

    if (prev) {
      row.sessions_trend = trendWord(r.sessions, prev.sessions);
      row.revenue_trend = trendWord(r.revenue, prev.revenue);
      row.conversions_trend = trendWord(r.conversions, prev.conversions);
    }

    prev = r;
    return row;
  });
}

function trendWord(cur, prev) {
  const a = toNum(cur);
  const b = toNum(prev);

  if (a > b) return 'up';
  if (a < b) return 'down';
  return 'flat';
}

function buildOptimizationSignals({
  optimizationSignalsRaw,
  channelsTop,
  devicesTop,
  landingPagesTop,
  sourceMediumTop,
  eventsTop,
  summary,
}) {
  if (optimizationSignalsRaw && typeof optimizationSignalsRaw === 'object') {
    return {
      winners: compactArray(Array.isArray(optimizationSignalsRaw.winners) ? optimizationSignalsRaw.winners : [], 6),
      risks: compactArray(Array.isArray(optimizationSignalsRaw.risks) ? optimizationSignalsRaw.risks : [], 6),
      quick_wins: compactArray(Array.isArray(optimizationSignalsRaw.quick_wins) ? optimizationSignalsRaw.quick_wins : [], 6),
      insights: uniqStrings(optimizationSignalsRaw.insights, 8),
      recommendations: uniqStrings(optimizationSignalsRaw.recommendations, 8),
    };
  }

  const k = summary?.kpis || {};
  const out = {
    winners: [],
    risks: [],
    quick_wins: [],
    insights: [],
    recommendations: [],
  };

  const bestChannel = (channelsTop || [])[0] || null;
  const bestDevice = (devicesTop || [])[0] || null;
  const bestLanding = (landingPagesTop || [])[0] || null;
  const bestSourceMedium = (sourceMediumTop || [])[0] || null;
  const purchaseEvent = (eventsTop || []).find((e) => safeStr(e.event).toLowerCase() === 'purchase') || null;

  if (bestChannel) {
    out.winners.push({
      type: 'channel',
      label: bestChannel.channel,
      sessions: bestChannel.sessions,
      conversions: bestChannel.conversions,
      revenue: round2(bestChannel.revenue),
      engagementRate: round2(bestChannel.engagementRate),
    });
    out.insights.push(`Top traffic channel by sessions is ${bestChannel.channel}.`);
  }

  if (bestDevice) {
    out.winners.push({
      type: 'device',
      label: bestDevice.device,
      sessions: bestDevice.sessions,
      conversions: bestDevice.conversions,
      revenue: round2(bestDevice.revenue),
      engagementRate: round2(bestDevice.engagementRate),
    });
    out.insights.push(`Top device category is ${bestDevice.device}.`);
  }

  if (bestLanding) {
    out.quick_wins.push({
      type: 'landing_page',
      label: bestLanding.page,
      sessions: bestLanding.sessions,
      conversions: bestLanding.conversions,
      revenue: round2(bestLanding.revenue),
    });
    out.insights.push('A leading landing page is generating most of the entry traffic.');
  }

  if (bestSourceMedium) {
    out.quick_wins.push({
      type: 'source_medium',
      label: `${bestSourceMedium.source} / ${bestSourceMedium.medium}`,
      sessions: bestSourceMedium.sessions,
      conversions: bestSourceMedium.conversions,
      revenue: round2(bestSourceMedium.revenue),
    });
  }

  if (purchaseEvent) {
    out.insights.push(`Purchase event volume is ${purchaseEvent.eventCount}.`);
  }

  const badLanding = (landingPagesTop || []).find((x) => {
    const lowEngagement = toNum(x.engagementRate) > 0 && toNum(x.engagementRate) < 35;
    const volume = toNum(x.sessions) >= 100;
    return volume && lowEngagement;
  });

  if (badLanding) {
    out.risks.push({
      type: 'landing_page',
      label: badLanding.page,
      sessions: badLanding.sessions,
      conversions: badLanding.conversions,
      revenue: round2(badLanding.revenue),
      engagementRate: round2(badLanding.engagementRate),
    });
    out.insights.push('At least one landing page has meaningful traffic with weak engagement.');
  }

  if (toNum(k.engagementRate) > 0 && toNum(k.engagementRate) < 45) {
    out.recommendations.push('Improve landing page relevance and session quality to lift engagement rate.');
  }

  if (toNum(k.sessions) > 0 && toNum(k.conversions) === 0) {
    out.recommendations.push('There is traffic but no conversions recorded; audit event mapping and checkout flow.');
  }

  if (purchaseEvent && purchaseEvent.eventCount > 0 && toNum(k.revenue) <= 0) {
    out.recommendations.push('Purchase events exist but revenue is zero or weak; review ecommerce value mapping.');
  }

  if (bestChannel) {
    out.recommendations.push(`Protect and scale the strongest channel first: ${bestChannel.channel}.`);
  }

  if (bestLanding) {
    out.recommendations.push('Test iterative CRO improvements on the highest-traffic landing page first.');
  }

  return {
    winners: compactArray(out.winners, 6),
    risks: compactArray(out.risks, 6),
    quick_wins: compactArray(out.quick_wins, 6),
    insights: uniqStrings(out.insights, 8),
    recommendations: uniqStrings(out.recommendations, 8),
  };
}

function buildPrioritySummary({
  summary,
  channelsTop,
  devicesTop,
  landingPagesTop,
  sourceMediumTop,
  eventsTop,
  optimizationSignals,
}) {
  const positives = [];
  const negatives = [];
  const actions = [];

  const k = summary?.kpis || {};
  const d7 = summary?.deltas?.last7_vs_prev7 || {};

  if (toNum(k.conversions) > 0) {
    positives.push(`The property is generating conversions (${toNum(k.conversions)} total conversions).`);
  }

  if (toNum(k.revenue) > 0) {
    positives.push(`Revenue tracking is active with ${round2(k.revenue)} in recorded revenue.`);
  }

  if (toNum(d7.sessions_pct) > 0) {
    positives.push(`Sessions grew ${round2(d7.sessions_pct)}% in the last 7 days versus the previous 7-day window.`);
  }

  if (toNum(d7.revenue_pct) > 0) {
    positives.push(`Revenue grew ${round2(d7.revenue_pct)}% in the last 7 days versus the previous 7-day window.`);
  }

  if (toNum(k.engagementRate) >= 60) {
    positives.push('Engagement rate is strong and indicates healthy session quality.');
  }

  if (toNum(d7.sessions_pct) < 0) {
    negatives.push(`Sessions declined ${Math.abs(round2(d7.sessions_pct))}% in the last 7 days.`);
  }

  if (toNum(d7.conversions_pct) < 0) {
    negatives.push(`Conversions declined ${Math.abs(round2(d7.conversions_pct))}% in the last 7 days.`);
  }

  if (toNum(d7.revenue_pct) < 0) {
    negatives.push(`Revenue declined ${Math.abs(round2(d7.revenue_pct))}% in the last 7 days.`);
  }

  if (toNum(k.engagementRate) > 0 && toNum(k.engagementRate) < 45) {
    negatives.push('Overall engagement rate is soft and may reflect low-quality sessions or weak landing relevance.');
  }

  if ((optimizationSignals?.risks || []).length) {
    negatives.push(`There are ${(optimizationSignals?.risks || []).length} notable risk areas in the current traffic mix.`);
  }

  const bestChannel = (channelsTop || [])[0];
  const bestDevice = (devicesTop || [])[0];
  const bestLanding = (landingPagesTop || [])[0];
  const bestSourceMedium = (sourceMediumTop || [])[0];
  const topEvent = (eventsTop || [])[0];

  if (bestChannel) {
    actions.push(`Protect the strongest channel first: ${bestChannel.channel}.`);
  }

  if (bestLanding) {
    actions.push(`Review and optimize the top landing page: ${bestLanding.page}.`);
  }

  if (bestSourceMedium) {
    actions.push(`Audit the highest-volume source / medium pair: ${bestSourceMedium.source} / ${bestSourceMedium.medium}.`);
  }

  if (bestDevice) {
    actions.push(`Check UX quality on the leading device category: ${bestDevice.device}.`);
  }

  if (topEvent) {
    actions.push(`Validate the business-critical event flow around ${topEvent.event}.`);
  }

  for (const rec of optimizationSignals?.recommendations || []) {
    actions.push(rec);
  }

  return {
    positives: uniqStrings(positives, 6),
    negatives: uniqStrings(negatives, 6),
    actions: uniqStrings(actions, 8),
  };
}

function buildLlmHints() {
  return [
    'Focus on sessions, conversions, revenue, engagement rate, landing pages, and channel quality.',
    'Treat this as analytics context for business and growth decisions, not raw API output.',
    'Prioritize scalable winners, quality traffic sources, and landing page bottlenecks.',
    'Use trend direction to explain what is improving, declining, or staying flat.',
  ];
}

function buildDataQuality(meta, datasets) {
  const properties = Array.isArray(meta?.properties) ? meta.properties : [];
  const range = meta?.range || {};
  const dsNames = (Array.isArray(datasets) ? datasets : []).map((d) => safeStr(d?.dataset)).filter(Boolean);

  return {
    hasAnyData: dsNames.length > 0,
    propertyCount: properties.length,
    range: {
      from: safeStr(range?.from) || null,
      to: safeStr(range?.to) || null,
      tz: safeStr(range?.tz) || null,
    },
    datasetsPresent: {
      executive_summary: dsNames.includes('ga4.insights_summary'),
      channels: dsNames.includes('ga4.channels_top'),
      devices: dsNames.includes('ga4.devices_top'),
      landing_pages: dsNames.includes('ga4.landing_pages_top'),
      source_medium: dsNames.includes('ga4.source_medium_top'),
      events: dsNames.includes('ga4.events_top'),
      signals: dsNames.includes('ga4.optimization_signals'),
      daily_trends: dsNames.includes('ga4.daily_trends_ai') || dsNames.includes('ga4.kpis_daily'),
    },
  };
}

function formatGa4ForLlm({
  datasets = [],
  topChannels = 8,
  topDevices = 6,
  topLandingPages = 8,
  topSourceMedium = 10,
  topEvents = 10,
  topTrendDays = 30,
} = {}) {
  const map = getDatasetMap(datasets);
  const meta = getMetaFromDatasets(map);
  const extracted = extractDatasets(map);
  const snapshotId = getSnapshotIdFromDatasets(datasets);

  const headline_kpis = buildHeadlineKpis(extracted.summary);

  const top_channels = buildTopChannels(extracted.channelsTop, clampInt(topChannels, 1, 20));
  const top_devices = buildTopDevices(extracted.devicesTop, clampInt(topDevices, 1, 12));
  const top_landing_pages = buildTopLandingPages(extracted.landingPagesTop, clampInt(topLandingPages, 1, 20));
  const top_source_medium = buildTopSourceMedium(extracted.sourceMediumTop, clampInt(topSourceMedium, 1, 25));
  const top_events = buildTopEvents(extracted.eventsTop, clampInt(topEvents, 1, 25));
  const daily_trends = buildDailyTrendPack(extracted.dailyTrends, clampInt(topTrendDays, 1, 90));

  const optimization_signals = buildOptimizationSignals({
    optimizationSignalsRaw: extracted.optimizationSignalsRaw,
    channelsTop: top_channels,
    devicesTop: top_devices,
    landingPagesTop: top_landing_pages,
    sourceMediumTop: top_source_medium,
    eventsTop: top_events,
    summary: extracted.summary,
  });

  const priority_summary = buildPrioritySummary({
    summary: extracted.summary,
    channelsTop: top_channels,
    devicesTop: top_devices,
    landingPagesTop: top_landing_pages,
    sourceMediumTop: top_source_medium,
    eventsTop: top_events,
    optimizationSignals: optimization_signals,
  });

  const properties = Array.isArray(meta?.properties) ? meta.properties : [];
  const range = meta?.range || {};
  const generatedAt = meta?.generatedAt || new Date().toISOString();

  return {
    ga4: {
      schema: 'adray.ga4.llm.v1',
      source: 'ga4',
      generatedAt,
      propertyIds: properties.map((p) => safeStr(p?.id)).filter(Boolean),
      propertyCount: properties.length,
      properties: properties.map((p) => ({
        id: safeStr(p?.id) || null,
        name: safeStr(p?.name) || null,
        currency: safeStr(p?.currencyCode) || null,
        timezone_name: safeStr(p?.timeZone) || null,
      })),
      range: {
        from: safeStr(range?.from) || null,
        to: safeStr(range?.to) || null,
        tz: safeStr(range?.tz) || null,
      },
      executive_summary: {
        headline_kpis,
        comparison_windows: extracted.summary?.windows || {},
      },
      top_channels,
      top_devices,
      top_landing_pages,
      top_source_medium,
      top_events,
      optimization_signals,
      daily_trends,
      priority_summary,
      llm_hints: buildLlmHints(),
      data_quality: buildDataQuality(meta, datasets),
    },
    meta: {
      snapshotId: snapshotId || null,
      chunkCount: Array.isArray(datasets) ? datasets.length : 0,
      datasets: (Array.isArray(datasets) ? datasets : []).map((d) => safeStr(d?.dataset)).filter(Boolean),
    },
  };
}

function formatGa4ForLlmMini({
  datasets = [],
  topChannels = 5,
  topDevices = 4,
  topLandingPages = 5,
  topEvents = 6,
} = {}) {
  const map = getDatasetMap(datasets);
  const meta = getMetaFromDatasets(map);
  const extracted = extractDatasets(map);
  const snapshotId = getSnapshotIdFromDatasets(datasets);

  const headline_kpis = buildHeadlineKpis(extracted.summary);

  const top_channels = buildTopChannels(extracted.channelsTop, clampInt(topChannels, 1, 10));
  const top_devices = buildTopDevices(extracted.devicesTop, clampInt(topDevices, 1, 8));
  const top_landing_pages = buildTopLandingPages(extracted.landingPagesTop, clampInt(topLandingPages, 1, 10));
  const top_events = buildTopEvents(extracted.eventsTop, clampInt(topEvents, 1, 10));

  const optimization_signals = buildOptimizationSignals({
    optimizationSignalsRaw: extracted.optimizationSignalsRaw,
    channelsTop: top_channels,
    devicesTop: top_devices,
    landingPagesTop: top_landing_pages,
    sourceMediumTop: extracted.sourceMediumTop,
    eventsTop: top_events,
    summary: extracted.summary,
  });

  const priority_summary = buildPrioritySummary({
    summary: extracted.summary,
    channelsTop: top_channels,
    devicesTop: top_devices,
    landingPagesTop: top_landing_pages,
    sourceMediumTop: extracted.sourceMediumTop,
    eventsTop: top_events,
    optimizationSignals: optimization_signals,
  });

  const properties = Array.isArray(meta?.properties) ? meta.properties : [];
  const range = meta?.range || {};
  const generatedAt = meta?.generatedAt || new Date().toISOString();

  return {
    data: {
      schema: 'adray.ga4.llm.v1',
      source: 'ga4',
      generatedAt,
      propertyIds: properties.map((p) => safeStr(p?.id)).filter(Boolean),
      propertyCount: properties.length,
      properties: properties.map((p) => ({
        id: safeStr(p?.id) || null,
        name: safeStr(p?.name) || null,
        currency: safeStr(p?.currencyCode) || null,
        timezone_name: safeStr(p?.timeZone) || null,
      })),
      range: {
        from: safeStr(range?.from) || null,
        to: safeStr(range?.to) || null,
        tz: safeStr(range?.tz) || null,
      },
      data_quality: buildDataQuality(meta, datasets),
      headline_kpis,
      top_channels,
      top_devices,
      top_landing_pages,
      top_events,
      priority_summary: {
        positives: compactArray(priority_summary?.positives || [], 4),
        negatives: compactArray(priority_summary?.negatives || [], 4),
        actions: compactArray(priority_summary?.actions || [], 5),
      },
      llm_hints: buildLlmHints(),
    },
    meta: {
      snapshotId: snapshotId || null,
      chunkCount: Array.isArray(datasets) ? datasets.length : 0,
      datasets: (Array.isArray(datasets) ? datasets : []).map((d) => safeStr(d?.dataset)).filter(Boolean),
    },
  };
}

module.exports = {
  formatGa4ForLlm,
  formatGa4ForLlmMini,
};