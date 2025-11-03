// middlewares/csp.js
const helmet = require('helmet');

/** CSP pública (landing, bookcall, agendar, dashboard, etc.) */
const publicCSP = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      // JS
      scriptSrc: [
        "'self'",
        "https://assets.calendly.com",   // para el widget en /agendar
      ],

      // CSS (habilita Google Fonts y, si quieres, CSS del widget)
      styleSrc: [
        "'self'",
        "'unsafe-inline'",               // necesario si usas estilos inline o Tailwind preflight
        "https://fonts.googleapis.com",
        "https://assets.calendly.com"
      ],

      // Fuentes (woff2 de Google Fonts)
      fontSrc: [
        "'self'",
        "data:",
        "https://fonts.gstatic.com"
      ],

      // AJAX/fetch
      connectSrc: ["'self'"],

      // Imágenes
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com"
      ],

      // iframes (para Calendly embebido)
      frameSrc: [
        "'self'",
        "https://calendly.com",
        "https://assets.calendly.com"
      ],

      frameAncestors: ["'self'"],
    }
  }
});

/** CSP Shopify embebida (déjala como la tenías si ya funciona) */
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
      ],
      // (opcional) si usas fuentes en la interfaz embebida:
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    }
  }
});

module.exports = { publicCSP, shopifyCSP };
