// backend/routes/stripe.js
'use strict';

const express = require('express');
const router = express.Router();
const Stripe = require('stripe');

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

// Avisos tempranos (no detienen la app)
if (!STRIPE_SECRET_KEY) console.warn('⚠️ Falta STRIPE_SECRET_KEY');
if (!STRIPE_WEBHOOK_SECRET) console.warn('⚠️ Falta STRIPE_WEBHOOK_SECRET');
['PRICE_ID_EMPRENDEDOR','PRICE_ID_CRECIMIENTO','PRICE_ID_PRO'].forEach(k=>{
  if (!process.env[k]) console.warn(`⚠️ Falta ${k}`);
});
if (!APP_URL) console.warn('⚠️ Falta APP_URL');
if (!SUCCESS_PATH || !CANCEL_PATH) console.warn('⚠️ Falta SUCCESS_PATH o CANCEL_PATH');

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Intentamos usar tu modelo User si existe (no rompe si no está)
let User = null;
try { User = require('../models/User'); } catch (_) { /* optional */ }

const PRICE_MAP = {
  emprendedor: PRICE_ID_EMPRENDEDOR,
  crecimiento: PRICE_ID_CRECIMIENTO,
  pro:         PRICE_ID_PRO,
};

// ---------- helpers ----------
function successUrl() {
  // Usa STRIPE_SUCCESS_URL si la tienes; si no, APP_URL + SUCCESS_PATH; si no, fallback
  return process.env.STRIPE_SUCCESS_URL
    ? process.env.STRIPE_SUCCESS_URL
    : (APP_URL && SUCCESS_PATH ? `${APP_URL}${SUCCESS_PATH}` : 'https://ai.adnova.digital/plans?status=success');
}
function cancelUrl() {
  return process.env.STRIPE_CANCEL_URL
    ? process.env.STRIPE_CANCEL_URL
    : (APP_URL && CANCEL_PATH ? `${APP_URL}${CANCEL_PATH}` : 'https://ai.adnova.digital/plans');
}
function ensureAuth(req, res, next) {
  try {
    if (req.isAuthenticated?.() && req.user?._id) return next();
  } catch {}
  return res.status(401).json({ error: 'Unauthorized' });
}

// =============== CHECKOUT ===============
// Body válido: { plan: 'emprendedor'|'crecimiento'|'pro' } ó { priceId: 'price_...' }
router.post('/checkout', ensureAuth, express.json(), async (req, res) => {
  const startedAt = new Date().toISOString();

  try {
    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Falta STRIPE_SECRET_KEY en el servidor' });
    }

    const { plan, priceId: rawPriceId, customer_email } = req.body || {};
    const priceId = rawPriceId || PRICE_MAP[String(plan || '').toLowerCase()];

    if (!priceId) {
      return res.status(400).json({ error: 'Plan o priceId inválido' });
    }

    // Reutilizar/crear Customer si tenemos modelo User
    let customerId = undefined;
    let userId = undefined;
    if (User && req.user?._id) {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

      userId = String(user._id);

      if (user.stripeCustomerId) {
        customerId = user.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          email: user.email || customer_email,
          metadata: { userId }
        });
        customerId = customer.id;
        user.stripeCustomerId = customerId;
        await user.save();
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // si tenemos customer, lo usamos; si no, que Stripe lo cree
      ...(customerId ? { customer: customerId } : { customer_creation: 'always' }),

      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      automatic_tax: { enabled: false },

      success_url: successUrl(),
      cancel_url:  cancelUrl(),

      subscription_data: { metadata: { userId: userId || 'n/a' } },
      metadata: { plan: plan || 'n/a', userId: userId || 'n/a', startedAt },

      customer_email: customer_email || undefined,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    // LOG DETALLADO → revisa Render Logs para el motivo exacto
    console.error('❌ [stripe/checkout] error', {
      message: err?.message,
      type: err?.type,
      code: err?.code,
      statusCode: err?.statusCode,
      rawType: err?.rawType,
      param: err?.raw?.param,
    });
    return res.status(500).json({
      error: 'No se pudo crear la sesión de checkout',
      details: { message: err?.message, type: err?.type, code: err?.code }
    });
  }
});

// =============== WEBHOOK ===============
// IMPORTANTE: En tu index.js DEBES montar el raw ANTES del json:
//   app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), webhookHandler)
// Aquí solo validamos y despachamos.
router.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // req.body DEBE ser Buffer (por express.raw montado en index)
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️ Firma de webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
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

// --- DEBUG: estado de servidor/Stripe (temporal) ---
router.get('/health', (req, res) => {
  res.json({
    mode: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'live' :
          (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_') ? 'test' : 'unknown',
    hasKey: !!process.env.STRIPE_SECRET_KEY,
    prices: {
      emprendedor: !!process.env.PRICE_ID_EMPRENDEDOR,
      crecimiento: !!process.env.PRICE_ID_CRECIMIENTO,
      pro: !!process.env.PRICE_ID_PRO,
    },
    urls: {
      app: process.env.APP_URL || null,
      success: process.env.STRIPE_SUCCESS_URL || (process.env.APP_URL && process.env.SUCCESS_PATH ? `${process.env.APP_URL}${process.env.SUCCESS_PATH}` : null),
      cancel: process.env.STRIPE_CANCEL_URL || (process.env.APP_URL && process.env.CANCEL_PATH ? `${process.env.APP_URL}${process.env.CANCEL_PATH}` : null),
    }
  });
});

// Verifica que el price exista en Stripe (temporal)
router.get('/check-price', async (req, res) => {
  try {
    const id = req.query.id || process.env.PRICE_ID_CRECIMIENTO;
    const p = await (new (require('stripe'))(process.env.STRIPE_SECRET_KEY)).prices.retrieve(id);
    res.json({ ok: true, id: p.id, active: p.active, currency: p.currency, unit_amount: p.unit_amount, product: p.product });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message, type: e.type, code: e.code });
  }
});

module.exports = router;
