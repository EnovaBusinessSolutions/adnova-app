const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../backend/models/User');

const SCOPES = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_analytics',
].join(',');

const scopeHash = crypto.createHash('sha256').update(SCOPES).digest('hex');

module.exports = async function verifyShopifyToken(req, res, next) {
  const authHeader = req.get('Authorization');
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.SHOPIFY_API_SECRET, {
      algorithms: ['HS256'],
    });

    const shop = payload.dest.replace(/^https:\/\//, '');

    const user = await User.findOne({ shop });

    if (!user || !user.shopifyAccessToken)
      return res.status(401).json({ error: 'Usuario no registrado o token faltante' });

    // VALIDACIÓN: si los scopes han cambiado, pedir nueva instalación
    if (user.shopifyScopeHash !== scopeHash) {
      return res.status(403).json({
        error: 'Los permisos han cambiado. Por favor reinstala la app.',
        reinstall: true,
        reinstallUrl: `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${process.env.SHOPIFY_REDIRECT_URI}`,
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
