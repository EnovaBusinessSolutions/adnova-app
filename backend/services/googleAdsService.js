// backend/services/googleAdsService.js
'use strict';

const axios = require('axios');

/* =========================
 * ENV / Constantes
 * ========================= */
const DEV_TOKEN =
  process.env.GOOGLE_DEVELOPER_TOKEN ||
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN || // compat
  '';

const LOGIN_CID = (
  process.env.GOOGLE_LOGIN_CUSTOMER_ID ||
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
  ''
).replace(/[^\d]/g, '');

const ADS_VER  = (process.env.GADS_API_VERSION || 'v22').trim(); // v22 por defecto
const ADS_HOST = 'https://googleads.googleapis.com';

const normId = (s = '') => String(s).replace(/[^\d]/g, '');

/* =========================
 * Helpers de logging y headers
 * ========================= */
function baseHeaders(accessToken) {
  if (!DEV_TOKEN) throw new Error('GOOGLE_DEVELOPER_TOKEN missing');
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/** Devuelve request-id y un preview útil del body para soporte. */
function buildApiLog({ url, method, reqHeaders, reqBody, res }) {
  const requestId =
    res?.headers?.['request-id'] ||
    res?.headers?.['x-request-id'] ||
    null;

  return {
    url,
    method,
    reqHeaders,
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

/** Errores típicos que piden contexto login-customer-id */
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

/**
 * requestV22
 * - path debe empezar con "/"
 * - incluye developer-token y Authorization
 * - si pasas loginCustomerId lo agrega como header
 * - devuelve { ok, data, res, log }
 */
async function requestV22({ accessToken, path, method = 'GET', body = null, loginCustomerId = null }) {
  const url = `${ADS_HOST}/${ADS_VER}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = baseHeaders(accessToken);
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId).replace(/[^\d]/g, '');

  try {
    const res = await axios({
      url,
      method,
      headers,
      // ⚠️ MUY IMPORTANTE: body debe ser JSON { query: "..." }, no string crudo
      data: body,
      timeout: 60000,
      validateStatus: () => true, // dejamos pasar 4xx/5xx para leer request-id
    });

    const log = buildApiLog({ url, method, reqHeaders: headers, reqBody: body, res });

    return {
      ok: res.status >= 200 && res.status < 300,
      data: res.data,
      res,
      log,
    };
  } catch (e) {
    const res = e?.response;
    const log = buildApiLog({ url, method, reqHeaders: headers, reqBody: body, res });
    return { ok: false, data: res?.data ?? e?.message, res, log };
  }
}

/* ========================================================================== *
 * 1) Descubrimiento de cuentas
 * ========================================================================== */

/** IMPORTANTE: listAccessibleCustomers NO lleva login-customer-id. */
async function listAccessibleCustomers(accessToken) {
  const r = await requestV22({
    accessToken,
    path: '/customers:listAccessibleCustomers',
    method: 'GET',
  });

  if (r.ok && Array.isArray(r.data?.resourceNames)) {
    return r.data.resourceNames; // ["customers/123", ...]
  }

  const err = new Error(`[listAccessibleCustomers] ${r.data?.error?.status || r.res?.status || 'UNKNOWN'}: ${r.data?.error?.message || 'failed'}`);
  err.api = { error: r.data?.error || r.data || null, log: r.log };
  throw err;
}

/**
 * GET /customers/{cid}
 * Estrategia:
 *   1) Sin login-customer-id (contexto del access_token)
 *   2) Retry con login-customer-id = cid
 *   3) Retry con LOGIN_CID (MCC) si existe
 */
async function getCustomer(accessToken, customerId) {
  const cid = normId(customerId);

  // 1) sin login-customer-id
  let r = await requestV22({
    accessToken,
    path: `/customers/${cid}`,
    method: 'GET',
  });

  // 2) retry con login-customer-id = cid
  if (!r.ok && shouldRetryWithLoginCid(r.data)) {
    r = await requestV22({
      accessToken,
      path: `/customers/${cid}`,
      method: 'GET',
      loginCustomerId: cid,
    });
  }

  // 3) retry con nuestro MCC
  if (!r.ok && LOGIN_CID) {
    r = await requestV22({
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

/** Descubre todas las cuentas y las enriquece con getCustomer. */
async function discoverAndEnrich(accessToken) {
  const list = await listAccessibleCustomers(accessToken); // ["customers/123", ...]
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

/**
 * POST /customers/{cid}/googleAds:searchStream
 * Estrategia:
 *   1) Intento SIN login-customer-id
 *   2) Retry con login-customer-id = cid
 *   3) Retry con LOGIN_CID (MCC)
 * Devuelve un arreglo "flat" de filas y preserva requestId en errores.
 */
async function searchGAQLStream(accessToken, customerId, query) {
  const cid = normId(customerId);

  // body DEBE ser JSON con { query }
  const body = { query };

  // 1) sin login-customer-id
  let r = await requestV22({
    accessToken,
    path: `/customers/${cid}/googleAds:searchStream`,
    method: 'POST',
    body,
  });

  // 2) retry con login-customer-id = cid
  if (!r.ok && shouldRetryWithLoginCid(r.data)) {
    r = await requestV22({
      accessToken,
      path: `/customers/${cid}/googleAds:searchStream`,
      method: 'POST',
      body,
      loginCustomerId: cid,
    });
  }

  // 3) retry con nuestro MCC si sigue fallando
  if (!r.ok && LOGIN_CID) {
    r = await requestV22({
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

  // Caso típico cuando Google devuelve el HTML del 400 (robot.html)
  if (typeof r.data === 'string') {
    const err = new Error('[searchGAQLStream] Unexpected string response (possible 400 HTML)');
    err.api = { raw: r.data.slice(0, 300) + '…', log: r.log };
    throw err;
  }

  const err = new Error(`[searchGAQLStream] ${r.data?.error?.status || r.res?.status || 'UNKNOWN'}: ${r.data?.error?.message || 'failed'}`);
  err.api = { status: r.res?.status, error: r.data?.error || r.data || null, log: r.log };
  throw err;
}

/* ========================================================================== *
 * 3) Helpers de fechas/formatos
 * ========================================================================== */
function fmt(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(d, n) {
  const dt = new Date(d.getTime());
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt;
}

function presetRange(preset) {
  const t = todayUTC();
  switch ((preset || '').toLowerCase()) {
    case 'today': {
      const d = fmt(t); return [d, d];
    }
    case 'yesterday': {
      const y = addDays(t, -1); const d = fmt(y); return [d, d];
    }
    case 'last_7d': {
      const since = addDays(t, -6); return [fmt(since), fmt(t)];
    }
    case 'last_14d': {
      const since = addDays(t, -13); return [fmt(since), fmt(t)];
    }
    case 'last_28d': {
      const since = addDays(t, -27); return [fmt(since), fmt(t)];
    }
    case 'this_month': {
      const start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      return [fmt(start), fmt(t)];
    }
    case 'last_30d':
    default: {
      const since = addDays(t, -29); return [fmt(since), fmt(t)];
    }
  }
}

function rangeFromCount(days) {
  const d = Number(days || 30);
  const t = todayUTC();
  const since = addDays(t, -(d - 1));
  return [fmt(since), fmt(t)];
}

function microsToUnit(v) {
  const n = Number(v || 0);
  return Math.round((n / 1_000_000) * 100) / 100; // 2 decimales
}

/* ========================================================================== *
 * 4) Insights (KPIs + Serie)
 * ========================================================================== */
async function fetchInsights({
  accessToken,
  customerId,
  datePreset,
  range,        // "30" | "60" | "90" si no hay datePreset
  includeToday, // placeholder compat
  objective,    // ventas | alcance | leads
  compareMode,  // placeholder
}) {
  if (!customerId) throw new Error('customerId required');

  const cid = normId(customerId);
  let [since, until] = datePreset ? presetRange(datePreset) : rangeFromCount(range || 30);

  const GAQL_SERIE = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc_micros,
      metrics.conversions,
      metrics.conversion_value,
      customer.currency_code,
      customer.time_zone
    FROM customer
    WHERE segments.date BETWEEN '${since}' AND '${until}'
    ORDER BY segments.date
  `;

  const rows = await searchGAQLStream(accessToken, cid, GAQL_SERIE);

  const series = rows.map(r => {
    const seg = r.segments || {};
    const met = r.metrics  || {};
    const cust = r.customer || {};
    const costMicros = met.costMicros ?? met.cost_micros;
    const avgCpcMicros = met.averageCpcMicros ?? met.average_cpc_micros;
    return {
      date: seg.date,
      impressions: Number(met.impressions || 0),
      clicks: Number(met.clicks || 0),
      cost: microsToUnit(costMicros),
      ctr: Number(met.ctr || 0), // 0..1
      cpc: microsToUnit(avgCpcMicros),
      conversions: Number(met.conversions || 0),
      conv_value: Number(met.conversionValue ?? met.conversion_value ?? 0),
      currency_code: cust.currencyCode ?? cust.currency_code,
      time_zone: cust.timeZone ?? cust.time_zone,
    };
  });

  // KPIs sumados
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

  // Moneda/TimeZone (si no vino en filas, fallback con getCustomer)
  let currency = series.find(s => s.currency_code)?.currency_code || 'MXN';
  let tz = series.find(s => s.time_zone)?.time_zone || 'America/Mexico_City';
  if (!currency || !tz) {
    try {
      const cust = await getCustomer(accessToken, cid);
      currency = cust.currencyCode || currency;
      tz = cust.timeZone || tz;
    } catch (_) { /* ignore */ }
  }

  return {
    ok: true,
    objective: (['ventas','alcance','leads'].includes(String(objective)) ? objective : 'ventas'),
    customer_id: cid,
    range: { since, until },
    prev_range: { since, until }, // placeholder
    is_partial: false,
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
  listAccessibleCustomersRaw: listAccessibleCustomers, // alias
  getCustomer,
  searchGAQLStream,
  discoverAndEnrich,
  fetchInsights,
};
