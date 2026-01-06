// backend/routes/mailDebug.js
'use strict';

const express = require('express');
const router = express.Router();

const { verifySMTP, sendTestEmail } = require('../services/emailService');

// ✅ Para no dejarlo público en prod: exige token si existe env
function requireMailDebugToken(req, res, next) {
  const token = process.env.MAIL_DEBUG_TOKEN;
  if (!token) return next(); // si no hay token, no bloquea (tu eliges)
  const got = req.get('x-mail-debug-token') || req.query.token;
  if (got !== token) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  return next();
}

router.get('/verify', requireMailDebugToken, async (_req, res) => {
  try {
    const out = await verifySMTP();
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get('/test', requireMailDebugToken, async (_req, res) => {
  try {
    const out = await sendTestEmail();
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

module.exports = router;
