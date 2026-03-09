
const express = require('express');
const router = express.Router();
const prisma = require('../utils/prismaClient');
const { startOfDay, endOfDay, subDays, eachDayOfInterval, format } = require('date-fns');

const EVENT_BUCKET_ALIASES = {
  page_view: ['page_view', 'pageview', 'view_page'],
  add_to_cart: ['add_to_cart', 'addtocart', 'cart_add'],
  begin_checkout: ['begin_checkout', 'checkout_started', 'start_checkout'],
  purchase: ['purchase', 'order_completed', 'checkout_completed', 'order_create', 'orders_create'],
};

function normalizeEventName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function resolveEventBucket(rawName) {
  const normalized = normalizeEventName(rawName);
  for (const [bucket, aliases] of Object.entries(EVENT_BUCKET_ALIASES)) {
    if (aliases.includes(normalized)) return bucket;
  }
  return 'other';
}

// Use existing sessionGuard from index.js mount, assuming it's available or implemented here?
// The pipeline says "All routes require sessionGuard".
// For now, I'll rely on index.js to wrap this router with sessionGuard.

/**
 * GET /api/analytics/:account_id
 * Returns core dashboard metrics: Revenue, Orders, Attribution Breakdown
 */
router.get('/:account_id', async (req, res) => {
  try {
    const { account_id } = req.params;
    const { start, end } = req.query;

    // Default to last 30 days
    const startDate = start ? startOfDay(new Date(start)) : startOfDay(subDays(new Date(), 30));
    const endDate = end ? endOfDay(new Date(end)) : endOfDay(new Date());

    // 1. Fetch Orders in range
    const orders = await prisma.order.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate }
      },
      select: {
        createdAt: true,
        revenue: true,
        attributedChannel: true,
        orderId: true
      }
    });

    // 2. Fetch Sessions in range (for conversion rate, approximate)
    const sessionCount = await prisma.session.count({
      where: {
        accountId: account_id,
        startedAt: { gte: startDate, lte: endDate }
      }
    });

    // 3. Fetch Events in range (for pixel activity visibility)
    const groupedEvents = await prisma.event.groupBy({
      by: ['eventName'],
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
      },
      _count: {
        _all: true,
      },
    });

    // 4. Aggregate Data
    let totalRevenue = 0;
    let attributedRevenue = 0;
    const channelStats = {
      meta: { revenue: 0, orders: 0 },
      google: { revenue: 0, orders: 0 },
      tiktok: { revenue: 0, orders: 0 },
      other: { revenue: 0, orders: 0 },
      unattributed: { revenue: 0, orders: 0 }
    };

    const eventStats = {
      page_view: 0,
      add_to_cart: 0,
      begin_checkout: 0,
      purchase: 0,
      other: 0,
      total: 0,
    };

    // Daily breakdown map
    const dailyMap = {};
    const interval = eachDayOfInterval({ start: startDate, end: endDate });
    interval.forEach(day => {
       dailyMap[format(day, 'yyyy-MM-dd')] = { date: format(day, 'yyyy-MM-dd'), revenue: 0, orders: 0 };
    });

    orders.forEach(order => {
      const rev = order.revenue || 0;
      totalRevenue += rev;
      
      // Channel normalization
      let ch = (order.attributedChannel || 'unattributed').toLowerCase();
      if (ch === 'facebook' || ch === 'instagram') ch = 'meta';

      if (channelStats[ch]) {
        channelStats[ch].revenue += rev;
        channelStats[ch].orders += 1;
      } else {
        channelStats.other.revenue += rev;
        channelStats.other.orders += 1;
      }

      if (ch !== 'unattributed') {
        attributedRevenue += rev;
      }

      // Daily
      const day = format(new Date(order.createdAt), 'yyyy-MM-dd');
      if (dailyMap[day]) {
        dailyMap[day].revenue += rev;
        dailyMap[day].orders += 1;
      }
    });

    groupedEvents.forEach((row) => {
      const count = row?._count?._all || 0;
      const bucket = resolveEventBucket(row.eventName);
      if (typeof eventStats[bucket] === 'number') eventStats[bucket] += count;
      eventStats.total += count;
    });

    // Purchase events often come via Shopify webhook -> Order table (without Event row).
    // Use the max as a safe dashboard metric that avoids showing 0 when orders exist.
    const purchaseEventsResolved = Math.max(eventStats.purchase, orders.length);

    // 5. Return JSON
    res.json({
      summary: {
        totalRevenue,
        totalOrders: orders.length,
        attributedRevenue,
        attributedOrders: orders.length - channelStats.unattributed.orders,
        totalSessions: sessionCount,
        conversionRate: sessionCount > 0 ? (orders.length / sessionCount) : 0,
        pageViews: eventStats.page_view,
        addToCart: eventStats.add_to_cart,
        beginCheckout: eventStats.begin_checkout,
        purchaseEvents: purchaseEventsResolved,
        purchaseEventsRaw: eventStats.purchase,
        purchaseOrders: orders.length,
        totalEvents: eventStats.total,
      },
      events: eventStats,
      channels: channelStats,
      daily: Object.values(dailyMap) // sorted array by date
    });

  } catch (error) {
    console.error('[Analytics API] Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
