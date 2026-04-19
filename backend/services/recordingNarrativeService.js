'use strict';

/**
 * recordingNarrativeService.js
 * Generates LLM-powered archetype + narrative + next best action
 * for session recordings. Branches on outcome:
 *
 *   - ABANDONED / STILL_BROWSING → abandonment recovery recommendation
 *   - PURCHASED                  → re-engagement / retention recommendation
 *
 * Output (unified shape, cached by /insights route):
 * {
 *   archetype:            string,
 *   confidence_score:     number 0..1,
 *   friction_signals:     string[],
 *   narrative:            string (Spanish, 1-2 sentences),
 *   recommended_action:   string (Spanish, single sentence — back-compat for old UI),
 *   next_best_action: {                          // richer structured action
 *     type: 'email' | 'sms' | 'retargeting' | 'coupon' | 'loyalty_invite' | 'none',
 *     timing_days: number,
 *     content: string,
 *     priority: 'low' | 'medium' | 'high'
 *   },
 *   customer_tier:        'new' | 'returning' | 'vip' | null,
 *   retention_insight:    string | null,
 *   predicted_ltv_multiplier: number
 * }
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || null;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const ABANDON_ARCHETYPES = [
  'systematic_gift_shopper',
  'focused_researcher',
  'impulse_converter',
  'comparison_browser',
  'price_sensitive_browser',
  'basket_builder',
  'new_visitor',
  'returning_loyal',
  'abandonment_risk',
];

const PURCHASE_ARCHETYPES = [
  'new_convert',
  'impulse_buyer',
  'hesitant_convert',
  'price_sensitive_converter',
  'returning_loyal',
  'vip',
  'gift_shopper',
  'upsell_candidate',
];

const LTV_MULTIPLIERS = {
  returning_loyal: 3.5,
  impulse_converter: 2.0,
  focused_researcher: 1.8,
  systematic_gift_shopper: 1.6,
  basket_builder: 1.4,
  comparison_browser: 1.2,
  price_sensitive_browser: 0.9,
  new_visitor: 1.0,
  abandonment_risk: 0.5,
  vip: 4.0,
  impulse_buyer: 1.8,
  hesitant_convert: 1.3,
  price_sensitive_converter: 1.1,
  new_convert: 1.5,
  gift_shopper: 0.8,
  upsell_candidate: 2.2,
};

function formatMoney(v) {
  if (v === null || v === undefined) return '$?';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function tierFromHistory(history = {}) {
  const count = history.orderCount || 0;
  const spent = history.totalSpent || 0;
  if (count >= 5 || spent >= 5000) return 'vip';
  if (count >= 2) return 'returning';
  return 'new';
}

/**
 * Deterministic classification for clear-cut ABANDONED patterns.
 */
function deterministicAbandonClassify(signals) {
  const { abandonmentPattern, riskScore = 0, shippingShockLikelihood = 0, rageClickCount = 0 } = signals;

  if (abandonmentPattern === 'passive_browse' && riskScore < 20) {
    return {
      archetype: 'comparison_browser',
      confidence_score: 0.65,
      friction_signals: [],
      narrative: 'El usuario navegó brevemente y salió sin interactuar. Probablemente está comparando precios o productos en varias tiendas.',
      recommended_action: 'Activa retargeting dinámico con el producto visto. Considera un banner de urgencia o envío gratis temporal.',
      next_best_action: { type: 'retargeting', timing_days: 1, content: 'Retargeting dinámico con el producto visto + urgencia.', priority: 'medium' },
    };
  }
  if (rageClickCount >= 5 && riskScore >= 60) {
    return {
      archetype: 'abandonment_risk',
      confidence_score: 0.8,
      friction_signals: ['rage_clicks', 'ui_friction'],
      narrative: 'El usuario hizo múltiples clics frustrados — probablemente un botón o elemento no respondía. Problema de UX crítico.',
      recommended_action: 'Revisa el elemento con más clics en esta sesión. Es posible que un botón esté deshabilitado o no responda en mobile.',
      next_best_action: { type: 'none', timing_days: 0, content: 'Priorizar fix técnico sobre recuperación del usuario.', priority: 'high' },
    };
  }
  if (shippingShockLikelihood > 0.8 && riskScore >= 50) {
    return {
      archetype: 'price_sensitive_browser',
      confidence_score: 0.75,
      friction_signals: ['shipping_shock', 'hesitation_at_total'],
      narrative: 'El usuario llegó al resumen de pedido, se detuvo en el precio de envío y abandonó. Shipping shock clásico.',
      recommended_action: 'Muestra el costo de envío antes del checkout. Considera envío gratis para pedidos mayores a cierto monto.',
      next_best_action: { type: 'email', timing_days: 1, content: 'Email con código de envío gratis válido 48h.', priority: 'high' },
    };
  }
  return null;
}

/**
 * Deterministic classification for clear-cut PURCHASED patterns
 * (avoids LLM cost when the re-engagement action is obvious).
 */
function deterministicPurchaseClassify(signals, orderContext, customerHistory) {
  const hist = customerHistory || {};

  if ((hist.orderCount || 0) >= 5 || (hist.totalSpent || 0) >= 5000) {
    return {
      archetype: 'vip',
      confidence_score: 0.85,
      friction_signals: [],
      narrative: `Cliente VIP con ${hist.orderCount || 0} compras previas y ${formatMoney(hist.totalSpent)} de gasto histórico.`,
      recommended_action: 'Invita al cliente a un programa de lealtad o early-access a nuevos productos.',
      next_best_action: {
        type: 'loyalty_invite',
        timing_days: 2,
        content: 'Invítalo al programa de lealtad con beneficio exclusivo (early access, descuento permanente o soporte priority).',
        priority: 'high',
      },
      retention_insight: 'Cliente VIP comprobado — protégelo con un programa de lealtad antes de que la competencia lo contacte.',
    };
  }

  const hesitationMs = signals.totalHesitationMs || 0;
  const rageClicks = signals.rageClickCount || 0;
  const formAbandon = signals.formAbandonCount || 0;
  const totalFriction = rageClicks + formAbandon + (hesitationMs > 20000 ? 1 : 0);

  if ((hist.orderCount || 0) <= 1 && totalFriction === 0 && hesitationMs < 5000) {
    return {
      archetype: 'impulse_buyer',
      confidence_score: 0.7,
      friction_signals: [],
      narrative: 'Compra rápida y sin fricción — comprador impulsivo.',
      recommended_action: 'Envía cross-sell de producto complementario dentro de 48h mientras la compra está fresca.',
      next_best_action: {
        type: 'email',
        timing_days: 2,
        content: 'Email con producto complementario basado en la categoría comprada. Ventana corta para capitalizar el impulso.',
        priority: 'medium',
      },
      retention_insight: 'Los impulse buyers no planean recompra — sí responden a recordatorios tempranos con productos relacionados.',
    };
  }
  return null;
}

function buildAbandonPrompt({ signals, cartValue, attributedChannel, sessionDurationMs }) {
  return `You are an ecommerce abandonment analyst. Analyze this cart session and classify the user archetype.

SESSION DATA:
- Cart value: $${cartValue || 'unknown'}
- Session duration: ${Math.round((sessionDurationMs || 0) / 1000)}s
- Attributed channel: ${attributedChannel || 'unknown'}
- Abandonment pattern: ${signals.abandonmentPattern || 'unknown'}
- Risk score: ${signals.riskScore || 0}/100
- Rage clicks: ${signals.rageClickCount || 0}
- Exit intents: ${signals.exitIntentCount || 0}
- Form fields abandoned: ${signals.formAbandonCount || 0}
- Shipping shock likelihood: ${((signals.shippingShockLikelihood || 0) * 100).toFixed(0)}%
- Total hesitation time: ${Math.round((signals.totalHesitationMs || 0) / 1000)}s

VALID ARCHETYPES: ${ABANDON_ARCHETYPES.join(', ')}

Respond ONLY with valid JSON (no markdown):
{
  "archetype": "<one of the valid archetypes>",
  "confidence_score": <0.0 to 1.0>,
  "friction_signals": ["<signal1>", "<signal2>"],
  "narrative": "<1-2 sentence merchant-facing explanation in Spanish>",
  "recommended_action": "<specific actionable recommendation in Spanish>",
  "next_best_action": {
    "type": "email" | "sms" | "retargeting" | "coupon" | "none",
    "timing_days": <integer 0-30>,
    "content": "<Spanish 1-sentence hint>",
    "priority": "low" | "medium" | "high"
  }
}`;
}

function buildPurchasePrompt({ signals, orderContext, customerHistory, attributedChannel, sessionDurationMs }) {
  const tier = tierFromHistory(customerHistory);
  const daysSinceLast = customerHistory?.daysSinceLast;
  const prevOrders = customerHistory?.orderCount || 0;
  const topProducts = (orderContext?.products || []).slice(0, 5).map((p) => p.name || p.title).filter(Boolean).join(', ') || 'unknown';
  const categories = (orderContext?.categories || []).slice(0, 3).join(', ') || 'unknown';

  return `You are an ecommerce retention strategist. A customer just completed a purchase. Your job is to recommend the single best re-engagement action to maximize repeat purchase probability — NOT recovery of an abandonment.

PURCHASE:
- Revenue: ${formatMoney(orderContext?.revenue)}
- Products: ${topProducts}
- Categories: ${categories}
- Discount used: ${orderContext?.discountTotal ? formatMoney(orderContext.discountTotal) : 'none'}
- Currency: ${orderContext?.currency || 'MXN'}
- Attributed channel: ${attributedChannel || 'unknown'}

CUSTOMER HISTORY (before this order):
- Tier: ${tier}
- Previous orders: ${prevOrders}
- Total spent historically: ${formatMoney(customerHistory?.totalSpent)}
- Avg order value: ${formatMoney(customerHistory?.avgAov)}
- Days since first purchase: ${customerHistory?.daysSinceFirst ?? 'n/a'}
- Days since previous purchase: ${daysSinceLast ?? 'n/a'}

SESSION BEHAVIOR (of THIS purchase):
- Session duration: ${Math.round((sessionDurationMs || 0) / 1000)}s
- Device: ${signals.deviceType || 'unknown'}
- Rage clicks: ${signals.rageClickCount || 0} (friction BUT converted)
- Exit intents: ${signals.exitIntentCount || 0}
- Form abandons before completing: ${signals.formAbandonCount || 0}
- Total hesitation: ${Math.round((signals.totalHesitationMs || 0) / 1000)}s
- Max hesitation zone: ${signals.maxHesitationMs ? Math.round(signals.maxHesitationMs/1000) + 's' : 'n/a'}
- Shipping shock signals: ${((signals.shippingShockLikelihood || 0) * 100).toFixed(0)}%
- Scroll depth: ${signals.maxScrollDepthPct ?? 'n/a'}%

VALID ARCHETYPES: ${PURCHASE_ARCHETYPES.join(', ')}

Rules:
1. The narrative explains what HAPPENED (past tense). DO NOT recommend abandonment recovery — the user already bought.
2. "retention_insight" is the single most important thing a merchant should remember about this customer.
3. "next_best_action" must be concrete: channel + specific timing + content hint + priority.
   - VIP/returning_loyal → loyalty_invite or early-access.
   - hesitant_convert → email addressing the specific friction ("vimos que dudaste en envío — tu próxima compra tiene envío gratis").
   - impulse_buyer → cross-sell email in 2-3 days.
   - price_sensitive_converter → coupon for next purchase with minimum threshold.
   - new_convert → welcome flow + product education in 3-5 days.
4. timing_days: when to SEND the action (0 = inmediato, 3 = en 3 días, 14 = en 2 semanas).

Respond ONLY with valid JSON (no markdown):
{
  "archetype": "<one of the valid archetypes>",
  "confidence_score": <0.0 to 1.0>,
  "friction_signals": ["<friction that almost blocked but didn't>"],
  "narrative": "<1-2 sentences Spanish, past tense, about what happened in this purchase>",
  "recommended_action": "<single-sentence Spanish action, concise>",
  "next_best_action": {
    "type": "email" | "sms" | "retargeting" | "coupon" | "loyalty_invite" | "none",
    "timing_days": <integer 0-60>,
    "content": "<Spanish specific content suggestion, 1-2 sentences>",
    "priority": "low" | "medium" | "high"
  },
  "retention_insight": "<1 sentence Spanish, key takeaway for retention>"
}`;
}

async function callLLM(prompt) {
  if (!OPENROUTER_API_KEY) {
    console.warn('[recordingNarrativeService] OPENROUTER_API_KEY not set — skipping LLM');
    return null;
  }
  try {
    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://adray.ai',
        'X-Title': 'Adray BRI — Behavioral Revenue Intelligence',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return JSON.parse(content);
  } catch (err) {
    console.error('[recordingNarrativeService] LLM call failed:', err.message);
    return null;
  }
}

function fallbackPurchaseNarrative(signals, orderContext, customerHistory) {
  const tier = tierFromHistory(customerHistory);
  const hesitationMs = signals.totalHesitationMs || 0;
  const shippingShock = (signals.shippingShockLikelihood || 0) > 0.5;

  if (tier === 'vip') {
    return {
      archetype: 'vip',
      confidence_score: 0.5,
      friction_signals: [],
      narrative: 'Cliente VIP completó otra compra sin fricciones mayores.',
      recommended_action: 'Ofrécele acceso early a nuevos productos o un programa de lealtad.',
      next_best_action: { type: 'loyalty_invite', timing_days: 2, content: 'Invítalo al programa de lealtad con beneficios exclusivos.', priority: 'high' },
      retention_insight: 'Cliente VIP — proteger con loyalty program.',
    };
  }
  if (shippingShock || hesitationMs > 15000) {
    return {
      archetype: 'hesitant_convert',
      confidence_score: 0.5,
      friction_signals: shippingShock ? ['shipping_shock_overcome'] : ['hesitation_overcome'],
      narrative: 'El cliente dudó durante la compra pero terminó comprando. Hay fricción residual por resolver.',
      recommended_action: 'Email en 5 días ofreciendo envío gratis o descuento en la próxima compra para eliminar la fricción.',
      next_best_action: { type: 'email', timing_days: 5, content: 'Cupón de envío gratis o 10% off referenciando el producto comprado.', priority: 'medium' },
      retention_insight: 'Esta compra casi se pierde por fricción — resolverla sube tasa de recompra.',
    };
  }
  const daysSinceLast = customerHistory?.daysSinceLast;
  if (tier === 'returning' && daysSinceLast && daysSinceLast < 30) {
    return {
      archetype: 'returning_loyal',
      confidence_score: 0.55,
      friction_signals: [],
      narrative: 'Cliente recurrente con cadencia saludable de compra.',
      recommended_action: 'Refuerza la relación con contenido de valor y un cross-sell sutil en 2 semanas.',
      next_best_action: { type: 'email', timing_days: 14, content: 'Newsletter + cross-sell de producto complementario, sin cupón (valora producto más que precio).', priority: 'medium' },
      retention_insight: 'Customer en cadencia natural — no sobre-descontar, preservar margen.',
    };
  }
  return {
    archetype: 'new_convert',
    confidence_score: 0.45,
    friction_signals: [],
    narrative: 'Cliente nuevo completó su primera compra con patrón estándar.',
    recommended_action: 'Envía un flujo de welcome + educación del producto en 3-5 días.',
    next_best_action: { type: 'email', timing_days: 3, content: 'Welcome sequence + incentivo para 2a compra (envío gratis o 10% off).', priority: 'medium' },
    retention_insight: 'Primera compra es la más cara — invertir en welcome flow sube 2nd order rate.',
  };
}

/**
 * Main entry point.
 */
async function generateNarrative(params) {
  const {
    signals = {}, cartValue, attributedChannel, sessionDurationMs,
    outcome, orderContext, customerHistory,
  } = params;

  const isPurchase = outcome === 'PURCHASED';
  const tier = tierFromHistory(customerHistory);

  // 1. Deterministic shortcut
  const deterministic = isPurchase
    ? deterministicPurchaseClassify(signals, orderContext, customerHistory)
    : deterministicAbandonClassify(signals);

  if (deterministic) {
    return {
      ...deterministic,
      customer_tier: isPurchase ? tier : null,
      retention_insight: deterministic.retention_insight || null,
      predicted_ltv_multiplier: LTV_MULTIPLIERS[deterministic.archetype] || 1.0,
    };
  }

  // 2. LLM call
  const prompt = isPurchase
    ? buildPurchasePrompt({ signals, orderContext, customerHistory, attributedChannel, sessionDurationMs })
    : buildAbandonPrompt({ signals, cartValue, attributedChannel, sessionDurationMs });

  const llmResult = await callLLM(prompt);

  if (!llmResult) {
    if (isPurchase) {
      const fb = fallbackPurchaseNarrative(signals, orderContext, customerHistory);
      return { ...fb, customer_tier: tier, predicted_ltv_multiplier: LTV_MULTIPLIERS[fb.archetype] || 1.0 };
    }
    return {
      archetype: 'abandonment_risk',
      confidence_score: 0.4,
      friction_signals: [signals.abandonmentPattern || 'unknown'],
      narrative: 'Sesión con señales mixtas de abandono. Se requiere revisión manual.',
      recommended_action: 'Revisa la grabación de sesión para identificar el punto de fricción.',
      next_best_action: { type: 'none', timing_days: 0, content: 'Inspección manual recomendada.', priority: 'low' },
      customer_tier: null,
      retention_insight: null,
      predicted_ltv_multiplier: LTV_MULTIPLIERS.abandonment_risk,
    };
  }

  // 3. Validate + normalize
  const validArchs = isPurchase ? PURCHASE_ARCHETYPES : ABANDON_ARCHETYPES;
  if (!validArchs.includes(llmResult.archetype)) {
    llmResult.archetype = isPurchase ? 'new_convert' : 'abandonment_risk';
  }
  llmResult.confidence_score = Math.max(0, Math.min(1, parseFloat(llmResult.confidence_score) || 0.5));
  if (!llmResult.next_best_action || typeof llmResult.next_best_action !== 'object') {
    llmResult.next_best_action = { type: 'none', timing_days: 0, content: '', priority: 'low' };
  } else {
    llmResult.next_best_action.timing_days = Math.max(0, Math.min(60, parseInt(llmResult.next_best_action.timing_days, 10) || 0));
    if (!['low','medium','high'].includes(llmResult.next_best_action.priority)) llmResult.next_best_action.priority = 'medium';
    if (!['email','sms','retargeting','coupon','loyalty_invite','none'].includes(llmResult.next_best_action.type)) llmResult.next_best_action.type = 'email';
  }

  return {
    ...llmResult,
    customer_tier: isPurchase ? tier : null,
    retention_insight: llmResult.retention_insight || null,
    predicted_ltv_multiplier: LTV_MULTIPLIERS[llmResult.archetype] || 1.0,
  };
}

/**
 * Build customer history from prior orders. Excludes the current order.
 */
function buildCustomerHistory(priorOrders = [], currentOrderAt = null) {
  if (!Array.isArray(priorOrders) || priorOrders.length === 0) {
    return { orderCount: 0, totalSpent: 0, avgAov: 0, daysSinceFirst: null, daysSinceLast: null };
  }
  const revenues = priorOrders.map((o) => Number(o.revenue) || 0);
  const totalSpent = revenues.reduce((a, b) => a + b, 0);
  const avgAov = totalSpent / priorOrders.length;
  const dates = priorOrders
    .map((o) => o.platformCreatedAt || o.createdAt)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .sort((a, b) => a - b);
  const now = currentOrderAt ? new Date(currentOrderAt).getTime() : Date.now();
  const daysSinceFirst = dates.length ? Math.round((now - dates[0]) / (1000 * 60 * 60 * 24)) : null;
  const daysSinceLast  = dates.length ? Math.round((now - dates[dates.length - 1]) / (1000 * 60 * 60 * 24)) : null;
  return { orderCount: priorOrders.length, totalSpent, avgAov, daysSinceFirst, daysSinceLast };
}

function buildOrderContext(order) {
  if (!order) return null;
  const items = Array.isArray(order.lineItems) ? order.lineItems : [];
  const products = items.map((i) => ({ name: i.name || i.title, qty: i.qty || i.quantity || 1 }));
  const categories = Array.from(new Set(items.flatMap((i) => i.categories || i.category || []).filter(Boolean)));
  return {
    revenue: Number(order.revenue) || 0,
    currency: order.currency || 'MXN',
    discountTotal: Number(order.discountTotal) || 0,
    products,
    categories,
  };
}

// Back-compat: keep ARCHETYPES export used elsewhere (union of both)
const ARCHETYPES = Array.from(new Set([...ABANDON_ARCHETYPES, ...PURCHASE_ARCHETYPES]));

module.exports = {
  generateNarrative,
  buildCustomerHistory,
  buildOrderContext,
  tierFromHistory,
  ABANDON_ARCHETYPES,
  PURCHASE_ARCHETYPES,
  ARCHETYPES,
  LTV_MULTIPLIERS,
};
