'use strict';

const { validateDateRange, resolveDateRangeDefaults, getShopifyRevenueInput } = require('../schemas/tool-schemas');
const shopifyAdapter = require('../adapters/shopify');
const { createToolErrorResponse } = require('../schemas/errors');
const { runSnapshotFirstTool } = require('../snapshot/runSnapshotFirst');
const { resolveToolUserId } = require('../mcpContext');
const { checkToolScopes } = require('../scopes');

const TOOL_NAME = 'get_shopify_revenue';

/** Shopify orders are not stored in mcpdata chunks yet — live API only; wrapper keeps metrics/logging consistent. */
function register(server, mcpUserId) {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'Retrieves order and revenue data from the connected Shopify store for a given date range.',
      inputSchema: getShopifyRevenueInput,
      annotations: { readOnlyHint: true },
    },
    async (params, extra) => {
      try {
        const userId = resolveToolUserId(mcpUserId, extra);
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const sc = checkToolScopes(TOOL_NAME);
        if (!sc.ok) return createToolErrorResponse(sc.code, TOOL_NAME, sc.detail);

        const { date_from, date_to } = resolveDateRangeDefaults(params.date_from, params.date_to);
        const rangeError = validateDateRange(date_from, date_to);
        if (rangeError) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, rangeError);

        return runSnapshotFirstTool({
          toolName: TOOL_NAME,
          userId,
          refreshSource: null,
          buildSnapshot: async () => ({ ok: false }),
          execLive: () =>
            shopifyAdapter.getShopifyRevenue(userId, date_from, date_to, params.granularity || 'total'),
        });
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
