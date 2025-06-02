// routes/user.js
const express = require('express');
const crypto = require('crypto');
const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');
const User = require('../models/User');

const router = express.Router();

router.get('/user', verifyShopifyToken, async (req, res) => {
  const payload = req.shopifyTokenPayload;
  const shop = req.shop;

  try {
    let user = await User.findOne({ shop });

    if (!user) {
      user = await User.create({
        shop,
        shopifyConnected: true,
        onboardingComplete: false
      });
      console.log("🆕 Usuario Shopify creado automáticamente:", shop);
    }

    // 🔐 Verificar que los permisos (scopes) sean correctos
    const requiredScopeHash = crypto.createHash('sha256').update([
      'read_products',
      'read_orders',
      'read_customers',
      'read_analytics',
    ].join(',')).digest('hex');

    if (user.shopifyScopeHash !== requiredScopeHash) {
      return res.status(403).json({
        error: 'Permisos insuficientes. Reinstala la app con los permisos requeridos.',
        fix: 'reinstall',
      });
    }

    return res.status(200).json({
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
