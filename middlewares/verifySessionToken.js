// middlewares/verifySessionToken.js
const {Shopify} = require('@shopify/shopify-api');

module.exports = (req, res, next) => {
  const auth = req.get('Authorization') || '';
  const jwt  = auth.replace(/^Bearer /, '');

  try {
    const payload = Shopify.Utils.decodeSessionToken(jwt);   
    req.shopFromToken = payload.dest;   
    req.userId        = payload.sub;   
    return next();
  } catch (e) {
    res.set('X-Shopify-Retry-Invalid-Session-Request', '1');
    return res.status(401).json({error: 'invalid session token'});
  }
};

