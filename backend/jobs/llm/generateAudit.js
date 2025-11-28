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

const isGA = (type) => type === 'ga' || type === 'ga4';

const fmt = (n, d=2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** d;
  return Math.round(v * factor) / factor;
};

// intenta encontrar el nombre de cuenta para una campaña
function inferAccountName(c, snap) {
  if (c?.accountMeta?.name) return String(c.accountMeta.name);
  const id = String(c?.account_id || '');
  const list = Array.isArray(snap?.accounts) ? snap.accounts : [];
  const found = list.find(a => String(a.id) === id);
  return found?.name || null;
}

/** Dedupe por título + campaignRef.id para reducir ruido del LLM */
function dedupeIssues(issues = []) {
  const seen = new Set();
  const out = [];
  for (const it of issues) {
    const key = `${(it.title||'').trim().toLowerCase()}::${it.campaignRef?.id||''}::${it.segmentRef?.name||''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/**
 * Snapshot reducido para mandar al LLM
 * - Cap de campañas
 * - Cap de canales GA4
 * - Incluye un resumen ligero de byProperty (GA4)
 */
function tinySnapshot(inputSnapshot, { maxChars = 140_000 } = {}) {
  try {
    const clone = JSON.parse(JSON.stringify(inputSnapshot || {}));

    // byCampaign (cap + limpieza)
    if (Array.isArray(clone.byCampaign)) {
      clone.byCampaign = clone.byCampaign.slice(0, 60).map(c => ({
        id: String(c.id ?? ''),
        name: c.name ?? '',
        objective: c.objective ?? null,
        kpis: {
          impressions: toNum(c?.kpis?.impressions),
          clicks:      toNum(c?.kpis?.clicks),
          cost:        toNum(c?.kpis?.cost ?? c?.kpis?.spend),
          conversions: toNum(c?.kpis?.conversions),
          conv_value:  toNum(c?.kpis?.conv_value ?? c?.kpis?.purchase_value),
          spend:       toNum(c?.kpis?.spend),
          roas:        toNum(c?.kpis?.roas),
          cpc:         toNum(c?.kpis?.cpc),
          cpa:         toNum(c?.kpis?.cpa),
          ctr:         toNum(c?.kpis?.ctr),
        },
        period: c.period,
        account_id: c.account_id ?? null,
        accountMeta: c.accountMeta ? {
          name: c.accountMeta.name ?? null,
          currency: c.accountMeta.currency ?? null
        } : undefined
      }));
    }

    // channels (GA4)
    if (Array.isArray(clone.channels)) {
      clone.channels = clone.channels.slice(0, 60).map(ch => ({
        channel: ch.channel,
        users: toNum(ch.users),
        sessions: toNum(ch.sessions),
        conversions: toNum(ch.conversions),
        revenue: toNum(ch.revenue),
      }));
    }

    // byProperty (GA4 multi-prop): lo dejamos muy ligero
    if (Array.isArray(clone.byProperty)) {
      clone.byProperty = clone.byProperty.slice(0, 10).map(p => ({
        property: p.property,
        propertyName: p.propertyName,
        accountName: p.accountName,
        // si el collector trae métricas a nivel propiedad, las normalizamos
        users: toNum(p.users),
        sessions: toNum(p.sessions),
        conversions: toNum(p.conversions),
        revenue: toNum(p.revenue),
      }));
    }

    // recorta
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

  // ------------------ GOOGLE ADS / META ADS -------------------
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
          evidence: `CTR ${fmt(ctr)}% con ${fmt(impr,0)} impresiones y ${fmt(clk,0)} clics.`,
          recommendation: 'Mejora creatividades y relevancia; prueba variantes (RSA/creatives) y ajusta segmentación.',
          estimatedImpact: 'medio',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { impressions: impr, clicks: clk, ctr: fmt(ctr) }
        });
      }

      if (clk >= 150 && conv === 0 && cost > 0) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] Gasto sin conversiones · ${c.name || c.id}`,
          area: 'performance',
          severity: 'alta',
          evidence: `${fmt(clk,0)} clics, ${fmt(cost)} de gasto y 0 conversiones.`,
          recommendation: 'Revisa términos/segmentos de baja calidad, negativas, coherencia anuncio→landing y tracking.',
          estimatedImpact: 'alto',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { clicks: clk, cost: fmt(cost), conversions: conv }
        });
      }

      if (value > 0 && roas > 0 && roas < 1 && cost > 100) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] ROAS bajo · ${c.name || c.id}`,
          area: 'performance',
          severity: 'media',
          evidence: `ROAS ${fmt(roas)} con gasto ${fmt(cost)} y valor ${fmt(value)}.`,
          recommendation: 'Ajusta pujas/audiencias, excluye ubicaciones pobres y prueba nuevas creatividades.',
          estimatedImpact: 'medio',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { roas: fmt(roas), cost: fmt(cost), value: fmt(value) }
        });
      }

      if (out.length >= limit) break;
    }
  }

  // ------------------------- GA4 / GA --------------------------
  if (isGA(type)) {
    const channels = Array.isArray(inputSnapshot?.channels) ? inputSnapshot.channels : [];
    const totals = channels.reduce((a,c)=>({
      users: a.users + toNum(c.users),
      sessions: a.sessions + toNum(c.sessions),
      conversions: a.conversions + toNum(c.conversions),
      revenue: a.revenue + toNum(c.revenue),
    }), { users:0, sessions:0, conversions:0, revenue:0 });

    // byProperty puede traer info a nivel propiedad
    const byProperty = Array.isArray(inputSnapshot?.byProperty) ? inputSnapshot.byProperty : [];
    const firstProp  = byProperty[0] || {};
    const propName   = inputSnapshot?.propertyName || firstProp.propertyName || null;
    const propId     = inputSnapshot?.property     || firstProp.property     || '';

    // Reglas con canales
    if (channels.length > 0) {
      if (totals.sessions > 500 && totals.conversions === 0) {
        out.push({
          title: 'Tráfico alto sin conversiones',
          area: 'tracking',
          severity: 'alta',
          evidence: `${fmt(totals.sessions,0)} sesiones y 0 conversiones en el periodo.`,
          recommendation: 'Verifica eventos de conversión (nombres/flags), etiquetado, consent y filtros; revisa importación a Ads.',
          estimatedImpact: 'alto',
          segmentRef: { type: 'channel', name: 'all' },
          accountRef: { name: propName || (propId || 'GA4'), property: propId || '' },
          metrics: { sessions: fmt(totals.sessions,0), conversions: 0 }
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
          evidence: `${fmt(paidSess,0)} sesiones de pago con 0 conversiones.`,
          recommendation: 'Cruza plataformas de Ads; revisa importación/definición de conversiones y ventanas de atribución.',
          estimatedImpact: 'medio',
          segmentRef: { type: 'channel', name: 'paid' },
          accountRef: { name: propName || (propId || 'GA4'), property: propId || '' },
          metrics: { paidSessions: fmt(paidSess,0), paidConversions: 0 }
        });
      }
    }

    // Si NO hay channels pero sí byProperty, intentamos una heurística básica
    if (channels.length === 0 && byProperty.length > 0) {
      const pSessions    = toNum(firstProp.sessions);
      const pConversions = toNum(firstProp.conversions);
      const pRevenue     = toNum(firstProp.revenue);

      if (pSessions === 0 && pConversions === 0 && pRevenue === 0) {
        // Propiedad conectada pero sin datos en el rango
        out.push({
          title: 'Sin datos recientes en GA4',
          area: 'setup',
          severity: 'alta',
          evidence: 'La propiedad de GA4 conectada no muestra sesiones ni conversiones en el rango analizado.',
          recommendation: 'Verifica que el tag de GA4 esté instalado, que la propiedad correcta esté conectada y que haya tráfico en el periodo seleccionado.',
          estimatedImpact: 'alto',
          segmentRef: { type: 'channel', name: 'all' },
          accountRef: { name: propName || 'Propiedad GA4', property: propId || '' },
          metrics: {}
        });
      } else if (pSessions > 0 && pConversions === 0) {
        out.push({
          title: 'Tráfico sin conversiones en GA4',
          area: 'tracking',
          severity: 'alta',
          evidence: `${fmt(pSessions,0)} sesiones registradas en la propiedad y 0 conversiones reportadas.`,
          recommendation: 'Revisa la configuración de eventos de conversión en GA4 (mark as conversion, parámetros, debugview) y el mapeo con objetivos de negocio.',
          estimatedImpact: 'alto',
          segmentRef: { type: 'channel', name: 'all' },
          accountRef: { name: propName || 'Propiedad GA4', property: propId || '' },
          metrics: { sessions: fmt(pSessions,0), conversions: 0 }
        });
      }
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
    "accountRef": { "id": string, "name": string },
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
async function chatJSON({ system, user, model, retries = 2 }) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY missing');
    err.status = 499;
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
        ],
        timeout: 60_000
      });
      const raw = resp.choices?.[0]?.message?.content || '{}';
      return JSON.parse(raw);
    } catch (e) {
      lastErr = e;
      const code = e?.status || e?.response?.status;
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
module.exports = async function generateAudit({ type, inputSnapshot, maxFindings = 10 }) {
  const analytics = isGA(type);

  const haveAdsData = Array.isArray(inputSnapshot?.byCampaign) && inputSnapshot.byCampaign.length > 0;
  const haveGAData  =
    (Array.isArray(inputSnapshot?.channels)   && inputSnapshot.channels.length   > 0) ||
    (Array.isArray(inputSnapshot?.byProperty) && inputSnapshot.byProperty.length > 0);

  const haveData    = analytics ? haveGAData : haveAdsData;

  const system = analytics
    ? SYSTEM_GA
    : SYSTEM_ADS(type === 'google' ? 'Google Ads' : 'Meta Ads');

  const dataStr = tinySnapshot(inputSnapshot);

  if (process.env.DEBUG_AUDIT === 'true') {
    console.log('[LLM:IN]', type, {
      hasByCampaign: !!inputSnapshot?.byCampaign?.length,
      hasChannels: !!inputSnapshot?.channels?.length,
      hasByProperty: !!inputSnapshot?.byProperty?.length
    });
    console.log('[LLM:SNAPSHOT]', tinySnapshot(inputSnapshot, { maxChars: 2000 }));
  }

  const user = makeUserPrompt({ snapshotStr: dataStr, maxFindings, isAnalytics: analytics });

  // modelo configurable
  const model = process.env.OPENAI_MODEL_AUDIT || 'gpt-4o-mini';

  // 1) intentar con LLM
  let parsed;
  try {
    parsed = await chatJSON({ system, user, model });
  } catch (_) {
    parsed = null;
  }

  // 2) normalizar resultados del LLM
  let issues = [];
  let summary = '';

  if (parsed && typeof parsed === 'object') {
    summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    issues = issues.map((it, i) => ({
      id: it.id || `ai-${type}-${Date.now()}-${i}`,
      title: String(it.title || 'Hallazgo'),
      area: areaNorm(it.area),
      severity: sevNorm(it.severity),
      evidence: String(it.evidence || ''),
      recommendation: String(it.recommendation || ''),
      estimatedImpact: impactNorm(it.estimatedImpact),
      accountRef: it.accountRef || null,
      campaignRef: it.campaignRef,  // Ads
      segmentRef: it.segmentRef,    // GA
      metrics: (it.metrics && typeof it.metrics === 'object') ? it.metrics : {},
      links: Array.isArray(it.links) ? it.links : []
    }));
  }

  if (process.env.DEBUG_AUDIT === 'true') {
    console.log('[LLM:OUT]', {
      summary: (summary || '').slice(0, 160),
      issues: Array.isArray(issues) ? issues.length : 0
    });
  }

  // 3) fallback si hay pocos hallazgos y sí hay datos
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
        metrics: it.metrics || {},
        links: []
      }));
      issues = [...(issues || []), ...fb];
      if (!summary) {
        summary = analytics
          ? 'Resumen basado en datos de GA4 priorizando tracking y eficiencia por canal/propiedad.'
          : 'Resumen basado en rendimiento de campañas priorizando eficiencia y conversión.';
      }
    }
  }

  // 4) dedupe + clamp
  issues = dedupeIssues(issues);
  issues = cap(issues, maxFindings);

  // 5) si no hay datos reales y el LLM tampoco generó nada, devolvemos vacío
  if (!haveData && issues.length === 0) {
    return { summary: '', issues: [] };
  }

  return { summary, issues };
};
