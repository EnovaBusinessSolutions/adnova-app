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
const BASE_URL = String(APP_URL || 'https://adray.ai').replace(/\/$/, '');

// Redirect URI (DEBE coincidir 100% con Shopify Partners)
const REDIRECT_URI = SHOPIFY_REDIRECT_URI || `${BASE_URL}/connector/auth/callback`;

// --- Verificación de entorno ---
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
  console.warn('[SHOPIFY_CONNECTOR] ⚠️ Falta SHOPIFY_API_KEY o SHOPIFY_API_SECRET en env. El flujo OAuth fallará.');
}

/* ---------------- helpers ---------------- */

function isValidShopDomain(shop) {
  return /^[a-z0-9][a-z0-9\-]*\.myshopify\.com$/i.test(String(shop || ''));
}

function extractShop(req) {
  let { shop } = req.query || {};

  if (!shop && req.headers['x-shopify-shop-domain']) {
    shop = req.headers['x-shopify-shop-domain'];
  }
  if (!shop && req.headers.referer) {
    const m = req.headers.referer.match(/shop=([a-z0-9\-\.]+\.myshopify\.com)/i);
    if (m) shop = m[1];
  }

  if (!shop) return null;

  shop = String(shop).trim().toLowerCase();
  if (!isValidShopDomain(shop)) return null;

  return shop;
}

function getHostParam(req) {
  return req.query.host ? String(req.query.host) : '';
}

function isIframeRequest(req) {
  const dest = (req.get('sec-fetch-dest') || '').toLowerCase();
  return dest === 'iframe' || req.query.embedded === '1';
}

/**
 * ✅ STATE robusto sin depender de cookies:
 * - Empaquetamos {shop,host,ts,nonce} en payload
 * - Firmamos con HMAC
 * - Validamos en callback (TTL 10 min)
 */
function b64urlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
function b64urlDecode(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64').toString('utf8');
}

function makeStateToken({ shop, host }) {
  const ts = Math.floor(Date.now() / 1000).toString(36);
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${shop}|${host || ''}|${ts}|${nonce}`;
  const sig = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET || '')
    .update(payload)
    .digest('hex')
    .slice(0, 32);

  return `${b64urlEncode(payload)}.${sig}`;
}

function readStateToken(token) {
  const t = String(token || '');
  const [p64, sig] = t.split('.');
  if (!p64 || !sig) return null;

  let payload = '';
  try {
    payload = b64urlDecode(p64);
  } catch {
    return null;
  }

  const expected = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET || '')
    .update(payload)
    .digest('hex')
    .slice(0, 32);

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const [shop, host, ts36] = payload.split('|');
  if (!shop || !ts36) return null;

  const ts = parseInt(ts36, 36);
  if (!Number.isFinite(ts)) return null;

  // TTL 10 min
  const now = Math.floor(Date.now() / 1000);
  if ((now - ts) > 10 * 60) return null;

  if (!isValidShopDomain(shop)) return null;

  return { shop, host: host || '' };
}

// (Opcional) guardamos también en session “best effort”, pero NO dependemos de esto
function pushState(req, { shop, host }) {
  const state = makeStateToken({ shop, host });

  if (req.session) {
    req.session.shopifyOAuth = req.session.shopifyOAuth || {};
    req.session.shopifyOAuth[state] = { shop, host: host || '', ts: Date.now() };

    // limpieza
    const TTL = 10 * 60 * 1000;
    for (const [k, v] of Object.entries(req.session.shopifyOAuth)) {
      if (!v?.ts || (Date.now() - v.ts) > TTL) delete req.session.shopifyOAuth[k];
    }
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
    `?client_id=${encodeURIComponent(SHOPIFY_API_KEY || '')}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  const scope = SHOPIFY_SCOPES ? `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` : '';

  // ONLINE (per-user) expira; OFFLINE no expira.
  const grant = (String(SHOPIFY_GRANT_PER_USER || '').toLowerCase() === 'true')
    ? `&grant_options[]=per-user`
    : '';

  return `${base}${scope}${grant}`;
}

/**
 * Validación HMAC robusta desde querystring crudo:
 * - Remueve hmac y signature
 * - Ordena por key
 * - Usa pares "k=v" encoded tal cual
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

    if (k === 'hmac') {
      hmac = idx >= 0 ? p.slice(idx + 1) : '';
      continue;
    }
    if (k === 'signature') continue;
    filtered.push({ k, p });
  }

  if (!hmac) return false;

  filtered.sort((a, b) => a.k.localeCompare(b.k));
  const message = filtered.map((x) => x.p).join('&');

  const digest = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET || '')
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

/**
 * ✅ SALIDA TOP-LEVEL (CLICK ONLY)
 * - NO auto-redirect (evita “pantalla gris”/bloqueos)
 */
function topLevelRedirect(res, url, label = 'Continuar con Shopify') {
  return res
    .status(200)
    .type('html')
    .send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Continuar</title>
  <style>
    :root{color-scheme:dark}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f19;color:#fff;
      font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial}
    .card{width:min(560px,92vw);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
      border-radius:16px;padding:22px;box-shadow:0 18px 45px rgba(0,0,0,.55)}
    .btn{width:100%;border:0;border-radius:14px;padding:14px 16px;font-weight:800;cursor:pointer;
      background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;font-size:15px}
    .muted{opacity:.78;font-size:12.5px;line-height:1.5;margin-top:10px}
    a{color:#9ecbff}
    code{font-size:12px;opacity:.9}
  </style>
</head>
<body>
  <div class="card">
    <h2 style="margin:0 0 8px 0;">${label}</h2>
    <div class="muted" style="margin:0 0 14px 0;">
      Shopify requiere abrir esta página <b>fuera del iframe</b>. Da clic para continuar.
      <br/>Si no avanza, desactiva Brave Shields / AdBlock para <code>admin.shopify.com</code> y <code>${BASE_URL.replace(/^https?:\/\//,'')}</code> en esta prueba.
    </div>
    <button class="btn" id="go">Continuar</button>
    <div class="muted" style="margin-top:10px;">
      <a href="${url}" target="_top" rel="noopener noreferrer">Abrir manualmente</a>
    </div>
  </div>

  <script>
    (function(){
      var url = ${JSON.stringify(url)};
      document.getElementById('go').addEventListener('click', function(){
        try { window.top.location.href = url; }
        catch(e){ window.location.href = url; }
      });
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
    url.startsWith('/connector/auth') ||
    url.startsWith('/connector/webhooks') ||
    url.startsWith('/connector/interface') ||
    url.startsWith('/connector/healthz');

  if (allow) return next();

  const shop = extractShop(req);
  if (!shop) {
    console.warn('[SHOPIFY_CONNECTOR] Falta "shop" en request a', url);
    return res.status(400).type('text/plain').send(
      'Missing "shop" parameter. Install this app from your Shopify admin or append ?shop=your-store.myshopify.com'
    );
  }

  const host = getHostParam(req);
  const state = pushState(req, { shop, host });
  const authorizeUrl = buildAuthorizeUrl(shop, state);

  console.log('[SHOPIFY_CONNECTOR][OAUTH_REDIRECT][GUARD]', { shop, path: req.originalUrl });

  if (isIframeRequest(req)) return topLevelRedirect(res, authorizeUrl, 'Continuar con Shopify');
  return res.redirect(302, authorizeUrl);
});

/* =============================
 * Root -> manda a interface
 * ============================= */
router.get('/', (req, res) => {
  const shop = extractShop(req);
  const host = getHostParam(req);

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
  if (!shop) return res.status(400).type('text/plain').send('Missing "shop".');

  const host = getHostParam(req);
  const state = pushState(req, { shop, host });
  const authorizeUrl = buildAuthorizeUrl(shop, state);

  console.log('[SHOPIFY_CONNECTOR][AUTH_START]', { shop });

  if (isIframeRequest(req)) return topLevelRedirect(res, authorizeUrl, 'Continuar con Shopify');
  return res.redirect(302, authorizeUrl);
});

/* =============================
 * Callback OAuth
 * ============================= */
router.get('/auth/callback', async (req, res) => {
  const { shop, code, state } = req.query;

  const normalizedShop = String(shop || '').trim().toLowerCase();
  if (!normalizedShop || !code) {
    return res.status(400).type('text/plain').send('Missing "shop" or "code".');
  }
  if (!isValidShopDomain(normalizedShop)) {
    return res.status(400).type('text/plain').send('Invalid "shop".');
  }

  if (!isValidHmacFromRaw(req)) {
    console.warn('[SHOPIFY_CONNECTOR] ⚠️ Invalid HMAC on /auth/callback', { shop: normalizedShop });
    return res.status(400).type('text/plain').send('Invalid HMAC.');
  }

  // ✅ state: session best-effort + fallback stateless (para Brave)
  let saved = null;
  if (state) {
    saved = popState(req, String(state));
    if (!saved) saved = readStateToken(String(state));
  }

  if (state && !saved) {
    console.warn('[SHOPIFY_CONNECTOR] ⚠️ state inválido/expirado', { shop: normalizedShop });
    return res.status(400).type('text/plain').send('Invalid state.');
  }

  if (saved?.shop && saved.shop !== normalizedShop) {
    console.warn('[SHOPIFY_CONNECTOR] ⚠️ state/shop mismatch', { shop: normalizedShop, savedShop: saved.shop });
    return res.status(400).type('text/plain').send('Invalid state/shop.');
  }

  const host = (req.query.host ? String(req.query.host) : (saved?.host || ''));

  try {
    const { data } = await axios.post(
      `https://${normalizedShop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    await ShopConnections.findOneAndUpdate(
      { shop: normalizedShop },
      {
        shop: normalizedShop,
        accessToken: data.access_token,
        scope: data.scope || null,
        installedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // ✅ volvemos a tu UI
    const uiPath =
      `/connector/interface?shop=${encodeURIComponent(normalizedShop)}` +
      (host ? `&host=${encodeURIComponent(host)}` : '');

    const uiAbs = `${BASE_URL}${uiPath}`;

    console.log('[SHOPIFY_CONNECTOR][AUTH_OK]', { shop: normalizedShop });

    // Si el callback cae embebido, escapamos con click
    if (isIframeRequest(req)) return topLevelRedirect(res, uiAbs, 'Abrir Adray en Shopify');

    return res.redirect(302, uiPath);
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

  const host = getHostParam(req);

  try {
    const conn = await ShopConnections.findOne({ shop }).lean();

    if (!conn?.accessToken) {
      console.log('[SHOPIFY_CONNECTOR][NO_TOKEN] Reforzando OAuth para', shop);
      const state = pushState(req, { shop, host });
      const authorizeUrl = buildAuthorizeUrl(shop, state);

      if (isIframeRequest(req)) return topLevelRedirect(res, authorizeUrl, 'Conectar Shopify');
      return res.redirect(302, authorizeUrl);
    }

    return res.sendFile(path.join(__dirname, '../../../public/connector/interface.html'));
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
