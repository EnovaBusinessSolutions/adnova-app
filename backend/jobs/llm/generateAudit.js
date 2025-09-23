'use strict';
const OpenAI = require('openai');

// Soporta ambas vars por si en algún ambiente cambia el nombre
const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY;

const client = new OpenAI({
  apiKey: OPENAI_KEY,
});

// === Modelo recomendado ===
// - "gpt-4o-mini" es rápido y barato, con muy buen JSON.
// - Si quieres más músculo, cambia a "gpt-4o".
const MODEL = process.env.AUDIT_LLM_MODEL || 'gpt-4o-mini';

// === Esquema de salida esperado (validación ligera)
function validateAuditShape(obj) {
  if (!obj || typeof obj !== 'object') return 'root_not_object';
  if (!('issues' in obj) || !Array.isArray(obj.issues)) return 'issues_missing';
  if (!('summary' in obj) || typeof obj.summary !== 'string') return 'summary_missing';

  const okSeverity = new Set(['alta','media','baja']);
  const okArea = new Set(['setup','performance','creative','tracking','budget','bidding']);

  for (const it of obj.issues) {
    if (!it || typeof it !== 'object') return 'issue_not_object';
    if (typeof it.id !== 'string' || !it.id.trim()) return 'issue.id';
    if (!okArea.has(it.area)) return 'issue.area';
    if (!okSeverity.has(it.severity)) return 'issue.severity';
    if (typeof it.title !== 'string' || !it.title.trim()) return 'issue.title';
  }
  if ('actionCenter' in obj) {
    if (!Array.isArray(obj.actionCenter)) return 'actionCenter_not_array';
  }
  if ('topProducts' in obj && !Array.isArray(obj.topProducts)) return 'topProducts_not_array';

  return null; 
}

const BASE_INSTRUCTIONS = `
Eres un analista de performance senior. Devuelve SOLO JSON válido con esta forma exacta:

{
  "summary": "string",
  "issues": [
    {
      "id": "kebab-case-unico",
      "area": "setup|performance|creative|tracking|budget|bidding",
      "title": "string",
      "severity": "alta|media|baja",
      "evidence": "string",
      "metrics": { },
      "recommendation": "string",
      "estimatedImpact": "alto|medio|bajo",
      "blockers": ["string"],
      "links": [{"label":"string","url":"string"}]
    }
  ],
  "actionCenter": [ ...top 3 issues... ],
  "topProducts": []
}

Reglas:
- NO inventes datos. Usa estrictamente lo que venga en "inputSnapshot".
- Si faltan datos o permisos (p. ej. no hay customerId, no hay campañas), genera issues de "setup" con severidad "alta" y explicación.
- Las recomendaciones deben ser accionables y concretas (no genéricas).
- Usa "estimatedImpact" para priorizar (alto|medio|bajo).
- Responde SIEMPRE sólo un objeto JSON, sin texto extra.
`;

function buildTypeHints(type) {
  if (type === 'google') {
    return `
Contexto de Google Ads:
- inputSnapshot.kpis: { impressions, clicks, cost, cpc, cpa, cvr, roas, ... }
- inputSnapshot.series: [{ date, impressions, clicks, cost, conversions, conv_value }]
- inputSnapshot.currency, timeZone
Mejores prácticas: estructura de campañas, concordancias, negativos, presupuestos, conversiones válidas, ROAS/CPA.
`;
  }
  if (type === 'meta') {
    return `
Contexto de Meta Ads:
- inputSnapshot.kpis / por campaña
- inputSnapshot.pixelHealth, eventos, atribución
Mejores prácticas: estructura por objetivo, creatividades, públicos, frecuencia, eventos correctos.
`;
  }
  if (type === 'shopify') {
    return `
Contexto de Shopify:
- inputSnapshot.topProducts: [{ title, revenue, units }]
- inputSnapshot.kpis: AOV, repeatRate, refundRate, etc.
Mejores prácticas: mix de productos, pricing, bundles, campañas cruzadas.
`;
  }
  if (type === 'ga') {
    return `
Contexto de Google Analytics:
- inputSnapshot.kpis: sesiones, conversion rate, fuente/medio
- inputSnapshot.issues de tracking
`;
  }
  return '';
}

async function callLLM({ type, inputSnapshot }) {
  const messages = [
    { role: 'system', content: BASE_INSTRUCTIONS },
    {
      role: 'user',
      content:
        `Tipo de auditoría: ${type}\n` +
        buildTypeHints(type) +
        `\ninputSnapshot (JSON):\n` +
        JSON.stringify(inputSnapshot ?? {}, null, 2),
    },
  ];

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.2,
    response_format: { type: 'json_object' }, // fuerce JSON
  });

  const raw = resp.choices?.[0]?.message?.content || '{}';
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* luego reintentamos */ }
  return { raw, parsed };
}

function minimalHeuristic({ type, inputSnapshot }) {
  const issues = [];

  if (type === 'google') {
    const clicks = Number(inputSnapshot?.kpis?.clicks || 0);
    if (!clicks) {
      issues.push({
        id: 'sin_clicks_30d',
        area: 'performance',
        title: 'Sin clics en los últimos 30 días',
        severity: 'alta',
        evidence: 'clicks = 0',
        metrics: { clicks },
        recommendation: 'Revisa segmentación, pujas y keywords. Aumenta presupuesto +20% y prueba concordancias exactas + negativas.',
        estimatedImpact: 'alto',
        blockers: [],
        links: [{ label: 'Guía de estructura', url: 'https://support.google.com/google-ads/' }]
      });
    }
  } else if (type === 'meta') {
    issues.push({
      id: 'verificar_pixel_meta',
      area: 'tracking',
      title: 'Verifica el pixel y eventos de Meta',
      severity: 'media',
      evidence: 'No se encontró snapshot de pixelHealth',
      metrics: {},
      recommendation: 'Abre el Diagnóstico de Eventos y corrige warnings/errores. Asegura Purchase/InitiateCheckout/Lead.',
      estimatedImpact: 'medio',
      blockers: [],
      links: [{ label: 'Event Diagnostics', url: 'https://business.facebook.com/events_manager2/' }]
    });
  } else if (type === 'shopify') {
    const top = inputSnapshot?.topProducts || [];
    if (!top.length) {
      issues.push({
        id: 'sin_top_products',
        area: 'performance',
        title: 'No hay productos con ventas recientes',
        severity: 'media',
        evidence: 'topProducts[] vacío',
        metrics: {},
        recommendation: 'Revisa catálogo, precios y campañas de promoción. Considera bundles y descuento volumen.',
        estimatedImpact: 'medio',
        blockers: [],
        links: [{ label: 'Shopify Docs', url: 'https://help.shopify.com/' }]
      });
    }
  }

  return {
    summary: issues.length ? `Se detectaron ${issues.length} hallazgos prioritarios.` : 'Sin hallazgos críticos.',
    issues,
    actionCenter: issues.slice(0, 3),
    topProducts: inputSnapshot?.topProducts || []
  };
}

async function generateAudit({ type, inputSnapshot }) {
  // Seguridad básica
  if (!OPENAI_KEY) {
    // Sin clave: devolvemos heurística para no romper flujo
    return minimalHeuristic({ type, inputSnapshot });
  }

  // Intento 1
  let { raw, parsed } = await callLLM({ type, inputSnapshot });
  let err = validateAuditShape(parsed);

  // Reintento 2 (si vino mal)
  if (err) {
    const hint = `
El JSON recibido no cumple el esquema (${err}).
Corrige y devuelve SOLO un JSON válido con las llaves exactas.
`;
    const messages = [
      { role: 'system', content: BASE_INSTRUCTIONS },
      { role: 'user', content: `Tipo: ${type}\ninputSnapshot:\n${JSON.stringify(inputSnapshot ?? {}, null, 2)}` },
      { role: 'assistant', content: raw || '{}' },
      { role: 'user', content: hint }
    ];
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    const raw2 = resp.choices?.[0]?.message?.content || '{}';
    try { parsed = JSON.parse(raw2); } catch { parsed = null; }
    err = validateAuditShape(parsed);
  }

  // Si sigue mal, degradamos a heurística
  if (err) {
    return minimalHeuristic({ type, inputSnapshot });
  }

  // Asegurar campos opcionales
  parsed.actionCenter = Array.isArray(parsed.actionCenter)
    ? parsed.actionCenter.slice(0, 3)
    : (parsed.issues || []).slice(0, 3);
  parsed.topProducts = Array.isArray(parsed.topProducts) ? parsed.topProducts : [];
  return parsed;
}

 module.exports = generateAudit;
