'use strict';

/**
 * recordingNarrativeService.js
 * Generates LLM-powered abandonment archetypes and prescriptive narratives
 * using Gemma (or any OpenRouter model) for sessions with riskScore >= 60.
 *
 * 95/5 rule: Only call LLM when riskScore >= 60 or signals are ambiguous.
 * Clear-cut patterns (passive_browse, riskScore < 20) are classified deterministically.
 *
 * Output shape (stored in SessionRecording.behavioralSignals):
 * {
 *   archetype: string,           // one of 9 archetypes
 *   confidence_score: number,    // 0.0–1.0
 *   friction_signals: string[],  // e.g. ["shipping_shock", "hesitation_at_total"]
 *   narrative: string,           // plain-language merchant recommendation (Spanish)
 *   recommended_action: string,  // specific intervention suggestion
 * }
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || null;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const ARCHETYPES = [
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
};

/**
 * Deterministic fallback for clear-cut patterns (no LLM needed).
 * @param {object} signals
 * @returns {object|null} narrative object or null (use LLM)
 */
function deterministicClassify(signals) {
  const { abandonmentPattern, riskScore, shippingShockLikelihood, rageClickCount, formAbandonCount, totalDurationMs } = signals;

  if (abandonmentPattern === 'passive_browse' && riskScore < 20) {
    return {
      archetype: 'comparison_browser',
      confidence_score: 0.65,
      friction_signals: [],
      narrative: 'El usuario navegó brevemente y salió sin interactuar. Probablemente está comparando precios o productos en varias tiendas.',
      recommended_action: 'Activa retargeting dinámico con el producto visto. Considera un banner de urgencia o envío gratis temporal.',
    };
  }

  if (rageClickCount >= 5 && riskScore >= 60) {
    return {
      archetype: 'abandonment_risk',
      confidence_score: 0.80,
      friction_signals: ['rage_clicks', 'ui_friction'],
      narrative: 'El usuario hizo múltiples clics frustrados — probablemente un botón o elemento no respondía. Problema de UX crítico.',
      recommended_action: 'Revisa el elemento con más clics en esta sesión. Es posible que un botón esté deshabilitado o no responda en mobile.',
    };
  }

  if (shippingShockLikelihood > 0.8 && riskScore >= 50) {
    return {
      archetype: 'price_sensitive_browser',
      confidence_score: 0.75,
      friction_signals: ['shipping_shock', 'hesitation_at_total'],
      narrative: 'El usuario llegó al resumen de pedido, se detuvo en el precio de envío y abandonó. Shipping shock clásico.',
      recommended_action: 'Muestra el costo de envío antes del checkout. Considera envío gratis para pedidos mayores a cierto monto.',
    };
  }

  return null; // Use LLM
}

/**
 * Call OpenRouter API for archetype classification + narrative.
 * @param {object} params
 * @returns {Promise<object>}
 */
async function callLLM({ signals, cartValue, attributedChannel, sessionDurationMs }) {
  if (!OPENROUTER_API_KEY) {
    console.warn('[recordingNarrativeService] OPENROUTER_API_KEY not set — skipping LLM');
    return null;
  }

  const prompt = `You are an ecommerce abandonment analyst. Analyze this cart session and classify the user archetype.

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

VALID ARCHETYPES: ${ARCHETYPES.join(', ')}

Respond ONLY with valid JSON in this exact format (no markdown, no explanation):
{
  "archetype": "<one of the valid archetypes>",
  "confidence_score": <0.0 to 1.0>,
  "friction_signals": ["<signal1>", "<signal2>"],
  "narrative": "<1-2 sentence merchant-facing explanation in Spanish>",
  "recommended_action": "<specific actionable recommendation in Spanish>"
}`;

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
        max_tokens: 400,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);

    // Validate archetype
    if (!ARCHETYPES.includes(parsed.archetype)) {
      parsed.archetype = 'abandonment_risk';
    }
    // Validate confidence
    parsed.confidence_score = Math.max(0, Math.min(1, parseFloat(parsed.confidence_score) || 0.5));

    return parsed;
  } catch (err) {
    console.error('[recordingNarrativeService] LLM call failed:', err.message);
    return null;
  }
}

/**
 * Main entry point: generate narrative for a session.
 * Uses deterministic classification first (95% of cases), LLM for ambiguous ones.
 * @param {object} params
 * @returns {Promise<object|null>}
 */
async function generateNarrative(params) {
  const { signals = {}, cartValue, attributedChannel, sessionDurationMs } = params;

  // 1. Try deterministic first (no cost, no latency)
  const deterministic = deterministicClassify(signals);
  if (deterministic) {
    const archetype = deterministic.archetype;
    return {
      ...deterministic,
      predictedLtvMultiplier: LTV_MULTIPLIERS[archetype] || 1.0,
    };
  }

  // 2. Call LLM for ambiguous/high-risk sessions
  const llmResult = await callLLM({ signals, cartValue, attributedChannel, sessionDurationMs });

  if (!llmResult) {
    // Fallback if LLM fails
    return {
      archetype: 'abandonment_risk',
      confidence_score: 0.4,
      friction_signals: [signals.abandonmentPattern || 'unknown'],
      narrative: 'Sesión con señales mixtas de abandono. Se requiere revisión manual.',
      recommended_action: 'Revisa la grabación de sesión para identificar el punto de fricción.',
      predictedLtvMultiplier: LTV_MULTIPLIERS.abandonment_risk,
    };
  }

  return {
    ...llmResult,
    predictedLtvMultiplier: LTV_MULTIPLIERS[llmResult.archetype] || 1.0,
  };
}

module.exports = { generateNarrative, ARCHETYPES, LTV_MULTIPLIERS };
