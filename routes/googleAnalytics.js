const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../backend/models/User');

// POST /api/google/analytics
router.post('/api/google/analytics', async (req, res) => {
  const { propertyId } = req.body;

  try {
    // Validar sesión activa
    const userId = req.session.userId || req.user?._id;
    if (!userId) return res.status(401).json({ error: 'No autenticado' });

    // Obtener tokens del usuario desde Mongo
    const user = await User.findById(userId);
    if (!user || !user.googleAccessToken) {
      return res.status(403).json({ error: 'Usuario no ha conectado Google Analytics' });
    }

    // Hacer la consulta a la API de Google Analytics
    const response = await axios.post(
      'https://analyticsdata.googleapis.com/v1beta/properties/' + propertyId + ':runReport',
      {
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'bounceRate' }
        ],
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }]
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
