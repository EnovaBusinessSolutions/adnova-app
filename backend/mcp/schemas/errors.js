'use strict';

const ERROR_CODES = {
  ACCOUNT_NOT_CONNECTED: {
    error_code: 'ACCOUNT_NOT_CONNECTED',
    error_message: 'No account is connected for the requested platform.',
    resolution: 'Connect your account at adray.ai/settings/integrations',
  },
  TOKEN_EXPIRED: {
    error_code: 'TOKEN_EXPIRED',
    error_message: 'OAuth token for the platform has expired.',
    resolution: 'Re-authenticate in Adray settings',
  },
  DATE_RANGE_TOO_LARGE: {
    error_code: 'DATE_RANGE_TOO_LARGE',
    error_message: 'Requested date range exceeds 365 days.',
    resolution: 'Narrow the date range to 365 days or fewer',
  },
  NO_DATA_AVAILABLE: {
    error_code: 'NO_DATA_AVAILABLE',
    error_message: 'The platform returned no data for the requested period.',
    resolution: 'Verify activity existed in this date range',
  },
  RATE_LIMITED: {
    error_code: 'RATE_LIMITED',
    error_message: 'Platform API rate limit reached.',
    resolution: 'Retry in a few minutes',
  },
  INSUFFICIENT_PERMISSIONS: {
    error_code: 'INSUFFICIENT_PERMISSIONS',
    error_message: 'Adray token lacks the required platform scope.',
    resolution: 'Reconnect the account with full permissions at adray.ai/settings/integrations',
  },
  INVALID_PARAMETERS: {
    error_code: 'INVALID_PARAMETERS',
    error_message: 'One or more parameters are invalid.',
    resolution: 'Check parameter types and allowed values',
  },
  UNAUTHORIZED: {
    error_code: 'UNAUTHORIZED',
    error_message: 'Authentication required.',
    resolution: 'Provide a valid OAuth bearer token',
  },
  INTERNAL_ERROR: {
    error_code: 'INTERNAL_ERROR',
    error_message: 'An unexpected error occurred.',
    resolution: 'Retry the request or contact support',
  },
  CAMPAIGN_NOT_FOUND: {
    error_code: 'CAMPAIGN_NOT_FOUND',
    error_message: 'The specified campaign was not found.',
    resolution: 'Verify the campaign_id using get_campaign_performance',
  },
};

function createToolError(code, toolName, extraMessage) {
  const template = ERROR_CODES[code] || ERROR_CODES.INTERNAL_ERROR;
  return {
    error: true,
    error_code: template.error_code,
    error_message: extraMessage
      ? `${template.error_message} ${extraMessage}`
      : template.error_message,
    resolution: template.resolution,
    tool: toolName,
    timestamp: new Date().toISOString(),
  };
}

function createToolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function createToolErrorResponse(code, toolName, extraMessage) {
  const errorPayload = createToolError(code, toolName, extraMessage);
  return {
    content: [{ type: 'text', text: JSON.stringify(errorPayload) }],
    isError: true,
  };
}

module.exports = {
  ERROR_CODES,
  createToolError,
  createToolResponse,
  createToolErrorResponse,
};
