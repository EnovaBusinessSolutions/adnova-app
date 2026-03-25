'use strict';

const { z } = require('zod');
const { validateDateRange } = require('../schemas/tool-schemas');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { resolveDateComparisonPayload } = require('../services/adsPerformanceResolve');

const TOOL_NAME = 'get_date_comparison';

function register(server, mcpUserId) {
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
        const userId = mcpUserId ?? extra?.userId ?? extra?.request?._mcpUserId;
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const errA = validateDateRange(params.period_a_from, params.period_a_to);
        if (errA) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, errA);
        const errB = validateDateRange(params.period_b_from, params.period_b_to);
        if (errB) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, errB);

        const result = await resolveDateComparisonPayload(
          userId,
          params.channel,
          params.period_a_from,
          params.period_a_to,
          params.period_b_from,
          params.period_b_to
        );
        return createToolResponse(result);
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
