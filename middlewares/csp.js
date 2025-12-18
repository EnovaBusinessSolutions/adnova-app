// middlewares/csp.js
'use strict';

const helmet = require('helmet');

/**
 * CSP pública (landing, bookcall, agendar, dashboard, etc.)
 * Nota: esta CSP NO debe tocar /connector ni /apps/*
 */
const publicCSPHelmet = helmet({
  // En público no pasa nada si queda SAMEORIGIN, pero Shopify NO debe heredar esto.
  // Si quieres, lo puedes dejar tal cual.
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },

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

      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com",
      ],

      frameSrc: ["'self'", "https://calendly.com", "https://assets.calendly.com"],

      // Público: OK
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
 * Objetivo:
 * - Permitir que Shopify Admin iframée tu app (frame-ancestors)
 * - Permitir App Bridge (scripts/conn)
 * - Evitar headers COEP/COOP que rompen embedded
 */
const shopifyCSP = helmet({
  frameguard: false, // NO X-Frame-Options
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],

      // ✅ Shopify debe poder embeberte
      frameAncestors: ["https://admin.shopify.com", "https://*.myshopify.com"],

      // ✅ App Bridge / topLevelRedirect usan inline/eval en algunos escenarios
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
      ],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
      ],

      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],

      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com",
      ],

      // ✅ Shopify hace requests a shopifycloud/monorail
      connectSrc: [
        "'self'",
        "https://admin.shopify.com",
        "https://*.myshopify.com",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
        "https://*.shopifycloud.com",
        "https://monorail-edge.shopifycloud.com",
        "wss:",
      ],

      // (No es obligatorio, pero no estorba)
      frameSrc: ["'self'", "https://admin.shopify.com", "https://*.myshopify.com"],
    },
  },
});

module.exports = { publicCSP, shopifyCSP };
