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

const intercomFrame = ['https://widget.intercom.io'];

/**
 * CSP pública (landing, login, register, onboarding, dashboard, etc.)
 * ✅ Permite Calendly + GA4/GTM + Google Ads + Meta Pixel + Clarity + Intercom + Tag Assistant Preview
 * ⚠️ Nota: como insertas scripts inline (gtag/fbq/clarity),
 *          aquí usamos 'unsafe-inline' SOLO en páginas públicas.
 */
const publicCSPHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      /**
       * SCRIPTS
       * - GTM/GA: googletagmanager.com + google.com (tag assistant)
       * - Ads: googleadservices / doubleclick / googlesyndication
       * - Meta: connect.facebook.net
       * - Clarity: clarity.ms
       * - Calendly: assets.calendly.com
       * - Intercom: widget.intercom.io + js.intercomcdn.com
       */
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",

        // Calendly
        'https://assets.calendly.com',

        // GTM / GA
        'https://www.googletagmanager.com',
        'https://tagassistant.google.com',
        'https://www.google.com',

        // Google Ads / DoubleClick
        'https://www.googleadservices.com',
        'https://googleads.g.doubleclick.net',
        'https://pagead2.googlesyndication.com',
        'https://www.google.com/pagead',
        'https://*.doubleclick.net',

        // Meta
        'https://connect.facebook.net',

        // Clarity
        'https://www.clarity.ms',
        'https://scripts.clarity.ms',

        // Intercom
        ...intercomScript,
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",

        // Calendly
        'https://assets.calendly.com',

        // GTM / GA
        'https://www.googletagmanager.com',
        'https://tagassistant.google.com',
        'https://www.google.com',

        // Google Ads / DoubleClick
        'https://www.googleadservices.com',
        'https://googleads.g.doubleclick.net',
        'https://pagead2.googlesyndication.com',
        'https://www.google.com/pagead',
        'https://*.doubleclick.net',

        // Meta
        'https://connect.facebook.net',

        // Clarity
        'https://www.clarity.ms',
        'https://scripts.clarity.ms',

        // Intercom
        ...intercomScript,
      ],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://assets.calendly.com',
      ],

      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],

      /**
       * CONNECT (fetch/xhr/beacons)
       * ✅ FIX: Tag Assistant / GTM Preview usa https://www.google.com/ccm/collect
       * ✅ Ads/Conversiones: googleadservices / doubleclick / googlesyndication
       */
      connectSrc: [
        "'self'",
        ...devConnect,

        // Calendly
        'https://assets.calendly.com',
        'https://calendly.com',
        'https://api.calendly.com',

        // GA4 / Measurement
        'https://www.google-analytics.com',
        'https://analytics.google.com',
        'https://*.google-analytics.com',
        'https://stats.g.doubleclick.net',

        // ✅ Tag Assistant / Preview (ccm/collect vive en www.google.com)
        'https://www.google.com',
        'https://google.com',
        'https://tagassistant.google.com',

        // ✅ Google Ads / conversion endpoints
        'https://www.googleadservices.com',
        'https://googleads.g.doubleclick.net',
        'https://pagead2.googlesyndication.com',
        'https://*.doubleclick.net',

        // (Opcional pero útil si GTM dispara gateways)
        'https://*.conversionsapigateway.com',
        'https://*.a.run.app',

        // Meta
        'https://www.facebook.com',
        'https://connect.facebook.net',

        // Clarity
        'https://www.clarity.ms',
        'https://c.clarity.ms',

        // Intercom
        ...intercomConnect,
      ],

      /**
       * IMAGES (beacons / assets)
       */
      imgSrc: [
        "'self'",
        'data:',
        'https:',
        'https://upload.wikimedia.org',
        'https://img.icons8.com',

        // Meta Pixel beacons
        'https://www.facebook.com',

        // GA / Ads pixels
        'https://www.google-analytics.com',
        'https://*.google-analytics.com',
        'https://stats.g.doubleclick.net',
        'https://*.doubleclick.net',
        'https://www.googleadservices.com',
        'https://googleads.g.doubleclick.net',

        // Intercom assets
        ...intercomImg,
      ],

      /**
       * FRAMES
       * ✅ Tag Assistant / GTM Preview usa iframes
       */
      frameSrc: [
        "'self'",
        'https://calendly.com',
        'https://assets.calendly.com',

        // ✅ GTM/Tag Assistant Preview
        'https://www.googletagmanager.com',
        'https://tagassistant.google.com',
        'https://*.google.com',

        // Intercom
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
      frameAncestors: ['https://admin.shopify.com', 'https://*.myshopify.com'],

      // ✅ App Bridge
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        'https://cdn.shopify.com',
        'https://cdn.shopifycdn.net',
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        'https://cdn.shopify.com',
        'https://cdn.shopifycdn.net',
      ],

      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],

      imgSrc: [
        "'self'",
        'data:',
        'https:',
        'https://upload.wikimedia.org',
        'https://img.icons8.com',
      ],

      // ✅ Requests dentro del Admin / telemetría Shopify
      connectSrc: [
        "'self'",
        'https://*.myshopify.com',
        'https://admin.shopify.com',
        'https://cdn.shopify.com',
        'https://cdn.shopifycdn.net',
        'https://monorail-edge.shopifysvc.com',
      ],

      frameSrc: ["'self'", 'https://admin.shopify.com', 'https://*.myshopify.com'],
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
