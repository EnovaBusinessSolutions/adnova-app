'use strict';
const express = require('express');
const router = express.Router();
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);


router.get('/ping', async (_req, res) => {
  try {
    const customers = await facturapi.customers.list({ page: 1, per_page: 1 });
    res.json({ ok: true, customers });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
