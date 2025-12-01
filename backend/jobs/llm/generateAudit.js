// backend/jobs/llm/generateAudit.js
'use strict';

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Modelo por defecto (sobrescribible por ENV)
// Recomendado en producción: OPENAI_MODEL_AUDIT="gpt-5.1" o "gpt-4.1"
const DEFAULT_MODEL =
  process.env.OPENAI_MODEL_AUDIT ||
  process.env.OPENAI_MODEL ||
  'gpt-4.1-mini';

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

const isGA = (type) => type === 'ga' || type === 'ga4';

const fmt = (n, d = 2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** d;
  return Math.round(v * factor) / factor;
};

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

// intenta encontrar el nombre de cuenta para una campaña
function inferAccountName(c, snap) {
  if (c?.accountMeta?.name) return String(c.accountMeta.name);
  const id = String(c?.account_id || '');
  const list = Array.isArray(snap?.accounts) ? snap.accounts : [];
  const found = list.find(a => String(a.id) === id);
  return found?.name || null;
}

/** Dedupe por título + campaignRef.id + segmentRef.name para reducir ruido del LLM */
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

/**
 * Snapshot reducido para mandar al LLM
 * - Cap de campañas
 * - Cap de canales GA4
 * - Incluye un resumen ligero de byProperty (GA4)
 * - Prioriza campañas activas cuando hay muchas
 * - Conserva meta-información básica de cuentas/propiedades
 */
function tinySnapshot(inputSnapshot, { maxChars = 140_000 } = {}) {
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
          status: statusNorm, // 👈 se lo mandamos explícito a la IA
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
        ? [...active, ...paused, ...unknown] // 👈 primero activas
        : rawList;

      // pequeño resumen para que la IA sepa el contexto de estados
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

    // byProperty (GA4 multi-prop): lo dejamos ligero pero útil
    if (Array.isArray(clone.byProperty)) {
      clone.byProperty = clone.byProperty.slice(0, 10).map(p => ({
        property:     p.property,
        propertyName: p.propertyName,
        accountName:  p.accountName,
        // métricas a nivel propiedad (si existen)
        users:       toNum(p.users),
        sessions:    toNum(p.sessions),
        conversions: toNum(p.conversions),
        revenue:     toNum(p.revenue),
      }));
    }

    // Lista simple de propiedades (para contexto multi-propiedades)
    if (Array.isArray(clone.properties)) {
      clone.properties = clone.properties.slice(0, 10).map(p => ({
        id:           p.id,
        accountName:  p.accountName,
        propertyName: p.propertyName
      }));
    }

    // recorta duro por seguridad
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

  // Targets opcionales definidos por collector (por ahora sólo usamos cpaHigh)
  const cpaHigh = Number(inputSnapshot?.targets?.cpaHigh || 0) || null;

  // ------------------ GOOGLE ADS / META ADS -------------------
  if (type === 'google' || type === 'meta') {
    const rawList = Array.isArray(inputSnapshot?.byCampaign) ? inputSnapshot.byCampaign : [];

    // enriquecemos con estado normalizado
    const enriched = rawList.map(c => {
      const st = normStatus(
        c.status ||
        c.state ||
        c.servingStatus ||
        c.serving_status ||
        c.effectiveStatus
      );
      return { ...c, _statusNorm: st };
    });

    const active = enriched.filter(c => c._statusNorm === 'active');
    const paused = enriched.filter(c => c._statusNorm === 'paused');
    const anyWithStatus = enriched.some(c => c._statusNorm !== 'unknown');

    // Si TODAS las campañas conocidas están pausadas/inactivas -> issue específico
    if (anyWithStatus && active.length === 0 && paused.length > 0 && paused.length === enriched.length) {
      // podemos agrupar por cuenta para dar más contexto
      const byAccount = new Map();
      for (const c of paused) {
        const accId = String(c.account_id ?? '');
        const accName = inferAccountName(c, inputSnapshot) || accId || 'Cuenta sin nombre';
        const key = accId || accName;
        if (!byAccount.has(key)) {
          byAccount.set(key, { id: accId, name: accName, campaigns: 0 });
        }
        byAccount.get(key).campaigns += 1;
      }

      const accountsTxt = Array.from(byAccount.values()).map(a =>
        `${a.name} (${a.campaigns} campañas pausadas)`
      ).join(' · ');

      out.push({
        title: 'Todas las campañas están pausadas o inactivas',
        area: 'setup',
        severity: 'media',
        evidence: `Se detectaron ${enriched.length} campañas y ninguna está activa. ${accountsTxt || ''}`.trim(),
        recommendation: 'Define qué campañas quieres volver a activar. Empieza por las que históricamente tienen mejor rendimiento, revisa presupuesto, segmentación y creatividades antes de reactivarlas y establece reglas claras de pausa si no cumplen con el ROAS/CPA objetivo.',
        estimatedImpact: 'medio',
        accountRef: null,
        campaignRef: null,
        metrics: { totalCampaigns: enriched.length, activeCampaigns: 0 },
        links: []
      });

      return cap(out, limit);
    }

    // Si hay activas, priorizamos esas para analizar rendimiento; si no, usamos todo
    const list = active.length > 0 ? active : enriched;

    for (const c of list.slice(0, 100)) {
      const k = c.kpis || {};
      const impr   = toNum(k.impressions);
      const clk    = toNum(k.clicks);
      const cost   = toNum(k.cost ?? k.spend);
      const conv   = toNum(k.conversions);
      const value  = toNum(k.conv_value ?? k.purchase_value);
      const ctr    = impr > 0 ? (clk / impr) * 100 : 0;
      const roas   = cost > 0 ? (value / cost) : 0;
      const cpa    = conv > 0 ? (cost / conv) : 0;
      const ch     = c.channel || '';
      const isRemarketing = /remarketing|retarget/i.test(String(ch));

      const accountRef = {
        id: String(c.account_id ?? ''),
        name: inferAccountName(c, inputSnapshot) || ''
      };

      // 1) CTR bajo con volumen
      if (impr > 1000 && ctr < 1) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] CTR bajo · ${c.name || c.id}`,
          area: 'performance',
          severity: 'media',
          evidence: `CTR ${fmt(ctr)}% con ${fmt(impr,0)} impresiones y ${fmt(clk,0)} clics.`,
          recommendation: 'Mejora creatividades y relevancia; prueba variantes (RSA/creatives), ajusta segmentación y excluye audiencias poco relevantes.',
          estimatedImpact: 'medio',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { impressions: impr, clicks: clk, ctr: fmt(ctr) }
        });
      }

      // 2) Gasto sin conversiones
      if (clk >= 150 && conv === 0 && cost > 0) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] Gasto sin conversiones · ${c.name || c.id}`,
          area: 'performance',
          severity: 'alta',
          evidence: `${fmt(clk,0)} clics, ${fmt(cost)} de gasto y 0 conversiones.`,
          recommendation: 'Revisa términos/segmentos de baja calidad, añade negativas, alinea mejor anuncio→landing y verifica que las conversiones estén bien configuradas y disparando.',
          estimatedImpact: 'alto',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { clicks: clk, cost: fmt(cost), conversions: conv }
        });
      }

      // 3) ROAS bajo con gasto relevante
      if (value > 0 && roas > 0 && roas < 1 && cost > 100) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] ROAS bajo · ${c.name || c.id}`,
          area: 'performance',
          severity: 'media',
          evidence: `ROAS ${fmt(roas)} con gasto ${fmt(cost)} y valor ${fmt(value)}.`,
          recommendation: 'Ajusta pujas y audiencias, excluye ubicaciones con baja rentabilidad y prueba nuevas creatividades/formatos orientados a conversión.',
          estimatedImpact: 'medio',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { roas: fmt(roas), cost: fmt(cost), value: fmt(value) }
        });
      }

      // 4) CPA por encima del target (si collector definió cpaHigh)
      if (cpaHigh && conv > 0 && cpa > cpaHigh * 1.1 && cost > 50) {
        out.push({
          title: `[${accountRef.name || accountRef.id}] CPA alto vs objetivo · ${c.name || c.id}`,
          area: 'performance',
          severity: isRemarketing ? 'alta' : 'media',
          evidence: `CPA ${fmt(cpa)} vs objetivo ${fmt(cpaHigh)} con gasto ${fmt(cost)} y ${fmt(conv,0)} conversiones.`,
          recommendation: 'Revisa segmentos con peor CPA, baja pujas o exclúyelos, concentra presupuesto en grupos y creatividades con mejor costo por conversión y ajusta el funnel si es necesario.',
          estimatedImpact: 'alto',
          accountRef,
          campaignRef: { id: String(c.id ?? ''), name: String(c.name ?? c.id ?? '') },
          metrics: { cpa: fmt(cpa), targetCpa: fmt(cpaHigh), cost: fmt(cost), conversions: conv }
        });
      }

      if (out.length >= limit) break;
    }
  }

  // ------------------------- GA4 / GA --------------------------
  if (isGA(type)) {
    const channels   = Array.isArray(inputSnapshot?.channels) ? inputSnapshot.channels : [];
    const byProperty = Array.isArray(inputSnapshot?.byProperty) ? inputSnapshot.byProperty : [];
    const firstProp  = byProperty[0] || {};
    const propName   = inputSnapshot?.propertyName || firstProp.propertyName || null;
    const propId     = inputSnapshot?.property     || firstProp.property     || '';

    const totals = channels.reduce((a, c) => ({
      users:       a.users + toNum(c.users),
      sessions:    a.sessions + toNum(c.sessions),
      conversions: a.conversions + toNum(c.conversions),
      revenue:     a.revenue + toNum(c.revenue),
    }), { users: 0, sessions: 0, conversions: 0, revenue: 0 });

    // Reglas con canales
    if (channels.length > 0) {
      if (totals.sessions > 500 && totals.conversions === 0) {
        out.push({
          title: 'Tráfico alto sin conversiones',
          area: 'tracking',
          severity: 'alta',
          evidence: `${fmt(totals.sessions,0)} sesiones y 0 conversiones en el periodo.`,
          recommendation: 'Verifica eventos de conversión (nombres, marcar como conversión, parámetros), el etiquetado (UTM), el consentimiento y posibles filtros que estén excluyendo tráfico; revisa también la importación de conversiones hacia plataformas de Ads.',
          estimatedImpact: 'alto',
          segmentRef: { type: 'channel', name: 'all' },
          accountRef: { name: propName || (propId || 'GA4'), property: propId || '' },
          metrics: { sessions: fmt(totals.sessions,0), conversions: 0 }
        });
      }

      const paid = channels.filter(c =>
        /paid|cpc|display|paid social|ads/i.test(String(c.channel || ''))
      );
      const paidSess = paid.reduce((a,c)=>a+toNum(c.sessions),0);
      const paidConv = paid.reduce((a,c)=>a+toNum(c.conversions),0);
      if (paidSess > 200 && paidConv === 0) {
        out.push({
          title: 'Tráfico de pago sin conversiones',
          area: 'performance',
          severity: 'media',
          evidence: `${fmt(paidSess,0)} sesiones de pago con 0 conversiones.`,
          recommendation: 'Cruza datos con las plataformas de Ads para confirmar que haya conversiones; revisa definición de eventos de conversión, ventanas de atribución y que estés importando las acciones correctas.',
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
          recommendation: 'Verifica que el tag de GA4 esté correctamente instalado, que la propiedad conectada sea la correcta y que haya tráfico en el sitio durante el periodo seleccionado.',
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
          recommendation: 'Revisa la configuración de eventos de conversión en GA4 (marcar como conversión, parámetros, debugview) y el mapeo con objetivos de negocio; comprueba también la configuración de eventos en el sitio/app.',
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

/* --------- fallback genérico para asegurar mínimo 1 issue --------- */
function buildGenericIssue({ type, inputSnapshot }) {
  if (!inputSnapshot) return null;

  // GOOGLE / META (usa kpis agregados)
  if (type === 'google' || type === 'meta') {
    const k = inputSnapshot.kpis || {};
    const impr  = toNum(k.impressions);
    const clk   = toNum(k.clicks);
    const cost  = toNum(k.cost || k.spend);
    const conv  = toNum(k.conversions);
    const value = toNum(k.conv_value || k.purchase_value);
    const roas  = cost > 0 ? value / cost : 0;
    const cpa   = conv > 0 ? cost / conv : 0;

    const firstAcc = Array.isArray(inputSnapshot.accounts) && inputSnapshot.accounts[0]
      ? inputSnapshot.accounts[0]
      : null;
    const accName = firstAcc?.name || firstAcc?.id || '';
    const platform = type === 'google' ? 'Google Ads' : 'Meta Ads';

    // Sin casi datos
    if (impr === 0 && clk === 0 && cost === 0 && conv === 0 && value === 0) {
      return {
        title: `Bajo volumen de datos en ${platform}`,
        area: 'setup',
        severity: 'media',
        evidence: 'En el periodo analizado la cuenta tiene muy poco o ningún tráfico/conversiones agregadas.',
        recommendation: 'Amplía el rango de fechas, asegura que haya campañas activas con presupuesto suficiente y valida que el tracking de conversiones esté funcionando para poder evaluar el rendimiento real.',
        estimatedImpact: 'medio',
        accountRef: { id: firstAcc?.id || '', name: accName || platform },
        campaignRef: null,
        metrics: { impressions: impr, clicks: clk, cost, conversions: conv, value }
      };
    }

    // Hay conversiones
    if (conv > 0) {
      return {
        title: `[${accName || platform}] Optimiza presupuesto según desempeño global`,
        area: 'performance',
        severity: 'media',
        evidence: `A nivel agregado se observan ${fmt(clk,0)} clics, ${fmt(conv,0)} conversiones, ROAS ${fmt(roas)} y CPA ${fmt(cpa)} en el periodo.`,
        recommendation: 'Clasifica las campañas en ganadoras, neutras y débiles según su ROAS/CPA frente al promedio. Sube presupuesto y pujas en las ganadoras, mantén bajo observación las neutras y reduce o pausa las débiles redirigiendo inversión a las mejores.',
        estimatedImpact: 'medio',
        accountRef: { id: firstAcc?.id || '', name: accName || platform },
        campaignRef: null,
        metrics: {
          impressions: impr,
          clicks: clk,
          cost: fmt(cost),
          conversions: fmt(conv,0),
          roas: fmt(roas),
          cpa: fmt(cpa)
        }
      };
    }

    // Hay tráfico/gasto pero 0 conversiones
    return {
      title: `[${accName || platform}] Tráfico sin conversiones a nivel cuenta`,
      area: 'tracking',
      severity: 'alta',
      evidence: `A nivel cuenta hay ${fmt(clk,0)} clics y un gasto de ${fmt(cost)} con 0 conversiones registradas.`,
      recommendation: 'Prioriza revisar el tracking de conversiones (etiquetas, eventos y objetivos). Una vez validado, identifica campañas y segmentos con peor comportamiento y aplica exclusiones, ajustes de audiencia y pruebas de creatividades para mejorar el funnel.',
      estimatedImpact: 'alto',
      accountRef: { id: firstAcc?.id || '', name: accName || platform },
      campaignRef: null,
      metrics: { impressions: impr, clicks: clk, cost: fmt(cost), conversions: conv }
    };
  }

  // GA4
  if (isGA(type)) {
    const channels = Array.isArray(inputSnapshot.channels) ? inputSnapshot.channels : [];
    const byProperty = Array.isArray(inputSnapshot.byProperty) ? inputSnapshot.byProperty : [];
    const firstProp = byProperty[0] || {};
    const propName = inputSnapshot.propertyName || firstProp.propertyName || 'Propiedad GA4';
    const propId   = inputSnapshot.property || firstProp.property || '';

    const totals = channels.reduce((a, c) => ({
      users:       a.users + toNum(c.users),
      sessions:    a.sessions + toNum(c.sessions),
      conversions: a.conversions + toNum(c.conversions),
      revenue:     a.revenue + toNum(c.revenue),
    }), { users: 0, sessions: 0, conversions: 0, revenue: 0 });

    // Sin datos
    if (totals.sessions === 0 && totals.conversions === 0 && totals.revenue === 0) {
      return {
        title: 'Poco tráfico medido en GA4',
        area: 'setup',
        severity: 'media',
        evidence: 'La propiedad conectada muestra muy poco o ningún tráfico en el rango analizado.',
        recommendation: 'Comprueba que el tag de GA4 esté instalado correctamente (sin bloqueos por consent o adblockers) y que la vista conectada sea la que realmente recibe tráfico del sitio.',
        estimatedImpact: 'medio',
        segmentRef: { type: 'channel', name: 'all' },
        accountRef: { name: propName, property: propId },
        metrics: { sessions: totals.sessions, conversions: totals.conversions, revenue: totals.revenue }
      };
    }

    // Tráfico pero 0 conversiones
    if (totals.sessions > 0 && totals.conversions === 0) {
      return {
        title: 'Tráfico sin conversiones medibles en GA4',
        area: 'tracking',
        severity: 'alta',
        evidence: `${fmt(totals.sessions,0)} sesiones registradas y 0 conversiones en el periodo.`,
        recommendation: 'Revisa la definición de eventos de conversión en GA4 (marcar como conversión, parámetros clave, debugview) y asegúrate de que los eventos del sitio/app estén disparando correctamente y mapeados a objetivos de negocio.',
        estimatedImpact: 'alto',
        segmentRef: { type: 'channel', name: 'all' },
        accountRef: { name: propName, property: propId },
        metrics: { sessions: fmt(totals.sessions,0), conversions: 0 }
      };
    }

    // Tráfico y conversiones → optimización del embudo
    return {
      title: 'Optimiza el embudo según canales de mayor impacto',
      area: 'performance',
      severity: 'media',
      evidence: `A nivel global se observan ${fmt(totals.sessions,0)} sesiones y ${fmt(totals.conversions,0)} conversiones en el periodo.`,
      recommendation: 'Identifica los canales con mejor tasa de conversión y mayor revenue por sesión, refuerza su inversión/visibilidad y revisa el comportamiento de los canales débiles para mejorar mensajes, landings y pasos del embudo donde se pierden usuarios.',
      estimatedImpact: 'medio',
      segmentRef: { type: 'channel', name: 'all' },
      accountRef: { name: propName, property: propId },
      metrics: {
        sessions: fmt(totals.sessions,0),
        conversions: fmt(totals.conversions,0),
        revenue: fmt(totals.revenue,2)
      }
    };
  }

  return null;
}

/* ----------------------------- prompts ----------------------------- */
const SYSTEM_ADS = (platform) => `
Eres un auditor senior de ${platform} enfocado en performance marketing.
Objetivo: detectar puntos críticos y oportunidades accionables con alta claridad y rigor.
Debes priorizar campañas ACTIVAS; las campañas pausadas solo sirven como contexto histórico.
Si detectas que todas las campañas están pausadas/inactivas, explícalo claramente y enfoca
las recomendaciones en qué reactivar, cómo reestructurar y cómo testear de forma segura.
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
- Usa el campo "status" de las campañas (active/paused/unknown):
  - Prioriza campañas con status "active".
  - Las campañas "paused" o "inactive" solo deben generar hallazgos si aportan contexto
    (por ejemplo: hubo gasto fuerte en el pasado o hay una estructura mal diseñada).
  - Si detectas que todas las campañas están pausadas/inactivas, indícalo explícitamente
    en alguno de los issues y orienta la recomendación a qué tipo de campañas reactivar
    o cómo relanzar la cuenta.
- En el título CITA la cuenta: formato sugerido "[{accountRef.name||accountRef.id}] {campaignRef.name}: ...".
- Si hay varias cuentas, agrupa mentalmente los hallazgos por cuenta para no mezclar mensajes.
  `.trim();

  const gaExtras = `
- Cada issue DEBE incluir:
  - accountRef con { name, property }
  - segmentRef con el canal (por ejemplo "Organic Search", "Paid Social", etc.).
- Si hay varias propiedades, enfoca los hallazgos en las que tienen más sesiones/conversiones.
  `.trim();

  return `
CONSIGNA
- Devuelve JSON válido EXACTAMENTE con: { "summary": string, "issues": Issue[] }.
- Entre 1 y ${maxFindings} issues como máximo cuando haya datos suficientes.
- Si los datos son suficientes, intenta acercarte a ${maxFindings} issues sin inventar hallazgos;
  si detectas pocos problemas reales, devuelve menos issues pero al menos 1.
- Idioma: español neutro, directo y claro.
- Prohibido inventar métricas o campañas/canales no presentes en el snapshot.
- Cada "issue" DEBE incluir:
  ${isAnalytics ? gaExtras : adsExtras}
  - evidence con métricas textuales del snapshot
  - recommendation con pasos concretos (no genéricos)
  - estimatedImpact coherente con la evidencia

PRIORIDAD (de mayor a menor)
1) Tracking roto/ausente o discrepancias que impidan optimizar.
2) Gasto ineficiente: gasto alto sin conversiones o ROAS bajo.
3) Oportunidades de creatividad/segmentación/puja/estructura.
4) Problemas de setup/higiene solo si afectan resultados.

CASOS ESPECIALES IMPORTANTE
- Si el snapshot indica que TODAS las campañas están pausadas/inactivas, debes
  mencionarlo en al menos un issue y enfocar las recomendaciones en cómo reactivar
  la cuenta de forma inteligente (qué priorizar, estructura sugerida, tests, etc.).
- Si hay muchas campañas, concéntrate en las que tienen más gasto, impresiones o
  volumen de conversiones según los KPIs disponibles.

ESTILO
- Títulos concisos (p. ej. "Gasto sin conversiones en {campaña}" o "[{cuenta}] {campaña}: ROAS bajo").
- Evidencia SIEMPRE con números del snapshot (ej. "10,172 sesiones, 23 conversiones, ROAS 0.42").
- Recomendaciones en imperativo y específicas (qué tocar, dónde y con umbrales sugeridos).

DATOS (snapshot reducido)
${snapshotStr}

FORMATO JSON
${isAnalytics ? SCHEMA_GA : SCHEMA_ADS}
`.trim();
}

/* ---------------------- OpenAI JSON con reintentos --------------------- */
async function chatJSON({ system, user, model = DEFAULT_MODEL, retries = 2 }) {
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
// maxFindings viene de auditJob (según plan). Default 5 por seguridad.
module.exports = async function generateAudit({ type, inputSnapshot, maxFindings = 5 }) {
  const analytics = isGA(type);

  const haveAdsData = Array.isArray(inputSnapshot?.byCampaign) && inputSnapshot.byCampaign.length > 0;
  const haveGAData  =
    (Array.isArray(inputSnapshot?.channels)   && inputSnapshot.channels.length   > 0) ||
    (Array.isArray(inputSnapshot?.byProperty) && inputSnapshot.byProperty.length > 0);

  const haveData = analytics ? haveGAData : haveAdsData;

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

  const userPrompt = makeUserPrompt({ snapshotStr: dataStr, maxFindings, isAnalytics: analytics });

  // modelo configurable
  const model = DEFAULT_MODEL;

  // 1) intentar con LLM
  let parsed;
  try {
    parsed = await chatJSON({ system, user: userPrompt, model });
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
  if ((!issues || issues.length < maxFindings) && haveData) {
    const current = issues?.length || 0;
    const need = maxFindings - current;
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

  // 5) Si HAY datos pero seguimos sin issues, generamos uno genérico
  if (haveData && (!issues || issues.length === 0)) {
    const generic = buildGenericIssue({ type, inputSnapshot });
    if (generic) {
      issues = [generic];
      if (!summary) {
        summary = analytics
          ? 'Resumen basado en datos agregados de GA4, con foco en calidad de medición y eficiencia del embudo.'
          : 'Resumen basado en métricas agregadas de la cuenta, con foco en eficiencia de inversión y tracking.';
      }
    }
  }

  // 6) si no hay datos reales y el LLM tampoco generó nada, devolvemos vacío
  if (!haveData && (!issues || issues.length === 0)) {
    return { summary: '', issues: [] };
  }

  return { summary, issues };
};
