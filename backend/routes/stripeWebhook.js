// backend/routes/stripeWebhook.js
'use strict';

const express = require('express');
const router  = express.Router();
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

// 👉 Centralizamos timbrado en facturaService (no timbramos directo aquí)
const { emitirFactura, genCustomerPayload } = require('../services/facturaService');

// Models
let User = null; try { User = require('../models/User'); } catch {}
let TaxProfile = null; try { TaxProfile = require('../models/TaxProfile'); } catch {}

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ⚠️ IMPORTANTE: NO uses express.raw aquí. Ya lo aplicas en index.js
// app.use('/api/stripe', (req,res,next)=>{ if (req.path==='/webhook') return express.raw(...); ... })

router.post('/webhook', async (req, res) => {
  // req.body llega como Buffer (raw) por el middleware configurado en index.js
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (e) {
    console.error('⚠️ Firma de webhook inválida:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    // Timbran mejor estos dos eventos (ya hay importe definitivo):
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      const invSkeleton = event.data.object;

      // Trae la invoice completa (con lines y customer)
      const invoice = await stripe.invoices.retrieve(invSkeleton.id, {
        expand: ['lines.data.price.product', 'customer']
      });

      // 1) Localiza al usuario por stripeCustomerId
      const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

      if (!User) return res.sendStatus(200);
      const user = await User.findOne({ stripeCustomerId: customerId }).lean();
      if (!user) {
        console.warn('Invoice sin usuario asociado. customerId:', customerId);
        return res.sendStatus(200);
      }

      // 2) Carga el TaxProfile (si no hay → público en general)
      let taxProfile = null;
      if (TaxProfile) {
        taxProfile = await TaxProfile.findOne({ user: user._id }).lean();
      }

      // 3) Prepara el payload de cliente y monto total (IVA incluido)
      const customerPayload = genCustomerPayload(taxProfile);
      const totalWithTax = (invoice.total || invoice.amount_paid || 0) / 100;

      // Evita intentar timbrar con totales 0 (cupones 100%)
      if (totalWithTax < 0.01) {
        console.warn('Total < 0.01: se omite timbrado para', invoice.id);
        return res.sendStatus(200);
      }

      // 4) Descripción legible (toma nickname del price si existe)
      const firstLine = invoice.lines?.data?.[0];
      const planName = firstLine?.price?.nickname || firstLine?.description || 'Plan';
      const description = `Suscripción Adnova AI – ${planName}`;

      // 5) Uso de CFDI (acepta cfdi_use o cfdiUse)
      const cfdiUse = taxProfile?.cfdi_use || taxProfile?.cfdiUse || process.env.FACTURAPI_DEFAULT_USE || 'G03';

      // 6) Timbrado vía servicio centralizado
      try {
        const cfdi = await emitirFactura({
          customer: customerPayload,
          description,
          totalWithTax,
          cfdiUse,
          sendEmailTo: customerPayload.email || user.email,
          metadata: {
            stripeInvoiceId: invoice.id,
            stripeCustomerId: customerId,
            userId: String(user._id)
          }
        });

        console.log('✅ CFDI timbrado', cfdi.uuid, 'total:', totalWithTax);

        
      } catch (e) {
        console.error('❌ Timbrado Facturapi falló:', e?.response?.data || e.message);
        // devolvemos 200 para evitar reintentos infinitos si es fallo de datos
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error manejando webhook:', err);
    return res.sendStatus(500);
  }
});

module.exports = router;
