'use strict';

const { z } = require('zod');
const { validateDateRange } = require('../schemas/tool-schemas');
const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');

const TOOL_NAME = 'get_adset_performance';

function register(server) {
  server.tool(
    TOOL_NAME,
    'Retrieves performance metrics broken down by ad set (Meta) or ad group (Google) within a specified campaign.',
    {
      channel: z.enum(['meta', 'google']).describe('Ad platform to query'),
      campaign_id: z.string().min(1).describe('Platform-native campaign ID'),
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

        const adapter = params.channel === 'meta' ? metaAdapter : googleAdapter;
        const data = await adapter.getAdsetPerformance(
          userId, params.campaign_id, params.date_from, params.date_to
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
