'use strict';

const { z } = require('zod');
const { validateDateRange } = require('../schemas/tool-schemas');
const shopifyAdapter = require('../adapters/shopify');
const { createToolErrorResponse } = require('../schemas/errors');
const { runSnapshotFirstTool } = require('../snapshot/runSnapshotFirst');

const TOOL_NAME = 'get_shopify_revenue';

/** Shopify orders are not stored in mcpdata chunks yet — live API only; wrapper keeps metrics/logging consistent. */
function register(server) {
  server.tool(
    TOOL_NAME,
    'Retrieves order and revenue data from the connected Shopify store for a given date range.',
    {
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

        return runSnapshotFirstTool({
          toolName: TOOL_NAME,
          userId,
          refreshSource: null,
          buildSnapshot: async () => ({ ok: false }),
          execLive: () =>
            shopifyAdapter.getShopifyRevenue(userId, params.date_from, params.date_to, params.granularity || 'total'),
        });
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
