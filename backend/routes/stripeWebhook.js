'use strict';

const express = require('express');
const router  = express.Router();
const Stripe  = require('stripe');
const stripe  = Stripe(process.env.STRIPE_SECRET_KEY);

// Facturapi (ESM default fix)
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);

// Models
const TaxProfile = require('../models/TaxProfile');
const User       = require('../models/User');

// Mailer (nuevo)
const { sendMail } = require('../services/mailer');

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

/* =========================================
 * Helpers
 * ========================================= */

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

function welcomeEmailHtml() {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0d081c;color:#fff;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:48px 10px">
<table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#151026;border-radius:16px;box-shadow:0 0 20px #6d3dfc">
<tr><td style="padding:40px 50px">
<h1 style="margin:0 0 16px;color:#6d3dfc">¡Bienvenido a Adnova AI!</h1>
<p style="line-height:24px;margin:0 0 16px">Tu suscripción se activó correctamente.</p>
<p style="line-height:24px;margin:0 0 28px">Ingresa a tu panel para comenzar:</p>
<p><a href="https://ai.adnova.digital/dashboard" style="background:#6d3dfc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block">Ir al dashboard</a></p>
</td></tr>
<tr><td style="background:#100c1e;padding:16px 40px;border-radius:0 0 16px 16px;text-align:center;color:#777;font-size:12px">© ${new Date().getFullYear()} Adnova AI</td></tr>
</table></td></tr></table></body></html>`;
}

function cancelImmediateHtml() {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0d081c;color:#fff;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:48px 10px">
<table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#151026;border-radius:16px;box-shadow:0 0 20px #6d3dfc">
<tr><td style="padding:40px 50px">
<h1 style="margin:0 0 16px;color:#6d3dfc">Suscripción cancelada</h1>
<p style="line-height:24px;margin:0 0 16px">Tu suscripción ha sido cancelada.</p>
<p style="line-height:24px;margin:0 0 28px">Si fue un error o deseas volver, puedes reactivarla desde tu cuenta en cualquier momento.</p>
<p><a href="https://ai.adnova.digital/plans" style="background:#6d3dfc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block">Ver planes</a></p>
</td></tr>
<tr><td style="background:#100c1e;padding:16px 40px;border-radius:0 0 16px 16px;text-align:center;color:#777;font-size:12px">© ${new Date().getFullYear()} Adnova AI</td></tr>
</table></td></tr></table></body></html>`;
}

function cancelAtPeriodEndHtml(endDateStr) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0d081c;color:#fff;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:48px 10px">
<table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#151026;border-radius:16px;box-shadow:0 0 20px #6d3dfc">
<tr><td style="padding:40px 50px">
<h1 style="margin:0 0 16px;color:#6d3dfc">Tu suscripción se cancelará al final del periodo</h1>
<p style="line-height:24px;margin:0 0 16px">Tu plan seguirá activo hasta <strong>${endDateStr}</strong>.</p>
<p style="line-height:24px;margin:0 0 28px">Puedes reactivar la suscripción antes de esa fecha si cambias de opinión.</p>
<p><a href="https://ai.adnova.digital/plans" style="background:#6d3dfc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block">Gestionar plan</a></p>
</td></tr>
<tr><td style="background:#100c1e;padding:16px 40px;border-radius:0 0 16px 16px;text-align:center;color:#777;font-size:12px">© ${new Date().getFullYear()} Adnova AI</td></tr>
</table></td></tr></table></body></html>`;
}

/* =========================================
 * Webhook (usar body RAW)
 * ========================================= */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (e) {
    console.error('Webhook signature failed:', e.message);
    return res.sendStatus(400);
  }

  try {
    switch (event.type) {
      /* ==========================================================
       * A) Compra / activación (bienvenida por correo)
       *    El checkout de suscripción terminó correctamente.
       * ========================================================== */
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          const email =
            session.customer_details?.email ||
            session.customer_email ||
            null;

          if (email) {
            await sendMail({
              to: email,
              subject: '¡Bienvenido! Tu suscripción en Adnova AI está activa',
              text: 'Tu suscripción se activó correctamente. Ingresa a https://ai.adnova.digital/dashboard',
              html: welcomeEmailHtml(),
            });
          }
        }
        break;
      }

      /* ==========================================================
       * B) Cancelación inmediata (suscripción borrada)
       *    Puede venir del portal de facturación de Stripe.
       * ========================================================== */
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        let email = null;
        try {
          const customer = await stripe.customers.retrieve(sub.customer);
          email = customer?.email || null;
        } catch (e) {
          console.warn('No se pudo recuperar el cliente de Stripe:', e?.message);
        }

        if (email) {
          await sendMail({
            to: email,
            subject: 'Confirmación de cancelación · Adnova AI',
            text: 'Tu suscripción ha sido cancelada. Si deseas volver, visita https://ai.adnova.digital/plans',
            html: cancelImmediateHtml(),
          });
        }
        break;
      }

      /* ==========================================================
       * C) Cancelación al final del periodo
       *    Notificamos cuando se activa cancel_at_period_end=true
       * ========================================================== */
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const prev = event.data.previous_attributes || {};
        const turnedOn = prev.cancel_at_period_end === false && sub.cancel_at_period_end === true;
        const justSet  = prev.cancel_at_period_end === undefined && sub.cancel_at_period_end === true;

        if (turnedOn || justSet) {
          let email = null;
          try {
            const customer = await stripe.customers.retrieve(sub.customer);
            email = customer?.email || null;
          } catch (e) {
            console.warn('No se pudo recuperar el cliente de Stripe:', e?.message);
          }

          if (email) {
            const endDateStr = sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toLocaleDateString('es-MX')
              : 'el final de tu ciclo';

            await sendMail({
              to: email,
              subject: 'Tu suscripción se cancelará al final del periodo · Adnova AI',
              text: `Tu suscripción seguirá activa hasta ${endDateStr}. Puedes gestionarla en https://ai.adnova.digital/plans`,
              html: cancelAtPeriodEndHtml(endDateStr),
            });
          }
        }
        break;
      }

      /* ==========================================================
       * D) Pago exitoso de Invoice → timbrado CFDI (Facturapi)
       *    Mantengo tu lógica tal cual, con saneamiento.
       * ========================================================== */
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;

        // Ajusta si tu campo se llama distinto
        const user = await User.findOne({ stripeCustomerId: invoice.customer });
        if (!user) {
          console.warn('User not found for this Stripe customer → skip CFDI');
          break;
        }

        const profile = await TaxProfile.findOne({ user: user._id });
        if (!profile) {
          console.warn('No tax profile → skipping CFDI');
          break;
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
        break;
      }

      default:
        // Otros eventos que no nos interesan por ahora
        break;
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error('Error manejando webhook:', e);
    // responder 200 para evitar reintentos infinitos si el problema es de datos faltantes del lado cliente
    return res.sendStatus(200);
  }
});

module.exports = router;
