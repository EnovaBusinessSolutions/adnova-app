// backend/jobs/collect/googleAnalyticsCollector.js
'use strict';

const fetch = require('node-fetch');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL: GOOGLE_REDIRECT_URI,
} = process.env;

// [★] Límite duro por requerimiento (3). Se puede sobre-escribir por env.
const HARD_LIMIT = 3;
const MAX_BY_RULE = Math.min(
  HARD_LIMIT,
  Number(process.env.GA_PROPERTIES_MAX || HARD_LIMIT)
);

const DEBUG_GA_COLLECTOR = process.env.DEBUG_GA_COLLECTOR === 'true';

/* ---------------- models ---------------- */
let GoogleAccount;
try { GoogleAccount = require('../../models/GoogleAccount'); }
catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    // ⚠️ GA4 tokens (separados)
    ga4AccessToken: { type: String, select: false },
    ga4RefreshToken:{ type: String, select: false },
    ga4Scope: { type: [String], default: [] },
    ga4ExpiresAt: { type: Date },

    gaProperties: { type: Array, default: [] }, // [{ propertyId, displayName, timeZone, currencyCode, ... }]
    defaultPropertyId: String,
    selectedPropertyIds: { type: [String], default: [] },

    updatedAt: { type: Date, default: Date.now },
  }, { collection: 'googleaccounts' });
  schema.pre('save', function(n){ this.updatedAt = new Date(); n(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

let UserModel = null;
try { UserModel = require('../../models/User'); } catch (_) {
  const { Schema, model } = mongoose;
  UserModel = mongoose.models.User || model('User', new Schema({}, { strict: false, collection: 'users' }));
}

/* ---------------- helpers ---------------- */
const GA_SCOPE_READ = 'https://www.googleapis.com/auth/analytics.readonly';

const normPropertyId = (val) => {
  if (!val) return '';
  const v = String(val).trim();
  if (/^properties\/\d+$/.test(v)) return v;
  const onlyDigits = v.replace(/[^\d]/g, '');
  return onlyDigits ? `properties/${onlyDigits}` : '';
};

const toNum = (v) => Number(v || 0);
const safeDiv = (n, d) => (Number(d || 0) ? Number(n || 0) / Number(d || 0) : 0);

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function oauthClient() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
  });
}

/**
 * ✅ Token refresh robusto para GA4:
 * - usa ga4AccessToken/ga4RefreshToken/ga4ExpiresAt
 */
async function ensureGa4AccessToken(accDoc) {
  if (accDoc?.ga4AccessToken && accDoc?.ga4ExpiresAt) {
    const ms = new Date(accDoc.ga4ExpiresAt).getTime() - Date.now();
    if (ms > 60_000) return accDoc.ga4AccessToken;
  }

  // sin refresh: devolvemos el access si existe
  if (!accDoc?.ga4RefreshToken && accDoc?.ga4AccessToken) return accDoc.ga4AccessToken;
  if (!accDoc?.ga4RefreshToken) return null;

  const client = oauthClient();
  client.setCredentials({ refresh_token: accDoc.ga4RefreshToken });

  try {
    const { credentials } = await client.refreshAccessToken();
    const token = credentials?.access_token || null;

    if (token) {
      await GoogleAccount.updateOne(
        { _id: accDoc._id },
        {
          $set: {
            ga4AccessToken: token,
            ga4ExpiresAt: credentials?.expiry_date ? new Date(credentials.expiry_date) : null,
            updatedAt: new Date(),
          }
        }
      );
    }
    return token;
  } catch (e) {
    if (DEBUG_GA_COLLECTOR) {
      console.warn('[ga4Collector] refreshAccessToken failed:', e?.message || String(e));
    }
    return accDoc?.ga4AccessToken || null;
  }
}

/** Retry/backoff para GA4 Data API (429 / 5xx) */
async function postJSONWithRetry(url, { headers, body }, { retries = 2 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers, body });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        const status = r.status;
        const gaStatus = j?.error?.status || '';
        const msg = j?.error?.message || `GA4 runReport failed (HTTP_${status})`;

        const retriable =
          status === 429 ||
          String(gaStatus).toUpperCase() === 'RESOURCE_EXHAUSTED' ||
          (status >= 500 && status <= 599);

        if (retriable && i < retries) {
          const wait = 900 + i * 700;
          await new Promise(res => setTimeout(res, wait));
          continue;
        }

        const err = new Error(msg);
        err._ga = { code: gaStatus, http: status, raw: j?.error || null };
        throw err;
      }

      return j;
    } catch (e) {
      lastErr = e;
      if (i === retries) throw e;
      const wait = 700 + i * 600;
      await new Promise(res => setTimeout(res, wait));
    }
  }
  throw lastErr || new Error('unknown_error');
}

async function ga4RunReport({ token, property, body }) {
  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  return await postJSONWithRetry(
    url,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { retries: 2 }
  );
}

/**
 * YYYY-MM-DD en TZ (para construir ranges estrictos que terminan AYER)
 */
function ymdInTZ(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
}

function addDaysYMD(ymd, deltaDays) {
  const [yy, mm, dd] = String(ymd).split('-').map(Number);
  const base = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0));
  base.setUTCDate(base.getUTCDate() + Number(deltaDays || 0));
  return base.toISOString().slice(0, 10);
}

/**
 * Rango estricto N días completos:
 * - includeToday=false => hasta AYER
 */
function getStrictLastNdRangeForTZ(timeZone, days, includeToday) {
  const today = ymdInTZ(new Date(), timeZone || 'UTC');
  const end = includeToday ? today : addDaysYMD(today, -1);
  const d = clampInt(days || 30, 1, 3650);
  const start = addDaysYMD(end, -(d - 1));
  return { startDate: start, endDate: end };
}

/* -------- selección de propiedades (CANÓNICA + compat) -------- */

function listAvailableProperties(acc) {
  const list = Array.isArray(acc?.gaProperties) ? acc.gaProperties : [];
  return list.map(p => {
    const id = normPropertyId(p?.propertyId || p?.id);
    return id ? {
      id,
      displayName: p?.displayName || '',
      timeZone: p?.timeZone || null,
      currencyCode: p?.currencyCode || null,
    } : null;
  }).filter(Boolean);
}

async function resolvePropertiesForAudit({ userId, accDoc, forcedPropertyId }) {
  const available = listAvailableProperties(accDoc);
  const byId = new Map(available.map(a => [a.id, a]));

  if (forcedPropertyId) {
    const id = normPropertyId(forcedPropertyId);
    if (id) return [byId.get(id) || { id, displayName: '', timeZone: null, currencyCode: null }];
  }

  // CANÓNICO: selectedPropertyIds
  const selectedAcc = (Array.isArray(accDoc?.selectedPropertyIds) ? accDoc.selectedPropertyIds : [])
    .map(normPropertyId)
    .filter(Boolean);

  if (selectedAcc.length > 0) {
    const picked = [...new Set(selectedAcc)]
      .filter(id => (available.length ? byId.has(id) : true))
      .slice(0, MAX_BY_RULE)
      .map(id => byId.get(id) || ({ id, displayName: '', timeZone: null, currencyCode: null }));

    if (picked.length) return picked;
  }

  // defaultPropertyId
  const d = normPropertyId(accDoc?.defaultPropertyId);
  if (d) return [byId.get(d) || { id: d, displayName: '', timeZone: null, currencyCode: null }];

  // legacy: preferencias en User
  let selectedUser = [];
  if (UserModel && userId) {
    try {
      const user = await UserModel.findById(userId).lean().select('preferences selectedProperties selectedGAProperties');
      selectedUser =
        (Array.isArray(user?.preferences?.googleAnalytics?.auditPropertyIds)
          ? user.preferences.googleAnalytics.auditPropertyIds
          : Array.isArray(user?.selectedGAProperties)
            ? user.selectedGAProperties
            : Array.isArray(user?.selectedProperties)
              ? user.selectedProperties
              : []
        )
        .map(normPropertyId)
        .filter(Boolean);
    } catch {
      selectedUser = [];
    }
  }

  if (selectedUser.length > 0) {
    const picked = [...new Set(selectedUser)]
      .filter(id => (available.length ? byId.has(id) : true))
      .slice(0, MAX_BY_RULE)
      .map(id => byId.get(id) || ({ id, displayName: '', timeZone: null, currencyCode: null }));

    if (picked.length) return picked;
    return { error: 'NO_VALID_SELECTED_PROPERTIES' };
  }

  if (!available.length) return { error: 'NO_DEFAULT_PROPERTY' };

  if (available.length <= MAX_BY_RULE) return available;

  return { error: 'SELECTION_REQUIRED(>3_PROPERTIES)', availableCount: available.length };
}

/* ---------------- Compact helpers ---------------- */

function makeGa4Header({ userId, properties, range, version }) {
  return {
    schema: 'adray.mcp.v1',
    source: 'ga4',
    generatedAt: new Date().toISOString(),
    userId: String(userId),
    properties: Array.isArray(properties) ? properties : [],
    range,
    version: version || null,
  };
}

function topN(arr, n, scoreFn) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  a.sort((x, y) => scoreFn(y) - scoreFn(x));
  return a.slice(0, Math.max(0, n));
}

function computeDeltas(cur, prev) {
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : (a ? 100 : 0));
  return {
    users_pct: pct(cur.users, prev.users),
    sessions_pct: pct(cur.sessions, prev.sessions),
    conversions_pct: pct(cur.conversions, prev.conversions),
    revenue_pct: pct(cur.revenue, prev.revenue),
    engagementRate_diff: (cur.engagementRate || 0) - (prev.engagementRate || 0),
  };
}

/* ---------------- collector (GA4 MCPDATA-grade) ---------------- */
async function collectGA4(userId, opts = {}) {
  const {
    property_id,
    include_today = false,

    // NEW: for plan windows
    rangeDays = 30,
    range, // optional override { from,to,tz }

    // sizes
    topChannelsN = 12,
    topDevicesN = 8,
    topLandingPagesN = 80,
    topSourceMediumN = 120,
    topEventsN = 120,
  } = opts || {};

  // 1) cargar googleaccount con TOKENS GA4 + scopes GA4
  const acc = await GoogleAccount
    .findOne({ $or: [{ user: userId }, { userId }] })
    .select('+ga4AccessToken +ga4RefreshToken +ga4ExpiresAt ga4Scope defaultPropertyId selectedPropertyIds gaProperties')
    .lean();

  if (!acc) return { ok: false, notAuthorized: true, reason: 'NO_GOOGLEACCOUNT' };

  const hasScope = Array.isArray(acc.ga4Scope) && acc.ga4Scope.includes(GA_SCOPE_READ);
  if (!hasScope) return { ok: false, notAuthorized: true, reason: 'MISSING_SCOPE(analytics.readonly)' };

  let token = await ensureGa4AccessToken(acc);
  if (!token) return { ok: false, notAuthorized: true, reason: 'NO_GA4_ACCESS_TOKEN' };

  async function runReportWithRetry(property, body) {
    try {
      return await ga4RunReport({ token, property, body });
    } catch (e) {
      const http = e?._ga?.http;
      if ((http === 401 || http === 403) && acc.ga4RefreshToken) {
        token = await ensureGa4AccessToken({ ...acc, ga4AccessToken: null, ga4ExpiresAt: null });
        if (!token) throw e;
        return await ga4RunReport({ token, property, body });
      }
      throw e;
    }
  }

  // 2) resolver propiedades a auditar
  const resolved = await resolvePropertiesForAudit({
    userId,
    accDoc: acc,
    forcedPropertyId: property_id
  });

  if (resolved?.error) {
    if (resolved.error === 'NO_DEFAULT_PROPERTY') return { ok: false, notAuthorized: true, reason: 'NO_DEFAULT_PROPERTY' };
    if (resolved.error === 'NO_VALID_SELECTED_PROPERTIES') return { ok: false, notAuthorized: true, reason: 'NO_VALID_SELECTED_PROPERTIES' };
    if (String(resolved.error).startsWith('SELECTION_REQUIRED')) {
      return {
        ok: false,
        notAuthorized: true,
        reason: resolved.error,
        requiredSelection: true,
        availableCount: resolved.availableCount || null
      };
    }
  }

  const propertiesToAudit = (Array.isArray(resolved) ? resolved : []).slice(0, MAX_BY_RULE);

  if (DEBUG_GA_COLLECTOR) {
    console.log('[ga4Collector] auditing properties:', propertiesToAudit.map(p => p.id));
  }

  // 3) resolver rango
  // Preferimos TZ del primer property si existe; si no, UTC.
  const firstTZ = propertiesToAudit[0]?.timeZone || (range?.tz || null) || 'UTC';

  const explicit = range && range.from && range.to ? {
    startDate: String(range.from),
    endDate: String(range.to),
    tz: range.tz || firstTZ,
  } : null;

  const strict = explicit || {
    ...getStrictLastNdRangeForTZ(firstTZ, rangeDays, !!include_today),
    tz: firstTZ,
  };

  const rangeOut = { from: strict.startDate, to: strict.endDate, tz: strict.tz || firstTZ };

  // 4) bodies
  const totalsOnlyBody = {
    dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'newUsers' },
      { name: 'engagedSessions' },
    ],
    limit: '1',
  };

  const channelsBody = {
    dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'newUsers' },
      { name: 'engagedSessions' },
    ],
    metricAggregations: ['TOTAL'],
    limit: '1000',
  };

  const devicesBody = {
    dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'engagedSessions' },
    ],
    limit: '1000',
  };

  const landingBody = {
    dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
    dimensions: [{ name: 'landingPagePlusQueryString' }],
    metrics: [
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'engagedSessions' },
    ],
    limit: '5000',
  };

  const dailyBody = {
    dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'engagedSessions' },
    ],
    limit: '400',
  };

  const sourceMediumBody = {
    dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'engagedSessions' },
    ],
    limit: '5000',
  };

  const topEventsBody = {
    dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
    dimensions: [{ name: 'eventName' }],
    metrics: [
      { name: 'eventCount' },
      { name: 'conversions' },
    ],
    limit: '300',
  };

  // 5) agregadores globales
  const aggregate = {
    users: 0, sessions: 0, conversions: 0, revenue: 0,
    newUsers: 0, engagedSessions: 0,
  };

  const globalChannelsMap = new Map();
  const globalDevicesMap = new Map();
  const globalLandingMap = new Map();
  const globalDailyMap = new Map(); // date -> agg
  const globalSourceMediumMap = new Map();
  const globalTopEventsMap = new Map();

  const propertiesMetaOut = propertiesToAudit.map(p => ({
    id: p.id,
    name: p.displayName || '',
    timeZone: p.timeZone || null,
    currencyCode: p.currencyCode || null,
  }));

  const byProperty = [];

  // 6) loop propiedades
  for (const prop of propertiesToAudit) {
    const property = prop.id;

    // Channels
    let jChannels;
    try {
      jChannels = await runReportWithRetry(property, channelsBody);
    } catch (e) {
      const reason =
        (String(e?._ga?.code || '').toUpperCase() === 'PERMISSION_DENIED')
          ? 'PERMISSION_DENIED(analytics.readonly?)'
          : (e?.message || 'GA4 runReport (channels) failed');

      byProperty.push({
        property,
        propertyName: prop.displayName || '',
        dateRange: { start: rangeOut.from, end: rangeOut.to },
        error: true,
        reason,
        kpis: { users: 0, sessions: 0, conversions: 0, revenue: 0, newUsers: 0, engagedSessions: 0, engagementRate: 0 },
      });
      continue;
    }

    const rows = Array.isArray(jChannels?.rows) ? jChannels.rows : [];
    const channels = rows.map(rw => ({
      channel: rw.dimensionValues?.[0]?.value || '(other)',
      users: toNum(rw.metricValues?.[0]?.value),
      sessions: toNum(rw.metricValues?.[1]?.value),
      conversions: toNum(rw.metricValues?.[2]?.value),
      revenue: toNum(rw.metricValues?.[3]?.value),
      newUsers: toNum(rw.metricValues?.[4]?.value),
      engagedSessions: toNum(rw.metricValues?.[5]?.value),
    }));

    // Totals real
    let totals = jChannels?.totals?.[0]?.metricValues || null;
    if (!totals || !Array.isArray(totals) || totals.length < 6) {
      try {
        const jTotals = await runReportWithRetry(property, totalsOnlyBody);
        const row0 = Array.isArray(jTotals?.rows) ? jTotals.rows[0] : null;
        totals = row0?.metricValues || totals;
      } catch {}
    }

    const propAgg = {
      users: toNum(totals?.[0]?.value),
      sessions: toNum(totals?.[1]?.value),
      conversions: toNum(totals?.[2]?.value),
      revenue: toNum(totals?.[3]?.value),
      newUsers: toNum(totals?.[4]?.value),
      engagedSessions: toNum(totals?.[5]?.value),
    };

    aggregate.users += propAgg.users || 0;
    aggregate.sessions += propAgg.sessions || 0;
    aggregate.conversions += propAgg.conversions || 0;
    aggregate.revenue += propAgg.revenue || 0;
    aggregate.newUsers += propAgg.newUsers || 0;
    aggregate.engagedSessions += propAgg.engagedSessions || 0;

    for (const c of channels) {
      const key = c.channel || '(other)';
      const g = globalChannelsMap.get(key) || { users: 0, sessions: 0, conversions: 0, revenue: 0, newUsers: 0, engagedSessions: 0 };
      g.users += c.users || 0;
      g.sessions += c.sessions || 0;
      g.conversions += c.conversions || 0;
      g.revenue += c.revenue || 0;
      g.newUsers += c.newUsers || 0;
      g.engagedSessions += c.engagedSessions || 0;
      globalChannelsMap.set(key, g);
    }

    // Devices
    let devices = [];
    try {
      const jDevices = await runReportWithRetry(property, devicesBody);
      const dRows = Array.isArray(jDevices?.rows) ? jDevices.rows : [];
      devices = dRows.map(rw => ({
        device: rw.dimensionValues?.[0]?.value || '(other)',
        users: toNum(rw.metricValues?.[0]?.value),
        sessions: toNum(rw.metricValues?.[1]?.value),
        conversions: toNum(rw.metricValues?.[2]?.value),
        revenue: toNum(rw.metricValues?.[3]?.value),
        engagedSessions: toNum(rw.metricValues?.[4]?.value),
      }));

      for (const d of devices) {
        const key = d.device || '(other)';
        const g = globalDevicesMap.get(key) || { users: 0, sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 };
        g.users += d.users || 0;
        g.sessions += d.sessions || 0;
        g.conversions += d.conversions || 0;
        g.revenue += d.revenue || 0;
        g.engagedSessions += d.engagedSessions || 0;
        globalDevicesMap.set(key, g);
      }
    } catch {
      devices = [];
    }

    // Landing pages
    let landingPages = [];
    try {
      const jLanding = await runReportWithRetry(property, landingBody);
      const lRows = Array.isArray(jLanding?.rows) ? jLanding.rows : [];
      landingPages = lRows.map(rw => ({
        page: rw.dimensionValues?.[0]?.value || '(not set)',
        sessions: toNum(rw.metricValues?.[0]?.value),
        conversions: toNum(rw.metricValues?.[1]?.value),
        revenue: toNum(rw.metricValues?.[2]?.value),
        engagedSessions: toNum(rw.metricValues?.[3]?.value),
      }));

      for (const lp of landingPages) {
        const key = lp.page || '(not set)';
        const g = globalLandingMap.get(key) || { sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 };
        g.sessions += lp.sessions || 0;
        g.conversions += lp.conversions || 0;
        g.revenue += lp.revenue || 0;
        g.engagedSessions += lp.engagedSessions || 0;
        globalLandingMap.set(key, g);
      }
    } catch {
      landingPages = [];
    }

    // Daily
    let daily = [];
    try {
      const jDaily = await runReportWithRetry(property, dailyBody);
      const tRows = Array.isArray(jDaily?.rows) ? jDaily.rows : [];
      daily = tRows.map(rw => {
        const raw = rw.dimensionValues?.[0]?.value || '';
        const date =
          raw && raw.length === 8
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : raw;

        return {
          date,
          users: toNum(rw.metricValues?.[0]?.value),
          sessions: toNum(rw.metricValues?.[1]?.value),
          conversions: toNum(rw.metricValues?.[2]?.value),
          revenue: toNum(rw.metricValues?.[3]?.value),
          engagedSessions: toNum(rw.metricValues?.[4]?.value),
        };
      });

      for (const p of daily) {
        if (!p.date) continue;
        const g = globalDailyMap.get(p.date) || { users: 0, sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 };
        g.users += p.users || 0;
        g.sessions += p.sessions || 0;
        g.conversions += p.conversions || 0;
        g.revenue += p.revenue || 0;
        g.engagedSessions += p.engagedSessions || 0;
        globalDailyMap.set(p.date, g);
      }
    } catch {
      daily = [];
    }

    // Source/Medium
    let sourceMedium = [];
    try {
      const jSM = await runReportWithRetry(property, sourceMediumBody);
      const smRows = Array.isArray(jSM?.rows) ? jSM.rows : [];
      sourceMedium = smRows.map(rw => ({
        source: rw.dimensionValues?.[0]?.value || '(direct)',
        medium: rw.dimensionValues?.[1]?.value || '(none)',
        sessions: toNum(rw.metricValues?.[0]?.value),
        conversions: toNum(rw.metricValues?.[1]?.value),
        revenue: toNum(rw.metricValues?.[2]?.value),
        engagedSessions: toNum(rw.metricValues?.[3]?.value),
      }));

      for (const sm of sourceMedium) {
        const key = `${sm.source || '(direct)'}|${sm.medium || '(none)'}`;
        const g = globalSourceMediumMap.get(key) || { sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 };
        g.sessions += sm.sessions || 0;
        g.conversions += sm.conversions || 0;
        g.revenue += sm.revenue || 0;
        g.engagedSessions += sm.engagedSessions || 0;
        globalSourceMediumMap.set(key, g);
      }
    } catch {
      sourceMedium = [];
    }

    // Events
    let topEvents = [];
    try {
      const jEv = await runReportWithRetry(property, topEventsBody);
      const eRows = Array.isArray(jEv?.rows) ? jEv.rows : [];
      topEvents = eRows.map(rw => ({
        event: rw.dimensionValues?.[0]?.value || '(not set)',
        eventCount: toNum(rw.metricValues?.[0]?.value),
        conversions: toNum(rw.metricValues?.[1]?.value),
      }));

      for (const ev of topEvents) {
        const key = ev.event || '(not set)';
        const g = globalTopEventsMap.get(key) || { eventCount: 0, conversions: 0 };
        g.eventCount += ev.eventCount || 0;
        g.conversions += ev.conversions || 0;
        globalTopEventsMap.set(key, g);
      }
    } catch {
      topEvents = [];
    }

    // shrink per property (avoid huge payload)
    landingPages.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
    landingPages = landingPages.slice(0, Math.max(10, topLandingPagesN));

    sourceMedium.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
    sourceMedium = sourceMedium.slice(0, Math.max(10, topSourceMediumN));

    topEvents.sort((a, b) => (b.eventCount || 0) - (a.eventCount || 0));
    topEvents = topEvents.slice(0, Math.max(10, topEventsN));

    const engagementRate = safeDiv(propAgg.engagedSessions, propAgg.sessions) * 100;

    byProperty.push({
      property,
      propertyName: prop.displayName || '',
      dateRange: { start: rangeOut.from, end: rangeOut.to },
      kpis: {
        users: propAgg.users,
        sessions: propAgg.sessions,
        conversions: propAgg.conversions,
        revenue: propAgg.revenue,
        newUsers: propAgg.newUsers,
        engagedSessions: propAgg.engagedSessions,
        engagementRate,
      },
      // keep for debug/optional
      channels,
      devices,
      landingPages,
      daily,
      sourceMedium,
      topEvents,
    });
  }

  // 7) global maps -> arrays
  let channelsGlobal = Array.from(globalChannelsMap.entries()).map(([channel, m]) => ({
    channel,
    users: m.users,
    sessions: m.sessions,
    conversions: m.conversions,
    revenue: m.revenue,
    newUsers: m.newUsers,
    engagedSessions: m.engagedSessions,
    engagementRate: safeDiv(m.engagedSessions, m.sessions) * 100,
  }));
  channelsGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  channelsGlobal = channelsGlobal.slice(0, Math.max(5, topChannelsN));

  let devicesGlobal = Array.from(globalDevicesMap.entries()).map(([device, m]) => ({
    device,
    users: m.users,
    sessions: m.sessions,
    conversions: m.conversions,
    revenue: m.revenue,
    engagedSessions: m.engagedSessions,
    engagementRate: safeDiv(m.engagedSessions, m.sessions) * 100,
  }));
  devicesGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  devicesGlobal = devicesGlobal.slice(0, Math.max(4, topDevicesN));

  let landingGlobal = Array.from(globalLandingMap.entries()).map(([page, m]) => ({
    page,
    sessions: m.sessions,
    conversions: m.conversions,
    revenue: m.revenue,
    engagedSessions: m.engagedSessions,
    engagementRate: safeDiv(m.engagedSessions, m.sessions) * 100,
  }));
  landingGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  landingGlobal = landingGlobal.slice(0, Math.max(20, topLandingPagesN));

  const dailyGlobal = Array.from(globalDailyMap.entries())
    .map(([date, m]) => ({ date, ...m }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let sourceMediumGlobal = Array.from(globalSourceMediumMap.entries()).map(([k, m]) => {
    const [source, medium] = k.split('|');
    return { source, medium, ...m, engagementRate: safeDiv(m.engagedSessions, m.sessions) * 100 };
  });
  sourceMediumGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  sourceMediumGlobal = sourceMediumGlobal.slice(0, Math.max(30, topSourceMediumN));

  let topEventsGlobal = Array.from(globalTopEventsMap.entries()).map(([event, m]) => ({
    event,
    eventCount: m.eventCount,
    conversions: m.conversions,
  }));
  topEventsGlobal.sort((a, b) => (b.eventCount || 0) - (a.eventCount || 0));
  topEventsGlobal = topEventsGlobal.slice(0, Math.max(30, topEventsN));

  // 8) summary + deltas (7/30 vs prev) usando dailyGlobal
  function aggWindow(days, endYMD) {
    const end = endYMD;
    const start = addDaysYMD(end, -(days - 1));
    const rows = dailyGlobal.filter(r => r.date >= start && r.date <= end);
    const k = rows.reduce((a, r) => {
      a.users += toNum(r.users);
      a.sessions += toNum(r.sessions);
      a.conversions += toNum(r.conversions);
      a.revenue += toNum(r.revenue);
      a.engagedSessions += toNum(r.engagedSessions);
      return a;
    }, { users: 0, sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 });
    k.engagementRate = safeDiv(k.engagedSessions, k.sessions) * 100;
    return k;
  }

  function prevWindow(days, endYMD) {
    const endPrev = addDaysYMD(endYMD, -days);
    const startPrev = addDaysYMD(endPrev, -(days - 1));
    const rows = dailyGlobal.filter(r => r.date >= startPrev && r.date <= endPrev);
    const k = rows.reduce((a, r) => {
      a.users += toNum(r.users);
      a.sessions += toNum(r.sessions);
      a.conversions += toNum(r.conversions);
      a.revenue += toNum(r.revenue);
      a.engagedSessions += toNum(r.engagedSessions);
      return a;
    }, { users: 0, sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 });
    k.engagementRate = safeDiv(k.engagedSessions, k.sessions) * 100;
    return k;
  }

  const endForWindows = rangeOut.to;
  const last7 = aggWindow(7, endForWindows);
  const prev7 = prevWindow(7, endForWindows);
  const last30 = aggWindow(30, endForWindows);
  const prev30 = prevWindow(30, endForWindows);

  const summary = {
    kpis: {
      users: aggregate.users,
      sessions: aggregate.sessions,
      conversions: aggregate.conversions,
      revenue: aggregate.revenue,
      newUsers: aggregate.newUsers,
      engagedSessions: aggregate.engagedSessions,
      engagementRate: safeDiv(aggregate.engagedSessions, aggregate.sessions) * 100,
    },
    windows: {
      last_7_days: last7,
      prev_7_days: prev7,
      last_30_days: last30,
      prev_30_days: prev30,
    },
    deltas: {
      last7_vs_prev7: computeDeltas(last7, prev7),
      last30_vs_prev30: computeDeltas(last30, prev30),
    },
  };

  // 9) datasets MCPDATA
  const header = makeGa4Header({
    userId,
    properties: propertiesMetaOut,
    range: rangeOut,
    version: 'ga4Collector@mcp-v1(totals+topN+daily)',
  });

  const datasets = [
    { source: 'ga4', dataset: 'ga4.insights_summary', range: rangeOut, data: { meta: header, summary } },
    { source: 'ga4', dataset: 'ga4.channels_top', range: rangeOut, data: { meta: header, channels_top: channelsGlobal } },
    { source: 'ga4', dataset: 'ga4.devices_top', range: rangeOut, data: { meta: header, devices_top: devicesGlobal } },
    { source: 'ga4', dataset: 'ga4.landing_pages_top', range: rangeOut, data: { meta: header, landing_pages_top: landingGlobal } },
    { source: 'ga4', dataset: 'ga4.source_medium_top', range: rangeOut, data: { meta: header, source_medium_top: sourceMediumGlobal } },
    { source: 'ga4', dataset: 'ga4.events_top', range: rangeOut, data: { meta: header, events_top: topEventsGlobal } },
    { source: 'ga4', dataset: 'ga4.kpis_daily', range: rangeOut, data: { meta: header, kpis_daily: dailyGlobal } },
  ];

  return {
    ok: true,
    notAuthorized: false,
    reason: null,
    range: rangeOut,
    properties: propertiesMetaOut,
    datasets,
    // opcional: debug
    byProperty,
  };
}

module.exports = { collectGA4 };