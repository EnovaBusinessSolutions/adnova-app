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
    const results = [];
    try { results.push(await metaAdapter.getAdPerformance(userId, date_from, date_to, gran)); } catch {}
    try { results.push(await googleAdapter.getAdPerformance(userId, date_from, date_to, gran)); } catch {}
    return results;
  }
  const adapter = channel === 'meta' ? metaAdapter : googleAdapter;
  return adapter.getAdPerformance(userId, date_from, date_to, gran);
}));

router.get('/campaign-performance', wrapHandler('get_campaign_performance', async (req, userId) => {
  const { channel, date_from, date_to, limit, status } = req.query;
  if (!channel || !date_from || !date_to) throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  const rangeErr = validateDateRange(date_from, date_to);
  if (rangeErr) throw Object.assign(new Error(rangeErr), { code: 'DATE_RANGE_TOO_LARGE' });
  const adapter = channel === 'meta' ? metaAdapter : googleAdapter;
  return adapter.getCampaignPerformance(userId, date_from, date_to, Number(limit) || 10, status || 'all');
}));

router.get('/adset-performance', wrapHandler('get_adset_performance', async (req, userId) => {
  const { channel, campaign_id, date_from, date_to } = req.query;
  if (!channel || !campaign_id || !date_from || !date_to) throw Object.assign(new Error('Missing required parameters'), { code: 'INVALID_PARAMETERS' });
  const rangeErr = validateDateRange(date_from, date_to);
  if (rangeErr) throw Object.assign(new Error(rangeErr), { code: 'DATE_RANGE_TOO_LARGE' });
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

  const channels = [];
  const currencies = new Set();
  const round = (n) => Number(Number(n || 0).toFixed(2));

  try {
    const meta = await metaAdapter.getAdPerformance(userId, date_from, date_to, 'total');
    channels.push({ channel: 'meta', spend: meta.spend, impressions: meta.impressions, clicks: meta.clicks, ctr: meta.ctr, conversions: 0, roas_reported: 0, currency: meta.currency });
    currencies.add(meta.currency);
  } catch {}

  try {
    const google = await googleAdapter.getAdPerformance(userId, date_from, date_to, 'total');
    channels.push({ channel: 'google', spend: google.spend, impressions: google.impressions, clicks: google.clicks, ctr: google.ctr, conversions: 0, roas_reported: 0, currency: google.currency });
    currencies.add(google.currency);
  } catch {}

  const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
  for (const ch of channels) { ch.spend_pct = round(totalSpend ? (ch.spend / totalSpend) * 100 : 0); }

  const result = { date_from, date_to, channels };
  if (currencies.size <= 1) {
    result.total_spend = round(totalSpend);
    result.currency = currencies.values().next().value || 'USD';
  } else {
    result.currency_note = 'Accounts use different currencies. Per-channel totals are shown in their native currency.';
  }
  return result;
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

  const round = (n) => Number(Number(n || 0).toFixed(2));
  const dir = (a, b) => b > a ? 'up' : b < a ? 'down' : 'flat';

  function compare(a, b, names) {
    return names.map(name => {
      const va = Number(a?.[name] || 0);
      const vb = Number(b?.[name] || 0);
      return { name, period_a_value: round(va), period_b_value: round(vb), change_absolute: round(vb - va), change_pct: round(va ? ((vb - va) / va) * 100 : vb ? 100 : 0), direction: dir(va, vb) };
    });
  }

  const result = { channel, period_a: { from: period_a_from, to: period_a_to }, period_b: { from: period_b_from, to: period_b_to }, metrics: [] };
  const adMetrics = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'];
  const shopMetrics = ['total_revenue', 'net_revenue', 'total_orders', 'average_order_value'];

  if (channel === 'meta' || channel === 'all') {
    try {
      const [a, b] = await Promise.all([
        metaAdapter.getAdPerformance(userId, period_a_from, period_a_to, 'total'),
        metaAdapter.getAdPerformance(userId, period_b_from, period_b_to, 'total'),
      ]);
      if (channel === 'all') result.meta = { metrics: compare(a, b, adMetrics) };
      else result.metrics = compare(a, b, adMetrics);
    } catch {}
  }

  if (channel === 'google' || channel === 'all') {
    try {
      const [a, b] = await Promise.all([
        googleAdapter.getAdPerformance(userId, period_a_from, period_a_to, 'total'),
        googleAdapter.getAdPerformance(userId, period_b_from, period_b_to, 'total'),
      ]);
      if (channel === 'all') result.google = { metrics: compare(a, b, adMetrics) };
      else result.metrics = compare(a, b, adMetrics);
    } catch {}
  }

  if (channel === 'shopify' || channel === 'all') {
    try {
      const [a, b] = await Promise.all([
        shopifyAdapter.getShopifyRevenue(userId, period_a_from, period_a_to, 'total'),
        shopifyAdapter.getShopifyRevenue(userId, period_b_from, period_b_to, 'total'),
      ]);
      if (channel === 'all') result.shopify = { metrics: compare(a, b, shopMetrics) };
      else result.metrics = compare(a, b, shopMetrics);
    } catch {}
  }

  return result;
}));

module.exports = router;
