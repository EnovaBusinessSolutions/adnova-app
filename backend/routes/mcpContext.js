'use strict';

const express = require('express');
const router = express.Router();

const McpData = require('../models/McpData');
const {
  findRoot,
  buildUnifiedContextForUser,
  updateRootContextState,
  makeShareToken,
} = require('../services/mcpContextBuilder');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function buildShareVersion(root) {
  const state = root?.aiContext || {};
  const snapshotId = safeStr(state?.snapshotId || root?.latestSnapshotId || '');
  const finishedAt = safeStr(state?.finishedAt || '');
  const sourceSnapshots = state?.sourceSnapshots || {};
  const metaSnap = safeStr(sourceSnapshots?.metaAds || '');
  const googleSnap = safeStr(sourceSnapshots?.googleAds || '');
  const ga4Snap = safeStr(sourceSnapshots?.ga4 || '');

  return [
    snapshotId,
    finishedAt,
    metaSnap,
    googleSnap,
    ga4Snap,
  ].filter(Boolean).join('|') || String(Date.now());
}

function setNoCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  res.set('Vary', 'Accept-Encoding');
}

async function findRootByShareToken(token) {
  if (!token) return null;

  return McpData.findOne({
    kind: 'root',
    'aiContext.shareToken': token,
    'aiContext.shareEnabled': true,
  }).lean();
}

function buildStatusResponse(root) {
  const state = root?.aiContext || {};

  return {
    ok: true,
    data: {
      status: state?.status || 'idle',
      progress: toNum(state?.progress, 0),
      stage: state?.stage || 'idle',
      startedAt: state?.startedAt || null,
      finishedAt: state?.finishedAt || null,
      snapshotId: state?.snapshotId || root?.latestSnapshotId || null,
      sourceSnapshots: state?.sourceSnapshots || state?.unifiedBase?.sourceSnapshots || null,
      contextRangeDays: toNum(state?.contextRangeDays) || null,
      storageRangeDays: toNum(state?.storageRangeDays) || null,
      hasEncodedPayload: !!state?.encodedPayload,
      providerAgnostic: !!state?.encodedPayload?.providerAgnostic,
      usedOpenAI: !!state?.usedOpenAI,
      model: state?.model || null,
      error: state?.error || null,
      sources: state?.sourcesStatus || null,
      usableSources: Array.isArray(state?.usableSources) ? state.usableSources : [],
      pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : [],
      hasShareLink: !!(state?.shareEnabled && state?.shareToken),
      shareUrl: state?.shareEnabled ? state?.shareUrl || null : null,
      shareVersion: state?.shareVersion || null,
    },
  };
}

function buildSharedPayload(root, provider) {
  const state = root?.aiContext || {};
  const payload = state?.encodedPayload || null;
  if (!payload) return null;

  const providerName =
    provider === 'claude' ? 'Claude' :
    provider === 'gemini' ? 'Gemini' :
    'ChatGPT';

  return {
    ok: true,
    data: payload,
    meta: {
      schema: payload?.schema || 'adray.encoded.context.v2',
      provider: provider || 'chatgpt',
      providerLabel: providerName,
      snapshotId: state?.snapshotId || root?.latestSnapshotId || null,
      sourceSnapshots: state?.sourceSnapshots || payload?.sourceSnapshots || null,
      generatedAt: state?.finishedAt || payload?.generatedAt || null,
      contextRangeDays: toNum(state?.contextRangeDays) || null,
      storageRangeDays: toNum(state?.storageRangeDays) || null,
      providerAgnostic: !!payload?.providerAgnostic,
      usedOpenAI: !!state?.usedOpenAI,
      model: state?.model || null,
      shareVersion: state?.shareVersion || null,
    },
  };
}

/**
 * POST /api/mcp/context/build
 */
router.post('/build', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const result = await buildUnifiedContextForUser(userId, {
      explicitSnapshotId: safeStr(req.body?.snapshotId) || null,
      contextRangeDays: req.body?.contextRangeDays || null,
    });

    return res.json({
      ok: true,
      data: result?.data || null,
    });
  } catch (e) {
    console.error('[mcp/context/build] error:', e);

    try {
      const userId = req.user?._id;
      if (userId) {
        const root = await findRoot(userId);
        if (root?._id) {
          await updateRootContextState(userId, {
            aiContext: {
              ...(root?.aiContext || {}),
              status: 'error',
              progress: 100,
              stage: 'failed',
              finishedAt: nowIso(),
              error: e?.message || e?.code || 'MCP_CONTEXT_BUILD_FAILED',
            },
          });
        }
      }
    } catch (_) {}

    const code = e?.code || e?.message || 'MCP_CONTEXT_BUILD_FAILED';

    if (code === 'MCP_ROOT_NOT_FOUND') {
      return res.status(404).json({ ok: false, error: code });
    }

    if (code === 'MCP_CONTEXT_NO_USABLE_SOURCES') {
      return res.status(409).json({
        ok: false,
        error: code,
        data: e?.data || null,
      });
    }

    return res.status(500).json({
      ok: false,
      error: 'MCP_CONTEXT_BUILD_FAILED',
    });
  }
});

/**
 * GET /api/mcp/context/status
 */
router.get('/status', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    setNoCacheHeaders(res);
    return res.json(buildStatusResponse(root));
  } catch (e) {
    console.error('[mcp/context/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_STATUS_FAILED' });
  }
});

/**
 * GET /api/mcp/context/latest
 */
router.get('/latest', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    if (!state?.encodedPayload) {
      return res.status(404).json({
        ok: false,
        error: 'MCP_CONTEXT_NOT_READY',
        data: {
          status: state?.status || 'idle',
          progress: state?.progress || 0,
          stage: state?.stage || 'idle',
        },
      });
    }

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: state.encodedPayload,
      meta: {
        status: state?.status || 'done',
        progress: state?.progress || 100,
        stage: state?.stage || 'completed',
        snapshotId: state?.snapshotId || root?.latestSnapshotId || null,
        sourceSnapshots: state?.sourceSnapshots || state?.encodedPayload?.sourceSnapshots || null,
        contextRangeDays: toNum(state?.contextRangeDays) || null,
        storageRangeDays: toNum(state?.storageRangeDays) || null,
        usedOpenAI: !!state?.usedOpenAI,
        model: state?.model || null,
        generatedAt: state?.finishedAt || null,
        shareVersion: state?.shareVersion || null,
      },
    });
  } catch (e) {
    console.error('[mcp/context/latest] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LATEST_FAILED' });
  }
});

/**
 * POST /api/mcp/context/link
 */
router.post('/link', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const providerRaw = safeStr(req.body?.provider).toLowerCase();
    const provider =
      providerRaw === 'claude' || providerRaw === 'gemini' || providerRaw === 'chatgpt'
        ? providerRaw
        : 'chatgpt';

    const regenerate = req.body?.regenerate === true;

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    if (!state?.encodedPayload) {
      return res.status(404).json({ ok: false, error: 'MCP_CONTEXT_NOT_READY' });
    }

    const currentShareVersion = buildShareVersion(root);

    let shareToken = state?.shareToken || null;
    const mustRotateToken =
      regenerate ||
      !shareToken ||
      safeStr(state?.shareVersion) !== safeStr(currentShareVersion);

    if (mustRotateToken) {
      shareToken = makeShareToken();
    }

    const shareUrl = `${APP_URL}/api/mcp/context/shared/${shareToken}?provider=${encodeURIComponent(provider)}&v=${encodeURIComponent(currentShareVersion)}`;

    await updateRootContextState(userId, {
      aiContext: {
        ...state,
        shareToken,
        shareEnabled: true,
        shareProvider: provider,
        shareUrl,
        shareVersion: currentShareVersion,
        shareCreatedAt: mustRotateToken
          ? nowIso()
          : (state?.shareCreatedAt || nowIso()),
        shareLastGeneratedAt: nowIso(),
        shareRevokedAt: null,
      },
    });

    return res.json({
      ok: true,
      data: {
        provider,
        shareToken,
        shareUrl,
        enabled: true,
        shareVersion: currentShareVersion,
        rotated: !!mustRotateToken,
      },
    });
  } catch (e) {
    console.error('[mcp/context/link] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LINK_CREATE_FAILED' });
  }
});

/**
 * GET /api/mcp/context/link
 */
router.get('/link', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    const shareToken = state?.shareToken || null;
    const shareUrl = state?.shareEnabled ? state?.shareUrl || null : null;

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: {
        enabled: !!(state?.shareEnabled && shareToken),
        shareToken,
        shareUrl,
        provider: state?.shareProvider || 'chatgpt',
        createdAt: state?.shareCreatedAt || null,
        lastGeneratedAt: state?.shareLastGeneratedAt || null,
        shareVersion: state?.shareVersion || null,
      },
    });
  } catch (e) {
    console.error('[mcp/context/link:get] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LINK_READ_FAILED' });
  }
});

/**
 * GET /api/mcp/context/shared/:token
 */
router.get('/shared/:token', async (req, res) => {
  try {
    const token = safeStr(req.params?.token).trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'MISSING_TOKEN' });
    }

    const providerRaw = safeStr(req.query?.provider).toLowerCase();
    const provider =
      providerRaw === 'claude' || providerRaw === 'gemini' || providerRaw === 'chatgpt'
        ? providerRaw
        : 'chatgpt';

    const root = await findRootByShareToken(token);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    if (!state?.encodedPayload) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_READY' });
    }

    setNoCacheHeaders(res);
    return res.json(buildSharedPayload(root, provider));
  } catch (e) {
    console.error('[mcp/context/shared] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_SHARED_FAILED' });
  }
});

module.exports = router;