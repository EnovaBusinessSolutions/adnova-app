// routes/mockShopify.js
const express = require('express');
const router  = express.Router();
const User    = require('../models/User');

router.post('/mock-shopify-connected', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);

  try {
    await User.findByIdAndUpdate(req.user._id, { shopifyConnected: true });
    return res.sendStatus(200);
  } catch (err) {
    console.error('❌ Mock Shopify:', err);
    return res.sendStatus(500);
  }
});

module.exports = router;
