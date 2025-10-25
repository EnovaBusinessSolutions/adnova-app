'use strict';
const express   = require('express');
const router    = express.Router();

// Stripe SDK
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// Facturapi (ESM default fix)
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);

// Models
const TaxProfile = require('../models/TaxProfile');
const User       = require('../models/User');

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Convierte líneas de la invoice de Stripe a conceptos CFDI
function buildItemsFromStripeInvoice(inv) {
  return inv.lines.data.map((line) => {
    const unit = (line.amount_excluding_tax ?? line.amount) / 100; // centavos → moneda
    return {
      product_code: process.env.FACTURAPI_DEFAULT_PRODUCT_CODE || '81112100',
      unit_code:    process.env.FACTURAPI_DEFAULT_UNIT || 'E48',
      description:  line.description || line.plan?.nickname || 'Servicio de suscripción',
      price:        Number(unit.toFixed(2)),
      quantity:     line.quantity || 1,
      taxes:        [{ type: 'IVA', rate: 0.16 }],
    };
  });
}

// IMPORTANTE: express.raw aquí, no json()
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, req.headers['stripe-signature'], endpointSecret
    );
  } catch (e) {
    console.error('Webhook signature failed:', e.message);
    return res.sendStatus(400);
  }

  try {
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;

      // Ajusta si tu campo se llama distinto
      const user = await User.findOne({ stripeCustomerId: invoice.customer });
      if (!user) throw new Error('User not found for this Stripe customer');

      const profile = await TaxProfile.findOne({ user: user._id });
      if (!profile) {
        console.warn('No tax profile → skipping CFDI');
        return res.sendStatus(200);
      }

      const items = buildItemsFromStripeInvoice(invoice);
      const cfdi = await facturapi.invoices.create({
        customer: profile.facturapi_customer_id,
        items,
        currency: (invoice.currency || 'mxn').toUpperCase(),
        use: profile.cfdi_use || process.env.FACTURAPI_DEFAULT_USE || 'G03',
        payment_form:   process.env.FACTURAPI_DEFAULT_PAYMENT_FORM || '03',
        payment_method: process.env.FACTURAPI_DEFAULT_PAYMENT_METHOD || 'PUE',
        series:         process.env.FACTURAPI_SERIES || 'ADN',
        place_of_issue: process.env.FACTURAPI_ISSUER_ZIP,
        send_pdf: true,
        metadata: { stripe_invoice_id: invoice.id, stripe_customer_id: invoice.customer },
      });

      console.log('CFDI timbrado ✅', cfdi.uuid);
      // (Opcional) guarda cfdi.uuid, cfdi.pdf_url, cfdi.xml_url en tu DB
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error('Error manejando webhook:', e);
    // respondemos 200 para evitar reintentos infinitos por datos faltantes
    return res.sendStatus(200);
  }
});

module.exports = router;
