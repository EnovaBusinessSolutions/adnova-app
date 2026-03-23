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
} = require('../services/mcpContextBuilder');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');

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

function getSignalPayload(state) {
  return state?.signal?.payload || state?.signalPayload || state?.encodedPayload || null;
}

function isSignalCurrent(root) {
  if (!root) return false;
  const ai = root?.aiContext || {};
  const currentFp = safeStr(ai?.currentSourceFingerprint).trim();
  const signalFp = safeStr(ai?.signal?.sourceFingerprint).trim();

  return !!(
    currentFp &&
    signalFp &&
    ai?.signal?.status === 'ready' &&
    currentFp === signalFp &&
    ai?.needsSignalRebuild !== true
  );
}

function isPdfCurrent(root) {
  if (!root) return false;
  const ai = root?.aiContext || {};
  const currentFp = safeStr(ai?.currentSourceFingerprint).trim();
  const pdfFp = safeStr(ai?.pdf?.sourceFingerprint).trim();

  return !!(
    currentFp &&
    pdfFp &&
    ai?.pdf?.status === 'ready' &&
    currentFp === pdfFp &&
    isSignalCurrent(root) &&
    ai?.needsPdfRebuild !== true
  );
}

function normalizeSignalState(root) {
  const ai = root?.aiContext || {};
  const signal = ai?.signal || {};
  const payload = getSignalPayload(ai);

  return {
    status: safeStr(signal?.status) || 'idle',
    stage: safeStr(signal?.stage) || 'idle',
    progress: toNum(signal?.progress, 0),
    ready: safeStr(signal?.status) === 'ready',
    isCurrent: isSignalCurrent(root),
    generationId: signal?.generationId || null,
    sourceFingerprint: signal?.sourceFingerprint || null,
    sourcesSnapshot: signal?.sourcesSnapshot || null,
    startedAt: signal?.startedAt || null,
    finishedAt: signal?.finishedAt || null,
    generatedAt: signal?.generatedAt || null,
    version: toNum(signal?.version, 1) || 1,
    model: signal?.model || ai?.model || null,
    usedOpenAI: !!(signal?.usedOpenAI || ai?.usedOpenAI),
    error: signal?.error || null,
    hasPayload: !!payload,
  };
}

function normalizePdfState(root) {
  const pdf = root?.aiContext?.pdf || {};
  return {
    status: safeStr(pdf?.status) || 'idle',
    stage: safeStr(pdf?.stage) || 'idle',
    progress: toNum(pdf?.progress, 0),
    ready: safeStr(pdf?.status) === 'ready',
    isCurrent: isPdfCurrent(root),
    generationId: pdf?.generationId || null,
    signalGenerationId: pdf?.signalGenerationId || null,
    sourceFingerprint: pdf?.sourceFingerprint || null,
    sourcesSnapshot: pdf?.sourcesSnapshot || null,
    fileName: pdf?.fileName || null,
    mimeType: pdf?.mimeType || 'application/pdf',
    storageKey: pdf?.storageKey || null,
    localPath: pdf?.localPath || null,
    downloadUrl: pdf?.downloadUrl || null,
    generatedAt: pdf?.generatedAt || null,
    sizeBytes: toNum(pdf?.sizeBytes, 0),
    pageCount: toNum(pdf?.pageCount, 0) || null,
    renderer: pdf?.renderer || null,
    version: toNum(pdf?.version, 1) || 1,
    invalidatedAt: pdf?.invalidatedAt || null,
    staleReason: pdf?.staleReason || null,
    error: pdf?.error || null,
  };
}

function getVersionSeedFromRoot(root) {
  const ai = root?.aiContext || {};
  const signal = ai?.signal || {};
  const payload = getSignalPayload(ai);

  return (
    safeStr(signal?.generationId).trim() ||
    safeStr(signal?.sourceFingerprint).trim() ||
    safeStr(ai?.currentSourceFingerprint).trim() ||
    safeStr(signal?.generatedAt).trim() ||
    safeStr(ai?.sourcesChangedAt).trim() ||
    safeStr(payload?.generatedAt).trim() ||
    safeStr(root?.updatedAt).trim() ||
    String(Date.now())
  );
}

async function findPreferredContextRootForUser(userId) {
  if (!userId) return null;
  return (await findRoot(userId)) || null;
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

  const root = await findPreferredContextRootForUser(userId);
  if (!root) return user;

  const ai = root?.aiContext || {};
  const signalPayload = getSignalPayload(ai);
  const signalState = normalizeSignalState(root);

  if (!signalPayload || !signalState.isCurrent) {
    return user;
  }

  const provider = normalizeProvider(preferredProvider || user.mcpShareProvider || 'chatgpt');
  const shareToken = safeStr(user.mcpShareToken).trim();
  const shortUrl = buildShortShareUrl(shareToken);
  const snapshotId = safeStr(ai?.signal?.snapshotId || ai?.snapshotId || root?.latestSnapshotId).trim() || null;
  const version = getVersionSeedFromRoot(root);
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
  const signalPayload = getSignalPayload(state);
  const signal = normalizeSignalState(root);
  const pdf = normalizePdfState(root);

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

      snapshotId: state?.signal?.snapshotId || state?.snapshotId || root?.latestSnapshotId || null,
      sourceSnapshots: state?.sourceSnapshots || state?.signal?.sourcesSnapshot || signalPayload?.sourceSnapshots || null,

      currentSourceFingerprint: state?.currentSourceFingerprint || null,
      currentSourcesSnapshot: state?.currentSourcesSnapshot || null,
      sourcesChangedAt: state?.sourcesChangedAt || null,

      contextRangeDays: toNum(state?.signal?.contextRangeDays) || toNum(state?.contextRangeDays) || null,
      storageRangeDays: toNum(state?.signal?.storageRangeDays) || toNum(state?.storageRangeDays) || null,

      hasEncodedPayload: !!(state?.signal?.encodedPayload || state?.encodedPayload),
      hasSignal: !!signalPayload,
      signalReady: signal.ready,
      signal,

      providerAgnostic: !!signalPayload?.providerAgnostic,

      usedOpenAI: !!(state?.signal?.usedOpenAI || state?.usedOpenAI),
      model: state?.signal?.model || state?.model || null,
      error: state?.error || null,

      sources: state?.sourcesStatus || null,
      usableSources: Array.isArray(state?.usableSources) ? state.usableSources : [],
      pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : [],

      needsSignalRebuild: state?.needsSignalRebuild === true,
      needsPdfRebuild: state?.needsPdfRebuild === true,

      hasPdf: pdf.ready,
      pdf,

      canGeneratePdf: signal.isCurrent && signal.ready && !pdf.isCurrent,
      canDownloadPdf: pdf.isCurrent,

      hasShareLink: shareEnabled && signal.isCurrent,
      shareUrl: shareEnabled && signal.isCurrent ? shareShortUrl : null,
      shareShortUrl: shareEnabled && signal.isCurrent ? shareShortUrl : null,
      shareApiUrl: shareEnabled && signal.isCurrent ? buildApiShareUrl(shareToken, shareProvider) : null,
      shareVersionedUrl: shareEnabled && signal.isCurrent ? shareVersionedUrl : null,
      shareToken: shareEnabled && signal.isCurrent ? shareToken : null,
      shareProvider: shareEnabled && signal.isCurrent ? shareProvider : null,
      shareVersion: shareEnabled && signal.isCurrent ? (shareState?.mcpShareVersion || null) : null,
      shareSnapshotId: shareEnabled && signal.isCurrent ? (shareState?.mcpShareSnapshotId || null) : null,
      shareCreatedAt: shareEnabled && signal.isCurrent ? (shareState?.mcpShareCreatedAt || null) : null,
      shareRevokedAt: shareState?.mcpShareRevokedAt || null,
    },
  };
}

function buildSharedPayload(root, provider) {
  const state = root?.aiContext || {};
  const payload = getSignalPayload(state);
  const signal = normalizeSignalState(root);

  if (!payload || !signal.isCurrent) return null;

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
      snapshotId: state?.signal?.snapshotId || state?.snapshotId || root?.latestSnapshotId || null,
      sourceSnapshots: state?.sourceSnapshots || state?.signal?.sourcesSnapshot || payload?.sourceSnapshots || null,
      generatedAt: state?.signal?.generatedAt || state?.finishedAt || payload?.generatedAt || null,
      contextRangeDays: toNum(state?.signal?.contextRangeDays) || toNum(state?.contextRangeDays) || null,
      storageRangeDays: toNum(state?.signal?.storageRangeDays) || toNum(state?.storageRangeDays) || null,
      providerAgnostic: !!payload?.providerAgnostic,
      usedOpenAI: !!(state?.signal?.usedOpenAI || state?.usedOpenAI),
      model: state?.signal?.model || state?.model || null,
      currentSourceFingerprint: state?.currentSourceFingerprint || null,
      signalGenerationId: state?.signal?.generationId || null,
      signalIsCurrent: signal.isCurrent,
    },
  };
}

/**
 * POST /api/mcp/context/build
 * Construye o reconstruye el Signal vigente.
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
      const freshRoot = await findRoot(userId);
      const signal = normalizeSignalState(freshRoot);
      if (signal.isCurrent) {
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
        stage === 'waiting_for_sources' ||
        stage === 'compacting_sources' ||
        stage === 'encoding_signal'
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
 * Construye el PDF únicamente desde un Signal vigente.
 */
router.post('/pdf/build', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const signal = normalizeSignalState(root);
    const pdf = normalizePdfState(root);

    if (!signal.hasPayload || !signal.isCurrent) {
      return res.status(409).json({
        ok: false,
        error: 'MCP_SIGNAL_STALE_OR_NOT_READY',
        data: buildStatusResponse(root)?.data || null,
      });
    }

    if (pdf.isCurrent && !req.body?.forceRebuild) {
      setNoCacheHeaders(res);
      return res.json({
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

    if (
      code === 'MCP_CONTEXT_NOT_READY' ||
      code === 'MCP_SIGNAL_NOT_VALID_FOR_PDF' ||
      code === 'MCP_SIGNAL_STALE_OR_NOT_READY' ||
      code === 'MCP_SIGNAL_STALE_DURING_PDF_BUILD'
    ) {
      return res.status(409).json({ ok: false, error: code });
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
 * Devuelve únicamente el Signal vigente.
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
    const signalPayload = getSignalPayload(state);
    const signal = normalizeSignalState(root);

    if (!signalPayload || !signal.isCurrent) {
      return res.status(409).json({
        ok: false,
        error: 'MCP_CONTEXT_NOT_READY_OR_STALE',
        data: buildStatusResponse(root)?.data || null,
      });
    }

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: signalPayload,
      meta: {
        status: state?.status || 'done',
        progress: toNum(state?.progress, 100),
        stage: state?.stage || 'signal_ready',
        snapshotId: state?.signal?.snapshotId || state?.snapshotId || root?.latestSnapshotId || null,
        sourceSnapshots: state?.sourceSnapshots || state?.signal?.sourcesSnapshot || signalPayload?.sourceSnapshots || null,
        contextRangeDays: toNum(state?.signal?.contextRangeDays) || toNum(state?.contextRangeDays) || null,
        storageRangeDays: toNum(state?.signal?.storageRangeDays) || toNum(state?.storageRangeDays) || null,
        usedOpenAI: !!(state?.signal?.usedOpenAI || state?.usedOpenAI),
        model: state?.signal?.model || state?.model || null,
        generatedAt: state?.signal?.generatedAt || state?.finishedAt || null,
        hasPdf: normalizePdfState(root).isCurrent,
        signalGenerationId: state?.signal?.generationId || null,
        signalSourceFingerprint: state?.signal?.sourceFingerprint || null,
        currentSourceFingerprint: state?.currentSourceFingerprint || null,
        signalIsCurrent: signal.isCurrent,
      },
    });
  } catch (e) {
    console.error('[mcp/context/latest] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LATEST_FAILED' });
  }
});

/**
 * GET /api/mcp/context/pdf/download
 * Descarga únicamente el PDF vigente.
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

    const pdf = normalizePdfState(root);

    if (!pdf.isCurrent) {
      return res.status(409).json({
        ok: false,
        error: 'MCP_SIGNAL_PDF_NOT_READY_OR_STALE',
        data: buildStatusResponse(root)?.data || null,
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
 * Estado del PDF incluyendo vigencia real.
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

    const pdf = normalizePdfState(root);
    setNoCacheHeaders(res);

    return res.json({
      ok: true,
      data: pdf,
    });
  } catch (e) {
    console.error('[mcp/context/pdf/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_SIGNAL_PDF_STATUS_FAILED' });
  }
});

/**
 * POST /api/mcp/context/link
 * Crea el link compartido solo si existe un Signal vigente.
 */
router.post('/link', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const provider = normalizeProvider(req.body?.provider);

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const state = root?.aiContext || {};
    const signalPayload = getSignalPayload(state);
    const signal = normalizeSignalState(root);

    if (!signalPayload || !signal.isCurrent) {
      return res.status(409).json({ ok: false, error: 'MCP_CONTEXT_NOT_READY_OR_STALE' });
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
    const version = getVersionSeedFromRoot(root);
    const snapshotId = safeStr(state?.signal?.snapshotId || state?.snapshotId || root?.latestSnapshotId).trim() || null;
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

    const root = await findPreferredContextRootForUser(userId);
    const signalCurrent = !!root && isSignalCurrent(root);

    const enabled = !!(user.mcpShareEnabled && user.mcpShareToken && signalCurrent);
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
        shareVersion: enabled ? (user.mcpShareVersion || null) : null,
        shareSnapshotId: enabled ? (user.mcpShareSnapshotId || null) : null,
        provider: enabled ? provider : null,
        createdAt: enabled ? (user.mcpShareCreatedAt || null) : null,
        lastGeneratedAt: enabled ? (user.mcpShareLastGeneratedAt || null) : null,
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
 * Devuelve únicamente el Signal vigente del usuario dueño del token.
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

    const root = await findPreferredContextRootForUser(user._id);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_FOUND' });
    }

    const payload = buildSharedPayload(root, provider);
    if (!payload) {
      return res.status(409).json({ ok: false, error: 'SHARED_CONTEXT_NOT_READY_OR_STALE' });
    }

    try {
      await syncUserVersionedLink(user._id, provider);
    } catch (syncErr) {
      console.error('[mcp/context/shared] syncUserVersionedLink warning:', syncErr);
    }

    setNoCacheHeaders(res);
    return res.json(payload);
  } catch (e) {
    console.error('[mcp/context/shared] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_SHARED_FAILED' });
  }
});

module.exports = router;