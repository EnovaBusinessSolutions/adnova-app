const express = require('express');
const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');
const User = require('../models/User');
const crypto = require('crypto');

const router = express.Router();

router.get('/user', verifyShopifyToken, async (req, res) => {
  const shop = req.shop;

  try {
    let user = await User.findOne({ shop });
    if (!user) {
      user = await User.create({
        email: `shopify_${shop}@no-reply.adnova`,
        password: crypto.randomBytes(16).toString('hex'),
        onboardingComplete: false,
        shop: shop,
        shopifyConnected: true
      });
    }

    return res.json({
      userId: user._id,
      shop,
      onboardingComplete: user.onboardingComplete,
      googleConnected: user.googleConnected,
      metaConnected: user.metaConnected,
      shopifyConnected: user.shopifyConnected,
    });
  } catch (err) {
    console.error("Error al consultar usuario:", err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});


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

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
