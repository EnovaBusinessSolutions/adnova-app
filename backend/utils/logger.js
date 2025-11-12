// backend/utils/logger.js
'use strict';

const sanitize = require('../middleware/sanitizeLogs');

function stamp(level, args) {
  const ts = new Date().toISOString();
  const safe = Array.from(args).map(a => sanitize(a));
  return [`[${ts}] ${level.toUpperCase()}:`, ...safe];
}

module.exports = {
  info:  (...args) => console.log(...stamp('info',  args)),
  warn:  (...args) => console.warn(...stamp('warn',  args)),
  error: (...args) => console.error(...stamp('error', args)),
  debug: (...args) => {
    if (process.env.DEBUG) console.debug(...stamp('debug', args));
  },
};
