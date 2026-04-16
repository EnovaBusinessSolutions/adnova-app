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
    root?.workspaceName,
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
