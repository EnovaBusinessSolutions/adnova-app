// middlewares/csp.js
const helmet = require('helmet');

/**
 * CSP pública (landing, bookcall, agendar, dashboard, etc.)
 */
const publicCSPHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      scriptSrc: ["'self'", "https://assets.calendly.com"],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://assets.calendly.com",
      ],

      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],

      connectSrc: ["'self'"],

      imgSrc: ["'self'", "data:", "https:", "https://upload.wikimedia.org", "https://img.icons8.com"],

      frameSrc: ["'self'", "https://calendly.com", "https://assets.calendly.com"],

      // ⚠️ OJO: esto rompe Shopify si se aplica en /connector
      frameAncestors: ["'self'"],
    },
  },
});

/**
 * IMPORTANTE:
 * - NO aplicar publicCSP en rutas embebidas (/connector y /apps/*)
 * - Porque publicCSP mete X-Frame-Options SAMEORIGIN y frame-ancestors 'self'
 */
function publicCSP(req, res, next) {
  const p = req.path || '';
  if (p.startsWith('/connector') || p.startsWith('/apps/')) return next();
  return publicCSPHelmet(req, res, next);
}

/**
 * CSP para la app embebida de Shopify
 */
const shopifyCSP = helmet({
  frameguard: false, // no X-Frame-Options aquí
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      frameAncestors: ["https://admin.shopify.com", "https://*.myshopify.com"],

      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
      ],

      connectSrc: [
        "'self'",
        "https://*.myshopify.com",
        "https://admin.shopify.com",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
      ],

      imgSrc: ["'self'", "data:", "https:", "https://upload.wikimedia.org", "https://img.icons8.com"],

      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    },
  },
});

module.exports = { publicCSP, shopifyCSP };
