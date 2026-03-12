'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const McpData = require('../models/McpData');
const {
  findRoot,
  buildUnifiedContextForUser,
  updateRootContextState,
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

function makeShortShareToken() {
  return crypto.randomBytes(8).toString('base64url');
}

function setNoCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  res.set('Vary', 'Accept-Encoding');
}

function buildApiShareUrl(token, provider = 'chatgpt') {
  return `${APP_URL}/api/mcp/context/shared/${encodeURIComponent(token)}?provider=${encodeURIComponent(provider)}`;
}

function buildShortShareUrl(token) {
  return `${APP_URL}/s/${encodeURIComponent(token)}`;
}

/**
 * Busca el owner del token y luego devuelve el latest root real del usuario.
 * Esto garantiza que el mismo link corto siempre sirva el contexto universal más reciente.
 */
async function findLatestRootByShareToken(token) {
  const cleanToken = safeStr(token).trim();
  if (!cleanToken) return null;

  const ownerRoot = await McpData.findOne({
    kind: 'root',
    'aiContext.shareToken': cleanToken,
    'aiContext.shareEnabled': true,
  })
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();

  if (!ownerRoot?.userId) return null;

  const latestRoot = await findRoot(ownerRoot.userId);
  if (!latestRoot) return null;

  return latestRoot;
}

async function clearDuplicateShareTokensForUser(userId, keepRootId, token) {
  const cleanToken = safeStr(token).trim();
  if (!userId || !keepRootId || !cleanToken) return;

  await McpData.updateMany(
    {
      userId,
      kind: 'root',
      _id: { $ne: keepRootId },
      'aiContext.shareToken': cleanToken,
    },
    {
      $set: {
        'aiContext.shareEnabled': false,
        'aiContext.shareToken': null,
        'aiContext.shareUrl': null,
        'aiContext.shareShortUrl': null,
        'aiContext.shareApiUrl': null,
        'aiContext.shareRevokedAt': nowIso(),
      },
    }
  );
}

async function revokeAllShareTokensForUser(userId, token = null) {
  const query = {
    userId,
    kind: 'root',
  };

  const cleanToken = safeStr(token).trim();
  if (cleanToken) {
    query['aiContext.shareToken'] = cleanToken;
  } else {
    query['aiContext.shareEnabled'] = true;
  }

  await McpData.updateMany(
    query,
    {
      $set: {
        'aiContext.shareEnabled': false,
        'aiContext.shareToken': null,
        'aiContext.shareUrl': null,
        'aiContext.shareShortUrl': null,
        'aiContext.shareApiUrl': null,
        'aiContext.shareRevokedAt': nowIso(),
      },
    }
  );
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
      shareUrl: state?.shareEnabled ? (state?.shareUrl || state?.shareShortUrl || null) : null,
      shareShortUrl: state?.shareEnabled ? (state?.shareShortUrl || state?.shareUrl || null) : null,
      shareApiUrl: state?.shareEnabled ? state?.shareApiUrl || null : null,
      shareToken: state?.shareEnabled ? state?.shareToken || null : null,
      shareProvider: state?.shareProvider || 'chatgpt',
      shareCreatedAt: state?.shareCreatedAt || null,
      shareRevokedAt: state?.shareRevokedAt || null,
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
      },
    });
  } catch (e) {
    console.error('[mcp/context/latest] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LATEST_FAILED' });
  }
});

/**
 * POST /api/mcp/context/link
 * Crea el primer link si no existe.
 * Si ya existe uno activo, devuelve el mismo.
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

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    if (!state?.encodedPayload) {
      return res.status(404).json({ ok: false, error: 'MCP_CONTEXT_NOT_READY' });
    }

    let shareToken = safeStr(state?.shareToken).trim() || null;
    const alreadyActive = !!(state?.shareEnabled && shareToken);

    if (!alreadyActive) {
      shareToken = makeShortShareToken();
    }

    const shareShortUrl = buildShortShareUrl(shareToken);
    const shareApiUrl = buildApiShareUrl(shareToken, provider);

    await updateRootContextState(userId, {
      aiContext: {
        ...state,
        shareToken,
        shareEnabled: true,
        shareProvider: provider,
        shareUrl: shareShortUrl,
        shareShortUrl,
        shareApiUrl,
        shareCreatedAt: alreadyActive ? (state?.shareCreatedAt || nowIso()) : nowIso(),
        shareLastGeneratedAt: nowIso(),
        shareRevokedAt: null,
      },
    });

    await clearDuplicateShareTokensForUser(userId, root?._id, shareToken);

    return res.json({
      ok: true,
      data: {
        provider,
        shareToken,
        shareUrl: shareShortUrl,
        shareShortUrl,
        shareApiUrl,
        enabled: true,
        created: !alreadyActive,
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
    const shareUrl = state?.shareEnabled ? (state?.shareUrl || state?.shareShortUrl || null) : null;
    const shareShortUrl = state?.shareEnabled ? (state?.shareShortUrl || state?.shareUrl || null) : null;
    const shareApiUrl = state?.shareEnabled ? state?.shareApiUrl || null : null;

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: {
        enabled: !!(state?.shareEnabled && shareToken),
        shareToken,
        shareUrl,
        shareShortUrl,
        shareApiUrl,
        provider: state?.shareProvider || 'chatgpt',
        createdAt: state?.shareCreatedAt || null,
        lastGeneratedAt: state?.shareLastGeneratedAt || null,
        revokedAt: state?.shareRevokedAt || null,
      },
    });
  } catch (e) {
    console.error('[mcp/context/link:get] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LINK_READ_FAILED' });
  }
});

/**
 * DELETE /api/mcp/context/link
 * Revoca el link activo sin borrar la data MCP ni el contexto universal.
 */
router.delete('/link', async (req, res) => {
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
    const currentToken = safeStr(state?.shareToken).trim() || null;
    const hadActiveLink = !!(state?.shareEnabled && currentToken);

    await updateRootContextState(userId, {
      aiContext: {
        ...state,
        shareEnabled: false,
        shareToken: null,
        shareUrl: null,
        shareShortUrl: null,
        shareApiUrl: null,
        shareProvider: state?.shareProvider || 'chatgpt',
        shareLastGeneratedAt: state?.shareLastGeneratedAt || null,
        shareRevokedAt: nowIso(),
      },
    });

    await revokeAllShareTokensForUser(userId, currentToken);

    return res.json({
      ok: true,
      data: {
        revoked: hadActiveLink,
        hadActiveLink,
        dataPreserved: true,
      },
    });
  } catch (e) {
    console.error('[mcp/context/link:delete] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LINK_DELETE_FAILED' });
  }
});

/**
 * POST /api/mcp/context/link/revoke
 * Alias amigable por si el frontend prefiere POST en lugar de DELETE.
 */
router.post('/link/revoke', async (req, res) => {
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
    const currentToken = safeStr(state?.shareToken).trim() || null;
    const hadActiveLink = !!(state?.shareEnabled && currentToken);

    await updateRootContextState(userId, {
      aiContext: {
        ...state,
        shareEnabled: false,
        shareToken: null,
        shareUrl: null,
        shareShortUrl: null,
        shareApiUrl: null,
        shareProvider: state?.shareProvider || 'chatgpt',
        shareLastGeneratedAt: state?.shareLastGeneratedAt || null,
        shareRevokedAt: nowIso(),
      },
    });

    await revokeAllShareTokensForUser(userId, currentToken);

    return res.json({
      ok: true,
      data: {
        revoked: hadActiveLink,
        hadActiveLink,
        dataPreserved: true,
      },
    });
  } catch (e) {
    console.error('[mcp/context/link:revoke] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LINK_REVOKE_FAILED' });
  }
});

/**
 * GET /api/mcp/context/shared/:token
 * Siempre devuelve el contexto universal más reciente del usuario dueño de ese token.
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

    const tokenRoot = await findRootByShareToken(token);
    if (!tokenRoot) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_FOUND' });
    }

    const ownerId =
      tokenRoot?.userId ||
      tokenRoot?.user ||
      tokenRoot?.owner ||
      null;

    if (!ownerId) {
      console.error('[mcp/context/shared] owner missing for token root', {
        token,
        rootId: tokenRoot?._id || null,
      });
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_OWNER_NOT_FOUND' });
    }

    const latestRoot = await findRoot(ownerId);
    if (!latestRoot) {
      console.error('[mcp/context/shared] latest root not found for token owner', {
        token,
        ownerId: String(ownerId),
        tokenRootId: tokenRoot?._id || null,
      });
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_FOUND' });
    }

    const state = latestRoot?.aiContext || {};
    if (!state?.encodedPayload) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_READY' });
    }

    setNoCacheHeaders(res);
    return res.json(buildSharedPayload(latestRoot, provider));
  } catch (e) {
    console.error('[mcp/context/shared] error:', e?.stack || e?.message || e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_SHARED_FAILED' });
  }
});

module.exports = router;