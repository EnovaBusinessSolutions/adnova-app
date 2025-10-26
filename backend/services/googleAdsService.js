// backend/services/googleAdsService.js
'use strict';

const axios = require('axios');

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  || process.env.GOOGLE_DEVELOPER_TOKEN
  || '';

const LOGIN_CID = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  || process.env.GOOGLE_LOGIN_CUSTOMER_ID
  || '').replace(/[^\d]/g, '');

const ADS_VER  = process.env.GADS_API_VERSION || 'v17';
const ADS_HOST = 'https://googleads.googleapis.com';

function baseHeaders(accessToken) {
  if (!DEV_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN missing');
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * IMPORTANTE: listAccessibleCustomers NO debe llevar login-customer-id.
 */
async function listAccessibleCustomers(accessToken) {
  const url = `${ADS_HOST}/${ADS_VER}/customers:listAccessibleCustomers`;
  const headers = baseHeaders(accessToken);
  delete headers['login-customer-id'];

  const { data, status } = await axios.get(url, {
    headers,
    timeout: 25000,
    validateStatus: () => true,
  });

  if (Array.isArray(data?.resourceNames)) return data.resourceNames; // ["customers/123", ...]
  if (data?.error) {
    const code = data.error?.status || 'UNKNOWN';
    const msg  = data.error?.message || 'listAccessibleCustomers failed';
    const err  = new Error(`[listAccessibleCustomers] ${code}: ${msg}`);
    err.api = { status, error: data.error };
    throw err;
  }
  return [];
}

/**
 * GET /customers/{cid}
 * Aquí sí podemos mandar login-customer-id (contexto MCC).
 */
async function getCustomer(accessToken, customerId) {
  const url = `${ADS_HOST}/${ADS_VER}/customers/${customerId}`;
  const headers = baseHeaders(accessToken);
  if (LOGIN_CID) headers['login-customer-id'] = LOGIN_CID;

  const { data } = await axios.get(url, { headers, timeout: 20000 });
  return {
    id: customerId,
    name: data?.descriptiveName || `Cuenta ${customerId}`,
    currencyCode: data?.currencyCode || null,
    timeZone: data?.timeZone || null,
    status: data?.status || null,
  };
}

/**
 * POST /customers/{cid}/googleAds:searchStream
 * Ejecuta GAQL en stream. Devuelve un arreglo "flat" de filas.
 */
async function searchGAQLStream(accessToken, customerId, query) {
  const url = `${ADS_HOST}/${ADS_VER}/customers/${customerId}/googleAds:searchStream`;
  const headers = baseHeaders(accessToken);
  if (LOGIN_CID) headers['login-customer-id'] = LOGIN_CID;

  const { data } = await axios.post(
    url,
    { query },
    { headers, timeout: 60000, validateStatus: () => true }
  );

  if (Array.isArray(data)) {
    const rows = [];
    for (const chunk of data) {
      for (const r of chunk.results || []) rows.push(r);
    }
    return rows;
  }

  if (data?.error) {
    const code = data.error?.status || 'UNKNOWN';
    const msg  = data.error?.message || 'searchStream failed';
    const err  = new Error(`[searchGAQLStream] ${code}: ${msg}`);
    err.api = { error: data.error };
    throw err;
  }

  // Cuando hay BASIC token o sin permisos a veces devuelve HTML (404)
  if (typeof data === 'string') {
    const err = new Error('[searchGAQLStream] Unexpected string response (possible 404 HTML)');
    err.api = { raw: data };
    throw err;
  }

  return [];
}

/* =========================
 * Helpers de fechas
 * ========================= */
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
  // Devuelve [since, until] inclusive en UTC (yyyy-mm-dd).
  const t = todayUTC();
  switch ((preset || '').toLowerCase()) {
    case 'today': {
      const d = fmt(t);
      return [d, d];
    }
    case 'yesterday': {
      const y = addDays(t, -1);
      const d = fmt(y);
      return [d, d];
    }
    case 'last_7d': {
      const since = addDays(t, -6);
      return [fmt(since), fmt(t)];
    }
    case 'last_14d': {
      const since = addDays(t, -13);
      return [fmt(since), fmt(t)];
    }
    case 'last_28d': {
      const since = addDays(t, -27);
      return [fmt(since), fmt(t)];
    }
    case 'this_month': {
      const start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      return [fmt(start), fmt(t)];
    }
    case 'last_30d':
    default: {
      const since = addDays(t, -29);
      return [fmt(since), fmt(t)];
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

/* =========================
 * Insights
 * ========================= */
async function fetchInsights({
  accessToken,
  customerId,
  datePreset,   // "last_30d" | "today" | ...
  range,        // "30" | "60" | "90" (si no hay datePreset)
  includeToday, // "1" | "0" (ya lo cubre preset; se deja por compatibilidad)
  objective,    // ventas | alcance | leads (no afecta GAQL, solo KPIs presentados)
  compareMode,  // prev_period (placeholder)
}) {
  if (!customerId) throw new Error('customerId required');

  let [since, until] = datePreset ? presetRange(datePreset) : rangeFromCount(range || 30);

  // Serie diaria
  const GAQL_SERIE = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversion_value
    FROM customer
    WHERE segments.date BETWEEN '${since}' AND '${until}'
    ORDER BY segments.date
  `;

  const rows = await searchGAQLStream(accessToken, customerId, GAQL_SERIE);

  const series = rows.map(r => {
    const seg = r.segments || {};
    const met = r.metrics  || {};
    return {
      date: seg.date,
      impressions: Number(met.impressions || 0),
      clicks: Number(met.clicks || 0),
      cost: microsToUnit(met.cost_micros),
      ctr: Number(met.ctr || 0),                 // 0..1
      cpc: Number(met.average_cpc || 0),         // en moneda
      conversions: Number(met.conversions || 0),
      conv_value: Number(met.conversion_value || 0),
    };
  });

  // KPIs sumados
  const kpis = series.reduce((acc, p) => {
    acc.impressions += p.impressions || 0;
    acc.clicks      += p.clicks || 0;
    acc.cost        += p.cost || 0;
    acc.conversions += p.conversions || 0;
    acc.conv_value  += p.conv_value || 0;
    return acc;
  }, { impressions: 0, clicks: 0, cost: 0, conversions: 0, conv_value: 0 });

  kpis.ctr = kpis.impressions > 0 ? kpis.clicks / kpis.impressions : 0;
  kpis.cpc = kpis.clicks > 0 ? (kpis.cost / kpis.clicks) : 0;
  // cpa / roas (cuando aplique)
  kpis.cpa  = kpis.conversions > 0 ? (kpis.cost / kpis.conversions) : undefined;
  kpis.roas = kpis.cost > 0 ? (kpis.conv_value / kpis.cost) : undefined;

  // Deltas placeholder
  const deltas = {};

  return {
    ok: true,
    objective: (['ventas', 'alcance', 'leads'].includes(String(objective)) ? objective : 'ventas'),
    customer_id: customerId,
    range: { since, until },
    prev_range: { since, until }, // placeholder
    is_partial: false,
    kpis,
    deltas,
    series,
    currency: 'MXN', // opcional
    locale: 'es-MX',
  };
}

module.exports = {
  listAccessibleCustomers,
  listAccessibleCustomersRaw: listAccessibleCustomers, // alias por compatibilidad
  getCustomer,
  searchGAQLStream,
  fetchInsights,
};
