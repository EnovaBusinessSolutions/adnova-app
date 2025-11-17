// middlewares/csp.js
const helmet = require('helmet');

/**
 * CSP pública (landing, bookcall, agendar, dashboard, etc.)
 */
const publicCSP = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      // JS
      scriptSrc: [
        "'self'",
        "https://assets.calendly.com",   // widget en /agendar
      ],

      // CSS
      styleSrc: [
        "'self'",
        "'unsafe-inline'",               // estilos inline / Tailwind preflight
        "https://fonts.googleapis.com",
        "https://assets.calendly.com",
      ],

      // Fuentes
      fontSrc: [
        "'self'",
        "data:",
        "https://fonts.gstatic.com",
      ],

      // AJAX/fetch
      connectSrc: ["'self'"],

      // Imágenes
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com",
      ],

      // iframes (Calendly)
      frameSrc: [
        "'self'",
        "https://calendly.com",
        "https://assets.calendly.com",
      ],

      frameAncestors: ["'self'"],
    },
  },
});

/**
 * CSP para la app embebida de Shopify
 */
const shopifyCSP = helmet({
  // Muy importante: NO poner X-Frame-Options
  frameguard: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Solo Shopify puede embeber esta app
      frameAncestors: [
        "https://admin.shopify.com",
        "https://*.myshopify.com",
      ],

      // JS: nuestra app + App Bridge
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
      ],

      // Fetch / XHR
      connectSrc: [
        "'self'",
        "https://*.myshopify.com",
        "https://admin.shopify.com",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
      ],

      // Imágenes
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com",
      ],

      // Estilos y fuentes (por si usas Google Fonts en la interfaz embebida)
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
      ],
      fontSrc: [
        "'self'",
        "data:",
        "https://fonts.gstatic.com",
      ],
    },
  },
});

module.exports = { publicCSP, shopifyCSP };
