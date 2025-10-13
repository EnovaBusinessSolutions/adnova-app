// backend/routes/stripe.js
const express = require('express');
const Stripe = require('stripe');

const router = express.Router();

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  APP_URL,
  SUCCESS_PATH,
  CANCEL_PATH,
  PRICE_ID_EMPRENDEDOR,
  PRICE_ID_CRECIMIENTO,
  PRICE_ID_PRO,
} = process.env;

// --- Validaciones tempranas útiles (no rompen, pero avisan) ---
if (!STRIPE_SECRET_KEY) console.warn('⚠️ Falta STRIPE_SECRET_KEY en .env');
if (!STRIPE_WEBHOOK_SECRET) console.warn('⚠️ Falta STRIPE_WEBHOOK_SECRET en .env');
['PRICE_ID_EMPRENDEDOR','PRICE_ID_CRECIMIENTO','PRICE_ID_PRO'].forEach(k=>{
  if (!process.env[k]) console.warn(`⚠️ Falta ${k} en .env`);
});
if (!APP_URL) console.warn('⚠️ Falta APP_URL en .env');
if (!SUCCESS_PATH || !CANCEL_PATH) console.warn('⚠️ Falta SUCCESS_PATH o CANCEL_PATH en .env');

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const PRICE_MAP = {
  emprendedor: PRICE_ID_EMPRENDEDOR,
  crecimiento: PRICE_ID_CRECIMIENTO,
  pro:         PRICE_ID_PRO,
};

/**
 * POST /api/stripe/checkout
 * body: { plan: 'emprendedor' | 'crecimiento' | 'pro', customer_email?: string }
 * Regresa: { url, sessionId }
 */
router.post('/checkout', async (req, res) => {
  try {
    const { plan, customer_email } = req.body || {};
    const price = PRICE_MAP[plan] || req.body.priceId; // fallback si mandas priceId directo

    if (!price) {
      return res.status(400).json({ error: 'Plan o priceId inválido' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],

      // Precios ya creados como "IVA incluido (inclusive)" en Stripe:
      // No habilitamos automatic_tax (no suma nada adicional).
      automatic_tax: { enabled: false },

      // Recopila RFC (Tax ID) en el Checkout (se muestra como "Tax ID" en Stripe)
      tax_id_collection: { enabled: true },

      // Crea/recupera Customer (útil para facturación e invoices)
      customer_creation: 'always',

      // Direccion de facturación (útil para facturas y fiscalidad)
      billing_address_collection: 'required',

      // Enlaces
      success_url: `${APP_URL}${SUCCESS_PATH}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}${CANCEL_PATH}`,

      // Identificador de negocio para trazabilidad
      metadata: { plan: plan || 'n/a' },

      // Opcionales:
      customer_email: customer_email || undefined,
      allow_promotion_codes: false,
      // payment_method_types: ['card'], // opcional: limitar métodos
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('❌ stripe/checkout error:', err);
    return res.status(500).json({ error: 'No se pudo crear la sesión de checkout' });
  }
});

/**
 * POST /api/stripe/webhook
 * Importante: en index.js ya montaste:
 *   app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
 * Por eso aquí usamos req.body (Buffer) para validar la firma.
 */
router.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // req.body ES Buffer gracias al express.raw() aplicado en index.js
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️  Firma de webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Aquí puedes activar acceso preliminar (aunque el cargo se confirma con invoice.paid)
        // session.customer, session.subscription, session.metadata.plan
        console.log('✅ checkout.session.completed', {
          session: session.id,
          customer: session.customer,
          email: session.customer_details?.email,
          plan: session.metadata?.plan,
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        // Aquí confirma acceso/renovación en tu DB
        console.log('💸 invoice.paid', {
          invoice: invoice.id,
          customer: invoice.customer,
          subscription: invoice.subscription,
          amount_paid: invoice.amount_paid,
          currency: invoice.currency,
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        // Aquí puedes notificar al cliente y/o degradar acceso
        console.warn('⛔ invoice.payment_failed', {
          invoice: invoice.id,
          customer: invoice.customer,
          subscription: invoice.subscription,
        });
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // Sincroniza estado en tu DB (active, past_due, canceled, etc.)
        console.log(`ℹ️ ${event.type}`, {
          subscription: sub.id,
          status: sub.status,
          customer: sub.customer,
          current_period_end: sub.current_period_end,
        });
        break;
      }

      default:
        console.log('📨 Evento no manejado:', event.type);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error manejando evento de webhook:', err);
    return res.sendStatus(500);
  }
});

module.exports = router;
