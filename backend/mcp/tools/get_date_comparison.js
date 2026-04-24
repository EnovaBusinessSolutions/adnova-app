'use strict';

const { validateDateRange, resolveComparisonDefaults, getDateComparisonInput } = require('../schemas/tool-schemas');
const { getDateComparisonOutput } = require('../schemas/output-schemas');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { resolveDateComparisonPayload } = require('../services/adsPerformanceResolve');
const { resolveToolUserId } = require('../mcpContext');
const { checkToolScopes } = require('../scopes');

const TOOL_NAME = 'get_date_comparison';

function register(server, mcpUserId) {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Compare two date periods',
      description:
        'Compares performance metrics between two date periods for a given channel (or "all"). Period A is the baseline, period B is the more recent window; the response includes absolute and percentage deltas.',
      inputSchema: getDateComparisonInput,
      outputSchema: getDateComparisonOutput,
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

        const {
          period_a_from,
          period_a_to,
          period_b_from,
          period_b_to,
        } = resolveComparisonDefaults(
          params.period_a_from,
          params.period_a_to,
          params.period_b_from,
          params.period_b_to
        );

        const errA = validateDateRange(period_a_from, period_a_to);
        if (errA) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, errA);
        const errB = validateDateRange(period_b_from, period_b_to);
        if (errB) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, errB);

        const result = await resolveDateComparisonPayload(
          userId,
          params.channel,
          period_a_from,
          period_a_to,
          period_b_from,
          period_b_to
        );
        return createToolResponse(result);
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
