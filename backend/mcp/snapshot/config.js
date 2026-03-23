'use strict';

/**
 * Feature flags and freshness policy for MCP snapshot-first reads.
 * Env:
 * - MCP_SNAPSHOT_FIRST_ENABLED: global kill-switch (default false)
 * - MCP_SNAPSHOT_FIRST_TOOLS: comma-separated tool names (empty = all when enabled)
 * - MCP_SNAPSHOT_MAX_AGE_MIN: max age in minutes for "fresh" snapshots (default 360)
 * - MCP_SNAPSHOT_BACKGROUND_REFRESH: enqueue mcp-collect on stale reads (default false)
 * - MCP_SNAPSHOT_REFRESH_DEBOUNCE_MS: min ms between background enqueues per user+source (default 300000)
 */

const DEFAULT_MAX_AGE_MIN = 360;
const DEFAULT_DEBOUNCE_MS = 300_000;

function truthy(v) {
  if (v == null || v === '') return false;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function parseToolsList(raw) {
  if (!raw || !String(raw).trim()) return null;
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isSnapshotFirstGloballyEnabled() {
  return truthy(process.env.MCP_SNAPSHOT_FIRST_ENABLED);
}

function getSnapshotFirstToolsSet() {
  return parseToolsList(process.env.MCP_SNAPSHOT_FIRST_TOOLS || '');
}

function isSnapshotFirstEnabledForTool(toolName) {
  if (!isSnapshotFirstGloballyEnabled()) return false;
  const set = getSnapshotFirstToolsSet();
  if (!set || set.size === 0) return true;
  return set.has(String(toolName || '').trim());
}

function getSnapshotMaxAgeMinutes() {
  const n = Number(process.env.MCP_SNAPSHOT_MAX_AGE_MIN);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_AGE_MIN;
  return Math.min(Math.trunc(n), 10080); // cap 7d
}

function isBackgroundRefreshEnabled() {
  return truthy(process.env.MCP_SNAPSHOT_BACKGROUND_REFRESH);
}

function getRefreshDebounceMs() {
  const n = Number(process.env.MCP_SNAPSHOT_REFRESH_DEBOUNCE_MS);
  if (!Number.isFinite(n) || n < 10_000) return DEFAULT_DEBOUNCE_MS;
  return Math.min(Math.trunc(n), 86_400_000);
}

module.exports = {
  isSnapshotFirstGloballyEnabled,
  isSnapshotFirstEnabledForTool,
  getSnapshotMaxAgeMinutes,
  isBackgroundRefreshEnabled,
  getRefreshDebounceMs,
  DEFAULT_MAX_AGE_MIN,
};
