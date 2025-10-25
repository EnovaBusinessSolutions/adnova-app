'use strict';
const express = require('express');
const router = express.Router();
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);
const TaxProfile = require('../models/TaxProfile');
const ensureAuthenticated = require('../../middlewares/ensureAuthenticated');

router.post('/tax-profile', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;
    const { rfc, legal_name, tax_regime, zip, cfdi_use } = req.body;

    let profile = await TaxProfile.findOne({ user: userId });
    if (!profile) profile = new TaxProfile({ user: userId, rfc, legal_name, tax_regime, zip, cfdi_use });
    else Object.assign(profile, { rfc, legal_name, tax_regime, zip, cfdi_use });

    const payload = {
      legal_name,
      tax_id: rfc,
      tax_system: tax_regime,
      address: { zip },
      email: req.user.email,
    };

    if (!profile.facturapi_customer_id) {
      const created = await facturapi.customers.create(payload);
      profile.facturapi_customer_id = created.id;
    } else {
      await facturapi.customers.update(profile.facturapi_customer_id, payload);
    }

    await profile.save();
    res.json({ ok: true, profile });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
