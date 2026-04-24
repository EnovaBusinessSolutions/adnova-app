'use strict';

const { getAccountInfo } = require('../adapters/account');
const { getAccountInfoInput } = require('../schemas/tool-schemas');
const { getAccountInfoOutput } = require('../schemas/output-schemas');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { resolveToolUserId } = require('../mcpContext');
const { checkToolScopes } = require('../scopes');

const TOOL_NAME = 'get_account_info';

function register(server, mcpUserId) {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get connected accounts',
      description:
        "Returns metadata about the merchant's connected ad accounts and Shopify store (account names, IDs, currency, time zone, connection status). Call first to discover which platforms (meta, google, shopify) can be queried.",
      inputSchema: getAccountInfoInput,
      outputSchema: getAccountInfoOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (_params, extra) => {
      try {
        const userId = resolveToolUserId(mcpUserId, extra);
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const sc = checkToolScopes(TOOL_NAME);
        if (!sc.ok) return createToolErrorResponse(sc.code, TOOL_NAME, sc.detail);

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
