'use strict';

const logger = require('./logger');

function safeStr(value) {
  return value == null ? '' : String(value);
}

function cleanMeta(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value
      .map((item) => cleanMeta(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value !== 'object') {
    return value;
  }

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const cleaned = cleanMeta(entry);
    if (cleaned !== undefined) {
      out[key] = cleaned;
    }
  }
  return out;
}

function summarizeSourceState(state = {}) {
  return cleanMeta({
    connected: !!state?.connected,
    ready: !!state?.ready,
    usable: !!state?.usable,
    snapshotId: state?.snapshotId || null,
    chunkCount: Number(state?.chunkCount || 0),
    missingRequired: Array.isArray(state?.missingRequired) ? state.missingRequired : [],
    datasets: Array.isArray(state?.datasets) ? state.datasets : [],
    lastError: state?.lastError || null,
    pendingReason: state?.pendingReason || null,
    blockingReasons: Array.isArray(state?.blockingReasons) ? state.blockingReasons : [],
  });
}

function summarizeSourcesStatus(sourcesStatus = {}) {
  const out = {};
  for (const [sourceName, state] of Object.entries(sourcesStatus || {})) {
    out[sourceName] = summarizeSourceState(state);
  }
  return out;
}

function toErrorMeta(error) {
  if (!error) return null;

  return cleanMeta({
    message: safeStr(error?.message || error).trim() || 'UNKNOWN_ERROR',
    code: safeStr(error?.code).trim() || null,
    stack: safeStr(error?.stack).trim() || null,
  });
}

function logMcpContext(level, scope, event, meta = {}) {
  const fn = logger[level] || logger.info;
  fn(`[${scope}] ${event}`, cleanMeta(meta));
}

module.exports = {
  logMcpContext,
  summarizeSourcesStatus,
  summarizeSourceState,
  toErrorMeta,
};
