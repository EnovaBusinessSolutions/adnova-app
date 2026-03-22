// backend/routes/mcpContext.js
'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const McpData = require('../models/McpData');
const User = require('../models/User');
const {
  findRoot,
  buildUnifiedContextForUser,
  buildPdfForUser,
  isPdfCurrentForAi,
} = require('../services/mcpContextBuilder');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const BUILD_ACTIVE_GUARD_MS = Number(process.env.MCP_CONTEXT_BUILD_ACTIVE_GUARD_MS || 180000);

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowDate() {
  return new Date();
}

function makeShortShareToken() {
  return crypto.randomBytes(8).toString('base64url');
}

function parseDateMs(v) {
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

function isRecentProcessingState(ai) {
  if (!ai || safeStr(ai?.status) !== 'processing' || !safeStr(ai?.buildAttemptId).trim()) return false;
  const startedMs = parseDateMs(ai?.startedAt);
  if (!startedMs) return false;
  return (Date.now() - startedMs) <= BUILD_ACTIVE_GUARD_MS;
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

function buildVersionedShareUrl(token, provider = 'chatgpt', version = '') {
  const base = buildApiShareUrl(token, provider);
  const cleanVersion = safeStr(version).trim();
  if (!cleanVersion) return base;
  return `${base}&v=${encodeURIComponent(cleanVersion)}`;
}

function normalizeProvider(raw) {
  const p = safeStr(raw).trim().toLowerCase();
  return p === 'claude' || p === 'gemini' || p === 'chatgpt' ? p : 'chatgpt';
}

function normalizePdfState(pdf) {
  const state = pdf || {};
  return {
    status: safeStr(state?.status) || 'idle',
    stage: safeStr(state?.stage) || 'idle',
    progress: toNum(state?.progress, 0),
    ready: safeStr(state?.status) === 'ready',
    current: !!state?.current,
    fileName: state?.fileName || null,
    mimeType: state?.mimeType || 'application/pdf',
    storageKey: state?.storageKey || null,
    localPath: state?.localPath || null,
    downloadUrl: state?.downloadUrl || null,
    generatedAt: state?.generatedAt || null,
    sizeBytes: toNum(state?.sizeBytes, 0),
    pageCount: toNum(state?.pageCount, 0) || null,
    renderer: state?.renderer || null,
    version: toNum(state?.version, 1) || 1,
    error: state?.error || null,
    signalFingerprint: state?.signalFingerprint || null,
    signalSnapshotId: state?.signalSnapshotId || null,
    signalSourceSnapshots: state?.signalSourceSnapshots || null,
    signalGeneratedAt: state?.signalGeneratedAt || null,
  };
}

/**
 * Root con Signal real más reciente.
 * IMPORTANTE:
 * - NO depende de updatedAt general del documento.
 * - Prioriza aiContext.finishedAt / snapshotId / createdAt.
 */
async function findLatestContextRootForUser(userId) {
  if (!userId) return null;

  const root = await McpData.findOne({
    userId,
    kind: 'root',
    $or: [
      { 'aiContext.signalPayload': { $exists: true, $ne: null } },
      { 'aiContext.encodedPayload': { $exists: true, $ne: null } },
    ],
  }).sort({
    'aiContext.finishedAt': -1,
    'aiContext.snapshotId': -1,
    createdAt: -1,
    _id: -1,
  });

  return root || null;
}

/**
 * Root con PDF vigente más reciente.
 */
async function findLatestPdfReadyRootForUser(userId) {
  if (!userId) return null;

  const candidates = await McpData.find({
    userId,
    kind: 'root',
    'aiContext.pdf.status': 'ready',
    $or: [
      { 'aiContext.signalPayload': { $exists: true, $ne: null } },
      { 'aiContext.encodedPayload': { $exists: true, $ne: null } },
    ],
  })
    .sort({
      'aiContext.finishedAt': -1,
      'aiContext.snapshotId': -1,
      createdAt: -1,
      _id: -1,
    })
    .limit(8);

  for (const root of Array.isArray(candidates) ? candidates : []) {
    const ai = root?.aiContext || {};
    const pdf = ai?.pdf || {};
    const filePath = pdf?.localPath ? path.resolve(pdf.localPath) : null;
    const fileExists = !!(filePath && fs.existsSync(filePath));

    if (fileExists && isPdfCurrentForAi(ai)) {
      return root;
    }
  }

  return null;
}

/**
 * Si hay un build de Signal en curso reciente, prioriza el root actual,
 * excepto cuando ese root en processing no tiene Signal/PDF vigente pero
 * sí existe otro root con PDF vigente listo para mostrarse.
 */
async function findPreferredContextRootForUser(userId) {
  if (!userId) return null;

  const currentRoot = await findRoot(userId);
  const currentAi = currentRoot?.aiContext || {};
  const currentHasSignal = !!(currentAi?.signalPayload || currentAi?.encodedPayload);
  const currentPdfCurrent = !!isPdfCurrentForAi(currentAi);

  if (currentRoot?.aiContext && isRecentProcessingState(currentAi)) {
    if (currentHasSignal || currentPdfCurrent) {
      return currentRoot;
    }

    const pdfReadyRoot = await findLatestPdfReadyRootForUser(userId);
    if (pdfReadyRoot) return pdfReadyRoot;

    return currentRoot;
  }

  const latestReadyRoot = (await findLatestPdfReadyRootForUser(userId)) || (await findLatestContextRootForUser(userId));
  return latestReadyRoot || currentRoot || null;
}

function getVersionSeedFromRoot(root) {
  const state = root?.aiContext || {};
  const signalPayload = state?.signalPayload || state?.encodedPayload || null;

  return (
    safeStr(state?.snapshotId).trim() ||
    safeStr(root?.latestSnapshotId).trim() ||
    safeStr(state?.finishedAt).trim() ||
    safeStr(signalPayload?.generatedAt).trim() ||
    safeStr(root?.updatedAt).trim() ||
    String(Date.now())
  );
}

async function syncUserVersionedLink(userId, preferredProvider = null) {
  if (!userId) return null;

  const user = await User.findById(userId).select(
    [
      'mcpShareToken',
      'mcpShareEnabled',
      'mcpShareProvider',
      'mcpShareShortUrl',
      'mcpShareVersionedUrl',
      'mcpShareVersion',
      'mcpShareSnapshotId',
      'mcpShareCreatedAt',
      'mcpShareRevokedAt',
      'mcpShareLastGeneratedAt',
    ].join(' ')
  );

  if (!user) return null;
  if (!(user.mcpShareEnabled && user.mcpShareToken)) return user;

  const latestRoot = await findLatestContextRootForUser(userId);
  const signalPayload = latestRoot?.aiContext?.signalPayload || latestRoot?.aiContext?.encodedPayload || null;
  if (!signalPayload) return user;

  const provider = normalizeProvider(preferredProvider || user.mcpShareProvider || 'chatgpt');
  const shareToken = safeStr(user.mcpShareToken).trim();
  const shortUrl = buildShortShareUrl(shareToken);
  const snapshotId = safeStr(latestRoot?.aiContext?.snapshotId || latestRoot?.latestSnapshotId).trim() || null;
  const version = getVersionSeedFromRoot(latestRoot);
  const versionedUrl = buildVersionedShareUrl(shareToken, provider, version);

  user.mcpShareProvider = provider;
  user.mcpShareShortUrl = shortUrl;
  user.mcpShareVersionedUrl = versionedUrl;
  user.mcpShareVersion = version;
  user.mcpShareSnapshotId = snapshotId;
  user.mcpShareLastGeneratedAt = nowDate();
  user.mcpShareRevokedAt = null;

  await user.save();
  return user;
}

async function findUserShareState(userId) {
  if (!userId) return null;

  return await User.findById(userId)
    .select(
      [
        'mcpShareToken',
        'mcpShareEnabled',
        'mcpShareProvider',
        'mcpShareShortUrl',
        'mcpShareVersionedUrl',
        'mcpShareVersion',
        'mcpShareSnapshotId',
        'mcpShareCreatedAt',
        'mcpShareRevokedAt',
        'mcpShareLastGeneratedAt',
      ].join(' ')
    )
    .lean();
}

async function findUserByShareToken(token) {
  const cleanToken = safeStr(token).trim();
  if (!cleanToken) return null;

  return await User.findOne({
    mcpShareToken: cleanToken,
    mcpShareEnabled: true,
  }).select(
    [
      '_id',
      'mcpShareToken',
      'mcpShareEnabled',
      'mcpShareProvider',
      'mcpShareShortUrl',
      'mcpShareVersionedUrl',
      'mcpShareVersion',
      'mcpShareSnapshotId',
      'mcpShareCreatedAt',
      'mcpShareRevokedAt',
      'mcpShareLastGeneratedAt',
    ].join(' ')
  );
}

function buildStatusResponse(root, shareState = null) {
  const state = root?.aiContext || {};
  const signalPayload = state?.signalPayload || state?.encodedPayload || null;
  const pdfCurrent = !!isPdfCurrentForAi(state);
  const pdf = normalizePdfState({
    ...(state?.pdf || {}),
    current: pdfCurrent,
  });

  const shareEnabled = !!(shareState?.mcpShareEnabled && shareState?.mcpShareToken);
  const shareToken = shareEnabled ? shareState?.mcpShareToken || null : null;
  const shareProvider = normalizeProvider(shareState?.mcpShareProvider || 'chatgpt');
  const shareShortUrl = shareEnabled
    ? safeStr(shareState?.mcpShareShortUrl).trim() || buildShortShareUrl(shareToken)
    : null;
  const shareVersionedUrl = shareEnabled
    ? safeStr(shareState?.mcpShareVersionedUrl).trim() || null
    : null;

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
      hasSignal: !!signalPayload,
      signalReady: !!signalPayload,
      providerAgnostic: !!signalPayload?.providerAgnostic,

      usedOpenAI: !!state?.usedOpenAI,
      model: state?.model || null,
      error: state?.error || null,
      buildAttemptId: state?.buildAttemptId || null,
      sources: state?.sourcesStatus || null,
      usableSources: Array.isArray(state?.usableSources) ? state.usableSources : [],
      pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : [],

      hasPdf: pdf.ready,
      pdfCurrent,
      canDownloadPdf: pdf.ready && pdfCurrent,
      canGeneratePdf: !!signalPayload && !pdfCurrent,
      pdf,

      hasShareLink: shareEnabled,
      shareUrl: shareShortUrl,
      shareShortUrl,
      shareApiUrl: shareEnabled ? buildApiShareUrl(shareToken, shareProvider) : null,
      shareVersionedUrl,
      shareToken,
      shareProvider,
      shareVersion: shareState?.mcpShareVersion || null,
      shareSnapshotId: shareState?.mcpShareSnapshotId || null,
      shareCreatedAt: shareState?.mcpShareCreatedAt || null,
      shareRevokedAt: shareState?.mcpShareRevokedAt || null,
    },
  };
}

function buildSharedPayload(root, provider) {
  const state = root?.aiContext || {};
  const payload = state?.signalPayload || state?.encodedPayload || null;
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
 * Construye solo el Signal / contexto universal.
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
      forceRebuild: !!req.body?.forceRebuild,
    });

    try {
      const resultData = result?.data || {};
      const status = safeStr(resultData?.status);
      const hasSignal = !!resultData?.hasSignal;

      if ((status === 'done' || hasSignal) && !resultData?.pendingConnectedSources?.length) {
        await syncUserVersionedLink(userId, req.body?.provider || null);
      }
    } catch (syncErr) {
      console.error('[mcp/context/build] syncUserVersionedLink warning:', syncErr);
    }

    setNoCacheHeaders(res);

    const resultData = result?.data || {};
    const stage = safeStr(resultData?.stage);
    const status = safeStr(resultData?.status);

    if (
      status === 'processing' &&
      (
        stage === 'waiting_for_connected_sources' ||
        stage === 'waiting_for_valid_signal' ||
        stage === 'waiting_for_sources'
      )
    ) {
      return res.status(202).json({
        ok: true,
        data: resultData,
      });
    }

    return res.json({
      ok: true,
      data: resultData,
    });
  } catch (e) {
    console.error('[mcp/context/build] error:', e);

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
      error: code || 'MCP_CONTEXT_BUILD_FAILED',
    });
  }
});

/**
 * POST /api/mcp/context/pdf/build
 * Construye el PDF a partir de un Signal ya listo.
 */
router.post('/pdf/build', async (req, res) => {
  const userId = req.user?._id;

  try {
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    const signalPayload = state?.signalPayload || state?.encodedPayload || null;
    const pdfCurrent = !!isPdfCurrentForAi(state);
    const pdf = normalizePdfState({
      ...(state?.pdf || {}),
      current: pdfCurrent,
    });

    if (!signalPayload) {
      setNoCacheHeaders(res);
      return res.status(202).json({
        ok: true,
        data: {
          status: state?.status || 'idle',
          progress: state?.progress || 0,
          stage: state?.stage || 'idle',
          pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : [],
          pdf,
          hasSignal: false,
          hasPdf: pdf.ready,
          pdfCurrent,
          canDownloadPdf: false,
          canGeneratePdf: false,
        },
      });
    }

    if (pdf.ready && pdfCurrent && !req.body?.forceRebuild) {
      setNoCacheHeaders(res);
      return res.json({
        ok: true,
        data: buildStatusResponse(root)?.data || null,
      });
    }

    if (pdf.status === 'processing' && !req.body?.forceRebuild) {
      setNoCacheHeaders(res);
      return res.status(202).json({
        ok: true,
        data: buildStatusResponse(root)?.data || null,
      });
    }

    const result = await buildPdfForUser(userId);

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: result?.data || null,
    });
  } catch (e) {
    console.error('[mcp/context/pdf/build] error:', e);

    const code = e?.code || e?.message || 'MCP_SIGNAL_PDF_BUILD_FAILED';

    if (code === 'MCP_ROOT_NOT_FOUND') {
      return res.status(404).json({ ok: false, error: code });
    }

    if (code === 'MCP_CONTEXT_NOT_READY' || code === 'MCP_SIGNAL_NOT_VALID_FOR_PDF') {
      const latestRoot = await findPreferredContextRootForUser(userId).catch(() => null);
      setNoCacheHeaders(res);

      return res.status(202).json({
        ok: true,
        data: latestRoot ? (buildStatusResponse(latestRoot)?.data || null) : {
          status: 'idle',
          progress: 0,
          stage: 'idle',
          pdf: normalizePdfState(null),
          hasSignal: false,
          hasPdf: false,
          pdfCurrent: false,
          canDownloadPdf: false,
          canGeneratePdf: false,
        },
      });
    }

    return res.status(500).json({
      ok: false,
      error: code || 'MCP_SIGNAL_PDF_BUILD_FAILED',
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

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const shareState = await syncUserVersionedLink(userId).catch(async () => {
      return await findUserShareState(userId);
    });

    setNoCacheHeaders(res);
    return res.json(buildStatusResponse(root, shareState));
  } catch (e) {
    console.error('[mcp/context/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_STATUS_FAILED' });
  }
});

/**
 * GET /api/mcp/context/latest
 * Devuelve el Signal listo más reciente.
 */
router.get('/latest', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    const signalPayload = state?.signalPayload || state?.encodedPayload || null;
    const pdfCurrent = !!isPdfCurrentForAi(state);

    if (!signalPayload) {
      return res.status(404).json({
        ok: false,
        error: 'MCP_CONTEXT_NOT_READY',
        data: {
          status: state?.status || 'idle',
          progress: state?.progress || 0,
          stage: state?.stage || 'idle',
          pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : [],
          hasPdf: normalizePdfState(state?.pdf).ready,
          pdfCurrent,
        },
      });
    }

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: signalPayload,
      meta: {
        status: state?.status || 'done',
        progress: state?.progress || 100,
        stage: state?.stage || 'completed',
        snapshotId: state?.snapshotId || root?.latestSnapshotId || null,
        sourceSnapshots: state?.sourceSnapshots || signalPayload?.sourceSnapshots || null,
        contextRangeDays: toNum(state?.contextRangeDays) || null,
        storageRangeDays: toNum(state?.storageRangeDays) || null,
        usedOpenAI: !!state?.usedOpenAI,
        model: state?.model || null,
        generatedAt: state?.finishedAt || null,
        hasPdf: normalizePdfState(state?.pdf).ready,
        pdfCurrent,
        canDownloadPdf: normalizePdfState(state?.pdf).ready && pdfCurrent,
        canGeneratePdf: !!signalPayload && !pdfCurrent,
        buildAttemptId: state?.buildAttemptId || null,
      },
    });
  } catch (e) {
    console.error('[mcp/context/latest] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LATEST_FAILED' });
  }
});

/**
 * GET /api/mcp/context/pdf/download
 * Descarga el PDF listo del usuario autenticado.
 */
router.get('/pdf/download', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    const pdfCurrent = !!isPdfCurrentForAi(state);
    const pdf = normalizePdfState({
      ...(state?.pdf || {}),
      current: pdfCurrent,
    });

    if (!(pdf.ready && pdfCurrent)) {
      return res.status(409).json({
        ok: false,
        error: 'MCP_SIGNAL_PDF_NOT_READY',
        data: {
          status: state?.status || 'idle',
          progress: state?.progress || 0,
          stage: state?.stage || 'idle',
          pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : [],
          pdf,
          pdfCurrent,
          canDownloadPdf: false,
          canGeneratePdf: !!(state?.signalPayload || state?.encodedPayload) && !pdfCurrent,
        },
      });
    }

    const filePath = pdf.localPath ? path.resolve(pdf.localPath) : null;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({
        ok: false,
        error: 'MCP_SIGNAL_PDF_FILE_NOT_FOUND',
      });
    }

    setNoCacheHeaders(res);
    res.setHeader('Content-Type', pdf.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeStr(pdf.fileName || 'adray-signal.pdf').replace(/"/g, '')}"`);
    return res.download(filePath, safeStr(pdf.fileName || 'adray-signal.pdf').replace(/"/g, ''));
  } catch (e) {
    console.error('[mcp/context/pdf/download] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_SIGNAL_PDF_DOWNLOAD_FAILED' });
  }
});

/**
 * GET /api/mcp/context/pdf/status
 * Alias práctico por si el frontend solo quiere consultar PDF.
 */
router.get('/pdf/status', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    const pdfCurrent = !!isPdfCurrentForAi(state);
    const pdf = normalizePdfState({
      ...(state?.pdf || {}),
      current: pdfCurrent,
    });

    setNoCacheHeaders(res);

    return res.json({
      ok: true,
      data: {
        ...pdf,
        current: pdfCurrent,
        canDownloadPdf: pdf.ready && pdfCurrent,
        canGeneratePdf: !!(state?.signalPayload || state?.encodedPayload) && !pdfCurrent,
      },
    });
  } catch (e) {
    console.error('[mcp/context/pdf/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_SIGNAL_PDF_STATUS_FAILED' });
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

    const provider = normalizeProvider(req.body?.provider);

    const latestContextRoot = (await findLatestContextRootForUser(userId)) || (await findRoot(userId));
    if (!latestContextRoot) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = latestContextRoot?.aiContext || {};
    const signalPayload = state?.signalPayload || state?.encodedPayload || null;
    if (!signalPayload) {
      return res.status(404).json({ ok: false, error: 'MCP_CONTEXT_NOT_READY' });
    }

    const user = await User.findById(userId).select(
      [
        'mcpShareToken',
        'mcpShareEnabled',
        'mcpShareProvider',
        'mcpShareShortUrl',
        'mcpShareVersionedUrl',
        'mcpShareVersion',
        'mcpShareSnapshotId',
        'mcpShareCreatedAt',
        'mcpShareRevokedAt',
        'mcpShareLastGeneratedAt',
      ].join(' ')
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    }

    let shareToken = safeStr(user.mcpShareToken).trim() || null;
    const alreadyActive = !!(user.mcpShareEnabled && shareToken);

    if (!shareToken) {
      shareToken = makeShortShareToken();
    }

    const shortUrl = buildShortShareUrl(shareToken);
    const version = getVersionSeedFromRoot(latestContextRoot);
    const snapshotId = safeStr(latestContextRoot?.aiContext?.snapshotId || latestContextRoot?.latestSnapshotId).trim() || null;
    const versionedUrl = buildVersionedShareUrl(shareToken, provider, version);

    user.mcpShareToken = shareToken;
    user.mcpShareEnabled = true;
    user.mcpShareProvider = provider;
    user.mcpShareShortUrl = shortUrl;
    user.mcpShareVersionedUrl = versionedUrl;
    user.mcpShareVersion = version;
    user.mcpShareSnapshotId = snapshotId;
    user.mcpShareCreatedAt = alreadyActive ? (user.mcpShareCreatedAt || nowDate()) : nowDate();
    user.mcpShareLastGeneratedAt = nowDate();
    user.mcpShareRevokedAt = null;
    await user.save();

    const shareApiUrl = buildApiShareUrl(shareToken, provider);

    return res.json({
      ok: true,
      data: {
        provider,
        shareToken,
        shareUrl: shortUrl,
        shareShortUrl: shortUrl,
        shareApiUrl,
        shareVersionedUrl: versionedUrl,
        shareVersion: version,
        shareSnapshotId: snapshotId,
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

    const user = await syncUserVersionedLink(userId).catch(async () => {
      return await User.findById(userId).select(
        [
          'mcpShareToken',
          'mcpShareEnabled',
          'mcpShareProvider',
          'mcpShareShortUrl',
          'mcpShareVersionedUrl',
          'mcpShareVersion',
          'mcpShareSnapshotId',
          'mcpShareCreatedAt',
          'mcpShareRevokedAt',
          'mcpShareLastGeneratedAt',
        ].join(' ')
      );
    });

    if (!user) {
      return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    }

    const enabled = !!(user.mcpShareEnabled && user.mcpShareToken);
    const shareToken = enabled ? user.mcpShareToken : null;
    const provider = normalizeProvider(user.mcpShareProvider || 'chatgpt');
    const shortUrl = enabled
      ? safeStr(user.mcpShareShortUrl).trim() || buildShortShareUrl(shareToken)
      : null;
    const versionedUrl = enabled
      ? safeStr(user.mcpShareVersionedUrl).trim() || null
      : null;

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: {
        enabled,
        shareToken,
        shareUrl: shortUrl,
        shareShortUrl: shortUrl,
        shareApiUrl: enabled ? buildApiShareUrl(shareToken, provider) : null,
        shareVersionedUrl: versionedUrl,
        shareVersion: user.mcpShareVersion || null,
        shareSnapshotId: user.mcpShareSnapshotId || null,
        provider,
        createdAt: user.mcpShareCreatedAt || null,
        lastGeneratedAt: user.mcpShareLastGeneratedAt || null,
        revokedAt: user.mcpShareRevokedAt || null,
      },
    });
  } catch (e) {
    console.error('[mcp/context/link:get] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LINK_READ_FAILED' });
  }
});

/**
 * DELETE /api/mcp/context/link
 * Revoca el link activo sin borrar la data MCP ni el Signal.
 */
router.delete('/link', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const user = await User.findById(userId).select(
      [
        'mcpShareToken',
        'mcpShareEnabled',
        'mcpShareProvider',
        'mcpShareShortUrl',
        'mcpShareVersionedUrl',
        'mcpShareVersion',
        'mcpShareSnapshotId',
        'mcpShareCreatedAt',
        'mcpShareRevokedAt',
        'mcpShareLastGeneratedAt',
      ].join(' ')
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    }

    const hadActiveLink = !!(user.mcpShareEnabled && user.mcpShareToken);

    user.mcpShareEnabled = false;
    user.mcpShareToken = null;
    user.mcpShareShortUrl = null;
    user.mcpShareVersionedUrl = null;
    user.mcpShareVersion = null;
    user.mcpShareSnapshotId = null;
    user.mcpShareRevokedAt = nowDate();
    await user.save();

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

    const user = await User.findById(userId).select(
      [
        'mcpShareToken',
        'mcpShareEnabled',
        'mcpShareProvider',
        'mcpShareShortUrl',
        'mcpShareVersionedUrl',
        'mcpShareVersion',
        'mcpShareSnapshotId',
        'mcpShareCreatedAt',
        'mcpShareRevokedAt',
        'mcpShareLastGeneratedAt',
      ].join(' ')
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    }

    const hadActiveLink = !!(user.mcpShareEnabled && user.mcpShareToken);

    user.mcpShareEnabled = false;
    user.mcpShareToken = null;
    user.mcpShareShortUrl = null;
    user.mcpShareVersionedUrl = null;
    user.mcpShareVersion = null;
    user.mcpShareSnapshotId = null;
    user.mcpShareRevokedAt = nowDate();
    await user.save();

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
 * Devuelve SIEMPRE el Signal más reciente del usuario dueño de ese token.
 */
router.get('/shared/:token', async (req, res) => {
  try {
    const token = safeStr(req.params?.token).trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'MISSING_TOKEN' });
    }

    const provider = normalizeProvider(req.query?.provider);

    const user = await findUserByShareToken(token);
    if (!user?._id) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_FOUND' });
    }

    const root = await findLatestContextRootForUser(user._id);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    const signalPayload = state?.signalPayload || state?.encodedPayload || null;
    if (!signalPayload) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_READY' });
    }

    try {
      await syncUserVersionedLink(user._id, provider);
    } catch (syncErr) {
      console.error('[mcp/context/shared] syncUserVersionedLink warning:', syncErr);
    }

    setNoCacheHeaders(res);
    return res.json(buildSharedPayload(root, provider));
  } catch (e) {
    console.error('[mcp/context/shared] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_SHARED_FAILED' });
  }
});

module.exports = router;