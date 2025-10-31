// backend/routes/billing.js
'use strict';

const express = require('express');
const router = express.Router();
const Facturapi = (require('facturapi').default || require('facturapi'));

const facturapiKey = process.env.FACTURAPI_KEY;
const facturapi = facturapiKey ? new Facturapi(facturapiKey) : null;

// Modelos
const TaxProfile = require('../models/TaxProfile');

// Guard local para APIs (responde 401 en lugar de redirigir)
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
};

/** Utils */
const required = (v) => typeof v === 'string' && v.trim().length > 0;
const toUpper  = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);
const toTrim   = (v) => (typeof v === 'string' ? v.trim() : v);

/**
 * GET /api/billing/tax-profile
 * Devuelve el perfil fiscal del usuario logueado (o null).
 */
router.get('/tax-profile', ensureAuthenticated, async (req, res) => {
  try {
    const profile = await TaxProfile.findOne({ user: req.user._id }).lean();
    return res.json({ ok: true, profile: profile || null });
  } catch (e) {
    console.error('billing.get tax-profile:', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/billing/tax-profile
 * Crea/actualiza el perfil y lo refleja en Facturapi (customer create/update).
 * Body: { rfc, legal_name, tax_regime, zip, cfdi_use }
 */
router.post('/tax-profile', ensureAuthenticated, async (req, res) => {
  try {
    if (!facturapi)
      return res.status(500).json({ ok: false, error: 'MISSING_FACTURAPI_KEY' });

    let { rfc, legal_name, tax_regime, zip, cfdi_use } = req.body || {};

    // Sanitiza
    rfc         = toUpper(rfc);
    legal_name  = toTrim(legal_name);
    tax_regime  = toUpper(tax_regime);
    zip         = toTrim(zip);
    cfdi_use    = toUpper(cfdi_use);

    if (![rfc, legal_name, tax_regime, zip, cfdi_use].every(required)) {
      return res.status(400).json({ ok: false, error: 'INVALID_BODY' });
    }

    // Si alguien captura RFC genérico XAXX, fuerza régimen 616 (requisito de Facturapi)
    if (rfc === 'XAXX010101000') {
      tax_regime = '616';
    }

    // Upsert local
    let profile = await TaxProfile.findOne({ user: req.user._id });
    if (!profile) {
      profile = new TaxProfile({
        user: req.user._id,
        rfc, legal_name, tax_regime, zip, cfdi_use
      });
    } else {
      Object.assign(profile, { rfc, legal_name, tax_regime, zip, cfdi_use });
    }

    // Payload para Facturapi
    const payload = {
      legal_name,
      tax_id: rfc,
      tax_system: tax_regime,
      address: { zip },
      email: req.user.email,
      metadata: { userId: String(req.user._id) } // útil para trazabilidad
    };

    // Reflejar en Facturapi
    if (!profile.facturapi_customer_id) {
      const created = await facturapi.customers.create(payload);
      profile.facturapi_customer_id = created.id;
    } else {
      await facturapi.customers.update(profile.facturapi_customer_id, payload);
    }

    await profile.save();

    return res.json({ ok: true, profile });
  } catch (e) {
    console.error('billing.post tax-profile:', e?.response?.data || e);
    const msg = e?.response?.data?.message || e.message || 'SERVER_ERROR';
    return res.status(400).json({ ok: false, error: msg });
  }
});

module.exports = router;
