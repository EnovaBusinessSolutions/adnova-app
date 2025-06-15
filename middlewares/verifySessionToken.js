const {Jwt} = require('@shopify/shopify-api');

module.exports = function verifySessionToken(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer /, '');

  try {
    const payload = Jwt.decodeSessionToken(token, process.env.SHOPIFY_API_KEY);
    req.shopFromToken = payload.dest;   // p.ej. tienda.myshopify.com
    next();
  } catch (e) {
    console.error('Invalid session token', e.message);
    return res.status(401).json({error: 'Invalid session token'});
  }
};
