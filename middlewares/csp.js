// middlewares/csp.js
const helmet = require('helmet');

/**
 * CSP pública (landing, bookcall, etc.)
 * - Permitimos imágenes desde el propio sitio, data: URIs, cualquier https: y upload.wikimedia.org
 */
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
        "https:",                     // opcional: habilita imágenes seguras en general
        "https://upload.wikimedia.org",
        "https://img.icons8.com"
      ],
      frameAncestors: ["'self'"]
    }
  }
});

/**
 * CSP para vistas embebidas en Shopify (iframe)
 * - Igual añadimos upload.wikimedia.org a imgSrc
 */
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
        "https:",                     // opcional: habilita imágenes seguras en general
        "https://upload.wikimedia.org",
        "https://img.icons8.com"
      ]
    }
  }
});

module.exports = { publicCSP, shopifyCSP };
