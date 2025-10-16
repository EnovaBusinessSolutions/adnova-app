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

// Avisos (no detienen la app)
if (!STRIPE_SECRET_KEY) console.warn('⚠️ Falta STRIPE_SECRET_KEY');
if (!STRIPE_WEBHOOK_SECRET) console.warn('⚠️ Falta STRIPE_WEBHOOK_SECRET');
['PRICE_ID_EMPRENDEDOR','PRICE_ID_CRECIMIENTO','PRICE_ID_PRO'].forEach(k=>{
  if (!process.env[k]) console.warn(`⚠️ Falta ${k}`);
});
if (!APP_URL) console.warn('⚠️ Falta APP_URL');
if (!SUCCESS_PATH || !CANCEL_PATH) console.warn('⚠️ Falta SUCCESS_PATH o CANCEL_PATH');

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Intentamos usar tu modelo User (opcional)
let User = null;
try { User = require('../models/User'); } catch (_) {}

const PRICE_MAP = {
  emprendedor: PRICE_ID_EMPRENDEDOR,
  crecimiento: PRICE_ID_CRECIMIENTO,
  pro:         PRICE_ID_PRO,
};

// price -> plan (para actualizar DB en el webhook)
const PRICE_TO_PLAN = {
  [PRICE_ID_EMPRENDEDOR]: 'emprendedor',
  [PRICE_ID_CRECIMIENTO]: 'crecimiento',
  [PRICE_ID_PRO]:         'pro',
};

// ---------- helpers ----------
function successUrl() {
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
// Body: { plan: 'emprendedor'|'crecimiento'|'pro' } ó { priceId: 'price_...' }
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

    // Reutilizar/crear Customer si tenemos User
    let customerId;
    let userId;
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

    const base = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],

      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      automatic_tax: { enabled: false },

      success_url: successUrl(),
      cancel_url:  cancelUrl(),

      subscription_data: { metadata: { userId: userId || 'n/a' } },
      metadata: { plan: plan || 'n/a', userId: userId || 'n/a', startedAt },

      customer_email: customer_email || undefined,
    };

    if (customerId) {
      Object.assign(base, {
        customer: customerId,
        customer_update: { name: 'auto', address: 'auto' },
      });
    } else {
      Object.assign(base, { customer_creation: 'always' });
    }

    // Prevalidación del PRICE
    let priceObj;
    try {
      priceObj = await stripe.prices.retrieve(priceId);
    } catch (e) {
      console.error('[checkout] price retrieve failed:', e.message);
      return res.status(400).json({ error: 'PRICE_ID inválido para esta clave', details: e.message });
    }
    if (!priceObj.recurring) {
      return res.status(400).json({ error: 'Este PRICE no es recurrente (one_time). Crea un price recurrente mensual.' });
    }
    if (priceObj.active === false) {
      return res.status(400).json({ error: 'El PRICE está inactivo en Stripe.' });
    }

    console.log('[checkout] Using price', {
      id: priceObj.id,
      mode: (STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'live' : 'test',
      recurring: priceObj.recurring
    });

    const session = await stripe.checkout.sessions.create(base);
    return res.json({ url: session.url, sessionId: session.id });

  } catch (err) {
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
// (index.js ya aplica express.raw() SOLO en /api/stripe/webhook)
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️ Firma de webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (!User) try { User = require('../models/User'); } catch {}

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
        const userId = s.metadata?.userId;
        if (userId && customerId && User) {
          await User.findByIdAndUpdate(userId, { $set: { stripeCustomerId: customerId } }).exec();
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

        // 1) userId
        let userId = sub.metadata?.userId;
        if (!userId && customerId) {
          try {
            const cust = await stripe.customers.retrieve(customerId);
            userId = cust?.metadata?.userId || null;
          } catch {}
        }
        if (!userId || !User) break;

        // 2) status y price/plan
        const status = (sub.status || '').toLowerCase();
        const priceId = sub.items?.data?.[0]?.price?.id || null;
        const mappedPlan = priceId ? PRICE_TO_PLAN[priceId] : null;

        // 3) update base
        const update = {
          'subscription.id': sub.id,
          'subscription.status': status,
          'subscription.priceId': priceId,
          'subscription.cancel_at_period_end': !!sub.cancel_at_period_end,
          'subscription.currentPeriodEnd': sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
        };
        if (customerId) update['stripeCustomerId'] = customerId;

        // 4) reglas de plan
        if (['canceled', 'incomplete_expired', 'unpaid'].includes(status)) {
          update['plan'] = 'gratis';
          update['subscription.plan'] = 'gratis';
        } else if (['active', 'trialing', 'past_due'].includes(status) && mappedPlan) {
          update['plan'] = mappedPlan;
          update['subscription.plan'] = mappedPlan;
        }

        await User.findByIdAndUpdate(userId, { $set: update }).exec();
        break;
      }

      case 'invoice.paid': {
        // opcional
        break;
      }

      case 'invoice.payment_failed': {
        // opcional
        break;
      }

      default:
        // no-op
        break;
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error manejando evento de webhook:', err);
    return res.sendStatus(500);
  }
});

// =============== BILLING PORTAL ===============
router.post('/portal', ensureAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'Usuario sin stripeCustomerId' });
    }

    const returnUrl = `${process.env.PUBLIC_BASE_URL || 'https://ai.adnova.digital'}/plans/cancel.html`;

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error('portal error:', e);
    return res.status(500).json({ error: 'No se pudo crear la sesión del portal' });
  }
});

// --- DEBUG (opcionales) ---
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

router.get('/check-price', async (req, res) => {
  try {
    const id = req.query.id || process.env.PRICE_ID_CRECIMIENTO;
    const p = await (new (require('stripe'))(process.env.STRIPE_SECRET_KEY)).prices.retrieve(id);
    res.json({ ok: true, id: p.id, active: p.active, currency: p.currency, unit_amount: p.unit_amount, product: p.product, recurring: p.recurring || null });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message, type: e.type, code: e.code });
  }
});

module.exports = router;
