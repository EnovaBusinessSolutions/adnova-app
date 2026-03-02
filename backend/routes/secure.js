// backend/routes/secure.js
const express = require('express');
const router = express.Router();
const Audit = require('../models/Audit');

router.get('/ping', (req, res) => {
  return res.json({
    ok: true,
    shop: req.shopFromToken,  
    user: req.userId        
  });
});

router.get('/audits/latest', async (req, res) => {
  try {
    const latest = await Audit.findOne({ userId: req.userId })
                              .sort({ generatedAt: -1 })
                              .lean();
    res.json(latest || {});   
  } catch (err) {
    console.error('Error fetching latest audit:', err);
    res.status(500).json({ error: 'Error interno al obtener auditoría' });
  }
});

module.exports = router;
