// backend/routes/mcpContext.js
'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const User = require('../models/User');
const {
  findRoot,
  buildUnifiedContextForUser,
  buildPdfForUser,
  buildResultFromRoot,
} = require('../services/mcpContextBuilder');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');

function safeStr(v) {
  return v == null ? '' : String(v);
}

function nowDate() {
  return new Date();
}

function setNoCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  res.set('Vary', 'Accept-Encoding');
}

function normalizeProvider(raw) {
  const p = safeStr(raw).trim().toLowerCase();
  return p === 'claude' || p === 'gemini' || p === 'chatgpt' ? p : 'chatgpt';
}

function makeShortShareToken() {
  return crypto.randomBytes(8).toString('base64url');
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

function getVersionSeedFromStatus(statusData = {}, root = null) {
  return (
    safeStr(statusData?.currentSourceFingerprint).trim() ||
    safeStr(statusData?.sourceFingerprint).trim() ||
    safeStr(statusData?.snapshotId).trim() ||
    safeStr(root?.latestSnapshotId).trim() ||
    safeStr(statusData?.signal?.finishedAt).trim() ||
    safeStr(root?.updatedAt).trim() ||
    String(Date.now())
  );
}

function getSignalPayloadFromRoot(root) {
  const ai = root?.aiContext || {};
  return ai?.signal?.payload || ai?.signalPayload || null;
}

function getEncodedPayloadFromRoot(root) {
  const ai = root?.aiContext || {};
  return ai?.signal?.encodedPayload || ai?.encodedPayload || null;
}

function getPreferredPayloadForShare(root) {
  const encodedPayload = getEncodedPayloadFromRoot(root);
  if (encodedPayload) return { kind: 'encoded', payload: encodedPayload };

  const signalPayload = getSignalPayloadFromRoot(root);
  if (signalPayload) return { kind: 'human_fallback', payload: signalPayload };

  return { kind: null, payload: null };
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

  const root = await findRoot(userId);
  if (!root) return user;

  const statusData = buildResultFromRoot(root)?.data || null;
  if (!statusData?.signalComplete || !!statusData?.needSignalRebuild) {
    return user;
  }

  const provider = normalizeProvider(preferredProvider || user.mcpShareProvider || 'chatgpt');
  const shareToken = safeStr(user.mcpShareToken).trim();
  const shortUrl = buildShortShareUrl(shareToken);
  const version = getVersionSeedFromStatus(statusData, root);
  const snapshotId = safeStr(statusData?.snapshotId || root?.latestSnapshotId).trim() || null;
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

function buildSharedPayload(root, provider = 'chatgpt') {
  const statusData = buildResultFromRoot(root)?.data || null;
  if (!statusData?.signalComplete || !!statusData?.needSignalRebuild) {
    return null;
  }

  const preferred = getPreferredPayloadForShare(root);
  if (!preferred?.payload) return null;

  const providerName =
    provider === 'claude' ? 'Claude' :
    provider === 'gemini' ? 'Gemini' :
    'ChatGPT';

  return {
    ok: true,
    data: preferred.payload,
    meta: {
      schema: preferred.payload?.schema || 'adray.encoded.context.v2',
      provider,
      providerLabel: providerName,
      snapshotId: statusData?.snapshotId || null,
      sourceSnapshots: statusData?.sourceSnapshots || null,
      generatedAt: statusData?.finishedAt || statusData?.signal?.finishedAt || null,
      contextRangeDays: statusData?.contextRangeDays || null,
      storageRangeDays: statusData?.storageRangeDays || null,
      providerAgnostic: !!preferred.payload?.providerAgnostic,
      usedOpenAI: !!statusData?.usedOpenAI,
      model: statusData?.model || null,
      sourceFingerprint: statusData?.sourceFingerprint || null,
      currentSourceFingerprint: statusData?.currentSourceFingerprint || null,
      connectionFingerprint: statusData?.connectionFingerprint || null,
      buildAttemptId: statusData?.buildAttemptId || null,
      signalRunId: statusData?.signalRunId || null,
      preferredPayloadKind: preferred.kind || null,
    },
  };
}

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
      reason: safeStr(req.body?.reason) || 'manual_build',
      requestedBy: 'route:mcpContext.build',
      trigger: safeStr(req.body?.trigger) || 'manual_api',
    });

    try {
      const resultData = result?.data || {};
      if (resultData?.signalComplete && !resultData?.needSignalRebuild) {
        await syncUserVersionedLink(userId, req.body?.provider || null);
      }
    } catch (syncErr) {
      console.error('[mcp/context/build] syncUserVersionedLink warning:', syncErr);
    }

    setNoCacheHeaders(res);
    const resultData = result?.data || {};

    if (resultData?.actions?.shouldPoll) {
      return res.status(202).json({ ok: true, data: resultData });
    }

    return res.json({ ok: true, data: resultData });
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

router.post('/pdf/build', async (req, res) => {
  const userId = req.user?._id;

  try {
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const statusData = buildResultFromRoot(root)?.data || null;

    if (!statusData?.signalReadyForPdf) {
      setNoCacheHeaders(res);
      return res.status(202).json({
        ok: true,
        data: statusData,
      });
    }

    if (statusData?.pdfReady && !req.body?.forceRebuild) {
      setNoCacheHeaders(res);
      return res.json({ ok: true, data: statusData });
    }

    if (statusData?.pdfProcessing && !req.body?.forceRebuild) {
      setNoCacheHeaders(res);
      return res.status(202).json({ ok: true, data: statusData });
    }

    const result = await buildPdfForUser(userId);
    const resultData = result?.data || null;

    setNoCacheHeaders(res);

    if (resultData?.actions?.shouldPoll || resultData?.pdfProcessing) {
      return res.status(202).json({ ok: true, data: resultData });
    }

    const freshRoot = await findRoot(userId);
    const finalPayload = buildResultFromRoot(freshRoot)?.data || resultData || null;
    return res.json({ ok: true, data: finalPayload });
  } catch (e) {
    console.error('[mcp/context/pdf/build] error:', e);

    const code = e?.code || e?.message || 'MCP_SIGNAL_PDF_BUILD_FAILED';

    if (code === 'MCP_ROOT_NOT_FOUND') {
      return res.status(404).json({ ok: false, error: code });
    }

    if (code === 'MCP_CONTEXT_NOT_READY' || code === 'MCP_SIGNAL_NOT_VALID_FOR_PDF') {
      const latestRoot = await findRoot(userId).catch(() => null);
      const payload = latestRoot ? (buildResultFromRoot(latestRoot)?.data || null) : null;

      setNoCacheHeaders(res);
      return res.status(202).json({
        ok: true,
        data: payload,
      });
    }

    return res.status(500).json({
      ok: false,
      error: code || 'MCP_SIGNAL_PDF_BUILD_FAILED',
    });
  }
});

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

    const shareState = await syncUserVersionedLink(userId).catch(async () => {
      return await findUserShareState(userId);
    });

    const payload = buildResultFromRoot(root)?.data || null;
    setNoCacheHeaders(res);

    return res.json({
      ok: true,
      data: {
        ...payload,
        hasShareLink: !!(shareState?.mcpShareEnabled && shareState?.mcpShareToken),
        shareUrl:
          shareState?.mcpShareEnabled && shareState?.mcpShareToken
            ? (safeStr(shareState?.mcpShareShortUrl).trim() || buildShortShareUrl(shareState.mcpShareToken))
            : null,
        shareShortUrl:
          shareState?.mcpShareEnabled && shareState?.mcpShareToken
            ? (safeStr(shareState?.mcpShareShortUrl).trim() || buildShortShareUrl(shareState.mcpShareToken))
            : null,
        shareApiUrl:
          shareState?.mcpShareEnabled && shareState?.mcpShareToken
            ? buildApiShareUrl(shareState.mcpShareToken, normalizeProvider(shareState?.mcpShareProvider || 'chatgpt'))
            : null,
        shareVersionedUrl:
          shareState?.mcpShareEnabled && shareState?.mcpShareToken
            ? (safeStr(shareState?.mcpShareVersionedUrl).trim() || null)
            : null,
        shareToken:
          shareState?.mcpShareEnabled && shareState?.mcpShareToken
            ? shareState.mcpShareToken
            : null,
        shareProvider: normalizeProvider(shareState?.mcpShareProvider || 'chatgpt'),
        shareVersion: shareState?.mcpShareVersion || null,
        shareSnapshotId: shareState?.mcpShareSnapshotId || null,
        shareCreatedAt: shareState?.mcpShareCreatedAt || null,
        shareRevokedAt: shareState?.mcpShareRevokedAt || null,
      },
    });
  } catch (e) {
    console.error('[mcp/context/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_STATUS_FAILED' });
  }
});

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

    const payload = buildResultFromRoot(root);
    const statusData = payload?.data || {};
    const preferredPayload = getPreferredPayloadForShare(root);
    const signalPayload = preferredPayload?.payload || null;

    if (!signalPayload || !statusData?.signalComplete || !!statusData?.needSignalRebuild) {
      return res.status(409).json({
        ok: false,
        error: !!statusData?.needSignalRebuild ? 'MCP_CONTEXT_STALE_REBUILD_REQUIRED' : 'MCP_CONTEXT_NOT_READY',
        data: statusData,
      });
    }

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: signalPayload,
      meta: {
        status: statusData?.status || 'done',
        progress: statusData?.progress || 100,
        stage: statusData?.stage || 'completed',
        snapshotId: statusData?.snapshotId || root?.latestSnapshotId || null,
        sourceSnapshots: statusData?.sourceSnapshots || null,
        contextRangeDays: statusData?.contextRangeDays || null,
        storageRangeDays: statusData?.storageRangeDays || null,
        usedOpenAI: !!statusData?.usedOpenAI,
        model: statusData?.model || null,
        generatedAt: statusData?.finishedAt || statusData?.signal?.finishedAt || null,
        hasPdf: !!statusData?.hasPdf,
        signalReadyForPdf: !!statusData?.signalReadyForPdf,
        preferredPayloadForPdf: preferredPayload?.kind || null,
        pdfReady: !!statusData?.pdfReady,
        pdfProcessing: !!statusData?.pdfProcessing,
        canGeneratePdf: !!statusData?.canGeneratePdf,
        canDownloadPdf: !!statusData?.canDownloadPdf,
        uiMode: statusData?.uiMode || null,
        buildAttemptId: statusData?.buildAttemptId || null,
        signalRunId: statusData?.signalRunId || null,
        sourceFingerprint: statusData?.sourceFingerprint || null,
        currentSourceFingerprint: statusData?.currentSourceFingerprint || null,
        connectionFingerprint: statusData?.connectionFingerprint || null,
        needSignalRebuild: !!statusData?.needSignalRebuild,
        needPdfRebuild: !!statusData?.needPdfRebuild,
      },
    });
  } catch (e) {
    console.error('[mcp/context/latest] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_LATEST_FAILED' });
  }
});

router.get('/pdf/download', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const statusData = buildResultFromRoot(root)?.data || null;
    const pdf = statusData?.pdf || null;

    if (!statusData?.canDownloadPdf || !pdf?.ready) {
      return res.status(409).json({
        ok: false,
        error: !!statusData?.needSignalRebuild || !!statusData?.needPdfRebuild
          ? 'MCP_SIGNAL_PDF_STALE_REBUILD_REQUIRED'
          : 'MCP_SIGNAL_PDF_NOT_READY',
        data: statusData,
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

router.get('/pdf/status', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const statusData = buildResultFromRoot(root)?.data || null;
    setNoCacheHeaders(res);

    return res.json({
      ok: true,
      data: {
        ...(statusData?.pdf || {}),
        staleSignal: !!statusData?.staleSignal,
        stalePdf: !!statusData?.stalePdf,
        needSignalRebuild: !!statusData?.needSignalRebuild,
        needsSignalRebuild: !!statusData?.needSignalRebuild,
        needPdfRebuild: !!statusData?.needPdfRebuild,
        needsPdfRebuild: !!statusData?.needPdfRebuild,
        currentSourceFingerprint: statusData?.currentSourceFingerprint || null,
        currentSourcesSnapshot: statusData?.currentSourcesSnapshot || null,
        pdfReady: !!statusData?.pdfReady,
        pdfProcessing: !!statusData?.pdfProcessing,
        pdfFailed: !!statusData?.pdfFailed,
        canGeneratePdf: !!statusData?.canGeneratePdf,
        canDownloadPdf: !!statusData?.canDownloadPdf,
        uiMode: statusData?.uiMode || 'signal_building',
        signalRunId: statusData?.signalRunId || null,
        buildAttemptId: statusData?.buildAttemptId || null,
        runtime: statusData?.runtime || null,
      },
    });
  } catch (e) {
    console.error('[mcp/context/pdf/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_SIGNAL_PDF_STATUS_FAILED' });
  }
});

router.post('/link', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const provider = normalizeProvider(req.body?.provider);
    const root = await findRoot(userId);

    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const statusData = buildResultFromRoot(root)?.data || null;
    if (!statusData?.signalComplete || !!statusData?.needSignalRebuild) {
      return res.status(409).json({
        ok: false,
        error: !!statusData?.needSignalRebuild ? 'MCP_CONTEXT_STALE_REBUILD_REQUIRED' : 'MCP_CONTEXT_NOT_READY',
      });
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
    const version = getVersionSeedFromStatus(statusData, root);
    const snapshotId = safeStr(statusData?.snapshotId || root?.latestSnapshotId).trim() || null;
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

    const root = await findRoot(user._id);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_FOUND' });
    }

    const statusData = buildResultFromRoot(root)?.data || null;
    if (!statusData?.signalComplete || !!statusData?.needSignalRebuild) {
      return res.status(409).json({
        ok: false,
        error: !!statusData?.needSignalRebuild
          ? 'SHARED_CONTEXT_STALE_REBUILD_REQUIRED'
          : 'SHARED_CONTEXT_NOT_READY',
      });
    }

    try {
      await syncUserVersionedLink(user._id, provider);
    } catch (syncErr) {
      console.error('[mcp/context/shared] syncUserVersionedLink warning:', syncErr);
    }

    const payload = buildSharedPayload(root, provider);
    if (!payload) {
      return res.status(409).json({
        ok: false,
        error: 'SHARED_CONTEXT_NOT_READY',
      });
    }

    setNoCacheHeaders(res);
    return res.json(payload);
  } catch (e) {
    console.error('[mcp/context/shared] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_SHARED_FAILED' });
  }
});

module.exports = router;