'use strict';

const { safeStr } = require('./snapshotResolver');

function toNum(v) {
  return Number(v || 0) || 0;
}
function safeDiv(n, d) {
  return d ? n / d : 0;
}
function round(n, d = 2) {
  return Number(Number(n || 0).toFixed(d));
}

function weekKeyYmd(dateStr) {
  const d = new Date(`${safeStr(dateStr)}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return safeStr(dateStr);
  const day = d.getUTCDay();
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - day);
  return start.toISOString().slice(0, 10);
}

function monthKeyYmd(dateStr) {
  const s = safeStr(dateStr);
  return s.length >= 7 ? s.slice(0, 7) + '-01' : s;
}

/**
 * Build daily row list for tool output from snapshot kpis (google/meta compatible).
 */
function mapDailyRowsFromTotals(filteredTotals, _channel) {
  return filteredTotals.map((r) => {
    const k = r.kpis || {};
    const spend = toNum(k.spend);
    const impressions = toNum(k.impressions);
    const clicks = toNum(k.clicks);
    return {
      date: r.date,
      spend: round(spend),
      impressions,
      clicks,
      ctr: round(safeDiv(clicks, impressions) * 100),
      cpc: round(safeDiv(spend, clicks)),
      cpm: round(safeDiv(spend, impressions) * 1000),
    };
  });
}

function rollupRows(mapped) {
  const agg = mapped.reduce(
    (a, r) => {
      a.spend += r.spend;
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      return a;
    },
    { spend: 0, impressions: 0, clicks: 0 }
  );
  return {
    spend: round(agg.spend),
    impressions: agg.impressions,
    clicks: agg.clicks,
    ctr: round(safeDiv(agg.clicks, agg.impressions) * 100),
    cpc: round(safeDiv(agg.spend, agg.clicks)),
    cpm: round(safeDiv(agg.spend, agg.impressions) * 1000),
  };
}

function groupRowsByGranularity(mapped, granularity) {
  if (!granularity || granularity === 'total' || granularity === 'day') {
    return granularity === 'day' ? mapped : null;
  }
  const buckets = new Map();
  for (const r of mapped) {
    const key =
      granularity === 'week' ? weekKeyYmd(r.date) : monthKeyYmd(r.date);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(r);
  }
  const out = [];
  for (const [key, arr] of buckets) {
    const sub = rollupRows(arr);
    out.push({
      date: key,
      spend: sub.spend,
      impressions: sub.impressions,
      clicks: sub.clicks,
      ctr: sub.ctr,
      cpc: sub.cpc,
      cpm: sub.cpm,
    });
  }
  out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

/**
 * @param {Array} filteredTotals from snapshot
 * @param {'meta'|'google'} channel
 * @param {string} currency
 * @param {string} dateFrom
 * @param {string} dateTo
 * @param {string} granularity
 */
function buildAdPerformanceFromDailyTotals(filteredTotals, channel, currency, dateFrom, dateTo, granularity) {
  const mapped = mapDailyRowsFromTotals(filteredTotals, channel);
  const rolled = rollupRows(mapped);

  let rows = [];
  if (granularity && granularity !== 'total') {
    const grouped = groupRowsByGranularity(mapped, granularity);
    rows = grouped || mapped;
  }

  return {
    channel,
    spend: rolled.spend,
    impressions: rolled.impressions,
    clicks: rolled.clicks,
    ctr: rolled.ctr,
    cpc: rolled.cpc,
    cpm: rolled.cpm,
    currency: currency || 'USD',
    date_from: dateFrom,
    date_to: dateTo,
    rows,
  };
}

function normCampaignStatus(raw, channel) {
  const s = safeStr(raw).toUpperCase();
  if (channel === 'google') {
    if (s === 'ENABLED') return 'active';
    if (s === 'PAUSED') return 'paused';
    if (s === 'REMOVED') return 'archived';
  }
  if (channel === 'meta') {
    if (s.includes('ACTIVE')) return 'active';
    if (s.includes('PAUSED')) return 'paused';
  }
  if (!s) return 'unknown';
  return safeStr(raw).toLowerCase() || 'unknown';
}

function passesStatusFilter(normStatus, statusFilter) {
  if (!statusFilter || statusFilter === 'all') return true;
  if (statusFilter === 'active') return normStatus === 'active';
  if (statusFilter === 'paused') return normStatus === 'paused';
  return true;
}

/**
 * @param {Array} campaignDailyRows from snapshot campaigns_daily
 * @param {'meta'|'google'} channel
 * @param {string} currency
 * @param {string} dateFrom
 * @param {string} dateTo
 * @param {number} limit
 * @param {string} statusFilter
 */
function buildCampaignPerformanceFromDailyRows(
  campaignDailyRows,
  channel,
  currency,
  dateFrom,
  dateTo,
  limit,
  statusFilter
) {
  const byC = new Map();

  for (const r of campaignDailyRows) {
    const cid = String(r.campaign_id || '').trim();
    if (!cid) continue;
    const st = normCampaignStatus(r.status, channel);
    if (!passesStatusFilter(st, statusFilter)) continue;

    const k = r.kpis || {};
    const spend = toNum(k.spend);
    const impressions = toNum(k.impressions);
    const clicks = toNum(k.clicks);

    let conversions = 0;
    let convValue = 0;
    if (channel === 'google') {
      conversions = toNum(k.conversions);
      convValue = toNum(k.conversion_value);
    } else {
      conversions = toNum(k.purchases);
      convValue = toNum(k.purchase_value);
    }

    const cur = byC.get(cid) || {
      campaign_id: cid,
      campaign_name: r.campaign_name || r.name || '',
      status: st,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      convValue: 0,
    };
    cur.spend += spend;
    cur.impressions += impressions;
    cur.clicks += clicks;
    cur.conversions += conversions;
    cur.convValue += convValue;
    if (r.campaign_name) cur.campaign_name = r.campaign_name;
    byC.set(cid, cur);
  }

  const campaigns = Array.from(byC.values())
    .map((c) => {
      const spend = round(c.spend);
      const conversions = round(c.conversions);
      const convValue = round(c.convValue);
      return {
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        status: c.status,
        spend,
        impressions: c.impressions,
        clicks: c.clicks,
        ctr: round(safeDiv(c.clicks, c.impressions) * 100),
        conversions,
        cost_per_conversion: round(safeDiv(spend, conversions)),
        roas_reported: round(safeDiv(convValue, spend)),
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, Math.min(Math.max(1, limit || 10), 50));

  const totalSpend = round(campaigns.reduce((s, x) => s + x.spend, 0));

  return {
    channel,
    campaigns,
    total_spend: totalSpend,
    currency: currency || 'USD',
    date_from: dateFrom,
    date_to: dateTo,
  };
}

module.exports = {
  buildAdPerformanceFromDailyTotals,
  buildCampaignPerformanceFromDailyRows,
  mapDailyRowsFromTotals,
};
