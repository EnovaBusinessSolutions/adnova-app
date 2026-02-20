const jwt = require('jsonwebtoken');

function getBearerToken(req) {
  const auth = req.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function normalizeShop(dest) {
  if (!dest) return '';
  return String(dest)
    .replace(/^https?:\/\//i, '')
    .replace(/\/admin\/?$/i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function setReauthHeaders(req, res) {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const shop = String(req.query?.shop || '').trim();
  const host = String(req.query?.host || '').trim();

  res.set('X-Shopify-Retry-Invalid-Session-Request', '1');
  res.set('X-Shopify-API-Request-Failure-Reauthorize', '1');

  if (appUrl && shop) {
    const url = new URL('/connector/interface', appUrl);
    url.searchParams.set('shop', shop);
    if (host) url.searchParams.set('host', host);
    res.set('X-Shopify-API-Request-Failure-Reauthorize-Url', url.toString());
  }
}

module.exports = (req, res, next) => {
  const token = getBearerToken(req);
  const secret = process.env.SHOPIFY_API_SECRET;
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (!token || !secret || !apiKey) {
    setReauthHeaders(req, res);
    return res.status(401).json({ error: 'missing session token configuration' });
  }

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      audience: apiKey,
    });

    const shop = normalizeShop(payload.dest || payload.iss);
    if (!shop.endsWith('.myshopify.com')) {
      setReauthHeaders(req, res);
      return res.status(401).json({ error: 'invalid session token destination' });
    }

    req.shopFromToken = shop;
    req.shop = shop;
    req.userId = payload.sub;
    req.shopifySession = payload;
    return next();
  } catch (_err) {
    setReauthHeaders(req, res);
    return res.status(401).json({ error: 'invalid session token' });
  }
};

