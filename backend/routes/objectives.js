const express = require('express');
const router = express.Router();
const GoogleAccount = require('../models/GoogleAccount');
const MetaAccount   = require('../models/MetaAccount');

function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'UNAUTHORIZED' });
}

router.get('/dashboard/objectives', ensureAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const [ga, ma] = await Promise.all([
      GoogleAccount.findOne({ user: userId }).select('objective').lean(),
      MetaAccount.findOne({ user: userId }).select('objective').lean()
    ]);
    res.json({ google: ga?.objective ?? null, meta: ma?.objective ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'OBJECTIVES_FETCH_FAILED' });
  }
});

module.exports = router;
