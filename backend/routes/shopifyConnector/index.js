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

const REDIRECT_URI = SHOPIFY_REDIRECT_URI || 'https://ai.adnova.digital/connector/auth/callback';


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

  
  return SHOPIFY_SCOPES
    ? `${base}&scope=${encodeURIComponent(SHOPIFY_SCOPES)}`
    : base;
}


function isValidHmac(query) {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'utf-8'), Buffer.from(hmac, 'utf-8'));
  } catch {
    return false;
  }
}


router.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();

  const url = req.originalUrl || '';
  const allow =
    url.startsWith('/connector/auth/callback') ||
    url.startsWith('/connector/webhooks') ||
    url.startsWith('/connector/interface') ||
    url.startsWith('/connector/healthz');

  if (allow) return next();

  const shop = extractShop(req);
  if (!shop) {
    
    return res
      .status(400)
      .type('text/plain')
      .send('Missing "shop" parameter. Install this app from your Shopify admin or append ?shop=your-store.myshopify.com');
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl(shop, state);

  console.log('[OAUTH_REDIRECT]', { shop, path: req.originalUrl });
  return res.redirect(302, authorizeUrl);
});


router.use('/webhooks', require('./webhooks'));


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
      { client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code },
      { headers: { 'Content-Type': 'application/json' } }
    );

    await ShopConnections.findOneAndUpdate(
      { shop },
      { shop, accessToken: data.access_token, installedAt: Date.now() },
      { upsert: true }
    );

    const host = req.query.host || '';
    const uiUrl = `/apps/${SHOPIFY_API_KEY}/connector/interface?shop=${encodeURIComponent(shop)}${host ? `&host=${encodeURIComponent(host)}` : ''}`;
    return res.redirect(302, uiUrl);
  } catch (err) {
    console.error('❌ Error exchanging token:', err.response?.data || err);
    return res.status(502).type('text/plain').send('Token exchange failed.');
  }
});


router.get('/interface', async (req, res) => {
  const shop = extractShop(req);
  if (!shop) {
    return res.status(400).type('text/plain').send('Missing "shop". Open from Shopify Admin.');
  }

  const conn = await ShopConnections.findOne({ shop });
  if (!conn?.accessToken) {
   
    const state = crypto.randomBytes(16).toString('hex');
    return res.redirect(302, buildAuthorizeUrl(shop, state));
  }

  res.sendFile(path.join(__dirname, '../../../public/connector/interface.html'));
});

router.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'connector', ts: Date.now() });
});

module.exports = router;
