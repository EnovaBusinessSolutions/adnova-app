'use strict';

// routes/shopifyConnector/index.js
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const crypto  = require('crypto');

const router  = express.Router();
const ShopConnections = require('../../models/ShopConnections');

const {
  APP_URL,
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_SCOPES,
  SHOPIFY_REDIRECT_URI,
  SHOPIFY_GRANT_PER_USER, // opcional: "true" para tokens por usuario (online)
} = process.env;

// Base URL pública (canónica)
const BASE_URL = (APP_URL || 'https://adray.ai').replace(/\/$/, '');

// Redirect URI (DEBE coincidir 100% con Shopify Partners)
const REDIRECT_URI = SHOPIFY_REDIRECT_URI || `${BASE_URL}/connector/auth/callback`;

// --- Pequeña verificación de entorno ---
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
  console.warn(
    '[SHOPIFY_CONNECTOR] ⚠️ Falta SHOPIFY_API_KEY o SHOPIFY_API_SECRET en env. El flujo OAuth fallará.'
  );
}

/* ---------------- helpers ---------------- */

function extractShop(req) {
  let { shop } = req.query || {};
  if (!shop && req.headers['x-shopify-shop-domain']) {
    shop = req.headers['x-shopify-shop-domain'];
  }
  if (!shop && req.headers.referer) {
    const m = req.headers.referer.match(/shop=([a-z0-9\-\.]+\.myshopify\.com)/i);
    if (m) shop = m[1];
  }
  return shop;
}

// Guarda state + host en sesión para validar callback y preservar host
function pushState(req, { shop, host }) {
  const state = crypto.randomBytes(16).toString('hex');

  if (!req.session) {
    // Sin sesión no podemos validar state -> mejor log + continuar "best effort"
    console.warn('[SHOPIFY_CONNECTOR] ⚠️ req.session no existe. Revisa express-session en backend/index.js');
    return state;
  }

  req.session.shopifyOAuth = req.session.shopifyOAuth || {};
  req.session.shopifyOAuth[state] = {
    shop,
    host: host || '',
    ts: Date.now(),
  };

  // Limpieza simple (evita crecer infinito)
  const TTL = 10 * 60 * 1000; // 10 min
  for (const [k, v] of Object.entries(req.session.shopifyOAuth)) {
    if (!v?.ts || (Date.now() - v.ts) > TTL) delete req.session.shopifyOAuth[k];
  }

  return state;
}

function popState(req, state) {
  if (!req.session?.shopifyOAuth) return null;
  const data = req.session.shopifyOAuth[state] || null;
  delete req.session.shopifyOAuth[state];
  return data;
}

function buildAuthorizeUrl(shop, state) {
  const base =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(SHOPIFY_API_KEY)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  const scope = SHOPIFY_SCOPES
    ? `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}`
    : '';

  // ✅ OJO: per-user (online token) expira; offline token NO expira (más estable para “conector”)
  const grant = (String(SHOPIFY_GRANT_PER_USER || '').toLowerCase() === 'true')
    ? `&grant_options[]=per-user`
    : '';

  return `${base}${scope}${grant}`;
}

/**
 * Validación HMAC robusta:
 * - Usa el querystring crudo (encoded) para evitar fallos con host/base64.
 * - Remueve hmac y signature.
 * - Ordena por key.
 */
function isValidHmacFromRaw(req) {
  const raw = (req.originalUrl.split('?')[1] || '').trim();
  if (!raw) return false;

  const parts = raw.split('&').filter(Boolean);

  let hmac = '';
  const filtered = [];

  for (const p of parts) {
    const idx = p.indexOf('=');
    const k = idx >= 0 ? p.slice(0, idx) : p;
    const v = idx >= 0 ? p.slice(idx + 1) : '';

    if (k === 'hmac') {
      hmac = v;
      continue;
    }
    if (k === 'signature') continue;
    filtered.push({ k, p });
  }

  if (!hmac) return false;

  filtered.sort((a, b) => a.k.localeCompare(b.k));
  const message = filtered.map((x) => x.p).join('&');

  const digest = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  try {
    const a = Buffer.from(digest, 'hex');
    const b = Buffer.from(String(hmac), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Para evitar redirecciones dentro del iframe
function topLevelRedirect(res, url) {
  return res
    .status(200)
    .type('html')
    .send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Redirecting…</title></head>
  <body>
    <script>
      (function() {
        var url = ${JSON.stringify(url)};
        try {
          if (window.top) window.top.location.href = url;
          else window.location.href = url;
        } catch (e) {
          window.location.href = url;
        }
      })();
    </script>
  </body>
</html>`);
}

/* =============================
 * Guard genérico (solo GET/HEAD)
 * ============================= */
router.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();

  const url = req.originalUrl || '';
  const allow =
    url === '/connector' ||
    url === '/connector/' ||
    url.startsWith('/connector/auth') ||          // ✅ ahora sí incluimos /auth y /auth/callback
    url.startsWith('/connector/webhooks') ||
    url.startsWith('/connector/interface') ||
    url.startsWith('/connector/healthz');

  if (allow) return next();

  const shop = extractShop(req);
  if (!shop) {
    console.warn('[SHOPIFY_CONNECTOR] Falta "shop" en request a', url);
    return res
      .status(400)
      .type('text/plain')
      .send(
        'Missing "shop" parameter. Install this app from your Shopify admin or append ?shop=your-store.myshopify.com'
      );
  }

  const host = req.query.host ? String(req.query.host) : '';
  const state = pushState(req, { shop, host });
  const authorizeUrl = buildAuthorizeUrl(shop, state);

  console.log('[SHOPIFY_CONNECTOR][OAUTH_REDIRECT][GUARD]', { shop, path: req.originalUrl });
  return topLevelRedirect(res, authorizeUrl);
});

/* =============================
 * Root -> manda a interface
 * ============================= */
router.get('/', (req, res) => {
  const shop = extractShop(req);
  const host = req.query.host ? String(req.query.host) : '';

  const url =
    '/connector/interface' +
    (shop ? `?shop=${encodeURIComponent(shop)}` : '') +
    (shop && host ? `&host=${encodeURIComponent(host)}` : (!shop && host ? `?host=${encodeURIComponent(host)}` : ''));

  return res.redirect(302, url);
});

// Webhooks
router.use('/webhooks', require('./webhooks'));

/* =============================
 * ✅ Auth explícito
 * ============================= */
router.get('/auth', (req, res) => {
  const shop = extractShop(req);
  if (!shop) {
    return res.status(400).type('text/plain').send('Missing "shop".');
  }

  const host = req.query.host ? String(req.query.host) : '';
  const state = pushState(req, { shop, host });
  const authorizeUrl = buildAuthorizeUrl(shop, state);

  console.log('[SHOPIFY_CONNECTOR][AUTH_START]', { shop });
  return topLevelRedirect(res, authorizeUrl);
});

/* =============================
 * Callback OAuth
 * ============================= */
router.get('/auth/callback', async (req, res) => {
  const { shop, code, state } = req.query;

  if (!shop || !code) {
    return res.status(400).type('text/plain').send('Missing "shop" or "code".');
  }

  // ✅ HMAC robusto (raw query)
  if (!isValidHmacFromRaw(req)) {
    console.warn('[SHOPIFY_CONNECTOR] ⚠️ Invalid HMAC on /auth/callback', { shop });
    return res.status(400).type('text/plain').send('Invalid HMAC.');
  }

  // ✅ Validar state y recuperar host original
  let saved = null;
  if (state) saved = popState(req, String(state));
  if (state && !saved) {
    console.warn('[SHOPIFY_CONNECTOR] ⚠️ state inválido/expirado', { shop });
    return res.status(400).type('text/plain').send('Invalid state.');
  }
  if (saved?.shop && saved.shop !== shop) {
    console.warn('[SHOPIFY_CONNECTOR] ⚠️ state/shop mismatch', { shop, savedShop: saved.shop });
    return res.status(400).type('text/plain').send('Invalid state/shop.');
  }

  const host = (req.query.host ? String(req.query.host) : (saved?.host || ''));

  try {
    const { data } = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    await ShopConnections.findOneAndUpdate(
      { shop },
      {
        shop,
        accessToken: data.access_token,
        scope: data.scope || null,
        installedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // ✅ Evita loops: volvemos a /connector/interface (tu UI embebida)
    const uiUrl =
      `/connector/interface?shop=${encodeURIComponent(shop)}` +
      (host ? `&host=${encodeURIComponent(host)}` : '');

    console.log('[SHOPIFY_CONNECTOR][AUTH_OK]', { shop });
    return res.redirect(302, uiUrl);
  } catch (err) {
    console.error('[SHOPIFY_CONNECTOR] ❌ Token exchange failed:', err.response?.data || err?.message || err);
    return res.status(502).type('text/plain').send('Token exchange failed.');
  }
});

/* =============================
 * Vista embebida: Interface
 * ============================= */
router.get('/interface', async (req, res) => {
  const shop = extractShop(req);
  if (!shop) {
    console.warn('[SHOPIFY_CONNECTOR] /interface sin "shop"');
    return res.status(400).type('text/plain').send('Missing "shop". Open from Shopify Admin.');
  }

  const host = req.query.host ? String(req.query.host) : '';

  try {
    const conn = await ShopConnections.findOne({ shop }).lean();

    if (!conn?.accessToken) {
      console.log('[SHOPIFY_CONNECTOR][NO_TOKEN] Reforzando OAuth para', shop);
      const state = pushState(req, { shop, host });
      const authorizeUrl = buildAuthorizeUrl(shop, state);
      return topLevelRedirect(res, authorizeUrl);
    }

    return res.sendFile(
      path.join(__dirname, '../../../public/connector/interface.html')
    );
  } catch (e) {
    console.error('[SHOPIFY_CONNECTOR][INTERFACE_ERROR]', e);
    return res.status(500).type('text/plain').send('Internal error loading interface.');
  }
});

// Healthcheck simple
router.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'connector', ts: Date.now() });
});

module.exports = router;
