'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { registerAllTools } = require('./registry');

const SERVER_NAME = 'adray-mcp';
const SERVER_VERSION = '1.0.0';

function createMcpServer() {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  registerAllTools(server);

  return server;
}

function createMcpRequestHandler(resolveUserId) {
  return async (req, res) => {
    try {
      const server = createMcpServer();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        transport.close().catch(() => {});
      });

      if (resolveUserId) {
        const userId = await resolveUserId(req);
        if (userId) {
          req._mcpUserId = userId;
        }
      }

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
