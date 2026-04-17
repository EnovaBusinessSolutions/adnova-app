'use strict';

const express = require('express');
const { createMcpRequestHandler } = require('./server');
const { resolveOAuthUser } = require('./auth/oauth-middleware');

function mountMcpRoutes(app) {
  const mcpRouter = express.Router();

  mcpRouter.use(express.json());

  // Advertise the OAuth protected resource metadata on every MCP response so
  // clients (Claude.ai, ChatGPT, Gemini) can discover the authorization server
  // even without a prior 401 challenge. Required by MCP spec 2025-06-18+.
  mcpRouter.use((req, res, next) => {
    const base = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
    const resourceMetadataUrl = `${base}/.well-known/oauth-protected-resource`;
    res.setHeader(
      'WWW-Authenticate',
      `Bearer realm="adray-mcp", resource_metadata="${resourceMetadataUrl}"`
    );
    next();
  });

  const handler = createMcpRequestHandler(async (req) => {
    try {
      return await resolveOAuthUser(req);
    } catch {
      return null;
    }
  });

  mcpRouter.post('/', handler);
  mcpRouter.get('/', handler);
  mcpRouter.delete('/', handler);

  app.use('/mcp', mcpRouter);

  return mcpRouter;
}

module.exports = { mountMcpRoutes };
