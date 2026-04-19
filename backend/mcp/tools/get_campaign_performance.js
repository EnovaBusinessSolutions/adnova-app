'use strict';

const { validateDateRange, getCampaignPerformanceInput } = require('../schemas/tool-schemas');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { runSnapshotFirstTool } = require('../snapshot/runSnapshotFirst');
const { campaignPerformanceSnapshotOpts } = require('../services/adsPerformanceResolve');
const { resolveToolUserId } = require('../mcpContext');
const { checkToolScopes } = require('../scopes');

const TOOL_NAME = 'get_campaign_performance';

function register(server, mcpUserId) {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'Retrieves performance metrics broken down by campaign for a given ad channel and date range.',
      inputSchema: getCampaignPerformanceInput,
      annotations: { readOnlyHint: true },
    },
    async (params, extra) => {
      try {
        const userId = resolveToolUserId(mcpUserId, extra);
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const sc = checkToolScopes(TOOL_NAME);
        if (!sc.ok) return createToolErrorResponse(sc.code, TOOL_NAME, sc.detail);

        const rangeError = validateDateRange(params.date_from, params.date_to);
        if (rangeError) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, rangeError);

        const lim = params.limit || 10;
        const st = params.status || 'all';

        return runSnapshotFirstTool(
          campaignPerformanceSnapshotOpts(
            userId,
            params.channel,
            params.date_from,
            params.date_to,
            lim,
            st
          )
        );
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        return createToolErrorResponse(err.code || 'INTERNAL_ERROR', TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
