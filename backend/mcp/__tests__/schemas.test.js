'use strict';

const {
  getAccountInfoInput,
  getAdPerformanceInput,
  getCampaignPerformanceInput,
  getAdsetPerformanceInput,
  getShopifyRevenueInput,
  getShopifyProductsInput,
  getChannelSummaryInput,
  getDateComparisonInput,
  validateDateRange,
  resolveDateRangeDefaults,
  resolveComparisonDefaults,
} = require('../schemas/tool-schemas');

const { createToolError, createToolErrorResponse, createToolResponse, ERROR_CODES } = require('../schemas/errors');

describe('Tool Input Schemas', () => {
  test('getAdPerformanceInput accepts valid params', () => {
    const result = getAdPerformanceInput.parse({
      channel: 'meta',
      date_from: '2026-01-01',
      date_to: '2026-01-31',
    });
    expect(result.channel).toBe('meta');
    expect(result.date_from).toBe('2026-01-01');
  });

  test('getAdPerformanceInput rejects invalid channel', () => {
    expect(() =>
      getAdPerformanceInput.parse({ channel: 'tiktok', date_from: '2026-01-01', date_to: '2026-01-31' })
    ).toThrow();
  });

  test('getAdPerformanceInput rejects invalid date format', () => {
    expect(() =>
      getAdPerformanceInput.parse({ channel: 'meta', date_from: '01-01-2026', date_to: '2026-01-31' })
    ).toThrow();
  });

  test('getCampaignPerformanceInput applies defaults', () => {
    const result = getCampaignPerformanceInput.parse({
      channel: 'google',
      date_from: '2026-01-01',
      date_to: '2026-01-31',
    });
    expect(result.channel).toBe('google');
  });

  test('getAdsetPerformanceInput requires campaign_id', () => {
    expect(() =>
      getAdsetPerformanceInput.parse({ channel: 'meta', date_from: '2026-01-01', date_to: '2026-01-31' })
    ).toThrow();
  });

  test('getShopifyRevenueInput accepts valid params', () => {
    const result = getShopifyRevenueInput.parse({
      date_from: '2026-02-01',
      date_to: '2026-02-28',
    });
    expect(result.date_from).toBe('2026-02-01');
  });

  test('getShopifyProductsInput applies defaults', () => {
    const result = getShopifyProductsInput.parse({
      date_from: '2026-01-01',
      date_to: '2026-01-31',
    });
    expect(result.date_from).toBe('2026-01-01');
  });

  test('getChannelSummaryInput allows missing dates (handler applies defaults)', () => {
    // date_from / date_to are nullable+optional so LLMs that send null or
    // omit them altogether do not trigger a Zod validation error. The handler
    // fills defaults via resolveDateRangeDefaults.
    expect(() => getChannelSummaryInput.parse({})).not.toThrow();
    expect(() => getChannelSummaryInput.parse({ date_from: '2026-01-01' })).not.toThrow();
    expect(() => getChannelSummaryInput.parse({ date_from: null, date_to: null })).not.toThrow();
  });

  test('getAdPerformanceInput accepts null dates', () => {
    expect(() =>
      getAdPerformanceInput.parse({ channel: 'meta', date_from: null, date_to: null })
    ).not.toThrow();
  });

  test('getShopifyRevenueInput accepts omitted dates', () => {
    expect(() => getShopifyRevenueInput.parse({})).not.toThrow();
  });

  test('getDateComparisonInput accepts all channels', () => {
    for (const ch of ['meta', 'google', 'shopify', 'all']) {
      const result = getDateComparisonInput.parse({
        channel: ch,
        period_a_from: '2026-01-01',
        period_a_to: '2026-01-31',
        period_b_from: '2026-02-01',
        period_b_to: '2026-02-28',
      });
      expect(result.channel).toBe(ch);
    }
  });

  test('getAccountInfoInput accepts empty object', () => {
    const result = getAccountInfoInput.parse({});
    expect(result).toEqual({});
  });
});

describe('validateDateRange', () => {
  test('returns null for valid range', () => {
    expect(validateDateRange('2026-01-01', '2026-03-01')).toBeNull();
  });

  test('returns error for reversed dates', () => {
    expect(validateDateRange('2026-03-01', '2026-01-01')).toContain('before');
  });

  test('returns error for range > 365 days', () => {
    expect(validateDateRange('2024-01-01', '2026-01-01')).toContain('365');
  });

  test('returns error for invalid date', () => {
    expect(validateDateRange('not-a-date', '2026-01-01')).toContain('Invalid');
  });
});

describe('resolveDateRangeDefaults', () => {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  test('fills in defaults when both args are null', () => {
    const { date_from, date_to } = resolveDateRangeDefaults(null, null);
    expect(date_from).toMatch(ISO_DATE);
    expect(date_to).toMatch(ISO_DATE);
    expect(date_from < date_to).toBe(true);
  });

  test('fills in defaults when both args are undefined', () => {
    const { date_from, date_to } = resolveDateRangeDefaults(undefined, undefined);
    expect(date_from).toMatch(ISO_DATE);
    expect(date_to).toMatch(ISO_DATE);
  });

  test('defaults date_from relative to explicit date_to', () => {
    const { date_from, date_to } = resolveDateRangeDefaults(null, '2026-03-15');
    expect(date_to).toBe('2026-03-15');
    // 30 days before 2026-03-15 = 2026-02-13
    expect(date_from).toBe('2026-02-13');
  });

  test('defaults date_to to today when date_from is explicit', () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { date_from, date_to } = resolveDateRangeDefaults('2026-01-01', null);
    expect(date_from).toBe('2026-01-01');
    expect(date_to).toBe(todayStr);
  });

  test('passes through when both args are provided', () => {
    const { date_from, date_to } = resolveDateRangeDefaults('2026-01-01', '2026-01-31');
    expect(date_from).toBe('2026-01-01');
    expect(date_to).toBe('2026-01-31');
  });

  test('respects custom fallbackDays', () => {
    const { date_from, date_to } = resolveDateRangeDefaults(null, '2026-03-15', 7);
    expect(date_to).toBe('2026-03-15');
    expect(date_from).toBe('2026-03-08');
  });
});

describe('resolveComparisonDefaults', () => {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  test('fills all four dates when everything is null', () => {
    const out = resolveComparisonDefaults(null, null, null, null);
    expect(out.period_a_from).toMatch(ISO_DATE);
    expect(out.period_a_to).toMatch(ISO_DATE);
    expect(out.period_b_from).toMatch(ISO_DATE);
    expect(out.period_b_to).toMatch(ISO_DATE);
    // period A precedes period B
    expect(out.period_a_to < out.period_b_from).toBe(true);
    // each period is a forward-ordered range
    expect(out.period_a_from < out.period_a_to).toBe(true);
    expect(out.period_b_from < out.period_b_to).toBe(true);
  });

  test('anchors defaults to the most recent known date', () => {
    const out = resolveComparisonDefaults(null, null, null, '2026-03-15');
    expect(out.period_b_to).toBe('2026-03-15');
    // period_b_from = 30 days before period_b_to
    expect(out.period_b_from).toBe('2026-02-13');
    // period_a_to = day before period_b_from
    expect(out.period_a_to).toBe('2026-02-12');
    // period_a_from = 30 days before period_a_to
    expect(out.period_a_from).toBe('2026-01-13');
  });

  test('passes through explicit values', () => {
    const out = resolveComparisonDefaults(
      '2026-01-01',
      '2026-01-31',
      '2026-02-01',
      '2026-02-28'
    );
    expect(out).toEqual({
      period_a_from: '2026-01-01',
      period_a_to: '2026-01-31',
      period_b_from: '2026-02-01',
      period_b_to: '2026-02-28',
    });
  });
});

describe('Error Contract', () => {
  test('createToolError produces correct structure', () => {
    const err = createToolError('ACCOUNT_NOT_CONNECTED', 'get_ad_performance');
    expect(err.error).toBe(true);
    expect(err.error_code).toBe('ACCOUNT_NOT_CONNECTED');
    expect(err.tool).toBe('get_ad_performance');
    expect(err.timestamp).toBeDefined();
    expect(err.resolution).toBeDefined();
  });

  test('createToolError supports extra message', () => {
    const err = createToolError('RATE_LIMITED', 'get_campaign_performance', 'Retry after 60s');
    expect(err.error_message).toContain('Retry after 60s');
  });

  test('createToolErrorResponse wraps in MCP format', () => {
    const resp = createToolErrorResponse('TOKEN_EXPIRED', 'get_shopify_revenue');
    expect(resp.isError).toBe(true);
    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe('text');
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.error_code).toBe('TOKEN_EXPIRED');
  });

  test('createToolResponse wraps data in MCP format', () => {
    const resp = createToolResponse({ spend: 100 });
    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe('text');
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.spend).toBe(100);
  });

  test('all ERROR_CODES have required fields', () => {
    for (const [key, val] of Object.entries(ERROR_CODES)) {
      expect(val.error_code).toBe(key);
      expect(val.error_message).toBeTruthy();
      expect(val.resolution).toBeTruthy();
    }
  });
});
