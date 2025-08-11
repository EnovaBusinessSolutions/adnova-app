// backend/routes/audits.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');     // ajusta la ruta si tu archivo está a otro nivel
const Audit = require('../models/Audit');

const PLAN = {
  gratis:      { strategy: 'rolling',  limit: 1, windowDays: 15 },
  emprendedor: { strategy: 'monthly',  limit: 3 },
  pro:         { strategy: 'weekly',   limit: 3 },
  enterprise:  { strategy: 'unlimited', limit: null }
};

function periodBounds(conf) {
  const now = new Date();
  if (conf.strategy === 'weekly') {
    const d = now.getUTCDay() || 7; // 1..7 (Mon..Sun)
    const start = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (d - 1)
    ));
    const next = new Date(start); next.setUTCDate(start.getUTCDate() + 7);
    return { since: start, nextResetAt: next.toISOString(), window: 'weekly' };
  }
  if (conf.strategy === 'monthly') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const next  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { since: start, nextResetAt: next.toISOString(), window: 'monthly' };
  }
  if (conf.strategy === 'rolling') {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - (conf.windowDays || 15));
    return { since, nextResetAt: null, window: `rolling-${conf.windowDays || 15}d` };
  }
  return { since: new Date(0), nextResetAt: null, window: 'unlimited' };
}

router.get('/usage', async (req, res) => {
  try {
    // 1) Autenticación por sesión
    if (!(req.isAuthenticated && req.isAuthenticated())) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const { shop, _id } = req.user;
    if (!shop) return res.status(400).json({ error: 'Usuario sin shop' });

    // 2) lee plan del usuario (o default 'gratis')
    const user = await User.findById(_id).select('plan');
    const plan = user?.plan || 'gratis';
    const conf = PLAN[plan] || PLAN.gratis;

    // 3) enterprise = ilimitado
    if (conf.strategy === 'unlimited') {
      return res.json({
        plan, used: 0, limit: null, window: 'unlimited', nextResetAt: null
      });
    }

    // 4) cuenta auditorías en ventana
    const { since, nextResetAt, window } = periodBounds(conf);
    const used = await Audit.countDocuments({
      shopDomain: shop,
      createdAt: { $gte: since }
    });

    return res.json({
      plan,
      used,
      limit: conf.limit,
      window,
      nextResetAt
    });
  } catch (e) {
    console.error('GET /api/audits/usage error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
