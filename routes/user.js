const express = require('express');
const router = express.Router();
const User = require('../backend/models/User');   // ✅ ruta correcta


// Ruta para obtener estado de conexión del usuario
router.get('/user', async (req, res) => {
  try {
    const user = await User.findById(req.session.userId); // Ajusta según tu auth
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({
      _id: user._id,
      googleConnected: user.googleConnected || false,
      metaConnected: user.metaConnected || false,
      shopifyConnected: user.shopifyConnected || false
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el usuario' });
  }
});

module.exports = router;
