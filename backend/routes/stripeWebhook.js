// backend/routes/stripeWebhook.js
'use strict';

const express = require('express');
const router  = express.Router();

// Stripe SDK
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Facturapi (ESM default fix)
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);

// Models
const TaxProfile = require('../models/TaxProfile');
const User       = require('../models/User');

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// --- Helpers ---------------------------------------------------------------

// Convierte líneas de la invoice de Stripe a conceptos CFDI (precio SIN IVA)
function buildItemsFromStripeInvoice(inv) {
  return inv.lines.data.map((line) => {
    // Tomamos el monto SIN impuestos si existe; Stripe reporta en centavos
    const unitExTax = (line.amount_excluding_tax ?? line.amount) / 100;

    return {
      product: {
        // Clave producto/servicio (SAT) + unidad
        product_key: process.env.FACTURAPI_DEFAULT_PRODUCT_CODE || '81112100',
        unit_key:    process.env.FACTURAPI_DEFAULT_UNIT || 'E48',
        description: line.description || line.plan?.nickname || 'Servicio de suscripción',
        // Precio unitario (sin IVA) DEBE ir dentro de product
        price: Number((unitExTax).toFixed(2)),
      },
      quantity: line.quantity || 1,
      // IVA no incluido para que Facturapi lo calcule sobre el price
      taxes: [{ type: 'IVA', rate: 0.16, included: false }],
      discount: 0,
    };
  });
}

// --- Webhook Stripe (usar cuerpo RAW) -------------------------------------
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      endpointSecret
    );
  } catch (e) {
    console.error('Webhook signature failed:', e.message);
    return res.sendStatus(400);
  }

  try {
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;

      // Localiza al usuario por su Stripe customer id (campo en tu User)
      const user = await User.findOne({ stripeCustomerId: invoice.customer });
      if (!user) throw new Error('User not found for this Stripe customer');

      // Revisa que tenga perfil fiscal y cliente en Facturapi
      const profile = await TaxProfile.findOne({ user: user._id });
      if (!profile || !profile.facturapi_customer_id) {
        console.warn('No tax profile or facturapi_customer_id → skipping CFDI');
        return res.sendStatus(200);
      }

      const items = buildItemsFromStripeInvoice(invoice);

      // Arma el CFDI. Currency a MXN y mayúsculas por si acaso
      const payload = {
        customer: profile.facturapi_customer_id,
        items,
        currency: (invoice.currency || 'mxn').toUpperCase(),
        use: profile.cfdi_use || process.env.FACTURAPI_DEFAULT_USE || 'G03',
        payment_form:   process.env.FACTURAPI_DEFAULT_PAYMENT_FORM || '03', // Transferencia
        payment_method: process.env.FACTURAPI_DEFAULT_PAYMENT_METHOD || 'PUE',
        series:         process.env.FACTURAPI_SERIE || 'ADN',
        place_of_issue: process.env.FACTURAPI_ISSUER_ZIP, // ZIP emisor
        send_pdf: true,
        metadata: {
          stripe_invoice_id: invoice.id,
          stripe_customer_id: invoice.customer,
          userId: String(user._id)
        },
      };

      // Timbrado
      const cfdi = await facturapi.invoices.create(payload);
      console.log('✅ CFDI timbrado', cfdi.uuid, 'monto:', invoice.amount_paid / 100);

      // TODO opcional: persistir cfdi.uuid, cfdi.pdf_url, cfdi.xml_url en tu DB
    }

    return res.sendStatus(200);
  } catch (e) {
    // Log amigable si viene error de Facturapi
    const apiErr = e?.response?.data || e;
    console.error('❌ Error manejando webhook/CFDI:', apiErr);
    // Devolvemos 200 para que Stripe no reintente indefinidamente (si el fallo es de datos)
    return res.sendStatus(200);
  }
});

module.exports = router;
