// backend/jobs/llm/generateAudit.js
'use strict';

const OpenAI = require('openai');
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const client = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;


const safeNum = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const safeDiv = (n, d) => {
  const N = safeNum(n);
  const D = safeNum(d);
  return D ? N / D : 0;
};
const cap = (arr, n = 150) => (Array.isArray(arr) ? arr.slice(0, n) : []);

function deriveTotals(k) {
  const convValue = k.convValue ?? k.conv_value;
  return {
    ...k,
    cpc:  safeDiv(k.cost, k.clicks),
    cpa:  safeDiv(k.cost, k.conversions),
    roas: safeDiv(convValue, k.cost),
  };
}

function deriveCampaign(c) {
  const k = c?.kpis || {};
  const convValue = k.convValue ?? k.conv_value;
  const out = {
    id: c?.id ?? null,
    name: c?.name ?? 'Sin nombre',
    account_id: c?.account_id ?? null,
    kpis: {
      impressions: safeNum(k.impressions),
      clicks:      safeNum(k.clicks),
      cost:        safeNum(k.cost),
      conversions: safeNum(k.conversions),
      convValue:   safeNum(convValue),
      cpc:  safeDiv(k.cost, k.clicks),
      cpa:  safeDiv(k.cost, k.conversions),
      roas: safeDiv(convValue, k.cost),
    },
    period: c?.period || null,
  };
  return out;
}

function buildPayload(type, snap) {
  const totals = deriveTotals(snap?.kpis || {});
  const byCampaign = cap(snap?.byCampaign, 120).map(deriveCampaign);
  const series = cap(snap?.series, 180).map(s => ({
    date: s?.date,
    impressions: safeNum(s?.impressions),
    clicks:      safeNum(s?.clicks),
    cost:        safeNum(s?.cost),
    conversions: safeNum(s?.conversions),
    conv_value:  safeNum(s?.conv_value ?? s?.convValue),
  }));

  return {
    type,
    currency: snap?.currency || 'USD',
    timeRange: snap?.timeRange || null,
    totals,
    byCampaign,
    series,
    targets: snap?.targets || null,
  };
}

function hardenIssues(issues, type) {
  const OK_AREAS = new Set(['setup','performance','creative','tracking','budget','bidding']);
  const OK_SEV   = new Set(['alta','media','baja']);

  return cap(issues || [], 10).map((it, i) => {
    const sev = String(it?.severity || '').toLowerCase();
    const area = String(it?.area || '').toLowerCase();
    const cr = it?.campaignRef && typeof it.campaignRef === 'object'
      ? { id: it.campaignRef.id ?? null, name: it.campaignRef.name ?? null }
      : null;

    return {
      id: String(it?.id || `${type}-issue-${Date.now()}-${i}`),
      area: OK_AREAS.has(area) ? area : 'performance',
      title: String(it?.title || 'Hallazgo').slice(0, 180),
      severity: OK_SEV.has(sev) ? sev : 'media',
      evidence: String(it?.evidence || ''),
      recommendation: String(it?.recommendation || ''),
      metrics: it?.metrics && typeof it.metrics === 'object' ? it.metrics : {},
      campaignRef: cr,
      estimatedImpact: (['alto','medio','bajo'].includes(it?.estimatedImpact) ? it.estimatedImpact : 'medio'),
      blockers: Array.isArray(it?.blockers) ? it.blockers.map(String) : [],
      links: Array.isArray(it?.links)
        ? it.links.map(l => ({ label: String(l?.label || ''), url: String(l?.url || '') }))
        : [],
    };
  });
}

async function analyzeWithLLM({ type, payload }) {
  const sys = `
Eres un auditor senior de performance marketing.
Analiza los datos provistos (sin inventar métricas) y devuelve JSON con:

{
  "summary": "string corta y clara",
  "issues": [
    {
      "id": "string",
      "area": "setup|performance|creative|tracking|budget|bidding",
      "title": "string",
      "severity": "alta|media|baja",
      "evidence": "qué se observó, datos concretos",
      "recommendation": "acción concreta",
      "metrics": { ...valores que cites, p.ej. cpa, roas, gasto, conversions },
      "campaignRef": { "id": "id-campaña", "name": "nombre" },
      "estimatedImpact": "alto|medio|bajo",
      "blockers": [],
      "links": []
    }
  ]
}

Reglas duras:
- NO inventes números. Usa EXACTAMENTE los que vienen en las campañas/totales/series.
- Cuando hables de algo de campaña, incluye campaignRef con {id,name}.
- Prioriza impacto (gasto/conversiones) y oportunidad.
- Si el CPA objetivo o targets existen, compáralos con el CPA real, si no, omítelo.
- Puedes calcular cpc/cpa/roas SOLO con cost, clicks, conversions, convValue del input (ya llegan pre-calculados).
- Máximo 8-10 issues. Ordena por severidad e impacto.
- Evita generalidades; cita campañas o rangos cuando se pueda.
  `.trim();

  const user = `INPUT:\n${JSON.stringify(payload)}`;

  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_AUDIT_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ]
  });

  let out = {};
  try { out = JSON.parse(resp.choices?.[0]?.message?.content || '{}'); } catch {}
  const summary = String(out?.summary || 'Auditoría generada por IA.');
  const issues  = Array.isArray(out?.issues) ? out.issues : [];
  return { summary, issues };
}

function fallbackNoData(type, payload) {
  
  const hasAnySpend = (payload?.totals?.cost || 0) > 0 || (payload?.byCampaign || []).some(c => c?.kpis?.cost > 0);
  if (hasAnySpend) return null;

  return {
    summary: 'No se detectaron campañas con datos suficientes para auditar.',
    issues: [{
      id: `setup-${type}-${Date.now()}`,
      area: 'setup',
      title: 'No se detectaron campañas ni datos recientes',
      severity: 'alta',
      evidence: 'El snapshot no contiene campañas activas ni histórico en el rango consultado.',
      recommendation: 'Verifica permisos y que existan campañas activas con gasto reciente en la(s) cuenta(s).',
      metrics: {},
      campaignRef: null,
      estimatedImpact: 'medio',
      blockers: [],
      links: []
    }]
  };
}

module.exports = async function generateAudit({ type, inputSnapshot }) {
  try {
    const payload = buildPayload(type, inputSnapshot || {});
    
    const fb = fallbackNoData(type, payload);
    if (fb) {
      return {
        summary: fb.summary,
        issues: fb.issues,
        actionCenter: fb.issues.slice(0, 3),
        topProducts: [],
      };
    }

    if (!hasOpenAI) {
      
      const msg = 'OPENAI_API_KEY no configurada; no se ejecutó IA plena.';
      return {
        summary: msg,
        issues: [{
          id: `info-${type}-${Date.now()}`,
          area: 'setup',
          title: 'IA no disponible',
          severity: 'baja',
          evidence: msg,
          recommendation: 'Configura OPENAI_API_KEY y vuelve a ejecutar la auditoría.',
          metrics: {},
          campaignRef: null,
          estimatedImpact: 'bajo',
          blockers: [],
          links: []
        }],
        actionCenter: [],
        topProducts: [],
      };
    }

    
    const { summary, issues } = await analyzeWithLLM({ type, payload });
    const hardened = hardenIssues(issues, type);

    return {
      summary,
      issues: hardened,
      actionCenter: hardened.slice(0, 3),
      topProducts: [],
    };
  } catch (e) {
    console.error('generateAudit LLM error:', e?.message || e);
    return {
      summary: 'Error al generar la auditoría con IA.',
      issues: [{
        id: `err-${type}-${Date.now()}`,
        area: 'setup',
        title: 'No se pudo completar la auditoría con IA',
        severity: 'media',
        evidence: String(e?.message || 'Error desconocido'),
        recommendation: 'Vuelve a intentar. Si persiste, revisa logs y cuota de OpenAI.',
        metrics: {},
        campaignRef: null,
        estimatedImpact: 'bajo',
        blockers: [],
        links: []
      }],
      actionCenter: [],
      topProducts: [],
    };
  }
};
