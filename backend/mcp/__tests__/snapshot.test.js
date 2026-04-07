'use strict';

const {
  chunkCoversDateRange,
  filterTotalsByDayRange,
  hasFullDayCoverage,
} = require('../snapshot/snapshotResolver');

const { buildAdPerformanceFromDailyTotals, buildCampaignPerformanceFromDailyRows } = require('../snapshot/mappers');

describe('snapshotResolver', () => {
  test('chunkCoversDateRange inclusive', () => {
    const chunk = { range: { from: '2025-01-01', to: '2025-01-31' } };
    expect(chunkCoversDateRange(chunk, '2025-01-05', '2025-01-10')).toBe(true);
    expect(chunkCoversDateRange(chunk, '2024-12-01', '2025-01-10')).toBe(false);
  });

  test('filterTotalsByDayRange', () => {
    const rows = [
      { date: '2025-01-01', kpis: { spend: 1, impressions: 10, clicks: 1 } },
      { date: '2025-01-02', kpis: { spend: 2, impressions: 20, clicks: 2 } },
    ];
    const f = filterTotalsByDayRange(rows, '2025-01-02', '2025-01-02');
    expect(f).toHaveLength(1);
    expect(f[0].date).toBe('2025-01-02');
  });

  test('hasFullDayCoverage', () => {
    const rows = [{ date: '2025-01-01', kpis: {} }, { date: '2025-01-02', kpis: {} }];
    expect(hasFullDayCoverage(rows, '2025-01-01', '2025-01-02')).toBe(true);
    expect(hasFullDayCoverage(rows, '2025-01-01', '2025-01-03')).toBe(false);
  });
});

describe('mappers buildAdPerformanceFromDailyTotals', () => {
  test('aggregates totals and empty rows for granularity total', () => {
    const totals = [
      { date: '2025-01-01', kpis: { spend: 10, impressions: 1000, clicks: 50 } },
      { date: '2025-01-02', kpis: { spend: 20, impressions: 2000, clicks: 100 } },
    ];
    const out = buildAdPerformanceFromDailyTotals(totals, 'google', 'MXN', '2025-01-01', '2025-01-02', 'total');
    expect(out.channel).toBe('google');
    expect(out.currency).toBe('MXN');
    expect(out.spend).toBe(30);
    expect(out.impressions).toBe(3000);
    expect(out.clicks).toBe(150);
    expect(out.rows).toEqual([]);
  });
});

describe('mappers buildCampaignPerformanceFromDailyRows', () => {
  test('aggregates by campaign_id', () => {
    const rows = [
      {
        date: '2025-01-01',
        campaign_id: '111',
        campaign_name: 'A',
        status: 'ENABLED',
        kpis: { spend: 5, impressions: 500, clicks: 10, conversions: 1, conversion_value: 20 },
      },
      {
        date: '2025-01-02',
        campaign_id: '111',
        campaign_name: 'A',
        status: 'ENABLED',
        kpis: { spend: 5, impressions: 500, clicks: 10, conversions: 1, conversion_value: 20 },
      },
    ];
    const out = buildCampaignPerformanceFromDailyRows(rows, 'google', 'USD', '2025-01-01', '2025-01-02', 10, 'all');
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0].spend).toBe(10);
    expect(out.campaigns[0].campaign_id).toBe('111');
  });
});
