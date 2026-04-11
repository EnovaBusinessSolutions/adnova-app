'use strict';

jest.mock('../../utils/prismaClient', () => ({
  event: { findMany: jest.fn() },
  identityGraph: { findMany: jest.fn() },
  session: { findMany: jest.fn() },
}));

const analyticsRouter = require('../analytics');

const {
  normalizeLineItems,
  finalizeAnalyticsExportEvents,
  normalizeAnalyticsExportPlatformValue,
  resolveAnalyticsExportResolvedAttributionLabel,
  normalizeAnalyticsExportChannelValue,
  formatAnalyticsCsvDecimal,
  reconcileAnalyticsLineItemsToOrderSubtotal,
  resolveAnalyticsJourneyTouchpoint,
} = analyticsRouter.__testables;

describe('analytics export helpers', () => {
  test('normalizeLineItems infers subtotal and total when source payload omits them', () => {
    const items = normalizeLineItems([
      {
        product_id: '41974',
        name: 'BURBUJAS ESPADA 49 CM',
        quantity: 96,
        price: 31.03,
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].subtotal).toBeCloseTo(2978.88, 2);
    expect(items[0].lineTotal).toBeCloseTo(2978.88, 2);
  });

  test('reconcileAnalyticsLineItemsToOrderSubtotal adjusts minor rounding delta to match order subtotal', () => {
    const reconciled = reconcileAnalyticsLineItemsToOrderSubtotal(
      { subtotal: 10101.65 },
      normalizeLineItems([
        { product_id: '41974', quantity: 96, price: 31.03, name: 'A' },
        { product_id: '41910', quantity: 96, price: 31.03, name: 'B' },
        { product_id: '65490', quantity: 96, price: 31.03, name: 'C' },
        { product_id: '39728', quantity: 13, price: 26.39, name: 'D' },
        { product_id: '43983', quantity: 32, price: 25.65, name: 'E' },
      ])
    );

    const total = reconciled.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    expect(total).toBeCloseTo(10101.65, 2);
  });

  test('formatAnalyticsCsvDecimal removes floating point artifacts for money columns', () => {
    expect(formatAnalyticsCsvDecimal(26137.35000000002)).toBe('26137.35');
    expect(formatAnalyticsCsvDecimal('30319.36')).toBe('30319.36');
    expect(formatAnalyticsCsvDecimal(null)).toBeNull();
  });

  test('finalizeAnalyticsExportEvents keeps one canonical purchase event', () => {
    const purchase = {
      orderId: '66542',
      checkoutToken: 'token-1',
      sessionId: 'session-main',
      revenue: 11717.91,
      currency: 'MXN',
      platformCreatedAt: '2026-04-10T21:19:54.000Z',
      createdAt: '2026-04-10T21:19:56.000Z',
    };

    const events = finalizeAnalyticsExportEvents([
      {
        eventId: 'pv-1',
        eventName: 'page_view',
        createdAt: '2026-04-10T21:16:51.000Z',
        sessionId: 'session-main',
        pageUrl: 'https://shogun.mx/',
        rawSource: 'pixel',
      },
      {
        eventId: 'purchase-server',
        eventName: 'purchase',
        createdAt: '2026-04-10T21:19:55.000Z',
        sessionId: 'session-side',
        orderId: '66542',
        checkoutToken: 'token-1',
        pageUrl: 'https://shogun.mx/checkout-2/order-received/66542/',
        rawSource: 'plugin_server',
        matchType: 'probabilistic',
        confidenceScore: 0.6,
      },
      {
        eventId: 'purchase-sync',
        eventName: 'purchase',
        createdAt: '2026-04-10T21:19:56.000Z',
        sessionId: 'session-main',
        orderId: '66542',
        checkoutToken: 'token-1',
        rawSource: 'plugin_order_sync',
        matchType: 'deterministic',
        confidenceScore: 0.75,
      },
      {
        eventId: 'purchase-pixel',
        eventName: 'purchase',
        createdAt: '2026-04-10T21:20:02.000Z',
        sessionId: 'session-main',
        orderId: '66542',
        checkoutToken: 'token-1',
        pageUrl: 'https://shogun.mx/checkout-2/order-received/66542/',
        rawSource: 'pixel',
        matchType: 'deterministic',
        confidenceScore: 0.98,
      },
    ], purchase);

    const purchaseEvents = events.filter((event) => event.eventName === 'purchase');
    expect(purchaseEvents).toHaveLength(1);
    expect(purchaseEvents[0].eventId).toBe('purchase-pixel');
    expect(events[events.length - 1].eventId).toBe('purchase-pixel');
  });

  test('finalizeAnalyticsExportEvents trims post-purchase noise from the exported journey', () => {
    const purchase = {
      orderId: '66542',
      checkoutToken: 'token-1',
      sessionId: 'session-main',
      revenue: 11717.91,
      currency: 'MXN',
      platformCreatedAt: '2026-04-10T21:19:54.000Z',
      createdAt: '2026-04-10T21:19:56.000Z',
    };

    const events = finalizeAnalyticsExportEvents([
      {
        eventId: 'pv-1',
        eventName: 'page_view',
        createdAt: '2026-04-10T21:16:51.000Z',
        sessionId: 'session-main',
        pageUrl: 'https://shogun.mx/',
        rawSource: 'pixel',
      },
      {
        eventId: 'purchase-pixel',
        eventName: 'purchase',
        createdAt: '2026-04-10T21:20:02.000Z',
        sessionId: 'session-main',
        orderId: '66542',
        checkoutToken: 'token-1',
        pageUrl: 'https://shogun.mx/checkout-2/order-received/66542/',
        rawSource: 'pixel',
        matchType: 'deterministic',
        confidenceScore: 0.98,
      },
      {
        eventId: 'post-1',
        eventName: 'begin_checkout',
        createdAt: '2026-04-10T21:21:43.000Z',
        sessionId: 'session-main',
        pageUrl: 'https://shogun.mx/checkout-2/',
        rawSource: 'pixel',
      },
    ], purchase);

    expect(events.map((event) => event.eventId)).toEqual(['pv-1', 'purchase-pixel']);
  });

  test('finalizeAnalyticsExportEvents injects a synthetic purchase anchor when none exists', () => {
    const purchase = {
      orderId: '66541',
      sessionId: 'session-1',
      createdAt: '2026-04-10T20:34:41.000Z',
      platformCreatedAt: '2026-04-10T20:34:41.000Z',
      revenue: 30319.36,
      currency: 'MXN',
    };

    const events = finalizeAnalyticsExportEvents([
      {
        eventId: 'evt-1',
        eventName: 'page_view',
        createdAt: '2026-04-10T20:10:21.000Z',
        sessionId: 'session-1',
        pageUrl: 'https://shogun.mx/',
        rawSource: 'pixel',
      },
      {
        eventId: 'evt-2',
        eventName: 'add_to_cart',
        createdAt: '2026-04-10T20:34:41.000Z',
        sessionId: 'session-1',
        pageUrl: 'https://shogun.mx/categoria/juguetes/nino/page/4/',
        rawSource: 'pixel',
      },
    ], purchase);

    const purchaseEvents = events.filter((event) => event.eventName === 'purchase');
    expect(purchaseEvents).toHaveLength(1);
    expect(purchaseEvents[0].rawSource).toBe('order_anchor');
    expect(purchaseEvents[0].sessionId).toBe('session-1');
  });

  test('export attribution helpers normalize organic google fallback cleanly', () => {
    const purchase = {
      attributedChannel: 'google',
      attributedPlatform: 'Orgánico: Google',
      wooSourceType: 'organic',
      wooSourceLabel: 'Orgánico: Google',
      attributedCampaign: '/',
      attributedCampaignLabel: '/',
    };

    expect(normalizeAnalyticsExportChannelValue(purchase)).toBe('organic');
    expect(normalizeAnalyticsExportPlatformValue(purchase.attributedPlatform, purchase.wooSourceLabel)).toBe('google');
    expect(resolveAnalyticsExportResolvedAttributionLabel(purchase)).toBe('Google Organic');
  });

  test('resolveAnalyticsJourneyTouchpoint ignores self-referrers for the session export', () => {
    const touchpoint = resolveAnalyticsJourneyTouchpoint({
      event: {
        pageUrl: 'https://shogun.mx/',
        referrer: 'https://shogun.mx/',
        fbc: 'fb.1.abc',
      },
      purchase: {
        attributedChannel: 'meta',
        attributedPlatform: 'meta',
      },
    });

    expect(touchpoint.referrerLabel).toBe('');
    expect(touchpoint.label).toBe('Meta Ads');
  });
});
