#!/usr/bin/env node
'use strict';

/**
 * Smoke tests para MCP en staging (o cualquier BASE con las mismas rutas).
 *
 * Requiere:
 *   MCP_STAGING_BASE_URL  — URL del backend sin barra final (ej. https://adray-app-staging-german.onrender.com)
 *   MCP_ACCESS_TOKEN      — Bearer obtenido vía /oauth (authorize + token)
 *
 * Opcional:
 *   MCP_META_CAMPAIGN_ID  — ID de campaña Meta para get_adset_performance (si falta, ese paso se omite)
 *   MCP_SKIP_MCP_POST     — si es "1", no prueba POST /mcp (solo REST)
 *
 * Incluye ad-performance, campaign-performance y date-comparison con channel=meta y channel=google.
 *
 * Uso: npm run mcp:smoke:staging
 */

function normalizeBase(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  return s;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function dateRangeLastDays(days) {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  return { date_from: ymd(from), date_to: ymd(to) };
}

async function req(base, token, path, init = {}) {
  const url = `${base}${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...init.headers,
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json, url };
}

function labelResult(status, json) {
  if (status >= 200 && status < 300) return 'PASS';
  const code = json?.error_code || json?.error?.error_code;
  if (status === 404 && code === 'ACCOUNT_NOT_CONNECTED') return 'SKIP';
  if (status === 401) return 'FAIL';
  return 'FAIL';
}

async function tryMcpInitialize(base, token) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-staging-smoke', version: '1.0.0' },
    },
  };
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  const ok = res.status >= 200 && res.status < 300;
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  return {
    status: res.status,
    contentType: ct,
    snippet: text.slice(0, 500),
    ok,
  };
}

async function main() {
  const base = normalizeBase(process.env.MCP_STAGING_BASE_URL);
  const token = (process.env.MCP_ACCESS_TOKEN || '').trim();
  const campaignId = (process.env.MCP_META_CAMPAIGN_ID || '').trim();

  if (!base || !token) {
    console.error('Faltan MCP_STAGING_BASE_URL o MCP_ACCESS_TOKEN.');
    console.error('Ejemplo (PowerShell):');
    console.error('  $env:MCP_STAGING_BASE_URL="https://tu-staging.onrender.com"');
    console.error('  $env:MCP_ACCESS_TOKEN="..."');
    console.error('  npm run mcp:smoke:staging');
    process.exit(1);
  }

  const { date_from, date_to } = dateRangeLastDays(31);
  const q = new URLSearchParams({ date_from, date_to });

  console.log('MCP staging smoke');
  console.log('BASE:', base);
  console.log('Rango fechas:', date_from, '→', date_to);
  console.log('');

  const rows = [];
  const push = (name, result, note = '') => {
    rows.push({ name, ...result, note });
  };

  let r = await req(base, token, `/gpt/v1/account-info`);
  push('account-info', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  r = await req(base, token, `/gpt/v1/channel-summary?${q}`);
  push('channel-summary', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  r = await req(
    base,
    token,
    `/gpt/v1/ad-performance?channel=meta&date_from=${date_from}&date_to=${date_to}&granularity=total`
  );
  push('ad-performance (meta)', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  r = await req(
    base,
    token,
    `/gpt/v1/ad-performance?channel=google&date_from=${date_from}&date_to=${date_to}&granularity=total`
  );
  push('ad-performance (google)', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  r = await req(
    base,
    token,
    `/gpt/v1/campaign-performance?channel=meta&date_from=${date_from}&date_to=${date_to}&limit=5&status=all`
  );
  push('campaign-performance (meta)', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  r = await req(
    base,
    token,
    `/gpt/v1/campaign-performance?channel=google&date_from=${date_from}&date_to=${date_to}&limit=5&status=all`
  );
  push('campaign-performance (google)', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  if (campaignId) {
    r = await req(
      base,
      token,
      `/gpt/v1/adset-performance?channel=meta&campaign_id=${encodeURIComponent(campaignId)}&date_from=${date_from}&date_to=${date_to}`
    );
    push('adset-performance (meta)', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });
  } else {
    push(
      'adset-performance (meta)',
      { status: '-', verdict: 'SKIP', url: '(no MCP_META_CAMPAIGN_ID)' },
      'Define MCP_META_CAMPAIGN_ID para probar'
    );
  }

  r = await req(
    base,
    token,
    `/gpt/v1/shopify-revenue?date_from=${date_from}&date_to=${date_to}&granularity=total`
  );
  push('shopify-revenue', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  r = await req(
    base,
    token,
    `/gpt/v1/shopify-products?date_from=${date_from}&date_to=${date_to}&sort_by=revenue&limit=5`
  );
  push('shopify-products', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  const half = Math.floor((new Date(date_to) - new Date(date_from)) / (2 * 86400000));
  const mid = new Date(date_from);
  mid.setUTCDate(mid.getUTCDate() + Math.max(1, half));
  const midStr = ymd(mid);
  r = await req(
    base,
    token,
    `/gpt/v1/date-comparison?channel=meta&period_a_from=${date_from}&period_a_to=${midStr}&period_b_from=${midStr}&period_b_to=${date_to}`
  );
  push('date-comparison (meta)', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  r = await req(
    base,
    token,
    `/gpt/v1/date-comparison?channel=google&period_a_from=${date_from}&period_a_to=${midStr}&period_b_from=${midStr}&period_b_to=${date_to}`
  );
  push('date-comparison (google)', { status: r.status, verdict: labelResult(r.status, r.json), url: r.url });

  for (const row of rows) {
    console.log(
      `[${row.verdict}] ${row.name} status=${row.status}${row.note ? ` — ${row.note}` : ''}`
    );
    if (row.verdict === 'FAIL' && row.url && typeof row.url === 'string' && row.url.startsWith('http')) {
      console.log('  ', row.url);
    }
  }

  console.log('');

  let mcpInitResult = null;
  if (process.env.MCP_SKIP_MCP_POST === '1') {
    console.log('[SKIP] POST /mcp (MCP_SKIP_MCP_POST=1)');
  } else {
    mcpInitResult = await tryMcpInitialize(base, token);
    if (mcpInitResult.ok) {
      console.log(
        `[PASS] POST /mcp initialize status=${mcpInitResult.status} content-type=${mcpInitResult.contentType}`
      );
    } else {
      console.log(
        `[FAIL] POST /mcp initialize status=${mcpInitResult.status} content-type=${mcpInitResult.contentType}`
      );
      console.log('  body (recorte):', mcpInitResult.snippet.replace(/\s+/g, ' ').slice(0, 400));
    }
  }

  console.log('');
  console.log('Snapshot-first (solo verificación de entorno):');
  const snap = process.env.MCP_SNAPSHOT_FIRST_ENABLED;
  if (snap === 'true' || snap === '1') {
    console.log('  MCP_SNAPSHOT_FIRST_ENABLED está activo: revisar mcpdata, logs mcp_tool_source y REDIS si usas background refresh.');
  } else {
    console.log('  MCP_SNAPSHOT_FIRST_ENABLED no activo (por defecto). Sin acción.');
  }

  const failed = rows.filter((x) => x.verdict === 'FAIL').length;
  const mcpFail =
    process.env.MCP_SKIP_MCP_POST === '1' ? 0 : mcpInitResult && mcpInitResult.ok ? 0 : 1;

  if (failed > 0 || mcpFail) {
    console.log('');
    console.error('Smoke terminó con fallos (FAIL). Revisa token, integraciones y URLs.');
    process.exit(1);
  }
  console.log('');
  console.log('Smoke completado (PASS / SKIP aceptables).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
