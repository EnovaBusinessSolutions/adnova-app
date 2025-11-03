// middlewares/csp.js
const helmet = require('helmet');

const publicCSP = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      // Necesario para el widget de Calendly
      scriptSrc:  ["'self'", "https://assets.calendly.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://assets.calendly.com"],
      frameSrc:   ["'self'", "https://calendly.com"],
      connectSrc: ["'self'", "https://calendly.com"],

      imgSrc: [
        "'self'",
        "data:",
        "https:",                          // imágenes seguras en general
        "https://upload.wikimedia.org",
        "https://img.icons8.com",
        "https://assets.calendly.com"      // iconos/imágenes del widget
      ],

      // Quién puede embeber TU sitio (no quién puedes embeber tú)
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
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com"
      ]
    }
  }
});

module.exports = { publicCSP, shopifyCSP };
