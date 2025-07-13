const helmet = require('helmet');

/** 1) Política genérica para TODO el SAAS  */
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
        "https://img.icons8.com" // <-- AGREGA ESTA LÍNEA
      ],
      frameAncestors: ["'self'"]   // <-- ¡no deja iframes externos!
    }
  }
});

/** 2) Política especial SOLO para el iframe embebido */
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
