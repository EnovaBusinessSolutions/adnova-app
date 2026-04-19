'use strict';

function safeStr(v) {
  return v == null ? '' : String(v);
}

function nowIso() {
  return new Date().toISOString();
}

function toSerializable(value, fallback = null) {
  if (value == null) return fallback;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function uniqStrings(values, limit = 20) {
  const out = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const normalized = safeStr(value).trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(normalized);
    if (out.length >= limit) break;
  }

  return out;
}

function pickFirstText(...candidates) {
  for (const candidate of candidates) {
    const text = safeStr(candidate).trim();
    if (text) return text;
  }

  return '';
}

function buildEncodedContextText({
  workspaceName = '',
  generatedAt = '',
  sourceFingerprint = '',
  connectionFingerprint = '',
  contextWindow = null,
  summary = {},
  performanceDrivers = [],
  conversionBottlenecks = [],
  scalingOpportunities = [],
  riskFlags = [],
  priorityActions = [],
  existingDetailedText = '',
  dailyIndex = [],
  campaignsDailyRows = [],
  adsDailyRows = [],
  landingPagesDailyRows = [],
  anomalies = [],
  benchmarks = null,
}) {
  const lines = [
    '[ADRAY_ENCODED_SIGNAL_V1]',
    `workspace=${workspaceName || 'unknown'}`,
    `generated_at=${generatedAt || nowIso()}`,
    `source_fingerprint=${sourceFingerprint || 'n/a'}`,
    `connection_fingerprint=${connectionFingerprint || 'n/a'}`,
    `context_window=${contextWindow ? JSON.stringify(contextWindow) : 'null'}`,
    '',
    '[EXECUTIVE_SUMMARY]',
    summary?.executive_summary || 'n/a',
    '',
    '[BUSINESS_STATE]',
    summary?.business_state || 'n/a',
    '',
    '[CROSS_CHANNEL_STORY]',
    summary?.cross_channel_story || 'n/a',
  ];

  const addList = (title, list = []) => {
    lines.push('');
    lines.push(`[${title}]`);

    if (!Array.isArray(list) || list.length === 0) {
      lines.push('- n/a');
      return;
    }

    for (const item of list) {
      lines.push(`- ${item}`);
    }
  };

  addList('PERFORMANCE_DRIVERS', performanceDrivers);
  addList('CONVERSION_BOTTLENECKS', conversionBottlenecks);
  addList('SCALING_OPPORTUNITIES', scalingOpportunities);
  addList('RISK_FLAGS', riskFlags);
  addList('PRIORITY_ACTIONS', priorityActions);

  // --- DAILY INDEX (30-day day-by-day snapshot) ---
  if (Array.isArray(dailyIndex) && dailyIndex.length > 0) {
    lines.push('');
    lines.push('[DAILY_INDEX]');
    for (const row of dailyIndex.slice(0, 30)) {
      const date = row?.date || row?.day || '?';
      const parts = [];
      if (row?.meta_spend != null) parts.push(`meta_spend=${Number(row.meta_spend).toFixed(0)}`);
      if (row?.meta_roas != null) parts.push(`meta_roas=${Number(row.meta_roas).toFixed(2)}`);
      if (row?.meta_purchases != null) parts.push(`meta_purchases=${row.meta_purchases}`);
      if (row?.google_spend != null) parts.push(`google_spend=${Number(row.google_spend).toFixed(0)}`);
      if (row?.google_roas != null) parts.push(`google_roas=${Number(row.google_roas).toFixed(2)}`);
      if (row?.google_conversions != null) parts.push(`google_conv=${Number(row.google_conversions).toFixed(0)}`);
      if (row?.ga4_revenue != null) parts.push(`ga4_revenue=${Number(row.ga4_revenue).toFixed(0)}`);
      if (row?.ga4_sessions != null) parts.push(`ga4_sessions=${row.ga4_sessions}`);
      if (row?.ga4_conversions != null) parts.push(`ga4_conv=${row.ga4_conversions}`);
      if (parts.length > 0) lines.push(`- ${date}: ${parts.join(' | ')}`);
    }
  }

  // --- CAMPAIGNS DAILY (per-campaign day-by-day performance) ---
  if (Array.isArray(campaignsDailyRows) && campaignsDailyRows.length > 0) {
    lines.push('');
    lines.push('[CAMPAIGNS_DAILY]');
    for (const row of campaignsDailyRows.slice(0, 60)) {
      const name = row?.campaign_name || row?.campaign_id || '?';
      const source = row?.source ? `[${String(row.source).toUpperCase()}] ` : '';
      const date = row?.date || '?';
      const parts = [];
      if (row?.spend != null) parts.push(`spend=${Number(row.spend).toFixed(0)}`);
      if (row?.roas != null) parts.push(`roas=${Number(row.roas).toFixed(2)}`);
      if (row?.conversions != null) parts.push(`conv=${Number(row.conversions).toFixed(0)}`);
      if (row?.impressions != null) parts.push(`imp=${row.impressions}`);
      if (row?.clicks != null) parts.push(`clicks=${row.clicks}`);
      if (parts.length > 0) lines.push(`- ${source}${name} | ${date} | ${parts.join(' | ')}`);
    }
  }

  // --- ADS DAILY (per-ad day-by-day performance, top ads) ---
  if (Array.isArray(adsDailyRows) && adsDailyRows.length > 0) {
    lines.push('');
    lines.push('[ADS_DAILY]');
    for (const row of adsDailyRows.slice(0, 40)) {
      const name = row?.ad_name || row?.ad_id || '?';
      const source = row?.source ? `[${String(row.source).toUpperCase()}] ` : '';
      const date = row?.date || '?';
      const parts = [];
      if (row?.spend != null) parts.push(`spend=${Number(row.spend).toFixed(0)}`);
      if (row?.roas != null) parts.push(`roas=${Number(row.roas).toFixed(2)}`);
      if (row?.impressions != null) parts.push(`imp=${row.impressions}`);
      if (row?.clicks != null) parts.push(`clicks=${row.clicks}`);
      if (row?.ctr != null) parts.push(`ctr=${Number(row.ctr).toFixed(2)}%`);
      if (parts.length > 0) lines.push(`- ${source}${name} | ${date} | ${parts.join(' | ')}`);
    }
  }

  // --- LANDING PAGES DAILY ---
  if (Array.isArray(landingPagesDailyRows) && landingPagesDailyRows.length > 0) {
    lines.push('');
    lines.push('[LANDING_PAGES_DAILY]');
    for (const row of landingPagesDailyRows.slice(0, 30)) {
      const page = row?.page || row?.landing_page || '?';
      const date = row?.date || '?';
      const parts = [];
      if (row?.sessions != null) parts.push(`sessions=${row.sessions}`);
      if (row?.conversions != null) parts.push(`conv=${row.conversions}`);
      if (row?.revenue != null) parts.push(`revenue=${Number(row.revenue).toFixed(0)}`);
      if (row?.engagement_rate != null) parts.push(`eng=${Number(row.engagement_rate).toFixed(1)}%`);
      if (parts.length > 0) lines.push(`- ${page} | ${date} | ${parts.join(' | ')}`);
    }
  }

  // --- ANOMALIES ---
  if (Array.isArray(anomalies) && anomalies.length > 0) {
    lines.push('');
    lines.push('[ANOMALIES]');
    for (const a of anomalies.slice(0, 20)) {
      const type = a?.type ? `[${String(a.type).toUpperCase()}] ` : '';
      const metric = a?.metric || a?.field || '?';
      const desc = a?.description || a?.message || '';
      lines.push(`- ${type}${metric}: ${desc}`);
    }
  }

  // --- BENCHMARKS ---
  if (benchmarks && typeof benchmarks === 'object') {
    lines.push('');
    lines.push('[BENCHMARKS]');
    for (const [key, val] of Object.entries(benchmarks)) {
      if (!val || typeof val !== 'object') continue;
      const curr = val?.current_value != null ? Number(val.current_value).toFixed(2) : 'n/a';
      const prior = val?.prior_value != null ? Number(val.prior_value).toFixed(2) : 'n/a';
      const pct = val?.pct_change != null ? `${Number(val.pct_change).toFixed(1)}%` : 'n/a';
      const trend = val?.trend ? String(val.trend).toUpperCase() : 'n/a';
      lines.push(`- ${key}: current=${curr} | prior=${prior} | chg=${pct} | trend=${trend}`);
    }
  }

  if (existingDetailedText) {
    lines.push('');
    lines.push('[LEGACY_CONTEXT_APPENDIX]');
    lines.push(existingDetailedText);
  }

  return lines.join('\n').trim();
}

function buildEncodedContextMini({ summary = {}, priorityActions = [], existingMiniText = '' }) {
  const blocks = [
    safeStr(summary?.executive_summary).trim(),
    safeStr(summary?.business_state).trim(),
    ...uniqStrings(priorityActions, 3).map((action) => `Action: ${action}`),
    safeStr(existingMiniText).trim(),
  ].filter(Boolean);

  return blocks.join('\n').trim();
}

function encodeSignalPayload({ signalPayload, unifiedBase, root, user }) {
  const payload = signalPayload && typeof signalPayload === 'object' ? signalPayload : {};
  const structuredSignal = payload?.structured_signal && typeof payload.structured_signal === 'object'
    ? payload.structured_signal
    : null;
  const ai = root?.aiContext && typeof root.aiContext === 'object' ? root.aiContext : {};

  const generatedAt =
    safeStr(payload?.generatedAt).trim() ||
    safeStr(ai?.finishedAt).trim() ||
    nowIso();

  const sourceFingerprint =
    safeStr(payload?.sourceFingerprint).trim() ||
    safeStr(ai?.sourceFingerprint).trim() ||
    safeStr(unifiedBase?.sourceFingerprint).trim() ||
    null;

  const connectionFingerprint =
    safeStr(payload?.connectionFingerprint).trim() ||
    safeStr(ai?.connectionFingerprint).trim() ||
    safeStr(unifiedBase?.connectionFingerprint).trim() ||
    null;

  const contextWindow =
    payload?.contextWindow ||
    ai?.contextWindow ||
    unifiedBase?.contextWindow ||
    null;

  const summary = payload?.summary && typeof payload.summary === 'object'
    ? payload.summary
    : {};

  const positives = uniqStrings(summary?.positives || payload?.positives || [], 12);
  const negatives = uniqStrings(summary?.negatives || payload?.negatives || [], 12);
  const priorityActions = uniqStrings(summary?.priority_actions || payload?.priority_actions || [], 14);

  const existingDetailedText = pickFirstText(
    payload?.encoded_context,
    payload?.llm_context_block,
    payload?.signal
  );

  const existingMiniText = pickFirstText(
    payload?.encoded_context_mini,
    payload?.llm_context_block_mini
  );

  const workspaceName = pickFirstText(
    payload?.workspaceName,
    structuredSignal?.meta?.workspace_name,
    root?.workspaceName,
    root?.sources?.metaAds?.name,
    root?.sources?.googleAds?.name,
    root?.sources?.ga4?.name,
    user?.companyName,
    user?.workspaceName,
    user?.businessName,
    user?.name
  );

  const encodedContext = buildEncodedContextText({
    workspaceName,
    generatedAt,
    sourceFingerprint,
    connectionFingerprint,
    contextWindow,
    summary,
    performanceDrivers: uniqStrings(payload?.performance_drivers || [], 12),
    conversionBottlenecks: uniqStrings(payload?.conversion_bottlenecks || [], 12),
    scalingOpportunities: uniqStrings(payload?.scaling_opportunities || [], 12),
    riskFlags: uniqStrings(payload?.risk_flags || negatives || [], 12),
    priorityActions,
    existingDetailedText,
    dailyIndex: Array.isArray(structuredSignal?.daily_index) ? structuredSignal.daily_index : [],
    campaignsDailyRows: Array.isArray(structuredSignal?.campaigns_daily) ? structuredSignal.campaigns_daily : [],
    adsDailyRows: Array.isArray(structuredSignal?.ads_daily) ? structuredSignal.ads_daily : [],
    landingPagesDailyRows: Array.isArray(structuredSignal?.landing_pages_daily) ? structuredSignal.landing_pages_daily : [],
    anomalies: Array.isArray(structuredSignal?.anomalies) ? structuredSignal.anomalies : [],
    benchmarks: structuredSignal?.benchmarks && typeof structuredSignal.benchmarks === 'object'
      ? structuredSignal.benchmarks
      : null,
  });

  const encodedContextMini = buildEncodedContextMini({
    summary,
    priorityActions,
    existingMiniText,
  });

  return {
    format: 'adray.signal.encoded_payload',
    version: '1.0',
    generatedAt,
    providerAgnostic: true,
    sourceFingerprint,
    connectionFingerprint,
    contextWindow: toSerializable(contextWindow, null),

    meta: {
      rootId: safeStr(root?._id).trim() || null,
      userId: safeStr(user?._id).trim() || null,
      workspaceName: workspaceName || null,
      snapshotId: safeStr(unifiedBase?.snapshotId).trim() || null,
      schema: safeStr(unifiedBase?.schema).trim() || null,
    },

    lineage: {
      signalGeneratedAt: safeStr(payload?.generatedAt).trim() || null,
      sourceSnapshots: toSerializable(
        payload?.sourceSnapshots || ai?.sourceSnapshots || unifiedBase?.sourceSnapshots || null,
        null
      ),
      contextPolicy: toSerializable(payload?.contextPolicy || ai?.contextPolicy || unifiedBase?.contextPolicy || null, null),
    },

    signal: {
      summary: toSerializable(summary, {}),
      performance_drivers: uniqStrings(payload?.performance_drivers || [], 12),
      conversion_bottlenecks: uniqStrings(payload?.conversion_bottlenecks || [], 12),
      scaling_opportunities: uniqStrings(payload?.scaling_opportunities || [], 12),
      risk_flags: uniqStrings(payload?.risk_flags || negatives || [], 12),
      prompt_hints: uniqStrings(payload?.prompt_hints || [], 20),
      channel_story: toSerializable(payload?.channel_story || null, null),
      structured_signal: toSerializable(
        structuredSignal || {
          schema: payload?.schema || null,
          meta: payload?.meta || null,
          daily_index: payload?.daily_index || [],
          campaigns: payload?.campaigns || [],
          anomalies: payload?.anomalies || [],
          benchmarks: payload?.benchmarks || null,
        },
        null
      ),
    },

    blocks: {
      encoded_context: encodedContext,
      encoded_context_mini: encodedContextMini || encodedContext,
    },

    encoded_context: encodedContext,
    encoded_context_mini: encodedContextMini || encodedContext,
  };
}

function extractEncodedSignalText(encodedPayload) {
  if (!encodedPayload || typeof encodedPayload !== 'object') return '';

  return pickFirstText(
    encodedPayload?.blocks?.encoded_context,
    encodedPayload?.encoded_context,
    encodedPayload?.blocks?.encoded_context_mini,
    encodedPayload?.encoded_context_mini,
    encodedPayload?.llm_context_block,
    encodedPayload?.llm_context_block_mini
  );
}

function isEncodedSignalPayloadBuildableForPdf(encodedPayload) {
  if (!encodedPayload || typeof encodedPayload !== 'object') return false;

  const text = extractEncodedSignalText(encodedPayload);
  if (!text) return false;

  const format = safeStr(encodedPayload?.format).trim();
  const version = safeStr(encodedPayload?.version).trim();
  const hasExpectedMetadata = Boolean(format && version);

  return text.length >= 80 && hasExpectedMetadata;
}

module.exports = {
  encodeSignalPayload,
  isEncodedSignalPayloadBuildableForPdf,
  extractEncodedSignalText,
};
