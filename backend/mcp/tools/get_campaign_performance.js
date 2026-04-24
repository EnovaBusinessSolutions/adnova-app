'use strict';

const { validateDateRange, resolveDateRangeDefaults, getCampaignPerformanceInput } = require('../schemas/tool-schemas');
const { getCampaignPerformanceOutput } = require('../schemas/output-schemas');
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
      title: 'Get campaign performance',
      description:
        'Retrieves performance metrics broken down by campaign for a given ad channel and date range. Results are ordered by spend desc. Use the returned campaign_id with get_adset_performance to drill down.',
      inputSchema: getCampaignPerformanceInput,
      outputSchema: getCampaignPerformanceOutput,
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

        const lim = params.limit || 10;
        const st = params.status || 'all';

        return runSnapshotFirstTool(
          campaignPerformanceSnapshotOpts(
            userId,
            params.channel,
            date_from,
            date_to,
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
