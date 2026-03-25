'use strict';

const {
  compareAdMetrics,
  compareShopifyMetrics,
  round,
  emptyAdPerformance,
  emptyCampaignPerformance,
} = require('../services/adsPerformanceResolve');

describe('adsPerformanceResolve helpers', () => {
  test('compareAdMetrics computes deltas and direction', () => {
    const a = { spend: 100, impressions: 1000, clicks: 50, ctr: 5, cpc: 2, cpm: 100 };
    const b = { spend: 150, impressions: 1200, clicks: 60, ctr: 5, cpm: 125 };
    const m = compareAdMetrics(a, b);
    const spend = m.find((x) => x.name === 'spend');
    expect(spend.period_a_value).toBe(100);
    expect(spend.period_b_value).toBe(150);
    expect(spend.change_absolute).toBe(50);
    expect(spend.change_pct).toBe(50);
    expect(spend.direction).toBe('up');
  });

  test('compareShopifyMetrics handles zero baseline', () => {
    const a = { total_revenue: 0, net_revenue: 0, total_orders: 0, average_order_value: 0 };
    const b = { total_revenue: 100, net_revenue: 90, total_orders: 2, average_order_value: 50 };
    const m = compareShopifyMetrics(a, b);
    const rev = m.find((x) => x.name === 'total_revenue');
    expect(rev.change_pct).toBe(100);
    expect(rev.direction).toBe('up');
  });

  test('round fixes decimals', () => {
    expect(round(1.2345)).toBe(1.23);
  });
});

describe('empty fallbacks', () => {
  test('emptyAdPerformance google total', () => {
    const o = emptyAdPerformance('google', '2026-01-01', '2026-01-31', 'total');
    expect(o.channel).toBe('google');
    expect(o.spend).toBe(0);
    expect(o.currency).toBe('USD');
    expect(o.rows).toEqual([]);
  });

  test('emptyCampaignPerformance google', () => {
    const o = emptyCampaignPerformance('google', '2026-01-01', '2026-01-31', 10, 'all');
    expect(o.campaigns).toEqual([]);
    expect(o.total_spend).toBe(0);
  });
});
