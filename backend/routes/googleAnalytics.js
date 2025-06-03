const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');

router.post('/api/google/analytics', async (req, res) => {
  const { propertyId } = req.body;

  try {
    const userId = req.session.userId || req.user?._id;
    if (!userId) return res.status(401).json({ error: 'No autenticado' });

    const user = await User.findById(userId);
    if (!user || !user.googleAccessToken) {
      return res.status(400).json({ error: 'Google no conectado' });
    }

    const response = await axios.post(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics: [{ name: 'activeUsers' }]
      },
      {
        headers: {
          Authorization: `Bearer ${user.googleAccessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Error al consultar Analytics:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error al obtener datos de Google Analytics' });
  }
});

module.exports = router;
