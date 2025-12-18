// middlewares/csp.js
'use strict';

const helmet = require('helmet');

/**
 * CSP pública (landing, bookcall, dashboard público, etc.)
 * ✅ Permite Calendly + GA4/GTM + Meta Pixel + Microsoft Clarity
 * ⚠️ Nota: como estás insertando scripts inline (gtag/fbq/clarity),
 *          aquí usamos 'unsafe-inline' SOLO en páginas públicas.
 */
const publicCSPHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      // ✅ Scripts permitidos (Calendly + Google + Meta + Clarity)
      // ⚠️ 'unsafe-inline' necesario porque tienes <script> inline en tus HTML
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://assets.calendly.com",
        "https://www.googletagmanager.com",
        "https://connect.facebook.net",
        "https://www.clarity.ms",
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://assets.calendly.com",
        "https://www.googletagmanager.com",
        "https://connect.facebook.net",
        "https://www.clarity.ms",
      ],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://assets.calendly.com",
      ],

      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],

      // ✅ Aquí estaba el bloqueo: connect-src solo 'self'
      //    Agregamos endpoints necesarios para GA4/Meta/Clarity + (compat Calendly)
      connectSrc: [
        "'self'",
        "https://assets.calendly.com",
        "https://calendly.com",
        "https://api.calendly.com",

        "https://www.googletagmanager.com",
        "https://www.google-analytics.com",
        "https://region1.google-analytics.com",
        "https://stats.g.doubleclick.net",

        "https://connect.facebook.net",
        "https://www.facebook.com",

        "https://www.clarity.ms",
      ],

      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://upload.wikimedia.org",
        "https://img.icons8.com",
        // (https: ya cubre los beacons de GA/Meta, lo dejamos explícito por claridad)
        "https://www.facebook.com",
        "https://www.google-analytics.com",
        "https://region1.google-analytics.com",
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
