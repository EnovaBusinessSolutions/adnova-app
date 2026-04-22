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
  //
  // Host-aware: the resource_metadata URL must live on the same host the client
  // reached. If a client hits mcp.adray.ai but we advertise adray.ai, they try
  // to fetch from a host their network can't reach (see the note in
  // backend/index.js on /.well-known/oauth-authorization-server).
  const setWwwAuthenticate = (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    const resourceMetadataUrl = `${base}/.well-known/oauth-protected-resource`;
    res.setHeader(
      'WWW-Authenticate',
      `Bearer realm="adray-mcp", resource_metadata="${resourceMetadataUrl}"`
    );
  };

  mcpRouter.use((req, res, next) => {
    setWwwAuthenticate(req, res);
    next();
  });

  // Reject unauthenticated requests with 401 so MCP clients (Claude.ai) know to
  // start the OAuth flow. Without this, clients see HTTP 200 and assume the
  // endpoint is open, never triggering OAuth discovery.
  mcpRouter.use(async (req, res, next) => {
    const authHeader = req.headers?.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      setWwwAuthenticate(req, res);
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: OAuth bearer token required' },
        id: null,
      });
    }
    try {
      const oauth = await resolveOAuthUser(req);
      if (!oauth?.userId) {
        setWwwAuthenticate(req, res);
        return res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized: Invalid or expired token' },
          id: null,
        });
      }
    } catch (err) {
      console.error('[mcp/transport] auth check failed:', err);
      setWwwAuthenticate(req, res);
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      });
    }
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
