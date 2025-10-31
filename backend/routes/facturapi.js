// backend/routes/facturapi.js
'use strict';
const express = require('express');
const router = express.Router();
const { emitirFactura, genCustomerPayload } = require('../services/facturaService');

let User = null;  try { User = require('../models/User'); } catch {}
let TaxProfile = null; try { TaxProfile = require('../models/TaxProfile'); } catch {}

/**
 * POST /api/facturapi/emit
 * body: { userId, amount, description }
 * Timbrado manual rápido (total con IVA incluido).
 */
router.post('/emit', async (req, res) => {
  try {
    const { userId, amount, description } = req.body || {};
    if (!userId || amount == null) {
      return res.status(400).json({ ok:false, error: 'userId y amount requeridos' });
    }

    const totalWithTax = Number(amount);
    if (Number.isNaN(totalWithTax) || totalWithTax < 0.01) {
      return res.status(400).json({ ok:false, error: 'amount inválido (>= 0.01)' });
    }

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ ok:false, error: 'Usuario no encontrado' });

    const taxProfile = TaxProfile ? await TaxProfile.findOne({ user: user._id }).lean() : null;

    const cfdi = await emitirFactura({
      customer: genCustomerPayload(taxProfile),
      description: description || 'Emisión manual',
      totalWithTax,
      cfdiUse: taxProfile?.cfdiUse,
      sendEmailTo: (taxProfile?.email || user.email),
      // ❌ Sin metadata (tu cuenta de Facturapi no lo permite)
    });

    return res.json({ ok:true, cfdi });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.response?.data || e.message });
  }
});

module.exports = router;
