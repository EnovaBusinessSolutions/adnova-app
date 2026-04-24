'use strict';

const { validateDateRange, resolveDateRangeDefaults, getShopifyProductsInput } = require('../schemas/tool-schemas');
const { getShopifyProductsOutput } = require('../schemas/output-schemas');
const shopifyAdapter = require('../adapters/shopify');
const { createToolErrorResponse } = require('../schemas/errors');
const { runSnapshotFirstTool } = require('../snapshot/runSnapshotFirst');
const { resolveToolUserId } = require('../mcpContext');
const { checkToolScopes } = require('../scopes');

const TOOL_NAME = 'get_shopify_products';

function register(server, mcpUserId) {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get top Shopify products',
      description:
        'Retrieves the top-selling products from the connected Shopify store, ranked by revenue or units sold, for a given date range. Use limit (1–50) to cap the number of products returned.',
      inputSchema: getShopifyProductsInput,
      outputSchema: getShopifyProductsOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
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
            shopifyAdapter.getShopifyProducts(
              userId,
              date_from,
              date_to,
              params.sort_by || 'revenue',
              params.limit || 10
            ),
        });
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
