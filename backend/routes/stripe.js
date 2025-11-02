// backend/routes/stripe.js
'use strict';

const express = require('express');
const router = express.Router();
const Stripe = require('stripe');

// ⬇️ Timbrado y envío del CFDI separados
const {
  emitirFactura,
  genCustomerPayload,
  enviarCfdiPorEmail,
} = require('../services/facturaService');

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

// Avisos informativos
if (!STRIPE_SECRET_KEY) console.warn('⚠️ Falta STRIPE_SECRET_KEY');
if (!STRIPE_WEBHOOK_SECRET) console.warn('⚠️ Falta STRIPE_WEBHOOK_SECRET');
['PRICE_ID_EMPRENDEDOR', 'PRICE_ID_CRECIMIENTO', 'PRICE_ID_PRO'].forEach((k) => {
  if (!process.env[k]) console.warn(`⚠️ Falta ${k}`);
});
if (!APP_URL) console.warn('⚠️ Falta APP_URL');
if (!SUCCESS_PATH || !CANCEL_PATH) console.warn('⚠️ Falta SUCCESS_PATH o CANCEL_PATH');

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Modelo User (opcional pero esperado)
let User = null;
try {
  User = require('../models/User');
} catch (_) {}

const PRICE_MAP = {
  emprendedor: PRICE_ID_EMPRENDEDOR,
  crecimiento: PRICE_ID_CRECIMIENTO,
  pro: PRICE_ID_PRO,
};

// price -> plan (para guardar en DB)
const PRICE_TO_PLAN = {
  [PRICE_ID_EMPRENDEDOR]: 'emprendedor',
  [PRICE_ID_CRECIMIENTO]: 'crecimiento',
  [PRICE_ID_PRO]: 'pro',
};

// ---------- helpers ----------
function successUrl() {
  return process.env.STRIPE_SUCCESS_URL
    ? process.env.STRIPE_SUCCESS_URL
    : APP_URL && SUCCESS_PATH
    ? `${APP_URL}${SUCCESS_PATH}`
    : 'https://ai.adnova.digital/plans/success';
}
function cancelUrl() {
  return process.env.STRIPE_CANCEL_URL
    ? process.env.STRIPE_CANCEL_URL
    : APP_URL && CANCEL_PATH
    ? `${APP_URL}${CANCEL_PATH}`
    : 'https://ai.adnova.digital/plans/cancel.html';
}
function ensureAuth(req, res, next) {
  try {
    if (req.isAuthenticated?.() && req.user?._id) return next();
  } catch {}
  return res.status(401).json({ error: 'Unauthorized' });
}

// =============== CHECKOUT ===============
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

        // Backfill de metadata.userId para mapear en webhooks
        try {
          const cust = await stripe.customers.retrieve(customerId);
          const needUpdate = !cust?.metadata?.userId || cust.metadata.userId !== userId;
          if (needUpdate) {
            await stripe.customers.update(customerId, {
              metadata: { ...(cust.metadata || {}), userId },
            });
          }
        } catch (e) {
          console.warn('No se pudo actualizar metadata del customer:', e.message);
        }
      } else {
        const customer = await stripe.customers.create({
          email: user.email || customer_email,
          metadata: { userId },
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
      cancel_url: cancelUrl(),

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
      return res
        .status(400)
        .json({ error: 'Este PRICE no es recurrente (one_time). Crea un price recurrente mensual.' });
    }
    if (priceObj.active === false) {
      return res.status(400).json({ error: 'El PRICE está inactivo en Stripe.' });
    }

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
      details: { message: err?.message, type: err?.type, code: err?.code },
    });
  }
});

// =============== WEBHOOK ===============
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
        // 1) Traer invoice completo de Stripe (con items, amount, etc.)
        const inv = event.data.object; // invoice skeleton
        const stripeInvoice = await stripe.invoices.retrieve(inv.id, {
          expand: ['lines.data.price.product', 'customer'],
        });

        // 2) Ubicar al user en tu DB por stripeCustomerId
        if (!User) try { User = require('../models/User'); } catch {}
        const custId = typeof stripeInvoice.customer === 'string'
          ? stripeInvoice.customer
          : stripeInvoice.customer?.id;
        const user = custId && User
          ? await User.findOne({ stripeCustomerId: custId }).lean()
          : null;
        if (!user) break;

        // 3) Cargar perfil fiscal (si no hay → público en general)
        let TaxProfile = null;
        try { TaxProfile = require('../models/TaxProfile'); } catch {}
        const taxProfile = TaxProfile
          ? await TaxProfile.findOne({ user: user._id }).lean()
          : null;

        // 4) Preparar payload para Facturapi
        const customerPayload = genCustomerPayload(taxProfile);
        const totalWithTax = (stripeInvoice.total || stripeInvoice.amount_paid || 0) / 100; // Stripe en centavos
        const conceptDesc = `Suscripción Adnova AI – ${stripeInvoice.lines?.data?.[0]?.price?.nickname || 'Plan'}`;
        const cfdiUse = taxProfile?.cfdiUse || process.env.FACTURAPI_DEFAULT_USE || 'G03';

        // 5) Timbrar primero (sin metadata / sin email)
        try {
          const cfdi = await emitirFactura({
            customer: customerPayload,
            description: conceptDesc,
            totalWithTax,
            cfdiUse,
          });

          console.log('✅ CFDI timbrado', cfdi.uuid, 'total:', totalWithTax);

          // 6) Enviar por email de forma separada (no rompe el webhook si falla)
          const destinatario = customerPayload.email || user.email;
          if (destinatario) {
            await enviarCfdiPorEmail(cfdi.id, destinatario);
          }

          // (Opcional) Persistir folio/ligas en tu DB
          await User.findByIdAndUpdate(user._id, {
            $set: {
              'subscription.lastCfdiId': cfdi.id,
              'subscription.lastCfdiTotal': totalWithTax,
              'subscription.lastStripeInvoice': stripeInvoice.id,
            },
          }).exec();
        } catch (e) {
          console.error('❌ Timbrado Facturapi falló:', e?.response?.data || e.message);
        }
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

// =============== SYNC (pull desde Stripe) ===============
router.post('/sync', ensureAuth, async (req, res) => {
  try {
    if (!User) return res.status(500).json({ ok: false, error: 'Modelo User no disponible' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    if (!user.stripeCustomerId) {
      return res.status(400).json({ ok: false, error: 'Usuario sin stripeCustomerId' });
    }

    // Asegura metadata.userId en el customer (backfill silencioso)
    try {
      const cust = await stripe.customers.retrieve(user.stripeCustomerId);
      if (!cust?.metadata?.userId || cust.metadata.userId !== String(user._id)) {
        await stripe.customers.update(user.stripeCustomerId, {
          metadata: { ...(cust.metadata || {}), userId: String(user._id) },
        });
      }
    } catch (e) {
      console.warn('sync: no pude backfillear metadata.userId:', e.message);
    }

    // Trae suscripciones
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'all',
      limit: 5,
    });

    if (!subs?.data?.length) {
      await User.findByIdAndUpdate(user._id, {
        $set: {
          plan: 'gratis',
          'subscription.status': 'canceled',
          'subscription.plan': 'gratis',
          'subscription.priceId': null,
          'subscription.currentPeriodEnd': null,
          'subscription.cancel_at_period_end': false,
        },
      }).exec();
      return res.json({ ok: true, updated: true, reason: 'no-subscriptions' });
    }

    const sub = subs.data[0];

    const status = (sub.status || '').toLowerCase();
    const priceId = sub.items?.data?.[0]?.price?.id || null;
    const mappedPlan = priceId ? PRICE_TO_PLAN[priceId] : null;

    const update = {
      'subscription.id': sub.id,
      'subscription.status': status,
      'subscription.priceId': priceId,
      'subscription.cancel_at_period_end': !!sub.cancel_at_period_end,
      'subscription.currentPeriodEnd': sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
    };

    if (['canceled', 'incomplete_expired', 'unpaid'].includes(status)) {
      update['plan'] = 'gratis';
      update['subscription.plan'] = 'gratis';
    } else if (['active', 'trialing', 'past_due'].includes(status) && mappedPlan) {
      update['plan'] = mappedPlan;
      update['subscription.plan'] = mappedPlan;
    }

    await User.findByIdAndUpdate(user._id, { $set: update }).exec();

    return res.json({
      ok: true,
      updated: true,
      snapshot: {
        status,
        priceId,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        currentPeriodEnd: sub.current_period_end || null,
        plan: update.plan || user.plan,
      },
    });
  } catch (e) {
    console.error('sync error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- DEBUG (opcionales) ---
router.get('/health', (req, res) => {
  res.json({
    mode: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_')
      ? 'live'
      : (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')
      ? 'test'
      : 'unknown',
    hasKey: !!process.env.STRIPE_SECRET_KEY,
    prices: {
      emprendedor: !!process.env.PRICE_ID_EMPRENDEDOR,
      crecimiento: !!process.env.PRICE_ID_CRECIMIENTO,
      pro: !!process.env.PRICE_ID_PRO,
    },
    urls: {
      app: process.env.APP_URL || null,
      success:
        process.env.STRIPE_SUCCESS_URL ||
        (process.env.APP_URL && process.env.SUCCESS_PATH ? `${process.env.APP_URL}${process.env.SUCCESS_PATH}` : null),
      cancel:
        process.env.STRIPE_CANCEL_URL ||
        (process.env.APP_URL && process.env.CANCEL_PATH ? `${process.env.APP_URL}${process.env.CANCEL_PATH}` : null),
    },
  });
});

router.get('/check-price', async (req, res) => {
  try {
    const id = req.query.id || process.env.PRICE_ID_CRECIMIENTO;
    const p = await new (require('stripe'))(process.env.STRIPE_SECRET_KEY).prices.retrieve(id);
    res.json({
      ok: true,
      id: p.id,
      active: p.active,
      currency: p.currency,
      unit_amount: p.unit_amount,
      product: p.product,
      recurring: p.recurring || null,
    });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message, type: e.type, code: e.code });
  }
});

module.exports = router;
