const express = require('express');
const axios = require('axios');
const router = express.Router();
const User = require('../backend/models/User');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

router.get('/callback', async (req, res) => {
  const { code, shop, state } = req.query;

  if (!code || !shop || !state) {
    return res.status(400).send("❌ Faltan parámetros en la URL de redirección");
  }

  try {
    // Solicita el access_token a Shopify
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_SECRET,
      code
    });

    const accessToken = response.data.access_token;

    // Guarda el token y el shop en MongoDB para este usuario
    await User.findByIdAndUpdate(state, {
      shopify: {
        connected: true,
        shop,
        token: accessToken
      }
    });

    // Redirige al siguiente paso del onboarding
    res.redirect('/onboarding');

  } catch (err) {
    console.error("❌ Error en Shopify callback:", err.message);
    res.status(500).send("Error al obtener token de Shopify.");
  }
});

module.exports = router;
