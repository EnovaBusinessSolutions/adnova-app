'use strict';

const {
  resolveDailyTotalsForRange,
  resolveCampaignsDailyForRange,
  getSnapshotAgeMinutes,
  isFreshSnapshot,
} = require('./snapshotResolver');
const { getSnapshotMaxAgeMinutes } = require('./config');
const {
  buildAdPerformanceFromDailyTotals,
  buildCampaignPerformanceFromDailyRows,
} = require('./mappers');

async function buildAdPerformanceSnapshot(userId, sourceKey, channel, dateFrom, dateTo, granularity) {
  const resolved = await resolveDailyTotalsForRange(userId, sourceKey, dateFrom, dateTo);
  if (!resolved) return { ok: false };

  const chunk = resolved.chunk;
  const fresh = isFreshSnapshot(chunk, getSnapshotMaxAgeMinutes());
  const currency = chunk?.data?.meta?.currency || 'USD';
  const data = buildAdPerformanceFromDailyTotals(
    resolved.totalsByDay,
    channel,
    currency,
    dateFrom,
    dateTo,
    granularity
  );

  return {
    ok: true,
    data,
    snapshot_id: chunk.snapshotId || null,
    snapshot_age_min: getSnapshotAgeMinutes(chunk),
    fresh,
    partial_coverage: !!resolved.partial_coverage,
  };
}

async function buildCampaignPerformanceSnapshot(
  userId,
  sourceKey,
  channel,
  dateFrom,
  dateTo,
  limit,
  status
) {
  const resolved = await resolveCampaignsDailyForRange(userId, sourceKey, dateFrom, dateTo);
  if (!resolved) return { ok: false };

  const chunk = resolved.chunk;
  const fresh = isFreshSnapshot(chunk, getSnapshotMaxAgeMinutes());
  const currency = chunk?.data?.meta?.currency || 'USD';
  const data = buildCampaignPerformanceFromDailyRows(
    resolved.rows,
    channel,
    currency,
    dateFrom,
    dateTo,
    limit,
    status
  );

  return {
    ok: true,
    data,
    snapshot_id: chunk.snapshotId || null,
    snapshot_age_min: getSnapshotAgeMinutes(chunk),
    fresh,
    partial_coverage: !!resolved.partial_coverage,
  };
}

module.exports = {
  buildAdPerformanceSnapshot,
  buildCampaignPerformanceSnapshot,
};
