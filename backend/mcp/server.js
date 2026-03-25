'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { registerAllTools } = require('./registry');

const SERVER_NAME = 'adray-mcp';
const SERVER_VERSION = '1.0.0';

function createMcpServer(mcpUserId) {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  registerAllTools(server, mcpUserId);

  return server;
}

function createMcpRequestHandler(resolveUserId) {
  return async (req, res) => {
    try {
      let mcpUserId = null;
      if (resolveUserId) {
        mcpUserId = await resolveUserId(req);
        if (mcpUserId) {
          req._mcpUserId = mcpUserId;
        }
      }

      const server = createMcpServer(mcpUserId);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        transport.close().catch(() => {});
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp/server] request error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP_SERVER_ERROR' });
      }
    }
  };
}

module.exports = { createMcpServer, createMcpRequestHandler, SERVER_NAME, SERVER_VERSION };
