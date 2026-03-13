'use strict';

const { z } = require('zod');
const { validateDateRange } = require('../schemas/tool-schemas');
const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const shopifyAdapter = require('../adapters/shopify');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');

const TOOL_NAME = 'get_date_comparison';

function round(n, d = 2) { return Number(Number(n || 0).toFixed(d)); }

function direction(a, b) {
  if (b > a) return 'up';
  if (b < a) return 'down';
  return 'flat';
}

function compareMetrics(periodA, periodB) {
  const metricNames = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'];
  const metrics = [];

  for (const name of metricNames) {
    const valA = Number(periodA?.[name] || 0);
    const valB = Number(periodB?.[name] || 0);
    metrics.push({
      name,
      period_a_value: round(valA),
      period_b_value: round(valB),
      change_absolute: round(valB - valA),
      change_pct: round(valA ? ((valB - valA) / valA) * 100 : valB ? 100 : 0),
      direction: direction(valA, valB),
    });
  }

  return metrics;
}

function compareShopifyMetrics(periodA, periodB) {
  const metricNames = ['total_revenue', 'net_revenue', 'total_orders', 'average_order_value'];
  const metrics = [];

  for (const name of metricNames) {
    const valA = Number(periodA?.[name] || 0);
    const valB = Number(periodB?.[name] || 0);
    metrics.push({
      name,
      period_a_value: round(valA),
      period_b_value: round(valB),
      change_absolute: round(valB - valA),
      change_pct: round(valA ? ((valB - valA) / valA) * 100 : valB ? 100 : 0),
      direction: direction(valA, valB),
    });
  }

  return metrics;
}

function register(server) {
  server.tool(
    TOOL_NAME,
    'Compares ad performance metrics between two date periods for a given channel.',
    {
      channel: z.enum(['meta', 'google', 'shopify', 'all']).describe('Channel to compare'),
      period_a_from: z.string().describe('Start of baseline period (YYYY-MM-DD)'),
      period_a_to: z.string().describe('End of baseline period (YYYY-MM-DD)'),
      period_b_from: z.string().describe('Start of comparison period (YYYY-MM-DD)'),
      period_b_to: z.string().describe('End of comparison period (YYYY-MM-DD)'),
    },
    { readOnlyHint: true },
    async (params, extra) => {
      try {
        const userId = extra?.userId || extra?.request?._mcpUserId;
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const errA = validateDateRange(params.period_a_from, params.period_a_to);
        if (errA) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, errA);
        const errB = validateDateRange(params.period_b_from, params.period_b_to);
        if (errB) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, errB);

        const result = {
          channel: params.channel,
          period_a: { from: params.period_a_from, to: params.period_a_to },
          period_b: { from: params.period_b_from, to: params.period_b_to },
          metrics: [],
        };

        if (params.channel === 'meta' || params.channel === 'all') {
          try {
            const [a, b] = await Promise.all([
              metaAdapter.getAdPerformance(userId, params.period_a_from, params.period_a_to, 'total'),
              metaAdapter.getAdPerformance(userId, params.period_b_from, params.period_b_to, 'total'),
            ]);
            if (params.channel === 'all') {
              result.meta = { metrics: compareMetrics(a, b) };
            } else {
              result.metrics = compareMetrics(a, b);
            }
          } catch {}
        }

        if (params.channel === 'google' || params.channel === 'all') {
          try {
            const [a, b] = await Promise.all([
              googleAdapter.getAdPerformance(userId, params.period_a_from, params.period_a_to, 'total'),
              googleAdapter.getAdPerformance(userId, params.period_b_from, params.period_b_to, 'total'),
            ]);
            if (params.channel === 'all') {
              result.google = { metrics: compareMetrics(a, b) };
            } else {
              result.metrics = compareMetrics(a, b);
            }
          } catch {}
        }

        if (params.channel === 'shopify' || params.channel === 'all') {
          try {
            const [a, b] = await Promise.all([
              shopifyAdapter.getShopifyRevenue(userId, params.period_a_from, params.period_a_to, 'total'),
              shopifyAdapter.getShopifyRevenue(userId, params.period_b_from, params.period_b_to, 'total'),
            ]);
            if (params.channel === 'all') {
              result.shopify = { metrics: compareShopifyMetrics(a, b) };
            } else {
              result.metrics = compareShopifyMetrics(a, b);
            }
          } catch {}
        }

        return createToolResponse(result);
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
