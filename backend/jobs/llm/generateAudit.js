// backend/jobs/llm/generateAudit.js
'use strict';

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Modelo por defecto (sobrescribible por ENV)
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

/**
 * Snapshot reducido para mandar al LLM
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

/* ----------------------- fallback determinístico ---------------------- */
function fallbackIssues({ type, inputSnapshot, limit = 6, trend = null, previousSnapshot = null, previousAudit = null }) {
  const out = [];

  const cpaHigh = Number(inputSnapshot?.targets?.cpaHigh || 0) || null;

  // ------------------ GOOGLE ADS / META ADS -------------------
  if (type === 'google' || type === 'meta') {
    const rawList = Array.isArray(inputSnapshot?.byCampaign) ? inputSnapshot.byCampaign : [];

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

    // Todas pausadas/inactivas
    if (anyWithStatus && active.length === 0 && paused.length > 0 && paused.length === enriched.length) {
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

    const list = active.length > 0 ? active : enriched;

    // Métricas globales para posibles issues agregados
    let totalImpr = 0, totalClk = 0, totalCost = 0, totalConv = 0, totalVal = 0;
    for (const c of list) {
      const k = c.kpis || {};
      totalImpr += toNum(k.impressions);
      totalClk  += toNum(k.clicks);
      totalCost += toNum(k.cost ?? k.spend);
      totalConv += toNum(k.conversions);
      totalVal  += toNum(k.conv_value ?? k.purchase_value);
    }
    const globalCtr  = totalImpr > 0 ? (totalClk / totalImpr) * 100 : 0; // por si lo quieres usar a futuro
    const globalRoas = totalCost > 0 ? (totalVal / totalCost) : 0;
    const globalCpa  = totalConv > 0 ? (totalCost / totalConv) : 0;

    // Reglas por campaña (problemas)
    for (const c of list.slice(0, 100)) {
      if (out.length >= limit) break;

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
      if (impr > 1000 && ctr < 1 && out.length < limit) {
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
      if (clk >= 150 && conv === 0 && cost > 0 && out.length < limit) {
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
      if (value > 0 && roas > 0 && roas < 1 && cost > 100 && out.length < limit) {
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

      // 4) CPA alto vs objetivo
      if (cpaHigh && conv > 0 && cpa > cpaHigh * 1.1 && cost > 50 && out.length < limit) {
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
    }

    // --- Insight de mejora/empeoramiento vs auditoría anterior (Ads) ---
    if (trend && trend.deltas && out.length < limit) {
      const dConv = trend.deltas.conversions;
      const dRoas = trend.deltas.roas;
      const convPct = dConv ? dConv.percent : 0;
      const roasPct = dRoas ? dRoas.percent : 0;

      const improved =
        (dConv && dConv.previous > 0 && convPct >= 15) ||
        (dRoas && dRoas.previous > 0 && roasPct >= 15);

      const worsened =
        (dConv && dConv.previous > 0 && convPct <= -15) ||
        (dRoas && dRoas.previous > 0 && roasPct <= -15);

      if (improved) {
        out.push({
          title: 'Buen avance respecto a la auditoría anterior',
          area: 'performance',
          severity: 'baja',
          evidence: [
            dConv ? `Conversiones: ${fmt(dConv.previous,0)} → ${fmt(dConv.current,0)} (${fmt(dConv.percent,1)}%).` : null,
            dRoas ? `ROAS: ${fmt(dRoas.previous,2)} → ${fmt(dRoas.current,2)} (${fmt(dRoas.percent,1)}%).` : null
          ].filter(Boolean).join(' '),
          recommendation: 'Mantén los cambios que generaron la mejora (segmentaciones, creatividades, pujas) y documenta qué se modificó. Aprovecha para escalar campañas ganadoras y seguir probando variaciones de anuncios.',
          estimatedImpact: 'medio',
          accountRef: null,
          campaignRef: null,
          metrics: {
            conversions_prev: dConv?.previous,
            conversions_curr: dConv?.current,
            roas_prev: dRoas?.previous,
            roas_curr: dRoas?.current
          }
        });
      } else if (worsened) {
        out.push({
          title: 'Advertencia: el rendimiento bajó vs la auditoría anterior',
          area: 'performance',
          severity: 'alta',
          evidence: [
            dConv ? `Conversiones: ${fmt(dConv.previous,0)} → ${fmt(dConv.current,0)} (${fmt(dConv.percent,1)}%).` : null,
            dRoas ? `ROAS: ${fmt(dRoas.previous,2)} → ${fmt(dRoas.current,2)} (${fmt(dRoas.percent,1)}%).` : null
          ].filter(Boolean).join(' '),
          recommendation: 'Revisa qué cambios se hicieron desde la auditoría anterior (campañas pausadas/activadas, cambios de presupuesto o puja, nuevas creatividades) y vuelve a concentrar inversión en las campañas y segmentos que antes tenían mejor rendimiento.',
          estimatedImpact: 'alto',
          accountRef: null,
          campaignRef: null,
          metrics: {
            conversions_prev: dConv?.previous,
            conversions_curr: dConv?.current,
            roas_prev: dRoas?.previous,
            roas_curr: dRoas?.current
          }
        });
      }
    }

    // --- Si no se detectó nada “malo”, generamos oportunidades de optimización ---
    if (out.length < limit && list.length > 0) {
      const remaining = limit - out.length;

      // Top campañas por gasto
      const byCost = [...list].sort((a,b) => {
        const ka = a.kpis || {};
        const kb = b.kpis || {};
        return (kb.cost ?? kb.spend ?? 0) - (ka.cost ?? ka.spend ?? 0);
      });

      const best = byCost[0];
      if (best && remaining > 0) {
        const k = best.kpis || {};
        const cost   = toNum(k.cost ?? k.spend);
        const conv   = toNum(k.conversions);
        const value  = toNum(k.conv_value ?? k.purchase_value);
        const roas   = cost > 0 ? (value / cost) : 0;
        const cpa    = conv > 0 ? (cost / conv) : 0;
        const accountRef = {
          id: String(best.account_id ?? ''),
          name: inferAccountName(best, inputSnapshot) || ''
        };

        out.push({
          title: `[${accountRef.name || accountRef.id}] Escala campañas ganadoras y redistribuye presupuesto`,
          area: 'performance',
          severity: 'media',
          evidence: `A nivel cuenta se gastaron ${fmt(totalCost)} con ${fmt(totalConv,0)} conversiones y ROAS global ${fmt(globalRoas)}. La campaña "${best.name || best.id}" concentra la mayor parte del gasto con ROAS ${fmt(roas)} y CPA ${fmt(cpa)}.`,
          recommendation: 'Identifica las campañas con mejor ROAS/CPA y aumenta gradualmente su presupuesto (10-20% cada pocos días), mientras reduces inversión en campañas con rendimiento por debajo del promedio global. Evita tener muchas campañas pequeñas compitiendo por el mismo público.',
          estimatedImpact: 'medio',
          accountRef,
          campaignRef: { id: String(best.id ?? ''), name: String(best.name ?? best.id ?? '') },
          metrics: {
            globalCost: fmt(totalCost),
            globalConversions: fmt(totalConv,0),
            globalRoas: fmt(globalRoas),
            campaignCost: fmt(cost),
            campaignConversions: fmt(conv,0),
            campaignRoas: fmt(roas),
            campaignCpa: fmt(cpa)
          }
        });
      }

      // Segundo issue opcional sobre estructura si aún hay espacio
      if (remaining > 1 && list.length > 5) {
        out.push({
          title: 'Simplifica la estructura de campañas para concentrar aprendizaje',
          area: 'setup',
          severity: 'baja',
          evidence: `Se detectaron ${list.length} campañas activas/recientes, lo que puede fragmentar impresiones, presupuesto y aprendizaje del algoritmo.`,
          recommendation: 'Agrupa campañas redundantes (mismo objetivo, país y tipo de puja) y prioriza tener menos campañas con mayor volumen por cada una. Esto acelera el aprendizaje, estabiliza el CPA/ROAS y facilita probar creatividades de forma ordenada.',
          estimatedImpact: 'medio',
          accountRef: null,
          campaignRef: null,
          metrics: { activeOrRecentCampaigns: list.length }
        });
      }
    }

    return cap(out, limit);
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

    if (channels.length > 0) {
      if (totals.sessions > 500 && totals.conversions === 0 && out.length < limit) {
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
      if (paidSess > 200 && paidConv === 0 && out.length < limit) {
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

      // Issue de oportunidad: escalar canales ganadores y optimizar débiles
      if (out.length < limit && channels.length > 1) {
        const withRates = channels.map(ch => {
          const sessions = toNum(ch.sessions);
          const conv     = toNum(ch.conversions);
          const revenue  = toNum(ch.revenue);
          const cr       = sessions > 0 ? (conv / sessions) * 100 : 0;
          const rps      = sessions > 0 ? (revenue / sessions) : 0;
          return { ...ch, _cr: cr, _rps: rps };
        });

        const best = [...withRates].sort((a,b) => (b._rps - a._rps))[0];
        const worst = [...withRates].sort((a,b) => (a._cr - b._cr))[0];

        if (best && worst && best.channel !== worst.channel) {
          out.push({
            title: 'Optimiza el embudo según canales de mayor impacto',
            area: 'performance',
            severity: 'media',
            evidence: `A nivel global se observan ${fmt(totals.sessions,0)} sesiones y ${fmt(totals.conversions,0)} conversiones. El canal "${best.channel}" destaca por mayor revenue por sesión, mientras que "${worst.channel}" tiene la tasa de conversión más baja.`,
            recommendation: 'Refuerza inversión y presencia en el canal con mayor revenue por sesión (más creatividades, mejores landings y pruebas de mensajes), y revisa el funnel de los canales débiles para mejorar mensajes, pasos del embudo y experiencia de usuario donde se pierden usuarios.',
            estimatedImpact: 'medio',
            segmentRef: { type: 'channel', name: best.channel },
            accountRef: { name: propName || (propId || 'GA4'), property: propId || '' },
            metrics: {
              totalSessions: fmt(totals.sessions,0),
              totalConversions: fmt(totals.conversions,0),
              bestChannel: best.channel,
              bestChannelRevenuePerSession: fmt(best._rps),
              worstChannel: worst.channel,
              worstChannelCR: fmt(worst._cr)
            }
          });
        }
      }
    }

    // Insight de mejora/empeoramiento vs auditoría anterior (GA)
    if (trend && trend.deltas && out.length < limit) {
      const dConv = trend.deltas.conversions;
      const dCr   = trend.deltas.cr;
      const convPct = dConv ? dConv.percent : 0;
      const crPct   = dCr ? dCr.percent : 0;

      const improved =
        (dConv && dConv.previous > 0 && convPct >= 15) ||
        (dCr && dCr.previous > 0 && crPct >= 15);

      const worsened =
        (dConv && dConv.previous > 0 && convPct <= -15) ||
        (dCr && dCr.previous > 0 && crPct <= -15);

      if (improved) {
        out.push({
          title: 'Mejora en el embudo vs la auditoría anterior',
          area: 'performance',
          severity: 'baja',
          evidence: [
            dConv ? `Conversiones: ${fmt(dConv.previous,0)} → ${fmt(dConv.current,0)} (${fmt(dConv.percent,1)}%).` : null,
            dCr ? `CR global: ${fmt(dCr.previous,2)}% → ${fmt(dCr.current,2)}% (${fmt(dCr.percent,1)}%).` : null
          ].filter(Boolean).join(' '),
          recommendation: 'Identifica qué cambios del funnel (mensajes, landings, pasos, canales) explican la mejora y consolídalos. A partir de ahí, diseña nuevos tests A/B para seguir aumentando la tasa de conversión sin perder calidad de tráfico.',
          estimatedImpact: 'medio',
          segmentRef: { type: 'channel', name: 'all' },
          accountRef: { name: propName || (propId || 'GA4'), property: propId || '' },
          metrics: {}
        });
      } else if (worsened) {
        out.push({
          title: 'Advertencia: el embudo rinde peor que en la auditoría anterior',
          area: 'tracking',
          severity: 'alta',
          evidence: [
            dConv ? `Conversiones: ${fmt(dConv.previous,0)} → ${fmt(dConv.current,0)} (${fmt(dConv.percent,1)}%).` : null,
            dCr ? `CR global: ${fmt(dCr.previous,2)}% → ${fmt(dCr.current,2)}% (${fmt(dCr.percent,1)}%).` : null
          ].filter(Boolean).join(' '),
          recommendation: 'Revisa qué cambios se hicieron en páginas clave, mensajes y configuración de eventos desde la auditoría anterior. Recupera la versión que funcionaba mejor o crea una variante inspirada en los elementos previos que daban mejor CR.',
          estimatedImpact: 'alto',
          segmentRef: { type: 'channel', name: 'all' },
          accountRef: { name: propName || (propId || 'GA4'), property: propId || '' },
          metrics: {}
        });
      }
    }

    // Sin channels pero con byProperty
    if (channels.length === 0 && byProperty.length > 0 && out.length < limit) {
      const pSessions    = toNum(firstProp.sessions);
      const pConversions = toNum(firstProp.conversions);
      const pRevenue     = toNum(firstProp.revenue);

      if (pSessions === 0 && pConversions === 0 && pRevenue === 0) {
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

    return cap(out, limit);
  }

  return cap(out, limit);
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

function makeUserPrompt({ snapshotStr, historyStr, maxFindings, minFindings, isAnalytics }) {
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
- Cada "issue" DEBE incluir:
  ${isAnalytics ? gaExtras : adsExtras}
  - evidence con métricas textuales del snapshot
  - recommendation con pasos concretos (no genéricos)
  - estimatedImpact coherente con la evidencia

USO DEL CONTEXTO HISTÓRICO (si existe)
- Lee el bloque CONTEXTO_HISTORICO cuando aparezca.
- Si ves mejoras claras vs la auditoría anterior (por ejemplo sube ROAS, bajan CPA o suben conversiones),
  menciónalo en el "summary" y crea al menos un issue tipo "mejora" explicando qué mejoró y cómo consolidarlo.
- Si ves deterioros claros, crea al menos un issue de advertencia comparando explícitamente "antes vs ahora"
  y proponiendo acciones para recuperar o superar el rendimiento anterior.
- Evita repetir literalmente los mismos títulos y textos de la auditoría anterior: mantén la idea,
  pero actualiza la evidencia, los matices y los siguientes pasos.

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

${historyBlock ? historyBlock + '\n' : ''}

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
module.exports = async function generateAudit({
  type,
  inputSnapshot,
  maxFindings = 5,
  minFindings = 1,
  previousSnapshot = null,
  previousAudit = null,
  trend = null,
}) {
  const analytics = isGA(type);

  const haveAdsData = Array.isArray(inputSnapshot?.byCampaign) && inputSnapshot.byCampaign.length > 0;
  const haveGAData  =
    (Array.isArray(inputSnapshot?.channels)   && inputSnapshot.channels.length   > 0) ||
    (Array.isArray(inputSnapshot?.byProperty) && inputSnapshot.byProperty.length > 0);

  const haveData = analytics ? haveGAData : haveAdsData;

  const system = analytics
    ? SYSTEM_GA
    : SYSTEM_ADS(type === 'google' ? 'Google Ads' : 'Meta Ads');

  const dataStr     = tinySnapshot(inputSnapshot);
  const historyStr  = buildHistoryContext({ type, previousAudit, trend });

  if (process.env.DEBUG_AUDIT === 'true') {
    console.log('[LLM:IN]', type, {
      hasByCampaign: !!inputSnapshot?.byCampaign?.length,
      hasChannels: !!inputSnapshot?.channels?.length,
      hasByProperty: !!inputSnapshot?.byProperty?.length,
      hasHistory: !!historyStr,
    });
    console.log('[LLM:SNAPSHOT]', tinySnapshot(inputSnapshot, { maxChars: 2000 }));
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
  }

  // 3) fallback si hay pocos hallazgos y sí hay datos
  const desired = Math.max(minFindings, maxFindings);
  if ((!issues || issues.length < desired) && haveData) {
    const current = issues?.length || 0;
    const need = desired - current;
    if (need > 0) {
      const fb = fallbackIssues({
        type,
        inputSnapshot,
        limit: need,
        trend,
        previousSnapshot,
        previousAudit,
      }).map((it, idx) => ({
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

  // 5) si no hay datos reales y tampoco issues, devolvemos vacío
  if (!haveData && issues.length === 0) {
    return { summary: '', issues: [] };
  }

  return { summary, issues };
};
