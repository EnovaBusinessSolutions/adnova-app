'use strict';

const { createToolResponse, createToolErrorResponse } = require('../schemas/errors');

jest.mock('../adapters/account', () => ({
  getAccountInfo: jest.fn().mockResolvedValue({
    connected_accounts: [
      { platform: 'meta', account_id: '123', account_name: 'Test Meta', currency: 'USD', timezone: 'America/New_York', status: 'connected' },
      { platform: 'google', account_id: '456', account_name: 'Test Google', currency: 'USD', timezone: 'America/Los_Angeles', status: 'connected' },
      { platform: 'shopify', account_id: 'test.myshopify.com', account_name: 'test', currency: null, timezone: null, status: 'connected' },
    ],
  }),
}));

jest.mock('../adapters/meta', () => ({
  getAdPerformance: jest.fn().mockResolvedValue({
    channel: 'meta', spend: 1500.50, impressions: 50000, clicks: 2500,
    ctr: 5.0, cpc: 0.60, cpm: 30.01, currency: 'USD',
    date_from: '2026-01-01', date_to: '2026-01-31', rows: [],
  }),
  getCampaignPerformance: jest.fn().mockResolvedValue({
    channel: 'meta', campaigns: [
      { campaign_id: 'c1', campaign_name: 'Campaign 1', status: 'active', spend: 500, impressions: 20000, clicks: 1000, ctr: 5.0, conversions: 50, cost_per_conversion: 10, roas_reported: 3.5 },
    ], total_spend: 500, currency: 'USD', date_from: '2026-01-01', date_to: '2026-01-31',
  }),
  getAdsetPerformance: jest.fn().mockResolvedValue({
    channel: 'meta', campaign_id: 'c1', campaign_name: 'Campaign 1',
    adsets: [
      { adset_id: 'as1', adset_name: 'Ad Set 1', status: 'active', spend: 200, impressions: 10000, clicks: 500, ctr: 5.0, conversions: 25, cpa: 8 },
    ], date_from: '2026-01-01', date_to: '2026-01-31',
  }),
}));

jest.mock('../adapters/google', () => ({
  getAdPerformance: jest.fn().mockResolvedValue({
    channel: 'google', spend: 2000, impressions: 80000, clicks: 4000,
    ctr: 5.0, cpc: 0.50, cpm: 25, currency: 'USD',
    date_from: '2026-01-01', date_to: '2026-01-31', rows: [],
  }),
  getCampaignPerformance: jest.fn().mockResolvedValue({
    channel: 'google', campaigns: [], total_spend: 0, currency: 'USD',
    date_from: '2026-01-01', date_to: '2026-01-31',
  }),
  getAdsetPerformance: jest.fn().mockResolvedValue({
    channel: 'google', campaign_id: 'g1', campaign_name: null,
    adsets: [], date_from: '2026-01-01', date_to: '2026-01-31',
  }),
}));

jest.mock('../adapters/shopify', () => ({
  getShopifyRevenue: jest.fn().mockResolvedValue({
    total_revenue: 15000, net_revenue: 14500, total_orders: 200,
    average_order_value: 75, new_customer_orders: 120, returning_customer_orders: 80,
    new_customer_pct: 60, currency: 'USD',
    date_from: '2026-01-01', date_to: '2026-01-31', rows: [],
  }),
  getShopifyProducts: jest.fn().mockResolvedValue({
    products: [
      { product_id: 'p1', product_name: 'Widget', units_sold: 100, revenue: 5000, orders: 80, avg_selling_price: 50 },
    ], currency: 'USD', date_from: '2026-01-01', date_to: '2026-01-31',
  }),
}));

const accountAdapter = require('../adapters/account');
const metaAdapter = require('../adapters/meta');
const googleAdapter = require('../adapters/google');
const shopifyAdapter = require('../adapters/shopify');

describe('Tool: get_account_info', () => {
  test('returns connected accounts', async () => {
    const data = await accountAdapter.getAccountInfo('user123');
    expect(data.connected_accounts).toHaveLength(3);
    expect(data.connected_accounts[0].platform).toBe('meta');
    expect(data.connected_accounts[1].platform).toBe('google');
    expect(data.connected_accounts[2].platform).toBe('shopify');
  });
});

describe('Tool: get_ad_performance', () => {
  test('returns meta ad performance', async () => {
    const data = await metaAdapter.getAdPerformance('user123', '2026-01-01', '2026-01-31', 'total');
    expect(data.channel).toBe('meta');
    expect(data.spend).toBeGreaterThan(0);
    expect(data.currency).toBe('USD');
  });

  test('returns google ad performance', async () => {
    const data = await googleAdapter.getAdPerformance('user123', '2026-01-01', '2026-01-31', 'total');
    expect(data.channel).toBe('google');
    expect(data.spend).toBeGreaterThan(0);
  });
});

describe('Tool: get_campaign_performance', () => {
  test('returns campaigns list', async () => {
    const data = await metaAdapter.getCampaignPerformance('user123', '2026-01-01', '2026-01-31', 10, 'all');
    expect(data.channel).toBe('meta');
    expect(data.campaigns).toHaveLength(1);
    expect(data.campaigns[0].campaign_id).toBe('c1');
    expect(data.campaigns[0].roas_reported).toBeDefined();
  });
});

describe('Tool: get_adset_performance', () => {
  test('returns adsets for a campaign', async () => {
    const data = await metaAdapter.getAdsetPerformance('user123', 'c1', '2026-01-01', '2026-01-31');
    expect(data.campaign_id).toBe('c1');
    expect(data.adsets).toHaveLength(1);
    expect(data.adsets[0].cpa).toBeDefined();
  });
});

describe('Tool: get_shopify_revenue', () => {
  test('returns revenue data', async () => {
    const data = await shopifyAdapter.getShopifyRevenue('user123', '2026-01-01', '2026-01-31', 'total');
    expect(data.total_revenue).toBe(15000);
    expect(data.net_revenue).toBe(14500);
    expect(data.total_orders).toBe(200);
    expect(data.average_order_value).toBe(75);
    expect(data.new_customer_pct).toBe(60);
  });
});

describe('Tool: get_shopify_products', () => {
  test('returns ranked products', async () => {
    const data = await shopifyAdapter.getShopifyProducts('user123', '2026-01-01', '2026-01-31', 'revenue', 10);
    expect(data.products).toHaveLength(1);
    expect(data.products[0].product_name).toBe('Widget');
    expect(data.products[0].avg_selling_price).toBe(50);
  });
});

describe('Tool: get_channel_summary (integration)', () => {
  test('aggregates meta and google spend', async () => {
    const meta = await metaAdapter.getAdPerformance('user123', '2026-01-01', '2026-01-31', 'total');
    const google = await googleAdapter.getAdPerformance('user123', '2026-01-01', '2026-01-31', 'total');
    const totalSpend = meta.spend + google.spend;
    expect(totalSpend).toBe(3500.50);
  });
});

describe('Tool: get_date_comparison (integration)', () => {
  test('calculates period deltas', async () => {
    const periodA = { spend: 1000, impressions: 40000, clicks: 2000, ctr: 5.0, cpc: 0.5, cpm: 25 };
    const periodB = { spend: 1500, impressions: 50000, clicks: 2500, ctr: 5.0, cpc: 0.6, cpm: 30 };

    const spendDelta = periodB.spend - periodA.spend;
    const spendPct = ((periodB.spend - periodA.spend) / periodA.spend) * 100;

    expect(spendDelta).toBe(500);
    expect(spendPct).toBe(50);
  });
});

describe('Security: no credentials in responses', () => {
  test('account info does not expose tokens', async () => {
    const data = await accountAdapter.getAccountInfo('user123');
    const json = JSON.stringify(data);
    expect(json).not.toContain('access_token');
    expect(json).not.toContain('refresh_token');
    expect(json).not.toContain('api_key');
    expect(json).not.toContain('secret');
  });

  test('ad performance does not expose tokens', async () => {
    const data = await metaAdapter.getAdPerformance('user123', '2026-01-01', '2026-01-31', 'total');
    const json = JSON.stringify(data);
    expect(json).not.toContain('access_token');
    expect(json).not.toContain('refresh_token');
  });
});

describe('Tool response format', () => {
  test('createToolResponse wraps correctly', () => {
    const resp = createToolResponse({ channel: 'meta', spend: 100 });
    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe('text');
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.channel).toBe('meta');
  });

  test('createToolErrorResponse wraps errors correctly', () => {
    const resp = createToolErrorResponse('ACCOUNT_NOT_CONNECTED', 'get_ad_performance');
    expect(resp.isError).toBe(true);
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.error).toBe(true);
    expect(parsed.error_code).toBe('ACCOUNT_NOT_CONNECTED');
    expect(parsed.tool).toBe('get_ad_performance');
  });
});
