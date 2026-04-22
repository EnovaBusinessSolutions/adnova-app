'use strict';

/**
 * sessionAnalyst.js  — Fase 6
 *
 * Reads a SessionPacket and produces structured AI analysis:
 * archetype, organic_converter, exclude_from_retargeting, narrative,
 * next_best_action, retention_insight, predicted_ltv_multiplier.
 *
 * Key upgrade vs recordingNarrativeService: the LLM receives the full
 * keyframe timeline as compact text ("t=5s scroll_stop 40% | t=12s
 * product_hover Camisa $29"), not just aggregate signal counters.
 */

const OPENROUTER_API_KEY  = process.env.OPENROUTER_API_KEY  || null;
const OPENROUTER_MODEL    = process.env.OPENROUTER_MODEL    || 'google/gemma-3-27b-it';
const OPENROUTER_BASE     = 'https://openrouter.ai/api/v1';

const {
  ABANDON_ARCHETYPES,
  PURCHASE_ARCHETYPES,
  LTV_MULTIPLIERS,
  tierFromHistory,
  buildCustomerHistory,
} = require('./recordingNarrativeService');

// ─── Keyframe → compact text ──────────────────────────────────────────────────

function formatKeyframesForPrompt(keyframes) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return '(no keyframes)';
  return keyframes.slice(0, 35).map((kf) => {
    const t = `t=${kf.elapsed_seconds}s`;
    const i = kf.interaction || {};
    switch (kf.type) {
      case 'page_navigation':
        return `${t} page_nav→${kf.page_url || '?'}`;
      case 'scroll_stop': {
        const depth = kf.scroll_depth_percent ?? 0;
        return `${t} scroll_stop ${depth}% (${kf.duration_at_state_seconds}s)`;
      }
      case 'product_hover': {
        const p = i.product || {};
        const name  = p.name  || i.cursor_on_element || '?';
        const price = p.price ? ` $${p.price}` : '';
        return `${t} product_hover ${name}${price} (${i.hover_duration_seconds}s)`;
      }
      case 'rage_click':
        return `${t} rage_click ×${i.click_count} on ${i.element_id || '?'}`;
      case 'checkout_entry':
        return `${t} checkout_entry`;
      case 'checkout_hesitation':
        return `${t} checkout_hesitation ${i.hesitation_duration_seconds}s`;
      case 'tab_switch':
        return `${t} tab_switch ${i.direction}`;
      case 'form_interaction':
        return `${t} form_${i.interaction_type || 'interaction'} on ${i.element_id || '?'}`;
      case 'add_to_cart': {
        const val = i.cart_value ? ` (cart $${i.cart_value})` : '';
        return `${t} add_to_cart ${i.product_name || '?'}${val}`;
      }
      case 'cart_modification':
        return `${t} cart_remove`;
      case 'purchase':
        return `${t} purchase $${i.order_value ?? '?'}`;
      case 'session_end':
        return `${t} session_end (${i.end_reason || '?'})`;
      default:
        return `${t} ${kf.type}`;
    }
  }).join(' | ');
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(packet, customerHistory) {
  const isPurchase    = packet.outcome === 'PURCHASED';
  const signals       = packet.signals   || {};
  const src           = packet.trafficSource || {};
  const channel       = src.utm_source || src.utm_medium
    || (src.fbclid ? 'facebook_paid' : src.gclid ? 'google_paid' : 'organic');
  const tier          = tierFromHistory(customerHistory);
  const durationSecs  = Math.round((packet.durationMs || 0) / 1000);
  const keyframesText = formatKeyframesForPrompt(packet.keyframes);
  const archetypes    = isPurchase ? PURCHASE_ARCHETYPES : ABANDON_ARCHETYPES;

  return `You are an ecommerce behavioral analyst. Analyze this session and classify the user.

KEYFRAME TIMELINE:
${keyframesText}

SESSION METRICS:
- Outcome: ${packet.outcome}
- Duration: ${durationSecs}s
- Cart value at end: ${packet.cartValueAtEnd != null ? '$' + packet.cartValueAtEnd : 'unknown'}
- Device: ${packet.device?.type || 'unknown'}
- Channel: ${channel}
- Risk score: ${signals.riskScore ?? 0}/100
- Rage clicks: ${signals.rageClickCount ?? 0}
- Exit intents: ${signals.exitIntentCount ?? 0}
- Checkout hesitation: ${signals.totalHesitationMs ? Math.round(signals.totalHesitationMs / 1000) + 's' : '0s'}
- Abandonment pattern: ${signals.abandonmentPattern || 'unknown'}

CUSTOMER HISTORY:
- Tier: ${tier}
- Prior orders: ${customerHistory?.orderCount ?? 0}
- Total spent: $${customerHistory?.totalSpent ?? 0}
- Days since last order: ${customerHistory?.daysSinceLast ?? 'n/a'}

VALID ARCHETYPES: ${archetypes.join(', ')}

Rules:
- "organic_converter": true if this user would likely have converted WITHOUT paid retargeting (returning loyal, direct/organic channel, high intent signals).
- "exclude_from_retargeting": true if retargeting this user would waste budget (already converted, VIP, organic brand-loyalist).
- narrative must be past-tense, merchant-facing, in Spanish, 1-2 sentences.
- next_best_action.type must be one of: email | sms | retargeting | coupon | loyalty_invite | none

Respond ONLY with valid JSON (no markdown):
{
  "archetype": "<archetype>",
  "confidence_score": <0.0-1.0>,
  "organic_converter": <true|false>,
  "exclude_from_retargeting": <true|false>,
  "friction_signals": ["<signal>"],
  "narrative": "<Spanish 1-2 sentences>",
  "next_best_action": {
    "type": "<type>",
    "timing_days": <0-60>,
    "content": "<Spanish hint>",
    "priority": "low|medium|high"
  },
  "retention_insight": "<Spanish 1 sentence or null>"
}`;
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

async function callLLM(prompt) {
  if (!OPENROUTER_API_KEY) return null;
  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://adray.ai',
        'X-Title': 'Adray BRI - Session Analyst',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return JSON.parse(data?.choices?.[0]?.message?.content || 'null');
  } catch (err) {
    console.error('[sessionAnalyst] LLM failed:', err.message);
    return null;
  }
}

// ─── Deterministic shortcuts ──────────────────────────────────────────────────

function deterministicAnalysis(packet, customerHistory) {
  const signals    = packet.signals || {};
  const isPurchase = packet.outcome === 'PURCHASED';
  const hist       = customerHistory || {};
  const { rageClickCount = 0, riskScore = 0, abandonmentPattern } = signals;

  if (isPurchase && ((hist.orderCount || 0) >= 5 || (hist.totalSpent || 0) >= 5000)) {
    return {
      archetype: 'vip',
      confidence_score: 0.85,
      organic_converter: true,
      exclude_from_retargeting: true,
      friction_signals: [],
      narrative: `Cliente VIP con ${hist.orderCount || 0} compras previas completó otra compra.`,
      next_best_action: { type: 'loyalty_invite', timing_days: 2, content: 'Invita al programa de lealtad con beneficio exclusivo.', priority: 'high' },
      retention_insight: 'Cliente VIP — proteger con loyalty program.',
    };
  }

  if (!isPurchase && rageClickCount >= 5 && riskScore >= 60) {
    return {
      archetype: 'abandonment_risk',
      confidence_score: 0.8,
      organic_converter: false,
      exclude_from_retargeting: false,
      friction_signals: ['rage_clicks', 'ui_friction'],
      narrative: 'El usuario hizo múltiples clics frustrados — posible problema de UX.',
      next_best_action: { type: 'none', timing_days: 0, content: 'Priorizar fix técnico sobre recuperación.', priority: 'high' },
      retention_insight: 'Bug de UX bloqueando conversiones — fix urgente.',
    };
  }

  if (!isPurchase && abandonmentPattern === 'passive_browse' && riskScore < 20) {
    return {
      archetype: 'comparison_browser',
      confidence_score: 0.65,
      organic_converter: false,
      exclude_from_retargeting: false,
      friction_signals: [],
      narrative: 'El usuario navegó brevemente sin interactuar. Probablemente comparando opciones.',
      next_best_action: { type: 'retargeting', timing_days: 1, content: 'Retargeting dinámico con el producto visto.', priority: 'medium' },
      retention_insight: null,
    };
  }

  return null;
}

function fallbackAnalysis(packet, customerHistory) {
  const isPurchase = packet.outcome === 'PURCHASED';
  const tier = tierFromHistory(customerHistory);
  if (isPurchase) {
    const arch = tier === 'vip' ? 'vip' : tier === 'returning' ? 'returning_loyal' : 'new_convert';
    return {
      archetype: arch,
      confidence_score: 0.45,
      organic_converter: tier !== 'new',
      exclude_from_retargeting: tier === 'vip',
      friction_signals: [],
      narrative: 'Cliente completó la compra.',
      next_best_action: { type: 'email', timing_days: 3, content: 'Follow-up post-compra estándar.', priority: 'medium' },
      retention_insight: null,
    };
  }
  return {
    archetype: 'abandonment_risk',
    confidence_score: 0.4,
    organic_converter: false,
    exclude_from_retargeting: false,
    friction_signals: [],
    narrative: 'Sesión sin conversión.',
    next_best_action: { type: 'retargeting', timing_days: 1, content: 'Retargeting estándar.', priority: 'low' },
    retention_insight: null,
  };
}

// ─── Normalize LLM output ─────────────────────────────────────────────────────

function normalizeResult(raw, isPurchase, tier) {
  const validArchs = isPurchase ? PURCHASE_ARCHETYPES : ABANDON_ARCHETYPES;
  if (!validArchs.includes(raw.archetype)) raw.archetype = isPurchase ? 'new_convert' : 'abandonment_risk';
  raw.confidence_score         = Math.max(0, Math.min(1, parseFloat(raw.confidence_score) || 0.5));
  raw.organic_converter        = Boolean(raw.organic_converter);
  raw.exclude_from_retargeting = Boolean(raw.exclude_from_retargeting);
  if (!raw.next_best_action || typeof raw.next_best_action !== 'object') {
    raw.next_best_action = { type: 'none', timing_days: 0, content: '', priority: 'low' };
  } else {
    raw.next_best_action.timing_days = Math.max(0, Math.min(60, parseInt(raw.next_best_action.timing_days, 10) || 0));
    if (!['low','medium','high'].includes(raw.next_best_action.priority)) raw.next_best_action.priority = 'medium';
    if (!['email','sms','retargeting','coupon','loyalty_invite','none'].includes(raw.next_best_action.type)) raw.next_best_action.type = 'email';
  }
  return {
    ...raw,
    customer_tier: tier,
    predicted_ltv_multiplier: LTV_MULTIPLIERS[raw.archetype] || 1.0,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * @param {object} packet         — SessionPacket row from Prisma
 * @param {object} opts
 * @param {object} opts.customerHistory — from buildCustomerHistory(priorOrders)
 */
async function analyzeSession(packet, opts = {}) {
  const { customerHistory } = opts;
  const isPurchase = packet.outcome === 'PURCHASED';
  const tier = tierFromHistory(customerHistory);

  const deterministic = deterministicAnalysis(packet, customerHistory);
  if (deterministic) {
    return { ...deterministic, customer_tier: tier, predicted_ltv_multiplier: LTV_MULTIPLIERS[deterministic.archetype] || 1.0 };
  }

  const prompt = buildPrompt(packet, customerHistory);
  const llmResult = await callLLM(prompt);

  if (!llmResult) {
    const fb = fallbackAnalysis(packet, customerHistory);
    return { ...fb, customer_tier: tier, predicted_ltv_multiplier: LTV_MULTIPLIERS[fb.archetype] || 1.0 };
  }

  return normalizeResult(llmResult, isPurchase, tier);
}

module.exports = { analyzeSession, formatKeyframesForPrompt, buildCustomerHistory };
