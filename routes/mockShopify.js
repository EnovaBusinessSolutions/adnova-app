// routes/mockShopify.js
const express = require('express');
const router  = express.Router();
const User    = require('../backend/models/User');

// Se llama justo antes de redirigir al enlace de instalación
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
