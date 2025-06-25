// backend/routes/secure.js
const express = require('express');
const router = express.Router();
const verifySessionToken = require('../../middlewares/verifySessionToken');

// Aplica el middleware a todas las rutas de este router
router.use(verifySessionToken);

// Ruta protegida de ejemplo
router.get('/ping', (req, res) => {
  return res.json({
    ok: true,
    shop: req.shopFromToken,  // Extraído del JWT de sesión de Shopify
    user: req.userId          // Extraído del JWT de sesión de Shopify
  });
});

module.exports = router;
