'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { registerAllTools } = require('./registry');
const { runWithMcpContext } = require('./mcpContext');

const SERVER_NAME = 'adray-mcp';
const SERVER_VERSION = '1.0.0';

/** @type {Array<{ server: object, busy: boolean }>} */
let _pool = [];
const _waitQueue = [];

function poolSize() {
  const n = Number(process.env.MCP_SERVER_POOL_SIZE || 4);
  if (!Number.isFinite(n) || n < 1) return 4;
  return Math.min(Math.trunc(n), 32);
}

function buildServerInstance() {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  registerAllTools(server, null);
  return server;
}

function ensurePool() {
  if (_pool.length > 0) return;
  const n = poolSize();
  for (let i = 0; i < n; i++) {
    _pool.push({ server: buildServerInstance(), busy: false });
  }
}

/**
 * SDK: one Protocol transport at a time per McpServer — reuse instances via pool + close() between requests.
 */
function acquirePooledSlot() {
  ensurePool();
  const free = _pool.find((p) => !p.busy);
  if (free) {
    free.busy = true;
    return Promise.resolve(free);
  }
  return new Promise((resolve) => {
    _waitQueue.push(resolve);
  });
}

function releasePooledSlot(slot) {
  if (_waitQueue.length) {
    const resolve = _waitQueue.shift();
    resolve(slot);
  } else {
    slot.busy = false;
  }
}

/**
 * Tests or callers that need an isolated server with tools registered (no pool).
 * @deprecated Prefer pool via createMcpRequestHandler.
 */
function createMcpServer(_mcpUserIdLegacy) {
  return buildServerInstance();
}

function createMcpRequestHandler(resolveUserId) {
  return async (req, res) => {
    let slot = null;
    try {
      let oauth = null;
      if (resolveUserId) {
        oauth = await resolveUserId(req);
        if (oauth?.userId) {
          req._mcpUserId = oauth.userId;
          req._mcpScopes = oauth.scopes;
          req._mcpClientId = oauth.clientId;
        }
      }

      slot = await acquirePooledSlot();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        transport.close().catch(() => {});
      });

      const ctx = oauth?.userId
        ? {
            userId: oauth.userId,
            scopes: Array.isArray(oauth.scopes) ? oauth.scopes : [],
            clientId: oauth.clientId || null,
          }
        : { userId: null, scopes: [], clientId: null };

      await runWithMcpContext(ctx, async () => {
        await slot.server.connect(transport);
        try {
          await transport.handleRequest(req, res, req.body);
        } finally {
          await slot.server.close().catch(() => {});
        }
      });
    } catch (err) {
      console.error('[mcp/server] request error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP_SERVER_ERROR' });
      }
    } finally {
      if (slot) releasePooledSlot(slot);
    }
  };
}

module.exports = {
  createMcpServer,
  createMcpRequestHandler,
  SERVER_NAME,
  SERVER_VERSION,
};
