'use strict';

const OpenAI = require('openai');

const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY;
const MODEL = process.env.AUDIT_LLM_MODEL || 'gpt-4o-mini';

const client = OPENAI_KEY ? new OpenAI({ apiKey: OPENAI_KEY }) : null;

/* ------------------------- util ------------------------- */
const sevToLLM = (n) => (n === 'alta' || n === 'media' || n === 'baja' ? n : 'media');
const cap10 = (arr) => (Array.isArray(arr) ? arr.slice(0, 10) : []);

/* ========================================================
   1) AUDITOR REGLAS (determinístico, sin IA)
   ======================================================== */

function auditGoogle(snapshot = {}) {
  const out = [];
  const by = Array.isArray(snapshot.byCampaign) ? snapshot.byCampaign : [];
  const totalImpr = Number(snapshot?.kpis?.impressions || 0);
  const active = by.filter(c => (c?.status || '').toUpperCase() === 'ENABLED');

  if (!by.length) {
    out.push({
      id: 'google-sin-campanas',
      area: 'setup',
      title: 'No hay campañas en Google Ads',
      severity: 'alta',
      evidence: 'byCampaign está vacío.',
      metrics: { totalImpressions: totalImpr },
      recommendation: 'Crea una o más campañas y define objetivos claros antes de optimizar.',
      campaignRef: null,
    });
    return out;
  }

  if (active.length === 0 || totalImpr === 0) {
    out.push({
      id: 'google-sin-impresiones',
      area: 'setup',
      title: 'Sin campañas activas o sin impresiones',
      severity: 'alta',
      evidence: `Activas: ${active.length}. Impresiones totales últimos 30d: ${totalImpr}.`,
      metrics: { totalImpressions: totalImpr, activeCampaigns: active.length },
      recommendation: 'Revisa estado, presupuesto y segmentación de las campañas. Asegura elegibilidad.',
      campaignRef: null,
    });
    return out;
  }

  // Umbrales básicos
  const MIN_IMPR = 500;
  const CTR_LOW = 0.01;   // 1%
  const CPA_HIGH = snapshot?.targets?.cpaHigh ?? 15;  // fallback
  const ROAS_LOW = 1.2;

  for (const c of active) {
    const id = String(c.id || c.campaignId || '');
    const name = String(c.name || c.campaignName || 'Sin nombre');
    const k = c.kpis || {};
    const imp = Number(k.impressions || 0);
    const clk = Number(k.clicks || 0);
    const cost = Number(k.cost || 0);
    const conv = Number(k.conversions || 0);
    const value = Number(k.value || k.convValue || 0);
    const ctr = imp > 0 ? clk / imp : 0;
    const cpa = conv > 0 ? cost / conv : 0;
    const roas = cost > 0 ? value / cost : 0;

    if (imp < MIN_IMPR) continue; // no evaluamos volúmenes ínfimos

    // CTR bajo
    if (ctr > 0 && ctr < CTR_LOW) {
      out.push({
        id: `google-ctr-bajo-${id}`,
        area: 'performance',
        title: 'CTR bajo',
        severity: 'media',
        evidence: `Campaña "${name}" CTR=${(ctr*100).toFixed(2)}% con ${imp} impresiones y ${clk} clics.`,
        metrics: { impressions: imp, clicks: clk, ctr },
        recommendation: 'Revisa términos de búsqueda, mejora copy/creatives y amplia concordancias con negativos.',
        campaignRef: { id, name },
      });
    }

    // CPA alto
    if (conv > 0 && cpa > CPA_HIGH) {
      out.push({
        id: `google-cpa-alto-${id}`,
        area: 'bidding',
        title: 'CPA alto',
        severity: 'media',
        evidence: `Campaña "${name}" CPA=${cpa.toFixed(2)} ${snapshot.currency || 'USD'} con ${conv} conversiones.`,
        metrics: { cost, conversions: conv, cpa },
        recommendation: 'Optimiza pujas/segmentación y pausa ubicaciones de bajo rendimiento. Considera tCPA.',
        campaignRef: { id, name },
      });
    }

    // ROAS bajo
    if (value > 0 && roas > 0 && roas < ROAS_LOW) {
      out.push({
        id: `google-roas-bajo-${id}`,
        area: 'bidding',
        title: 'ROAS bajo',
        severity: 'media',
        evidence: `Campaña "${name}" ROAS=${roas.toFixed(2)} con valor conv=${value.toFixed(2)}.`,
        metrics: { value, cost, roas },
        recommendation: 'Refina audiencias/keywords y ajusta pujas por dispositivos. Evalúa tROAS si hay volumen.',
        campaignRef: { id, name },
      });
    }
  }

  if (!out.length) {
    out.push({
      id: 'google-sin-hallazgos-criticos',
      area: 'performance',
      title: 'Sin hallazgos críticos con volumen suficiente',
      severity: 'baja',
      evidence: 'No se detectaron KPIs por debajo de umbrales en campañas con volumen.',
      metrics: {},
      recommendation: 'Mantén monitoreo semanal. Crea alertas de CTR/CPA/ROAS.',
      campaignRef: null,
    });
  }

  return cap10(out);
}

function auditMeta(snapshot = {}) {
  const out = [];
  const by = Array.isArray(snapshot.byCampaign) ? snapshot.byCampaign : [];
  const pixel = snapshot.pixelHealth || {};
  const totalImpr = Number(snapshot?.kpis?.impressions || 0);
  const active = by.filter(c => (c?.status || '').toUpperCase() === 'ACTIVE' || (c?.status || '').toUpperCase() === 'ENABLED');

  if (!by.length) {
    out.push({
      id: 'meta-sin-campanas',
      area: 'setup',
      title: 'No hay campañas en Meta Ads',
      severity: 'alta',
      evidence: 'byCampaign está vacío.',
      metrics: {},
      recommendation: 'Crea campañas por objetivo (Ventas/Leads/Tráfico) y configura públicos.',
      campaignRef: null,
    });
    return out;
  }

  if (active.length === 0 || totalImpr === 0) {
    out.push({
      id: 'meta-sin-impresiones',
      area: 'setup',
      title: 'Sin campañas activas o sin impresiones',
      severity: 'alta',
      evidence: `Activas: ${active.length}. Impresiones totales últimos 30d: ${totalImpr}.`,
      metrics: { totalImpressions: totalImpr, activeCampaigns: active.length },
      recommendation: 'Revisa estado, presupuesto, límites y elegibilidad de anuncios.',
      campaignRef: null,
    });
    return out;
  }

  // Pixel health
  if (pixel && (pixel.errors?.length || pixel.warnings?.length)) {
    out.push({
      id: 'meta-pixel-issues',
      area: 'tracking',
      title: 'Problemas en el pixel/eventos',
      severity: 'alta',
      evidence: `Errores: ${pixel.errors?.length || 0}, Warnings: ${pixel.warnings?.length || 0}.`,
      metrics: {},
      recommendation: 'Corrige los eventos faltantes/duplicados en el Administrador de Eventos.',
      campaignRef: null,
    });
  }

  // Umbrales básicos
  const MIN_IMPR = 500;
  const FREQ_HIGH = 4.0;
  const CPR_HIGH = snapshot?.targets?.cprHigh ?? 5;

  for (const c of active) {
    const id = String(c.id || c.campaignId || '');
    const name = String(c.name || c.campaignName || 'Sin nombre');
    const k = c.kpis || {};
    const imp = Number(k.impressions || 0);
    const clk = Number(k.clicks || 0);
    const freq = Number(k.frequency || 0);
    const conv = Number(k.conversions || 0);
    const spend = Number(k.spend || k.cost || 0);
    const cpr = conv > 0 ? spend / conv : 0;

    if (imp < MIN_IMPR) continue;

    if (freq > FREQ_HIGH) {
      out.push({
        id: `meta-frecuencia-alta-${id}`,
        area: 'creative',
        title: 'Frecuencia alta',
        severity: 'media',
        evidence: `Campaña "${name}" frecuencia ${freq.toFixed(1)} con ${imp} impresiones.`,
        metrics: { frequency: freq, impressions: imp },
        recommendation: 'Renueva creatividades/audiencias o ajusta límites de frecuencia.',
        campaignRef: { id, name },
      });
    }

    if (conv > 0 && cpr > CPR_HIGH) {
      out.push({
        id: `meta-cpr-alto-${id}`,
        area: 'bidding',
        title: 'CPR alto',
        severity: 'media',
        evidence: `Campaña "${name}" CPR=${cpr.toFixed(2)} con ${conv} resultados.`,
        metrics: { cpr, conversions: conv, spend },
        recommendation: 'Optimiza segmentación, prueba creatividades y considera estrategias de puja por costo objetivo.',
        campaignRef: { id, name },
      });
    }
  }

  if (!out.length) {
    out.push({
      id: 'meta-sin-hallazgos-criticos',
      area: 'performance',
      title: 'Sin hallazgos críticos con volumen suficiente',
      severity: 'baja',
      evidence: 'No se detectaron métricas fuera de umbral en campañas con volumen.',
      metrics: {},
      recommendation: 'Mantén rotación creativa y testea públicos lookalike.',
      campaignRef: null,
    });
  }

  return cap10(out);
}

/* ========================================================
   2) SI HAY OPENAI: PULIDO DEL TEXTO (SIN ALUCINAR)
   ======================================================== */

async function polishWithLLM(type, issues, snapshot) {
  if (!client) return { summary: '', issues, actionCenter: issues.slice(0, 3) };

  const messages = [
    {
      role: 'system',
      content:
        `Eres un analista de performance. Pulirás TITULO/EVIDENCIA/RECOMENDACIÓN en español, ` +
        `SIN inventar datos, SIN añadir nuevas campañas, y SIN cambiar severidad/área/campaignRef. ` +
        `Responde SOLO JSON con {summary, issues, actionCenter}. Máximo 10 issues.`,
    },
    {
      role: 'user',
      content:
        `Fuente: ${type}\n` +
        `timeRange: ${JSON.stringify(snapshot?.timeRange || {}, null, 2)}\n` +
        `currency: ${snapshot?.currency || 'USD'}\n` +
        `issues (entrada):\n${JSON.stringify(issues, null, 2)}`,
    },
  ];

  const resp = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages,
  });

  const raw = resp.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.issues)) {
    return { summary: '', issues, actionCenter: issues.slice(0, 3) };
  }

  // Garantías
  const clean = cap10(parsed.issues).map((i, idx) => ({
    id: i.id || issues[idx]?.id || `iss-${type}-${idx}`,
    area: i.area || issues[idx]?.area || 'performance',
    title: i.title || issues[idx]?.title || 'Hallazgo',
    severity: sevToLLM(i.severity),
    evidence: i.evidence || issues[idx]?.evidence || '',
    recommendation: i.recommendation || issues[idx]?.recommendation || '',
    metrics: i.metrics || issues[idx]?.metrics || {},
    campaignRef: i.campaignRef || issues[idx]?.campaignRef || null,
  }));

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    issues: clean,
    actionCenter: clean.slice(0, 3),
  };
}

/* ========================================================
   3) ENTRADA PÚBLICA
   ======================================================== */

async function generateAudit({ type, inputSnapshot }) {
  const snapshot = inputSnapshot || {};

  // Reglas determinísticas primero (evitan alucinaciones)
  let issues;
  if (type === 'google') issues = auditGoogle(snapshot);
  else if (type === 'meta') issues = auditMeta(snapshot);
  else {
    issues = [{
      id: `${type}-sin-implementacion`,
      area: 'setup',
      title: `Fuente "${type}" aún no implementada`,
      severity: 'baja',
      evidence: 'Sin reglas específicas.',
      metrics: {},
      recommendation: 'Agregar reglas para esta fuente.',
      campaignRef: null,
    }];
  }

  // Cap duro 10
  issues = cap10(issues);

  // Pulido con LLM (opcional, cero invención)
  const polished = await polishWithLLM(type, issues, snapshot).catch(() => null);
  const finalIssues = polished?.issues || issues;
  const summary = polished?.summary || (finalIssues.length
    ? `Se detectaron ${finalIssues.length} hallazgos relevantes en ${type}.`
    : `Sin hallazgos relevantes en ${type}.`);

  return {
    summary,
    issues: finalIssues,
    actionCenter: finalIssues.slice(0, 3),
    topProducts: snapshot?.topProducts || [],
  };
}

module.exports = generateAudit;
