// middlewares/verifySessionToken.js
/*
  Reimplemented to strict cryptographic verification using 'jsonwebtoken'.
  Deprecated Shopify.Utils.decodeSessionToken which was failing in new API versions
  and was insecure (no signature verification).
*/
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const auth = req.get('Authorization') || '';
  const token = auth.replace(/^Bearer /, '');

  if (!token) {
    return res.status(401).json({ error: 'Missing session token' });
  }

  // Shopify Session Token uses HS256 algorithm with the API Secret Key as signature
  const secret = process.env.SHOPIFY_API_SECRET;

  if (!secret) {
     console.error('ERROR: SHOPIFY_API_SECRET is not set in environment.');
     return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // 1. Verify signature and expiration
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });

    // 2. Validate timing (nbf, exp) is handled by jwt.verify by default
    // 3. (Optional) Validate iss starts with https://{shop}

    // Attach verified info to request
    req.shopFromToken = payload.dest.replace(/^https:\/\//, ''); // 'shop' domain
    req.userId        = payload.sub; // user ID
    
    // Pass to next handler
    return next();
  } catch (e) {
    console.warn('Session Token Verification Failed:', e.message);
    // Add header to tell App Bridge to retry or re-auth if needed
    res.set('X-Shopify-Retry-Invalid-Session-Request', '1');
    return res.status(401).json({ error: 'invalid session token', details: e.message });
  }
};

