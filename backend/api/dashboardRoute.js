// backend/api/dashboardRoute.js
const express = require('express');
const router = express.Router();
const auditJob = require('../jobs/auditJob');


router.get('/audit', async (req, res) => {
  const { shop, accessToken } = req.query;
  if (!shop || !accessToken) return res.status(400).json({ error: 'shop y accessToken requeridos' });

  try {
    const result = await auditJob.runAudit({ shop, accessToken });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error auditando tienda', details: err.toString() });
  }
});

module.exports = router;
