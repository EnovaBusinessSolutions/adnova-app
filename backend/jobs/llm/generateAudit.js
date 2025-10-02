'use strict';

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- helpers ----
const AREAS = new Set(['setup','performance','creative','tracking','budget','bidding']);
const SEVS  = new Set(['alta','media','baja']);
const cap = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
const toNum = (v) => Number(v || 0);
const sevNorm = (s) => (SEVS.has(String(s||'').toLowerCase()) ? String(s).toLowerCase() : 'media');
const areaNorm = (a) => (AREAS.has(String(a||'').toLowerCase()) ? String(a).toLowerCase() : 'performance');

function tinySnapshot(inputSnapshot, { maxChars = 140_000 } = {}) {
  // Comprime un poco quitando campos pesados innecesarios conservando KPIs básicos.
  try {
    const clone = JSON.parse(JSON.stringify(inputSnapshot || {}));
    if (Array.isArray(clone.byCampaign)) {
      clone.byCampaign = clone.byCampaign.slice(0, 50).map(c => ({
        id: c.id, name: c.name, objective: c.objective,
        kpis: c.kpis,
        period: c.period,
      }));
    }
    if (Array.isArray(clone.channels)) {
      clone.channels = clone.channels.slice(0, 50).map(ch => ({
        channel: ch.channel,
        users: ch.users, sessions: ch.sessions, conversions: ch.conversions, revenue: ch.revenue
      }));
    }
    let s = JSON.stringify(clone);
    if (s.length > maxChars) s = s.slice(0, maxChars);
    return s;
  } catch {
    const s = JSON.stringify(inputSnapshot || {});
    return s.length > maxChars ? s.slice(0, maxChars) : s;
  }
}

// ---- heurísticos mínimos (fallback local si la API falla) ----
function fallbackIssues({ type, inputSnapshot, limit = 6 }) {
  const out = [];
  if (type === 'google' || type === 'meta') {
    const list = Array.isArray(inputSnapshot?.byCampaign) ? inputSnapshot.byCampaign : [];
    for (const c of list.slice(0, 50)) {
      const k = c.kpis || {};
      const impr = toNum(k.impressions), clk = toNum(k.clicks), cost = toNum(k.cost || k.spend);
      const conv = toNum(k.conversions), value = toNum(k.conv_value || k.purchase_value);
      const ctr = impr > 0 ? (clk / impr) * 100 : 0;
      const roas = cost > 0 ? (value / cost) : 0;

      if (impr > 1000 && ctr < 1) {
        out.push({
          title: `CTR bajo · ${c.name || c.id}`,
          area: 'performance',
          severity: 'media',
          evidence: `CTR ${ctr.toFixed(2)}% con ${impr} impresiones y ${clk} clics.`,
          recommendation: 'Refina creatividades/mensajes y relevancia; prueba nuevos anuncios/segmentaciones.',
          estimatedImpact: 'medio',
          campaignRef: { id: c.id, name: c.name },
          metrics: { impressions: impr, clicks: clk, ctr }
        });
      }
      if (clk >= 150 && conv === 0 && cost > 0) {
        out.push({
          title: `Gasto sin conversiones · ${c.name || c.id}`,
          area: 'performance',
          severity: 'alta',
          evidence: `Clicks ${clk}, coste ${cost.toFixed(2)} y 0 conversiones.`,
          recommendation: 'Revisa términos/segmentos de baja calidad y la coherencia anuncio-landing.',
          estimatedImpact: 'alto',
          campaignRef: { id: c.id, name: c.name },
          metrics: { clicks: clk, cost, conversions: conv }
        });
      }
      if (value > 0 && roas > 0 && roas < 1 && cost > 100) {
        out.push({
          title: `ROAS bajo · ${c.name || c.id}`,
          area: 'performance',
          severity: 'media',
          evidence: `ROAS ${roas.toFixed(2)} con gasto ${cost.toFixed(2)} y valor ${value.toFixed(2)}.`,
          recommendation: 'Ajusta pujas/audiencias y excluye ubicaciones de bajo rendimiento.',
          estimatedImpact: 'medio',
          campaignRef: { id: c.id, name: c.name },
          metrics: { roas, cost, value }
        });
      }
      if (out.length >= limit) break;
    }
  } else if (type === 'ga4') {
    const channels = Array.isArray(inputSnapshot?.channels) ? inputSnapshot.channels : [];
    const totals = channels.reduce((a,c)=>({
      users: a.users + toNum(c.users),
      sessions: a.sessions + toNum(c.sessions),
      conversions: a.conversions + toNum(c.conversions),
      revenue: a.revenue + toNum(c.revenue),
    }), { users:0, sessions:0, conversions:0, revenue:0 });

    if (totals.sessions > 500 && totals.conversions === 0) {
      out.push({
        title: 'Tráfico alto sin conversiones',
        area: 'tracking',
        severity: 'alta',
        evidence: `Se registraron ${totals.sessions} sesiones y 0 conversiones.`,
        recommendation: 'Verifica eventos de conversión y su etiquetado. Revisa también consent y filtros.',
        estimatedImpact: 'alto',
        segmentRef: { type: 'channel', name: 'all' },
        metrics: totals
      });
    }
    const paid = channels.filter(c => /paid|cpc|display|paid social/i.test(c.channel || ''));
    const paidSess = paid.reduce((a,c)=>a+toNum(c.sessions),0);
    const paidConv = paid.reduce((a,c)=>a+toNum(c.conversions),0);
    if (paidSess > 200 && paidConv === 0) {
      out.push({
        title: 'Tráfico de pago sin conversiones',
        area: 'performance',
        severity: 'media',
        evidence: `${paidSess} sesiones de pago sin conversiones registradas.`,
        recommendation: 'Cruza con plataformas de Ads; revisa importación de conversiones y atribución.',
        estimatedImpact: 'medio',
        segmentRef: { type: 'channel', name: 'paid' },
        metrics: { paidSessions: paidSess, paidConversions: paidConv }
      });
    }
  }
  return cap(out, limit);
}

// ---- llamada OpenAI con reintentos + JSON forzado ----
async function chatJSON({ system, user, model = 'gpt-4o-mini', retries = 2 }) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await client.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' }, // fuerza JSON
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      });
      const raw = resp.choices?.[0]?.message?.content || '{}';
      return JSON.parse(raw);
    } catch (e) {
      lastErr = e;
      const code = e?.status || e?.response?.status;
      if ((code === 429 || (code >= 500 && code < 600)) && i < retries) {
        await new Promise(r => setTimeout(r, 600 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('openai_failed');
}

/**
 * generateAudit({ type, inputSnapshot, maxFindings })
 * Retorna: { summary, issues[] }
 */
module.exports = async function generateAudit({ type, inputSnapshot, maxFindings = 10 }) {
  const isGA4 = type === 'ga4';

  const system = isGA4
    ? 'Eres un auditor senior de Google Analytics 4. Devuelve únicamente JSON. Sé preciso y accionable.'
    : `Eres un auditor senior de ${type === 'google' ? 'Google Ads' : 'Meta Ads'}. Devuelve únicamente JSON. Sé preciso y accionable.`;

  const schema = isGA4
    ? `Estructura estricta:
{
  "summary": string,
  "issues": [{
    "title": string,
    "area": "setup"|"performance"|"creative"|"tracking"|"budget"|"bidding",
    "severity": "alta"|"media"|"baja",
    "evidence": string,
    "recommendation": string,
    "estimatedImpact": "alto"|"medio"|"bajo",
    "segmentRef": { "type": "channel", "name": string },
    "metrics": object
  }]
}`
    : `Estructura estricta:
{
  "summary": string,
  "issues": [{
    "title": string,
    "area": "setup"|"performance"|"creative"|"tracking"|"budget"|"bidding",
    "severity": "alta"|"media"|"baja",
    "evidence": string,
    "recommendation": string,
    "estimatedImpact": "alto"|"medio"|"bajo",
    "campaignRef": { "id": string, "name": string },
    "metrics": object
  }]
}`;

  const dataStr = tinySnapshot(inputSnapshot);
  const user = `
CONSIGNA
- Devuelve JSON **válido** exactamente con: { "summary": string, "issues": Issue[] }.
- Máximo ${maxFindings} issues.
- Idioma: español neutro.
- No inventes métricas ni campañas inexistentes; usa solo lo que veas.

DATOS (snapshot resumido)
${dataStr}

FORMATO
${schema}
`.trim();

  try {
    const parsed = await chatJSON({ system, user });

    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    let issues = Array.isArray(parsed.issues) ? parsed.issues : [];

    // normaliza + limita
    issues = cap(issues, maxFindings).map((it, i) => ({
      id: it.id || `ai-${type}-${Date.now()}-${i}`,
      title: String(it.title || 'Hallazgo'),
      area: areaNorm(it.area),
      severity: sevNorm(it.severity),
      evidence: String(it.evidence || ''),
      recommendation: String(it.recommendation || ''),
      estimatedImpact: ['alto','medio','bajo'].includes(String(it.estimatedImpact||'').toLowerCase())
        ? String(it.estimatedImpact).toLowerCase()
        : 'medio',
      campaignRef: it.campaignRef,
      segmentRef: it.segmentRef,
      metrics: (it.metrics && typeof it.metrics === 'object') ? it.metrics : {},
      links: Array.isArray(it.links) ? it.links : []
    }));

    return { summary, issues };
  } catch (e) {
    // Fallback local (si OpenAI falla)
    const issues = fallbackIssues({ type, inputSnapshot, limit: Math.min(6, maxFindings) })
      .map((it, i) => ({
        id: `fb-${type}-${Date.now()}-${i}`,
        title: it.title,
        area: areaNorm(it.area),
        severity: sevNorm(it.severity),
        evidence: it.evidence || '',
        recommendation: it.recommendation || '',
        estimatedImpact: ['alto','medio','bajo'].includes(String(it.estimatedImpact||'').toLowerCase())
          ? String(it.estimatedImpact).toLowerCase()
          : 'medio',
        campaignRef: it.campaignRef,
        segmentRef: it.segmentRef,
        metrics: it.metrics || {},
        links: []
      }));

    const summary =
      (type === 'ga4')
        ? 'Resumen generado con reglas básicas por indisponibilidad temporal del modelo.'
        : 'Resumen generado con reglas básicas (sin acceso al modelo en este momento).';

    return { summary, issues };
  }
};
