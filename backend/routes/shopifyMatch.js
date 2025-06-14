const express        = require('express');
const User           = require('../models/User');
const ShopConnections = require('../models/ShopConnections');
const router         = express.Router();

// el usuario DEBE estar autenticado en Adnova AI
router.post('/shopify/match', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  const { shop } = req.body;
  if (!shop) return res.status(400).json({ error: 'Shop is required' });

  const conn = await ShopConnections.findOne({ shop });
  if (!conn)             return res.status(404).json({ error: 'Shop not found' });
  if (conn.matchedToUserId) return res.status(400).json({ error: 'Shop already linked' });

  conn.matchedToUserId = req.user._id;
  await conn.save();

  await User.findByIdAndUpdate(req.user._id, {
    shop,
    shopifyConnected: true
  });

  return res.json({ ok: true });
});

module.exports = router;
