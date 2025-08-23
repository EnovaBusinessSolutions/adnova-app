const helmet = require('helmet');

const publicCSP = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: [
        "'self'",
        "data:",
        "https://img.icons8.com" 
      ],
      frameAncestors: ["'self'"]   
    }
  }
});

const shopifyCSP = helmet({
  frameguard: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      frameAncestors: [
        "'self'",
        "https://admin.shopify.com",
        "https://*.myshopify.com"
      ],
      scriptSrc: [
        "'self'", "'unsafe-inline'", "'unsafe-eval'",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net"
      ],
      connectSrc: [
        "'self'",
        "https://*.myshopify.com",
        "https://admin.shopify.com"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https://img.icons8.com"
      ]
    }
  }
});

module.exports = { publicCSP, shopifyCSP };
