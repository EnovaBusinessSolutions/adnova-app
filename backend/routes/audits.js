'use strict';
const express = require('express');
const router = express.Router();
const Audit = require('../models/Audit');

const { runAuditFor } = require('../jobs/auditJob');        // orquestador
const requireSession = (req,res,next) =>
  (req.isAuthenticated && req.isAuthenticated()) ? next() : res.status(401).json({ ok:false, error:'UNAUTHENTICATED' });

router.post('/run', requireSession, async (req,res) => {
  // targets: ['google','meta','shopify','ga'] — si no vienen, detecta conectadas
  const targets = Array.isArray(req.body?.targets) && req.body.targets.length
    ? req.body.targets
    : ['google','meta','shopify']; // por defecto

  // dispara jobs en “background” (no bloqueante)
  targets.forEach(t => runAuditFor({ userId: req.user._id, type: t }).catch(() => {}));
  res.json({ ok:true, started: targets });
});

router.get('/latest', requireSession, async (req,res) => {
  const type = String(req.query.type || '').toLowerCase();
  if (!['google','meta','shopify','ga'].includes(type)) {
    return res.status(400).json({ ok:false, error:'INVALID_TYPE' });
  }
  const doc = await Audit.findOne({ userId: req.user._id, type }).sort({ generatedAt: -1 }).lean();
  res.json({ ok:true, audit: doc || null });
});

router.get('/summary', requireSession, async (req,res) => {
  const types = ['google','meta','shopify','ga'];
  const audits = await Promise.all(types.map(t =>
    Audit.findOne({ userId: req.user._id, type: t }).sort({ generatedAt:-1 }).lean()
  ));
  // Junta los top3 de cada una
  const items = [];
  for (const a of audits) {
    if (!a) continue;
    (a.actionCenter || []).slice(0,3).forEach(issue => items.push({ type: a.type, ...issue }));
  }
  // orden simple: alta > media > baja
  const rank = { alta:0, media:1, baja:2 };
  items.sort((x,y) => (rank[x.severity]??9)-(rank[y.severity]??9));
  res.json({ ok:true, items: items.slice(0,8) });
});

module.exports = router;
