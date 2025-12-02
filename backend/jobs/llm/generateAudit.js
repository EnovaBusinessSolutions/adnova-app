// backend/jobs/llm/generateAudit.js
'use strict';

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Modelo por defecto (sobrescribible por ENV)
const DEFAULT_MODEL =
  process.env.OPENAI_MODEL_AUDIT ||
  process.env.OPENAI_MODEL ||
  'gpt-4o-mini';

// Este flag se queda por si en el futuro quisieras reactivar reglas determinísticas
const USE_FALLBACK_RULES = process.env.AUDIT_FALLBACK_RULES === 'true';

/* ------------------------------ helpers ------------------------------ */
const AREAS = new Set(['setup', 'performance', 'creative', 'tracking', 'budget', 'bidding']);
const SEVS  = new Set(['alta', 'media', 'baja']);

const cap      = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
const toNum    = (v) => Number(v || 0);
const sevNorm  = (s) => (SEVS.has(String(s || '').toLowerCase()) ? String(s).toLowerCase() : 'media');
const areaNorm = (a) => (AREAS.has(String(a || '').toLowerCase()) ? String(a).toLowerCase() : 'performance');
const impactNorm = (s) =>
  (['alto', 'medio', 'bajo'].includes(String(s || '').toLowerCase())
    ? String(s).toLowerCase()
    : 'medio');

const isGA = (type) => {
  const t = String(type || '').toLowerCase();
  return t === 'ga' || t === 'ga4' || t === 'google-analytics' || t === 'analytics';
};

const fmt = (n, d = 2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** d;
  return Math.round(v * factor) / factor;
};

const safeNum = toNum;
const safeDiv = (n, d) => (safeNum(d) ? safeNum(n) / safeNum(d) : 0);

// normaliza estados de campaña (activo / pausado / desconocido)
function normStatus(raw) {
  const s = String(raw || '').toLowerCase();

  if (!s) return 'unknown';

  if (['enabled','active','serving','running','eligible','on'].some(k => s.includes(k))) {
    return 'active';
  }

  if (['paused','pause','stopped','removed','deleted','inactive','ended','off'].some(k => s.includes(k))) {
    return 'paused';
  }

  return 'unknown';
}

/** Dedupe por título + campaignRef.id + segmentRef.name para reducir ruido */
function dedupeIssues(issues = []) {
  const seen = new Set();
  const out = [];
  for (const it of issues || []) {
    const key = `${(it.title || '').trim().toLowerCase()}::${it.campaignRef?.id || ''}::${it.segmentRef?.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/* ---------------------- DIAGNOSTICS (pre-análisis) ------------------- */
/* (los mantengo tal cual, solo ayudan a la IA) */

function buildGoogleDiagnostics(snapshot = {}) {
  const byCampaign = Array.isArray(snapshot.byCampaign) ? snapshot.byCampaign : [];
  const kpis = snapshot.kpis || {};

  const globalImpr   = safeNum(kpis.impressions);
  const globalClicks = safeNum(kpis.clicks);
  const globalConv   = safeNum(kpis.conversions);
  const globalCtr    = safeDiv(globalClicks, globalImpr);
  const globalCr     = safeDiv(globalConv, globalClicks);

  const withCpa = byCampaign
    .map(c => {
      const conv = safeNum(c?.kpis?.conversions);
      const cost = safeNum(c?.kpis?.cost ?? c?.kpis?.spend);
      const cpa  = safeDiv(cost, conv);
      return { ...c, _conv: conv, _cost: cost, _cpa: cpa };
    })
    .filter(c => c._conv > 0 && c._cost > 0);

  const worstCpaCampaigns = [...withCpa]
    .sort((a, b) => b._cpa - a._cpa)
    .slice(0, 5)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      cpa: c._cpa,
      conversions: c._conv,
      cost: c._cost,
    }));

  const lowCtrCampaigns = byCampaign
    .map(c => {
      const impr   = safeNum(c?.kpis?.impressions);
      const clicks = safeNum(c?.kpis?.clicks);
      const ctr    = safeDiv(clicks, impr);
      return { ...c, _impr: impr, _clicks: clicks, _ctr: ctr };
    })
    .filter(c => c._impr > 1000)
    .filter(c => {
      if (!globalCtr) return c._ctr < 0.01;
      return c._ctr < globalCtr * 0.6;
    })
    .slice(0, 5)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      impressions: c._impr,
      clicks: c._clicks,
      ctr: c._ctr,
    }));

  const limitedLearning = byCampaign
    .map(c => {
      const impr = safeNum(c?.kpis?.impressions);
      const clicks = safeNum(c?.kpis?.clicks);
      const conv = safeNum(c?.kpis?.conversions);
      const cost = safeNum(c?.kpis?.cost ?? c?.kpis?.spend);
      return { ...c, _impr: impr, _clicks: clicks, _conv: conv, _cost: cost };
    })
    .filter(c => c._cost > 0 && (c._impr < 1000 || c._clicks < 20))
    .slice(0, 10)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      impressions: c._impr,
      clicks: c._clicks,
      conversions: c._conv,
      cost: c._cost,
    }));

  const smallCampaigns = byCampaign.filter(c => safeNum(c?.kpis?.impressions) < 2000);
  const structureIssues = {
    totalCampaigns: byCampaign.length,
    smallCampaigns: smallCampaigns.length,
    manySmallCampaigns:
      byCampaign.length >= 10 &&
      smallCampaigns.length / Math.max(byCampaign.length, 1) > 0.6,
  };

  return {
    kpis: {
      impressions: globalImpr,
      clicks: globalClicks,
      conversions: globalConv,
      ctr: globalCtr,
      cr: globalCr,
    },
    worstCpaCampaigns,
    lowCtrCampaigns,
    limitedLearning,
    structureIssues,
  };
}

function buildGa4Diagnostics(snapshot = {}) {
  const channels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
  const devices  = Array.isArray(snapshot.devices)  ? snapshot.devices  : [];
  const landings = Array.isArray(snapshot.landingPages) ? snapshot.landingPages : [];

  const aggregate = snapshot.aggregate || {};
  const totalSessions = safeNum(aggregate.sessions);
  const totalConv     = safeNum(aggregate.conversions);
  const globalCr      = safeDiv(totalConv, totalSessions);

  const lowConvChannels = channels
    .map(ch => {
      const sessions = safeNum(ch.sessions);
      const conv     = safeNum(ch.conversions);
      const cr       = safeDiv(conv, sessions);
      return { ...ch, _sessions: sessions, _conv: conv, _cr: cr };
    })
    .filter(ch => ch._sessions > 500)
    .filter(ch => {
      if (!globalCr) return ch._cr < 0.01;
      return ch._cr < globalCr * 0.5;
    })
    .slice(0, 5)
    .map(ch => ({
      channel: ch.channel,
      sessions: ch._sessions,
      conversions: ch._conv,
      convRate: ch._cr,
    }));

  const badLandingPages = landings
    .map(lp => {
      const sessions = safeNum(lp.sessions);
      const conv     = safeNum(lp.conversions);
      const cr       = safeDiv(conv, sessions);
      return { ...lp, _sessions: sessions, _conv: conv, _cr: cr };
    })
    .filter(lp => lp._sessions > 300)
    .filter(lp => {
      if (!globalCr) return lp._cr < 0.01;
      return lp._cr < globalCr * 0.5;
    })
    .slice(0, 10)
    .map(lp => ({
      page: lp.page,
      sessions: lp._sessions,
      conversions: lp._conv,
      convRate: lp._cr,
    }));

  const devicesWithCr = devices.map(d => {
    const sessions = safeNum(d.sessions);
    const conv     = safeNum(d.conversions);
    const cr       = safeDiv(conv, sessions);
    return { ...d, _sessions: sessions, _conv: conv, _cr: cr };
  });

  const bestDevice  = [...devicesWithCr].sort((a, b) => b._cr - a._cr)[0] || null;
  const worstDevice = [...devicesWithCr].sort((a, b) => a._cr - b._cr)[0] || null;

  let deviceGaps = null;
  if (bestDevice && worstDevice && bestDevice.device !== worstDevice.device) {
    const diff = bestDevice._cr - worstDevice._cr;
    if (diff > 0.01) {
      deviceGaps = { bestDevice, worstDevice, diff };
    }
  }

  return {
    aggregate: {
      users: safeNum(aggregate.users),
      sessions: totalSessions,
      conversions: totalConv,
      revenue: safeNum(aggregate.revenue),
      convRate: globalCr,
    },
    lowConvChannels,
    badLandingPages,
    deviceGaps,
  };
}

function buildMetaDiagnostics(snapshot = {}) {
  const byCampaign = Array.isArray(snapshot.byCampaign) ? snapshot.byCampaign : [];
  const kpis = snapshot.kpis || {};

  const totalSpend   = safeNum(kpis.spend ?? kpis.cost);
  const totalConv    = safeNum(kpis.conversions);
  const totalClicks  = safeNum(kpis.clicks);
  const totalImpr    = safeNum(kpis.impressions);
  const globalCtr    = safeDiv(totalClicks, totalImpr);
  const globalCr     = safeDiv(totalConv, totalClicks);

  const mapped = byCampaign.map(c => ({
    ...c,
    _spend: safeNum(c?.kpis?.spend ?? c?.kpis?.cost),
    _conv:  safeNum(c?.kpis?.conversions),
    _clicks: safeNum(c?.kpis?.clicks),
    _impr: safeNum(c?.kpis?.impressions),
  }));

  const highSpendNoConvAdsets = mapped
    .filter(c => c._spend > 100 && c._conv === 0)
    .sort((a, b) => b._spend - a._spend)
    .slice(0, 10)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      spend: c._spend,
      impressions: c._impr,
      clicks: c._clicks,
    }));

  const lowCtrAdsets = mapped
    .filter(c => c._impr > 2000)
    .map(c => ({ ...c, _ctr: safeDiv(c._clicks, c._impr) }))
    .filter(c => {
      if (!globalCtr) return c._ctr < 0.01;
      return c._ctr < globalCtr * 0.6;
    })
    .slice(0, 10)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      impressions: c._impr,
      clicks: c._clicks,
      ctr: c._ctr,
    }));

  return {
    kpis: {
      spend: totalSpend,
      conversions: totalConv,
      clicks: totalClicks,
      impressions: totalImpr,
      ctr: globalCtr,
      cr: globalCr,
    },
    highSpendNoConvAdsets,
    lowCtrAdsets,
  };
}

function buildDiagnostics(source, snapshot) {
  const type = String(source || '').toLowerCase();
  if (type === 'google' || type === 'googleads' || type === 'gads') {
    return { google: buildGoogleDiagnostics(snapshot) };
  }
  if (type === 'ga' || type === 'ga4' || type === 'google-analytics') {
    return { ga4: buildGa4Diagnostics(snapshot) };
  }
  if (type === 'meta' || type === 'metaads' || type === 'facebook') {
    return { meta: buildMetaDiagnostics(snapshot) };
  }
  return {};
}

/**
 * Snapshot reducido para mandar al LLM
 */
function tinySnapshot(inputSnapshot, { maxChars = 60_000 } = {}) {
  try {
    const clone = JSON.parse(JSON.stringify(inputSnapshot || {}));

    // byCampaign (cap + limpieza + estados)
    if (Array.isArray(clone.byCampaign)) {
      const rawList = clone.byCampaign.map(c => {
        const statusNorm = normStatus(
          c.status ||
          c.state ||
          c.servingStatus ||
          c.serving_status ||
          c.effectiveStatus
        );

        return {
          id: String(c.id ?? ''),
          name: c.name ?? '',
          objective: c.objective ?? null,
          channel: c.channel ?? null,
          status: statusNorm,
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
            purchases:   toNum(c?.kpis?.purchases),
            purchase_value: toNum(c?.kpis?.purchase_value),
          },
          period: c.period,
          account_id: c.account_id ?? null,
          accountMeta: c.accountMeta ? {
            name:     c.accountMeta.name ?? null,
            currency: c.accountMeta.currency ?? null,
            timezone_name: c.accountMeta.timezone_name ?? null
          } : undefined
        };
      });

      const active  = rawList.filter(c => c.status === 'active');
      const paused  = rawList.filter(c => c.status === 'paused');
      const unknown = rawList.filter(c => c.status === 'unknown');

      const ordered = active.length > 0
        ? [...active, ...paused, ...unknown]
        : rawList;

      clone.byCampaignMeta = {
        total:   rawList.length,
        active:  active.length,
        paused:  paused.length,
        unknown: unknown.length
      };

      clone.byCampaign = ordered.slice(0, 60);
    }

    // channels (GA4)
    if (Array.isArray(clone.channels)) {
      clone.channels = clone.channels.slice(0, 60).map(ch => ({
        channel:     ch.channel,
        users:       toNum(ch.users),
        sessions:    toNum(ch.sessions),
        conversions: toNum(ch.conversions),
        revenue:     toNum(ch.revenue),
      }));
    }

    // byProperty (GA4 multi-prop)
    if (Array.isArray(clone.byProperty)) {
      clone.byProperty = clone.byProperty.slice(0, 10).map(p => ({
        property:     p.property,
        propertyName: p.propertyName,
        accountName:  p.accountName,
        users:       toNum(p.users),
        sessions:    toNum(p.sessions),
        conversions: toNum(p.conversions),
        revenue:     toNum(p.revenue),
      }));
    }

    // Lista simple de propiedades
    if (Array.isArray(clone.properties)) {
      clone.properties = clone.properties.slice(0, 10).map(p => ({
        id:           p.id,
        accountName:  p.accountName,
        propertyName: p.propertyName
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

/* ---------------- contexto histórico compacto para el prompt --------- */
function compactTrend(type, trend) {
  if (!trend || !trend.deltas) return null;
  const d = trend.deltas || {};
  const lines = [];

  const add = (label, key, decimals = 2) => {
    const k = d[key];
    if (!k || (k.current == null && k.previous == null)) return;
    const prev = fmt(k.previous ?? 0, decimals);
    const curr = fmt(k.current ?? 0, decimals);
    const pct  = fmt(k.percent ?? 0, 1);
    lines.push(`${label}: ${prev} → ${curr} (${pct}% vs anterior)`);
  };

  if (!isGA(type)) {
    add('Conversiones', 'conversions', 0);
    add('ROAS',        'roas',        2);
    add('CPA',         'cpa',         2);
    add('Coste',       'cost',        2);
  } else {
    add('Sesiones',    'sessions',    0);
    add('Conversiones','conversions', 0);
    add('Ingresos',    'revenue',     2);
    add('CR',          'cr',          2);
  }

  return lines.length ? lines.join('\n') : null;
}

function buildHistoryContext({ type, previousAudit, trend }) {
  const parts = [];

  if (previousAudit) {
    const ts = previousAudit.generatedAt || previousAudit.createdAt || null;
    const when = ts ? new Date(ts).toISOString() : 'desconocida';
    const prevSummary = String(previousAudit.summary || previousAudit.resumen || '')
      .replace(/\s+/g, ' ')
      .slice(0, 400);
    parts.push(`- Auditoría anterior (${when}): ${prevSummary || 'sin resumen disponible'}`);
  }

  const trendTxt = compactTrend(type, trend);
  if (trendTxt) {
    parts.push(`- Comparativa numérica clave (actual vs anterior):\n${trendTxt}`);
  }

  if (!parts.length) return '';
  return parts.join('\n');
}

/* ----------------------------- prompts ----------------------------- */
const SYSTEM_ADS = (platform) => `
Eres un auditor senior de ${platform} enfocado en performance marketing.
Objetivo: detectar puntos críticos y oportunidades accionables con alta claridad y rigor.
Debes priorizar campañas ACTIVAS; las campañas pausadas solo sirven como contexto histórico.
Entrega una síntesis ejecutiva en "summary" y recomendaciones muy concretas en "issues".
Responde SIEMPRE en JSON válido (sin texto extra). No inventes datos que no estén en el snapshot.
`.trim();

const SYSTEM_GA = `
Eres un auditor senior de Google Analytics 4 especializado en analítica de negocio y atribución.
Objetivo: detectar puntos críticos y oportunidades accionables con alta claridad y rigor.
El "summary" debe ser una síntesis ejecutiva centrada en canales/embudos con mayor impacto.
Responde SIEMPRE en JSON válido (sin texto extra). No inventes datos que no estén en el snapshot.
`.trim();

const SCHEMA_ADS = `
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

function makeUserPrompt({ snapshotStr, historyStr, maxFindings, minFindings, isAnalytics }) {
  const adsExtras = `
- Cada issue DEBE incluir accountRef ({ id, name }) y campaignRef ({ id, name }).
- Usa el campo "status" de las campañas (active/paused/unknown) para priorizar.
  `.trim();

  const gaExtras = `
- Cada issue DEBE incluir:
  - accountRef con { name, property }
  - segmentRef con el canal (por ejemplo "Organic Search", "Paid Social", etc.).
  `.trim();

  const historyBlock = historyStr
    ? `
CONTEXTO_HISTORICO
${historyStr}
`.trim()
    : '';

  return `
CONSIGNA
- Devuelve JSON válido EXACTAMENTE con: { "summary": string, "issues": Issue[] }.
- Genera entre ${minFindings} y ${maxFindings} issues. Si los datos son suficientes,
  intenta acercarte lo máximo posible a ${maxFindings} sin inventar hallazgos.
- Si los datos son muy limitados, genera solo 1-2 issues sólidos.
- Idioma: español neutro, directo y claro.
- Prohibido inventar métricas o campañas/canales no presentes en el snapshot.
- El snapshot puede incluir un objeto "diagnostics" con análisis previos
  (peores campañas por CPA, CTR bajo, landings débiles, gaps entre dispositivos, etc.).
  Úsalo como punto de partida para priorizar hallazgos.

- Cada "issue" DEBE incluir:
  ${isAnalytics ? gaExtras : adsExtras}
  - evidence con métricas textuales del snapshot
  - recommendation con pasos concretos
  - estimatedImpact coherente con la evidencia

${historyBlock ? historyBlock + '\n' : ''}

DATOS (snapshot reducido)
${snapshotStr}

FORMATO JSON
${isAnalytics ? SCHEMA_GA : SCHEMA_ADS}
`.trim();
}

/* ---------------------- OpenAI JSON con reintentos --------------------- */
async function chatJSON({ system, user, model = DEFAULT_MODEL, retries = 1 }) {
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
        ]
      });
      const raw = resp.choices?.[0]?.message?.content || '{}';
      return JSON.parse(raw);
    } catch (e) {
      lastErr = e;
      const code = e?.status || e?.response?.status;
      console.error('[LLM:ERROR] Intento falló', code, e?.message, e?.response?.data || e?.response?.body || '');
      // solo reintento en 429/5xx
      if ((code === 429 || (code >= 500 && code < 600)) && i < retries) {
        await new Promise(r => setTimeout(r, 700 * (i + 1)));
        continue;
      }
      break;
    }
  }
  throw lastErr || new Error('openai_failed');
}

/* ----------------------------- entry point ---------------------------- */
module.exports = async function generateAudit({
  type,
  inputSnapshot,
  maxFindings = 5,
  minFindings = 1,
  previousSnapshot = null,
  previousAudit = null,
  trend = null,
}) {
  const t = String(type || '').toLowerCase();
  const analytics = isGA(t);

  const haveAdsData = Array.isArray(inputSnapshot?.byCampaign) && inputSnapshot.byCampaign.length > 0;
  const haveGAData  =
    (Array.isArray(inputSnapshot?.channels)   && inputSnapshot.channels.length   > 0) ||
    (Array.isArray(inputSnapshot?.byProperty) && inputSnapshot.byProperty.length > 0);

  const haveData = analytics ? haveGAData : haveAdsData;

  const platformLabel = analytics
    ? 'GA4'
    : ((t === 'google' || t === 'googleads' || t === 'gads') ? 'Google Ads' : 'Meta Ads');

  const system = analytics ? SYSTEM_GA : SYSTEM_ADS(platformLabel);

  // Metemos diagnostics al snapshot que ve la IA
  const snapshotForLLM = {
    ...(inputSnapshot || {}),
    diagnostics: buildDiagnostics(type, inputSnapshot || {})
  };

  const dataStr     = tinySnapshot(snapshotForLLM);
  const historyStr  = buildHistoryContext({ type, previousAudit, trend });

  if (process.env.DEBUG_AUDIT === 'true') {
    console.log('[LLM:IN]', type, {
      hasByCampaign: !!inputSnapshot?.byCampaign?.length,
      hasChannels: !!inputSnapshot?.channels?.length,
      hasByProperty: !!inputSnapshot?.byProperty?.length,
      hasHistory: !!historyStr,
    });
    console.log('[LLM:SNAPSHOT]', tinySnapshot(snapshotForLLM, { maxChars: 2000 }));
    if (historyStr) console.log('[LLM:HISTORY]', historyStr);
  }

  const userPrompt = makeUserPrompt({
    snapshotStr: dataStr,
    historyStr,
    maxFindings,
    minFindings,
    isAnalytics: analytics,
  });

  const model = DEFAULT_MODEL;

  let parsed = null;
  try {
    parsed = await chatJSON({ system, user: userPrompt, model });
  } catch (e) {
    // Aquí solo logueamos; NO inventamos issues
    const code = e?.status || e?.response?.status;
    console.error('[LLM:ERROR] Falló definitivamente', code, e?.message);
  }

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
      campaignRef: it.campaignRef,
      segmentRef: it.segmentRef,
      metrics: (it.metrics && typeof it.metrics === 'object') ? it.metrics : {},
      links: Array.isArray(it.links) ? it.links : []
    }));
  }

  if (process.env.DEBUG_AUDIT === 'true') {
    console.log('[LLM:OUT]', {
      summary: (summary || '').slice(0, 160),
      issues: Array.isArray(issues) ? issues.length : 0
    });
    if (haveData && (!issues || issues.length === 0)) {
      console.warn('[LLM:WARN] IA no devolvió issues pese a haber datos. Sin fallbacks determinísticos.');
    }
  }

  // Sin datos y sin issues → devolvemos vacío
  if (!haveData && (!issues || issues.length === 0)) {
    return { summary: '', issues: [] };
  }

  // dedupe + clamp
  issues = dedupeIssues(issues);
  issues = cap(issues, maxFindings);

  return { summary, issues };
};
