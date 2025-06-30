// backend/routes/shopConnection.js
const express = require('express');
const ShopConnections = require('../models/ShopConnections');
const router = express.Router();

router.get('/me', async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: 'Falta parámetro shop' });

  try {
    const conn = await ShopConnections.findOne({ shop });
    if (!conn) return res.status(404).json({ error: 'Shop no encontrada' });

    res.json({ shop: conn.shop, accessToken: conn.accessToken });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar la tienda' });
  }
});

module.exports = router;
