
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

const PURCHASE_ALIASES = EVENT_BUCKET_ALIASES.purchase;
const ATTRIBUTION_MODELS = new Set(['first_touch', 'last_touch', 'linear']);
const ATTRIBUTION_LOOKBACK_DAYS = 30;

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

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch (_) {
    return null;
  }
}

function stitchSnapshotAttribution(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
  }

  if (snapshot.fbclid) {
    return {
      channel: 'paid_social',
      platform: 'facebook',
      clickId: snapshot.fbclid,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  if (snapshot.gclid) {
    return {
      channel: 'paid_search',
      platform: 'google',
      clickId: snapshot.gclid,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  if (snapshot.ttclid) {
    return {
      channel: 'paid_social',
      platform: 'tiktok',
      clickId: snapshot.ttclid,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  if (snapshot.utm_source) {
    return {
      channel: snapshot.utm_medium || 'referral',
      platform: snapshot.utm_source,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 0.85,
      source: 'utm',
    };
  }

  if (snapshot.referrer) {
    const domain = getDomain(snapshot.referrer);
    if (!domain) {
      return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
    }
    if (['google.com', 'bing.com', 'yahoo.com'].some((d) => domain.includes(d))) {
      return { channel: 'organic_search', platform: domain, confidence: 0.7, source: 'referrer' };
    }
    if (['facebook.com', 'instagram.com', 't.co', 'twitter.com'].some((d) => domain.includes(d))) {
      return { channel: 'organic_social', platform: domain, confidence: 0.7, source: 'referrer' };
    }
    return { channel: 'referral', platform: domain, confidence: 0.7, source: 'referrer' };
  }

  return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
}

function normalizeChannelForStats(channelRaw) {
  let ch = String(channelRaw || 'unattributed').toLowerCase();
  if (ch === 'facebook' || ch === 'instagram' || ch === 'paid_social') ch = 'meta';
  if (ch === 'paid_search') ch = 'google';
  if (ch !== 'meta' && ch !== 'google' && ch !== 'tiktok' && ch !== 'unattributed') ch = 'other';
  return ch;
}

function normalizeLineItems(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr.map((item) => ({
    id: String(item?.product_id || item?.productId || item?.id || item?.variant_id || item?.variantId || ''),
    name: String(item?.name || item?.title || 'Producto'),
    quantity: Number(item?.quantity || item?.qty || 1),
    price: Number(item?.price || item?.unit_price || item?.unitPrice || 0),
    lineTotal: Number(
      item?.line_total ?? item?.lineTotal ?? item?.total ?? item?.final_line_price ?? item?.finalLinePrice ?? 0
    ),
  }));
}

function toSnapshotFromSession(session) {
  if (!session) return null;
  return {
    utm_source: session.utmSource || null,
    utm_medium: session.utmMedium || null,
    utm_campaign: session.utmCampaign || null,
    utm_content: session.utmContent || null,
    utm_term: session.utmTerm || null,
    referrer: session.referrer || null,
    fbclid: session.fbclid || null,
    gclid: session.gclid || null,
    ttclid: session.ttclid || null,
  };
}

function buildAttributionTouchpoints({ snapshots = [], sessions = [] }) {
  const touchpoints = [];

  snapshots.forEach((snap) => {
    const attribution = stitchSnapshotAttribution(snap.snapshot || {});
    touchpoints.push({
      timestamp: new Date(snap.timestamp),
      attribution,
      source: snap.source || 'checkout_snapshot',
    });
  });

  sessions.forEach((session) => {
    const attribution = stitchSnapshotAttribution(toSnapshotFromSession(session) || {});
    touchpoints.push({
      timestamp: new Date(session.startedAt),
      attribution,
      source: 'session',
      isFirstTouch: Boolean(session.isFirstTouch),
    });
  });

  return touchpoints
    .filter((tp) => tp.timestamp && !Number.isNaN(tp.timestamp.getTime()))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function resolveConversionAttribution({ model, touchpoints }) {
  const valid = touchpoints.filter((tp) => {
    const ch = normalizeChannelForStats(tp?.attribution?.channel);
    return ch !== 'unattributed';
  });

  if (valid.length === 0) {
    return {
      primary: { channel: 'unattributed', platform: null, confidence: 0, source: 'none' },
      splits: [{ channel: 'unattributed', weight: 1 }],
      isAttributed: false,
    };
  }

  if (model === 'first_touch') {
    const first = valid[0].attribution;
    const channel = normalizeChannelForStats(first.channel);
    return {
      primary: {
        channel,
        platform: first.platform || null,
        confidence: Number(first.confidence || 0),
        source: first.source || 'first_touch',
      },
      splits: [{ channel, weight: 1 }],
      isAttributed: true,
    };
  }

  if (model === 'linear') {
    const perTouch = 1 / valid.length;
    const splitMap = new Map();
    valid.forEach((tp) => {
      const ch = normalizeChannelForStats(tp.attribution.channel);
      splitMap.set(ch, Number(splitMap.get(ch) || 0) + perTouch);
    });

    const last = valid[valid.length - 1].attribution;
    const splits = Array.from(splitMap.entries()).map(([channel, weight]) => ({
      channel,
      weight,
    }));

    return {
      primary: {
        channel: 'multi_touch',
        platform: last.platform || null,
        confidence: Number(last.confidence || 0),
        source: 'linear',
      },
      splits,
      isAttributed: true,
    };
  }

  const last = valid[valid.length - 1].attribution;
  const channel = normalizeChannelForStats(last.channel);
  return {
    primary: {
      channel,
      platform: last.platform || null,
      confidence: Number(last.confidence || 0),
      source: last.source || 'last_touch',
    },
    splits: [{ channel, weight: 1 }],
    isAttributed: true,
  };
}

function conversionPriorityScore(conv) {
  let score = 0;
  if (conv.isAttributed) score += 100;
  score += Number(conv.attributionConfidence || 0) * 10;
  if (conv.userKey) score += 2;
  if (conv.checkoutToken) score += 2;
  if (conv.orderId) score += 2;
  return score;
}

function dedupeEventConversions(conversions) {
  const byKey = new Map();

  conversions.forEach((conv) => {
    const key = conv.orderId
      ? `order:${conv.orderId}`
      : conv.checkoutToken
        ? `checkout:${conv.checkoutToken}`
        : `fallback:${new Date(conv.createdAt).toISOString()}:${conv.revenue}:${conv.userKey || ''}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, conv);
      return;
    }

    const currentScore = conversionPriorityScore(conv);
    const existingScore = conversionPriorityScore(existing);
    if (currentScore > existingScore) {
      byKey.set(key, conv);
      return;
    }

    if (currentScore === existingScore && new Date(conv.createdAt) > new Date(existing.createdAt)) {
      byKey.set(key, conv);
    }
  });

  return Array.from(byKey.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
    const requestedModelRaw = String(req.query.attribution_model || req.query.attributionModel || 'last_touch').toLowerCase();
    const attributionModel = ATTRIBUTION_MODELS.has(requestedModelRaw) ? requestedModelRaw : 'last_touch';

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
        currency: true,
        attributedChannel: true,
        checkoutToken: true,
        userKey: true,
        orderId: true,
        orderNumber: true,
        lineItems: true
      },
      orderBy: { createdAt: 'desc' }
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

    // Revenue fallback for sources that only send browser/server purchase events
    // but do not yet sync orders into the orders table (e.g., early WooCommerce setup).
    const purchaseRevenueAgg = await prisma.event.aggregate({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
        eventName: { in: PURCHASE_ALIASES },
      },
      _sum: {
        revenue: true,
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
    const productMap = new Map();

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

      // Top products by revenue
      const items = Array.isArray(order.lineItems) ? order.lineItems : [];
      items.forEach((item) => {
        const id = String(item?.product_id || item?.productId || item?.id || item?.variant_id || item?.variantId || 'unknown');
        const name = String(item?.name || item?.title || 'Unknown Product');
        const qty = Number(item?.quantity || item?.qty || 1);
        const unitPrice = Number(item?.price || item?.unit_price || item?.unitPrice || 0);
        const lineRevenueRaw =
          item?.line_total ?? item?.lineTotal ?? item?.total ?? item?.final_line_price ?? item?.finalLinePrice;
        const lineRevenue = Number.isFinite(Number(lineRevenueRaw))
          ? Number(lineRevenueRaw)
          : (Number.isFinite(unitPrice) ? unitPrice * (Number.isFinite(qty) ? qty : 1) : 0);

        const key = `${id}::${name}`;
        const current = productMap.get(key) || { id, name, units: 0, revenue: 0, orderCount: 0 };
        current.units += Number.isFinite(qty) ? qty : 1;
        current.revenue += Number.isFinite(lineRevenue) ? lineRevenue : 0;
        current.orderCount += 1;
        productMap.set(key, current);
      });
    });

    groupedEvents.forEach((row) => {
      const count = row?._count?._all || 0;
      const bucket = resolveEventBucket(row.eventName);
      if (typeof eventStats[bucket] === 'number') eventStats[bucket] += count;
      eventStats.total += count;
    });

    const purchaseEventOrderIds = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
        eventName: { in: PURCHASE_ALIASES },
        orderId: { not: null },
      },
      select: { orderId: true },
      distinct: ['orderId'],
    });

    const purchaseOrderIds = purchaseEventOrderIds.map((x) => x.orderId).filter(Boolean);
    const matchedOrders = purchaseOrderIds.length
      ? await prisma.order.count({
          where: {
            accountId: account_id,
            createdAt: { gte: startDate, lte: endDate },
            orderId: { in: purchaseOrderIds },
          },
        })
      : 0;

    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const purchaseEventsDetailed = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
        eventName: { in: PURCHASE_ALIASES },
      },
      select: {
        createdAt: true,
        orderId: true,
        checkoutToken: true,
        userKey: true,
        revenue: true,
        currency: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const purchaseEventsForModel = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
        eventName: { in: PURCHASE_ALIASES },
      },
      select: {
        createdAt: true,
        orderId: true,
        checkoutToken: true,
        userKey: true,
        revenue: true,
        currency: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const conversionInputsFromOrders = orders.map((order) => ({
      source: 'orders',
      createdAt: order.createdAt,
      orderId: order.orderId,
      orderNumber: order.orderNumber || null,
      checkoutToken: order.checkoutToken || null,
      userKey: order.userKey || null,
      revenue: Number(order.revenue || 0),
      currency: order.currency || 'MXN',
      items: normalizeLineItems(order.lineItems),
      orderAttributedChannel: order.attributedChannel || null,
    }));

    const conversionInputsFromEvents = purchaseEventsForModel.map((ev) => ({
      source: 'events',
      createdAt: ev.createdAt,
      orderId: ev.orderId || null,
      orderNumber: null,
      checkoutToken: ev.checkoutToken || null,
      userKey: ev.userKey || null,
      revenue: Number(ev.revenue || 0),
      currency: ev.currency || 'MXN',
      items: [],
    }));

    const conversionInputs = (orders.length > 0 ? conversionInputsFromOrders : conversionInputsFromEvents);

    const checkoutTokens = Array.from(new Set(conversionInputs.map((c) => c.checkoutToken).filter(Boolean)));
    const userKeys = Array.from(new Set(conversionInputs.map((c) => c.userKey).filter(Boolean)));

    const [checkoutSnapshots, relevantSessions] = await Promise.all([
      checkoutTokens.length > 0
        ? prisma.checkoutSessionMap.findMany({
            where: {
              accountId: account_id,
              checkoutToken: { in: checkoutTokens },
            },
            select: {
              checkoutToken: true,
              attributionSnapshot: true,
              createdAt: true,
              userKey: true,
            },
          })
        : Promise.resolve([]),
      userKeys.length > 0
        ? prisma.session.findMany({
            where: {
              accountId: account_id,
              userKey: { in: userKeys },
              startedAt: {
                lte: endDate,
                gte: subDays(startDate, ATTRIBUTION_LOOKBACK_DAYS),
              },
            },
            select: {
              userKey: true,
              startedAt: true,
              isFirstTouch: true,
              utmSource: true,
              utmMedium: true,
              utmCampaign: true,
              utmContent: true,
              utmTerm: true,
              referrer: true,
              fbclid: true,
              gclid: true,
              ttclid: true,
            },
            orderBy: { startedAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const checkoutByToken = new Map(checkoutSnapshots.map((m) => [m.checkoutToken, m]));
    const sessionsByUserKey = new Map();
    relevantSessions.forEach((s) => {
      if (!sessionsByUserKey.has(s.userKey)) sessionsByUserKey.set(s.userKey, []);
      sessionsByUserKey.get(s.userKey).push(s);
    });

    const conversionsWithAttribution = conversionInputs.map((conv) => {
      const checkout = conv.checkoutToken ? checkoutByToken.get(conv.checkoutToken) : null;
      const resolvedUserKey = conv.userKey || checkout?.userKey || null;
      const conversionDate = new Date(conv.createdAt);
      const lookbackStart = subDays(conversionDate, ATTRIBUTION_LOOKBACK_DAYS);

      const snapshots = [];
      if (conv.orderAttributedChannel) {
        snapshots.push({
          snapshot: { utm_source: conv.orderAttributedChannel, utm_medium: conv.orderAttributedChannel },
          timestamp: conv.createdAt,
          source: 'order_snapshot',
        });
      }
      if (checkout?.attributionSnapshot) {
        snapshots.push({
          snapshot: checkout.attributionSnapshot,
          timestamp: checkout.createdAt || conv.createdAt,
          source: 'checkout_snapshot',
        });
      }

      const sessions = resolvedUserKey
        ? (sessionsByUserKey.get(resolvedUserKey) || []).filter(
            (s) => new Date(s.startedAt) <= conversionDate && new Date(s.startedAt) >= lookbackStart
          )
        : [];

      const touchpoints = buildAttributionTouchpoints({ snapshots, sessions });
      const attribution = resolveConversionAttribution({ model: attributionModel, touchpoints });

      return {
        ...conv,
        attributedChannel: attribution.primary.channel,
        attributedPlatform: attribution.primary.platform,
        attributionConfidence: attribution.primary.confidence,
        attributionSource: attribution.primary.source,
        attributionModel,
        attributionSplits: attribution.splits,
        isAttributed: attribution.isAttributed,
      };
    });

    const detailedByKey = new Map(
      purchaseEventsDetailed.map((ev) => {
        const key = `${ev.orderId || ''}::${ev.checkoutToken || ''}::${new Date(ev.createdAt).toISOString()}`;
        return [key, ev];
      })
    );

    const modeledConversions = orders.length > 0
      ? conversionsWithAttribution
      : dedupeEventConversions(conversionsWithAttribution);

    const recentPurchases = modeledConversions.slice(0, 50).map((conv) => {
      if (conv.source === 'orders') return conv;
      const key = `${conv.orderId || ''}::${conv.checkoutToken || ''}::${new Date(conv.createdAt).toISOString()}`;
      const detailed = detailedByKey.get(key);
      return {
        ...conv,
        items: detailed ? normalizeLineItems(detailed.items) : conv.items,
      };
    }).slice(0, 15);

    // Recompute channel stats by selected attribution model over resolved conversions.
    Object.keys(channelStats).forEach((key) => {
      channelStats[key].revenue = 0;
      channelStats[key].orders = 0;
    });

    let modeledAttributedRevenue = 0;
    let modeledUnattributedRevenue = 0;
    let modeledAttributedOrders = 0;
    let modeledUnattributedOrders = 0;

    modeledConversions.forEach((conv) => {
      const rev = Number(conv.revenue || 0);
      const splits = Array.isArray(conv.attributionSplits) && conv.attributionSplits.length > 0
        ? conv.attributionSplits
        : [{ channel: 'unattributed', weight: 1 }];

      splits.forEach((split) => {
        const ch = normalizeChannelForStats(split.channel);
        const weight = Number(split.weight || 0);
        const revenueShare = rev * weight;

        if (!channelStats[ch]) {
          channelStats.other.revenue += revenueShare;
          channelStats.other.orders += weight;
        } else {
          channelStats[ch].revenue += revenueShare;
          channelStats[ch].orders += weight;
        }
      });

      if (conv.isAttributed) {
        modeledAttributedRevenue += rev;
        modeledAttributedOrders += 1;
      } else {
        modeledUnattributedRevenue += rev;
        modeledUnattributedOrders += 1;
      }
    });

    attributedRevenue = modeledAttributedRevenue;
    channelStats.unattributed.revenue = modeledUnattributedRevenue;
    channelStats.unattributed.orders = modeledUnattributedOrders;

    // Purchase events often come via Shopify webhook -> Order table (without Event row).
    // Use the max as a safe dashboard metric that avoids showing 0 when orders exist.
    const modeledEventOrders = orders.length > 0 ? eventStats.purchase : modeledConversions.length;
    const purchaseEventsResolved = Math.max(modeledEventOrders, orders.length);
    const totalOrdersResolved = orders.length > 0 ? orders.length : modeledConversions.length;
    const purchaseRevenueFromEvents = Number(purchaseRevenueAgg?._sum?.revenue || 0);
    const purchaseRevenueFromEventsModeled = orders.length > 0
      ? purchaseRevenueFromEvents
      : modeledConversions.reduce((acc, conv) => acc + Number(conv.revenue || 0), 0);
    const totalRevenueResolved = orders.length > 0 ? totalRevenue : purchaseRevenueFromEventsModeled;

    // 5. Return JSON
    res.json({
      summary: {
        totalRevenue: totalRevenueResolved,
        totalRevenueOrders: totalRevenue,
        totalRevenueEvents: purchaseRevenueFromEventsModeled,
        revenueSource: orders.length > 0 ? 'orders' : 'events',
        totalOrders: totalOrdersResolved,
        attributedRevenue,
        attributedOrders: modeledAttributedOrders,
        unattributedOrders: channelStats.unattributed.orders,
        unattributedRevenue: channelStats.unattributed.revenue,
        attributionModel,
        totalSessions: sessionCount,
        conversionRate: sessionCount > 0 ? (totalOrdersResolved / sessionCount) : 0,
        pageViews: eventStats.page_view,
        addToCart: eventStats.add_to_cart,
        beginCheckout: eventStats.begin_checkout,
        purchaseEvents: purchaseEventsResolved,
        purchaseEventsRaw: eventStats.purchase,
        purchaseOrders: totalOrdersResolved,
        totalEvents: eventStats.total,
      },
      events: eventStats,
      pixelHealth: {
        eventsReceived: eventStats.total,
        purchaseSignals: eventStats.purchase,
        orders: orders.length,
        matchedOrders,
        orderMatchRate: orders.length > 0 ? Number((matchedOrders / orders.length).toFixed(4)) : 0,
        purchaseSignalCoverage: orders.length > 0 ? Number((eventStats.purchase / orders.length).toFixed(4)) : 0,
      },
      channels: channelStats,
      topProducts,
      recentPurchases,
      daily: Object.values(dailyMap) // sorted array by date
    });

  } catch (error) {
    console.error('[Analytics API] Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
