'use strict';

const { validateDateRange, getAdPerformanceInput } = require('../schemas/tool-schemas');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { runSnapshotFirstTool } = require('../snapshot/runSnapshotFirst');
const { resolveAdPerformance, adPerformanceSnapshotOpts } = require('../services/adsPerformanceResolve');
const { resolveToolUserId } = require('../mcpContext');
const { checkToolScopes } = require('../scopes');

const TOOL_NAME = 'get_ad_performance';

function register(server, mcpUserId) {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'Retrieves ad performance metrics (spend, impressions, clicks, CTR, CPC, CPM) for a given channel and date range.',
      inputSchema: getAdPerformanceInput,
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

        const gran = params.granularity || 'total';

        if (params.channel === 'all') {
          const [rMeta, rGoogle] = await Promise.allSettled([
            resolveAdPerformance(userId, 'meta', params.date_from, params.date_to, gran),
            resolveAdPerformance(userId, 'google', params.date_from, params.date_to, gran),
          ]);
          const results = [];
          if (rMeta.status === 'fulfilled') results.push(rMeta.value);
          if (rGoogle.status === 'fulfilled') results.push(rGoogle.value);
          return createToolResponse(results);
        }

        return runSnapshotFirstTool(
          adPerformanceSnapshotOpts(userId, params.channel, params.date_from, params.date_to, gran)
        );
      } catch (err) {
        console.error(`[${TOOL_NAME}] error:`, err);
        const code = err.code || 'INTERNAL_ERROR';
        return createToolErrorResponse(code, TOOL_NAME, err.message);
      }
    }
  );
}

module.exports = { register, TOOL_NAME };
