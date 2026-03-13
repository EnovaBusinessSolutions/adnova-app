'use strict';

const express = require('express');
const { createMcpRequestHandler } = require('./server');
const { resolveOAuthUser } = require('./auth/oauth-middleware');

function mountMcpRoutes(app) {
  const mcpRouter = express.Router();

  mcpRouter.use(express.json());

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
