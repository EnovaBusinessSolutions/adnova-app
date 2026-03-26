// backend/routes/mcpContext.js
'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const McpData = require('../models/McpData');
const User = require('../models/User');
const SignalData = require('../models/SignalData');
const {
  findRoot,
  buildUnifiedContextForUser,
  buildPdfForUser,
} = require('../services/mcpContextBuilder');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const BUILD_ACTIVE_GUARD_MS = Number(process.env.MCP_CONTEXT_BUILD_ACTIVE_GUARD_MS || 180000);

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toNum(v, fallback = 0) {
  if (v == null || v === '') return fallback;
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

function stableSerialize(value) {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(stableSerialize(value)).digest('hex');
}

/**
 * Compat / fallback connection fingerprint helpers.
 * These remain useful as secondary guards, but they are no longer
 * the primary authority for Signal/PDF freshness.
 */
function normalizeSourceConnectionIdentityFromContainer(containerLike, source) {
  const container = containerLike || {};
  const s = container?.[source] || {};

  if (source === 'metaAds') {
    return {
      connected: !!s?.connected,
      accountId: safeStr(s?.accountId || '').trim() || null,
    };
  }

  if (source === 'googleAds') {
    return {
      connected: !!s?.connected,
      customerId: safeStr(s?.customerId || s?.accountId || '').trim() || null,
    };
  }

  if (source === 'ga4') {
    return {
      connected: !!s?.connected,
      propertyId: safeStr(s?.propertyId || '').trim() || null,
    };
  }

  return {
    connected: !!s?.connected,
  };
}

function buildConnectionStateSummaryFromContainer(container) {
  return {
    metaAds: normalizeSourceConnectionIdentityFromContainer(container, 'metaAds'),
    googleAds: normalizeSourceConnectionIdentityFromContainer(container, 'googleAds'),
    ga4: normalizeSourceConnectionIdentityFromContainer(container, 'ga4'),
  };
}

function buildConnectionFingerprintFromContainer(container) {
  return stableHash({
    version: 1,
    sources: buildConnectionStateSummaryFromContainer(container),
  });
}

function buildConnectionFingerprintsForRoot(root) {
  const rootSources = root?.sources || {};
  const unifiedSources = root?.aiContext?.unifiedBase?.sources || {};
  const fingerprints = new Set();

  if (rootSources && Object.keys(rootSources).length > 0) {
    fingerprints.add(buildConnectionFingerprintFromContainer(rootSources));
  }

  if (unifiedSources && Object.keys(unifiedSources).length > 0) {
    fingerprints.add(buildConnectionFingerprintFromContainer(unifiedSources));
  }

  return Array.from(fingerprints).filter(Boolean);
}

function buildConnectionFingerprintFromRoot(root) {
  const fingerprints = buildConnectionFingerprintsForRoot(root);
  return fingerprints[0] || '';
}

function getRootAiSignalPayload(root) {
  const state = root?.aiContext || {};
  return state?.signalPayload || state?.encodedPayload || null;
}

function getRootSignalConnectionFingerprint(root) {
  return safeStr(root?.aiContext?.connectionFingerprint || '').trim() || '';
}

function getRootSignalSourceFingerprint(root) {
  return safeStr(root?.aiContext?.sourceFingerprint || '').trim() || '';
}

function getRootCurrentSourceFingerprint(root) {
  return safeStr(root?.aiContext?.currentSourceFingerprint || '').trim() || '';
}

function getRootCurrentSourcesSnapshot(root) {
  return root?.aiContext?.currentSourcesSnapshot || null;
}

function deriveCurrentSourceFingerprintFromRoot(root) {
  const explicit = getRootCurrentSourceFingerprint(root);
  if (explicit) return explicit;

  const snapshot = getRootCurrentSourcesSnapshot(root);
  if (snapshot && typeof snapshot === 'object') {
    try {
      return stableHash(snapshot);
    } catch (_) {
      // ignore
    }
  }

  const signalFp = getRootSignalSourceFingerprint(root);
  if (signalFp) return signalFp;

  return '';
}

function getPdfConnectionFingerprint(pdf) {
  return safeStr(pdf?.connectionFingerprint || '').trim() || '';
}

function getPdfSourceFingerprint(pdf) {
  return safeStr(pdf?.sourceFingerprint || '').trim() || '';
}

function rootSignalLooksStale(root) {
  if (!root) return false;

  const state = root?.aiContext || {};
  if (state?.needsSignalRebuild === true) return true;

  const currentSourceFingerprint = deriveCurrentSourceFingerprintFromRoot(root);
  const signalSourceFingerprint = getRootSignalSourceFingerprint(root);

  if (currentSourceFingerprint && signalSourceFingerprint) {
    return currentSourceFingerprint !== signalSourceFingerprint;
  }

  const storedConnectionFingerprint = getRootSignalConnectionFingerprint(root);
  if (!storedConnectionFingerprint) return false;

  const candidateFingerprints = buildConnectionFingerprintsForRoot(root);
  if (!candidateFingerprints.length) return false;

  return !candidateFingerprints.includes(storedConnectionFingerprint);
}

function rootPdfLooksStale(root) {
  if (!root) return false;

  const state = root?.aiContext || {};
  const pdf = state?.pdf || {};

  if (state?.needsPdfRebuild === true) return true;
  if (!!pdf?.stale) return true;
  if (safeStr(pdf?.status) !== 'ready') return false;

  const currentSourceFingerprint = deriveCurrentSourceFingerprintFromRoot(root);
  const signalSourceFingerprint = getRootSignalSourceFingerprint(root);
  const pdfConnectionFingerprint = getPdfConnectionFingerprint(pdf);
  const pdfSourceFingerprint = getPdfSourceFingerprint(pdf);
  const candidateFingerprints = buildConnectionFingerprintsForRoot(root);

  if (
    currentSourceFingerprint &&
    pdfSourceFingerprint &&
    currentSourceFingerprint !== pdfSourceFingerprint
  ) {
    return true;
  }

  if (
    signalSourceFingerprint &&
    pdfSourceFingerprint &&
    signalSourceFingerprint !== pdfSourceFingerprint
  ) {
    return true;
  }

  if (
    currentSourceFingerprint &&
    signalSourceFingerprint &&
    currentSourceFingerprint !== signalSourceFingerprint
  ) {
    return true;
  }

  if (
    pdfConnectionFingerprint &&
    candidateFingerprints.length > 0 &&
    !candidateFingerprints.includes(pdfConnectionFingerprint)
  ) {
    return true;
  }

  return false;
}

function isRecentProcessingState(ai) {
  if (!ai || safeStr(ai?.status) !== 'processing' || !safeStr(ai?.buildAttemptId).trim()) {
    return false;
  }
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
    sourceFingerprint: safeStr(state?.sourceFingerprint || '').trim() || null,
    connectionFingerprint: safeStr(state?.connectionFingerprint || '').trim() || null,
    processingStartedAt: state?.processingStartedAt || null,
    processingHeartbeatAt: state?.processingHeartbeatAt || null,
    stale: !!state?.stale,
    staleReason: state?.staleReason || null,
    error: state?.error || null,
  };
}

function makeStalePdfState(pdf, reason = 'STALE_SIGNAL_OR_SOURCE_CHANGE') {
  const base = normalizePdfState(pdf);
  return {
    ...base,
    status: 'idle',
    stage: 'idle',
    progress: 0,
    ready: false,
    downloadUrl: null,
    error: null,
    stale: true,
    staleReason: reason,
  };
}

function normalizeSignalRun(run) {
  if (!run || typeof run !== 'object') return null;

  const pdf = normalizePdfState(run?.pdf || null);
  const sources = run?.sources || {};
  const meta = run?.meta || {};

  return {
    _id: run?._id || null,
    isCurrent: !!run?.isCurrent,
    supersededAt: run?.supersededAt || null,
    supersededByAttemptId: run?.supersededByAttemptId || null,
    status: safeStr(run?.status) || 'idle',
    stage: safeStr(run?.stage) || 'idle',
    progress: toNum(run?.progress, 0),
    startedAt: run?.startedAt || null,
    finishedAt: run?.finishedAt || null,
    failedAt: run?.failedAt || null,
    snapshotId: run?.snapshotId || null,
    contextRangeDays: toNum(run?.contextRangeDays) || null,
    storageRangeDays: toNum(run?.storageRangeDays) || null,
    usedOpenAI: !!run?.usedOpenAI,
    model: run?.model || null,
    error: run?.error || null,
    errorCode: run?.errorCode || null,
    errorStage: run?.errorStage || null,
    buildAttemptId: run?.buildAttemptId || null,
    signalRunId: run?.signalRunId || null,
    signalComplete: !!run?.signalComplete,
    hasSignal: !!run?.hasSignal,
    signalValidForPdf: !!run?.signalValidForPdf,
    sourceSnapshots: sources?.sourceSnapshots || null,
    sourcesStatus: sources?.sourcesStatus || null,
    connectedSources: Array.isArray(sources?.connectedSources) ? sources.connectedSources : [],
    usableSources: Array.isArray(sources?.usableSources) ? sources.usableSources : [],
    pendingConnectedSources: Array.isArray(sources?.pendingConnectedSources) ? sources.pendingConnectedSources : [],
    failedSources: Array.isArray(sources?.failedSources) ? sources.failedSources : [],
    pdf,
    meta: {
      ...meta,
      connectionFingerprint: safeStr(meta?.connectionFingerprint || '').trim() || null,
      sourceFingerprint: safeStr(meta?.sourceFingerprint || '').trim() || null,
    },
  };
}

async function findLatestSignalRunForUser(userId) {
  if (!userId) return null;
  try {
    const run = await SignalData.findLatestForUser(userId);
    return normalizeSignalRun(run);
  } catch (e) {
    console.error('[mcp/context] findLatestSignalRunForUser warning:', e?.message || e);
    return null;
  }
}

async function findCurrentSignalRunForUser(userId) {
  if (!userId) return null;
  try {
    const run = await SignalData.findCurrentRunForUser(userId);
    return normalizeSignalRun(run);
  } catch (e) {
    console.error('[mcp/context] findCurrentSignalRunForUser warning:', e?.message || e);
    return null;
  }
}

async function findActiveSignalRunForUser(userId) {
  if (!userId) return null;
  try {
    const run = await SignalData.findActiveRunForUser(userId);
    return normalizeSignalRun(run);
  } catch (e) {
    console.error('[mcp/context] findActiveSignalRunForUser warning:', e?.message || e);
    return null;
  }
}

async function findSignalRunByAttempt(userId, buildAttemptId) {
  const cleanAttempt = safeStr(buildAttemptId).trim();
  if (!userId || !cleanAttempt) return null;

  try {
    const run = await SignalData.findByAttempt(userId, cleanAttempt);
    return normalizeSignalRun(run);
  } catch (e) {
    console.error('[mcp/context] findSignalRunByAttempt warning:', e?.message || e);
    return null;
  }
}

function isSignalRunCompatibleWithRoot(signalRun, root) {
  if (!signalRun) return false;
  if (!root) return true;

  const rootState = root?.aiContext || {};
  const rootAttemptId = safeStr(rootState?.buildAttemptId).trim();
  const runAttemptId = safeStr(signalRun?.buildAttemptId).trim();

  if (rootAttemptId && runAttemptId) {
    if (rootAttemptId !== runAttemptId) return false;
  } else if (rootAttemptId && !runAttemptId) {
    return false;
  }

  const rootSnapshotId = safeStr(rootState?.snapshotId || root?.latestSnapshotId).trim();
  const runSnapshotId = safeStr(signalRun?.snapshotId).trim();

  if (rootSnapshotId && runSnapshotId && rootSnapshotId !== runSnapshotId) {
    return false;
  }

  const rootCurrentSourceFingerprint = deriveCurrentSourceFingerprintFromRoot(root);
  const rootSignalSourceFingerprint = getRootSignalSourceFingerprint(root);
  const runSourceFingerprint = safeStr(signalRun?.meta?.sourceFingerprint || '').trim();

  if (rootCurrentSourceFingerprint && runSourceFingerprint && rootCurrentSourceFingerprint !== runSourceFingerprint) {
    return false;
  }

  if (rootSignalSourceFingerprint && runSourceFingerprint && rootSignalSourceFingerprint !== runSourceFingerprint) {
    return false;
  }

  const candidateFingerprints = buildConnectionFingerprintsForRoot(root);
  const rootConnectionFingerprint = safeStr(rootState?.connectionFingerprint || '').trim();
  const runConnectionFingerprint = safeStr(signalRun?.meta?.connectionFingerprint || '').trim();

  if (
    rootConnectionFingerprint &&
    candidateFingerprints.length > 0 &&
    !candidateFingerprints.includes(rootConnectionFingerprint)
  ) {
    return false;
  }

  if (
    runConnectionFingerprint &&
    candidateFingerprints.length > 0 &&
    !candidateFingerprints.includes(runConnectionFingerprint)
  ) {
    return false;
  }

  return true;
}

async function findPreferredSignalRunForUser(userId, root = null) {
  if (!userId) return null;

  const effectiveRoot = root || await findPreferredContextRootForUser(userId);
  const rootState = effectiveRoot?.aiContext || {};
  const rootAttemptId = safeStr(rootState?.buildAttemptId).trim();

  const currentRun = await findCurrentSignalRunForUser(userId);
  if (currentRun && isSignalRunCompatibleWithRoot(currentRun, effectiveRoot)) {
    if (!rootAttemptId || safeStr(currentRun.buildAttemptId).trim() === rootAttemptId) {
      return currentRun;
    }
  }

  if (rootAttemptId) {
    const exact = await findSignalRunByAttempt(userId, rootAttemptId);
    if (!exact) return null;
    return isSignalRunCompatibleWithRoot(exact, effectiveRoot) ? exact : null;
  }

  const active = await findActiveSignalRunForUser(userId);
  if (active && isSignalRunCompatibleWithRoot(active, effectiveRoot)) {
    return active;
  }

  const latest = await findLatestSignalRunForUser(userId);
  if (latest && isSignalRunCompatibleWithRoot(latest, effectiveRoot)) {
    return latest;
  }

  return null;
}

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

  if (!root) return null;
  if (rootSignalLooksStale(root)) return null;

  return root;
}

async function findPreferredContextRootForUser(userId) {
  if (!userId) return null;

  const currentRoot = await findRoot(userId);
  if (!currentRoot) return null;

  if (currentRoot?.aiContext && isRecentProcessingState(currentRoot.aiContext)) {
    return currentRoot;
  }

  if (rootSignalLooksStale(currentRoot)) {
    return currentRoot;
  }

  return (await findLatestContextRootForUser(userId)) || currentRoot || null;
}

function getVersionSeedFromRoot(root) {
  const state = root?.aiContext || {};
  const signalPayload = state?.signalPayload || state?.encodedPayload || null;

  return (
    safeStr(state?.currentSourceFingerprint).trim() ||
    safeStr(state?.sourceFingerprint).trim() ||
    safeStr(state?.snapshotId).trim() ||
    safeStr(root?.latestSnapshotId).trim() ||
    safeStr(state?.finishedAt).trim() ||
    safeStr(signalPayload?.generatedAt).trim() ||
    safeStr(root?.updatedAt).trim() ||
    String(Date.now())
  );
}

function chooseStatusValue(primary, fallback) {
  const clean = safeStr(primary).trim();
  return clean || fallback;
}

function deriveUiFlags({
  signalPayload,
  signalComplete,
  needSignalRebuild,
  needPdfRebuild,
  pdf,
  currentSourceFingerprint,
  signalSourceFingerprint,
}) {
  const pdfSourceFingerprint = safeStr(pdf?.sourceFingerprint || '').trim() || '';
  const pdfReadyRaw = safeStr(pdf?.status) === 'ready';
  const pdfProcessing = !needSignalRebuild && safeStr(pdf?.status) === 'processing';
  const pdfFailed = !needSignalRebuild && safeStr(pdf?.status) === 'failed';

  const signalReadyForPdf =
    !needSignalRebuild &&
    !!signalPayload &&
    !!signalComplete;

  const pdfAligned =
    !!pdfReadyRaw &&
    !needSignalRebuild &&
    !needPdfRebuild &&
    !!currentSourceFingerprint &&
    !!signalSourceFingerprint &&
    !!pdfSourceFingerprint &&
    currentSourceFingerprint === signalSourceFingerprint &&
    currentSourceFingerprint === pdfSourceFingerprint &&
    !pdf?.stale;

  const pdfReady = !!pdfAligned;
  const canGeneratePdf = !!signalReadyForPdf && !pdfAligned && !pdfProcessing;
  const canDownloadPdf = !!pdfAligned;

  const uiMode =
    pdfReady ? 'pdf_ready' :
    pdfProcessing ? 'pdf_building' :
    signalReadyForPdf ? 'signal_ready' :
    'signal_building';

  return {
    signalReadyForPdf,
    pdfReady,
    pdfProcessing,
    pdfFailed,
    canGeneratePdf,
    canDownloadPdf,
    uiMode,
    pdfAligned,
  };
}

function buildStatusResponse(root, shareState = null, signalRun = null) {
  const state = root?.aiContext || {};

  const staleSignal = rootSignalLooksStale(root);
  const stalePdf = rootPdfLooksStale(root);

  const compatibleRun = isSignalRunCompatibleWithRoot(signalRun, root)
    ? normalizeSignalRun(signalRun)
    : null;

  const currentSourceFingerprint =
    deriveCurrentSourceFingerprintFromRoot(root) ||
    safeStr(compatibleRun?.meta?.sourceFingerprint || '').trim() ||
    null;

  const signalSourceFingerprint =
    !staleSignal
      ? (safeStr(state?.sourceFingerprint || '').trim() || null)
      : null;

  const needSignalRebuild =
    !!state?.needsSignalRebuild || !!staleSignal;

  const rootSignalComplete =
    !needSignalRebuild &&
    !!state?.signalComplete &&
    !!getRootAiSignalPayload(root) &&
    safeStr(state?.status).trim().toLowerCase() === 'done' &&
    safeStr(state?.stage).trim().toLowerCase() === 'completed';

  const rootSignalValidForPdf =
    !needSignalRebuild &&
    !!state?.signalValidForPdf &&
    !!getRootAiSignalPayload(root);

  const authoritativeSignalComplete =
    compatibleRun && !needSignalRebuild
      ? !!compatibleRun.signalComplete
      : rootSignalComplete;

  const authoritativeSignalValidForPdf =
    compatibleRun && !needSignalRebuild
      ? !!compatibleRun.signalValidForPdf
      : rootSignalValidForPdf;

  const signalPayload = needSignalRebuild
    ? null
    : getRootAiSignalPayload(root);

  const needPdfRebuild =
    !!state?.needsPdfRebuild ||
    !!stalePdf ||
    !!needSignalRebuild;

  const rootPdf = needSignalRebuild || needPdfRebuild
    ? makeStalePdfState(
        state?.pdf,
        needSignalRebuild ? 'STALE_SIGNAL' : 'STALE_PDF'
      )
    : normalizePdfState(state?.pdf);

  const pdf =
    compatibleRun?.pdf && (
      compatibleRun.pdf.status !== 'idle' ||
      compatibleRun.pdf.progress > 0 ||
      compatibleRun.pdf.ready ||
      compatibleRun.pdf.error
    )
      ? compatibleRun.pdf
      : rootPdf;

  const shareEnabled =
    !!(shareState?.mcpShareEnabled && shareState?.mcpShareToken) &&
    !needSignalRebuild &&
    !!signalPayload;

  const shareToken = shareEnabled ? shareState?.mcpShareToken || null : null;
  const shareProvider = normalizeProvider(shareState?.mcpShareProvider || 'chatgpt');
  const shareShortUrl = shareEnabled
    ? safeStr(shareState?.mcpShareShortUrl).trim() || buildShortShareUrl(shareToken)
    : null;
  const shareVersionedUrl = shareEnabled
    ? safeStr(shareState?.mcpShareVersionedUrl).trim() || null
    : null;

  const status = chooseStatusValue(compatibleRun?.status, state?.status || 'idle');
  const stage = chooseStatusValue(compatibleRun?.stage, state?.stage || 'idle');

  const signalComplete = authoritativeSignalComplete;
  const signalValidForPdf = authoritativeSignalValidForPdf;

  const uiFlags = deriveUiFlags({
    signalPayload,
    signalComplete: signalValidForPdf || signalComplete,
    needSignalRebuild,
    needPdfRebuild,
    pdf,
    currentSourceFingerprint,
    signalSourceFingerprint,
  });

  return {
    ok: true,
    data: {
      status,
      progress: compatibleRun
        ? toNum(compatibleRun?.progress, toNum(state?.progress, 0))
        : toNum(state?.progress, 0),
      stage,
      startedAt: compatibleRun?.startedAt || state?.startedAt || null,
      finishedAt: compatibleRun?.finishedAt || state?.finishedAt || null,
      snapshotId: compatibleRun?.snapshotId || state?.snapshotId || root?.latestSnapshotId || null,
      sourceSnapshots: compatibleRun?.sourceSnapshots || state?.sourceSnapshots || state?.unifiedBase?.sourceSnapshots || null,
      contextRangeDays: compatibleRun?.contextRangeDays || toNum(state?.contextRangeDays) || null,
      storageRangeDays: compatibleRun?.storageRangeDays || toNum(state?.storageRangeDays) || null,

      hasEncodedPayload: !needSignalRebuild && !!state?.encodedPayload,
      hasSignal: !!signalPayload,
      signalReady: !!signalPayload,
      signalComplete,
      signalValidForPdf,
      signalReadyForPdf: uiFlags.signalReadyForPdf,
      providerAgnostic: !!state?.encodedPayload?.providerAgnostic,

      usedOpenAI: compatibleRun ? !!compatibleRun?.usedOpenAI : !!state?.usedOpenAI,
      model: compatibleRun?.model || state?.model || null,
      error: compatibleRun?.error || state?.error || null,
      buildAttemptId: compatibleRun?.buildAttemptId || state?.buildAttemptId || null,
      signalRunId: compatibleRun?.signalRunId || null,

      sources: compatibleRun?.sourcesStatus || state?.sourcesStatus || null,
      connectedSources: Array.isArray(compatibleRun?.connectedSources)
        ? compatibleRun.connectedSources
        : [],
      usableSources: Array.isArray(compatibleRun?.usableSources)
        ? compatibleRun.usableSources
        : (Array.isArray(state?.usableSources) ? state.usableSources : []),
      pendingConnectedSources: Array.isArray(compatibleRun?.pendingConnectedSources)
        ? compatibleRun.pendingConnectedSources
        : (Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : []),
      failedSources: Array.isArray(compatibleRun?.failedSources)
        ? compatibleRun.failedSources
        : [],

      sourceFingerprint: signalSourceFingerprint,
      currentSourcesSnapshot: state?.currentSourcesSnapshot || null,
      currentSourceFingerprint,
      connectionFingerprint: safeStr(state?.connectionFingerprint).trim() || null,

      staleSignal: !!staleSignal,
      stalePdf: !!stalePdf,
      needSignalRebuild: !!needSignalRebuild,
      needsSignalRebuild: !!needSignalRebuild,
      needPdfRebuild: !!needPdfRebuild,
      needsPdfRebuild: !!needPdfRebuild,
      effectiveSourcesChanged:
        !!currentSourceFingerprint &&
        !!signalSourceFingerprint &&
        currentSourceFingerprint !== signalSourceFingerprint,

      hasPdf: uiFlags.pdfReady,
      pdfReady: uiFlags.pdfReady,
      pdfProcessing: uiFlags.pdfProcessing,
      pdfFailed: uiFlags.pdfFailed,
      canGeneratePdf: uiFlags.canGeneratePdf,
      canDownloadPdf: uiFlags.canDownloadPdf,
      uiMode: uiFlags.uiMode,

      pdf,

      hasShareLink: shareEnabled,
      shareUrl: shareShortUrl,
      shareShortUrl,
      shareApiUrl: shareEnabled ? buildApiShareUrl(shareToken, shareProvider) : null,
      shareVersionedUrl,
      shareToken,
      shareProvider,
      shareVersion: shareEnabled ? (shareState?.mcpShareVersion || null) : null,
      shareSnapshotId: shareEnabled ? (shareState?.mcpShareSnapshotId || null) : null,
      shareCreatedAt: shareEnabled ? (shareState?.mcpShareCreatedAt || null) : null,
      shareRevokedAt: shareState?.mcpShareRevokedAt || null,
    },
  };
}

function buildSharedPayload(root, provider, signalRun = null) {
  const state = root?.aiContext || {};
  const compatibleRun = isSignalRunCompatibleWithRoot(signalRun, root)
    ? normalizeSignalRun(signalRun)
    : null;

  const rootSignalComplete =
    !!state?.signalComplete &&
    !!getRootAiSignalPayload(root) &&
    !rootSignalLooksStale(root) &&
    safeStr(state?.status).trim().toLowerCase() === 'done' &&
    safeStr(state?.stage).trim().toLowerCase() === 'completed';

  const signalComplete = compatibleRun
    ? !!compatibleRun?.signalComplete
    : rootSignalComplete;

  const payload = signalComplete
    ? (state?.signalPayload || state?.encodedPayload || null)
    : null;

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
      sourceFingerprint: safeStr(state?.sourceFingerprint || '').trim() || null,
      currentSourceFingerprint: safeStr(state?.currentSourceFingerprint || '').trim() || null,
      connectionFingerprint: safeStr(state?.connectionFingerprint || '').trim() || null,
      buildAttemptId: compatibleRun?.buildAttemptId || state?.buildAttemptId || null,
      signalRunId: compatibleRun?.signalRunId || null,
    },
  };
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

  const latestRoot = await findPreferredContextRootForUser(userId);
  const signalRun = await findPreferredSignalRunForUser(userId, latestRoot);
  const statusData = buildStatusResponse(latestRoot, null, signalRun)?.data || null;

  if (!statusData?.signalComplete || !!statusData?.needSignalRebuild || rootSignalLooksStale(latestRoot)) {
    return user;
  }

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
      const status = safeStr(resultData?.status);
      const hasSignal = !!resultData?.hasSignal;
      const staleSignal = !!resultData?.staleSignal;
      const needSignalRebuild = !!resultData?.needSignalRebuild;

      if ((status === 'done' || hasSignal) && !staleSignal && !needSignalRebuild && !resultData?.pendingConnectedSources?.length) {
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

    const signalRun = await findPreferredSignalRunForUser(userId, root);
    const statusPayload = buildStatusResponse(root, null, signalRun)?.data || null;

    if (!statusPayload?.signalReadyForPdf) {
      setNoCacheHeaders(res);
      return res.status(202).json({
        ok: true,
        data: statusPayload || {
          status: root?.aiContext?.status || 'idle',
          progress: root?.aiContext?.progress || 0,
          stage: root?.aiContext?.stage || 'idle',
          pdf: normalizePdfState(root?.aiContext?.pdf),
          hasSignal: false,
          hasPdf: false,
          signalReadyForPdf: false,
          pdfReady: false,
          pdfProcessing: false,
          pdfFailed: false,
          canGeneratePdf: false,
          canDownloadPdf: false,
          uiMode: 'signal_building',
          needSignalRebuild: true,
          needPdfRebuild: true,
        },
      });
    }

    if (statusPayload?.pdfReady && !req.body?.forceRebuild) {
      setNoCacheHeaders(res);
      return res.json({
        ok: true,
        data: statusPayload,
      });
    }

    if (statusPayload?.pdfProcessing && !req.body?.forceRebuild) {
      setNoCacheHeaders(res);
      return res.status(202).json({
        ok: true,
        data: statusPayload,
      });
    }

    const result = await buildPdfForUser(userId);
    const resultData = result?.data || null;

    setNoCacheHeaders(res);

    if (resultData?.pdfProcessing) {
      return res.status(202).json({
        ok: true,
        data: resultData,
      });
    }

    const freshRoot = await findPreferredContextRootForUser(userId);
    const freshRun = await findPreferredSignalRunForUser(userId, freshRoot);

    return res.json({
      ok: true,
      data: resultData || buildStatusResponse(freshRoot, null, freshRun)?.data || null,
    });
  } catch (e) {
    console.error('[mcp/context/pdf/build] error:', e);

    const code = e?.code || e?.message || 'MCP_SIGNAL_PDF_BUILD_FAILED';

    if (code === 'MCP_ROOT_NOT_FOUND') {
      return res.status(404).json({ ok: false, error: code });
    }

    if (
      code === 'MCP_CONTEXT_NOT_READY' ||
      code === 'MCP_SIGNAL_NOT_VALID_FOR_PDF'
    ) {
      const latestRoot = await findPreferredContextRootForUser(userId).catch(() => null);
      const signalRun = await findPreferredSignalRunForUser(userId, latestRoot).catch(() => null);
      setNoCacheHeaders(res);

      return res.status(202).json({
        ok: true,
        data: latestRoot ? (buildStatusResponse(latestRoot, null, signalRun)?.data || null) : {
          status: 'idle',
          progress: 0,
          stage: 'idle',
          pdf: normalizePdfState(null),
          hasSignal: false,
          hasPdf: false,
          signalReadyForPdf: false,
          pdfReady: false,
          pdfProcessing: false,
          pdfFailed: false,
          canGeneratePdf: false,
          canDownloadPdf: false,
          uiMode: 'signal_building',
          needSignalRebuild: true,
          needPdfRebuild: true,
        },
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

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const signalRun = await findPreferredSignalRunForUser(userId, root);

    const shareState = await syncUserVersionedLink(userId).catch(async () => {
      return await findUserShareState(userId);
    });

    setNoCacheHeaders(res);
    return res.json(buildStatusResponse(root, shareState, signalRun));
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

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const signalRun = await findPreferredSignalRunForUser(userId, root);
    const state = root?.aiContext || {};
    const staleSignal = rootSignalLooksStale(root);
    const statusData = buildStatusResponse(root, null, signalRun)?.data || {};
    const signalPayload = statusData?.signalComplete
      ? getRootAiSignalPayload(root)
      : null;

    if (!signalPayload || !statusData?.signalComplete || !!statusData?.needSignalRebuild) {
      return res.status(409).json({
        ok: false,
        error: staleSignal || !!statusData?.needSignalRebuild ? 'MCP_CONTEXT_STALE_REBUILD_REQUIRED' : 'MCP_CONTEXT_NOT_READY',
        data: statusData || {
          status: state?.status || 'idle',
          progress: state?.progress || 0,
          stage: state?.stage || 'idle',
          pendingConnectedSources: Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : [],
          staleSignal,
          needSignalRebuild: true,
        },
      });
    }

    setNoCacheHeaders(res);
    return res.json({
      ok: true,
      data: signalPayload,
      meta: {
        status: statusData?.status || state?.status || 'done',
        progress: toNum(statusData?.progress, state?.progress || 100),
        stage: statusData?.stage || state?.stage || 'completed',
        snapshotId: statusData?.snapshotId || state?.snapshotId || root?.latestSnapshotId || null,
        sourceSnapshots: statusData?.sourceSnapshots || state?.sourceSnapshots || signalPayload?.sourceSnapshots || null,
        contextRangeDays: toNum(statusData?.contextRangeDays) || toNum(state?.contextRangeDays) || null,
        storageRangeDays: toNum(statusData?.storageRangeDays) || toNum(state?.storageRangeDays) || null,
        usedOpenAI: 'usedOpenAI' in statusData ? !!statusData.usedOpenAI : !!state?.usedOpenAI,
        model: statusData?.model || state?.model || null,
        generatedAt: statusData?.finishedAt || state?.finishedAt || null,
        hasPdf: !!statusData?.hasPdf,
        signalReadyForPdf: !!statusData?.signalReadyForPdf,
        pdfReady: !!statusData?.pdfReady,
        pdfProcessing: !!statusData?.pdfProcessing,
        canGeneratePdf: !!statusData?.canGeneratePdf,
        canDownloadPdf: !!statusData?.canDownloadPdf,
        uiMode: statusData?.uiMode || null,
        buildAttemptId: statusData?.buildAttemptId || state?.buildAttemptId || null,
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

    const root = await findPreferredContextRootForUser(userId);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const signalRun = await findPreferredSignalRunForUser(userId, root);
    const state = root?.aiContext || {};
    const staleSignal = rootSignalLooksStale(root);
    const stalePdf = rootPdfLooksStale(root);

    const runPdf = signalRun?.pdf && signalRun?.pdf.status !== 'idle' && isSignalRunCompatibleWithRoot(signalRun, root)
      ? signalRun.pdf
      : null;

    const pdf = (staleSignal || stalePdf)
      ? makeStalePdfState(state?.pdf, staleSignal ? 'STALE_SIGNAL' : 'STALE_PDF')
      : (runPdf || normalizePdfState(state?.pdf));

    if (!pdf.ready) {
      return res.status(409).json({
        ok: false,
        error: staleSignal || stalePdf ? 'MCP_SIGNAL_PDF_STALE_REBUILD_REQUIRED' : 'MCP_SIGNAL_PDF_NOT_READY',
        data: {
          status: signalRun?.status || state?.status || 'idle',
          progress: signalRun ? signalRun.progress : (state?.progress || 0),
          stage: signalRun?.stage || state?.stage || 'idle',
          pendingConnectedSources: Array.isArray(signalRun?.pendingConnectedSources)
            ? signalRun.pendingConnectedSources
            : (Array.isArray(state?.pendingConnectedSources) ? state.pendingConnectedSources : []),
          staleSignal,
          stalePdf,
          needSignalRebuild: !!state?.needsSignalRebuild || staleSignal,
          needPdfRebuild: !!state?.needsPdfRebuild || stalePdf || staleSignal,
          pdf,
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

    const signalRun = await findPreferredSignalRunForUser(userId, root);
    const state = root?.aiContext || {};
    const staleSignal = rootSignalLooksStale(root);
    const stalePdf = rootPdfLooksStale(root);

    const authoritativeRun = isSignalRunCompatibleWithRoot(signalRun, root)
      ? signalRun
      : null;

    const pdf = (staleSignal || stalePdf)
      ? makeStalePdfState(state?.pdf, staleSignal ? 'STALE_SIGNAL' : 'STALE_PDF')
      : (
          authoritativeRun?.pdf &&
          authoritativeRun?.pdf.status !== 'idle'
            ? authoritativeRun.pdf
            : normalizePdfState(state?.pdf)
        );

    const rootSignalComplete =
      !staleSignal &&
      !!state?.signalComplete &&
      !!getRootAiSignalPayload(root) &&
      safeStr(state?.status).trim().toLowerCase() === 'done' &&
      safeStr(state?.stage).trim().toLowerCase() === 'completed';

    const signalComplete = authoritativeRun
      ? !!authoritativeRun?.signalComplete
      : rootSignalComplete;

    const needSignalRebuild = !!state?.needsSignalRebuild || !!staleSignal;
    const needPdfRebuild = !!state?.needsPdfRebuild || !!stalePdf || !!needSignalRebuild;

    const uiFlags = deriveUiFlags({
      signalPayload: needSignalRebuild ? null : getRootAiSignalPayload(root),
      signalComplete,
      needSignalRebuild,
      needPdfRebuild,
      pdf,
      currentSourceFingerprint: deriveCurrentSourceFingerprintFromRoot(root) || null,
      signalSourceFingerprint: getRootSignalSourceFingerprint(root) || null,
    });

    setNoCacheHeaders(res);

    return res.json({
      ok: true,
      data: {
        ...pdf,
        staleSignal,
        stalePdf,
        needSignalRebuild,
        needsSignalRebuild: needSignalRebuild,
        needPdfRebuild,
        needsPdfRebuild: needPdfRebuild,
        currentSourceFingerprint: deriveCurrentSourceFingerprintFromRoot(root) || null,
        currentSourcesSnapshot: state?.currentSourcesSnapshot || null,
        pdfReady: uiFlags.pdfReady,
        pdfProcessing: uiFlags.pdfProcessing,
        pdfFailed: uiFlags.pdfFailed,
        canGeneratePdf: uiFlags.canGeneratePdf,
        canDownloadPdf: uiFlags.canDownloadPdf,
        uiMode: uiFlags.uiMode,
        signalRunId: authoritativeRun?.signalRunId || null,
        buildAttemptId: authoritativeRun?.buildAttemptId || state?.buildAttemptId || null,
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

    const latestContextRoot = (await findPreferredContextRootForUser(userId)) || (await findRoot(userId));
    if (!latestContextRoot) {
      return res.status(404).json({ ok: false, error: 'MCP_ROOT_NOT_FOUND' });
    }

    const signalRun = await findPreferredSignalRunForUser(userId, latestContextRoot);
    const statusData = buildStatusResponse(latestContextRoot, null, signalRun)?.data || null;
    const staleSignal = rootSignalLooksStale(latestContextRoot);

    if (!statusData?.signalComplete || !!statusData?.needSignalRebuild) {
      return res.status(409).json({
        ok: false,
        error: staleSignal || !!statusData?.needSignalRebuild ? 'MCP_CONTEXT_STALE_REBUILD_REQUIRED' : 'MCP_CONTEXT_NOT_READY',
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

    const root = await findPreferredContextRootForUser(user._id);
    if (!root) {
      return res.status(404).json({ ok: false, error: 'SHARED_CONTEXT_NOT_FOUND' });
    }

    const staleSignal = rootSignalLooksStale(root);
    const signalRun = await findPreferredSignalRunForUser(user._id, root);
    const statusData = buildStatusResponse(root, null, signalRun)?.data || null;

    if (staleSignal || !statusData?.signalComplete || !!statusData?.needSignalRebuild) {
      return res.status(409).json({
        ok: false,
        error: staleSignal || !!statusData?.needSignalRebuild ? 'SHARED_CONTEXT_STALE_REBUILD_REQUIRED' : 'SHARED_CONTEXT_NOT_READY',
      });
    }

    try {
      await syncUserVersionedLink(user._id, provider);
    } catch (syncErr) {
      console.error('[mcp/context/shared] syncUserVersionedLink warning:', syncErr);
    }

    setNoCacheHeaders(res);
    return res.json(buildSharedPayload(root, provider, signalRun));
  } catch (e) {
    console.error('[mcp/context/shared] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_CONTEXT_SHARED_FAILED' });
  }
});

module.exports = router;