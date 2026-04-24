'use strict';

/**
 * personAnalyst.js — Fase 8
 *
 * Cross-session AI profile per Person. Receives all SessionPackets for a Person
 * plus their order history, produces a structured PersonAnalysis.
 *
 * Rate-limited: max 1 re-analysis per person per day (enforced by caller).
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || null;
const OPENROUTER_MODEL   = process.env.OPENROUTER_MODEL   || 'google/gemma-3-27b-it';
const OPENROUTER_BASE    = 'https://openrouter.ai/api/v1';

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildPrompt(person, packets, orders) {
  const sessionLines = packets.map((p, i) => {
    const ai = p.aiAnalysis || {};
    const kfTypes = Array.isArray(p.keyframes)
      ? [...new Set(p.keyframes.map(k => k.type))].join(', ')
      : 'none';
    return [
      `Session ${i + 1} (${new Date(p.startTs).toISOString().slice(0, 10)}):`,
      `  outcome=${p.outcome} duration=${Math.round(p.durationMs / 1000)}s`,
      `  archetype=${ai.archetype || '?'} confidence=${ai.confidence_score ?? '?'}`,
      `  keyframe_types=[${kfTypes}]`,
      `  organic_converter=${ai.organic_converter ?? false}`,
      ai.narrative ? `  narrative="${ai.narrative.slice(0, 200)}"` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const orderLines = orders.length
    ? orders.map(o =>
        `  ${new Date(o.platformCreatedAt || o.createdAt).toISOString().slice(0, 10)} — $${o.revenue} ${o.currency || 'MXN'} — channel=${o.attributedChannel || 'unknown'}`
      ).join('\n')
    : '  (no orders yet)';

  return `You are a behavioral analyst for an ecommerce platform.

PERSON PROFILE:
- Sessions analyzed: ${packets.length}
- Total orders: ${person.orderCount}
- Total spent: $${person.totalSpent}
- First seen: ${new Date(person.firstSeenAt).toISOString().slice(0, 10)}
- Last seen: ${new Date(person.lastSeenAt).toISOString().slice(0, 10)}

SESSION HISTORY:
${sessionLines}

ORDER HISTORY:
${orderLines}

Based on the full behavioral history above, produce a JSON object with exactly these fields:
{
  "tier": "vip|returning|new|at_risk",
  "behavior_summary": "2-3 sentence summary of this person's behavioral pattern across sessions",
  "conversion_probability": <float 0-1 — likelihood of converting in next 30 days>,
  "preferred_channel": "retargeting|email|organic|sms|none",
  "next_best_action": {
    "type": "retargeting|email|sms|none",
    "content": "<personalized message in Spanish, max 120 chars>",
    "priority": "high|medium|low",
    "timing_days": <int — days from now to send>
  },
  "retention_insight": "<1 sentence on retention risk or opportunity>",
  "ltv_estimate": <float — estimated lifetime value in MXN based on spend patterns>,
  "confidence": <float 0-1>
}

Respond ONLY with the JSON object, no markdown fences, no explanation.`;
}

// ── LLM call ───────────────────────────────────────────────────────────────────

async function callLLM(prompt) {
  if (!OPENROUTER_API_KEY) return null;
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://adray.ai',
      'X-Title': 'Adray BRI - Person Analyst',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 600,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in LLM response');
  return JSON.parse(match[0]);
}

// ── Deterministic fallback ─────────────────────────────────────────────────────

function deterministicProfile(person, packets, orders) {
  const tier = person.orderCount >= 5 ? 'vip'
    : person.orderCount >= 2 ? 'returning'
    : person.orderCount === 0 ? 'at_risk'
    : 'new';

  const archetypes = packets.map(p => p.aiAnalysis?.archetype).filter(Boolean);
  const dominant = archetypes.length
    ? archetypes.sort((a, b) =>
        archetypes.filter(x => x === b).length - archetypes.filter(x => x === a).length
      )[0]
    : null;

  return {
    tier,
    behavior_summary: `Visitor with ${person.sessionCount} sessions and ${person.orderCount} orders totaling $${person.totalSpent}. ${dominant ? `Most frequent archetype: ${dominant}.` : ''}`,
    conversion_probability: person.orderCount > 0 ? 0.4 : 0.15,
    preferred_channel: 'retargeting',
    next_best_action: {
      type: tier === 'at_risk' ? 'email' : 'retargeting',
      content: tier === 'vip' ? '¡Gracias por tu lealtad! Tenemos algo especial para ti.' : 'Vuelve y descubre nuevos productos.',
      priority: tier === 'at_risk' ? 'high' : 'medium',
      timing_days: 3,
    },
    retention_insight: tier === 'at_risk'
      ? 'No ha comprado — riesgo de perder este visitante sin intervención.'
      : `Comprador ${tier} con potencial de aumento de LTV.`,
    ltv_estimate: person.totalSpent * (tier === 'vip' ? 1.5 : tier === 'returning' ? 1.2 : 1.0),
    confidence: 0.5,
  };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Analyze a Person across all their sessions.
 *
 * @param {object} person   — Person row from DB
 * @param {object[]} packets — SessionPacket rows (with aiAnalysis + keyframes)
 * @param {object[]} orders  — Order rows for this person
 * @returns {Promise<object>} structured profile
 */
async function analyzePerson(person, packets, orders) {
  // Deterministic shortcut: not enough data for LLM
  if (packets.length === 0) return deterministicProfile(person, packets, orders);

  const prompt = buildPrompt(person, packets, orders);

  try {
    const result = await callLLM(prompt);
    if (result) return result;
  } catch (err) {
    console.warn('[personAnalyst] LLM failed, using fallback:', err.message);
  }

  return deterministicProfile(person, packets, orders);
}

module.exports = { analyzePerson };
