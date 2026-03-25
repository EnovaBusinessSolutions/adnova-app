'use strict';

const {
  isSnapshotFirstEnabledForTool,
  isBackgroundRefreshEnabled,
  getRefreshDebounceMs,
} = require('./config');

const { createToolResponse } = require('../schemas/errors');

function loadQueueHelpers() {
  try {
    return require('../../queues/mcpQueue');
  } catch {
    return null;
  }
}

/** @type {Map<string, number>} */
const lastRefreshEnqueueAt = new Map();

function logMcpToolSource(payload) {
  try {
    console.log(
      JSON.stringify({
        mcp_tool_source: true,
        ts: new Date().toISOString(),
        ...payload,
      })
    );
  } catch (e) {
    console.log('[mcp_snapshot] log failed', e?.message);
  }
}

function refreshKey(userId, sourceKey) {
  return `${String(userId)}:${sourceKey}`;
}

async function maybeEnqueueBackgroundCollect(userId, sourceKey) {
  if (!isBackgroundRefreshEnabled()) return;
  const q = loadQueueHelpers();
  if (!q?.enqueueMetaCollectBestEffort || !q?.enqueueGoogleAdsCollectBestEffort) return;

  const key = refreshKey(userId, sourceKey);
  const now = Date.now();
  const deb = getRefreshDebounceMs();
  const prev = lastRefreshEnqueueAt.get(key) || 0;
  if (now - prev < deb) return;
  lastRefreshEnqueueAt.set(key, now);

  if (sourceKey === 'metaAds') {
    await q.enqueueMetaCollectBestEffort({
      userId,
      reason: 'mcp_snapshot_stale_read',
      rangeDays: 60,
    });
  } else if (sourceKey === 'googleAds') {
    await q.enqueueGoogleAdsCollectBestEffort({
      userId,
      reason: 'mcp_snapshot_stale_read',
      rangeDays: 60,
    });
  }
}

/**
 * Core snapshot-first resolution (returns plain data). Used by tools and aggregations.
 */
async function resolveSnapshotFirstData({
  toolName,
  userId,
  buildSnapshot,
  execLive,
  refreshSource = null,
}) {
  const t0 = Date.now();
  const baseLog = {
    tool: toolName,
    userId: String(userId),
  };

  if (!isSnapshotFirstEnabledForTool(toolName)) {
    const data = await execLive();
    logMcpToolSource({
      ...baseLog,
      source_mode: 'live',
      latency_ms: Date.now() - t0,
      snapshot_first: 'disabled',
    });
    return data;
  }

  let snap = null;
  try {
    snap = await buildSnapshot();
  } catch (e) {
    console.warn(`[${toolName}] snapshot build error:`, e?.message || e);
  }

  if (snap?.ok && snap.data) {
    if (snap.fresh) {
      logMcpToolSource({
        ...baseLog,
        source_mode: 'snapshot_fresh',
        snapshot_id: snap.snapshot_id || null,
        snapshot_age_min: snap.snapshot_age_min,
        latency_ms: Date.now() - t0,
        partial_coverage: !!snap.partial_coverage,
        snapshot_first: '1',
      });
      return snap.data;
    }

    try {
      const data = await execLive();
      logMcpToolSource({
        ...baseLog,
        source_mode: 'live',
        latency_ms: Date.now() - t0,
        snapshot_stale: true,
        snapshot_first: '1',
      });
      return data;
    } catch (err) {
      logMcpToolSource({
        ...baseLog,
        source_mode: 'live_fallback',
        snapshot_id: snap.snapshot_id || null,
        snapshot_age_min: snap.snapshot_age_min,
        live_error: String(err?.message || err),
        latency_ms: Date.now() - t0,
        partial_coverage: !!snap.partial_coverage,
        snapshot_first: '1',
      });
      if (refreshSource) {
        await maybeEnqueueBackgroundCollect(userId, refreshSource);
      }
      return snap.data;
    }
  }

  try {
    const data = await execLive();
    logMcpToolSource({
      ...baseLog,
      source_mode: 'live',
      latency_ms: Date.now() - t0,
      reason: 'no_snapshot',
      snapshot_first: '1',
    });
    return data;
  } catch (liveErr) {
    logMcpToolSource({
      ...baseLog,
      source_mode: 'live_error_no_snapshot',
      live_error: String(liveErr?.message || liveErr),
      latency_ms: Date.now() - t0,
      reason: 'no_snapshot',
      snapshot_first: '1',
    });
    if (refreshSource) {
      await maybeEnqueueBackgroundCollect(userId, refreshSource);
    }
    throw liveErr;
  }
}

/**
 * Snapshot-first orchestration: fresh snapshot short-circuits live; stale tries live then falls back to snapshot.
 */
async function runSnapshotFirstTool(opts) {
  const t0 = Date.now();
  const baseLog = {
    tool: opts.toolName,
    userId: String(opts.userId),
  };
  try {
    let data;
    try {
      data = await resolveSnapshotFirstData(opts);
    } catch (resolveErr) {
      if (resolveErr?.code === 'ACCOUNT_NOT_CONNECTED') throw resolveErr;
      if (typeof opts.emptyFallback === 'function') {
        logMcpToolSource({
          ...baseLog,
          source_mode: 'empty_fallback',
          live_error: String(resolveErr?.message || resolveErr),
          latency_ms: Date.now() - t0,
          snapshot_first: isSnapshotFirstEnabledForTool(opts.toolName) ? '1' : 'disabled',
        });
        data = opts.emptyFallback();
      } else {
        throw resolveErr;
      }
    }
    return createToolResponse(data);
  } catch (err) {
    logMcpToolSource({
      ...baseLog,
      source_mode: 'error',
      latency_ms: Date.now() - t0,
      error: String(err?.message || err),
      snapshot_first: '1',
    });
    throw err;
  }
}

module.exports = {
  runSnapshotFirstTool,
  resolveSnapshotFirstData,
  logMcpToolSource,
  maybeEnqueueBackgroundCollect,
};
