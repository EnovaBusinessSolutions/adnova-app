// middlewares/csp.js
'use strict';

const helmet = require('helmet');

/**
 * CSP pública (landing, bookcall, dashboard público, etc.)
 */
const publicCSPHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      scriptSrc: ["'self'", "https://assets.calendly.com"],
      scriptSrcElem: ["'self'", "https://assets.calendly.com"],

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

      // ✅ Requests dentro del Admin / telemetría Shopify (a veces bloqueada por extensiones)
      connectSrc: [
        "'self'",
        "https://*.myshopify.com",
        "https://admin.shopify.com",
        "https://cdn.shopify.com",
        "https://cdn.shopifycdn.net",
        "https://monorail-edge.shopifysvc.com",
      ],

      // No intentes “embeber” accounts.shopify.com (igual te lo va a bloquear Shopify)
      frameSrc: ["'self'", "https://admin.shopify.com", "https://*.myshopify.com"],

      formAction: ["'self'"],
    },
  },
});

function shopifyCSP(req, res, next) {
  // Solo aplica donde toca (evita sorpresas)
  const p = req.path || '';
  if (p.startsWith('/connector') || p.startsWith('/apps/')) {
    return shopifyCSPHelmet(req, res, next);
  }
  return next();
}

module.exports = { publicCSP, shopifyCSP };
