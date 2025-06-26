const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// ENV: Crea este secreto en tu entorno seguro .env
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET || 'superSecretChangeMe';

router.post('/api/auth/magic-link', (req, res) => {
  // 1. Verifica autenticación del usuario SAAS
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'No session' });
  }
  const userId = req.user._id;
  const shop = req.body.shop;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop' });
  }

  // 2. Genera el magic link (JWT válido 5 min)
  const token = jwt.sign(
    { userId, shop, type: 'magic', created: Date.now() },
    MAGIC_LINK_SECRET,
    { expiresIn: '5m' }
  );
  const url = `https://adnova-app.onrender.com/onboarding?shop=${encodeURIComponent(shop)}&token=${token}`;
  res.json({ url });
});

router.post('/api/auth/validate-magic-link', async (req, res) => {
  const { token } = req.body;
  try {
    const payload = jwt.verify(token, MAGIC_LINK_SECRET);
    // Aquí haces login automático en tu sistema de sesión:
    // Si usas sesiones tipo express-session:
    req.session.userId = payload.userId;
    // O si usas JWT propio, puedes devolver un nuevo JWT aquí.

    res.json({ ok: true, userId: payload.userId });
  } catch (err) {
    res.status(401).json({ ok: false, error: 'Invalid or expired magic link' });
  }
});

module.exports = router;
