'use strict';

const { z } = require('zod');
const { validateDateRange } = require('../schemas/tool-schemas');
const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');

const TOOL_NAME = 'get_campaign_performance';

function register(server) {
  server.tool(
    TOOL_NAME,
    'Retrieves performance metrics broken down by campaign for a given ad channel and date range.',
    {
      channel: z.enum(['meta', 'google']).describe('Ad platform to query'),
      date_from: z.string().describe('Start date (YYYY-MM-DD)'),
      date_to: z.string().describe('End date (YYYY-MM-DD)'),
      limit: z.number().int().min(1).max(50).optional().default(10).describe('Max campaigns to return'),
      status: z.enum(['active', 'paused', 'all']).optional().default('all').describe('Filter by campaign status'),
    },
    { readOnlyHint: true },
    async (params, extra) => {
      try {
        const userId = extra?.userId || extra?.request?._mcpUserId;
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const rangeError = validateDateRange(params.date_from, params.date_to);
        if (rangeError) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, rangeError);

        const adapter = params.channel === 'meta' ? metaAdapter : googleAdapter;
        const data = await adapter.getCampaignPerformance(
          userId, params.date_from, params.date_to,
          params.limit || 10, params.status || 'all'
        );
        return createToolResponse(data);
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
