// backend/services/googleAdsService.js
'use strict';

const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');

/* =========================
 * ENV / Constantes
 * ========================= */
const DEV_TOKEN =
  process.env.GOOGLE_DEVELOPER_TOKEN ||
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';

const LOGIN_CID = (
  process.env.GOOGLE_LOGIN_CUSTOMER_ID ||
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
  ''
).replace(/[^\d]/g, '');

const ADS_VER  = (process.env.GADS_API_VERSION || 'v18').trim(); // fija v22 en env
const ADS_HOST = 'https://googleads.googleapis.com';

const normId = (s = '') => String(s).replace(/[^\d]/g, '');

// OAuth client para refrescar access_token cuando sólo tenemos refresh_token
const OAUTH_CLIENT_ID =
  process.env.GOOGLE_ADS_CLIENT_ID ||
  process.env.GOOGLE_CLIENT_ID ||
  '';

const OAUTH_CLIENT_SECRET =
  process.env.GOOGLE_ADS_CLIENT_SECRET ||
  process.env.GOOGLE_CLIENT_SECRET ||
  '';

const OAUTH_REDIRECT_URI =
  process.env.GOOGLE_ADS_REDIRECT_URI ||
  process.env.GOOGLE_REDIRECT_URI ||
  process.env.GOOGLE_CONNECT_CALLBACK_URL ||
  '';

const oauthClient = new OAuth2Client({
  clientId: OAUTH_CLIENT_ID,
  clientSecret: OAUTH_CLIENT_SECRET,
  redirectUri: OAUTH_REDIRECT_URI,
});

/* =========================
 * Mini caché 60s (estabilidad)
 * ========================= */
const LRU = new Map();
function getCache(key) {
  const hit = LRU.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > 60_000) { LRU.delete(key); return null; }
  return hit.data;
}
function setCache(key, data) {
  LRU.set(key, { ts: Date.now(), data });
}

/* =========================
 * Helpers tokens
 * ========================= */

/**
 * Recibe:
 *  - string accessToken (modo viejo)
 *  - objeto GoogleAccount { refreshToken, accessToken, ... }
 * y devuelve un accessToken válido.
 */
async function resolveAccessToken(source) {
  if (!source) {
    throw new Error('resolveAccessToken: missing source');
  }

  // Caso 1: ya nos pasan el accessToken directamente (modo legacy)
  if (typeof source === 'string') {
    return source;
  }

  // Caso 2: objeto con accessToken todavía válido (no validamos expiración aquí)
  if (source.accessToken) {
    return source.accessToken;
  }

  // Caso 3: objeto con refreshToken → pedimos access_token a Google
  const rt = source.refreshToken || source.refresh_token;
  if (!rt) {
    throw new Error('resolveAccessToken: no refreshToken available');
  }

  oauthClient.setCredentials({ refresh_token: rt });
  const { token } = await oauthClient.getAccessToken();
  if (!token) {
    throw new Error('resolveAccessToken: failed to obtain access token from Google');
  }
  return token;
}

/* =========================
 * Headers / logging
 * ========================= */
function baseHeaders(accessToken) {
  if (!DEV_TOKEN) throw new Error('GOOGLE_DEVELOPER_TOKEN missing');
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    Accept: 'application/json',
  };
}

function buildApiLog({ url, method, reqHeaders, reqBody, res }) {
  const requestId =
    res?.headers?.['request-id'] ||
    res?.headers?.['x-request-id'] ||
    null;

  const safeHeaders = { ...(reqHeaders || {}) };
  if (safeHeaders.authorization) safeHeaders.authorization = String(safeHeaders.authorization).slice(0, 12) + '…***';
  if (safeHeaders['developer-token']) safeHeaders['developer-token'] = '***';
  if (safeHeaders['login-customer-id']) safeHeaders['login-customer-id'] = String(safeHeaders['login-customer-id']);

  return {
    url, method,
    reqHeaders: safeHeaders,
    reqBody: reqBody ?? null,
    status: res?.status,
    statusText: res?.statusText,
    resHeaders: res?.headers || {},
    requestId,
    resBodyPreview:
      typeof res?.data === 'string'
        ? (res.data.length > 1000 ? res.data.slice(0, 1000) + '…' : res.data)
        : res?.data,
  };
}

function shouldRetryWithLoginCid(errData) {
  const status = errData?.error?.status || '';
  const msg = (errData?.error?.message || '').toLowerCase();
  return (
    status === 'PERMISSION_DENIED' ||
    status === 'FAILED_PRECONDITION' ||
    msg.includes('login-customer-id') ||
    msg.includes('invalid login customer id') ||
    msg.includes('access not permitted') ||
    msg.includes('customer not enabled') ||
    msg.includes('no customer found') ||
    msg.includes('customer not accessible')
  );
}

async function requestRest({ accessToken, path, method = 'GET', body = null, loginCustomerId = null }) {
  const url = `${ADS_HOST}/${ADS_VER}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = baseHeaders(accessToken);
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId).replace(/[^\d]/g, '');
  if (body != null) headers['Content-Type'] = 'application/json';

  try {
    const res = await axios({
      url, method, headers,
      data: body ?? undefined,
      timeout: 60000,
      validateStatus: () => true,
    });

    const log = buildApiLog({ url, method, reqHeaders: headers, reqBody: body, res });
    return { ok: res.status >= 200 && res.status < 300, data: res.data, res, log };
  } catch (e) {
    const res = e?.response;
    const log = buildApiLog({ url, method, reqHeaders: headers, reqBody: body, res });
    return { ok: false, data: res?.data ?? e?.message, res, log };
  }
}

/* ========================================================================== *
 * 1) Descubrimiento de cuentas
 * ========================================================================== */

/**
 * IMPORTANTE: aquí el parámetro es SIEMPRE accessToken (string).
 * El soporte a GoogleAccount se hace en discoverAndEnrich() usando resolveAccessToken.
 */
async function listAccessibleCustomers(accessToken) {
  const r = await requestRest({
    accessToken,
    path: '/customers:listAccessibleCustomers',
    method: 'GET',
  });

  if (typeof r.data === 'string') {
    const err = new Error('[listAccessibleCustomers] Unexpected string response');
    err.api = { raw: r.data.slice(0, 300) + '…', log: r.log };
    throw err;
  }

  if (r.ok && Array.isArray(r.data?.resourceNames)) {
    return r.data.resourceNames;
  }

  const err = new Error(
    `[listAccessibleCustomers] ${r.data?.error?.status || r.res?.status || 'UNKNOWN'}: ${
      r.data?.error?.message || 'failed'
    }`
  );
  err.api = { error: r.data?.error || r.data || null, log: r.log };
  throw err;
}

async function getCustomer(accessToken, customerId) {
  const cid = normId(customerId);

  // 1) Primer intento: REST /customers/{cid}
  let r = await requestRest({
    accessToken,
    path: `/customers/${cid}`,
    method: 'GET',
  });

  if (!r.ok && shouldRetryWithLoginCid(r.data)) {
    r = await requestRest({
      accessToken,
      path: `/customers/${cid}`,
      method: 'GET',
      loginCustomerId: cid,
    });
  }

  if (!r.ok && LOGIN_CID) {
    r = await requestRest({
      accessToken,
      path: `/customers/${cid}`,
      method: 'GET',
      loginCustomerId: LOGIN_CID,
    });
  }

  if (!r.ok) {
    const err = new Error(
      `[getCustomer] ${r.data?.error?.status || r.res?.status || 'UNKNOWN'}: ${
        r.data?.error?.message || 'failed'
      }`
    );
    err.api = { error: r.data?.error || r.data || null, log: r.log };
    throw err;
  }

  const d = r.data || {};

  // Meta inicial desde REST
  let meta = {
    id: cid,
    name:
      d.descriptiveName ||
      d.descriptive_name ||
      null,
    currencyCode:
      d.currencyCode ||
      d.currency_code ||
      null,
    timeZone:
      d.timeZone ||
      d.time_zone ||
      null,
    status: d.status || null,
  };

  // 2) Si REST no trajo bien name / currency / tz, hacemos fallback con GAQL
  const needsGaql =
    !meta.name || !meta.currencyCode || !meta.timeZone;

  if (needsGaql) {
    try {
      const GAQL = `
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.status
        FROM customer
      `;

      // Ojo: aquí pasamos el accessToken como string; searchGAQLStream vuelve a usarlo tal cual
      const rows = await searchGAQLStream(accessToken, cid, GAQL);
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      const c = row?.customer || {};

      meta = {
        id: cid,
        name:
          meta.name ||
          c.descriptiveName ||
          c.descriptive_name ||
          `Cuenta ${cid}`,
        currencyCode:
          meta.currencyCode ||
          c.currencyCode ||
          c.currency_code ||
          null,
        timeZone:
          meta.timeZone ||
          c.timeZone ||
          c.time_zone ||
          null,
        status: meta.status || c.status || null,
      };
    } catch (e) {
      console.warn(
        '[getCustomer] GAQL fallback failed',
        e?.api?.error || e?.response?.data || e.message
      );
      // seguimos con lo que tengamos en meta (aunque falten campos)
    }
  }

  if (!meta.name) {
    meta.name = `Cuenta ${cid}`;
  }

  return meta;
}


/**
 * discoverAndEnrich ahora acepta:
 *  - string accessToken (modo viejo)
 *  - objeto GoogleAccount (nuevo flujo multi-usuario)
 */
async function discoverAndEnrich(source) {
  const accessToken = await resolveAccessToken(source);

  const list = await listAccessibleCustomers(accessToken);
  const ids = Array.from(
    new Set(
      (list || [])
        .map((rn) => String(rn || '').split('/')[1])
        .map((s) => s && s.replace(/[^\d]/g, ''))
        .filter(Boolean)
    )
  );

  const out = [];
  for (const id of ids) {
    try {
      const meta = await getCustomer(accessToken, id);
      out.push(meta);
    } catch (e) {
      out.push({ id, error: true, reason: e?.api?.error || e.message });
    }
  }
  return out;
}

/* ========================================================================== *
 * 2) GAQL (searchStream)
 * ========================================================================== */

/**
 * Igual que arriba: source puede ser accessToken string o GoogleAccount.
 */
async function searchGAQLStream(source, customerId, query) {
  // 👇 Esto sigue igual que antes
  const accessToken = await resolveAccessToken(source);
  const cid = normId(customerId);
  const body = { query };

  let r = await requestRest({
    accessToken,
    path: `/customers/${cid}/googleAds:searchStream`,
    method: 'POST',
    body,
  });

  if (!r.ok && shouldRetryWithLoginCid(r.data)) {
    r = await requestRest({
      accessToken,
      path: `/customers/${cid}/googleAds:searchStream`,
      method: 'POST',
      body,
      loginCustomerId: cid,
    });
  }

  if (!r.ok && LOGIN_CID) {
    r = await requestRest({
      accessToken,
      path: `/customers/${cid}/googleAds:searchStream`,
      method: 'POST',
      body,
      loginCustomerId: LOGIN_CID,
    });
  }

  // 👇 Esto también se queda igual: cómo procesamos la respuesta OK
  if (r.ok && Array.isArray(r.data)) {
    const rows = [];
    for (const chunk of r.data) {
      for (const res of chunk.results || []) rows.push(res);
    }
    return rows;
  }

  if (typeof r.data === 'string') {
    const err = new Error('[searchGAQLStream] Unexpected string response');
    err.api = { raw: r.data.slice(0, 300) + '…', log: r.log };
    throw err;
  }

  // 👇 AQUÍ VIENE EL CAMBIO IMPORTANTE (solo enriquecemos el error)
  const statusCode = r.res?.status || 500;
  const errStatus  = r.data?.error?.status || String(statusCode);
  const errMsg     = r.data?.error?.message || 'failed';

  const err = new Error(`[searchGAQLStream] ${errStatus}: ${errMsg}`);

  // añadimos campos directos para que el collector pueda loguearlos
  err.status = statusCode;
  err.code   = r.data?.error?.code;
  err.data   = r.data;

  // mantenemos err.api como ya estaba, para no romper nada existente
  err.api = {
    status: statusCode,
    error: r.data?.error || r.data || null,
    log: r.log,
  };

  // opcional: log interno (no afecta lógica)
  console.error('[searchGAQLStream] ERROR', {
    customerId: cid,
    status: err.status,
    code: err.code,
    message: errMsg,
  });

  throw err;
}


/* ========================================================================== *
 * 3) Fechas (TZ-aware) + include_today
 * ========================================================================== */
function startOfDayTZ(timeZone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const y = Number(parts.year),
    m = Number(parts.month),
    d = Number(parts.day);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}
function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

function computeRangeTZ({ preset, rangeDays, includeToday, timeZone }) {
  const p = String(preset || '').toLowerCase();

  // "today" y "yesterday" siempre anclados al día completo de la cuenta
  if (p === 'today') {
    const t0 = startOfDayTZ(timeZone);
    return [ymd(t0), ymd(t0)];
  }
  if (p === 'yesterday') {
    const y0 = addDays(startOfDayTZ(timeZone), -1);
    return [ymd(y0), ymd(y0)];
  }

  // this_month (hasta hoy si includeToday; de lo contrario hasta ayer)
  if (p === 'this_month') {
    const anchor = startOfDayTZ(timeZone);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(
      anchor
    );
    const obj = Object.fromEntries(parts.map((pp) => [pp.type, pp.value]));
    const y = +obj.year,
      m = +obj.month;
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = includeToday ? anchor : addDays(anchor, -1);
    return [ymd(start), ymd(end)];
  }

  // last_Xd (por defecto 30)
  const days = (() => {
    if (rangeDays) return Math.max(1, Number(rangeDays));
    if (p === 'last_7d') return 7;
    if (p === 'last_14d') return 14;
    if (p === 'last_28d') return 28;
    if (p === 'last_60d') return 60;
    if (p === 'last_90d') return 90;
    return 30;
  })();

  const anchor = includeToday ? startOfDayTZ(timeZone) : addDays(startOfDayTZ(timeZone), -1);
  const until = anchor;
  const since = addDays(until, -(days - 1));
  return [ymd(since), ymd(until)];
}

function microsToUnit(v) {
  const n = Number(v || 0);
  return Math.round((n / 1_000_000) * 100) / 100;
}

// Rellena días vacíos con ceros para que gráfico y KPIs sean consistentes
function fillSeriesDates(series, since, until) {
  const map = new Map(series.map((r) => [r.date, r]));
  const out = [];
  let d = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    const key = ymd(d);
    out.push(
      map.get(key) || {
        date: key,
        impressions: 0,
        clicks: 0,
        cost: 0,
        ctr: 0,
        cpc: 0,
        conversions: 0,
        conv_value: 0,
      }
    );
    d = addDays(d, 1);
  }
  return out;
}

/* ========================================================================== *
 * 4) Insights (KPIs + Serie)
 * ========================================================================== */

/**
 * Nuevo: acepta tanto:
 *  - { accessToken, customerId, ... } (modo viejo)
 *  - { googleAccount, customerId, ... } (nuevo flujo multi-usuario)
 */
async function fetchInsights({
  accessToken,
  googleAccount,
  customerId,
  datePreset,
  range,
  includeToday,
  objective,
  compareMode,
}) {
  if (!customerId) throw new Error('customerId required');
  const cid = normId(customerId);

  // Resolver token (string) usando accessToken directo o GoogleAccount
  const tokenSource = accessToken || googleAccount;
  if (!tokenSource) throw new Error('fetchInsights: accessToken or googleAccount required');
  const token = await resolveAccessToken(tokenSource);

  // tz/moneda del cliente
  let currency = 'MXN';
  let tz = 'America/Mexico_City';
  try {
    const cust = await getCustomer(token, cid);
    currency = cust.currencyCode || currency;
    tz = cust.timeZone || tz;
  } catch (_) {}

  const [since, until] = computeRangeTZ({
    preset: datePreset,
    rangeDays: range,
    includeToday: !!includeToday,
    timeZone: tz,
  });

  // helper: periodo anterior
  function previousWindow(a, b) {
    const d1 = new Date(`${a}T00:00:00Z`);
    const d2 = new Date(`${b}T00:00:00Z`);
    const days = Math.round((d2 - d1) / 86400000) + 1;
    const prevEnd = new Date(d1.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
    const fmt = (d) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate()
      ).padStart(2, '0')}`;
    return [fmt(prevStart), fmt(prevEnd)];
  }
  const [prevSince, prevUntil] = previousWindow(since, until);

  // clave de caché: incluye un pedacito del refreshToken/_id si viene GoogleAccount
  let cacheKey = `ins:${cid}:${since}:${until}:${objective || 'ventas'}`;
  if (googleAccount?.refreshToken) {
    cacheKey += `:${String(googleAccount.refreshToken).slice(0, 8)}`;
  } else if (googleAccount?._id) {
    cacheKey += `:${googleAccount._id}`;
  }

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const GAQL_SERIE = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${since}' AND '${until}'
    ORDER BY segments.date
  `;

  const rows = await searchGAQLStream(token, cid, GAQL_SERIE);

  const rawSeries = rows
    .map((r) => {
      const seg = r.segments || {};
      const met = r.metrics || {};

      const impressions = Number(met.impressions || 0);
      const clicks = Number(met.clicks || 0);
      const costMicros = met.costMicros ?? met.cost_micros ?? 0;
      const cost = microsToUnit(costMicros);

      const avgCpcUnits =
        (typeof met.averageCpc === 'number' ? met.averageCpc : undefined) ??
        (typeof met.average_cpc === 'number' ? met.average_cpc : undefined) ??
        (typeof met.averageCpcMicros === 'number' ? met.averageCpcMicros / 1_000_000 : undefined) ??
        (typeof met.average_cpc_micros === 'number' ? met.average_cpc_micros / 1_000_000 : undefined);

      const conversions = Number(met.conversions || 0);
      const conv_value = Number(met.conversionsValue ?? met.conversions_value ?? 0);

      const cpc = typeof avgCpcUnits === 'number' ? avgCpcUnits : clicks > 0 ? cost / clicks : 0;

      const ctr = impressions ? clicks / impressions : 0;
      const cpm = impressions ? (cost / impressions) * 1000 : 0;
      const cpl = conversions ? cost / conversions : 0;

      return {
        date: seg.date,
        impressions,
        clicks,
        cost,
        ctr,
        cpc,
        conversions,
        conv_value,
        cpm,
        cpl,
      };
    })
    .filter((r) => !!r.date);

  const series = fillSeriesDates(rawSeries, since, until);

  const kpis = series.reduce(
    (a, p) => ({
      impressions: a.impressions + (p.impressions || 0),
      clicks: a.clicks + (p.clicks || 0),
      cost: a.cost + (p.cost || 0),
      conversions: a.conversions + (p.conversions || 0),
      conv_value: a.conv_value + (p.conv_value || 0),
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conv_value: 0 }
  );

  kpis.ctr = kpis.impressions ? kpis.clicks / kpis.impressions : 0;
  kpis.cpc = kpis.clicks ? kpis.cost / kpis.clicks : 0;
  kpis.cpa = kpis.conversions ? kpis.cost / kpis.conversions : undefined;
  kpis.roas = kpis.cost ? kpis.conv_value / kpis.cost : undefined;
  kpis.cpm = kpis.impressions ? (kpis.cost / kpis.impressions) * 1000 : 0;
  kpis.cpl = kpis.conversions ? kpis.cost / kpis.conversions : 0;

  const GAQL_TOTAL = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${prevSince}' AND '${prevUntil}'
  `;
  const prevRows = await searchGAQLStream(token, cid, GAQL_TOTAL);
  const pr = prevRows?.[0]?.metrics || {};
  const prev = {
    impressions: Number(pr.impressions || 0),
    clicks: Number(pr.clicks || 0),
    cost: microsToUnit(pr.costMicros ?? pr.cost_micros ?? 0),
    conversions: Number(pr.conversions || 0),
    conv_value: Number(pr.conversionsValue ?? pr.conversions_value ?? 0),
  };
  prev.ctr = prev.impressions ? prev.clicks / prev.impressions : 0;
  prev.cpc = prev.clicks ? prev.cost / prev.clicks : 0;
  prev.cpa = prev.conversions ? prev.cost / prev.conversions : undefined;
  prev.roas = prev.cost ? prev.conv_value / prev.cost : undefined;
  prev.cpm = prev.impressions ? (prev.cost / prev.impressions) * 1000 : 0;
  prev.cpl = prev.conversions ? prev.cost / prev.conversions : 0;

  function delta(now, before) {
    const bn = Number(before || 0);
    if (!bn) return null;
    return (Number(now || 0) - bn) / bn;
  }
  const deltas = {
    impressions: delta(kpis.impressions, prev.impressions),
    clicks: delta(kpis.clicks, prev.clicks),
    cost: delta(kpis.cost, prev.cost),
    conversions: delta(kpis.conversions, prev.conversions),
    conv_value: delta(kpis.conv_value, prev.conv_value),
    ctr: delta(kpis.ctr, prev.ctr),
    cpc: delta(kpis.cpc, prev.cpc),
    cpa: delta(kpis.cpa, prev.cpa),
    roas: delta(kpis.roas, prev.roas),
    cpm: delta(kpis.cpm, prev.cpm),
    cpl: delta(kpis.cpl, prev.cpl),
  };

  const payload = {
    ok: true,
    objective: ['ventas', 'alcance', 'leads'].includes(String(objective)) ? objective : 'ventas',
    customer_id: cid,
    range: { since, until },
    prev_range: { since: prevSince, until: prevUntil },
    is_partial: String(datePreset || '').toLowerCase() === 'today' && !!includeToday,
    kpis,
    deltas,
    series,
    currency,
    locale: tz?.startsWith('Europe/') ? 'es-ES' : 'es-MX',
    cachedAt: new Date().toISOString(),
  };

  setCache(cacheKey, payload);
  return payload;
}

/* ========================================================================== *
 * 5) MCC (legacy)  ← REST
 * ========================================================================== */

async function mccInviteCustomer({ accessToken, managerId, clientId }) {
  const mid = normId(managerId);
  const cid = normId(clientId);

  const path = `/customers/${mid}/customerManagerLinks:mutate`;
  const body = {
    operations: [
      {
        create: {
          manager: `customers/${mid}`,
          clientCustomer: `customers/${cid}`,
        },
      },
    ],
  };

  const r = await requestRest({
    accessToken,
    path,
    method: 'POST',
    body,
    loginCustomerId: mid,
  });

  if (!r.ok) {
    const err = new Error(
      `[mccInviteCustomer] ${r.data?.error?.status || r.res?.status}: ${
        r.data?.error?.message || 'failed'
      }`
    );
    err.api = { error: r.data?.error || r.data, log: r.log };
    throw err;
  }

  return r.data;
}

async function getMccLinkStatus({ accessToken, managerId, clientId }) {
  const mid = normId(managerId);
  const cid = normId(clientId);

  const path = `/customers/${cid}/customerManagerLinks`;
  const r = await requestRest({
    accessToken,
    path,
    method: 'GET',
  });

  if (!r.ok) {
    const err = new Error(
      `[getMccLinkStatus] ${r.data?.error?.status || r.res?.status}: ${
        r.data?.error?.message || 'failed'
      }`
    );
    err.api = { error: r.data?.error || r.data, log: r.log };
    throw err;
  }

  const links = Array.isArray(r.data?.customerManagerLinks) ? r.data.customerManagerLinks : [];
  const mine = links.find((l) => (l.manager || '').endsWith(`/${mid}`));

  return {
    exists: !!mine,
    status: mine?.status || 'UNKNOWN',
    link: mine || null,
  };
}

/* ========================================================================== *
 * 6) Self-test (para el callback)
 * ========================================================================== */

async function selfTest(source) {
  const token = await resolveAccessToken(source);
  const names = await listAccessibleCustomers(token);
  const ids = Array.from(
    new Set(
      (names || [])
        .map((rn) => String(rn || '').split('/')[1])
        .map((s) => s && s.replace(/[^\d]/g, ''))
        .filter(Boolean)
    )
  );
  return {
    ok: true,
    accessibleCount: ids.length,
    sample: ids.slice(0, 5),
  };
}

/* ========================================================================== *
 * Exports
 * ========================================================================== */
module.exports = {
  // descubrimiento de cuentas
  listAccessibleCustomers,
  listAccessibleCustomersRaw: listAccessibleCustomers,
  getCustomer,
  discoverAndEnrich,

  // GAQL / insights
  searchGAQLStream,
  fetchInsights,

  // Self-test multi-usuario
  selfTest,

  // MCC (legacy)
  mccInviteCustomer,
  getMccLinkStatus,
};
