/**
 * stagingForward.js
 *
 * Fire-and-forget mirror of inbound pixel/woo-sync requests to the staging
 * environment. Enabled by setting STAGING_FORWARD_URL in the production
 * Render service (e.g. https://adray-app-staging-german.onrender.com).
 *
 * Rules:
 * - Completely non-blocking: never slows down the production response.
 * - Failures are silently swallowed: staging being down never affects prod.
 * - Adds X-Forwarded-From: production so staging logs can distinguish it.
 * - Only active when STAGING_FORWARD_URL is set; no-op otherwise.
 */

const https = require('https');
const http = require('http');

const STAGING_FORWARD_URL = String(process.env.STAGING_FORWARD_URL || '').trim().replace(/\/$/, '');

/**
 * Forward a JSON payload to the staging environment.
 *
 * @param {string} path  - e.g. '/collect' or '/api/woo/orders-sync'
 * @param {object} body  - already-parsed JS object to re-serialise
 */
function forwardToStaging(path, body) {
  if (!STAGING_FORWARD_URL) return;

  setImmediate(() => {
    try {
      const target = new URL(path, STAGING_FORWARD_URL);
      const serialised = JSON.stringify(body);
      const buf = Buffer.from(serialised, 'utf8');

      const options = {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': buf.length,
          'X-Forwarded-From': 'production',
        },
        timeout: 8000,
        rejectUnauthorized: false, // staging uses self-signed / Let's Encrypt
      };

      const lib = target.protocol === 'https:' ? https : http;
      const req = lib.request(options);

      req.on('error', () => {});   // silently swallow all errors
      req.on('timeout', () => { try { req.destroy(); } catch (_) {} });

      req.write(buf);
      req.end();
    } catch (_) {
      // silently swallow parse / URL errors
    }
  });
}

module.exports = { forwardToStaging };
