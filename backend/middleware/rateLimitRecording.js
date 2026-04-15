const rateLimit = require('express-rate-limit');

const rateLimitRecording = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  keyGenerator: (req) => {
    const recordingId = req.body?.recording_id || '';
    const accountId = req.body?.account_id || '';
    return `${accountId}:${recordingId}` || req.ip;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
  },
});

module.exports = rateLimitRecording;
