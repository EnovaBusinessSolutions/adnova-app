const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../backend/models/User');

const SCOPES = ['read_products','read_orders','read_customers','read_analytics'].join(',');
const scopeHashExpected = crypto.createHash('sha256').update(SCOPES).digest('hex');

module.exports = async function verifyShopifyToken(req, res, next) {
  const authHeader = req.get('Authorization');
  if (!authHeader)
    return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.replace('Bearer ', '');
  try {
    let payload;
    try {
      payload = jwt.verify(token, process.env.SHOPIFY_API_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    if (payload.scopeHash !== scopeHashExpected) {
      return res.status(403).json({ error: 'Scope inválido' });
    }

    const shop = payload.dest;
    const user = await User.findOne({ shop });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (
      user.shopifyScopeHashUpdatedAt &&
      payload.iat * 1000 < user.shopifyScopeHashUpdatedAt
    ) {
      return res.status(401).json({
        reinstall: true,
        reinstallUrl:
          `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}` +
          `&scope=${SCOPES}&redirect_uri=${process.env.SHOPIFY_REDIRECT_URI}`,
      });
    }

    req.shopifyTokenPayload = payload;
    req.shop = shop;
    req.shopifySession = payload;
    next();
  } catch (err) {
    console.error('❌ Error al verificar token Shopify:', err);
    res.status(401).json({ error: 'Token inválido' });
  }
};
