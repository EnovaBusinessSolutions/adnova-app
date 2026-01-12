// middlewares/csp.js
'use strict';

const helmet = require('helmet');

const isProd = process.env.NODE_ENV === 'production';

// Helpers para DEV (no afecta prod)
const devConnect = isProd
  ? []
  : [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'ws://localhost:5173',
      'ws://127.0.0.1:5173',
    ];

/**
 * =========================
 * ✅ INTERCOM allowlists
 * =========================
 * Intercom carga un script desde widget.intercom.io
 * y assets desde js.intercomcdn.com / static.intercomassets.com.
 * También abre websockets nexus-websocket-*.intercom.io.
 */
const intercomScript = [
  'https://widget.intercom.io',
  'https://js.intercomcdn.com',
];

const intercomConnect = [
  'https://widget.intercom.io',
  'https://api-iam.intercom.io',
  'https://api.intercom.io',

  // websockets (realtime messenger)
  'wss://nexus-websocket-a.intercom.io',
  'wss://nexus-websocket-b.intercom.io',
  'wss://nexus-websocket-c.intercom.io',
];

const intercomImg = [
  'https://static.intercomassets.com',
  'https://downloads.intercomcdn.com',
];

const intercomFrame = [
  'https://widget.intercom.io',
];

/**
 * CSP pública (landing, bookcall, dashboard público, etc.)
 * ✅ Permite Calendly + GA4/GTM + Meta Pixel + Microsoft Clarity + Intercom
 * ⚠️ Nota: como estás insertando scripts inline (gtag/fbq/clarity),
 *          aquí usamos 'unsafe-inline' SOLO en páginas públicas.
 */
const publicCSPHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      /**
       * SCRIPTS
       * - GA4/GTM: googletagmanager.com
       * - Meta: connect.facebook.net
       * - Clarity: scripts.clarity.ms
       * - Calendly: assets.calendly.com
       * - Intercom: widget.intercom.io + js.intercomcdn.com
       * ⚠️ 'unsafe-inline' por scripts inline (gtag/fbq/clarity)
       */
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://assets.calendly.com",
        "https://www.googletagmanager.com",
        "https://connect.facebook.net",
        "https://www.clarity.ms",
        "https://scripts.clarity.ms",
        ...intercomScript,
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://assets.calendly.com",
        "https://www.googletagmanager.com",
        "https://connect.facebook.net",
        "https://www.clarity.ms",
        "https://scripts.clarity.ms",
        ...intercomScript,
      ],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://assets.calendly.com",
      ],

      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],

      /**
       * CONNECT
       * - GA4/Measurement: google-analytics.com
       * - Meta: facebook.com
       * - Clarity: c.clarity.ms
       * - Calendly: calendly.com / api.calendly.com
       * - Intercom: widget/api + websockets
       */
      connectSrc: [
        "'self'",
        ...devConnect,

        "https://assets.calendly.com",
        "https://calendly.com",
        "https://api.calendly.com",

        // GA4
        "https://www.google-analytics.com",
        "https://analytics.google.com",
        "https://*.google-analytics.com",
        "https://stats.g.doubleclick.net",

        // Meta
        "https://www.facebook.com",
        "https://connect.facebook.net",

        // Clarity
        "https://www.clarity.ms",
        "https://c.clarity.ms",

        // Intercom
        ...intercomConnect,
      ],

      /**
       * IMAGES (beacons / assets)
       * - Meta Pixel usa www.facebook.com/tr
       * - GA4 usa collect/pixels
       * - Intercom usa static.intercomassets.com
       */
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com",

        "https://www.facebook.com",
        "https://www.google-analytics.com",
        "https://*.google-analytics.com",
        "https://stats.g.doubleclick.net",

        // Intercom assets
        ...intercomImg,
      ],

      // Calendly + Intercom (por si abre algo embebido)
      frameSrc: [
        "'self'",
        "https://calendly.com",
        "https://assets.calendly.com",
        ...intercomFrame,
      ],

      // ⚠️ SOLO para páginas públicas, NO para Shopify
      frameAncestors: ["'self'"],
    },
  },
});

/**
 * IMPORTANTE:
 * - NO aplicar publicCSP en rutas embebidas (/connector y /apps/*)
 */
function publicCSP(req, res, next) {
  const p = req.path || '';
  if (p.startsWith('/connector') || p.startsWith('/apps/')) return next();
  return publicCSPHelmet(req, res, next);
}

/**
 * CSP para la app embebida de Shopify (/connector y /apps/*)
 * - Debe permitir iframe en Shopify Admin
 * - Debe permitir cargar App Bridge desde cdn.shopify.com
 */
const shopifyCSPHelmet = helmet({
  frameguard: false, // ✅ NO X-Frame-Options aquí
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],

      // ✅ Shopify Admin puede embeber tu app
      frameAncestors: ["https://admin.shopify.com", "https://*.myshopify.com"],

      // ✅ App Bridge
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
      ],

      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],

      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com",
      ],

      // ✅ Requests dentro del Admin / telemetría Shopify
      connectSrc: [
        "'self'",
        "https://*.myshopify.com",
        "https://admin.shopify.com",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
        "https://monorail-edge.shopifysvc.com",
      ],

      frameSrc: ["'self'", "https://admin.shopify.com", "https://*.myshopify.com"],
      formAction: ["'self'"],
    },
  },
});

function shopifyCSP(req, res, next) {
  const p = req.path || '';
  if (p.startsWith('/connector') || p.startsWith('/apps/')) {
    return shopifyCSPHelmet(req, res, next);
  }
  return next();
}

module.exports = { publicCSP, shopifyCSP };
