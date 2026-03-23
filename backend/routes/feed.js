
const express = require('express');
const router = express.Router();
const eventBus = require('../utils/eventBus');

function normalizeAccountId(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
    return host.replace(/^www\./, '');
  } catch (_) {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/**
 * Server-Sent Events (SSE) for Real-Time Dashboard Updates
 * GET /api/feed/:account_id
 */
router.get('/:account_id', (req, res) => {
  const accountId = normalizeAccountId(req.params.account_id);

  // SSE Headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Retry logic (5s)
  res.write('retry: 5000\n\n');

  const writeEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  // Event Listener
  const onEvent = (data) => {
    // Only send if account_id matches (support both new and legacy)
    const eventAccountId = normalizeAccountId(data.accountId || data.shopId);
    if (eventAccountId && accountId && eventAccountId === accountId) {
       writeEvent(data);
    }
  };

  eventBus.on('event', onEvent);

  // Initial ping to keep connection open
  writeEvent({ type: 'connected', accountId, timestamp: new Date().toISOString() });

  // Heartbeat prevents proxies from closing idle SSE streams.
  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
    if (typeof res.flush === 'function') res.flush();
  }, 25000);

  // Cleanup on close
  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off('event', onEvent);
    res.end();
  });
});

module.exports = router;
