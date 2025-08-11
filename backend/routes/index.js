// backend/routes/index.js
const express = require('express');
const router = express.Router();

const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');
const User = require('../models/User');
const crypto = require('crypto');

// GET /api/user  -> crea/backfillea usuario con plan 'gratis'
router.get('/user', verifyShopifyToken, async (req, res) => {
  const shop = req.shop;

  try {
    let user = await User.findOne({ shop });

    if (!user) {
      user = await User.create({
        email: `shopify_${shop}@no-reply.adnova`,
        password: crypto.randomBytes(16).toString('hex'),
        onboardingComplete: false,
        shop,
        shopifyConnected: true,
        plan: 'gratis',
        planStartedAt: new Date()
      });
    } else if (!user.plan) {
      // backfill para usuarios viejos sin plan
      user.plan = 'gratis';
      user.planStartedAt = user.planStartedAt || new Date();
      await user.save();
    }

    return res.json({
      userId: user._id,
      shop,
      onboardingComplete: user.onboardingComplete,
      googleConnected: user.googleConnected,
      metaConnected: user.metaConnected,
      shopifyConnected: user.shopifyConnected,
      plan: user.plan
    });
  } catch (err) {
    console.error('Error al consultar usuario:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/onboarding-complete
router.post('/onboarding-complete', async (req, res) => {
  const { shop } = req.body;
  if (!shop) return res.status(400).json({ error: 'Shop is required' });

  try {
    const user = await User.findOneAndUpdate(
      { shop },
      { $set: { onboardingComplete: true } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
