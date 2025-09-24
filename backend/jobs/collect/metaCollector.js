'use strict';

const axios = require('axios');
const MetaAccount = require('../../models/MetaAccount');

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

// insights por campaña últimos 30 días
async function fetchCampaignInsights({ token, actId }) {
  const url = `${GRAPH}/act_${actId}/insights`;
  const params = {
    access_token: token,
    level: 'campaign',
    time_range: JSON.stringify({ since: getSince(30), until: getUntil() }),
    fields: [
      'campaign_id',
      'campaign_name',
      'impressions',
      'clicks',
      'spend',
      'actions',
      'action_values',
    ].join(','),
    limit: 500,
  };
  const { data } = await axios.get(url, { params, timeout: 20000 });
  return Array.isArray(data?.data) ? data.data : [];
}

function getSince(days) {
  const d = new Date(Date.now() - (days * 86400000));
  return d.toISOString().slice(0, 10);
}
function getUntil() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function getAction(actions, key) {
  // actions: [{ action_type: 'offsite_conversion.purchase', value: '3' }, ...]
  if (!Array.isArray(actions)) return 0;
  const item = actions.find(a => a.action_type === key);
  return Number(item?.value || 0);
}

async function fetchMetaSnapshot(userId) {
  // 1) encontrar cuenta + token
  const acc = await MetaAccount.findOne({ $or: [{ userId }, { user: userId }] })
    .select('+access_token +token +longlivedToken defaultAccountId ad_accounts adAccounts')
    .lean();

  const token = acc?.longlivedToken || acc?.longLivedToken || acc?.access_token || acc?.token;
  const act = acc?.defaultAccountId || acc?.ad_accounts?.[0]?.account_id || acc?.adAccounts?.[0]?.account_id;

  if (!token || !act) {
    return { currency: 'USD', timeRange: {}, kpis: {}, byCampaign: [], pixelHealth: { errors: [], warnings: [] } };
  }

  // 2) insights por campaña
  const rows = await fetchCampaignInsights({ token, actId: act });

  const byCampaign = rows.map(r => {
    const purchases = getAction(r.actions, 'offsite_conversion.purchase');
    const value = getAction(r.action_values, 'offsite_conversion.purchase');
    const clicks = Number(r.clicks || 0);
    const imp = Number(r.impressions || 0);
    const spend = Number(r.spend || 0);

    return {
      id: r.campaign_id,
      name: r.campaign_name,
      kpis: {
        impressions: imp,
        clicks,
        spend,
        conversions: purchases,
        convValue: value,
        ctr: imp ? clicks / imp : 0,
        cpc: clicks ? spend / clicks : 0,
        cpa: purchases ? spend / purchases : 0,
        roas: spend ? (value / spend) : 0,
      },
    };
  });

  const kpis = byCampaign.reduce((acc, c) => {
    acc.impressions += c.kpis.impressions;
    acc.clicks += c.kpis.clicks;
    acc.spend += c.kpis.spend;
    acc.conversions += c.kpis.conversions;
    acc.convValue += c.kpis.convValue;
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0, convValue: 0 });

  // 3) pixel diagnostics (opcional si no tienes pixelId a mano)
  const pixelHealth = { errors: [], warnings: [] };

  return {
    currency: 'USD',
    timeRange: { since: getSince(30), until: getUntil() },
    kpis,
    byCampaign,
    pixelHealth,
    targets: { cprHigh: 5 },
  };
}

async function collectMeta(userId) {
  try {
    return await fetchMetaSnapshot(userId);
  } catch (e) {
    console.warn('collectMeta error:', e?.response?.data || e.message);
    return { currency: 'USD', timeRange: {}, kpis: {}, byCampaign: [], pixelHealth: { errors: [], warnings: [] } };
  }
}

module.exports = { collectMeta };
