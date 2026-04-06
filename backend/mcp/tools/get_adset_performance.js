'use strict';

const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const { validateDateRange, getAdsetPerformanceInput } = require('../schemas/tool-schemas');
const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');
const { isGoogleReadsFromDbOnly } = require('../snapshot/config');
const { resolveToolUserId } = require('../mcpContext');
const { checkToolScopes } = require('../scopes');

const TOOL_NAME = 'get_adset_performance';

function register(server, mcpUserId) {
  server.tool(
    TOOL_NAME,
    'Retrieves performance metrics broken down by ad set (Meta) or ad group (Google) for a campaign.',
    getAdsetPerformanceInput,
    { readOnlyHint: true },
    async (params, extra) => {
      try {
        const userId = resolveToolUserId(mcpUserId, extra);
        if (!userId) return createToolErrorResponse('UNAUTHORIZED', TOOL_NAME);

        const sc = checkToolScopes(TOOL_NAME);
        if (!sc.ok) return createToolErrorResponse(sc.code, TOOL_NAME, sc.detail);

        const rangeError = validateDateRange(params.date_from, params.date_to);
        if (rangeError) return createToolErrorResponse('DATE_RANGE_TOO_LARGE', TOOL_NAME, rangeError);

        if (params.channel === 'google' && isGoogleReadsFromDbOnly()) {
          return createToolResponse({
            channel: 'google',
            campaign_id: params.campaign_id,
            campaign_name: null,
            adsets: [],
            date_from: params.date_from,
            date_to: params.date_to,
          });
        }

        const adapter = params.channel === 'meta' ? metaAdapter : googleAdapter;
        const data = await adapter.getAdsetPerformance(
          userId,
          params.campaign_id,
          params.date_from,
          params.date_to
        );
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
