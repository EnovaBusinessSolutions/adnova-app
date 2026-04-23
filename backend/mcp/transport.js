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

  // Workaround for @hono/node-server bridge (used by MCP SDK's
  // StreamableHTTPServerTransport): when the SDK builds a native Response with
  // Content-Type: text/event-stream for SSE, the bridge drops that header and
  // falls back to its default "text/plain; charset=UTF-8". Claude.ai's MCP
  // client validates content-type and surfaces the mismatch as
  // "The MCP server returned a 502 status code error", even though the server
  // returned 200 with a well-formed SSE body.
  //
  // Fix: intercept res.writeHead and res.setHeader on the outgoing response and
  // rewrite text/plain -> text/event-stream when the client negotiated SSE.
  //
  // Scope is intentionally narrow: only activates when the request's Accept
  // header includes text/event-stream, so non-SSE responses (including the
  // 401 JSON errors above) are untouched.
  const sseContentTypeFix = (req, res, next) => {
    const accept = String(req.headers?.accept || '');
    if (!accept.includes('text/event-stream')) return next();

    const patchCt = (value) => {
      const v = String(value || '').toLowerCase();
      if (v.startsWith('text/plain')) return 'text/event-stream';
      return value;
    };

    const origSetHeader = res.setHeader.bind(res);
    res.setHeader = function patchedSetHeader(name, value) {
      if (typeof name === 'string' && name.toLowerCase() === 'content-type') {
        return origSetHeader(name, patchCt(value));
      }
      return origSetHeader(name, value);
    };

    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = function patchedWriteHead(statusCode, ...rest) {
      let headers = null;
      if (rest.length && typeof rest[rest.length - 1] === 'object' && rest[rest.length - 1] !== null) {
        headers = rest[rest.length - 1];
      }
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'content-type') {
            headers[key] = patchCt(headers[key]);
          }
        }
      }
      return origWriteHead(statusCode, ...rest);
    };

    next();
  };

  mcpRouter.post('/', sseContentTypeFix, handler);
  mcpRouter.get('/', sseContentTypeFix, handler);
  mcpRouter.delete('/', sseContentTypeFix, handler);

  app.use('/mcp', mcpRouter);

  return mcpRouter;
}

module.exports = { mountMcpRoutes };
