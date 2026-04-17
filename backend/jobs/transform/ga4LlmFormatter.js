'use strict';

function safeStr(v) {
  return v == null ? '' : String(v);
}

function nonEmptyStr(v) {
  const s = safeStr(v).trim();
  return s || '';
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
    const s = nonEmptyStr(x);
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

function parseYmdToUtcDate(ymd) {
  const s = nonEmptyStr(ymd);
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

function getDatasetMap(datasets) {
  const map = new Map();

  for (const ds of Array.isArray(datasets) ? datasets : []) {
    const key = nonEmptyStr(ds?.dataset);
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
    const sid = nonEmptyStr(ds?.snapshotId);
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

function normalizeRange(range) {
  const from = nonEmptyStr(range?.from || range?.since) || null;
  const to = nonEmptyStr(range?.to || range?.until) || null;

  return {
    from,
    to,
    since: from,
    until: to,
    tz: nonEmptyStr(range?.tz) || null,
    days: toNum(range?.days),
  };
}

function normalizeSummary(summary) {
  const k = summary?.kpis || {};
  const w = summary?.windows || {};
  const d = summary?.deltas || {};

  return {
    kpis: {
      users: toNum(k.users),
      sessions: toNum(k.sessions),
      engagedSessions: toNum(k.engagedSessions),
      conversions: toNum(k.conversions),
      revenue: round2(k.revenue),
      newUsers: toNum(k.newUsers),
      engagementRate: round2(k.engagementRate),
      avgSessionDuration: round2(k.avgSessionDuration),
      bounceRate: round2(k.bounceRate),
      sessionsPerUser: round2(k.sessionsPerUser),
      conversionRate: round2(k.conversionRate),
      revenuePerUser: round2(k.revenuePerUser),
      revenuePerSession: round2(k.revenuePerSession),
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
    avgSessionDuration: round2(w?.avgSessionDuration),
    bounceRate: round2(w?.bounceRate),
  };
}

function normalizeDeltas(d) {
  return {
    users_pct: round2(d?.users_pct),
    sessions_pct: round2(d?.sessions_pct),
    conversions_pct: round2(d?.conversions_pct),
    revenue_pct: round2(d?.revenue_pct),
    engagementRate_diff: round2(d?.engagementRate_diff),
    avgSessionDuration_diff: round2(d?.avgSessionDuration_diff),
    bounceRate_diff: round2(d?.bounceRate_diff),
  };
}

function normalizeChannelRow(row) {
  const users = toNum(row?.users);
  const sessions = toNum(row?.sessions);
  const conversions = toNum(row?.conversions);
  const revenue = round2(row?.revenue);

  return {
    channel: nonEmptyStr(row?.channel) || '(other)',
    users,
    sessions,
    conversions,
    revenue,
    newUsers: toNum(row?.newUsers),
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
    sessionsPerUser: users > 0 ? round2(sessions / users) : 0,
    conversionRate: sessions > 0 ? round2((conversions / sessions) * 100) : 0,
    revenuePerSession: sessions > 0 ? round2(revenue / sessions) : 0,
  };
}

function normalizeDeviceRow(row) {
  const users = toNum(row?.users);
  const sessions = toNum(row?.sessions);
  const conversions = toNum(row?.conversions);
  const revenue = round2(row?.revenue);

  return {
    device: nonEmptyStr(row?.device) || '(other)',
    users,
    sessions,
    conversions,
    revenue,
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
    sessionsPerUser: users > 0 ? round2(sessions / users) : 0,
    conversionRate: sessions > 0 ? round2((conversions / sessions) * 100) : 0,
    revenuePerSession: sessions > 0 ? round2(revenue / sessions) : 0,
  };
}

function normalizeLandingRow(row) {
  const sessions = toNum(row?.sessions);
  const conversions = toNum(row?.conversions);
  const revenue = round2(row?.revenue);

  return {
    page: nonEmptyStr(row?.page) || '(not set)',
    sessions,
    conversions,
    revenue,
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
    conversionRate: sessions > 0 ? round2((conversions / sessions) * 100) : 0,
    revenuePerSession: sessions > 0 ? round2(revenue / sessions) : 0,
  };
}

function normalizeSourceMediumRow(row) {
  const sessions = toNum(row?.sessions);
  const conversions = toNum(row?.conversions);
  const revenue = round2(row?.revenue);

  return {
    source: nonEmptyStr(row?.source) || '(direct)',
    medium: nonEmptyStr(row?.medium) || '(none)',
    sessions,
    conversions,
    revenue,
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
    conversionRate: sessions > 0 ? round2((conversions / sessions) * 100) : 0,
    revenuePerSession: sessions > 0 ? round2(revenue / sessions) : 0,
  };
}

function normalizeEventRow(row) {
  return {
    event: nonEmptyStr(row?.event) || '(not set)',
    eventCount: toNum(row?.eventCount),
    conversions: toNum(row?.conversions),
    revenue: round2(row?.revenue),
  };
}

function normalizeDailyRow(row) {
  const revenue =
    row?.revenue != null ? row.revenue :
    row?.purchaseRevenue != null ? row.purchaseRevenue :
    row?.conversion_value != null ? row.conversion_value :
    0;

  return {
    date: nonEmptyStr(row?.date),
    users: toNum(row?.users),
    sessions: toNum(row?.sessions),
    conversions: toNum(row?.conversions),
    revenue: round2(revenue),
    engagedSessions: toNum(row?.engagedSessions),
    engagementRate: round2(row?.engagementRate),
    avgSessionDuration: round2(row?.avgSessionDuration),
    bounceRate: round2(row?.bounceRate),
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
    engagedSessions: k.engagedSessions,
    conversions: k.conversions,
    revenue: k.revenue,
    newUsers: k.newUsers,
    engagementRate: k.engagementRate,
    avgSessionDuration: k.avgSessionDuration,
    bounceRate: k.bounceRate,
    sessionsPerUser: k.sessionsPerUser,
    conversionRate: k.conversionRate,
    revenuePerUser: k.revenuePerUser,
    revenuePerSession: k.revenuePerSession,
    last7_vs_prev7: {
      users_pct: round2(d7.users_pct),
      sessions_pct: round2(d7.sessions_pct),
      conversions_pct: round2(d7.conversions_pct),
      revenue_pct: round2(d7.revenue_pct),
      engagementRate_diff: round2(d7.engagementRate_diff),
      avgSessionDuration_diff: round2(d7.avgSessionDuration_diff),
      bounceRate_diff: round2(d7.bounceRate_diff),
    },
    last30_vs_prev30: {
      users_pct: round2(d30.users_pct),
      sessions_pct: round2(d30.sessions_pct),
      conversions_pct: round2(d30.conversions_pct),
      revenue_pct: round2(d30.revenue_pct),
      engagementRate_diff: round2(d30.engagementRate_diff),
      avgSessionDuration_diff: round2(d30.avgSessionDuration_diff),
      bounceRate_diff: round2(d30.bounceRate_diff),
    },
  };
}

function buildTopChannels(channelsTop, topNCount) {
  return compactArray(
    (Array.isArray(channelsTop) ? channelsTop : []).map((x) => ({
      channel: x.channel,
      users: x.users,
      sessions: x.sessions,
      conversions: x.conversions,
      revenue: round2(x.revenue),
      newUsers: x.newUsers,
      engagedSessions: x.engagedSessions,
      engagementRate: round2(x.engagementRate),
      sessionsPerUser: round2(x.sessionsPerUser),
      conversionRate: round2(x.conversionRate),
      revenuePerSession: round2(x.revenuePerSession),
    })),
    topNCount
  );
}

function buildTopDevices(devicesTop, topNCount) {
  return compactArray(
    (Array.isArray(devicesTop) ? devicesTop : []).map((x) => ({
      device: x.device,
      users: x.users,
      sessions: x.sessions,
      conversions: x.conversions,
      revenue: round2(x.revenue),
      engagedSessions: x.engagedSessions,
      engagementRate: round2(x.engagementRate),
      sessionsPerUser: round2(x.sessionsPerUser),
      conversionRate: round2(x.conversionRate),
      revenuePerSession: round2(x.revenuePerSession),
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
      engagedSessions: x.engagedSessions,
      engagementRate: round2(x.engagementRate),
      conversionRate: round2(x.conversionRate),
      revenuePerSession: round2(x.revenuePerSession),
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
      engagedSessions: x.engagedSessions,
      engagementRate: round2(x.engagementRate),
      conversionRate: round2(x.conversionRate),
      revenuePerSession: round2(x.revenuePerSession),
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
      revenue: round2(x.revenue),
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

function trimDailyRows(dailyRows, maxDays, explicitRange) {
  const rows = sortByDateAsc(Array.isArray(dailyRows) ? dailyRows : []);
  if (!rows.length) return [];

  const explicitTo = nonEmptyStr(explicitRange?.to || explicitRange?.until) || null;
  const latestDate = explicitTo || rows[rows.length - 1]?.date || null;
  if (!latestDate) return rows.slice(-Math.max(1, maxDays));

  const startDate = addDaysYmd(latestDate, -(Math.max(1, maxDays) - 1));
  const filtered = rows.filter((r) => r.date >= startDate && r.date <= latestDate);

  const meaningful = filtered.filter(isMeaningfulDailyRow);

  if (meaningful.length > 0) {
    return meaningful.slice(-Math.max(1, maxDays));
  }

  return filtered.slice(-Math.min(Math.max(1, maxDays), 7));
}

function trendWord(cur, prev) {
  const a = toNum(cur);
  const b = toNum(prev);

  if (a > b) return 'up';
  if (a < b) return 'down';
  return 'flat';
}

function buildDailyTrendPack(dailyRows, maxDays, explicitRange) {
  const rows = trimDailyRows(dailyRows, maxDays, explicitRange);

  let prev = null;
  return rows.map((r) => {
    const row = {
      date: r.date,
      users: r.users,
      sessions: r.sessions,
      conversions: r.conversions,
      revenue: round2(r.revenue),
      engagementRate: round2(r.engagementRate),
      avgSessionDuration: round2(r.avgSessionDuration),
      bounceRate: round2(r.bounceRate),
    };

    if (prev) {
      row.sessions_trend = trendWord(r.sessions, prev.sessions);
      row.revenue_trend = trendWord(r.revenue, prev.revenue);
      row.conversions_trend = trendWord(r.conversions, prev.conversions);
      row.engagement_trend = trendWord(r.engagementRate, prev.engagementRate);
    }

    prev = r;
    return row;
  });
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
      insights: uniqStrings(optimizationSignalsRaw.insights, 10),
      recommendations: uniqStrings(optimizationSignalsRaw.recommendations, 10),
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
      engagementRate: round2(bestLanding.engagementRate),
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
      engagementRate: round2(bestSourceMedium.engagementRate),
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
    out.recommendations.push('There is traffic but no conversions recorded; audit event mapping and conversion flow.');
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
    insights: uniqStrings(out.insights, 10),
    recommendations: uniqStrings(out.recommendations, 10),
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
    positives: uniqStrings(positives, 8),
    negatives: uniqStrings(negatives, 8),
    actions: uniqStrings(actions, 10),
  };
}

function buildLlmHints(payload) {
  const hints = [];

  const headline = payload?.headline_kpis || {};
  const channels = payload?.top_channels || [];
  const devices = payload?.top_devices || [];
  const landingPages = payload?.top_landing_pages || [];
  const sourceMedium = payload?.top_source_medium || [];
  const risks = payload?.optimization_signals?.risks || [];

  if (toNum(headline.sessions) > 0) {
    hints.push('Focus on sessions, conversions, revenue, engagement rate, landing pages, and channel quality.');
  }

  if (toNum(headline.conversions) > 0) {
    hints.push('Prioritize conversion-driving channels, landing pages, and device categories.');
  }

  if (toNum(headline.revenue) > 0) {
    hints.push('Use revenue per session and conversion patterns to identify the strongest business drivers.');
  }

  if (toNum(headline.engagementRate) > 0 && toNum(headline.engagementRate) < 45) {
    hints.push('Low engagement may indicate landing page mismatch, weak traffic quality, or tracking issues.');
  }

  if (channels.length > 0) {
    hints.push(`Use "${channels[0].channel}" as the reference point for the strongest GA4 channel cluster.`);
  }

  if (devices.length > 0) {
    hints.push(`Check whether "${devices[0].device}" dominates sessions and conversions, then validate UX quality on that device.`);
  }

  if (landingPages.length > 0) {
    hints.push('Top landing pages should be audited for conversion efficiency, not just traffic volume.');
  }

  if (sourceMedium.length > 0) {
    hints.push('Source / medium performance should be used to validate whether acquisition quality matches business outcomes.');
  }

  if (risks.length > 0) {
    hints.push('Review risk areas first because they may be hiding funnel or tracking inefficiencies.');
  }

  return uniqStrings(hints, 10);
}

function buildDataQuality(meta, datasets, payload, contextRangeDays) {
  const properties = Array.isArray(meta?.properties) ? meta.properties : [];
  const range = normalizeRange(meta?.range || {});
  const dsNames = (Array.isArray(datasets) ? datasets : []).map((d) => nonEmptyStr(d?.dataset)).filter(Boolean);

  return {
    hasAnyData:
      dsNames.length > 0 ||
      toNum(payload?.headline_kpis?.sessions) > 0 ||
      toNum(payload?.headline_kpis?.users) > 0,
    propertyCount: properties.length,
    range,
    storageRangeDays: toNum(meta?.storageRangeDays) || null,
    contextRangeDays: toNum(contextRangeDays) || toNum(meta?.contextRangeDays) || null,
    windowType: nonEmptyStr(meta?.windowType) || 'context',
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

function buildKpiDefinitions() {
  return {
    acquisition_traffic: [
      'users',
      'newUsers',
      'sessions',
      'sessionsPerUser',
    ],
    engagement_quality: [
      'engagedSessions',
      'engagementRate',
      'avgSessionDuration',
      'bounceRate',
    ],
    conversion_revenue: [
      'conversions',
      'conversionRate',
      'revenue',
      'revenuePerUser',
      'revenuePerSession',
    ],
    structure_segmentation: [
      'property_id',
      'property_name',
      'channel',
      'device',
      'landing_page',
      'source',
      'medium',
      'event',
    ],
  };
}

function formatGa4ForLlm({
  datasets = [],
  contextRangeDays = 60,
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

  const normalizedRange = normalizeRange(meta?.range || {});
  const effectiveContextRangeDays =
    clampInt(contextRangeDays || meta?.contextRangeDays || normalizedRange?.days || 30, 7, 3650);

  const headline_kpis = buildHeadlineKpis(extracted.summary);

  const top_channels = buildTopChannels(extracted.channelsTop, clampInt(topChannels, 1, 20));
  const top_devices = buildTopDevices(extracted.devicesTop, clampInt(topDevices, 1, 12));
  const top_landing_pages = buildTopLandingPages(extracted.landingPagesTop, clampInt(topLandingPages, 1, 20));
  const top_source_medium = buildTopSourceMedium(extracted.sourceMediumTop, clampInt(topSourceMedium, 1, 25));
  const top_events = buildTopEvents(extracted.eventsTop, clampInt(topEvents, 1, 25));
  const daily_trends = buildDailyTrendPack(
    extracted.dailyTrends,
    clampInt(topTrendDays || effectiveContextRangeDays, 1, 90),
    normalizedRange
  );

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
  const generatedAt = meta?.generatedAt || new Date().toISOString();

  const payload = {
    schema: 'adray.ga4.llm.v3',
    source: 'ga4',
    generatedAt,
    propertyIds: properties.map((p) => nonEmptyStr(p?.id)).filter(Boolean),
    propertyCount: properties.length,
    properties: properties.map((p) => ({
      id: nonEmptyStr(p?.id) || null,
      name: nonEmptyStr(p?.name) || null,
      currency: nonEmptyStr(p?.currencyCode) || null,
      timezone_name: nonEmptyStr(p?.timeZone) || null,
    })),
    range: normalizedRange,
    context_window: {
      rangeDays: effectiveContextRangeDays,
      storageRangeDays: toNum(meta?.storageRangeDays) || null,
      windowType: nonEmptyStr(meta?.windowType) || 'context',
    },
    kpi_definitions: buildKpiDefinitions(),
    headline_kpis,
    comparison_windows: extracted.summary?.windows || {},
    top_channels,
    top_devices,
    top_landing_pages,
    top_source_medium,
    top_events,
    optimization_signals,
    daily_trends,
    priority_summary,
  };

  payload.llm_hints = buildLlmHints(payload);
  payload.data_quality = buildDataQuality(meta, datasets, payload, effectiveContextRangeDays);

  return {
    ga4: payload,
    meta: {
      snapshotId: snapshotId || null,
      chunkCount: Array.isArray(datasets) ? datasets.length : 0,
      datasets: (Array.isArray(datasets) ? datasets : []).map((d) => nonEmptyStr(d?.dataset)).filter(Boolean),
    },
  };
}

function formatGa4ForLlmMini({
  datasets = [],
  contextRangeDays = 60,
  topChannels = 5,
  topDevices = 4,
  topLandingPages = 5,
  topEvents = 6,
} = {}) {
  const full = formatGa4ForLlm({
    datasets,
    contextRangeDays,
    topChannels: Math.max(topChannels, 5),
    topDevices: Math.max(topDevices, 4),
    topLandingPages: Math.max(topLandingPages, 5),
    topSourceMedium: 6,
    topEvents: Math.max(topEvents, 6),
    topTrendDays: Math.min(Math.max(14, contextRangeDays), 30),
  });

  const payload = full?.ga4 || {};
  const meta = full?.meta || {};

  return {
    data: {
      schema: payload.schema,
      source: payload.source,
      generatedAt: payload.generatedAt,
      propertyIds: payload.propertyIds || [],
      propertyCount: payload.propertyCount || 0,
      properties: payload.properties || [],
      range: payload.range || null,
      context_window: payload.context_window || null,
      data_quality: payload.data_quality || null,
      kpi_definitions: payload.kpi_definitions || {},
      headline_kpis: payload.headline_kpis || {},
      top_channels: compactArray(payload.top_channels || [], 5),
      top_devices: compactArray(payload.top_devices || [], 4),
      top_landing_pages: compactArray(payload.top_landing_pages || [], 5),
      top_source_medium: compactArray(payload.top_source_medium || [], 6),
      top_events: compactArray(payload.top_events || [], 6),
      optimization_signals: {
        winners: compactArray(payload?.optimization_signals?.winners || [], 4),
        risks: compactArray(payload?.optimization_signals?.risks || [], 4),
        quick_wins: compactArray(payload?.optimization_signals?.quick_wins || [], 4),
        insights: compactArray(payload?.optimization_signals?.insights || [], 6),
        recommendations: compactArray(payload?.optimization_signals?.recommendations || [], 6),
      },
      priority_summary: {
        positives: compactArray(payload?.priority_summary?.positives || [], 5),
        negatives: compactArray(payload?.priority_summary?.negatives || [], 5),
        actions: compactArray(payload?.priority_summary?.actions || [], 6),
      },
      llm_hints: compactArray(payload?.llm_hints || [], 6),
    },
    meta,
  };
}

module.exports = {
  formatGa4ForLlm,
  formatGa4ForLlmMini,
};