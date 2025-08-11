// backend/routes/audits.js
const express = require('express');
const router = express.Router();

const verifyShopifyToken = require('../../middlewares/verifyShopifyToken');
const User = require('../models/User');
const Audit = require('../models/Audit');

const PLAN = {
  gratis:      { strategy: 'rolling',  limit: 1, windowDays: 15 },
  emprendedor: { strategy: 'monthly',  limit: 3 },
  pro:         { strategy: 'weekly',   limit: 3 },
  enterprise:  { strategy: 'unlimited', limit: null }
};

function periodBounds(conf) {
  const now = new Date();
  let since = null;
  let nextResetAt = null;

  if (conf.strategy === 'weekly') {
    const d = now.getUTCDay() || 7; // 1..7 (Mon..Sun)
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (d - 1)));
    since = start;
    const next = new Date(start); next.setUTCDate(start.getUTCDate() + 7);
    nextResetAt = next.toISOString();
  } else if (conf.strategy === 'monthly') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    since = start;
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    nextResetAt = next.toISOString();
  } else if (conf.strategy === 'rolling') {
    since = new Date(now); since.setUTCDate(now.getUTCDate() - (conf.windowDays || 15));
  }
  return { since, nextResetAt };
}

// GET /api/audits/usage
router.get('/usage', verifyShopifyToken, async (req, res) => {
  try {
    const shop = req.shop;
    const user = await User.findOne({ shop }).select('_id plan');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const planKey = user.plan || 'gratis';
    const conf = PLAN[planKey] || PLAN.gratis;

    let used = 0;
    let nextResetAt = null;

    if (conf.limit == null) {
      used = 0; // ilimitado
    } else {
      const { since, nextResetAt: nr } = periodBounds(conf);
      nextResetAt = nr;

      // IMPORTANTE: usar generatedAt
      used = await Audit.countDocuments({
        userId: user._id,
        ...(since ? { generatedAt: { $gte: since } } : {})
      });

      if (conf.strategy === 'rolling' && !nextResetAt) {
        const last = await Audit
          .findOne({ userId: user._id })
          .sort({ generatedAt: -1 })
          .select('generatedAt');
        if (last?.generatedAt) {
          const n = new Date(last.generatedAt);
          n.setUTCDate(n.getUTCDate() + (conf.windowDays || 15));
          nextResetAt = n.toISOString();
        }
      }
    }

    return res.json({
      plan: planKey,
      limit: conf.limit,
      used,
      period: conf.strategy,
      nextResetAt,
      unlimited: conf.limit == null
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error obteniendo uso' });
  }
});

// POST /api/audits/generate
router.post('/generate', verifyShopifyToken, async (req, res) => {
  try {
    const shop = req.shop;
    const user = await User.findOne({ shop }).select('_id plan');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const planKey = user.plan || 'gratis';
    const conf = PLAN[planKey] || PLAN.gratis;

    if (conf.limit != null) {
      const { since } = periodBounds(conf);
      const used = await Audit.countDocuments({
        userId: user._id,
        ...(since ? { generatedAt: { $gte: since } } : {})
      });
      if (used >= conf.limit) {
        return res.status(429).json({ code: 'AUDIT_LIMIT_REACHED', message: 'Has alcanzado tu límite.' });
      }
    }

    // IMPORTANTE: guardar generatedAt
    const audit = await Audit.create({
      userId: user._id,
      shopDomain: shop,
      status: 'queued',
      generatedAt: new Date()
    });

    return res.status(201).json({ ok: true, auditId: audit._id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo generar la auditoría' });
  }
});

module.exports = router;
