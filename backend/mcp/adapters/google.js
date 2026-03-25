'use strict';

const { OAuth2Client } = require('google-auth-library');

let GoogleAccount, googleAdsService;
try { GoogleAccount = require('../../models/GoogleAccount'); } catch { GoogleAccount = null; }
try { googleAdsService = require('../../services/googleAdsService'); } catch { googleAdsService = null; }

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || process.env.GOOGLE_DEVELOPER_TOKEN || '';
const LOGIN_CID = (process.env.GOOGLE_LOGIN_CUSTOMER_ID || '').replace(/[^\d]/g, '');
const ADS_VER = (process.env.GADS_API_VERSION || 'v18').trim();
const ADS_HOST = 'https://googleads.googleapis.com';

const OAUTH_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const OAUTH_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';

function toNum(v) { return Number(v || 0) || 0; }
function safeDiv(n, d) { return d ? n / d : 0; }
function round(n, d = 2) { return Number(Number(n || 0).toFixed(d)); }
function normId(s) { return String(s || '').replace(/[^\d]/g, ''); }

async function resolveGoogleCredentials(userId) {
  if (!GoogleAccount) return null;
  const doc = await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
    .select('+accessToken +refreshToken customers ad_accounts defaultCustomerId selectedCustomerIds managerCustomerId loginCustomerId')
    .lean();
  if (!doc) return null;

  const customers = [
    ...(Array.isArray(doc.customers) ? doc.customers : []),
    ...(Array.isArray(doc.ad_accounts) ? doc.ad_accounts : []),
  ];
  const customerId = normId(doc.selectedCustomerIds?.[0] || doc.defaultCustomerId || customers[0]?.id);
  if (!customerId) return null;

  const found = customers.find(x => normId(x?.id) === customerId) || {};

  return {
    refreshToken: doc.refreshToken,
    accessToken: doc.accessToken,
    customerId,
    loginCustomerId: normId(doc.loginCustomerId || doc.managerCustomerId || LOGIN_CID),
    currency: found.currencyCode || 'USD',
    name: found.descriptiveName || found.name || null,
  };
}

async function getAccessToken(refreshToken) {
  if (googleAdsService?.resolveAccessToken) {
    return googleAdsService.resolveAccessToken({ refreshToken });
  }
  const client = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  return token;
}

async function queryGaql(accessToken, customerId, loginCustomerId, gaql) {
  const axios = require('axios');
  const url = `${ADS_HOST}/${ADS_VER}/customers/${customerId}/googleAds:searchStream`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const { data } = await axios.post(url, { query: gaql }, { headers, timeout: 30000 });
  const rows = [];
  if (Array.isArray(data)) {
    for (const batch of data) {
      if (Array.isArray(batch.results)) rows.push(...batch.results);
    }
  }
  return rows;
}

async function getAdPerformance(userId, dateFrom, dateTo, granularity) {
  const creds = await resolveGoogleCredentials(userId);
  if (!creds?.refreshToken) throw Object.assign(new Error('ACCOUNT_NOT_CONNECTED'), { code: 'ACCOUNT_NOT_CONNECTED' });

  const accessToken = await getAccessToken(creds.refreshToken);
  const segmentClause = granularity && granularity !== 'total'
    ? ', segments.date' : '';

  const gaql = `
    SELECT
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.average_cpc, metrics.average_cpm,
      metrics.conversions, metrics.conversions_value
      ${segmentClause}
    FROM customer
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  `;

  const rows = await queryGaql(accessToken, creds.customerId, creds.loginCustomerId, gaql);

  if (!rows.length) {
    return {
      channel: 'google', spend: 0, impressions: 0, clicks: 0,
      ctr: 0, cpc: 0, cpm: 0, currency: creds.currency,
      date_from: dateFrom, date_to: dateTo, rows: [],
    };
  }

  const mapped = rows.map(r => {
    const m = r.metrics || {};
    const spend = toNum(m.costMicros) / 1_000_000;
    const impressions = toNum(m.impressions);
    const clicks = toNum(m.clicks);
    return {
      date: r.segments?.date || null,
      spend: round(spend),
      impressions,
      clicks,
      ctr: round(safeDiv(clicks, impressions) * 100),
      cpc: round(safeDiv(spend, clicks)),
      cpm: round(safeDiv(spend, impressions) * 1000),
    };
  });

  const agg = mapped.reduce((a, r) => {
    a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks;
    return a;
  }, { spend: 0, impressions: 0, clicks: 0 });

  return {
    channel: 'google',
    spend: round(agg.spend),
    impressions: agg.impressions,
    clicks: agg.clicks,
    ctr: round(safeDiv(agg.clicks, agg.impressions) * 100),
    cpc: round(safeDiv(agg.spend, agg.clicks)),
    cpm: round(safeDiv(agg.spend, agg.impressions) * 1000),
    currency: creds.currency,
    date_from: dateFrom,
    date_to: dateTo,
    rows: granularity && granularity !== 'total' ? mapped : [],
  };
}

/** GAQL WHERE for listing campaigns by delivery status (no segments.date — evita omitir activas sin tráfico en el rango). */
function campaignIdentityStatusWhere(status) {
  if (status === 'active') return "campaign.status = 'ENABLED'";
  if (status === 'paused') return "campaign.status = 'PAUSED'";
  return "campaign.status != 'REMOVED'";
}

const CAMPAIGN_IDENTITY_PAGE = 500;

function aggregateGoogleCampaignMetricRows(rows) {
  const byId = new Map();
  for (const r of rows) {
    const c = r.campaign || {};
    const id = String(c.id || '').trim();
    if (!id) continue;
    const m = r.metrics || {};
    const spend = toNum(m.costMicros) / 1_000_000;
    const cur = byId.get(id) || {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      convValue: 0,
    };
    cur.spend += spend;
    cur.impressions += toNum(m.impressions);
    cur.clicks += toNum(m.clicks);
    cur.conversions += toNum(m.conversions);
    cur.convValue += toNum(m.conversionsValue);
    byId.set(id, cur);
  }
  return byId;
}

async function getCampaignPerformance(userId, dateFrom, dateTo, limit = 10, status = 'all') {
  const creds = await resolveGoogleCredentials(userId);
  if (!creds?.refreshToken) throw Object.assign(new Error('ACCOUNT_NOT_CONNECTED'), { code: 'ACCOUNT_NOT_CONNECTED' });

  const accessToken = await getAccessToken(creds.refreshToken);
  const lim = Math.min(Math.max(1, Number(limit) || 10), 50);
  const statusWhere = campaignIdentityStatusWhere(status);

  const identityGaql = `
    SELECT campaign.id, campaign.name, campaign.status
    FROM campaign
    WHERE ${statusWhere}
    ORDER BY campaign.id
    LIMIT ${CAMPAIGN_IDENTITY_PAGE}
  `;

  const metricsGaql = `
    SELECT
      campaign.id,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  `;

  const [identityRows, metricRows] = await Promise.all([
    queryGaql(accessToken, creds.customerId, creds.loginCustomerId, identityGaql),
    queryGaql(accessToken, creds.customerId, creds.loginCustomerId, metricsGaql),
  ]);

  const metricsById = aggregateGoogleCampaignMetricRows(metricRows);
  const statusMap = { ENABLED: 'active', PAUSED: 'paused', REMOVED: 'archived' };

  const campaigns = [];
  const seen = new Set();
  for (const r of identityRows) {
    const c = r.campaign || {};
    const id = String(c.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const m = metricsById.get(id) || {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      convValue: 0,
    };
    const spend = round(m.spend);
    const conversions = round(m.conversions);
    const convValue = round(m.convValue);
    campaigns.push({
      campaign_id: id,
      campaign_name: c.name || '',
      status: statusMap[c.status] || 'unknown',
      spend,
      impressions: m.impressions,
      clicks: m.clicks,
      ctr: round(safeDiv(m.clicks, m.impressions) * 100),
      conversions,
      cost_per_conversion: round(safeDiv(spend, conversions)),
      roas_reported: round(safeDiv(convValue, spend)),
    });
  }

  campaigns.sort((a, b) => b.spend - a.spend);
  const sliced = campaigns.slice(0, lim);
  const totalSpend = sliced.reduce((s, c) => s + c.spend, 0);

  return {
    channel: 'google',
    campaigns: sliced,
    total_spend: round(totalSpend),
    currency: creds.currency,
    date_from: dateFrom,
    date_to: dateTo,
  };
}

async function getAdsetPerformance(userId, campaignId, dateFrom, dateTo) {
  const creds = await resolveGoogleCredentials(userId);
  if (!creds?.refreshToken) throw Object.assign(new Error('ACCOUNT_NOT_CONNECTED'), { code: 'ACCOUNT_NOT_CONNECTED' });

  const accessToken = await getAccessToken(creds.refreshToken);

  const gaql = `
    SELECT
      ad_group.id, ad_group.name, ad_group.status,
      campaign.id, campaign.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.conversions
    FROM ad_group
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      AND campaign.id = ${campaignId}
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await queryGaql(accessToken, creds.customerId, creds.loginCustomerId, gaql);

  const adsets = rows.map(r => {
    const m = r.metrics || {};
    const ag = r.adGroup || {};
    const spend = toNum(m.costMicros) / 1_000_000;
    const conversions = toNum(m.conversions);
    const statusMap = { ENABLED: 'active', PAUSED: 'paused', REMOVED: 'archived' };
    return {
      adset_id: String(ag.id || ''),
      adset_name: ag.name || '',
      status: statusMap[ag.status] || 'unknown',
      spend: round(spend),
      impressions: toNum(m.impressions),
      clicks: toNum(m.clicks),
      ctr: round(toNum(m.ctr) * 100),
      conversions: round(conversions),
      cpa: round(safeDiv(spend, conversions)),
    };
  });

  return {
    channel: 'google',
    campaign_id: campaignId,
    campaign_name: rows[0]?.campaign?.name || null,
    adsets,
    date_from: dateFrom,
    date_to: dateTo,
  };
}

module.exports = {
  resolveGoogleCredentials,
  getAdPerformance,
  getCampaignPerformance,
  getAdsetPerformance,
};
