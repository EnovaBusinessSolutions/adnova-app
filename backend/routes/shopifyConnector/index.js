const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');
const jwt     = require('jsonwebtoken');
const User    = require('../../models/User');

const router  = express.Router();
const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;
const SCOPES  = 'read_products,read_customers,read_orders';
const REDIRECT = 'https://adnova-app.onrender.com/connector/auth/callback';

// GET /connector        (Shopify App URL)
router.get('/', (req, res) => {
  const { shop, host } = req.query;
  if (!shop) return res.send('👍 Adnova Connector online');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.shopifyState = state;
  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
    `&state=${state}`;
  return res.redirect(url);
});

// GET /connector/auth/callback
router.get('/auth/callback', async (req, res) => {
  const { shop, code, hmac, state } = req.query;
  if (state !== req.session.shopifyState) return res.status(400).send('Bad state');

  /* — Verificación HMAC idéntica a la que ya usabas — */

  const { data } = await axios.post(
    `https://${shop}/admin/oauth/access_token`,
    { client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code },
    { headers: { 'Content-Type': 'application/json' } }
  );

  await User.findByIdAndUpdate(req.session.userId, {
    shop, shopifyAccessToken: data.access_token, shopifyConnected: true
  });

  const token = jwt.sign({ shop }, SHOPIFY_API_SECRET, { expiresIn: '10m' });
  return res.redirect(`/onboarding?shopifyToken=${token}`);
});

// Webhooks de cumplimiento
router.use('/webhooks', require('./webhooks'));

module.exports = router;
