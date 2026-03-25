'use strict';

const { z } = require('zod');
const { validateDateRange } = require('../schemas/tool-schemas');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { resolveChannelSummaryPayload } = require('../services/adsPerformanceResolve');

const TOOL_NAME = 'get_channel_summary';

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

        const result = await resolveChannelSummaryPayload(userId, params.date_from, params.date_to);
        return createToolResponse(result);
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
