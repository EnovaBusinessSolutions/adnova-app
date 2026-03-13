'use strict';

const { z } = require('zod');
const { getAccountInfo } = require('../adapters/account');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');

const TOOL_NAME = 'get_account_info';

function register(server) {
  server.tool(
    TOOL_NAME,
    'Returns metadata about the merchant\'s connected ad accounts and Shopify store (account names, IDs, currency, time zone, connection status).',
    {},
    { readOnlyHint: true },
    async (params, extra) => {
      try {
        const userId = extra?.userId || extra?.request?._mcpUserId;
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const data = await getAccountInfo(userId);
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
