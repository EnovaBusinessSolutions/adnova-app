
const express = require('express');
const router = express.Router();
const eventBus = require('../utils/eventBus');

/**
 * Server-Sent Events (SSE) for Real-Time Dashboard Updates
 * GET /api/feed/:account_id
 */
router.get('/:account_id', (req, res) => {
  const { account_id } = req.params;

  // SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Retry logic (5s)
  res.write('retry: 5000\n\n');

  // Event Listener
  const onEvent = (data) => {
    // Only send if account_id matches (support both new and legacy)
    if (data.accountId === account_id || data.shopId === account_id) {
       res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  eventBus.on('event', onEvent);

  // Initial ping to keep connection open
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date() })}\n\n`);

  // Cleanup on close
  req.on('close', () => {
    eventBus.off('event', onEvent);
    res.end();
  });
});

module.exports = router;
