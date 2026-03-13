const rateLimit = require('express-rate-limit');

const rateLimitCollect = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP/shop to 100 requests per windowMs
  keyGenerator: (req) => {
    // Try to rate limit by shop_id first, fallback to IP if not provided
    return req.body?.shop_id || req.ip;
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded'
    });
  }
});

module.exports = rateLimitCollect;
