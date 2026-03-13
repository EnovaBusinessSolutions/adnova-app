'use strict';

const { z } = require('zod');
const { getAdPerformanceInput, validateDateRange } = require('../schemas/tool-schemas');
const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');

const TOOL_NAME = 'get_ad_performance';

function register(server) {
  server.tool(
    TOOL_NAME,
    'Retrieves ad performance metrics (spend, impressions, clicks, CTR, CPC, CPM) for a given channel and date range.',
    {
      channel: z.enum(['meta', 'google', 'all']).describe('Ad platform to query'),
      date_from: z.string().describe('Start date (YYYY-MM-DD)'),
      date_to: z.string().describe('End date (YYYY-MM-DD)'),
      granularity: z.enum(['day', 'week', 'month', 'total']).optional().default('total').describe('Time breakdown'),
    },
    { readOnlyHint: true },
    async (params, extra) => {
      try {
        const userId = extra?.userId || extra?.request?._mcpUserId;
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const rangeError = validateDateRange(params.date_from, params.date_to);
        if (rangeError) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, rangeError);

        const gran = params.granularity || 'total';

        if (params.channel === 'all') {
          const results = [];
          try { results.push(await metaAdapter.getAdPerformance(userId, params.date_from, params.date_to, gran)); } catch {}
          try { results.push(await googleAdapter.getAdPerformance(userId, params.date_from, params.date_to, gran)); } catch {}
          return createToolResponse(results);
        }

        if (params.channel === 'meta') {
          const data = await metaAdapter.getAdPerformance(userId, params.date_from, params.date_to, gran);
          return createToolResponse(data);
        }

        const data = await googleAdapter.getAdPerformance(userId, params.date_from, params.date_to, gran);
        return createToolResponse(data);
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        const code = err.code || 'INTERNAL_ERROR';
        return createToolErrorResponse(code, TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
