'use strict';

const express = require('express');
const router = express.Router();

const { requireOAuth } = require('../auth/oauth-middleware');
const { createToolError } = require('../schemas/errors');
const { validateDateRange } = require('../schemas/tool-schemas');

const accountAdapter = require('../adapters/account');
const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const shopifyAdapter = require('../adapters/shopify');
const McpData = require('../../models/McpData');
const {
  resolveAdPerformance,
  resolveAdPerformanceAll,
  resolveCampaignPerformance,
  resolveChannelSummaryPayload,
  resolveDateComparisonPayload,
} = require('../services/adsPerformanceResolve');
const { isGoogleReadsFromDbOnly } = require('../snapshot/config');
const { chunkOverlapsDateRange } = require('../snapshot/snapshotResolver');
const { checkToolScopes } = require('../scopes');

function sendError(res, status, code, tool, extra) {
  return res.status(status).json(createToolError(code, tool, extra));
}

function mcpDebugRoutesEnabled() {
  if (process.env.MCP_DEBUG_ROUTES === 'true' || process.env.MCP_DEBUG_ROUTES === '1') return true;
  if (process.env.MCP_DEBUG_ROUTES === 'false' || process.env.MCP_DEBUG_ROUTES === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

function wrapHandler(toolName, fn) {
  return async (req, res) => {
    try {
      const userId = req._mcpUserId;
      if (!userId) return sendError(res, 401, 'UNAUTHORIZED', toolName);
      const sc = checkToolScopes(toolName, req._mcpScopes);
      if (!sc.ok) return sendError(res, 403, sc.code, toolName, sc.detail);
      const data = await fn(req, userId);
      return res.json(data);
    } catch (err) {
      console.error(`[rest/${toolName}] error:`, err);
      const code = err.code || 'INTERNAL_ERROR';
      const status =
        code === 'ACCOUNT_NOT_CONNECTED'
          ? 404
          : code === 'DATE_RANGE_TOO_LARGE' || code === 'INVALID_PARAMETERS'
            ? 400
            : code === 'INSUFFICIENT_PERMISSIONS'
              ? 403
              : 500;
      return sendError(res, status, code, toolName, err.message);
    }
  };
}

router.use(requireOAuth());

router.get('/account-info', wrapHandler('get_account_info', async (req, userId) => {
  return accountAdapter.getAccountInfo(userId);
}));

router.get('/ad-performance', wrapHandler('get_ad_performance', async (req, userId) => {
  const { channel, date_from, date_to, granularity } = req.query;
  if (!channel || !date_from || !date_to) throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  const rangeErr = validateDateRange(date_from, date_to);
  if (rangeErr) throw Object.assign(new Error(rangeErr), { code: 'DATE_RANGE_TOO_LARGE' });

  const gran = granularity || 'total';

  if (channel === 'all') {
    return resolveAdPerformanceAll(userId, date_from, date_to, gran);
  }
  if (channel !== 'meta' && channel !== 'google') {
    throw Object.assign(new Error('Invalid channel'), { code: 'INVALID_PARAMETERS' });
  }
  return resolveAdPerformance(userId, channel, date_from, date_to, gran);
}));

router.get('/campaign-performance', wrapHandler('get_campaign_performance', async (req, userId) => {
  const { channel, date_from, date_to, limit, status } = req.query;
  if (!channel || !date_from || !date_to) throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  const rangeErr = validateDateRange(date_from, date_to);
  if (rangeErr) throw Object.assign(new Error(rangeErr), { code: 'DATE_RANGE_TOO_LARGE' });
  if (channel !== 'meta' && channel !== 'google') {
    throw Object.assign(new Error('Invalid channel'), { code: 'INVALID_PARAMETERS' });
  }
  return resolveCampaignPerformance(
    userId,
    channel,
    date_from,
    date_to,
    Number(limit) || 10,
    status || 'all'
  );
}));

// Debug: inspecciona chunks Google Ads (solo si MCP_DEBUG_ROUTES o no-production).
if (mcpDebugRoutesEnabled()) {
  router.get('/debug/google-chunks', wrapHandler('debug_google_chunks', async (req, userId) => {
    const { date_from, date_to } = req.query;

    const maybeFrom = typeof date_from === 'string' ? date_from : null;
    const maybeTo = typeof date_to === 'string' ? date_to : null;

    const chunks = await McpData.find({
      userId,
      kind: 'chunk',
      source: 'googleAds',
      dataset: { $regex: '^google\\.' },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(20)
      .lean();

    const enriched = (chunks || []).map((c) => {
      const dataset = c?.dataset;
      const range = c?.range || {};
      const data = c?.data || {};
      const totalsLen = Array.isArray(data?.totals_by_day) ? data.totals_by_day.length : 0;
      const campaignsDailyLen = Array.isArray(data?.campaigns_daily) ? data.campaigns_daily.length : 0;

      return {
        dataset,
        range: { from: range?.from ?? null, to: range?.to ?? null, tz: range?.tz ?? null },
        stats: c?.stats || null,
        totals_by_day_len: totalsLen,
        campaigns_daily_len: campaignsDailyLen,
        overlapsRequested: maybeFrom && maybeTo ? chunkOverlapsDateRange(c, maybeFrom, maybeTo) : null,
      };
    });

    return {
      ok: true,
      userId,
      query: { date_from: maybeFrom, date_to: maybeTo },
      chunkCount: enriched.length,
      chunks: enriched,
    };
  }));
}

router.get('/adset-performance', wrapHandler('get_adset_performance', async (req, userId) => {
  const { channel, campaign_id, date_from, date_to } = req.query;
  if (!channel || !campaign_id || !date_from || !date_to) throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  const rangeErr = validateDateRange(date_from, date_to);
  if (rangeErr) throw Object.assign(new Error(rangeErr), { code: 'DATE_RANGE_TOO_LARGE' });
  if (channel === 'google' && isGoogleReadsFromDbOnly()) {
    return {
      channel: 'google',
      campaign_id,
      campaign_name: null,
      adsets: [],
      date_from,
      date_to,
    };
  }
  const adapter = channel === 'meta' ? metaAdapter : googleAdapter;
  return adapter.getAdsetPerformance(userId, campaign_id, date_from, date_to);
}));

router.get('/shopify-revenue', wrapHandler('get_shopify_revenue', async (req, userId) => {
  const { date_from, date_to, granularity } = req.query;
  if (!date_from || !date_to) throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  const rangeErr = validateDateRange(date_from, date_to);
  if (rangeErr) throw Object.assign(new Error(rangeErr), { code: 'DATE_RANGE_TOO_LARGE' });
  return shopifyAdapter.getShopifyRevenue(userId, date_from, date_to, granularity || 'total');
}));

router.get('/shopify-products', wrapHandler('get_shopify_products', async (req, userId) => {
  const { date_from, date_to, sort_by, limit } = req.query;
  if (!date_from || !date_to) throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  const rangeErr = validateDateRange(date_from, date_to);
  if (rangeErr) throw Object.assign(new Error(rangeErr), { code: 'DATE_RANGE_TOO_LARGE' });
  return shopifyAdapter.getShopifyProducts(userId, date_from, date_to, sort_by || 'revenue', Number(limit) || 10);
}));

router.get('/channel-summary', wrapHandler('get_channel_summary', async (req, userId) => {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  const rangeErr = validateDateRange(date_from, date_to);
  if (rangeErr) throw Object.assign(new Error(rangeErr), { code: 'DATE_RANGE_TOO_LARGE' });

  return resolveChannelSummaryPayload(userId, date_from, date_to);
}));

router.get('/date-comparison', wrapHandler('get_date_comparison', async (req, userId) => {
  const { channel, period_a_from, period_a_to, period_b_from, period_b_to } = req.query;
  if (!channel || !period_a_from || !period_a_to || !period_b_from || !period_b_to) {
    throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  }
  const errA = validateDateRange(period_a_from, period_a_to);
  if (errA) throw Object.assign(new Error(errA), { code: 'DATE_RANGE_TOO_LARGE' });
  const errB = validateDateRange(period_b_from, period_b_to);
  if (errB) throw Object.assign(new Error(errB), { code: 'DATE_RANGE_TOO_LARGE' });

  return resolveDateComparisonPayload(
    userId,
    channel,
    period_a_from,
    period_a_to,
    period_b_from,
    period_b_to
  );
}));

module.exports = router;
