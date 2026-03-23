'use strict';

const { z } = require('zod');
const { validateDateRange } = require('../schemas/tool-schemas');
const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { resolveSnapshotFirstData } = require('../snapshot/runSnapshotFirst');
const { buildAdPerformanceSnapshot } = require('../snapshot/builders');

const TOOL_NAME = 'get_channel_summary';

function round(n, d = 2) {
  return Number(Number(n || 0).toFixed(d));
}

function register(server) {
  server.tool(
    TOOL_NAME,
    'Returns a side-by-side summary of performance across all connected ad channels for a given date range.',
    {
      date_from: z.string().describe('Start date (YYYY-MM-DD)'),
      date_to: z.string().describe('End date (YYYY-MM-DD)'),
    },
    { readOnlyHint: true },
    async (params, extra) => {
      try {
        const userId = extra?.userId || extra?.request?._mcpUserId;
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const rangeError = validateDateRange(params.date_from, params.date_to);
        if (rangeError) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, rangeError);

        const channels = [];
        const currencies = new Set();

        try {
          const meta = await resolveSnapshotFirstData({
            toolName: TOOL_NAME,
            userId,
            refreshSource: 'metaAds',
            buildSnapshot: () =>
              buildAdPerformanceSnapshot(userId, 'metaAds', 'meta', params.date_from, params.date_to, 'total'),
            execLive: () => metaAdapter.getAdPerformance(userId, params.date_from, params.date_to, 'total'),
          });
          channels.push({
            channel: 'meta',
            spend: meta.spend,
            impressions: meta.impressions,
            clicks: meta.clicks,
            ctr: meta.ctr,
            conversions: 0,
            roas_reported: 0,
            currency: meta.currency,
          });
          currencies.add(meta.currency);
        } catch {}

        try {
          const google = await resolveSnapshotFirstData({
            toolName: TOOL_NAME,
            userId,
            refreshSource: 'googleAds',
            buildSnapshot: () =>
              buildAdPerformanceSnapshot(userId, 'googleAds', 'google', params.date_from, params.date_to, 'total'),
            execLive: () => googleAdapter.getAdPerformance(userId, params.date_from, params.date_to, 'total'),
          });
          channels.push({
            channel: 'google',
            spend: google.spend,
            impressions: google.impressions,
            clicks: google.clicks,
            ctr: google.ctr,
            conversions: 0,
            roas_reported: 0,
            currency: google.currency,
          });
          currencies.add(google.currency);
        } catch {}

        const totalSpend = channels.reduce((s, c) => s + c.spend, 0);

        for (const ch of channels) {
          ch.spend_pct = round(totalSpend ? (ch.spend / totalSpend) * 100 : 0);
        }

        const result = {
          date_from: params.date_from,
          date_to: params.date_to,
          channels,
        };

        if (currencies.size <= 1) {
          result.total_spend = round(totalSpend);
          result.currency = currencies.values().next().value || 'USD';
        } else {
          result.currency_note =
            'Accounts use different currencies. Per-channel totals are shown in their native currency. Cross-channel total requires currency normalization.';
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
