// backend/jobs/llm/generateAudit.js
'use strict';

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DEFAULT_MODEL =
  process.env.OPENAI_MODEL_AUDIT ||
  process.env.OPENAI_MODEL ||
  'gpt-4o-mini';

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

function normStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'unknown';

  if (['enabled','active','serving','running','eligible','on'].some(k => s.includes(k))) return 'active';
  if (['paused','pause','stopped','removed','deleted','inactive','ended','off'].some(k => s.includes(k))) return 'paused';

  return 'unknown';
}

function dedupeIssues(issues = []) {
  const seen = new Set();
  const out = [];
  for (const it of issues || []) {
    const key = `${(it.title || '').trim().toLowerCase()}::${it.accountRef?.id || it.accountRef?.property || ''}::${it.campaignRef?.id || ''}::${it.segmentRef?.type || ''}::${it.segmentRef?.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/* ---------------------- DIAGNOSTICS (pre-análisis) ------------------- */

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

  // Señales extra (si tu collector ya las trae)
  const daily = Array.isArray(snapshot.daily) ? snapshot.daily : [];
  const sourceMedium = Array.isArray(snapshot.sourceMedium) ? snapshot.sourceMedium : [];
  const topEvents = Array.isArray(snapshot.topEvents) ? snapshot.topEvents : [];

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
    if (diff > 0.01) deviceGaps = { bestDevice, worstDevice, diff };
  }

  // Señal de posible tracking roto (no determinista, solo “bandera”)
  const sessionsLargeNoConv = totalSessions >= 500 && totalConv === 0;
  const hasPurchaseLikeEvent = topEvents.some(e => String(e.event || '').toLowerCase().includes('purchase'));
  const hasLeadLikeEvent = topEvents.some(e => {
    const n = String(e.event || '').toLowerCase();
    return n.includes('generate_lead') || n.includes('lead') || n.includes('form');
  });

  // caída fuerte vs últimos días (si hay daily)
  let last7 = null;
  if (daily.length >= 10) {
    const tail = daily.slice(-7);
    const prev = daily.slice(-14, -7);
    const sum = (arr, k) => arr.reduce((a, x) => a + safeNum(x?.[k]), 0);
    const s1 = sum(prev, 'sessions');
    const s2 = sum(tail, 'sessions');
    const drop = s1 > 0 ? (s2 - s1) / s1 : 0;
    last7 = { prevSessions: s1, lastSessions: s2, dropPct: drop };
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
    trackingFlags: {
      sessionsLargeNoConv,
      hasPurchaseLikeEvent,
      hasLeadLikeEvent,
      last7Drop: last7 && last7.dropPct < -0.25 ? last7 : null
    }
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
  if (type === 'google' || type === 'googleads' || type === 'gads') return { google: buildGoogleDiagnostics(snapshot) };
  if (type === 'ga' || type === 'ga4' || type === 'google-analytics' || type === 'analytics') return { ga4: buildGa4Diagnostics(snapshot) };
  if (type === 'meta' || type === 'metaads' || type === 'facebook') return { meta: buildMetaDiagnostics(snapshot) };
  return {};
}

/**
 * ✅ Snapshot compacto pero “inteligente”:
 * - Mantiene tu compatibilidad
 * - Incluye señales nuevas de GA4 (daily, sourceMedium, topEvents) si existen
 */
function tinySnapshot(inputSnapshot, { maxChars = 70_000 } = {}) {
  try {
    const clone = JSON.parse(JSON.stringify(inputSnapshot || {}));

    // --- Ads: byCampaign reducido (Google/Meta) ---
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

      clone.byCampaignMeta = {
        total:   rawList.length,
        active:  active.length,
        paused:  paused.length,
        unknown: unknown.length
      };

      const ordered = active.length > 0 ? [...active, ...paused, ...unknown] : rawList;
      clone.byCampaign = ordered.slice(0, 60);
    }

    // --- GA4: channels reducido (y con engagedSessions si existe) ---
    if (Array.isArray(clone.channels)) {
      clone.channels = clone.channels.slice(0, 60).map(ch => ({
        channel:     ch.channel,
        users:       toNum(ch.users),
        sessions:    toNum(ch.sessions),
        conversions: toNum(ch.conversions),
        revenue:     toNum(ch.revenue),
        engagedSessions: toNum(ch.engagedSessions),
        engagementRate: toNum(ch.engagementRate),
        newUsers: toNum(ch.newUsers),
      }));
    }

    // --- GA4: devices reducido ---
    if (Array.isArray(clone.devices)) {
      clone.devices = clone.devices.slice(0, 15).map(d => ({
        device: d.device,
        users: toNum(d.users),
        sessions: toNum(d.sessions),
        conversions: toNum(d.conversions),
        revenue: toNum(d.revenue),
        engagedSessions: toNum(d.engagedSessions),
        engagementRate: toNum(d.engagementRate),
      }));
    }

    // --- GA4: landingPages reducido ---
    if (Array.isArray(clone.landingPages)) {
      clone.landingPages = clone.landingPages
        .slice(0, 80)
        .map(lp => ({
          page: lp.page,
          sessions: toNum(lp.sessions),
          conversions: toNum(lp.conversions),
          revenue: toNum(lp.revenue),
          engagedSessions: toNum(lp.engagedSessions),
          engagementRate: toNum(lp.engagementRate),
        }));
    }

    // --- GA4: daily trend (si existe) ---
    if (Array.isArray(clone.daily)) {
      clone.daily = clone.daily
        .slice(-45)
        .map(x => ({
          date: x.date,
          sessions: toNum(x.sessions),
          conversions: toNum(x.conversions),
          revenue: toNum(x.revenue),
          engagedSessions: toNum(x.engagedSessions),
        }));
    }

    // --- GA4: source/medium (si existe) ---
    if (Array.isArray(clone.sourceMedium)) {
      clone.sourceMedium = clone.sourceMedium
        .slice(0, 80)
        .map(x => ({
          source: x.source,
          medium: x.medium,
          sessions: toNum(x.sessions),
          conversions: toNum(x.conversions),
          revenue: toNum(x.revenue),
          engagedSessions: toNum(x.engagedSessions),
          engagementRate: toNum(x.engagementRate),
        }));
    }

    // --- GA4: top events (si existe) ---
    if (Array.isArray(clone.topEvents)) {
      clone.topEvents = clone.topEvents
        .slice(0, 80)
        .map(e => ({
          event: e.event,
          eventCount: toNum(e.eventCount),
          conversions: toNum(e.conversions),
        }));
    }

    // byProperty reducido (GA4 multi-property)
    if (Array.isArray(clone.byProperty)) {
      clone.byProperty = clone.byProperty.slice(0, 10).map(p => ({
        property:     p.property,
        propertyName: p.propertyName,
        accountName:  p.accountName,
        // soporta tanto tu v2 como v3 (kpis)
        users:       toNum(p.users ?? p?.kpis?.users),
        sessions:    toNum(p.sessions ?? p?.kpis?.sessions),
        conversions: toNum(p.conversions ?? p?.kpis?.conversions),
        revenue:     toNum(p.revenue ?? p?.kpis?.revenue),
        engagementRate: toNum(p?.kpis?.engagementRate),
      }));
    }

    // properties reducido
    if (Array.isArray(clone.properties)) {
      clone.properties = clone.properties.slice(0, 10).map(p => ({
        id:           p.id,
        accountName:  p.accountName,
        propertyName: p.propertyName
      }));
    }

    // accounts reducido (Ads)
    if (Array.isArray(clone.accounts)) {
      clone.accounts = clone.accounts.slice(0, 6).map(a => ({
        id: String(a.id ?? ''),
        name: a.name ?? null,
        currency: a.currency ?? null,
        timezone_name: a.timezone_name ?? null
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
  if (trendTxt) parts.push(`- Comparativa numérica clave (actual vs anterior):\n${trendTxt}`);

  return parts.length ? parts.join('\n') : '';
}

/* ----------------------------- prompts ----------------------------- */
const SYSTEM_ADS = (platform) => `
Eres un consultor senior de performance marketing especializado en ${platform}.
Auditas con mentalidad de negocio: priorizas rentabilidad (ROAS), eficiencia (CPA/CPC) y volumen de conversiones.

Reglas:
- Prioriza campañas ACTIVAS (status=active). Pausadas solo como contexto.
- Cada issue debe contener evidencia numérica concreta extraída del snapshot (gasto, impresiones, CTR, conversiones, ROAS, CPA...).
- Si existe "diagnostics", úsalo como radar para elegir los hallazgos de mayor impacto (CPA alto, CTR bajo, gasto sin conversiones, estructura débil).
- Evita duplicados: agrupa hallazgos similares en un solo issue fuerte.
- Tono: español neutro, directo, sin relleno.
- Devuelve exclusivamente JSON válido (response_format json_object). No agregues texto fuera del JSON.
- Nunca inventes campañas o métricas.
`.trim();

const SYSTEM_GA = `
Eres un consultor senior de analítica digital especializado en Google Analytics 4 (GA4).
Tu rol es convertir datos en decisiones accionables de negocio.

Qué debes buscar (prioriza 3–5 hallazgos):
- Canales con mucho volumen pero baja conversión (ineficiencia / tráfico de baja calidad).
- Landing pages con sesiones altas y conversion rate bajo (fricción o mismatch de intención).
- Brechas fuertes por dispositivo (UX / velocidad / checkout).
- Señales de tracking roto o mal configurado (sesiones altas con 0 conversiones, eventos clave ausentes, caídas fuertes en tendencia).
- Si existen "daily", "sourceMedium" o "topEvents", úsalos para detectar causales y no quedarte en lo superficial.

Reglas:
- Evidencia numérica concreta del snapshot (máx 2–3 frases por evidence).
- Recomendaciones accionables: 2–4 pasos específicos (experimentos A/B, corrección de eventos, UTMs, mapeo de conversiones, mejora de landing, etc.).
- Devuelve exclusivamente JSON válido. No inventes métricas ni segmentos inexistentes.
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
    "segmentRef": { "type": "channel"|"device"|"landing"|"sourceMedium"|"event"|"general", "name": string },
    "accountRef": { "name": string, "property": string },
    "metrics": object,
    "links": [{ "label": string, "url": string }]
  }]
}
`.trim();

function makeUserPrompt({ snapshotStr, historyStr, maxFindings, minFindings, isAnalytics }) {
  const adsExtras = `
- Cada issue DEBE incluir:
  - accountRef { id, name } (cuenta publicitaria).
  - campaignRef { id, name } (campaña más relevante).
  - metrics (objeto pequeño con las métricas citadas).
- Usa status=active para priorizar.
- Usa diagnostics como shortlist de candidatos.
`.trim();

  const gaExtras = `
- Cada issue DEBE incluir:
  - accountRef { name, property } (propiedad GA4).
  - segmentRef (tipo + nombre): channel/device/landing/sourceMedium/event.
  - metrics (objeto pequeño con métricas citadas).
- Usa diagnostics.ga4 si existe (lowConvChannels, badLandingPages, deviceGaps, trackingFlags).
- Si daily/sourceMedium/topEvents existen, úsalos para explicar el “por qué” y proponer acciones concretas.
`.trim();

  const historyBlock = historyStr
    ? `
CONTEXTO_HISTORICO
${historyStr}
`.trim()
    : '';

  return `
CONSIGNA GENERAL
- Devuelve JSON válido EXACTAMENTE con la forma: { "summary": string, "issues": Issue[] }.
- Genera entre ${minFindings} y ${maxFindings} issues.
- Si hay volumen relevante (sesiones/gasto), NO puedes devolver issues vacíos.
- Idioma: español neutro, directo, estilo consultor senior.
- Prohibido inventar métricas, campañas, canales o propiedades.

REQUISITOS POR ISSUE
${isAnalytics ? gaExtras : adsExtras}
- evidence: métricas concretas (máx 2–3 frases).
- recommendation: 2–4 pasos accionables y específicos.
- estimatedImpact coherente (alto/medio/bajo).
- Ordena los issues de mayor a menor impacto.

${historyBlock ? historyBlock + '\n' : ''}

DATOS (snapshot reducido)
${snapshotStr}

FORMATO JSON ESPERADO
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
      if ((code === 429 || (code >= 500 && code < 600)) && i < retries) {
        await new Promise(r => setTimeout(r, 700 * (i + 1)));
        continue;
      }
      break;
    }
  }
  throw lastErr || new Error('openai_failed');
}

/* ---------------- refs hydration (NO inventa, solo usa snapshot) ---------------- */
function pickAdsAccount(snapshot) {
  const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  if (accounts[0]?.id) return { id: String(accounts[0].id), name: String(accounts[0].name || '') };
  return null;
}

function pickAdsCampaign(snapshot) {
  const byCampaign = Array.isArray(snapshot?.byCampaign) ? snapshot.byCampaign : [];
  if (byCampaign[0]?.id) return { id: String(byCampaign[0].id), name: String(byCampaign[0].name || '') };
  return null;
}

function pickGAProperty(snapshot) {
  // Prefer: snapshot.property, luego properties[0], luego byProperty[0]
  const prop =
    (snapshot?.property ? String(snapshot.property) : '') ||
    (Array.isArray(snapshot?.properties) && snapshot.properties[0]?.id ? String(snapshot.properties[0].id) : '') ||
    (Array.isArray(snapshot?.byProperty) && snapshot.byProperty[0]?.property ? String(snapshot.byProperty[0].property) : '');

  const name =
    (snapshot?.propertyName ? String(snapshot.propertyName) : '') ||
    (Array.isArray(snapshot?.properties) && snapshot.properties[0]?.propertyName ? String(snapshot.properties[0].propertyName) : '') ||
    (Array.isArray(snapshot?.byProperty) && snapshot.byProperty[0]?.propertyName ? String(snapshot.byProperty[0].propertyName) : '');

  if (!prop && !name) return null;
  return { property: prop || '', name: name || '' };
}

function hydrateIssueRefs({ issue, type, snapshot }) {
  const analytics = isGA(type);

  if (!analytics) {
    if (!issue.accountRef) {
      const a = pickAdsAccount(snapshot);
      if (a) issue.accountRef = a;
    }
    if (!issue.campaignRef) {
      const c = pickAdsCampaign(snapshot);
      if (c) issue.campaignRef = c;
    }
    return issue;
  }

  // GA4
  if (!issue.accountRef) {
    const p = pickGAProperty(snapshot);
    if (p) issue.accountRef = { name: p.name || '', property: p.property || '' };
  } else {
    // asegurar shape
    issue.accountRef = {
      name: String(issue.accountRef.name || ''),
      property: String(issue.accountRef.property || ''),
    };
  }

  if (!issue.segmentRef) {
    issue.segmentRef = { type: 'general', name: 'General' };
  } else {
    issue.segmentRef = {
      type: String(issue.segmentRef.type || 'general'),
      name: String(issue.segmentRef.name || 'General'),
    };
  }
  return issue;
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

  // GA: ahora consideramos también daily/sourceMedium/topEvents como “data real”
  const haveGAData =
    (Array.isArray(inputSnapshot?.channels)   && inputSnapshot.channels.length   > 0) ||
    (Array.isArray(inputSnapshot?.byProperty) && inputSnapshot.byProperty.length > 0) ||
    (Array.isArray(inputSnapshot?.daily)      && inputSnapshot.daily.length      > 0) ||
    (Array.isArray(inputSnapshot?.sourceMedium) && inputSnapshot.sourceMedium.length > 0);

  const haveData = analytics ? haveGAData : haveAdsData;

  const platformLabel = analytics
    ? 'GA4'
    : ((t === 'google' || t === 'googleads' || t === 'gads') ? 'Google Ads' : 'Meta Ads');

  const system = analytics ? SYSTEM_GA : SYSTEM_ADS(platformLabel);

  // snapshot enviado al LLM (ya reducido + diagnostics)
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
      hasDaily: !!inputSnapshot?.daily?.length,
      hasSourceMedium: !!inputSnapshot?.sourceMedium?.length,
      hasTopEvents: !!inputSnapshot?.topEvents?.length,
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
    // no rompemos el flujo
    const code = e?.status || e?.response?.status;
    console.error('[LLM:ERROR] Falló definitivamente', code, e?.message);
  }

  let issues = [];
  let summary = '';

  if (parsed && typeof parsed === 'object') {
    summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    issues = issues
      .filter(it => it && typeof it === 'object')
      .map((it, i) => {
        const base = {
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
        };

        // ✅ Hidrata refs solo si existen en snapshot (NO inventa)
        return hydrateIssueRefs({ issue: base, type, snapshot: inputSnapshot });
      })
      // saneo: descartar issues vacíos
      .filter(it => (it.title && (it.evidence || it.recommendation)));
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

  // Si no hay datos y tampoco issues, no fingimos auditoría.
  if (!haveData && (!issues || issues.length === 0)) {
    return { summary: '', issues: [] };
  }

  // Limpieza final: dedupe + cap
  issues = dedupeIssues(issues);
  issues = cap(issues, maxFindings);

  return { summary, issues };
};
