'use strict';

const express = require('express');
const router = express.Router();

const McpData = require('../models/McpData');
const { formatMetaForLlm, formatMetaForLlmMini } = require('../jobs/transform/metaLlmFormatter');
const { formatGoogleAdsForLlm, formatGoogleAdsForLlmMini } = require('../jobs/transform/googleAdsLlmFormatter');
const { formatGa4ForLlm, formatGa4ForLlmMini } = require('../jobs/transform/ga4LlmFormatter');
const {
  enqueueMetaCollectBestEffort,
  enqueueGoogleAdsCollectBestEffort,
  enqueueGa4CollectBestEffort,
} = require('../queues/mcpQueue');

let MetaAccount = null;
let GoogleAccount = null;
try { MetaAccount = require('../models/MetaAccount'); } catch {}
try { GoogleAccount = require('../models/GoogleAccount'); } catch {}

function ymd(d = new Date()) {
  const x = new Date(d);
  const yyyy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toBool(v) {
  return !!v;
}

function toBoundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function pickMetaAccount(meta) {
  const selected = Array.isArray(meta?.selectedAccountIds) ? meta.selectedAccountIds : [];
  const act =
    selected[0] ||
    meta?.defaultAccountId ||
    meta?.ad_accounts?.[0]?.id ||
    meta?.adAccounts?.[0]?.id ||
    null;

  if (!act) return null;

  const pool = (meta?.ad_accounts?.length ? meta.ad_accounts : meta?.adAccounts) || [];
  const found =
    pool.find(a => String(a?.id || a?.account_id || '') === String(act)) || null;

  return {
    accountId: String(act),
    name: found?.name || found?.account_name || null,
    currency: found?.currency || found?.account_currency || null,
    timezone: found?.timezone_name || found?.timezone || null,
  };
}

function pickGoogleAdsCustomer(ga) {
  const selected = Array.isArray(ga?.selectedCustomerIds) ? ga.selectedCustomerIds : [];
  const cid =
    selected[0] ||
    ga?.defaultCustomerId ||
    ga?.customers?.[0]?.id ||
    ga?.ad_accounts?.[0]?.id ||
    null;

  if (!cid) return null;

  const pool = [
    ...(Array.isArray(ga?.customers) ? ga.customers : []),
    ...(Array.isArray(ga?.ad_accounts) ? ga.ad_accounts : []),
  ];

  const found = pool.find(x => String(x?.id || '') === String(cid)) || null;

  return {
    customerId: String(cid),
    name: found?.descriptiveName || found?.name || null,
    currency: found?.currencyCode || null,
    timezone: found?.timeZone || null,
  };
}

function pickGa4Property(ga) {
  const selected = Array.isArray(ga?.selectedPropertyIds) ? ga.selectedPropertyIds : [];
  const pid =
    selected[0] ||
    ga?.defaultPropertyId ||
    ga?.gaProperties?.[0]?.propertyId ||
    ga?.selectedGaPropertyId ||
    null;

  if (!pid) return null;

  const pool = Array.isArray(ga?.gaProperties) ? ga.gaProperties : [];
  const found = pool.find(p => String(p?.propertyId || '') === String(pid)) || null;

  return {
    propertyId: String(pid),
    name: found?.displayName || null,
    currency: found?.currencyCode || null,
    timezone: found?.timeZone || null,
  };
}

function isRootDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;

  if (doc.isRoot === true) return true;
  if (doc.kind === 'root') return true;
  if (doc.type === 'root') return true;
  if (doc.docType === 'root') return true;

  if (doc.latestSnapshotId && !doc.dataset) return true;

  return false;
}

function isChunkDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;

  if (doc.isRoot === true) return false;
  if (doc.kind === 'root') return false;
  if (doc.type === 'root') return false;
  if (doc.docType === 'root') return false;

  return !!doc.dataset;
}

async function findRoot(userId) {
  const docs = await McpData.find({ userId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return docs.find(isRootDoc) || null;
}

async function findLatestSnapshotId(userId, source = 'metaAds') {
  const root = await findRoot(userId);
  if (root?.latestSnapshotId) return root.latestSnapshotId;

  const datasetPrefix =
    source === 'googleAds' ? '^google\\.' :
    source === 'ga4' ? '^ga4\\.' :
    '^meta\\.';

  const latestChunk = await McpData.findOne({
    userId,
    source,
    dataset: { $regex: datasetPrefix },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return latestChunk?.snapshotId || null;
}

async function findSourceChunks(userId, source, snapshotId, datasetPrefix) {
  const query = {
    userId,
    source,
    dataset: { $regex: `^${datasetPrefix.replace('.', '\\.')}` },
  };

  if (snapshotId) query.snapshotId = snapshotId;

  const docs = await McpData.find(query)
    .sort({ createdAt: 1, updatedAt: 1 })
    .lean();

  return docs.filter(isChunkDoc);
}

function mergeSourceState(prev, next) {
  return {
    connected: next.connected,
    ready: next.ready,
    lastSyncAt: prev?.lastSyncAt || null,
    lastError: prev?.lastError || null,

    accountId: next.accountId ?? prev?.accountId ?? null,
    customerId: next.customerId ?? prev?.customerId ?? null,
    propertyId: next.propertyId ?? prev?.propertyId ?? null,

    name: next.name ?? prev?.name ?? null,
    currency: next.currency ?? prev?.currency ?? null,
    timezone: next.timezone ?? prev?.timezone ?? null,
  };
}

function buildRootPatch({ prevRoot, meta, google, metaPick, adsPick, ga4Pick }) {
  const prevSources = prevRoot?.sources || {};
  const prevCoverage = prevRoot?.coverage || {};

  const snapshotId = prevRoot?.latestSnapshotId || `snap_${ymd(new Date())}`;

  return {
    latestSnapshotId: snapshotId,
    coverage: {
      range: {
        from: prevCoverage?.range?.from || null,
        to: prevCoverage?.range?.to || null,
        tz: prevCoverage?.range?.tz || 'America/Mexico_City',
      },
      defaultRangeDays: prevCoverage?.defaultRangeDays || 30,
      granularity: Array.isArray(prevCoverage?.granularity) && prevCoverage.granularity.length
        ? prevCoverage.granularity
        : ['daily', 'campaign', 'adset', 'ad', 'landing_page'],
    },
    sources: {
      metaAds: mergeSourceState(prevSources?.metaAds, {
        connected: !!meta,
        ready: !!(meta && metaPick),
        accountId: metaPick?.accountId || null,
        name: metaPick?.name || null,
        currency: metaPick?.currency || null,
        timezone: metaPick?.timezone || null,
      }),
      googleAds: mergeSourceState(prevSources?.googleAds, {
        connected: !!google?.connectedAds,
        ready: !!(google?.connectedAds && adsPick),
        customerId: adsPick?.customerId || null,
        name: adsPick?.name || null,
        currency: adsPick?.currency || null,
        timezone: adsPick?.timezone || null,
      }),
      ga4: mergeSourceState(prevSources?.ga4, {
        connected: !!google?.connectedGa4,
        ready: !!(google?.connectedGa4 && ga4Pick),
        propertyId: ga4Pick?.propertyId || null,
        name: ga4Pick?.name || null,
        currency: ga4Pick?.currency || null,
        timezone: ga4Pick?.timezone || null,
      }),
    },
  };
}

function stripChunkForResponse(doc) {
  return {
    id: doc?._id || null,
    snapshotId: doc?.snapshotId || null,
    source: doc?.source || null,
    dataset: doc?.dataset || null,
    range: doc?.range || null,
    stats: doc?.stats || null,
    updatedAt: doc?.updatedAt || null,
    createdAt: doc?.createdAt || null,
  };
}

/**
 * POST /api/mcpdata/bootstrap
 * Crea/actualiza el ROOT del usuario en mcpdata usando selecciones actuales.
 */
router.post('/bootstrap', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const [prevRoot, meta, google] = await Promise.all([
      findRoot(userId),
      MetaAccount
        ? MetaAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean()
        : null,
      GoogleAccount
        ? GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean()
        : null,
    ]);

    const metaPick = meta ? pickMetaAccount(meta) : null;
    const adsPick = google ? pickGoogleAdsCustomer(google) : null;
    const ga4Pick = google ? pickGa4Property(google) : null;

    const rootPatch = buildRootPatch({
      prevRoot,
      meta,
      google,
      metaPick,
      adsPick,
      ga4Pick,
    });

    const root = await McpData.upsertRoot(userId, rootPatch);

    return res.json({
      ok: true,
      data: root,
    });
  } catch (e) {
    console.error('[mcpdata/bootstrap] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_BOOTSTRAP_FAILED' });
  }
});

/**
 * GET /api/mcpdata/root
 * Devuelve el ROOT actual del usuario.
 */
router.get('/root', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);

    return res.json({
      ok: true,
      data: root || null,
    });
  } catch (e) {
    console.error('[mcpdata/root] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_ROOT_READ_FAILED' });
  }
});

/**
 * GET /api/mcpdata/meta/status
 * Devuelve estado real de chunks Meta en mcpdata.
 */
router.get('/meta/status', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    const snapshotId = root?.latestSnapshotId || await findLatestSnapshotId(userId, 'metaAds');

    const chunks = snapshotId
      ? await findSourceChunks(userId, 'metaAds', snapshotId, 'meta.')
      : [];

    return res.json({
      ok: true,
      data: {
        hasRoot: !!root,
        latestSnapshotId: snapshotId || null,
        connected: toBool(root?.sources?.metaAds?.connected),
        ready: toBool(root?.sources?.metaAds?.ready),
        chunkCount: chunks.length,
        datasets: chunks.map(stripChunkForResponse),
      },
    });
  } catch (e) {
    console.error('[mcpdata/meta/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_META_STATUS_FAILED' });
  }
});

/**
 * GET /api/mcpdata/google-ads/status
 * Devuelve estado real de chunks Google Ads en mcpdata.
 */
router.get('/google-ads/status', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    const snapshotId = root?.latestSnapshotId || await findLatestSnapshotId(userId, 'googleAds');

    const chunks = snapshotId
      ? await findSourceChunks(userId, 'googleAds', snapshotId, 'google.')
      : [];

    return res.json({
      ok: true,
      data: {
        hasRoot: !!root,
        latestSnapshotId: snapshotId || null,
        connected: toBool(root?.sources?.googleAds?.connected),
        ready: toBool(root?.sources?.googleAds?.ready),
        chunkCount: chunks.length,
        datasets: chunks.map(stripChunkForResponse),
      },
    });
  } catch (e) {
    console.error('[mcpdata/google-ads/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_GOOGLEADS_STATUS_FAILED' });
  }
});

/**
 * GET /api/mcpdata/ga4/status
 * Devuelve estado real de chunks GA4 en mcpdata.
 */
router.get('/ga4/status', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const root = await findRoot(userId);
    const snapshotId = root?.latestSnapshotId || await findLatestSnapshotId(userId, 'ga4');

    const chunks = snapshotId
      ? await findSourceChunks(userId, 'ga4', snapshotId, 'ga4.')
      : [];

    return res.json({
      ok: true,
      data: {
        hasRoot: !!root,
        latestSnapshotId: snapshotId || null,
        connected: toBool(root?.sources?.ga4?.connected),
        ready: toBool(root?.sources?.ga4?.ready),
        chunkCount: chunks.length,
        datasets: chunks.map(stripChunkForResponse),
      },
    });
  } catch (e) {
    console.error('[mcpdata/ga4/status] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_GA4_STATUS_FAILED' });
  }
});

/**
 * GET /api/mcpdata/meta/llm
 */
router.get('/meta/llm', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const topCampaigns = Math.max(1, Math.min(20, Number(req.query.topCampaigns) || 8));
    const topBreakdowns = Math.max(1, Math.min(10, Number(req.query.topBreakdowns) || 5));
    const topTrendCampaigns = Math.max(1, Math.min(10, Number(req.query.topTrendCampaigns) || 5));

    const root = await findRoot(userId);
    const snapshotId =
      safeStr(req.query.snapshotId) ||
      root?.latestSnapshotId ||
      await findLatestSnapshotId(userId, 'metaAds');

    if (!snapshotId) {
      return res.status(404).json({
        ok: false,
        error: 'META_SNAPSHOT_NOT_FOUND',
      });
    }

    const chunks = await findSourceChunks(userId, 'metaAds', snapshotId, 'meta.');

    if (!chunks.length) {
      return res.status(404).json({
        ok: false,
        error: 'META_CHUNKS_NOT_FOUND',
        snapshotId,
      });
    }

    const payload = formatMetaForLlm({
      datasets: chunks,
      topCampaigns,
      topBreakdowns,
      topTrendCampaigns,
    });

    return res.json({
      ok: true,
      data: payload,
      meta: {
        snapshotId,
        chunkCount: chunks.length,
        datasets: chunks.map(c => c.dataset),
      },
    });
  } catch (e) {
    console.error('[mcpdata/meta/llm] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_META_LLM_FAILED' });
  }
});

/**
 * GET /api/mcpdata/meta/llm-mini
 */
router.get('/meta/llm-mini', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const topCampaigns = Math.max(1, Math.min(20, Number(req.query.topCampaigns) || 5));

    const root = await findRoot(userId);
    const snapshotId =
      safeStr(req.query.snapshotId) ||
      root?.latestSnapshotId ||
      await findLatestSnapshotId(userId, 'metaAds');

    if (!snapshotId) {
      return res.status(404).json({
        ok: false,
        error: 'META_SNAPSHOT_NOT_FOUND',
      });
    }

    const chunks = await findSourceChunks(userId, 'metaAds', snapshotId, 'meta.');

    if (!chunks.length) {
      return res.status(404).json({
        ok: false,
        error: 'META_CHUNKS_NOT_FOUND',
        snapshotId,
      });
    }

    const payload = formatMetaForLlmMini({
      datasets: chunks,
      topCampaigns,
    });

    return res.json({
      ok: true,
      data: payload,
      meta: {
        snapshotId,
        chunkCount: chunks.length,
        datasets: chunks.map(c => c.dataset),
      },
    });
  } catch (e) {
    console.error('[mcpdata/meta/llm-mini] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_META_LLM_MINI_FAILED' });
  }
});

/**
 * GET /api/mcpdata/google-ads/llm
 */
router.get('/google-ads/llm', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const topCampaigns = Math.max(1, Math.min(20, Number(req.query.topCampaigns) || 8));
    const topBreakdowns = Math.max(1, Math.min(10, Number(req.query.topBreakdowns) || 5));
    const topTrendCampaigns = Math.max(1, Math.min(10, Number(req.query.topTrendCampaigns) || 5));

    const root = await findRoot(userId);
    const snapshotId =
      safeStr(req.query.snapshotId) ||
      root?.latestSnapshotId ||
      await findLatestSnapshotId(userId, 'googleAds');

    if (!snapshotId) {
      return res.status(404).json({
        ok: false,
        error: 'GOOGLEADS_SNAPSHOT_NOT_FOUND',
      });
    }

    const chunks = await findSourceChunks(userId, 'googleAds', snapshotId, 'google.');

    if (!chunks.length) {
      return res.status(404).json({
        ok: false,
        error: 'GOOGLEADS_CHUNKS_NOT_FOUND',
        snapshotId,
      });
    }

    const payload = formatGoogleAdsForLlm({
      datasets: chunks,
      topCampaigns,
      topBreakdowns,
      topTrendCampaigns,
    });

    return res.json({
      ok: true,
      data: payload,
      meta: {
        snapshotId,
        chunkCount: chunks.length,
        datasets: chunks.map(c => c.dataset),
      },
    });
  } catch (e) {
    console.error('[mcpdata/google-ads/llm] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_GOOGLEADS_LLM_FAILED' });
  }
});

/**
 * GET /api/mcpdata/google-ads/llm-mini
 */
router.get('/google-ads/llm-mini', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const topCampaigns = Math.max(1, Math.min(20, Number(req.query.topCampaigns) || 5));

    const root = await findRoot(userId);
    const snapshotId =
      safeStr(req.query.snapshotId) ||
      root?.latestSnapshotId ||
      await findLatestSnapshotId(userId, 'googleAds');

    if (!snapshotId) {
      return res.status(404).json({
        ok: false,
        error: 'GOOGLEADS_SNAPSHOT_NOT_FOUND',
      });
    }

    const chunks = await findSourceChunks(userId, 'googleAds', snapshotId, 'google.');

    if (!chunks.length) {
      return res.status(404).json({
        ok: false,
        error: 'GOOGLEADS_CHUNKS_NOT_FOUND',
        snapshotId,
      });
    }

    const payload = formatGoogleAdsForLlmMini({
      datasets: chunks,
      topCampaigns,
    });

    return res.json({
      ok: true,
      data: payload,
      meta: {
        snapshotId,
        chunkCount: chunks.length,
        datasets: chunks.map(c => c.dataset),
      },
    });
  } catch (e) {
    console.error('[mcpdata/google-ads/llm-mini] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_GOOGLEADS_LLM_MINI_FAILED' });
  }
});

/**
 * GET /api/mcpdata/ga4/llm
 */
router.get('/ga4/llm', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const topChannels = Math.max(1, Math.min(20, Number(req.query.topChannels) || 8));
    const topDevices = Math.max(1, Math.min(12, Number(req.query.topDevices) || 6));
    const topLandingPages = Math.max(1, Math.min(20, Number(req.query.topLandingPages) || 8));
    const topSourceMedium = Math.max(1, Math.min(25, Number(req.query.topSourceMedium) || 10));
    const topEvents = Math.max(1, Math.min(25, Number(req.query.topEvents) || 10));
    const topTrendDays = Math.max(1, Math.min(90, Number(req.query.topTrendDays) || 30));

    const root = await findRoot(userId);
    const snapshotId =
      safeStr(req.query.snapshotId) ||
      root?.latestSnapshotId ||
      await findLatestSnapshotId(userId, 'ga4');

    if (!snapshotId) {
      return res.status(404).json({
        ok: false,
        error: 'GA4_SNAPSHOT_NOT_FOUND',
      });
    }

    const chunks = await findSourceChunks(userId, 'ga4', snapshotId, 'ga4.');

    if (!chunks.length) {
      return res.status(404).json({
        ok: false,
        error: 'GA4_CHUNKS_NOT_FOUND',
        snapshotId,
      });
    }

    const payload = formatGa4ForLlm({
      datasets: chunks,
      topChannels,
      topDevices,
      topLandingPages,
      topSourceMedium,
      topEvents,
      topTrendDays,
    });

    return res.json({
      ok: true,
      data: payload,
      meta: {
        snapshotId,
        chunkCount: chunks.length,
        datasets: chunks.map(c => c.dataset),
      },
    });
  } catch (e) {
    console.error('[mcpdata/ga4/llm] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_GA4_LLM_FAILED' });
  }
});

/**
 * GET /api/mcpdata/ga4/llm-mini
 */
router.get('/ga4/llm-mini', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const topChannels = Math.max(1, Math.min(10, Number(req.query.topChannels) || 5));
    const topDevices = Math.max(1, Math.min(8, Number(req.query.topDevices) || 4));
    const topLandingPages = Math.max(1, Math.min(10, Number(req.query.topLandingPages) || 5));
    const topEvents = Math.max(1, Math.min(10, Number(req.query.topEvents) || 6));

    const root = await findRoot(userId);
    const snapshotId =
      safeStr(req.query.snapshotId) ||
      root?.latestSnapshotId ||
      await findLatestSnapshotId(userId, 'ga4');

    if (!snapshotId) {
      return res.status(404).json({
        ok: false,
        error: 'GA4_SNAPSHOT_NOT_FOUND',
      });
    }

    const chunks = await findSourceChunks(userId, 'ga4', snapshotId, 'ga4.');

    if (!chunks.length) {
      return res.status(404).json({
        ok: false,
        error: 'GA4_CHUNKS_NOT_FOUND',
        snapshotId,
      });
    }

    const payload = formatGa4ForLlmMini({
      datasets: chunks,
      topChannels,
      topDevices,
      topLandingPages,
      topEvents,
    });

    return res.json({
      ok: true,
      data: payload,
      meta: {
        snapshotId,
        chunkCount: chunks.length,
        datasets: chunks.map(c => c.dataset),
      },
    });
  } catch (e) {
    console.error('[mcpdata/ga4/llm-mini] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_GA4_LLM_MINI_FAILED' });
  }
});

/**
 * POST /api/mcpdata/collect-now
 * Enqueue immediate MCP pulls for connected sources of current user.
 */
router.post('/collect-now', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'NO_SESSION' });
    }

    const body = req.body || {};
    const requested = Array.isArray(body.sources) ? body.sources : ['metaAds', 'googleAds', 'ga4'];
    const normalizedSources = Array.from(new Set(
      requested
        .map((v) => String(v || '').trim())
        .filter((v) => ['metaAds', 'googleAds', 'ga4'].includes(v))
    ));

    if (!normalizedSources.length) {
      return res.status(400).json({ ok: false, error: 'INVALID_SOURCES' });
    }

    const rangeDays = toBoundedInt(body.rangeDays, 60, 7, 3650);
    const forceFull = Boolean(body.forceFull);

    const [metaDoc, googleDoc] = await Promise.all([
      MetaAccount
        ? MetaAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean()
        : null,
      GoogleAccount
        ? GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean()
        : null,
    ]);

    const metaPick = metaDoc ? pickMetaAccount(metaDoc) : null;
    const adsPick = googleDoc ? pickGoogleAdsCustomer(googleDoc) : null;
    const ga4Pick = googleDoc ? pickGa4Property(googleDoc) : null;

    const results = {};

    if (normalizedSources.includes('metaAds')) {
      if (!metaPick?.accountId) {
        results.metaAds = { ok: false, skipped: true, error: 'META_NOT_CONNECTED_OR_SELECTED' };
      } else {
        results.metaAds = await enqueueMetaCollectBestEffort({
          userId,
          rangeDays,
          reason: 'manual_collect_now',
          trigger: 'mcpdata.collect-now',
          forceFull,
          metaAccountId: metaPick.accountId,
          extra: { route: req.originalUrl || null },
        });
      }
    }

    if (normalizedSources.includes('googleAds')) {
      if (!adsPick?.customerId) {
        results.googleAds = { ok: false, skipped: true, error: 'GOOGLE_ADS_NOT_CONNECTED_OR_SELECTED' };
      } else {
        results.googleAds = await enqueueGoogleAdsCollectBestEffort({
          userId,
          accountId: adsPick.customerId,
          rangeDays,
          reason: 'manual_collect_now',
          trigger: 'mcpdata.collect-now',
          forceFull,
          extra: { route: req.originalUrl || null },
        });
      }
    }

    if (normalizedSources.includes('ga4')) {
      if (!ga4Pick?.propertyId) {
        results.ga4 = { ok: false, skipped: true, error: 'GA4_NOT_CONNECTED_OR_SELECTED' };
      } else {
        results.ga4 = await enqueueGa4CollectBestEffort({
          userId,
          propertyId: ga4Pick.propertyId,
          rangeDays,
          reason: 'manual_collect_now',
          trigger: 'mcpdata.collect-now',
          forceFull,
          extra: { route: req.originalUrl || null },
        });
      }
    }

    return res.json({
      ok: true,
      data: {
        userId: String(userId),
        rangeDays,
        forceFull,
        requestedSources: normalizedSources,
        results,
      },
    });
  } catch (e) {
    console.error('[mcpdata/collect-now] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_COLLECT_NOW_FAILED' });
  }
});

module.exports = router;