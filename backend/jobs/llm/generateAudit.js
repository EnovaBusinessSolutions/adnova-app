// backend/jobs/llm/generateAudit.js
'use strict';

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ------------------------------ helpers ------------------------------ */
const AREAS = new Set(['setup','performance','creative','tracking','budget','bidding']);
const SEVS  = new Set(['alta','media','baja']);
const cap   = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
const toNum = (v) => Number(v || 0);
const sevNorm  = (s) => (SEVS.has(String(s||'').toLowerCase()) ? String(s).toLowerCase() : 'media');
const areaNorm = (a) => (AREAS.has(String(a||'').toLowerCase()) ? String(a).toLowerCase() : 'performance');
const impactNorm = (s) => (['alto','medio','bajo'].includes(String(s||'').toLowerCase()) ? String(s).toLowerCase() : 'medio');

// Acepta tanto "ga" como "ga4" (compat con rutas)
const isGA = (type) => type === 'ga' || type === 'ga4';

// intenta encontrar el nombre de cuenta para una campaña
function inferAccountName(c, snap) {
  if (c?.accountMeta?.name) return String(c.accountMeta.name);
  const id = String(c?.account_id || '');
  const list = Array.isArray(snap?.accounts) ? snap.accounts : [];
  const found = list.find(a => String(a.id) === id);
  return found?.name || null;
}

function tinySnapshot(inputSnapshot, { maxChars = 140_000 } = {}) {
  try {
    const clone = JSON.parse(JSON.stringify(inputSnapshot || {}));

    if (Array.isArray(clone.byCampaign)) {
      clone.byCampaign = clone.byCampaign.slice(0, 60).map(c => ({
        id: String(c.id ?? ''),
        name: c.name ?? '',
        objective: c.objective ?? null,
        kpis: c.kpis,
        period: c.period,
        account_id: c.account_id ?? null,
        // dar contexto multi-cuenta al LLM sin inflar demasiado
        accountMeta: c.accountMeta ? {
          name: c.accountMeta.name ?? null,
          currency: c.accountMeta.currency ?? null
        } : undefined
      }));
    }

    if (Array.isArray(clone.channels)) {
      clone.channels = clone.channels.slice(0, 60).map(ch => ({
        channel: ch.channel,
        users: toNum(ch.users),
        sessions: toNum(ch.sessions),
        conversions: toNum(ch.conversions),
        revenue: toNum(ch.revenue),
      }));
    }

    // Contexto GA4/GA
    if (typeof clone.property === 'string') clone.property = clone.property; // "properties/123"
    if (typeof clone.accountName === 'string') clone.accountName = clone.accountName;

    let s = JSON.stringify(clone);
    if (s.length > maxChars) s = s.slice(0, maxChars);
    return s;
  } catch {
    const s = JSON.stringify(inputSnapshot || {});
    return s.length > maxChars ? s.slice(0, maxChars) : s;
  }
}

/* ----------------------- fallback determinístico ---------------------- */
function fallbackIssues({ type, inputSnapshot, limit = 6 }) {
  const out = [];

  if (type === 'google' || type === 'meta') {
    const list = Array.isArray(inputSnapshot?.byCampaign) ? inputSnapshot.byCampaign : [];
    for (const c of list.slice(0, 100)) {
      const k = c.kpis || {};
      const impr = toNum(k.impressions);
      const clk  = toNum(k.clicks);
      const cost = toNum(k.cost ?? k.spend);
      const conv = toNum(k.conversions);
      const value= toNum(k.conv_value ?? k.purchase_value);
      const ctr  = impr > 0 ? (clk / impr) * 100 : 0;
      const roas = cost > 0 ? (value / cost) : 0;

      const accountRef = {
        id: String(c.account_id ?? ''),
        name: inferAccountName(c, inputSnapshot) || ''
      };

      if (impr > 1000 && ctr < 1) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] CTR bajo · ${c.name || c.id}`,
          area: 'performance',
          severity: 'media',
          evidence: `CTR ${ctr.toFixed(2)}% con ${impr} impresiones y ${clk} clics.`,
          recommendation: 'Mejora creatividades y relevancia; prueba variantes (RSA/creatives) y ajusta segmentación.',
          estimatedImpact: 'medio',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { impressions: impr, clicks: clk, ctr: Number(ctr.toFixed(2)) }
        });
      }

      if (clk >= 150 && conv === 0 && cost > 0) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] Gasto sin conversiones · ${c.name || c.id}`,
          area: 'performance',
          severity: 'alta',
          evidence: `${clk} clics, ${cost.toFixed(2)} de gasto y 0 conversiones.`,
          recommendation: 'Revisa términos/segmentos de baja calidad, negativas, coherencia anuncio→landing y tracking.',
          estimatedImpact: 'alto',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { clicks: clk, cost: Number(cost.toFixed(2)), conversions: conv }
        });
      }

      if (value > 0 && roas > 0 && roas < 1 && cost > 100) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] ROAS bajo · ${c.name || c.id}`,
          area: 'performance',
          severity: 'media',
          evidence: `ROAS ${roas.toFixed(2)} con gasto ${cost.toFixed(2)} y valor ${value.toFixed(2)}.`,
          recommendation: 'Ajusta pujas/audiencias, excluye ubicaciones pobres y prueba nuevas creatividades.',
          estimatedImpact: 'medio',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { roas: Number(roas.toFixed(2)), cost: Number(cost.toFixed(2)), value: Number(value.toFixed(2)) }
        });
      }

      if (out.length >= limit) break;
    }
  }

  if (isGA(type)) {
    const channels = Array.isArray(inputSnapshot?.channels) ? inputSnapshot.channels : [];
    const totals = channels.reduce((a,c)=>({
      users: a.users + toNum(c.users),
      sessions: a.sessions + toNum(c.sessions),
      conversions: a.conversions + toNum(c.conversions),
      revenue: a.revenue + toNum(c.revenue),
    }), { users:0, sessions:0, conversions:0, revenue:0 });

    const accountName = inputSnapshot?.accountName || null;
    const property    = inputSnapshot?.property || null;

    if (totals.sessions > 500 && totals.conversions === 0) {
      out.push({
        title: 'Tráfico alto sin conversiones',
        area: 'tracking',
        severity: 'alta',
        evidence: `${totals.sessions} sesiones y 0 conversiones en el periodo.`,
        recommendation: 'Verifica eventos de conversión (nombres/flags), etiquetado, consent y filtros; revisa importación a Ads.',
        estimatedImpact: 'alto',
        segmentRef: { type: 'channel', name: 'all' },
        accountRef: { name: accountName || (property || 'GA4'), property: property || '' },
        metrics: totals
      });
    }

    const paid = channels.filter(c => /paid|cpc|display|paid social|ads/i.test(String(c.channel || '')));
    const paidSess = paid.reduce((a,c)=>a+toNum(c.sessions),0);
    const paidConv = paid.reduce((a,c)=>a+toNum(c.conversions),0);
    if (paidSess > 200 && paidConv === 0) {
      out.push({
        title: 'Tráfico de pago sin conversiones',
        area: 'performance',
        severity: 'media',
        evidence: `${paidSess} sesiones de pago con 0 conversiones.`,
        recommendation: 'Cruza plataformas de Ads; revisa importación/definición de conversiones y ventanas de atribución.',
        estimatedImpact: 'medio',
        segmentRef: { type: 'channel', name: 'paid' },
        accountRef: { name: accountName || (property || 'GA4'), property: property || '' },
        metrics: { paidSessions: paidSess, paidConversions: paidConv }
      });
    }
  }

  return cap(out, limit);
}

/* ----------------------------- prompts ----------------------------- */
const SYSTEM_ADS = (platform) => `
Eres un auditor senior de ${platform} enfocado en performance marketing.
Objetivo: detectar puntos críticos y oportunidades accionables con alta claridad y rigor.
Responde SIEMPRE en JSON válido (sin texto extra). No inventes datos que no estén en el snapshot.
`.trim();

const SYSTEM_GA = `
Eres un auditor senior de Google Analytics 4 especializado en analítica de negocio y atribución.
Objetivo: detectar puntos críticos y oportunidades accionables con alta claridad y rigor.
Responde SIEMPRE en JSON válido (sin texto extra). No inventes datos que no estén en el snapshot.
`.trim();

const SCHEMA_ADS = `
Estructura estricta:
{
  "summary": string,
  "issues": [{
    "title": string,
    "area": "setup"|"performance"|"creative"|"tracking"|"budget"|"bidding",
    "severity": "alta"|"media"|"baja",
    "evidence": string,
    "recommendation": string,
    "estimatedImpact": "alto"|"medio"|"bajo",
    "accountRef": { "id": string, "name": string },   // NUEVO
    "campaignRef": { "id": string, "name": string },
    "metrics": object,
    "links": [{ "label": string, "url": string }]
  }]
}
`.trim();

const SCHEMA_GA = `
Estructura estricta:
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
    "accountRef": { "name": string, "property": string },
    "metrics": object,
    "links": [{ "label": string, "url": string }]
  }]
}
`.trim();

function makeUserPrompt({ snapshotStr, maxFindings, isAnalytics }) {
  const adsExtras = `
- Cada issue DEBE incluir **accountRef** ({ id, name }) y **campaignRef** ({ id, name }).
- En el título CITA la cuenta: formato sugerido **"[{accountRef.name||accountRef.id}] {campaignRef.name}: ..."**.
  `.trim();

  return `
CONSIGNA
- Devuelve JSON válido EXACTAMENTE con: { "summary": string, "issues": Issue[] }.
- MÁXIMO ${maxFindings} issues. Si hay muchos hallazgos, prioriza por impacto esperado en revenue/conversiones.
- Idioma: español neutro, directo y claro.
- Prohibido inventar métricas o campañas/canales no presentes en el snapshot.
- Cada "issue" DEBE incluir:
  ${isAnalytics ? '- accountRef con {name, property}\n- segmentRef con el canal' : adsExtras}
  - evidence con métricas textuales del snapshot
  - recommendation con pasos concretos (no genéricos)
  - estimatedImpact coherente con la evidencia

PRIORIDAD (de mayor a menor)
1) Tracking roto/ausente o discrepancias que impidan optimizar.
2) Gasto ineficiente: gasto alto sin conversiones o ROAS bajo.
3) Oportunidades de creatividad/segmentación/puja/estructura.
4) Problemas de setup/higiene solo si afectan resultados.

ESTILO
- Títulos concisos (p. ej. “Gasto sin conversiones en {campaña}” o “[{cuenta}] {campaña}: ROAS bajo”).
- Evidencia SIEMPRE con números del snapshot (ej. “10,172 sesiones, 23 conversiones, ROAS 0.42”).
- Recomendaciones en imperativo y específicas (qué tocar, dónde y con umbrales sugeridos).

DATOS (snapshot reducido)
${snapshotStr}

FORMATO JSON
${isAnalytics ? SCHEMA_GA : SCHEMA_ADS}
`.trim();
}

/* ---------------------- OpenAI JSON con reintentos --------------------- */
async function chatJSON({ system, user, model = 'gpt-4o-mini', retries = 2 }) {
  // Si no hay API key, dejamos que el caller use el fallback heurístico
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY missing');
    err.status = 499; // pseudo-status para diferenciar
    throw err;
  }

  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await client.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
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
      // 429/5xx → backoff y reintento
      if ((code === 429 || (code >= 500 && code < 600)) && i < retries) {
        await new Promise(r => setTimeout(r, 700 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('openai_failed');
}

/* ----------------------------- entry point ---------------------------- */
/**
 * generateAudit({ type, inputSnapshot, maxFindings })
 *  - type: 'google' | 'meta' | 'ga' | 'ga4'
 *  - inputSnapshot: salida de collectors (Ads: byCampaign; GA: channels + property/accountName)
 * Retorna: { summary, issues[] }
 */
module.exports = async function generateAudit({ type, inputSnapshot, maxFindings = 10 }) {
  const analytics = isGA(type);

  // ¿hay datos reales?
  const haveAdsData = Array.isArray(inputSnapshot?.byCampaign) && inputSnapshot.byCampaign.length > 0;
  const haveGAData  = Array.isArray(inputSnapshot?.channels)   && inputSnapshot.channels.length > 0;
  const haveData    = analytics ? haveGAData : haveAdsData;

  // prompts
  const system = analytics
    ? SYSTEM_GA
    : SYSTEM_ADS(type === 'google' ? 'Google Ads' : 'Meta Ads');

  const dataStr = tinySnapshot(inputSnapshot);

  // ---------- LOG: entrada al LLM ----------
  if (process.env.DEBUG_AUDIT === 'true') {
    console.log('[LLM:IN]', type, {
      hasByCampaign: !!inputSnapshot?.byCampaign?.length,
      hasChannels: !!inputSnapshot?.channels?.length
    });
    console.log('[LLM:SNAPSHOT]', tinySnapshot(inputSnapshot, { maxChars: 2000 }));
  }

  const user = makeUserPrompt({ snapshotStr: dataStr, maxFindings, isAnalytics: analytics });

  // 1) intentar con LLM
  let parsed;
  try {
    parsed = await chatJSON({ system, user });
  } catch (_) {
    parsed = null;
  }

  // 2) normalizar resultados del LLM
  let issues = [];
  let summary = '';

  if (parsed && typeof parsed === 'object') {
    summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    issues = cap(issues, maxFindings).map((it, i) => ({
      id: it.id || `ai-${type}-${Date.now()}-${i}`,
      title: String(it.title || 'Hallazgo'),
      area: areaNorm(it.area),
      severity: sevNorm(it.severity),
      evidence: String(it.evidence || ''),
      recommendation: String(it.recommendation || ''),
      estimatedImpact: impactNorm(it.estimatedImpact),
      accountRef: it.accountRef || null, // Ads y GA (GA usa {name, property})
      campaignRef: it.campaignRef,       // Ads
      segmentRef: it.segmentRef,         // GA
      accountRefGA: it.accountRef,       // alias no usado, por compat (no se persiste)
      accountRef: it.accountRef,         // aseguramos propagación
      metrics: (it.metrics && typeof it.metrics === 'object') ? it.metrics : {},
      links: Array.isArray(it.links) ? it.links : []
    }));
  }

  // ---------- LOG: salida del LLM ----------
  if (process.env.DEBUG_AUDIT === 'true') {
    console.log('[LLM:OUT]', {
      summary: (summary || '').slice(0, 160),
      issues: Array.isArray(issues) ? issues.length : 0
    });
  }

  // 3) si el LLM falló o dio muy poco y hay datos, usar fallback para completar hasta MÍNIMO 3 issues
  if ((!issues || issues.length < 3) && haveData) {
    const need = Math.min(3, maxFindings) - (issues?.length || 0);
    if (need > 0) {
      const fb = fallbackIssues({ type, inputSnapshot, limit: need }).map((it, idx) => ({
        id: `fb-${type}-${Date.now()}-${idx}`,
        title: it.title,
        area: areaNorm(it.area),
        severity: sevNorm(it.severity),
        evidence: it.evidence || '',
        recommendation: it.recommendation || '',
        estimatedImpact: impactNorm(it.estimatedImpact),
        accountRef: it.accountRef || null,
        campaignRef: it.campaignRef,
        segmentRef: it.segmentRef,
        accountRefGA: it.accountRef,
        metrics: it.metrics || {},
        links: []
      }));
      issues = [...(issues || []), ...fb];
      if (!summary) {
        summary = analytics
          ? 'Resumen basado en datos de GA4 priorizando tracking y eficiencia por canal.'
          : 'Resumen basado en rendimiento de campañas priorizando eficiencia y conversión.';
      }
    }
  }

  // 4) si no hay datos reales, no inventamos (el caller crea issue de setup)
  if (!haveData && issues.length === 0) {
    return { summary: '', issues: [] };
  }

  return { summary, issues: cap(issues, maxFindings) };
};
