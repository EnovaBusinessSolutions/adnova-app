'use strict';

const express = require('express');
const router = express.Router();

const McpData = require('../models/McpData');

const { formatMetaForLlmMini } = require('../jobs/transform/metaLlmFormatter');
const { formatGoogleAdsForLlmMini } = require('../jobs/transform/googleAdsLlmFormatter');
const { formatGa4ForLlmMini } = require('../jobs/transform/ga4LlmFormatter');

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {
  OpenAI = null;
}

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

function ymd(d = new Date()) {
  const x = new Date(d);
  const yyyy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
  if (isRootDoc(doc)) return false;
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

function compactMetaMini(chunks) {
  if (!chunks?.length) return null;
  return formatMetaForLlmMini({
    datasets: chunks,
    topCampaigns: 5,
  });
}

function compactGoogleAdsMini(chunks) {
  if (!chunks?.length) return null;
  return formatGoogleAdsForLlmMini({
    datasets: chunks,
    topCampaigns: 5,
  });
}

function compactGa4Mini(chunks) {
  if (!chunks?.length) return null;
  return formatGa4ForLlmMini({
    datasets: chunks,
    topChannels: 5,
    topDevices: 4,
    topLandingPages: 5,
    topEvents: 6,
  });
}

function buildUnifiedBaseContext({ root, snapshotId, metaMini, googleMini, ga4Mini }) {
  const sources = root?.sources || {};

  return {
    schema: 'adray.unified.context.v1',
    generatedAt: nowIso(),
    snapshotId: snapshotId || null,
    coverage: root?.coverage || null,
    sources: {
      metaAds: {
        connected: !!sources?.metaAds?.connected,
        ready: !!sources?.metaAds?.ready,
        accountId: sources?.metaAds?.accountId || null,
        name: sources?.metaAds?.name || null,
        currency: sources?.metaAds?.currency || null,
        timezone: sources?.metaAds?.timezone || null,
      },
      googleAds: {
        connected: !!sources?.googleAds?.connected,
        ready: !!sources?.googleAds?.ready,
        customerId: sources?.googleAds?.customerId || null,
        name: sources?.googleAds?.name || null,
        currency: sources?.googleAds?.currency || null,
        timezone: sources?.googleAds?.timezone || null,
      },
      ga4: {
        connected: !!sources?.ga4?.connected,
        ready: !!sources?.ga4?.ready,
        propertyId: sources?.ga4?.propertyId || null,
        name: sources?.ga4?.name || null,
        currency: sources?.ga4?.currency || null,
        timezone: sources?.ga4?.timezone || null,
      },
    },
    inputs: {
      meta: metaMini || null,
      googleAds: googleMini || null,
      ga4: ga4Mini || null,
    },
  };
}

function buildFallbackEncodedContext(base) {
  const meta = base?.inputs?.meta || null;
  const googleAds = base?.inputs?.googleAds || null;
  const ga4 = base?.inputs?.ga4 || null;

  const positives = [
    ...(meta?.priority_summary?.positives || []),
    ...(googleAds?.priority_summary?.positives || []),
    ...(ga4?.priority_summary?.positives || []),
  ].slice(0, 10);

  const negatives = [
    ...(meta?.priority_summary?.negatives || []),
    ...(googleAds?.priority_summary?.negatives || []),
    ...(ga4?.priority_summary?.negatives || []),
  ].slice(0, 10);

  const actions = [
    ...(meta?.priority_summary?.actions || []),
    ...(googleAds?.priority_summary?.actions || []),
    ...(ga4?.priority_summary?.actions || []),
  ].slice(0, 10);

  const llmHints = [
    ...(meta?.llm_hints || []),
    ...(googleAds?.llm_hints || []),
    ...(ga4?.llm_hints || []),
  ].slice(0, 12);

  const contextParts = [];

  if (meta?.headline_kpis) {
    contextParts.push(
      `Meta Ads summary: spend ${meta.headline_kpis.spend ?? 'n/a'}, purchases ${meta.headline_kpis.purchases ?? 'n/a'}, roas ${meta.headline_kpis.roas ?? 'n/a'}.`
    );
  }

  if (googleAds?.headline_kpis) {
    contextParts.push(
      `Google Ads summary: spend ${googleAds.headline_kpis.spend ?? 'n/a'}, conversions ${googleAds.headline_kpis.conversions ?? 'n/a'}, roas ${googleAds.headline_kpis.roas ?? 'n/a'}.`
    );
  }

  if (ga4?.headline_kpis) {
    contextParts.push(
      `GA4 summary: users ${ga4.headline_kpis.users ?? 'n/a'}, sessions ${ga4.headline_kpis.sessions ?? 'n/a'}, conversions ${ga4.headline_kpis.conversions ?? 'n/a'}, revenue ${ga4.headline_kpis.revenue ?? 'n/a'}.`
    );
  }

  return {
    schema: 'adray.encoded.context.v1',
    providerAgnostic: true,
    generatedAt: nowIso(),
    summary: {
      executive_summary:
        'This AI-ready context was generated from the user’s connected marketing sources and compacted into a unified cross-channel payload for downstream LLM consumption.',
      positives,
      negatives,
      priority_actions: actions,
    },
    channel_story: {
      meta_ads: meta || null,
      google_ads: googleAds || null,
      ga4: ga4 || null,
    },
    llm_context_block: [
      'Use this marketing context as source of truth for cross-channel performance analysis.',
      ...contextParts,
      ...positives.map(x => `Positive: ${x}`),
      ...negatives.map(x => `Risk: ${x}`),
      ...actions.map(x => `Recommended action: ${x}`),
    ].join('\n'),
    llm_context_block_mini: [
      ...contextParts.slice(0, 3),
      ...actions.slice(0, 3).map(x => `Action: ${x}`),
    ].join('\n'),
    prompt_hints: llmHints,
  };
}

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !OpenAI) return null;

  try {
    return new OpenAI({ apiKey });
  } catch (_) {
    return null;
  }
}

async function enrichWithOpenAI(base) {
  const client = getOpenAiClient();
  if (!client) {
    return {
      usedOpenAI: false,
      model: null,
      payload: buildFallbackEncodedContext(base),
    };
  }

  const model = process.env.OPENAI_MCP_CONTEXT_MODEL || 'gpt-4.1-mini';

  const inputPayload = {
    schema: base?.schema || 'adray.unified.context.v1',
    snapshotId: base?.snapshotId || null,
    sources: base?.sources || {},
    inputs: base?.inputs || {},
  };

  const systemPrompt = [
    'You are generating a provider-agnostic AI context payload for a digital marketing intelligence platform.',
    'Return ONLY valid JSON.',
    'Do not include markdown fences.',
    'Summarize the cross-channel marketing state using Meta Ads, Google Ads, and GA4 inputs.',
    'Preserve important metrics and business signals.',
    'Output keys exactly as requested.'
  ].join(' ');

  const userPrompt = JSON.stringify({
    task: 'Build a unified AI-ready context payload',
    required_schema: {
      schema: 'adray.encoded.context.v1',
      providerAgnostic: true,
      generatedAt: 'ISO datetime string',
      summary: {
        executive_summary: 'string',
        business_state: 'string',
        cross_channel_story: 'string',
        positives: ['string'],
        negatives: ['string'],
        priority_actions: ['string'],
      },
      performance_drivers: ['string'],
      conversion_bottlenecks: ['string'],
      scaling_opportunities: ['string'],
      risk_flags: ['string'],
      llm_context_block: 'string',
      llm_context_block_mini: 'string',
      prompt_hints: ['string'],
    },
    input: inputPayload,
  });

  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
      ],
      temperature: 0.2,
    });

    const text =
      response?.output_text ||
      response?.output?.map(x => x?.content?.map(c => c?.text || '').join('')).join('') ||
      '';

    const parsed = JSON.parse(text);

    return {
      usedOpenAI: true,
      model,
      payload: {
        schema: 'adray.encoded.context.v1',
        providerAgnostic: true,
        generatedAt: nowIso(),
        ...parsed,
      },
    };
  } catch (err) {
    console.error('[mcp/context] OpenAI enrichment failed, using fallback:', err?.message || err);
    return {
      usedOpenAI: false,
      model,
      payload: buildFallbackEncodedContext(base),
    };
  }
}

async function updateRootContextState(userId, patch) {
  const root = await findRoot(userId);
  if (!root?._id) return null;

  return McpData.findByIdAndUpdate(
    root._id,
    {
      $set: patch,
    },
    { new: true }
  ).lean();
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
      hasEncodedPayload: !!state?.encodedPayload,
      providerAgnostic: !!state?.encodedPayload?.providerAgnostic,
      usedOpenAI: !!state?.usedOpenAI,
      model: state?.model || null,
      error: state?.error || null,
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

    const snapshotId =
      safeStr(req.body?.snapshotId) ||
      root?.latestSnapshotId ||
      await findLatestSnapshotId(userId, 'metaAds') ||
      await findLatestSnapshotId(userId, 'googleAds') ||
      await findLatestSnapshotId(userId, 'ga4');

    await updateRootContextState(userId, {
      aiContext: {
        status: 'processing',
        progress: 10,
        stage: 'loading_sources',
        startedAt: nowIso(),
        finishedAt: null,
        snapshotId,
        error: null,
        usedOpenAI: false,
        model: null,
        encodedPayload: null,
      },
    });

    const [metaChunks, googleChunks, ga4Chunks] = await Promise.all([
      snapshotId ? findSourceChunks(userId, 'metaAds', snapshotId, 'meta.') : [],
      snapshotId ? findSourceChunks(userId, 'googleAds', snapshotId, 'google.') : [],
      snapshotId ? findSourceChunks(userId, 'ga4', snapshotId, 'ga4.') : [],
    ]);

    await updateRootContextState(userId, {
      aiContext: {
        ...(await findRoot(userId))?.aiContext,
        status: 'processing',
        progress: 35,
        stage: 'compacting_sources',
        startedAt: root?.aiContext?.startedAt || nowIso(),
        snapshotId,
        error: null,
      },
    });

    const metaMini = compactMetaMini(metaChunks);
    const googleMini = compactGoogleAdsMini(googleChunks);
    const ga4Mini = compactGa4Mini(ga4Chunks);

    const unifiedBase = buildUnifiedBaseContext({
      root,
      snapshotId,
      metaMini,
      googleMini,
      ga4Mini,
    });

    await updateRootContextState(userId, {
      aiContext: {
        ...(await findRoot(userId))?.aiContext,
        status: 'processing',
        progress: 65,
        stage: 'encoding_context',
        startedAt: root?.aiContext?.startedAt || nowIso(),
        snapshotId,
        unifiedBase,
        error: null,
      },
    });

    const encoded = await enrichWithOpenAI(unifiedBase);

    await updateRootContextState(userId, {
      aiContext: {
        status: 'done',
        progress: 100,
        stage: 'completed',
        startedAt: root?.aiContext?.startedAt || nowIso(),
        finishedAt: nowIso(),
        snapshotId,
        error: null,
        unifiedBase,
        encodedPayload: encoded.payload,
        usedOpenAI: !!encoded.usedOpenAI,
        model: encoded.model || null,
      },
    });

    const freshRoot = await findRoot(userId);

    return res.json({
      ok: true,
      data: {
        status: freshRoot?.aiContext?.status || 'done',
        progress: freshRoot?.aiContext?.progress || 100,
        stage: freshRoot?.aiContext?.stage || 'completed',
        snapshotId,
        usedOpenAI: !!freshRoot?.aiContext?.usedOpenAI,
        model: freshRoot?.aiContext?.model || null,
      },
    });
  } catch (e) {
    console.error('[mcp/context/build] error:', e);

    try {
      const userId = req.user?._id;
      if (userId) {
        const root = await findRoot(userId);
        if (root?._id) {
          await McpData.findByIdAndUpdate(root._id, {
            $set: {
              aiContext: {
                ...(root?.aiContext || {}),
                status: 'error',
                progress: 100,
                stage: 'failed',
                finishedAt: nowIso(),
                error: e?.message || 'MCP_CONTEXT_BUILD_FAILED',
              },
            },
          });
        }
      }
    } catch (_) {}

    return res.status(500).json({
      ok: false,
      error: 'MCP_CONTEXT_BUILD_FAILED',
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

    return res.json(buildStatusResponse(root));
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

    return res.json({
      ok: true,
      data: state.encodedPayload,
      meta: {
        status: state?.status || 'done',
        progress: state?.progress || 100,
        stage: state?.stage || 'completed',
        snapshotId: state?.snapshotId || root?.latestSnapshotId || null,
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

module.exports = router;