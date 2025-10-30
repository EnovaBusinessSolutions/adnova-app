// backend/services/googleAdsService.js
'use strict';

const axios = require('axios');

/* =========================
 * ENV / Constantes
 * ========================= */
const DEV_TOKEN =
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN ||
  process.env.GOOGLE_DEVELOPER_TOKEN ||
  '';

const LOGIN_CID = (
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
  process.env.GOOGLE_LOGIN_CUSTOMER_ID ||
  ''
).replace(/[^\d]/g, '');

const ADS_VER  = process.env.GADS_API_VERSION || 'v17';
const ADS_HOST = 'https://googleads.googleapis.com';

const normId = (s = '') => String(s).replace(/[^\d]/g, '');

/* =========================
 * Headers base
 * ========================= */
function baseHeaders(accessToken) {
  if (!DEV_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN missing');
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/* Pequeño detector de errores que ameritan reintento con login-customer-id */
function shouldRetryWithLoginCid(errData) {
  const status = errData?.error?.status || '';
  const msg = (errData?.error?.message || '').toLowerCase();
  // Casos comunes: PERMISSION_DENIED por falta de contexto, CUSTOMER_NOT_ENABLED, etc.
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

/* ========================================================================== *
 * 1) Descubrimiento de cuentas
 * ========================================================================== */

/**
 * IMPORTANTE: listAccessibleCustomers NO debe llevar login-customer-id.
 * Devuelve ["customers/123", "customers/456", ...]
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

  if (Array.isArray(data?.resourceNames)) return data.resourceNames;

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
 * Estrategia:
 *   1) Intento SIN login-customer-id (contexto natural del access_token)
 *   2) Si la API pide contexto o marca permiso, reintento CON LOGIN_CID (si existe)
 */
async function getCustomer(accessToken, customerId) {
  const cid = normId(customerId);
  const url = `${ADS_HOST}/${ADS_VER}/customers/${cid}`;

  // 1) sin login-customer-id
  try {
    const { data } = await axios.get(url, {
      headers: baseHeaders(accessToken),
      timeout: 20000,
      validateStatus: s => s >= 200 && s < 300,
    });
    return {
      id: cid,
      name: data?.descriptiveName || `Cuenta ${cid}`,
      currencyCode: data?.currencyCode || null,
      timeZone: data?.timeZone || null,
      status: data?.status || null,
    };
  } catch (e1) {
    const data = e1?.response?.data;
    // 2) reintento con login-customer-id (si hay y aplica)
    if (LOGIN_CID && shouldRetryWithLoginCid(data)) {
      const h = baseHeaders(accessToken);
      h['login-customer-id'] = LOGIN_CID;
      const { data: d2 } = await axios.get(url, {
        headers: h,
        timeout: 20000,
      });
      return {
        id: cid,
        name: d2?.descriptiveName || `Cuenta ${cid}`,
        currencyCode: d2?.currencyCode || null,
        timeZone: d2?.timeZone || null,
        status: d2?.status || null,
      };
    }
    // Si no aplica reintento o también falla, propagamos un error claro
    const code = data?.error?.status || e1?.response?.status || 'UNKNOWN';
    const msg  = data?.error?.message || e1?.message || 'getCustomer failed';
    const err  = new Error(`[getCustomer] ${code}: ${msg}`);
    err.api = { error: data?.error || data || null };
    throw err;
  }
}

/**
 * Descubre todas las cuentas accesibles y las enriquece con getCustomer.
 * Devuelve [{ id, name, currencyCode, timeZone, status }]
 */
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
      // continúa sin tumbar el flujo
      console.warn('[discoverAndEnrich] getCustomer fail', id, e?.response?.data || e?.api || e.message);
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
 *   2) Si la API pide contexto/permiso, reintento CON LOGIN_CID (si existe)
 * Devuelve un arreglo "flat" de filas.
 */
async function searchGAQLStream(accessToken, customerId, query) {
  const cid = normId(customerId);
  const url = `${ADS_HOST}/${ADS_VER}/customers/${cid}/googleAds:searchStream`;

  // helper para invocar
  const call = async (headers) => {
    const { data, status } = await axios.post(
      url,
      { query },
      { headers, timeout: 60000, validateStatus: () => true }
    );
    return { data, status };
  };

  // 1) sin login-customer-id
  const h1 = baseHeaders(accessToken);
  let { data, status } = await call(h1);

  // si es error que amerita retry con login-customer-id
  if ((typeof data === 'object' && data?.error && shouldRetryWithLoginCid(data)) && LOGIN_CID) {
    const h2 = baseHeaders(accessToken);
    h2['login-customer-id'] = LOGIN_CID;
    ({ data, status } = await call(h2));
  }

  if (Array.isArray(data)) {
    const rows = [];
    for (const chunk of data) {
      for (const r of (chunk.results || [])) rows.push(r);
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

  // Cuando hay BASIC token o sin permisos a veces devuelve HTML (404)
  if (typeof data === 'string') {
    const err = new Error('[searchGAQLStream] Unexpected string response (possible 404 HTML)');
    err.api = { raw: data.slice(0, 200) + '…' };
    throw err;
  }

  return [];
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
  datePreset,   // "last_30d" | "today" | ...
  range,        // "30" | "60" | "90" (si no hay datePreset)
  includeToday, // "1" | "0" (placeholder compatibilidad)
  objective,    // ventas | alcance | leads (no cambia GAQL)
  compareMode,  // prev_period (placeholder)
}) {
  if (!customerId) throw new Error('customerId required');

  const cid = normId(customerId);
  let [since, until] = datePreset ? presetRange(datePreset) : rangeFromCount(range || 30);

  // v17: average_cpc está en moneda; cost en micros.
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

  const rows = await searchGAQLStream(accessToken, cid, GAQL_SERIE);

  const series = rows.map(r => {
    const seg = r.segments || {};
    const met = r.metrics  || {};
    let ctr = Number(met.ctr || 0); // a veces viene como %, normalizamos
    if (ctr > 1) ctr = ctr / 100;

    return {
      date: seg.date,
      impressions: Number(met.impressions || 0),
      clicks: Number(met.clicks || 0),
      cost: microsToUnit(met.cost_micros),
      ctr,
      cpc: Number(met.average_cpc || 0),
      conversions: Number(met.conversions || 0),
      conv_value: Number(met.conversion_value || 0),
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

  // Enriquecer con moneda/timezone
  let currency = 'MXN';
  let tz = 'America/Mexico_City';
  try {
    const cust = await getCustomer(accessToken, cid);
    currency = cust.currencyCode || currency;
    tz = cust.timeZone || tz;
  } catch (_) { /* ignore */ }

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
