const AppBridge = require('@shopify/app-bridge-utils');

const verifyShopifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token missing or invalid' });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf8')
    );

    req.shop = payload.dest.replace(/^https:\/\//, '');
    req.shopifyTokenPayload = payload;
    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
};

module.exports = verifyShopifyToken;
