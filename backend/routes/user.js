// backend/routes/index.js
const express = require('express');
const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');
const User = require('../models/User');
const crypto = require('crypto');

const router = express.Router();

/**
 * GET /user
 * Crea (upsert) si no existe. Plan 'gratis' por defecto.
 */
router.get('/user', verifyShopifyToken, async (req, res) => {
  const shop = req.shop;

  try {
    const now = new Date();

    let user = await User.findOneAndUpdate(
      { shop },
      {
        $setOnInsert: {
          email: `shopify_${shop}@no-reply.adnova`,
          password: crypto.randomBytes(16).toString('hex'),
          onboardingComplete: false,
          shop: shop,
          shopifyConnected: true,
          plan: 'gratis',
          planStartedAt: now
        }
      },
      { new: true, upsert: true }
    );

    if (!user.plan) {
      user.plan = 'gratis';
      user.planStartedAt = now;
      await user.save();
    }

    return res.json({
      userId: user._id,
      shop: user.shop,
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

/**
 * POST /onboarding-complete
 * Marca onboarding como completo (no toca plan si ya existe).
 */
router.post('/onboarding-complete', verifyShopifyToken, async (req, res) => {
  const shop = req.shop || req.body.shop;
  if (!shop) return res.status(400).json({ error: 'Shop is required' });

  try {
    const user = await User.findOneAndUpdate(
      { shop },
      { $set: { onboardingComplete: true } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.plan) {
      user.plan = 'gratis';
      user.planStartedAt = new Date();
      await user.save();
    }

    return res.json({ success: true, onboardingComplete: user.onboardingComplete, plan: user.plan });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
