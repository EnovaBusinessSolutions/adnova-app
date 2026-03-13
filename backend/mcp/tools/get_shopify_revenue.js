'use strict';

const { z } = require('zod');
const { validateDateRange } = require('../schemas/tool-schemas');
const shopifyAdapter = require('../adapters/shopify');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');

const TOOL_NAME = 'get_shopify_revenue';

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

        const data = await shopifyAdapter.getShopifyRevenue(
          userId, params.date_from, params.date_to, params.granularity || 'total'
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
