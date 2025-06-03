const express = require('express');
const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');
const User = require('../models/User');

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

module.exports = router;
