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
    accessToken: { type: String, select: false },
    refreshToken:{ type: String, select: false },

    gaProperties: { type: Array, default: [] }, // [{ propertyId, displayName, account, accountName? }, ...]
    defaultPropertyId: String,

    // ✅ NUEVO CANÓNICO (tu onboarding/Settings ya lo usa)
    selectedPropertyIds: { type: [String], default: [] },

    scope: { type: [String], default: [] },
    expiresAt: { type: Date },
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

function oauthClient() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
  });
}

/**
 * ✅ Token refresh robusto:
 * - Si hay accessToken pero está vigente (expiresAt - 60s), lo usamos.
 * - Si no, refrescamos con refreshToken y persistimos.
 */
async function ensureAccessToken(accDoc) {
  if (accDoc?.accessToken && accDoc?.expiresAt) {
    const ms = new Date(accDoc.expiresAt).getTime() - Date.now();
    if (ms > 60_000) return accDoc.accessToken; // válido > 60s
  }

  if (!accDoc?.refreshToken && accDoc?.accessToken) {
    // no podemos refrescar; devolvemos el existente (mejor que null)
    return accDoc.accessToken;
  }
  if (!accDoc?.refreshToken) return null;

  const client = oauthClient();
  client.setCredentials({ refresh_token: accDoc.refreshToken });

  try {
    const { credentials } = await client.refreshAccessToken();
    const token = credentials?.access_token || null;

    if (token) {
      await GoogleAccount.updateOne(
        { _id: accDoc._id },
        {
          $set: {
            accessToken: token,
            expiresAt: credentials?.expiry_date ? new Date(credentials.expiry_date) : null,
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
    return accDoc?.accessToken || null;
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

        // 429/5xx -> reintenta
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

/** Ejecuta runReport de GA4 */
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

/** '30daysAgo' / 'yesterday' → GA4 acepta estos literales tal cual */
function resolveDateRange({ start = '30daysAgo', end = 'yesterday' }) {
  const abs = /^\d{4}-\d{2}-\d{2}$/;
  const isAbs = abs.test(String(start)) && abs.test(String(end));
  return isAbs ? { start, end } : { start, end };
}

/* -------- selección de propiedades (CANÓNICA + compat) -------- */

function listAvailableProperties(acc) {
  const list = Array.isArray(acc?.gaProperties) ? acc.gaProperties : [];
  return list.map(p => {
    const id = normPropertyId(p?.propertyId || p?.id);
    return id
      ? { id, displayName: p?.displayName || '', accountName: p?.accountName || p?.account || '' }
      : null;
  }).filter(Boolean);
}

/**
 * ✅ Resolver propiedades E2E:
 * prioridad:
 * 1) forcedPropertyId (opts.property_id)
 * 2) accDoc.selectedPropertyIds (CANÓNICO)
 * 3) accDoc.defaultPropertyId
 * 4) User.preferences.googleAnalytics.auditPropertyIds (legacy)
 * 5) si available <= MAX_BY_RULE -> todas
 * 6) si available > MAX_BY_RULE -> requiredSelection
 */
async function resolvePropertiesForAudit({ userId, accDoc, forcedPropertyId }) {
  let available = listAvailableProperties(accDoc);
  const byId = new Map(available.map(a => [a.id, a]));

  // 1) override del caller (forzar una sola)
  if (forcedPropertyId) {
    const id = normPropertyId(forcedPropertyId);
    if (id) return [{ id, displayName: byId.get(id)?.displayName || '', accountName: byId.get(id)?.accountName || '' }];
  }

  // 2) CANÓNICO: selectedPropertyIds en GoogleAccount
  const selectedAcc = (Array.isArray(accDoc?.selectedPropertyIds) ? accDoc.selectedPropertyIds : [])
    .map(normPropertyId)
    .filter(Boolean);

  if (selectedAcc.length > 0) {
    const picked = [...new Set(selectedAcc)]
      .filter(id => (available.length ? byId.has(id) : true))
      .slice(0, MAX_BY_RULE)
      .map(id => byId.get(id) || ({ id, displayName: '', accountName: '' }));

    if (picked.length) return picked;
  }

  // 3) defaultPropertyId
  const d = normPropertyId(accDoc?.defaultPropertyId);
  if (d) {
    return [{ id: d, displayName: byId.get(d)?.displayName || '', accountName: byId.get(d)?.accountName || '' }];
  }

  // 4) legacy: preferencias en User (por compat)
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
      .map(id => byId.get(id) || ({ id, displayName: '', accountName: '' }));

    if (picked.length) return picked;
    return { error: 'NO_VALID_SELECTED_PROPERTIES' };
  }

  // 5) si no hay available, no hay forma de seleccionar
  if (!available.length) return { error: 'NO_DEFAULT_PROPERTY' };

  // 6) sin selección: si disponibles <= MAX_BY_RULE, usa todas; si > MAX_BY_RULE, requiere selección
  if (available.length <= MAX_BY_RULE) return available;

  return { error: 'SELECTION_REQUIRED(>3_PROPERTIES)', availableCount: available.length };
}

/* ---------------- collector ---------------- */
async function collectGA4(
  userId,
  { property_id, start = '30daysAgo', end = 'yesterday' } = {}
) {
  // 1) Cargar cuenta con tokens y scopes
  const acc = await GoogleAccount
    .findOne({ $or: [{ user: userId }, { userId }] })
    .select('+accessToken +refreshToken +expiresAt scope defaultPropertyId selectedPropertyIds gaProperties')
    .lean();

  if (!acc) {
    return { notAuthorized: true, reason: 'NO_GOOGLEACCOUNT' };
  }

  // 2) Validar scope
  const hasScope = Array.isArray(acc.scope) && acc.scope.includes(GA_SCOPE_READ);
  if (!hasScope) {
    return { notAuthorized: true, reason: 'MISSING_SCOPE(analytics.readonly)' };
  }

  // 3) token (con refresco robusto)
  let token = await ensureAccessToken(acc);
  if (!token) {
    return { notAuthorized: true, reason: 'NO_ACCESS_TOKEN' };
  }

  // helper local: runReport con refresco en caso de 401/403
  async function runReportWithRetry(property, body) {
    try {
      return await ga4RunReport({ token, property, body });
    } catch (e) {
      const http = e?._ga?.http;
      if ((http === 401 || http === 403) && acc.refreshToken) {
        token = await ensureAccessToken({ ...acc, accessToken: null, expiresAt: null });
        if (!token) throw e;
        return await ga4RunReport({ token, property, body });
      }
      throw e;
    }
  }

  // 4) resolver propiedades a auditar (CANÓNICO)
  const resolved = await resolvePropertiesForAudit({
    userId,
    accDoc: acc,
    forcedPropertyId: property_id
  });

  if (resolved?.error) {
    if (resolved.error === 'NO_DEFAULT_PROPERTY') {
      return { notAuthorized: true, reason: 'NO_DEFAULT_PROPERTY' };
    }
    if (resolved.error === 'NO_VALID_SELECTED_PROPERTIES') {
      return { notAuthorized: true, reason: 'NO_VALID_SELECTED_PROPERTIES' };
    }
    if (String(resolved.error).startsWith('SELECTION_REQUIRED')) {
      return { notAuthorized: true, reason: resolved.error, requiredSelection: true, availableCount: resolved.availableCount || null };
    }
  }

  const propertiesToAudit = (Array.isArray(resolved) ? resolved : []).slice(0, MAX_BY_RULE);

  if (DEBUG_GA_COLLECTOR) {
    console.log('[ga4Collector] -> auditing GA4 properties:', propertiesToAudit.map(p => p.id));
  }

  const dateRange = resolveDateRange({ start, end });

  /* ========= Reportes (base + enriquecidos para IA) ========= */

  // 1) Canales (channel grouping)
  const channelsBody = {
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'newUsers' },
      { name: 'engagedSessions' },
    ],
    limit: '1000',
  };

  // 2) Dispositivos
  const devicesBody = {
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
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

  // 3) Landing pages
  const landingBody = {
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'landingPagePlusQueryString' }],
    metrics: [
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'engagedSessions' },
    ],
    limit: '5000',
  };

  // 4) Tendencia diaria (para detectar caídas/picos y estacionalidad)
  const dailyBody = {
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
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

  // 5) Source / Medium (calidad de adquisición)
  const sourceMediumBody = {
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
      { name: 'engagedSessions' },
    ],
    limit: '5000',
  };

  // 6) Top eventos (para IA: qué está ocurriendo en el sitio)
  const topEventsBody = {
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'eventName' }],
    metrics: [
      { name: 'eventCount' },
      { name: 'conversions' },
    ],
    limit: '200',
  };

  const byProperty = [];
  let aggregate = {
    users: 0, sessions: 0, conversions: 0, revenue: 0,
    newUsers: 0, engagedSessions: 0,
  };

  const globalChannelsMap = new Map();
  const globalDevicesMap  = new Map();
  const globalLandingMap  = new Map();

  const globalDailyMap = new Map(); // date -> {users,sessions,conversions,revenue,engagedSessions}
  const globalSourceMediumMap = new Map(); // "source|medium" -> metrics
  const globalTopEventsMap = new Map(); // eventName -> {eventCount, conversions}

  // 6) Ejecutar para cada propiedad seleccionada
  for (const prop of propertiesToAudit) {
    const property = prop.id;

    const meta = (Array.isArray(acc.gaProperties) ? acc.gaProperties : []).find(p =>
      normPropertyId(p.propertyId) === property
    ) || {};

    const accountName  = meta.accountName || meta.account || prop.accountName || '';
    const propertyName = meta.displayName || prop.displayName || '';

    // ---- canales ----
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
        accountName,
        propertyName,
        dateRange,
        error: true,
        reason,

        channels: [],
        devices: [],
        landingPages: [],
        daily: [],
        sourceMedium: [],
        topEvents: [],

        kpis: {
          users: 0, sessions: 0, conversions: 0, revenue: 0,
          newUsers: 0, engagedSessions: 0,
          engagementRate: 0,
        },
      });
      continue;
    }

    const rows = Array.isArray(jChannels?.rows) ? jChannels.rows : [];
    const channels = rows.map(rw => ({
      channel:     rw.dimensionValues?.[0]?.value || '(other)',
      users:       toNum(rw.metricValues?.[0]?.value),
      sessions:    toNum(rw.metricValues?.[1]?.value),
      conversions: toNum(rw.metricValues?.[2]?.value),
      revenue:     toNum(rw.metricValues?.[3]?.value),
      newUsers:    toNum(rw.metricValues?.[4]?.value),
      engagedSessions: toNum(rw.metricValues?.[5]?.value),
    }));

    const propAgg = {
      users: 0, sessions: 0, conversions: 0, revenue: 0,
      newUsers: 0, engagedSessions: 0,
    };

    for (const c of channels) {
      propAgg.users += c.users || 0;
      propAgg.sessions += c.sessions || 0;
      propAgg.conversions += c.conversions || 0;
      propAgg.revenue += c.revenue || 0;
      propAgg.newUsers += c.newUsers || 0;
      propAgg.engagedSessions += c.engagedSessions || 0;

      aggregate.users += c.users || 0;
      aggregate.sessions += c.sessions || 0;
      aggregate.conversions += c.conversions || 0;
      aggregate.revenue += c.revenue || 0;
      aggregate.newUsers += c.newUsers || 0;
      aggregate.engagedSessions += c.engagedSessions || 0;

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

    // ---- dispositivos ----
    let devices = [];
    try {
      const jDevices = await runReportWithRetry(property, devicesBody);
      const dRows = Array.isArray(jDevices?.rows) ? jDevices.rows : [];
      devices = dRows.map(rw => ({
        device:      rw.dimensionValues?.[0]?.value || '(other)',
        users:       toNum(rw.metricValues?.[0]?.value),
        sessions:    toNum(rw.metricValues?.[1]?.value),
        conversions: toNum(rw.metricValues?.[2]?.value),
        revenue:     toNum(rw.metricValues?.[3]?.value),
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

    // ---- landing pages ----
    let landingPages = [];
    try {
      const jLanding = await runReportWithRetry(property, landingBody);
      const lRows = Array.isArray(jLanding?.rows) ? jLanding.rows : [];
      landingPages = lRows.map(rw => ({
        page:        rw.dimensionValues?.[0]?.value || '(not set)',
        sessions:    toNum(rw.metricValues?.[0]?.value),
        conversions: toNum(rw.metricValues?.[1]?.value),
        revenue:     toNum(rw.metricValues?.[2]?.value),
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

    // ---- daily trend ----
    let daily = [];
    try {
      const jDaily = await runReportWithRetry(property, dailyBody);
      const tRows = Array.isArray(jDaily?.rows) ? jDaily.rows : [];
      daily = tRows.map(rw => {
        const raw = rw.dimensionValues?.[0]?.value || '';
        // GA4 date: YYYYMMDD -> YYYY-MM-DD
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

    // ---- source/medium ----
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

    // ---- top events ----
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

    // Limitar tamaños para no inflar el prompt del LLM
    landingPages.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
    landingPages = landingPages.slice(0, 60);

    sourceMedium.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
    sourceMedium = sourceMedium.slice(0, 80);

    topEvents.sort((a, b) => (b.eventCount || 0) - (a.eventCount || 0));
    topEvents = topEvents.slice(0, 80);

    // KPI enriquecidos
    const engagementRate = safeDiv(propAgg.engagedSessions, propAgg.sessions) * 100;

    byProperty.push({
      property,
      accountName,
      propertyName,
      dateRange,

      channels,
      devices,
      landingPages,
      daily,
      sourceMedium,
      topEvents,

      kpis: {
        users: propAgg.users,
        sessions: propAgg.sessions,
        conversions: propAgg.conversions,
        revenue: propAgg.revenue,
        newUsers: propAgg.newUsers,
        engagedSessions: propAgg.engagedSessions,
        engagementRate,
      },
    });
  }

  // Global maps -> arrays
  const channelsGlobal = Array.from(globalChannelsMap.entries()).map(([channel, m]) => ({
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

  const devicesGlobal = Array.from(globalDevicesMap.entries()).map(([device, m]) => ({
    device,
    users: m.users,
    sessions: m.sessions,
    conversions: m.conversions,
    revenue: m.revenue,
    engagedSessions: m.engagedSessions,
    engagementRate: safeDiv(m.engagedSessions, m.sessions) * 100,
  }));
  devicesGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));

  let landingGlobal = Array.from(globalLandingMap.entries()).map(([page, m]) => ({
    page,
    sessions: m.sessions,
    conversions: m.conversions,
    revenue: m.revenue,
    engagedSessions: m.engagedSessions,
    engagementRate: safeDiv(m.engagedSessions, m.sessions) * 100,
  }));
  landingGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  landingGlobal = landingGlobal.slice(0, 100);

  let dailyGlobal = Array.from(globalDailyMap.entries())
    .map(([date, m]) => ({ date, ...m }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let sourceMediumGlobal = Array.from(globalSourceMediumMap.entries()).map(([k, m]) => {
    const [source, medium] = k.split('|');
    return { source, medium, ...m, engagementRate: safeDiv(m.engagedSessions, m.sessions) * 100 };
  });
  sourceMediumGlobal.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  sourceMediumGlobal = sourceMediumGlobal.slice(0, 120);

  let topEventsGlobal = Array.from(globalTopEventsMap.entries()).map(([event, m]) => ({
    event,
    eventCount: m.eventCount,
    conversions: m.conversions,
  }));
  topEventsGlobal.sort((a, b) => (b.eventCount || 0) - (a.eventCount || 0));
  topEventsGlobal = topEventsGlobal.slice(0, 120);

  const properties = byProperty.map(p => ({
    id: p.property,
    accountName: p.accountName,
    propertyName: p.propertyName
  }));

  // Compat: si sólo hubo una propiedad, exponer campos “simples”
  if (byProperty.length === 1) {
    const p = byProperty[0];
    return {
      notAuthorized: false,
      property: p.property,
      accountName: p.accountName,
      propertyName: p.propertyName,
      dateRange,

      // compat (global == property)
      channels: channelsGlobal,
      devices: devicesGlobal,
      landingPages: landingGlobal,

      // ✅ enriquecidos
      daily: dailyGlobal,
      sourceMedium: sourceMediumGlobal,
      topEvents: topEventsGlobal,

      byProperty,
      aggregate,
      properties,
      version: 'ga4Collector@canonical-selection+rich-v3',
    };
  }

  return {
    notAuthorized: false,
    dateRange,
    channels: channelsGlobal,
    devices: devicesGlobal,
    landingPages: landingGlobal,

    // ✅ enriquecidos
    daily: dailyGlobal,
    sourceMedium: sourceMediumGlobal,
    topEvents: topEventsGlobal,

    byProperty,
    aggregate,
    properties,
    version: 'ga4Collector@canonical-selection+rich-v3',
  };
}

module.exports = { collectGA4 };
