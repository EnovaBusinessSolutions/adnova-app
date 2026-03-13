'use strict';

const axios = require('axios');
const crypto = require('crypto');

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';

let MetaAccount;
try { MetaAccount = require('../../models/MetaAccount'); } catch { MetaAccount = null; }

function makeProof(token) {
  return APP_SECRET ? crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex') : null;
}

function normActId(s) { return String(s || '').replace(/^act_/, '').replace(/[^\d]/g, ''); }

function toNum(v) { return Number(v || 0) || 0; }
function safeDiv(n, d) { return d ? n / d : 0; }
function round(n, d = 2) { return Number(Number(n || 0).toFixed(d)); }

function extractConversions(actions) {
  if (!Array.isArray(actions)) return 0;
  const a = actions.find(x => x.action_type === 'purchase' || x.action_type === 'offsite_conversion.fb_pixel_purchase');
  return toNum(a?.value);
}

function extractConversionValue(actionValues) {
  if (!Array.isArray(actionValues)) return 0;
  const a = actionValues.find(x => x.action_type === 'purchase' || x.action_type === 'offsite_conversion.fb_pixel_purchase');
  return toNum(a?.value);
}

async function resolveMetaCredentials(userId) {
  if (!MetaAccount) return null;
  const doc = await MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
    .select('+longLivedToken +longlivedToken +access_token +token ad_accounts adAccounts defaultAccountId selectedAccountIds')
    .lean();
  if (!doc) return null;
  const token = doc.longLivedToken || doc.longlivedToken || doc.access_token || doc.token;
  const accounts = doc.ad_accounts?.length ? doc.ad_accounts : doc.adAccounts || [];
  const accountId = doc.selectedAccountIds?.[0] || doc.defaultAccountId || accounts[0]?.id || null;
  const found = accounts.find(a => String(a?.id || a?.account_id || '') === String(accountId)) || {};
  return {
    token,
    accountId: normActId(accountId),
    currency: found.currency || found.account_currency || 'USD',
  };
}

async function fetchInsights(token, accountId, dateFrom, dateTo, level = 'account', extraParams = {}) {
  const proof = makeProof(token);
  const fields = [
    'date_start', 'date_stop', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
    'actions', 'action_values',
    ...(level !== 'account' ? ['campaign_id', 'campaign_name'] : []),
    ...(level === 'adset' ? ['adset_id', 'adset_name'] : []),
  ].join(',');

  const params = {
    access_token: token,
    fields,
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    level,
    limit: 500,
    ...extraParams,
  };
  if (proof) params.appsecret_proof = proof;

  const url = `${FB_GRAPH}/act_${accountId}/insights`;
  let results = [];
  let nextUrl = null;

  const first = await axios.get(url, { params, timeout: 30000 });
  results = results.concat(first.data?.data || []);
  nextUrl = first.data?.paging?.next || null;

  while (nextUrl && results.length < 5000) {
    const next = await axios.get(nextUrl, { timeout: 30000 });
    results = results.concat(next.data?.data || []);
    nextUrl = next.data?.paging?.next || null;
  }

  return results;
}

async function getAdPerformance(userId, dateFrom, dateTo, granularity) {
  const creds = await resolveMetaCredentials(userId);
  if (!creds?.token) throw Object.assign(new Error('ACCOUNT_NOT_CONNECTED'), { code: 'ACCOUNT_NOT_CONNECTED' });

  const breakdown = granularity && granularity !== 'total'
    ? { time_increment: granularity === 'day' ? 1 : granularity === 'week' ? 7 : 'monthly' }
    : {};

  const rows = await fetchInsights(creds.token, creds.accountId, dateFrom, dateTo, 'account', breakdown);

  if (!rows.length) {
    return {
      channel: 'meta', spend: 0, impressions: 0, clicks: 0,
      ctr: 0, cpc: 0, cpm: 0, currency: creds.currency,
      date_from: dateFrom, date_to: dateTo, rows: [],
    };
  }

  const agg = rows.reduce((acc, r) => {
    acc.spend += toNum(r.spend);
    acc.impressions += toNum(r.impressions);
    acc.clicks += toNum(r.clicks);
    return acc;
  }, { spend: 0, impressions: 0, clicks: 0 });

  const mapped = granularity && granularity !== 'total'
    ? rows.map(r => ({
        date: r.date_start,
        spend: round(toNum(r.spend)),
        impressions: toNum(r.impressions),
        clicks: toNum(r.clicks),
        ctr: round(safeDiv(toNum(r.clicks), toNum(r.impressions)) * 100),
        cpc: round(safeDiv(toNum(r.spend), toNum(r.clicks))),
        cpm: round(safeDiv(toNum(r.spend), toNum(r.impressions)) * 1000),
      }))
    : [];

  return {
    channel: 'meta',
    spend: round(agg.spend),
    impressions: agg.impressions,
    clicks: agg.clicks,
    ctr: round(safeDiv(agg.clicks, agg.impressions) * 100),
    cpc: round(safeDiv(agg.spend, agg.clicks)),
    cpm: round(safeDiv(agg.spend, agg.impressions) * 1000),
    currency: creds.currency,
    date_from: dateFrom,
    date_to: dateTo,
    rows: mapped,
  };
}

async function getCampaignPerformance(userId, dateFrom, dateTo, limit = 10, status = 'all') {
  const creds = await resolveMetaCredentials(userId);
  if (!creds?.token) throw Object.assign(new Error('ACCOUNT_NOT_CONNECTED'), { code: 'ACCOUNT_NOT_CONNECTED' });

  const extra = {};
  if (status && status !== 'all') {
    extra.filtering = JSON.stringify([{ field: 'campaign.effective_status', operator: 'IN', value: [status.toUpperCase()] }]);
  }

  const rows = await fetchInsights(creds.token, creds.accountId, dateFrom, dateTo, 'campaign', extra);

  const campaigns = rows.map(r => {
    const spend = toNum(r.spend);
    const conversions = extractConversions(r.actions);
    const convValue = extractConversionValue(r.action_values);
    return {
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      status: 'active',
      spend: round(spend),
      impressions: toNum(r.impressions),
      clicks: toNum(r.clicks),
      ctr: round(toNum(r.ctr)),
      conversions,
      cost_per_conversion: round(safeDiv(spend, conversions)),
      roas_reported: round(safeDiv(convValue, spend)),
    };
  });

  campaigns.sort((a, b) => b.spend - a.spend);
  const sliced = campaigns.slice(0, limit);
  const totalSpend = sliced.reduce((s, c) => s + c.spend, 0);

  return {
    channel: 'meta',
    campaigns: sliced,
    total_spend: round(totalSpend),
    currency: creds.currency,
    date_from: dateFrom,
    date_to: dateTo,
  };
}

async function getAdsetPerformance(userId, campaignId, dateFrom, dateTo) {
  const creds = await resolveMetaCredentials(userId);
  if (!creds?.token) throw Object.assign(new Error('ACCOUNT_NOT_CONNECTED'), { code: 'ACCOUNT_NOT_CONNECTED' });

  const extra = {
    filtering: JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: campaignId }]),
  };

  const rows = await fetchInsights(creds.token, creds.accountId, dateFrom, dateTo, 'adset', extra);

  const adsets = rows.map(r => {
    const spend = toNum(r.spend);
    const conversions = extractConversions(r.actions);
    return {
      adset_id: r.adset_id,
      adset_name: r.adset_name,
      status: 'active',
      spend: round(spend),
      impressions: toNum(r.impressions),
      clicks: toNum(r.clicks),
      ctr: round(toNum(r.ctr)),
      conversions,
      cpa: round(safeDiv(spend, conversions)),
    };
  });

  return {
    channel: 'meta',
    campaign_id: campaignId,
    campaign_name: rows[0]?.campaign_name || null,
    adsets,
    date_from: dateFrom,
    date_to: dateTo,
  };
}

module.exports = {
  resolveMetaCredentials,
  getAdPerformance,
  getCampaignPerformance,
  getAdsetPerformance,
};
