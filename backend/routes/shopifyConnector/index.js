// routes/shopifyConnector/index.js
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const crypto  = require('crypto');

const router  = express.Router();
const ShopConnections = require('../../models/ShopConnections');

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_SCOPES,
  SHOPIFY_REDIRECT_URI
} = process.env;

// Fallback sensato para redirect_uri (DEBE coincidir 100% con el Partners Dashboard)
const REDIRECT_URI =
  SHOPIFY_REDIRECT_URI || 'https://adray.ai/connector/auth/callback';

// --- Pequeña verificación de entorno (evitamos crashes raros) ---
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
  console.warn(
    '[SHOPIFY_CONNECTOR] ⚠️ Falta SHOPIFY_API_KEY o SHOPIFY_API_SECRET en env. ' +
    'El flujo OAuth fallará hasta que se configure correctamente.'
  );
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
  return shop;
}

function buildAuthorizeUrl(shop, state) {
  const base =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(SHOPIFY_API_KEY)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  // Recomendado: grant_options[]=per-user (no rompe nada; solo mejora el flujo)
  const grant = `&grant_options[]=per-user`;

  return SHOPIFY_SCOPES
    ? `${base}&scope=${encodeURIComponent(SHOPIFY_SCOPES)}${grant}`
    : `${base}${grant}`;
}

function isValidHmac(query) {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  try {
    // Shopify manda hmac en hex. Comparamos en hex (más correcto que utf-8).
    const a = Buffer.from(digest, 'hex');
    const b = Buffer.from(String(hmac), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Para evitar redirecciones dentro del iframe (mejor para revisión)
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

// =============================
// Guard genérico: fuerza OAuth
// =============================
router.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();

  const url = req.originalUrl || '';
  const allow =
    url === '/connector' ||
    url === '/connector/' ||
    url.startsWith('/connector/auth/callback') ||
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

  const state = crypto.randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl(shop, state);

  console.log('[SHOPIFY_CONNECTOR][OAUTH_REDIRECT]', {
    shop,
    path: req.originalUrl
  });

  // Mejor que 302 dentro del iframe
  return topLevelRedirect(res, authorizeUrl);
});

// Root -> manda a interface (por si Shopify abre /connector)
router.get('/', (req, res) => {
  const shop = extractShop(req);
  const host = req.query.host ? String(req.query.host) : '';
  const url =
    '/connector/interface' +
    (shop ? `?shop=${encodeURIComponent(shop)}` : '') +
    (shop && host ? `&host=${encodeURIComponent(host)}` : (!shop && host ? `?host=${encodeURIComponent(host)}` : ''));
  return res.redirect(302, url);
});

// Webhooks (ya estaba)
router.use('/webhooks', require('./webhooks'));

// =============================
// Callback OAuth
// =============================
router.get('/auth/callback', async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) {
    return res.status(400).type('text/plain').send('Missing "shop" or "code".');
  }

  if (!isValidHmac(req.query)) {
    console.warn('⚠️  Invalid HMAC on /auth/callback', { shop });
    return res.status(400).type('text/plain').send('Invalid HMAC.');
  }

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
        installedAt: Date.now(),
      },
      { upsert: true }
    );

    const host = req.query.host ? String(req.query.host) : '';

    // ✅ IMPORTANTE: NO redirigir a /apps/... (eso te genera el loop)
    const uiUrl =
      `/connector/interface?shop=${encodeURIComponent(shop)}` +
      (host ? `&host=${encodeURIComponent(host)}` : '');

    console.log('[SHOPIFY_CONNECTOR][AUTH_OK]', { shop });
    return res.redirect(302, uiUrl);
  } catch (err) {
    console.error('❌ Error exchanging token:', err.response?.data || err);
    return res
      .status(502)
      .type('text/plain')
      .send('Token exchange failed.');
  }
});

// =============================
// Vista embebida: Interface
// =============================
router.get('/interface', async (req, res) => {
  const shop = extractShop(req);
  if (!shop) {
    console.warn('[SHOPIFY_CONNECTOR] /interface sin "shop"');
    return res
      .status(400)
      .type('text/plain')
      .send('Missing "shop". Open from Shopify Admin.');
  }

  try {
    const conn = await ShopConnections.findOne({ shop });

    if (!conn?.accessToken) {
      console.log('[SHOPIFY_CONNECTOR][NO_TOKEN] Reforzando OAuth para', shop);
      const state = crypto.randomBytes(16).toString('hex');
      const authorizeUrl = buildAuthorizeUrl(shop, state);

      // Mejor para embedded apps
      return topLevelRedirect(res, authorizeUrl);
    }

    return res.sendFile(
      path.join(__dirname, '../../../public/connector/interface.html')
    );
  } catch (e) {
    console.error('[SHOPIFY_CONNECTOR][INTERFACE_ERROR]', e);
    return res
      .status(500)
      .type('text/plain')
      .send('Internal error loading interface.');
  }
});

// Healthcheck simple
router.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'connector', ts: Date.now() });
});

module.exports = router;
