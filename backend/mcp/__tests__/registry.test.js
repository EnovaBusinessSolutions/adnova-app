'use strict';

const { toolModules } = require('../registry');

describe('Tool Registry', () => {
  test('has exactly 8 tools', () => {
    expect(toolModules).toHaveLength(8);
  });

  test('all tools export a register function', () => {
    for (const mod of toolModules) {
      expect(typeof mod.register).toBe('function');
    }
  });

  test('all tools export TOOL_NAME', () => {
    for (const mod of toolModules) {
      expect(typeof mod.TOOL_NAME).toBe('string');
      expect(mod.TOOL_NAME.length).toBeGreaterThan(0);
    }
  });

  test('tool names match Phase 1 spec', () => {
    const expected = [
      'get_account_info',
      'get_ad_performance',
      'get_campaign_performance',
      'get_adset_performance',
      'get_shopify_revenue',
      'get_shopify_products',
      'get_channel_summary',
      'get_date_comparison',
    ];
    const actual = toolModules.map(m => m.TOOL_NAME).sort();
    expect(actual).toEqual(expected.sort());
  });

  test('no duplicate tool names', () => {
    const names = toolModules.map(m => m.TOOL_NAME);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});
