'use strict';

const { validateDateRange, resolveDateRangeDefaults, getChannelSummaryInput } = require('../schemas/tool-schemas');
const { getChannelSummaryOutput } = require('../schemas/output-schemas');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { resolveChannelSummaryPayload } = require('../services/adsPerformanceResolve');
const { resolveToolUserId } = require('../mcpContext');
const { checkToolScopes } = require('../scopes');

const TOOL_NAME = 'get_channel_summary';

function register(server, mcpUserId) {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get channel summary',
      description:
        'Returns a side-by-side summary of performance across all connected ad channels (and Shopify revenue when connected) for a given date range. Useful as a first-pass "how did everything do" overview.',
      inputSchema: getChannelSummaryInput,
      outputSchema: getChannelSummaryOutput,
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

        const result = await resolveChannelSummaryPayload(userId, date_from, date_to);
        return createToolResponse(result);
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
