'use strict';

/**
 * OAuth scopes required per MCP tool (subset of oauth_clients.scopes).
 * INSUFFICIENT_PERMISSIONS if token lacks required scope(s).
 */

const { getMcpScopes } = require('./mcpContext');

/** @type {Record<string, string | string[] | { anyOf: string[] }>} */
const TOOL_SCOPE_RULES = {
  get_account_info: { anyOf: ['read:ads_performance', 'read:shopify_orders'] },
  get_ad_performance: 'read:ads_performance',
  get_campaign_performance: 'read:ads_performance',
  get_adset_performance: 'read:ads_performance',
  get_channel_summary: 'read:ads_performance',
  get_date_comparison: { anyOf: ['read:ads_performance', 'read:shopify_orders'] },
  get_shopify_revenue: 'read:shopify_orders',
  get_shopify_products: 'read:shopify_orders',
};

function scopesAllow(rule, granted) {
  const g = new Set((granted || []).filter(Boolean));
  if (typeof rule === 'string') return g.has(rule);
  if (Array.isArray(rule)) return rule.every((s) => g.has(s));
  if (rule?.anyOf) return rule.anyOf.some((s) => g.has(s));
  return true;
}

/**
 * @param {string} toolName
 * @param {string[]|undefined} [scopesOverride] — e.g. req._mcpScopes from REST
 * @returns {{ ok: true } | { ok: false, code: 'INSUFFICIENT_PERMISSIONS', detail: string }}
 */
function checkToolScopes(toolName, scopesOverride) {
  const rule = TOOL_SCOPE_RULES[toolName];
  if (!rule) return { ok: true };

  const granted = scopesOverride ?? getMcpScopes();
  if (scopesAllow(rule, granted)) return { ok: true };

  const need =
    typeof rule === 'string'
      ? rule
      : Array.isArray(rule)
        ? rule.join(', ')
        : rule.anyOf.join(' or ');
  return {
    ok: false,
    code: 'INSUFFICIENT_PERMISSIONS',
    detail: `This tool requires OAuth scope: ${need}`,
  };
}

module.exports = {
  TOOL_SCOPE_RULES,
  checkToolScopes,
  scopesAllow,
};
