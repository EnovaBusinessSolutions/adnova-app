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
const {
  resolveAdPerformance,
  resolveAdPerformanceAll,
  resolveCampaignPerformance,
  resolveChannelSummaryPayload,
  resolveDateComparisonPayload,
} = require('../services/adsPerformanceResolve');
const { isGoogleReadsFromDbOnly } = require('../snapshot/config');

function sendError(res, status, code, tool, extra) {
  return res.status(status).json(createToolError(code, tool, extra));
}

function wrapHandler(toolName, fn) {
  return async (req, res) => {
    try {
      const userId = req._mcpUserId;
      if (!userId) return sendError(res, 401, 'UNAUTHORIZED', toolName);
      const data = await fn(req, userId);
      return res.json(data);
    } catch (err) {
      console.error(`[rest/${toolName}] error:`, err);
      const code = err.code || 'INTERNAL_ERROR';
      const status = code === 'ACCOUNT_NOT_CONNECTED' ? 404 : code === 'DATE_RANGE_TOO_LARGE' ? 400 : 500;
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
