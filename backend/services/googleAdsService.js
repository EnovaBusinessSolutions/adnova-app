// backend/services/googleAdsService.js
'use strict';

const axios = require('axios');

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || process.env.GOOGLE_DEVELOPER_TOKEN || '';
const LOGIN_CID = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || process.env.GOOGLE_LOGIN_CUSTOMER_ID || '').replace(/[^\d]/g, '');
const ADS_VER   = (process.env.GADS_API_VERSION || 'v17').replace(/^\/+/, '');
const ADS_HOST  = 'https://googleads.googleapis.com';

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
 * ===============================
 *  DISCOVERY
 * ===============================
 * IMPORTANTE: listAccessibleCustomers NO debe llevar login-customer-id.
 * Devuelve SIEMPRE una lista de IDs: ["123", "456"]
 */
async function listAccessibleCustomersRaw(accessToken) {
  const url = `${ADS_HOST}/${ADS_VER}/customers:listAccessibleCustomers`;
  const headers = baseHeaders(accessToken); // sin login-customer-id para discovery

  const { data, status } = await axios.get(url, { headers, timeout: 25000, validateStatus: () => true });
  if (Array.isArray(data?.resourceNames)) {
    return data.resourceNames
      .map((rn) => String(rn).split('/')[1])
      .filter(Boolean);
  }
  if (data?.error) {
    const code = data.error?.status || 'UNKNOWN';
    const msg  = data.error?.message || 'listAccessibleCustomers failed';
    const err  = new Error(`[listAccessibleCustomersRaw] ${code}: ${msg}`);
    err.api = { status, error: data.error };
    throw err;
  }
  return [];
}

/**
 * GET /customers/{cid}
 * Aquí SÍ podemos mandar login-customer-id (contexto MCC).
 */
async function getCustomer(accessToken, customerId) {
  const id = String(customerId).replace(/[^\d]/g, '');
  const url = `${ADS_HOST}/${ADS_VER}/customers/${id}`;
  const headers = baseHeaders(accessToken);
  if (LOGIN_CID) headers['login-customer-id'] = LOGIN_CID;

  const { data, status } = await axios.get(url, { headers, timeout: 20000, validateStatus: () => true });
  if (data?.error) {
    const code = data.error?.status || 'UNKNOWN';
    const msg  = data.error?.message || 'getCustomer failed';
    const err  = new Error(`[getCustomer] ${code}: ${msg}`);
    err.api = { status, error: data.error };
    throw err;
  }
  return {
    id,
    name: data?.descriptiveName || `Cuenta ${id}`,
    currencyCode: data?.currencyCode || null,
    timeZone: data?.timeZone || null,
    status: data?.status || null,
  };
}

/**
 * Descubre todas las cuentas accesibles y devuelve metadatos enriquecidos.
 * -> [{ id, name, currencyCode, timeZone, status }]
 */
async function discoverAndEnrich(accessToken) {
  const ids = await listAccessibleCustomersRaw(accessToken);
  const out = [];
  for (const id of ids) {
    try {
      out.push(await getCustomer(accessToken, id));
    } catch (e) {
      // si no podemos leer meta de una cuenta, igual la devolvemos minimal
      out.push({ id, name: `Cuenta ${id}` });
    }
  }
  return out;
}

/**
 * ===============================
 *  GAQL / INSIGHTS
 * ===============================
 * POST /customers/{cid}/googleAds:searchStream
 * Ejecuta GAQL en stream. Devuelve un arreglo "flat" de filas.
 */
async function searchGAQLStream(accessToken, customerId, query) {
  const id = String(customerId).replace(/[^\d]/g, '');
  const url = `${ADS_HOST}/${ADS_VER}/customers/${id}/googleAds:searchStream`;
  const headers = baseHeaders(accessToken);
  if (LOGIN_CID) headers['login-customer-id'] = LOGIN_CID;

  const { data, status } = await axios.post(url, { query }, { headers, timeout: 60000, validateStatus: () => true });

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
    err.api = { status, error: data.error };
    throw err;
  }

  // A veces (BASIC / 404) regresa HTML
  if (typeof data === 'string') {
    const err = new Error(`[searchGAQLStream] Unexpected string response (possible 404 HTML)`);
    err.api = { raw: data, status };
    throw err;
  }

  return [];
}

/* =========================
 * Helpers de fechas/moneda
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

/* =========================
 * Insights
 * ========================= */
async function fetchInsights({
  accessToken,
  customerId,
  datePreset,   // "last_30d" | "today" | ...
  range,        // "30" | "60" | "90" (si no hay datePreset)
  includeToday, // compatibilidad, ya contemplado por preset
  objective,    // ventas | alcance | leads (presentación)
  compareMode,  // prev_period (futuro)
}) {
  if (!customerId) throw new Error('customerId required');

  let [since, until] = datePreset ? presetRange(datePreset) : rangeFromCount(range || 30);

  // Serie diaria (Customer level)
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
      ctr: Number(met.ctr || 0),                      // 0..1
      cpc: microsToUnit(met.average_cpc),             // convertir de micros a moneda
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
  // nota: dejamos cpc “promedio ponderado” como cost/clicks para evitar sesgos de micro-avg
  kpis.cpc = kpis.clicks > 0 ? (kpis.cost / kpis.clicks) : 0;
  kpis.cpa  = kpis.conversions > 0 ? (kpis.cost / kpis.conversions) : undefined;
  kpis.roas = kpis.cost > 0 ? (kpis.conv_value / kpis.cost) : undefined;

  const deltas = {}; // (comparación se calcula en la ruta si se requiere)

  return {
    ok: true,
    objective: (['ventas', 'alcance', 'leads'].includes(String(objective)) ? objective : 'ventas'),
    customer_id: String(customerId).replace(/[^\d]/g, ''),
    range: { since, until },
    prev_range: { since, until }, // placeholder
    is_partial: false,
    kpis,
    deltas,
    series,
    currency: 'MXN', // si quieres, puedes obtenerlo con getCustomer() y setearlo aquí
    locale: 'es-MX',
  };
}

module.exports = {
  // discovery
  listAccessibleCustomersRaw,
  getCustomer,
  discoverAndEnrich,
  // GAQL/insights
  searchGAQLStream,
  fetchInsights,
};
