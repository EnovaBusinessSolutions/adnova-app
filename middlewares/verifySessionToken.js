// middlewares/verifySessionToken.js

const { Jwt } = require('@shopify/shopify-api');

module.exports = function verifySessionToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s/, '');

  try {
    // ⚠️ Usamos el API_SECRET para verificar la firma del JWT
    const payload = Jwt.decodeSessionToken(token, process.env.SHOPIFY_API_SECRET);

    // payload.dest contiene la tienda, payload.sub es el userId
    req.shopFromToken = payload.dest;      // e.g. 'mystore.myshopify.com'
    req.userId       = payload.sub;       // opcional: ID único del usuario

    return next();
  } catch (err) {
    console.error('🛑 Invalid session token:', err.message);
    return res
      .status(401)
      .json({ error: 'Invalid or expired session token' });
  }
};
