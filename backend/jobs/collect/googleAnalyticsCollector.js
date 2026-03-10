'use strict';

const fetch = require('node-fetch');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL: GOOGLE_REDIRECT_URI,
} = process.env;

const HARD_LIMIT = 3;
const MAX_BY_RULE = Math.min(
  HARD_LIMIT,
  Number(process.env.GA_PROPERTIES_MAX || HARD_LIMIT)
);

const DEBUG_GA_COLLECTOR = process.env.DEBUG_GA_COLLECTOR === 'true';

const DEFAULT_STORAGE_RANGE_DAYS = clampInt(
  process.env.MCP_STORAGE_RANGE_DAYS || 730,
  30,
  3650
);

const DEFAULT_CONTEXT_RANGE_DAYS = clampInt(
  process.env.MCP_CONTEXT_RANGE_DAYS || 60,
  7,
  365
);

/* ---------------- models ---------------- */
let GoogleAccount;
try { GoogleAccount = require('../../models/GoogleAccount'); }
catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    ga4AccessToken: { type: String, select: false },
    ga4RefreshToken: { type: String, select: false },
    ga4Scope: { type: [String], default: [] },
    ga4ExpiresAt: { type: Date },

    gaProperties: { type: Array, default: [] },
    defaultPropertyId: String,
    selectedPropertyIds: { type: [String], default: [] },

    updatedAt: { type: Date, default: Date.now },
  }, { collection: 'googleaccounts' });
  schema.pre('save', function (n) { this.updatedAt = new Date(); n(); });
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
const round2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function safeStr(v) {
  return v == null ? '' : String(v);
}

function compactArray(arr, max = 10) {
  return Array.isArray(arr) ? arr.slice(0, Math.max(0, max)) : [];
}

function uniqStrings(arr, max = 20) {
  const out = [];
  const seen = new Set();

  for (const x of Array.isArray(arr) ? arr : []) {
    const s = safeStr(x).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }

  return out;
}

function oauthClient() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
  });
}

async function ensureGa4AccessToken(accDoc) {
  if (accDoc?.ga4AccessToken && accDoc?.ga4ExpiresAt) {
    const ms = new Date(accDoc.ga4ExpiresAt).getTime() - Date.now();
    if (ms > 60_000) return accDoc.ga4AccessToken;
  }

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

function parseYmdToUtcDate(ymd) {
  const s = safeStr(ymd).trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [yy, mm, dd] = s.split('-').map(Number);
  return new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0));
}

function addDaysYMD(ymd, deltaDays) {
  const d = parseYmdToUtcDate(ymd);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return d.toISOString().slice(0, 10);
}

function monthKeyFromDate(dateStr) {
  const s = safeStr(dateStr).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 7) : 'unknown';
}

function partitionRowsByMonth(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = monthKeyFromDate(row?.date);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function getStrictLastNdRangeForTZ(timeZone, days, includeToday) {
  const today = ymdInTZ(new Date(), timeZone || 'UTC');
  const end = includeToday ? today : addDaysYMD(today, -1);
  const d = clampInt(days || 30, 1, 3650);
  const start = addDaysYMD(end, -(d - 1));
  return { startDate: start, endDate: end };
}

/* -------- selección de propiedades -------- */

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

  const d = normPropertyId(accDoc?.defaultPropertyId);
  if (d) return [byId.get(d) || { id: d, displayName: '', timeZone: null, currencyCode: null }];

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

/* ---------------- compact helpers ---------------- */

function makeGa4Header({
  userId,
  properties,
  range,
  version,
  windowType,
  storageRangeDays,
  contextRangeDays,
  latestSnapshotId = null,
}) {
  return {
    schema: 'adray.mcp.v2',
    source: 'ga4',
    generatedAt: new Date().toISOString(),
    userId: String(userId),
    properties: Array.isArray(properties) ? properties : [],
    range,
    version: version || null,
    windowType: windowType || 'context',
    storageRangeDays: Number(storageRangeDays || 0) || null,
    contextRangeDays: Number(contextRangeDays || 0) || null,
    latestSnapshotId: latestSnapshotId || null,
  };
}

function computeDeltas(cur, prev) {
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : (a ? 100 : 0));
  return {
    users_pct: pct(cur.users, prev.users),
    sessions_pct: pct(cur.sessions, prev.sessions),
    conversions_pct: pct(cur.conversions, prev.conversions),
    revenue_pct: pct(cur.revenue, prev.revenue),
    engagementRate_diff: round2((cur.engagementRate || 0) - (prev.engagementRate || 0)),
  };
}

function sortByDateAsc(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
}

function topN(arr, n, scoreFn) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  a.sort((x, y) => scoreFn(y) - scoreFn(x));
  return a.slice(0, Math.max(0, n));
}

/* ---------------- ranking / insights ---------------- */

function compactChannelRow(x) {
  return {
    channel: safeStr(x?.channel) || '(other)',
    users: round2(x?.users),
    sessions: round2(x?.sessions),
    conversions: round2(x?.conversions),
    revenue: round2(x?.revenue),
    newUsers: round2(x?.newUsers),
    engagedSessions: round2(x?.engagedSessions),
    engagementRate: round2(x?.engagementRate),
  };
}

function compactDeviceRow(x) {
  return {
    device: safeStr(x?.device) || '(other)',
    users: round2(x?.users),
    sessions: round2(x?.sessions),
    conversions: round2(x?.conversions),
    revenue: round2(x?.revenue),
    engagedSessions: round2(x?.engagedSessions),
    engagementRate: round2(x?.engagementRate),
  };
}

function compactLandingRow(x) {
  return {
    page: safeStr(x?.page) || '(not set)',
    sessions: round2(x?.sessions),
    conversions: round2(x?.conversions),
    revenue: round2(x?.revenue),
    engagedSessions: round2(x?.engagedSessions),
    engagementRate: round2(x?.engagementRate),
  };
}

function compactSourceMediumRow(x) {
  return {
    source: safeStr(x?.source) || '(direct)',
    medium: safeStr(x?.medium) || '(none)',
    sessions: round2(x?.sessions),
    conversions: round2(x?.conversions),
    revenue: round2(x?.revenue),
    engagedSessions: round2(x?.engagedSessions),
    engagementRate: round2(x?.engagementRate),
  };
}

function compactEventRow(x) {
  return {
    event: safeStr(x?.event) || '(not set)',
    eventCount: round2(x?.eventCount),
    conversions: round2(x?.conversions),
  };
}

function buildOptimizationSignals({ channelsTop, devicesTop, landingPagesTop, sourceMediumTop, eventsTop, summary }) {
  const winners = [];
  const risks = [];
  const quick_wins = [];
  const insights = [];
  const recommendations = [];

  const bestChannels = topN(channelsTop, 4, (x) => toNum(x.revenue));
  const weakChannels = topN(
    channelsTop.filter(x => toNum(x.sessions) >= 20 && toNum(x.revenue) <= 0),
    4,
    (x) => toNum(x.sessions)
  );

  const bestLanding = topN(landingPagesTop, 4, (x) => toNum(x.revenue));
  const weakLanding = topN(
    landingPagesTop.filter(x => toNum(x.sessions) >= 20 && toNum(x.revenue) <= 0),
    4,
    (x) => toNum(x.sessions)
  );

  const bestSources = topN(sourceMediumTop, 4, (x) => toNum(x.revenue));
  const weakSources = topN(
    sourceMediumTop.filter(x => toNum(x.sessions) >= 20 && toNum(x.revenue) <= 0),
    4,
    (x) => toNum(x.sessions)
  );

  winners.push(
    ...bestChannels.map(compactChannelRow),
    ...bestLanding.map(compactLandingRow)
  );

  risks.push(
    ...weakChannels.map(compactChannelRow),
    ...weakLanding.map(compactLandingRow)
  );

  quick_wins.push(
    ...bestSources.map(compactSourceMediumRow)
  );

  if (bestChannels.length) {
    insights.push('Top GA4 channels are concentrating the strongest revenue contribution.');
    recommendations.push('Double down on the channel groups already generating the strongest revenue and conversions.');
  }

  if (weakChannels.length) {
    insights.push('Some channel groups are driving sessions without corresponding revenue signals.');
    recommendations.push('Review low-revenue channels with material traffic and tighten acquisition quality.');
  }

  if (bestLanding.length) {
    recommendations.push('Use the strongest landing pages as templates for future campaigns and CRO improvements.');
  }

  if (weakLanding.length) {
    recommendations.push('Audit weak landing pages with significant sessions but poor monetization or conversion performance.');
  }

  const engagementRate = toNum(summary?.kpis?.engagementRate);
  if (engagementRate > 0 && engagementRate < 50) {
    insights.push('Overall GA4 engagement rate is relatively soft.');
    recommendations.push('Improve content relevance, page speed, and landing-page-message match to lift engagement.');
  }

  const purchaseEvent = (eventsTop || []).find(e => String(e?.event || '').toLowerCase() === 'purchase');
  if (purchaseEvent && toNum(purchaseEvent.eventCount) > 0) {
    insights.push('GA4 confirms purchase activity in the selected date range.');
  }

  return {
    winners: compactArray(winners, 4),
    risks: compactArray(risks, 4),
    quick_wins: compactArray(quick_wins, 4),
    insights: uniqStrings(insights, 6),
    recommendations: uniqStrings(recommendations, 6),
  };
}

/* ---------------- collector ---------------- */
async function collectGA4(userId, opts = {}) {
  const {
    property_id,
    include_today = false,
    rangeDays, // compat legacy => contexto
    contextRangeDays = rangeDays || DEFAULT_CONTEXT_RANGE_DAYS,
    storageRangeDays = DEFAULT_STORAGE_RANGE_DAYS,
    range,
    storageRange,
    topChannelsN = 12,
    topDevicesN = 8,
    topLandingPagesN = 80,
    topSourceMediumN = 120,
    topEventsN = 120,
    buildHistoricalDatasets = (
      opts.buildHistoricalDatasets !== undefined
        ? !!opts.buildHistoricalDatasets
        : String(process.env.GA4_BUILD_HISTORICAL_DATASETS || 'true').toLowerCase() === 'true'
    ),
  } = opts || {};

  const contextDays = clampInt(contextRangeDays || DEFAULT_CONTEXT_RANGE_DAYS, 7, 365);
  const storageDays = clampInt(storageRangeDays || DEFAULT_STORAGE_RANGE_DAYS, Math.max(contextDays, 30), 3650);

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

  const firstTZ = propertiesToAudit[0]?.timeZone || (range?.tz || null) || 'UTC';

  const explicitContext = range && range.from && range.to ? {
    startDate: String(range.from),
    endDate: String(range.to),
    tz: range.tz || firstTZ,
  } : null;

  const explicitStorage = storageRange && storageRange.from && storageRange.to ? {
    startDate: String(storageRange.from),
    endDate: String(storageRange.to),
    tz: storageRange.tz || firstTZ,
  } : null;

  const contextStrict = explicitContext || {
    ...getStrictLastNdRangeForTZ(firstTZ, contextDays, !!include_today),
    tz: firstTZ,
  };

  const storageStrict = explicitStorage || {
    ...getStrictLastNdRangeForTZ(firstTZ, storageDays, !!include_today),
    tz: firstTZ,
  };

  const contextRangeOut = { from: contextStrict.startDate, to: contextStrict.endDate, tz: contextStrict.tz || firstTZ };
  const storageRangeOut = { from: storageStrict.startDate, to: storageStrict.endDate, tz: storageStrict.tz || firstTZ };

  function makeTotalsOnlyBody(rangeOut) {
    return {
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
  }

  function makeChannelsBody(rangeOut) {
    return {
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
  }

  function makeDevicesBody(rangeOut) {
    return {
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
  }

  function makeLandingBody(rangeOut) {
    return {
      dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
      dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'purchaseRevenue' },
        { name: 'engagedSessions' },
      ],
      limit: '5000',
    };
  }

  function makeDailyBody(rangeOut) {
    return {
      dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'purchaseRevenue' },
        { name: 'engagedSessions' },
      ],
      limit: '4000',
    };
  }

  function makeSourceMediumBody(rangeOut) {
    return {
      dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'purchaseRevenue' },
        { name: 'engagedSessions' },
      ],
      limit: '5000',
    };
  }

  function makeTopEventsBody(rangeOut) {
    return {
      dateRanges: [{ startDate: rangeOut.from, endDate: rangeOut.to }],
      dimensions: [{ name: 'eventName' }, { name: 'date' }],
      metrics: [
        { name: 'eventCount' },
        { name: 'conversions' },
      ],
      limit: '3000',
    };
  }

  const aggregate = {
    users: 0, sessions: 0, conversions: 0, revenue: 0,
    newUsers: 0, engagedSessions: 0,
  };

  const globalChannelsMap = new Map();
  const globalDevicesMap = new Map();
  const globalLandingMap = new Map();
  const globalDailyMap = new Map();
  const globalSourceMediumMap = new Map();
  const globalTopEventsMap = new Map();

  const histDailyMap = new Map();
  const histLandingRows = [];
  const histSourceMediumRows = [];
  const histEventRows = [];

  const propertiesMetaOut = propertiesToAudit.map(p => ({
    id: p.id,
    name: p.displayName || '',
    timeZone: p.timeZone || null,
    currencyCode: p.currencyCode || null,
  }));

  const byProperty = [];

  for (const prop of propertiesToAudit) {
    const property = prop.id;

    let jChannels;
    try {
      jChannels = await runReportWithRetry(property, makeChannelsBody(contextRangeOut));
    } catch (e) {
      const reason =
        (String(e?._ga?.code || '').toUpperCase() === 'PERMISSION_DENIED')
          ? 'PERMISSION_DENIED(analytics.readonly?)'
          : (e?.message || 'GA4 runReport (channels) failed');

      byProperty.push({
        property,
        propertyName: prop.displayName || '',
        dateRange: { start: contextRangeOut.from, end: contextRangeOut.to },
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
      engagementRate: round2(safeDiv(toNum(rw.metricValues?.[5]?.value), toNum(rw.metricValues?.[1]?.value)) * 100),
    }));

    let totals = jChannels?.totals?.[0]?.metricValues || null;
    if (!totals || !Array.isArray(totals) || totals.length < 6) {
      try {
        const jTotals = await runReportWithRetry(property, makeTotalsOnlyBody(contextRangeOut));
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

    let devices = [];
    try {
      const jDevices = await runReportWithRetry(property, makeDevicesBody(contextRangeOut));
      const dRows = Array.isArray(jDevices?.rows) ? jDevices.rows : [];
      devices = dRows.map(rw => ({
        device: rw.dimensionValues?.[0]?.value || '(other)',
        users: toNum(rw.metricValues?.[0]?.value),
        sessions: toNum(rw.metricValues?.[1]?.value),
        conversions: toNum(rw.metricValues?.[2]?.value),
        revenue: toNum(rw.metricValues?.[3]?.value),
        engagedSessions: toNum(rw.metricValues?.[4]?.value),
        engagementRate: round2(safeDiv(toNum(rw.metricValues?.[4]?.value), toNum(rw.metricValues?.[1]?.value)) * 100),
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

    let landingPages = [];
    try {
      const jLanding = await runReportWithRetry(property, makeLandingBody(contextRangeOut));
      const lRows = Array.isArray(jLanding?.rows) ? jLanding.rows : [];
      landingPages = lRows.map(rw => ({
        page: rw.dimensionValues?.[0]?.value || '(not set)',
        date: (() => {
          const raw = rw.dimensionValues?.[1]?.value || '';
          return raw && raw.length === 8
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : raw;
        })(),
        sessions: toNum(rw.metricValues?.[0]?.value),
        conversions: toNum(rw.metricValues?.[1]?.value),
        revenue: toNum(rw.metricValues?.[2]?.value),
        engagedSessions: toNum(rw.metricValues?.[3]?.value),
        engagementRate: round2(safeDiv(toNum(rw.metricValues?.[3]?.value), toNum(rw.metricValues?.[0]?.value)) * 100),
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

    let daily = [];
    try {
      const jDaily = await runReportWithRetry(property, makeDailyBody(contextRangeOut));
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
          engagementRate: round2(safeDiv(toNum(rw.metricValues?.[4]?.value), toNum(rw.metricValues?.[1]?.value)) * 100),
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

    let sourceMedium = [];
    try {
      const jSM = await runReportWithRetry(property, makeSourceMediumBody(contextRangeOut));
      const smRows = Array.isArray(jSM?.rows) ? jSM.rows : [];
      sourceMedium = smRows.map(rw => ({
        source: rw.dimensionValues?.[0]?.value || '(direct)',
        medium: rw.dimensionValues?.[1]?.value || '(none)',
        date: (() => {
          const raw = rw.dimensionValues?.[2]?.value || '';
          return raw && raw.length === 8
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : raw;
        })(),
        sessions: toNum(rw.metricValues?.[0]?.value),
        conversions: toNum(rw.metricValues?.[1]?.value),
        revenue: toNum(rw.metricValues?.[2]?.value),
        engagedSessions: toNum(rw.metricValues?.[3]?.value),
        engagementRate: round2(safeDiv(toNum(rw.metricValues?.[3]?.value), toNum(rw.metricValues?.[0]?.value)) * 100),
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

    let topEvents = [];
    try {
      const jEv = await runReportWithRetry(property, makeTopEventsBody(contextRangeOut));
      const eRows = Array.isArray(jEv?.rows) ? jEv.rows : [];
      topEvents = eRows.map(rw => ({
        event: rw.dimensionValues?.[0]?.value || '(not set)',
        date: (() => {
          const raw = rw.dimensionValues?.[1]?.value || '';
          return raw && raw.length === 8
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : raw;
        })(),
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

    if (buildHistoricalDatasets) {
      try {
        const jHistDaily = await runReportWithRetry(property, makeDailyBody(storageRangeOut));
        const hRows = Array.isArray(jHistDaily?.rows) ? jHistDaily.rows : [];
        for (const rw of hRows) {
          const raw = rw.dimensionValues?.[0]?.value || '';
          const date =
            raw && raw.length === 8
              ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
              : raw;
          if (!date) continue;

          const key = date;
          const g = histDailyMap.get(key) || { users: 0, sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 };
          g.users += toNum(rw.metricValues?.[0]?.value);
          g.sessions += toNum(rw.metricValues?.[1]?.value);
          g.conversions += toNum(rw.metricValues?.[2]?.value);
          g.revenue += toNum(rw.metricValues?.[3]?.value);
          g.engagedSessions += toNum(rw.metricValues?.[4]?.value);
          histDailyMap.set(key, g);
        }
      } catch {}

      try {
        const jHistLanding = await runReportWithRetry(property, makeLandingBody(storageRangeOut));
        const rowsHist = Array.isArray(jHistLanding?.rows) ? jHistLanding.rows : [];
        for (const rw of rowsHist) {
          const raw = rw.dimensionValues?.[1]?.value || '';
          const date =
            raw && raw.length === 8
              ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
              : raw;

          histLandingRows.push({
            property_id: property,
            page: rw.dimensionValues?.[0]?.value || '(not set)',
            date,
            sessions: toNum(rw.metricValues?.[0]?.value),
            conversions: toNum(rw.metricValues?.[1]?.value),
            revenue: toNum(rw.metricValues?.[2]?.value),
            engagedSessions: toNum(rw.metricValues?.[3]?.value),
            engagementRate: round2(safeDiv(toNum(rw.metricValues?.[3]?.value), toNum(rw.metricValues?.[0]?.value)) * 100),
          });
        }
      } catch {}

      try {
        const jHistSM = await runReportWithRetry(property, makeSourceMediumBody(storageRangeOut));
        const rowsHist = Array.isArray(jHistSM?.rows) ? jHistSM.rows : [];
        for (const rw of rowsHist) {
          const raw = rw.dimensionValues?.[2]?.value || '';
          const date =
            raw && raw.length === 8
              ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
              : raw;

          histSourceMediumRows.push({
            property_id: property,
            source: rw.dimensionValues?.[0]?.value || '(direct)',
            medium: rw.dimensionValues?.[1]?.value || '(none)',
            date,
            sessions: toNum(rw.metricValues?.[0]?.value),
            conversions: toNum(rw.metricValues?.[1]?.value),
            revenue: toNum(rw.metricValues?.[2]?.value),
            engagedSessions: toNum(rw.metricValues?.[3]?.value),
            engagementRate: round2(safeDiv(toNum(rw.metricValues?.[3]?.value), toNum(rw.metricValues?.[0]?.value)) * 100),
          });
        }
      } catch {}

      try {
        const jHistEv = await runReportWithRetry(property, makeTopEventsBody(storageRangeOut));
        const rowsHist = Array.isArray(jHistEv?.rows) ? jHistEv.rows : [];
        for (const rw of rowsHist) {
          const raw = rw.dimensionValues?.[1]?.value || '';
          const date =
            raw && raw.length === 8
              ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
              : raw;

          histEventRows.push({
            property_id: property,
            event: rw.dimensionValues?.[0]?.value || '(not set)',
            date,
            eventCount: toNum(rw.metricValues?.[0]?.value),
            conversions: toNum(rw.metricValues?.[1]?.value),
          });
        }
      } catch {}
    }

    landingPages.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
    landingPages = landingPages.slice(0, Math.max(10, topLandingPagesN));

    sourceMedium.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
    sourceMedium = sourceMedium.slice(0, Math.max(10, topSourceMediumN));

    topEvents.sort((a, b) => (b.eventCount || 0) - (a.eventCount || 0));
    topEvents = topEvents.slice(0, Math.max(10, topEventsN));

    const engagementRate = round2(safeDiv(propAgg.engagedSessions, propAgg.sessions) * 100);

    byProperty.push({
      property,
      propertyName: prop.displayName || '',
      dateRange: { start: contextRangeOut.from, end: contextRangeOut.to },
      kpis: {
        users: propAgg.users,
        sessions: propAgg.sessions,
        conversions: propAgg.conversions,
        revenue: propAgg.revenue,
        newUsers: propAgg.newUsers,
        engagedSessions: propAgg.engagedSessions,
        engagementRate,
      },
      channels,
      devices,
      landingPages,
      daily,
      sourceMedium,
      topEvents,
    });
  }

  let channelsGlobal = Array.from(globalChannelsMap.entries()).map(([channel, m]) => ({
    channel,
    users: m.users,
    sessions: m.sessions,
    conversions: m.conversions,
    revenue: m.revenue,
    newUsers: m.newUsers,
    engagedSessions: m.engagedSessions,
    engagementRate: round2(safeDiv(m.engagedSessions, m.sessions) * 100),
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
    engagementRate: round2(safeDiv(m.engagedSessions, m.sessions) * 100),
  }));
  devicesGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  devicesGlobal = devicesGlobal.slice(0, Math.max(4, topDevicesN));

  let landingGlobal = Array.from(globalLandingMap.entries()).map(([page, m]) => ({
    page,
    sessions: m.sessions,
    conversions: m.conversions,
    revenue: m.revenue,
    engagedSessions: m.engagedSessions,
    engagementRate: round2(safeDiv(m.engagedSessions, m.sessions) * 100),
  }));
  landingGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  landingGlobal = landingGlobal.slice(0, Math.max(20, topLandingPagesN));

  const dailyGlobal = sortByDateAsc(
    Array.from(globalDailyMap.entries()).map(([date, m]) => ({
      date,
      users: m.users,
      sessions: m.sessions,
      conversions: m.conversions,
      revenue: m.revenue,
      engagedSessions: m.engagedSessions,
      engagementRate: round2(safeDiv(m.engagedSessions, m.sessions) * 100),
    }))
  );

  let sourceMediumGlobal = Array.from(globalSourceMediumMap.entries()).map(([k, m]) => {
    const [source, medium] = k.split('|');
    return {
      source,
      medium,
      sessions: m.sessions,
      conversions: m.conversions,
      revenue: m.revenue,
      engagedSessions: m.engagedSessions,
      engagementRate: round2(safeDiv(m.engagedSessions, m.sessions) * 100),
    };
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

  function aggWindow(days, endYMD, sourceRows) {
    const end = endYMD;
    const start = addDaysYMD(end, -(days - 1));
    const rows = (Array.isArray(sourceRows) ? sourceRows : []).filter(r => r.date >= start && r.date <= end);
    const k = rows.reduce((a, r) => {
      a.users += toNum(r.users);
      a.sessions += toNum(r.sessions);
      a.conversions += toNum(r.conversions);
      a.revenue += toNum(r.revenue);
      a.engagedSessions += toNum(r.engagedSessions);
      return a;
    }, { users: 0, sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 });
    k.engagementRate = round2(safeDiv(k.engagedSessions, k.sessions) * 100);
    return k;
  }

  function prevWindow(days, endYMD, sourceRows) {
    const endPrev = addDaysYMD(endYMD, -days);
    const startPrev = addDaysYMD(endPrev, -(days - 1));
    const rows = (Array.isArray(sourceRows) ? sourceRows : []).filter(r => r.date >= startPrev && r.date <= endPrev);
    const k = rows.reduce((a, r) => {
      a.users += toNum(r.users);
      a.sessions += toNum(r.sessions);
      a.conversions += toNum(r.conversions);
      a.revenue += toNum(r.revenue);
      a.engagedSessions += toNum(r.engagedSessions);
      return a;
    }, { users: 0, sessions: 0, conversions: 0, revenue: 0, engagedSessions: 0 });
    k.engagementRate = round2(safeDiv(k.engagedSessions, k.sessions) * 100);
    return k;
  }

  const endForWindows = contextRangeOut.to;
  const last7 = aggWindow(7, endForWindows, dailyGlobal);
  const prev7 = prevWindow(7, endForWindows, dailyGlobal);
  const last30 = aggWindow(30, endForWindows, dailyGlobal);
  const prev30 = prevWindow(30, endForWindows, dailyGlobal);

  const summary = {
    kpis: {
      users: aggregate.users,
      sessions: aggregate.sessions,
      conversions: aggregate.conversions,
      revenue: aggregate.revenue,
      newUsers: aggregate.newUsers,
      engagedSessions: aggregate.engagedSessions,
      engagementRate: round2(safeDiv(aggregate.engagedSessions, aggregate.sessions) * 100),
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

  const optimization_signals = buildOptimizationSignals({
    channelsTop: channelsGlobal,
    devicesTop: devicesGlobal,
    landingPagesTop: landingGlobal,
    sourceMediumTop: sourceMediumGlobal,
    eventsTop: topEventsGlobal,
    summary,
  });

  const daily_trends_ai = {
    totals_by_day: dailyGlobal.map((d) => ({
      date: d.date,
      kpis: {
        users: round2(d.users),
        sessions: round2(d.sessions),
        conversions: round2(d.conversions),
        revenue: round2(d.revenue),
        engagedSessions: round2(d.engagedSessions),
        engagementRate: round2(d.engagementRate),
      },
    })),
  };

  const contextHeader = makeGa4Header({
    userId,
    properties: propertiesMetaOut,
    range: contextRangeOut,
    version: 'ga4Collector@mcp-v3(storage+context)',
    windowType: 'context',
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  const historyHeader = makeGa4Header({
    userId,
    properties: propertiesMetaOut,
    range: storageRangeOut,
    version: 'ga4Collector@mcp-v3(storage+context)',
    windowType: 'storage',
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
  });

  const datasets = [
    { source: 'ga4', dataset: 'ga4.insights_summary', range: contextRangeOut, data: { meta: contextHeader, summary } },
    { source: 'ga4', dataset: 'ga4.channels_top', range: contextRangeOut, data: { meta: contextHeader, channels_top: channelsGlobal.map(compactChannelRow) } },
    { source: 'ga4', dataset: 'ga4.devices_top', range: contextRangeOut, data: { meta: contextHeader, devices_top: devicesGlobal.map(compactDeviceRow) } },
    { source: 'ga4', dataset: 'ga4.landing_pages_top', range: contextRangeOut, data: { meta: contextHeader, landing_pages_top: landingGlobal.map(compactLandingRow) } },
    { source: 'ga4', dataset: 'ga4.source_medium_top', range: contextRangeOut, data: { meta: contextHeader, source_medium_top: sourceMediumGlobal.map(compactSourceMediumRow) } },
    { source: 'ga4', dataset: 'ga4.events_top', range: contextRangeOut, data: { meta: contextHeader, events_top: topEventsGlobal.map(compactEventRow) } },
    { source: 'ga4', dataset: 'ga4.optimization_signals', range: contextRangeOut, data: { meta: contextHeader, optimization_signals } },
    { source: 'ga4', dataset: 'ga4.daily_trends_ai', range: contextRangeOut, data: { meta: contextHeader, ...daily_trends_ai } },
  ];

  if (buildHistoricalDatasets) {
    const histDailyRows = sortByDateAsc(
      Array.from(histDailyMap.entries()).map(([date, m]) => ({
        date,
        kpis: {
          users: round2(m.users),
          sessions: round2(m.sessions),
          conversions: round2(m.conversions),
          revenue: round2(m.revenue),
          engagedSessions: round2(m.engagedSessions),
          engagementRate: round2(safeDiv(m.engagedSessions, m.sessions) * 100),
        },
      }))
    );

    datasets.push({
      source: 'ga4',
      dataset: 'ga4.history.daily_totals',
      range: storageRangeOut,
      data: {
        meta: historyHeader,
        totals_by_day: histDailyRows,
      },
    });

    const landingByMonth = partitionRowsByMonth(histLandingRows);
    for (const [monthKey, rows] of landingByMonth.entries()) {
      datasets.push({
        source: 'ga4',
        dataset: `ga4.history.landing_pages.${monthKey}`,
        range: {
          from: rows[0]?.date || storageRangeOut.from,
          to: rows[rows.length - 1]?.date || storageRangeOut.to,
          tz: storageRangeOut.tz || null,
        },
        data: {
          meta: {
            ...historyHeader,
            partition: monthKey,
          },
          landing_pages_daily: rows.map((r) => ({
            property_id: r.property_id,
            page: r.page,
            date: r.date,
            sessions: round2(r.sessions),
            conversions: round2(r.conversions),
            revenue: round2(r.revenue),
            engagedSessions: round2(r.engagedSessions),
            engagementRate: round2(r.engagementRate),
          })),
        },
      });
    }

    const smByMonth = partitionRowsByMonth(histSourceMediumRows);
    for (const [monthKey, rows] of smByMonth.entries()) {
      datasets.push({
        source: 'ga4',
        dataset: `ga4.history.source_medium.${monthKey}`,
        range: {
          from: rows[0]?.date || storageRangeOut.from,
          to: rows[rows.length - 1]?.date || storageRangeOut.to,
          tz: storageRangeOut.tz || null,
        },
        data: {
          meta: {
            ...historyHeader,
            partition: monthKey,
          },
          source_medium_daily: rows.map((r) => ({
            property_id: r.property_id,
            source: r.source,
            medium: r.medium,
            date: r.date,
            sessions: round2(r.sessions),
            conversions: round2(r.conversions),
            revenue: round2(r.revenue),
            engagedSessions: round2(r.engagedSessions),
            engagementRate: round2(r.engagementRate),
          })),
        },
      });
    }

    const eventsByMonth = partitionRowsByMonth(histEventRows);
    for (const [monthKey, rows] of eventsByMonth.entries()) {
      datasets.push({
        source: 'ga4',
        dataset: `ga4.history.events.${monthKey}`,
        range: {
          from: rows[0]?.date || storageRangeOut.from,
          to: rows[rows.length - 1]?.date || storageRangeOut.to,
          tz: storageRangeOut.tz || null,
        },
        data: {
          meta: {
            ...historyHeader,
            partition: monthKey,
          },
          events_daily: rows.map((r) => ({
            property_id: r.property_id,
            event: r.event,
            date: r.date,
            eventCount: round2(r.eventCount),
            conversions: round2(r.conversions),
          })),
        },
      });
    }
  }

  return {
    ok: true,
    notAuthorized: false,
    reason: null,
    range: contextRangeOut,
    contextTimeRange: {
      from: contextRangeOut.from,
      to: contextRangeOut.to,
      since: contextRangeOut.from,
      until: contextRangeOut.to,
      tz: contextRangeOut.tz || null,
      days: contextDays,
    },
    storageTimeRange: {
      from: storageRangeOut.from,
      to: storageRangeOut.to,
      since: storageRangeOut.from,
      until: storageRangeOut.to,
      tz: storageRangeOut.tz || null,
      days: storageDays,
    },
    storageRangeDays: storageDays,
    contextRangeDays: contextDays,
    properties: propertiesMetaOut,
    datasets,
    byProperty,
  };
}

module.exports = { collectGA4 };