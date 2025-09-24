// backend/jobs/llm/generateAudit.js
'use strict';

/**
 * generateAudit({ type, inputSnapshot })
 * Devuelve: { summary, issues[], actionCenter[], topProducts[] }
 *
 * - "type": 'google' | 'meta' | 'shopify' (shopify: placeholder mínimo)
 * - "inputSnapshot": objeto consistente devuelto por los colectores
 *
 * Notas:
 * - No inventa métricas. Todo cálculo usa inputSnapshot.
 * - Si existe OPENAI_API_KEY, usa IA para pulir el resumen/texto (no para crear datos).
 */

const crypto = require('crypto');

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch { /* optional */ }

const hasAI = !!(process.env.OPENAI_API_KEY && OpenAI);

const SEV = { alta: 3, media: 2, baja: 1 };

const id = (prefix = 'iss') =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- Utils numéricos ----------
const nz = (v) => Number(v || 0);
const safeDiv = (n, d) => (nz(d) ? nz(n) / nz(d) : 0);
const pct = (n, d) => (nz(d) ? (nz(n) / nz(d)) * 100 : 0);
const round = (n, d = 2) => Math.round(nz(n) * Math.pow(10, d)) / Math.pow(10, d);

// Reseñas textuales breves para señales (solo usadas en recomendación)
function badge(n, upGood = true) {
  if (!isFinite(n)) return '—';
  if (n === 0) return '0';
  const s = n > 0 ? '↑' : n < 0 ? '↓' : '•';
  return upGood ? (n > 0 ? `↑${round(n)}` : n < 0 ? `↓${round(Math.abs(n))}` : '•0') 
                : (n < 0 ? `↑${round(Math.abs(n))}` : n > 0 ? `↓${round(n)}` : '•0');
}

// ---------- Normalizadores de salida ----------
function makeIssue({
  area = 'performance',
  severity = 'media', // 'alta' | 'media' | 'baja'
  title = 'Hallazgo',
  evidence = '',
  metrics = {},
  recommendation = '',
  estimatedImpact = 'medio', // 'alto' | 'medio' | 'bajo'
  blockers = [],
  links = [],
}) {
  return {
    id: id('issue'),
    area,
    severity,
    title,
    evidence,
    metrics,
    recommendation,
    estimatedImpact,
    blockers,
    links,
  };
}

function prioritize(issues = [], cap = 3) {
  const rank = { alto: 3, medio: 2, bajo: 1 };
  return [...issues]
    .sort((a, b) => {
      const s = (SEV[b.severity] || 0) - (SEV[a.severity] || 0);
      if (s !== 0) return s;
      return (rank[b.estimatedImpact] || 0) - (rank[a.estimatedImpact] || 0);
    })
    .slice(0, cap);
}

// ---------- Heurísticas por plataforma ----------
function analyzeGoogle(input = {}) {
  const {
    currency = 'USD',
    kpis = {},
    byCampaign = [],
    timeRange = {},
  } = input;

  const total = {
    impr: nz(kpis.impressions),
    clk: nz(kpis.clicks),
    cost: nz(kpis.cost),
    conv: nz(kpis.conversions),
    val: nz(kpis.convValue),
  };
  const cpc = safeDiv(total.cost, total.clk);
  const cpa = safeDiv(total.cost, total.conv);
  const roas = safeDiv(total.val, total.cost);

  // Benchmarks muy genéricos por si no hay targets (puedes mover a DB/config)
  const target = { cpcHigh: 1.2, cpaHigh: 20, roasLow: 2.0 };

  // Ranking campañas por ROAS y por CPA
  const enriched = byCampaign.map((c) => {
    const m = c.kpis || {};
    const _cpc = safeDiv(m.cost, m.clicks);
    const _cpa = safeDiv(m.cost, m.conversions);
    const _roas = safeDiv(m.conv_value, m.cost);
    return { ...c, _cpc, _cpa, _roas, _spend: nz(m.cost) };
  });

  const topROAS = [...enriched].filter(x=>isFinite(x._roas)).sort((a,b)=>b._roas - a._roas).slice(0,3);
  const worstCPA = [...enriched].filter(x=>isFinite(x._cpa)).sort((a,b)=>b._cpa - a._cpa).slice(0,3);
  const topSpendNoConv = enriched
    .filter(x => x._spend > 0 && nz(x.kpis?.conversions) === 0)
    .sort((a,b)=>b._spend - a._spend)
    .slice(0,3);

  const issues = [];

  // Sin actividad
  if (total.impr === 0 && total.clk === 0 && total.cost === 0) {
    issues.push(makeIssue({
      area: 'setup',
      severity: 'alta',
      title: 'No hay campañas activas ni datos recientes',
      evidence: 'El snapshot no contiene impresiones, clics ni costo en el rango analizado.',
      metrics: { timeRange, totals: total },
      recommendation: 'Verifica permisos (scope "adwords"), selección de cuenta y que existan campañas activas. Si usas MCC, asegura la vinculación y el login-customer-id.',
      estimatedImpact: 'alto',
    }));
  }

  // CPA alto
  if (total.conv > 0 && cpa > target.cpaHigh) {
    issues.push(makeIssue({
      area: 'performance',
      severity: 'alta',
      title: `CPA alto (${currency} ${round(cpa)} vs ${target.cpaHigh} objetivo)`,
      evidence: `CPA global: ${round(cpa)} ${currency}; Convers. totales: ${total.conv}; Costo: ${round(total.cost)} ${currency}.`,
      metrics: { cpa, conversions: total.conv, cost: total.cost, target: target.cpaHigh },
      recommendation: 'Optimiza segmentación y pujas; aplica exclusiones de búsqueda, añade audiencias con mejor CVR y revisa la estrategia de puja (tCPA).',
      estimatedImpact: 'alto',
    }));
  }

  // ROAS bajo
  if (total.cost > 0 && roas > 0 && roas < target.roasLow) {
    issues.push(makeIssue({
      area: 'performance',
      severity: 'media',
      title: `ROAS bajo (${round(roas)} vs ${target.roasLow} objetivo)`,
      evidence: `Ventas atribuidas: ${round(total.val)} ${currency}; Inversión: ${round(total.cost)} ${currency}.`,
      metrics: { roas, revenue: total.val, cost: total.cost, target: target.roasLow },
      recommendation: 'Concentra presupuesto en campañas/ad groups con mejor ROAS. Ajusta creatividades y feed; considera estrategias de puja basadas en valor.',
      estimatedImpact: 'alto',
    }));
  }

  // Campañas gastando sin conversiones
  if (topSpendNoConv.length > 0) {
    const names = topSpendNoConv.map(x => x.name).join(', ');
    const spent = round(topSpendNoConv.reduce((a,x)=>a+x._spend,0));
    issues.push(makeIssue({
      area: 'performance',
      severity: 'alta',
      title: 'Campañas con gasto sin conversiones',
      evidence: `Con gasto total de ${spent} ${currency} sin conversiones: ${names}`,
      metrics: { topSpendNoConv: topSpendNoConv.map(x => ({ id:x.id, name:x.name, spend:x._spend })) },
      recommendation: 'Pausa, limita o reconvierte estas campañas. Ajusta pujas/segmentos. Revisa tracking de conversiones.',
      estimatedImpact: 'alto',
    }));
  }

  // CPC alto
  if (total.clk > 0 && cpc > target.cpcHigh) {
    issues.push(makeIssue({
      area: 'bidding',
      severity: 'media',
      title: `CPC elevado (${currency} ${round(cpc)} vs ${target.cpcHigh})`,
      evidence: `CPC medio global: ${round(cpc)} ${currency}.`,
      metrics: { cpc, clicks: total.clk, cost: total.cost, target: target.cpcHigh },
      recommendation: 'Revisa palabras clave costosas y QS. Usa concordancias apropiadas, negativas y pruebas A/B de anuncios.',
      estimatedImpact: 'medio',
    }));
  }

  // Destacar héroes / villanos
  if (topROAS.length) {
    const best = topROAS[0];
    issues.push(makeIssue({
      area: 'performance',
      severity: 'baja',
      title: `Héroe de ROAS: ${best.name}`,
      evidence: `Mejor ROAS ≈ ${round(best._roas)} con gasto ${round(best._spend)} ${currency}.`,
      metrics: { topROAS: topROAS.map(x => ({ id:x.id, name:x.name, roas: round(x._roas), spend: round(x._spend) })) },
      recommendation: 'Escala presupuesto a las campañas con mayor eficiencia manteniendo CPL controlado.',
      estimatedImpact: 'medio',
    }));
  }
  if (worstCPA.length) {
    const w = worstCPA[0];
    issues.push(makeIssue({
      area: 'performance',
      severity: 'media',
      title: `Villano de CPA: ${w.name}`,
      evidence: `CPA ≈ ${round(w._cpa)} ${currency} con gasto ${round(w._spend)} ${currency}.`,
      metrics: { worstCPA: worstCPA.map(x => ({ id:x.id, name:x.name, cpa: round(x._cpa), spend: round(x._spend) })) },
      recommendation: 'Refina audiencias/keywords, prueba creatividades, o mueve presupuesto fuera de esta campaña.',
      estimatedImpact: 'medio',
    }));
  }

  // Resumen determinístico
  let summary = `Rango: ${timeRange.from || 'N/A'} → ${timeRange.to || 'N/A'}. ` +
    `Impresiones ${total.impr}, clics ${total.clk}, costo ${round(total.cost)} ${currency}, ` +
    `convers. ${total.conv}, valor ${round(total.val)} ${currency}. ` +
    `CPC ${round(cpc)} ${currency}, CPA ${round(cpa)} ${currency}, ROAS ${round(roas)}.`;

  return { summary, issues };
}

function analyzeMeta(input = {}) {
  const {
    currency = 'USD',
    kpis = {},
    byCampaign = [],
    timeRange = {},
    pixelHealth = { errors: [], warnings: [] },
  } = input;

  const total = {
    impr: nz(kpis.impressions),
    clk: nz(kpis.clicks),
    spend: nz(kpis.spend),
    conv: nz(kpis.conversions),
    val: nz(kpis.conv_value),
  };
  const cpc = safeDiv(total.spend, total.clk);
  const cpa = safeDiv(total.spend, total.conv);
  const roas = safeDiv(total.val, total.spend);

  // Benchmarks genéricos
  const target = { cpcHigh: 0.8, cpaHigh: 15, roasLow: 2.5 };

  const enriched = byCampaign.map((c) => {
    const m = c.kpis || {};
    const _cpc = safeDiv(m.spend, m.clicks);
    const _cpa = safeDiv(m.spend, m.conversions);
    const _roas = safeDiv(m.conv_value, m.spend);
    return { ...c, _cpc, _cpa, _roas, _spend: nz(m.spend) };
  });

  const topROAS = [...enriched].filter(x=>isFinite(x._roas)).sort((a,b)=>b._roas - a._roas).slice(0,3);
  const worstCPA = [...enriched].filter(x=>isFinite(x._cpa)).sort((a,b)=>b._cpa - a._cpa).slice(0,3);
  const spendNoConv = enriched
    .filter(x => x._spend > 0 && nz(x.kpis?.conversions) === 0)
    .sort((a,b)=>b._spend - a._spend)
    .slice(0,3);

  const issues = [];

  if (total.impr === 0 && total.clk === 0 && total.spend === 0) {
    issues.push(makeIssue({
      area: 'setup',
      severity: 'alta',
      title: 'No hay campañas activas ni datos recientes',
      evidence: 'No se registran impresiones, clics ni gasto.',
      metrics: { timeRange, totals: total },
      recommendation: 'Verifica permisos (ads_read/ads_management), que exista al menos una campaña activa y que el pixel esté enviando eventos.',
      estimatedImpact: 'alto',
    }));
  }

  if (total.conv > 0 && cpa > target.cpaHigh) {
    issues.push(makeIssue({
      area: 'performance',
      severity: 'alta',
      title: `CPA alto (${currency} ${round(cpa)} vs ${target.cpaHigh})`,
      evidence: `CPA global: ${round(cpa)} ${currency}; Convers.: ${total.conv}; Gasto: ${round(total.spend)} ${currency}.`,
      metrics: { cpa, conversions: total.conv, spend: total.spend, target: target.cpaHigh },
      recommendation: 'Optimiza audiencias (LAL/retargeting), creatividades y ubicaciones; prueba Advantage+ si aplica.',
      estimatedImpact: 'alto',
    }));
  }

  if (total.spend > 0 && roas > 0 && roas < target.roasLow) {
    issues.push(makeIssue({
      area: 'performance',
      severity: 'media',
      title: `ROAS bajo (${round(roas)} vs ${target.roasLow})`,
      evidence: `Valor atribuido: ${round(total.val)} ${currency} con gasto ${round(total.spend)} ${currency}.`,
      metrics: { roas, revenue: total.val, spend: total.spend, target: target.roasLow },
      recommendation: 'Aumenta señal de valor (eventos purchase con value), mejora creatividades y testing de ofertas.',
      estimatedImpact: 'alto',
    }));
  }

  if (spendNoConv.length) {
    const names = spendNoConv.map(x => x.name).join(', ');
    const spent = round(spendNoConv.reduce((a,x)=>a+x._spend,0));
    issues.push(makeIssue({
      area: 'performance',
      severity: 'alta',
      title: 'Campañas con gasto sin conversiones',
      evidence: `Gasto de ${spent} ${currency} sin conversiones: ${names}`,
      metrics: { spendNoConv: spendNoConv.map(x => ({ id:x.id, name:x.name, spend:x._spend })) },
      recommendation: 'Revisa evento de conversión, ventanas de atribución y calidad de tráfico; pausa o reestructura.',
      estimatedImpact: 'alto',
    }));
  }

  if (pixelHealth?.errors?.length || pixelHealth?.warnings?.length) {
    issues.push(makeIssue({
      area: 'tracking',
      severity: pixelHealth.errors.length ? 'alta' : 'media',
      title: pixelHealth.errors.length ? 'Problemas críticos en Pixel' : 'Advertencias en Pixel',
      evidence: `Diagnóstico: ${[...pixelHealth.errors, ...pixelHealth.warnings].join(' | ') || 'N/A'}`,
      metrics: { pixelHealth },
      recommendation: 'Corrige eventos faltantes/duplicados, valida purchase y value. Revisa Event Manager.',
      estimatedImpact: 'alto',
    }));
  }

  if (topROAS.length) {
    const best = topROAS[0];
    issues.push(makeIssue({
      area: 'performance',
      severity: 'baja',
      title: `Héroe de ROAS: ${best.name}`,
      evidence: `Mejor ROAS ≈ ${round(best._roas)} con gasto ${round(best._spend)} ${currency}.`,
      metrics: { topROAS: topROAS.map(x => ({ id:x.id, name:x.name, roas: round(x._roas), spend: round(x._spend) })) },
      recommendation: 'Escala presupuesto en conjuntos/creativos ganadores, manteniendo CPA controlado.',
      estimatedImpact: 'medio',
    }));
  }

  const summary = `Rango: ${timeRange.from || 'N/A'} → ${timeRange.to || 'N/A'}. ` +
    `Impresiones ${total.impr}, clics ${total.clk}, gasto ${round(total.spend)} ${currency}, ` +
    `convers. ${total.conv}, valor ${round(total.val)} ${currency}. ` +
    `CPC ${round(cpc)} ${currency}, CPA ${round(cpa)} ${currency}, ROAS ${round(roas)}.`;

  return { summary, issues };
}

// ---------- Pulido IA (opcional y seguro) ----------
async function polishWithAI({ type, summary, issues }) {
  if (!hasAI) return { summary, issues };

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const compactIssues = issues.map((i) => ({
      area: i.area,
      severity: i.severity,
      title: i.title,
      evidence: i.evidence,
      recommendation: i.recommendation,
    }));

    const prompt = [
      `Eres un analista de marketing. Pulirás el resumen y recomendaciones sin inventar métricas.`,
      `Plataforma: ${type}`,
      `Resumen actual (no inventes números, solo reescribe mejor):\n${summary}`,
      `Issues (texto a mejorar, no cambies severidad ni inventes datos):\n${JSON.stringify(compactIssues, null, 2)}`,
      `Devuelve JSON con { "summary": "...", "reco": [ "frase1", "frase2", ... ] } usando lenguaje conciso.`,
    ].join('\n\n');

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'Eres un analista senior. Sé claro, conciso y accionable. Español neutro.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });

    const json = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
    const improvedSummary = json.summary || summary;
    const recoList = Array.isArray(json.reco) ? json.reco : [];

    // Inyecta 2-3 recomendaciones pulidas en los primeros issues con recommendation vacío/corto
    let ri = 0;
    const outIssues = issues.map((it) => {
      if (ri < recoList.length && (!it.recommendation || it.recommendation.length < 20)) {
        const merged = { ...it, recommendation: recoList[ri] };
        ri += 1;
        return merged;
      }
      return it;
    });

    return { summary: improvedSummary, issues: outIssues };
  } catch (e) {
    // Falla silencioso, mantenemos determinístico
    return { summary, issues };
  }
}

// ---------- Export principal ----------
module.exports = async function generateAudit({ type, inputSnapshot }) {
  try {
    let base = { summary: '', issues: [] };

    if (type === 'google') base = analyzeGoogle(inputSnapshot || {});
    else if (type === 'meta') base = analyzeMeta(inputSnapshot || {});
    else {
      // Shopify / otros (placeholder mínimo)
      base = {
        summary: 'Aún no hay colector de datos para esta fuente.',
        issues: [
          makeIssue({
            area: 'setup',
            severity: 'baja',
            title: 'Fuente sin colector',
            evidence: 'No se encontraron métricas para esta fuente.',
            recommendation: 'Integra el colector de datos para habilitar esta auditoría.',
            estimatedImpact: 'bajo',
          }),
        ],
      };
    }

    // Pulido IA opcional (sin alterar números)
    const polished = await polishWithAI({ type, summary: base.summary, issues: base.issues });

    // Action center (top 3)
    const actionCenter = prioritize(polished.issues, 3);

    return {
      summary: polished.summary,
      issues: polished.issues,
      actionCenter,
      topProducts: [], // si en el futuro nutres con comercio/GA4 puedes poblar esto
    };
  } catch (e) {
    // Fallback seguro
    return {
      summary: '',
      issues: [],
      actionCenter: [],
      topProducts: [],
    };
  }
};
