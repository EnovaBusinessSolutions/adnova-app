'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

/**
 * Per-request MCP auth context (set around transport.handleRequest).
 * Replaces closure-captured mcpUserId so McpServer instances can be pooled.
 */
function runWithMcpContext(store, fn) {
  return als.run(store, fn);
}

function getMcpContext() {
  return als.getStore() || null;
}

function getMcpUserId() {
  const c = getMcpContext();
  return c?.userId ?? null;
}

function getMcpScopes() {
  const c = getMcpContext();
  return Array.isArray(c?.scopes) ? c.scopes : [];
}

function getMcpClientId() {
  const c = getMcpContext();
  return c?.clientId ?? null;
}

/** User id for tool handlers: ALS first (pooled MCP server), then legacy closure, then SDK extra. */
function resolveToolUserId(mcpUserIdLegacy, extra) {
  return getMcpUserId() ?? mcpUserIdLegacy ?? extra?.userId ?? extra?.request?._mcpUserId;
}

module.exports = {
  runWithMcpContext,
  getMcpContext,
  getMcpUserId,
  getMcpScopes,
  getMcpClientId,
  resolveToolUserId,
};
