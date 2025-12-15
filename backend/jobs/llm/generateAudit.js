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
    const key =
      `${(it.title || '').trim().toLowerCase()}::` +
      `${it.accountRef?.id || it.accountRef?.property || ''}::` +
      `${it.campaignRef?.id || ''}::` +
      `${it.segmentRef?.type || ''}::${it.segmentRef?.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/* ---------------------- Emojis (controlados y profesionales) ---------- */
const AREA_EMOJI = {
  setup: '🧩',
  performance: '📈',
  creative: '🎨',
  tracking: '🎯',
  budget: '💰',
  bidding: '🤖'
};

const SEV_EMOJI = {
  alta: '🚨',
  media: '⚠️',
  baja: '✅'
};

function startsWithEmoji(str = '') {
  const s = String(str || '').trim();
  if (!s) return false;
  try {
    // Node 18+ soporta unicode property escapes
    return /^\p{Extended_Pictographic}/u.test(s);
  } catch {
    // fallback simple (no perfecto, pero seguro)
    const c = s.codePointAt(0) || 0;
    return c > 0x1F000;
  }
}

function applyEmojiToTitle(issue) {
  if (!issue || !issue.title) return issue;
  const title = String(issue.title || '').trim();
  if (!title) return issue;
  if (startsWithEmoji(title)) return issue;

  // 1 emoji máximo por título:
  // - alta => 🚨
  // - media/baja => emoji por área
  const sev = sevNorm(issue.severity);
  const area = areaNorm(issue.area);

  const prefix =
    sev === 'alta'
      ? SEV_EMOJI.alta
      : (AREA_EMOJI[area] || '📌');

  issue.title = `${prefix} ${title}`.slice(0, 120);
  return issue;
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
      status: normStatus(c.status || c.state || c.servingStatus || c.effectiveStatus),
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
      status: normStatus(c.status || c.state || c.servingStatus || c.effectiveStatus),
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
      status: normStatus(c.status || c.state || c.servingStatus || c.effectiveStatus),
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

  // ✅ nuevas señales: “ganadoras” activas/pausadas (oportunidad)
  const withRoas = byCampaign
    .map(c => {
      const cost = safeNum(c?.kpis?.cost ?? c?.kpis?.spend);
      const val  = safeNum(c?.kpis?.conv_value ?? c?.kpis?.purchase_value);
      const conv = safeNum(c?.kpis?.conversions);
      const roas = safeDiv(val, cost);
      const status = normStatus(c.status || c.state || c.servingStatus || c.effectiveStatus);
      return { ...c, _cost: cost, _val: val, _conv: conv, _roas: roas, _status: status };
    })
    .filter(x => x._cost > 0 || x._conv > 0 || x._val > 0);

  const activeWinners = [...withRoas]
    .filter(x => x._status === 'active' && x._cost > 0 && x._val > 0)
    .sort((a, b) => b._roas - a._roas)
    .slice(0, 5)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      roas: c._roas,
      cost: c._cost,
      conv_value: c._val,
      conversions: c._conv,
    }));

  const pausedWinners = [...withRoas]
    .filter(x => x._status === 'paused' && (x._val > 0 || x._conv > 0))
    .sort((a, b) => (b._roas || 0) - (a._roas || 0))
    .slice(0, 5)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      roas: c._roas,
      cost: c._cost,
      conv_value: c._val,
      conversions: c._conv,
    }));

  const activeCount = byCampaign.filter(c => normStatus(c.status || c.state || c.servingStatus || c.effectiveStatus) === 'active').length;
  const pausedCount = byCampaign.filter(c => normStatus(c.status || c.state || c.servingStatus || c.effectiveStatus) === 'paused').length;

  return {
    kpis: {
      impressions: globalImpr,
      clicks: globalClicks,
      conversions: globalConv,
      ctr: globalCtr,
      cr: globalCr,
    },
    counts: { activeCount, pausedCount, totalCampaigns: byCampaign.length },
    worstCpaCampaigns,
    lowCtrCampaigns,
    limitedLearning,
    structureIssues,
    activeWinners,
    pausedWinners
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

  // ✅ oportunidades GA4 (ganadores)
  const bestChannels = channels
    .map(ch => {
      const sessions = safeNum(ch.sessions);
      const conv     = safeNum(ch.conversions);
      const cr       = safeDiv(conv, sessions);
      return { channel: ch.channel, sessions, conversions: conv, convRate: cr, revenue: safeNum(ch.revenue) };
    })
    .filter(x => x.sessions > 300)
    .sort((a, b) => (b.convRate - a.convRate) || (b.conversions - a.conversions))
    .slice(0, 5);

  const bestLandingPages = landings
    .map(lp => {
      const sessions = safeNum(lp.sessions);
      const conv     = safeNum(lp.conversions);
      const cr       = safeDiv(conv, sessions);
      return { page: lp.page, sessions, conversions: conv, convRate: cr, revenue: safeNum(lp.revenue) };
    })
    .filter(x => x.sessions > 200)
    .sort((a, b) => (b.convRate - a.convRate) || (b.conversions - a.conversions))
    .slice(0, 5);

  // tracking flags
  const sessionsLargeNoConv = totalSessions >= 500 && totalConv === 0;
  const hasPurchaseLikeEvent = topEvents.some(e => String(e.event || '').toLowerCase().includes('purchase'));
  const hasLeadLikeEvent = topEvents.some(e => {
    const n = String(e.event || '').toLowerCase();
    return n.includes('generate_lead') || n.includes('lead') || n.includes('form');
  });

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

  // source/medium oportunidades (si existe)
  const bestSourceMedium = sourceMedium
    .map(x => {
      const sessions = safeNum(x.sessions);
      const conv = safeNum(x.conversions);
      const cr = safeDiv(conv, sessions);
      return {
        source: x.source,
        medium: x.medium,
        sessions,
        conversions: conv,
        convRate: cr,
        revenue: safeNum(x.revenue)
      };
    })
    .filter(x => x.sessions > 200)
    .sort((a, b) => (b.convRate - a.convRate) || (b.conversions - a.conversions))
    .slice(0, 5);

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
    bestChannels,
    bestLandingPages,
    bestSourceMedium,
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

  const mapped = byCampaign.map(c => {
    const spend = safeNum(c?.kpis?.spend ?? c?.kpis?.cost);
    const conv  = safeNum(c?.kpis?.conversions);
    const val   = safeNum(c?.kpis?.purchase_value ?? c?.kpis?.conv_value);
    const impr  = safeNum(c?.kpis?.impressions);
    const clicks= safeNum(c?.kpis?.clicks);
    const status = normStatus(c.status || c.state || c.servingStatus || c.effectiveStatus);
    const roas = safeDiv(val, spend);
    const cpa  = safeDiv(spend, conv);
    return { ...c, _spend: spend, _conv: conv, _val: val, _impr: impr, _clicks: clicks, _status: status, _roas: roas, _cpa: cpa };
  });

  const highSpendNoConvAdsets = mapped
    .filter(c => c._spend > 100 && c._conv === 0)
    .sort((a, b) => b._spend - a._spend)
    .slice(0, 10)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      status: c._status,
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
      status: c._status,
      impressions: c._impr,
      clicks: c._clicks,
      ctr: c._ctr,
    }));

  const activeWinners = [...mapped]
    .filter(c => c._status === 'active' && c._spend > 0 && (c._val > 0 || c._conv > 0))
    .sort((a, b) => (b._roas - a._roas) || (b._conv - a._conv))
    .slice(0, 5)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      roas: c._roas,
      spend: c._spend,
      conv_value: c._val,
      conversions: c._conv,
      cpa: c._cpa
    }));

  const pausedWinners = [...mapped]
    .filter(c => c._status === 'paused' && (c._val > 0 || c._conv > 0))
    .sort((a, b) => (b._roas - a._roas) || (b._conv - a._conv))
    .slice(0, 5)
    .map(c => ({
      accountId: String(c.account_id ?? ''),
      campaignId: String(c.id ?? ''),
      campaignName: String(c.name ?? ''),
      roas: c._roas,
      spend: c._spend,
      conv_value: c._val,
      conversions: c._conv,
      cpa: c._cpa
    }));

  const activeCount = mapped.filter(x => x._status === 'active').length;
  const pausedCount = mapped.filter(x => x._status === 'paused').length;

  return {
    kpis: {
      spend: totalSpend,
      conversions: totalConv,
      clicks: totalClicks,
      impressions: totalImpr,
      ctr: globalCtr,
      cr: globalCr,
    },
    counts: { activeCount, pausedCount, totalCampaigns: byCampaign.length },
    highSpendNoConvAdsets,
    lowCtrAdsets,
    activeWinners,
    pausedWinners
  };
}

function buildDiagnostics(source, snapshot) {
  const type = String(source || '').toLowerCase();
  if (type === 'google' || type === 'googleads' || type === 'gads') return { google: buildGoogleDiagnostics(snapshot) };
  if (type === 'ga' || type === 'ga4' || type === 'google-analytics' || type === 'analytics') return { ga4: buildGa4Diagnostics(snapshot) };
  if (type === 'meta' || type === 'metaads' || type === 'facebook') return { meta: buildMetaDiagnostics(snapshot) };
  return {};
}

/* ---------------- snapshot compacto (compatible + señales extra) ------ */
function tinySnapshot(inputSnapshot, { maxChars = 70_000 } = {}) {
  try {
    const clone = JSON.parse(JSON.stringify(inputSnapshot || {}));

    if (Array.isArray(clone.byCampaign)) {
      const rawList = clone.byCampaign.map(c => {
        const statusNorm = normStatus(
          c.status || c.state || c.servingStatus || c.serving_status || c.effectiveStatus
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

    if (Array.isArray(clone.topEvents)) {
      clone.topEvents = clone.topEvents
        .slice(0, 80)
        .map(e => ({
          event: e.event,
          eventCount: toNum(e.eventCount),
          conversions: toNum(e.conversions),
        }));
    }

    if (Array.isArray(clone.byProperty)) {
      clone.byProperty = clone.byProperty.slice(0, 10).map(p => ({
        property:     p.property,
        propertyName: p.propertyName,
        accountName:  p.accountName,
        users:       toNum(p.users ?? p?.kpis?.users),
        sessions:    toNum(p.sessions ?? p?.kpis?.sessions),
        conversions: toNum(p.conversions ?? p?.kpis?.conversions),
        revenue:     toNum(p.revenue ?? p?.kpis?.revenue),
        engagementRate: toNum(p?.kpis?.engagementRate),
      }));
    }

    if (Array.isArray(clone.properties)) {
      clone.properties = clone.properties.slice(0, 10).map(p => ({
        id:           p.id,
        accountName:  p.accountName,
        propertyName: p.propertyName
      }));
    }

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
Auditas con mentalidad de negocio: priorizas ROAS, CPA/CPC y volumen de conversiones.

REGLAS DE PRIORIZACIÓN (muy importante):
- Si existen campañas ACTIVAS (status=active), entonces:
  - 80% de los issues deben basarse en campañas ACTIVAS con impacto material (gasto/impresiones/conversiones).
  - Puedes incluir como máximo 1 issue sobre campañas PAUSADAS solo si es una oportunidad clara (reactivar una ganadora, rescatar un setup útil, o comparar contra una activa).
- Si NO hay campañas activas, entonces sí puedes usar PAUSADAS como base principal (y debes explicarlo).
- Prioriza siempre lo “relevante”: campañas con gasto significativo, o que expliquen la mayoría del rendimiento (bueno o malo).

Cómo detectar “oportunidades” (además de problemas):
- Escalado: campañas activas con ROAS alto / CPA bajo / buen volumen → propón cómo escalar sin romper eficiencia.
- Reactivación: campañas pausadas con conversiones y/o ROAS fuerte → propone reactivación controlada y validación.
- Recorte: gasto alto sin conversiones, CTR bajo con volumen, aprendizaje limitado.

Uso de datos:
- Cada issue debe incluir evidencia numérica concreta del snapshot (gasto, impresiones, CTR, conversiones, ROAS, CPA...).
- Si existe "diagnostics", úsalo como radar (worstCpa, lowCtr, highSpendNoConv, limitedLearning, structureIssues, activeWinners, pausedWinners).

Formato y estilo:
- Tono: español neutro, directo, profesional, sin relleno.
- Emojis: usa 1 emoji al inicio del title como máximo (ej: "📈", "🎯", "💰", "🚨"). No uses emojis en evidence/recommendation.
- Devuelve exclusivamente JSON válido (response_format json_object). No agregues texto fuera del JSON.
- Nunca inventes campañas o métricas.
`.trim();

const SYSTEM_GA = `
Eres un consultor senior de analítica digital especializado en Google Analytics 4 (GA4).
Tu rol es convertir datos en decisiones accionables de negocio.

Qué debes producir (muy importante):
- Genera 3–5 issues priorizados por impacto.
- Debes incluir al menos 1 issue de OPORTUNIDAD (palanca de crecimiento) si el snapshot tiene volumen suficiente.

Qué debes buscar (prioriza con evidencia):
- Ineficiencias: canales con mucho volumen y baja conversión.
- Fricción: landing pages con sesiones altas y conversion rate bajo.
- Brechas: diferencias fuertes por dispositivo.
- Tracking: señales de medición rota o incompleta (sesiones altas con 0 conversiones, eventos clave ausentes, caída fuerte en tendencia).
- Oportunidades: mejores canales/landings/source-medium (convRate alta o mejor revenue) → cómo escalar y qué testear.

Uso de fuentes:
- Si existe "diagnostics.ga4", úsalo (lowConvChannels, badLandingPages, deviceGaps, trackingFlags, bestChannels, bestLandingPages, bestSourceMedium).
- Si daily/sourceMedium/topEvents existen, úsalos para explicar el “por qué” y proponer acciones concretas.

Formato y estilo:
- Evidencia numérica concreta (máx 2–3 frases en evidence).
- Recomendación: 2–4 pasos específicos (experimentos A/B, UTMs, eventos, mapeo de conversiones, mejoras de landing, etc.).
- Emojis: 1 emoji al inicio del title como máximo. No uses emojis en evidence/recommendation.
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
- Reglas de relevancia:
  - Prioriza campañas activas y con volumen material.
  - Permite 1 issue de reactivación (pausada) solo si hay evidencia clara (conversiones/ROAS/CPA).
- Usa diagnostics como shortlist de candidatos.
`.trim();

  const gaExtras = `
- Cada issue DEBE incluir:
  - accountRef { name, property } (propiedad GA4).
  - segmentRef (tipo + nombre): channel/device/landing/sourceMedium/event/general.
  - metrics (objeto pequeño con métricas citadas).
- Debes incluir al menos 1 issue de oportunidad si hay volumen suficiente.
- Usa diagnostics.ga4 (bestChannels/bestLandingPages/bestSourceMedium) para oportunidades.
- Si daily/sourceMedium/topEvents existen, úsalos para explicar causales.
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
- Emojis: máximo 1 emoji al inicio de cada title. No uses emojis en evidence/recommendation.
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

/* ---------------- refs hydration (NO inventa, solo usa snapshot) -------- */
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

  if (!issue.accountRef) {
    const p = pickGAProperty(snapshot);
    if (p) issue.accountRef = { name: p.name || '', property: p.property || '' };
  } else {
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

  const haveGAData =
    (Array.isArray(inputSnapshot?.channels)   && inputSnapshot.channels.length   > 0) ||
    (Array.isArray(inputSnapshot?.byProperty) && inputSnapshot.byProperty.length > 0) ||
    (Array.isArray(inputSnapshot?.daily)      && inputSnapshot.daily.length      > 0) ||
    (Array.isArray(inputSnapshot?.sourceMedium) && inputSnapshot.sourceMedium.length > 0) ||
    (Array.isArray(inputSnapshot?.topEvents)  && inputSnapshot.topEvents.length  > 0);

  const haveData = analytics ? haveGAData : haveAdsData;

  const platformLabel = analytics
    ? 'GA4'
    : ((t === 'google' || t === 'googleads' || t === 'gads') ? 'Google Ads' : 'Meta Ads');

  const system = analytics ? SYSTEM_GA : SYSTEM_ADS(platformLabel);

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

        const hydrated = hydrateIssueRefs({ issue: base, type, snapshot: inputSnapshot });

        // ✅ Emoji garantizado (controlado)
        return applyEmojiToTitle(hydrated);
      })
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

  if (!haveData && (!issues || issues.length === 0)) {
    return { summary: '', issues: [] };
  }

  issues = dedupeIssues(issues);
  issues = cap(issues, maxFindings);

  return { summary, issues };
};
