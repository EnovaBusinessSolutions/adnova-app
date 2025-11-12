// backend/services/googleAdsService.js
'use strict';

const axios = require('axios');

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

const ADS_VER  = (process.env.GADS_API_VERSION || 'v18').trim();
const ADS_HOST = 'https://googleads.googleapis.com';

const normId = (s = '') => String(s).replace(/[^\d]/g, '');

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

  const err = new Error(`[listAccessibleCustomers] ${r.data?.error?.status || r.res?.status || 'UNKNOWN'}: ${r.data?.error?.message || 'failed'}`);
  err.api = { error: r.data?.error || r.data || null, log: r.log };
  throw err;
}

async function getCustomer(accessToken, customerId) {
  const cid = normId(customerId);

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

  if (r.ok) {
    const d = r.data || {};
    return {
      id: cid,
      name: d?.descriptiveName || `Cuenta ${cid}`,
      currencyCode: d?.currencyCode || null,
      timeZone: d?.timeZone || null,
      status: d?.status || null,
    };
  }

  const err = new Error(`[getCustomer] ${r.data?.error?.status || r.res?.status || 'UNKNOWN'}: ${r.data?.error?.message || 'failed'}`);
  err.api = { error: r.data?.error || r.data || null, log: r.log };
  throw err;
}

async function discoverAndEnrich(accessToken) {
  const list = await listAccessibleCustomers(accessToken);
  const ids = Array.from(
    new Set(
      (list || [])
        .map(rn => String(rn || '').split('/')[1])
        .map(s => s && s.replace(/[^\d]/g, ''))
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
      console.warn('[discoverAndEnrich] getCustomer fail', id, e?.api || e.message);
    }
  }
  return out;
}

/* ========================================================================== *
 * 2) GAQL (searchStream)
 * ========================================================================== */

async function searchGAQLStream(accessToken, customerId, query) {
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

  if (r.ok && Array.isArray(r.data)) {
    const rows = [];
    for (const chunk of r.data) {
      for (const res of (chunk.results || [])) rows.push(res);
    }
    return rows;
  }

  if (typeof r.data === 'string') {
    const err = new Error('[searchGAQLStream] Unexpected string response');
    err.api = { raw: r.data.slice(0, 300) + '…', log: r.log };
    throw err;
  }

  const err = new Error(`[searchGAQLStream] ${r.data?.error?.status || r.res?.status || 'UNKNOWN'}: ${r.data?.error?.message || 'failed'}`);
  err.api = { status: r.res?.status, error: r.data?.error || r.data || null, log: r.log };
  throw err;
}

/* ========================================================================== *
 * 3) Fechas — *con zona horaria del cliente* y include_today
 * ========================================================================== */

function startOfDayTZ(timeZone, date = new Date()) {
  // Usa Intl para obtener Y/M/D en la TZ y vuelve a construir UTC 00:00 de ese día en esa TZ
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}
function addDays(d, n) { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
function ymd(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }

/**
 * Devuelve [since, until] en la TZ dada.
 * - presets soportados: today, yesterday, last_7d, last_14d, last_28d, last_30d (default)
 * - includeToday: sólo afecta a presets tipo "last_*"
 */
function computeRangeTZ({ preset, rangeDays, includeToday, timeZone }) {
  const presetLC = String(preset || '').toLowerCase();
  const anchor = includeToday ? startOfDayTZ(timeZone) : addDays(startOfDayTZ(timeZone), -1);

  if (presetLC === 'today') {
    const t0 = startOfDayTZ(timeZone);
    return [ymd(t0), ymd(t0)];
  }
  if (presetLC === 'yesterday') {
    const y0 = addDays(startOfDayTZ(timeZone), -1);
    return [ymd(y0), ymd(y0)];
  }

  const days = (() => {
    if (rangeDays) return Math.max(1, Number(rangeDays));
    if (presetLC === 'last_7d')  return 7;
    if (presetLC === 'last_14d') return 14;
    if (presetLC === 'last_28d') return 28;
    return 30; // last_30d por defecto
  })();

  const until = anchor;
  const since = addDays(until, -(days - 1));
  return [ymd(since), ymd(until)];
}

function microsToUnit(v) {
  const n = Number(v || 0);
  return Math.round((n / 1_000_000) * 100) / 100;
}

/* ========================================================================== *
 * 4) Insights (KPIs + Serie) — ahora 100% TZ-aware y sin estáticos
 * ========================================================================== */
async function fetchInsights({
  accessToken,
  customerId,
  datePreset,
  range,
  includeToday,
  objective,
  compareMode,
}) {
  if (!customerId) throw new Error('customerId required');
  const cid = normId(customerId);

  // 1) Obtener TZ y moneda del cliente primero (para construir el rango correctamente)
  let currency = 'MXN';
  let tz = 'America/Mexico_City';
  try {
    const cust = await getCustomer(accessToken, cid);
    currency = cust.currencyCode || currency;
    tz = cust.timeZone || tz;
  } catch (_) { /* fallback por si falla */ }

  // 2) Construir rango en la TZ del cliente
  const [since, until] = computeRangeTZ({
    preset: datePreset,
    rangeDays: range,
    includeToday: !!includeToday,
    timeZone: tz,
  });

  // 3) GAQL por día
  const GAQL_SERIE = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${since}' AND '${until}'
    ORDER BY segments.date
  `;

  const rows = await searchGAQLStream(accessToken, cid, GAQL_SERIE);

  const series = rows.map(r => {
    const seg  = r.segments || {};
    const met  = r.metrics  || {};
    const costMicros   = met.costMicros ?? met.cost_micros;
    const avgCpcMicros = met.averageCpcMicros ?? met.average_cpc_micros;
    const convValue    = met.conversionsValue ?? met.conversions_value ?? 0;
    return {
      date: seg.date,
      impressions: Number(met.impressions || 0),
      clicks: Number(met.clicks || 0),
      cost: microsToUnit(costMicros),
      ctr: Number(met.ctr || 0),
      cpc: microsToUnit(avgCpcMicros),
      conversions: Number(met.conversions || 0),
      conv_value: Number(convValue),
      currency_code: currency,
      time_zone: tz,
    };
  });

  // 4) KPIs agregados coherentes con la serie
  const kpis = series.reduce((a, p) => ({
    impressions: a.impressions + (p.impressions || 0),
    clicks:      a.clicks + (p.clicks || 0),
    cost:        a.cost + (p.cost || 0),
    conversions: a.conversions + (p.conversions || 0),
    conv_value:  a.conv_value + (p.conv_value || 0),
  }), { impressions:0, clicks:0, cost:0, conversions:0, conv_value:0 });

  kpis.ctr = kpis.impressions ? (kpis.clicks / kpis.impressions) : 0;
  kpis.cpc = kpis.clicks ? (kpis.cost / kpis.clicks) : 0;
  kpis.cpa  = kpis.conversions ? (kpis.cost / kpis.conversions) : undefined;
  kpis.roas = kpis.cost ? (kpis.conv_value / kpis.cost) : undefined;

  return {
    ok: true,
    objective: (['ventas','alcance','leads'].includes(String(objective)) ? objective : 'ventas'),
    customer_id: cid,
    range: { since, until },
    prev_range: { since, until }, // (si luego quieres comparar, aquí puedes calcular prev)
    is_partial: !!includeToday,
    kpis,
    deltas: {},
    series,
    currency,
    locale: tz?.startsWith('Europe/') ? 'es-ES' : 'es-MX',
  };
}

/* ========================================================================== *
 * Exports
 * ========================================================================== */
module.exports = {
  listAccessibleCustomers,
  listAccessibleCustomersRaw: listAccessibleCustomers,
  getCustomer,
  searchGAQLStream,
  discoverAndEnrich,
  fetchInsights,
  // MCC:
  mccInviteCustomer,
  getMccLinkStatus,
};
