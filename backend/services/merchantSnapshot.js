const prisma = require('../utils/prismaClient');

/**
 * Updates the 30-day analytics snapshot for the merchant
 * Used as context for LLM audits
 * @param {string} accountId 
 */
async function updateSnapshot(accountId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const purchaseAliases = ['purchase', 'order_completed', 'checkout_completed', 'order_create', 'orders_create'];

  try {
    // 1. Order metrics
    const orders = await prisma.order.findMany({
      where: {
        accountId: accountId,
        createdAt: { gte: thirtyDaysAgo }
      },
      select: {
        revenue: true,
        attributedChannel: true,
        confidenceScore: true,
        lineItems: true
      }
    });

    let totalRevenue = 0;
    const orderCount = orders.length;
    const revenueByChannel = {};
    let unattributedCount = 0;
    const productMap = new Map();
    const confidenceDistribution = {
      high: 0,   // >= 0.85
      medium: 0, // 0.6 - 0.84
      low: 0,    // < 0.6 & > 0
      none: 0    // 0
    };

    orders.forEach(o => {
      totalRevenue += o.revenue;

      // Channel breakdown
      const channel = o.attributedChannel || 'unattributed';
      revenueByChannel[channel] = (revenueByChannel[channel] || 0) + o.revenue;
      
      if (channel === 'unattributed') unattributedCount++;

      // Confidence distribution
      const score = o.confidenceScore || 0;
      if (score >= 0.85) confidenceDistribution.high++;
      else if (score >= 0.6) confidenceDistribution.medium++;
      else if (score > 0) confidenceDistribution.low++;
      else confidenceDistribution.none++;

      // Top products by revenue
      const items = Array.isArray(o.lineItems) ? o.lineItems : [];
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

    // 2. Funnel metrics (from Events)
    const funnelCounts = await prisma.event.groupBy({
      by: ['eventName'],
      where: {
        accountId: accountId,
        createdAt: { gte: thirtyDaysAgo }
      },
      _count: {
        eventName: true
      }
    });

    const funnel = {};
    funnelCounts.forEach(f => {
      funnel[f.eventName] = f._count.eventName;
    });

    // 3. Pixel health metrics
    const totalEventsReceived = await prisma.event.count({
      where: {
        accountId,
        createdAt: { gte: thirtyDaysAgo }
      }
    });

    const purchaseEventsRaw = await prisma.event.count({
      where: {
        accountId,
        createdAt: { gte: thirtyDaysAgo },
        eventName: { in: purchaseAliases }
      }
    });

    const purchaseEventOrderIds = await prisma.event.findMany({
      where: {
        accountId,
        createdAt: { gte: thirtyDaysAgo },
        eventName: { in: purchaseAliases },
        orderId: { not: null }
      },
      select: { orderId: true },
      distinct: ['orderId']
    });

    const matchedOrderIds = purchaseEventOrderIds.map((x) => x.orderId).filter(Boolean);
    const matchedOrders = matchedOrderIds.length
      ? await prisma.order.count({
          where: {
            accountId,
            createdAt: { gte: thirtyDaysAgo },
            orderId: { in: matchedOrderIds }
          }
        })
      : 0;

    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // 4. Build snapshot JSON
    const snapshot = {
      period: 'last_30_days',
      generatedAt: new Date().toISOString(),
      orderMetrics: {
        totalRevenue,
        orderCount,
        aov: orderCount > 0 ? (totalRevenue / orderCount).toFixed(2) : 0,
        unattributedCount,
        unattributedRate: orderCount > 0 ? (unattributedCount / orderCount).toFixed(2) : 0
      },
      revenueByChannel,
      confidenceDistribution,
      funnel,
      topProducts,
      pixelHealth: {
        eventsReceived: totalEventsReceived,
        purchaseSignals: purchaseEventsRaw,
        orders: orderCount,
        matchedOrders,
        orderMatchRate: orderCount > 0 ? Number((matchedOrders / orderCount).toFixed(4)) : 0,
        purchaseSignalCoverage: orderCount > 0 ? Number((purchaseEventsRaw / orderCount).toFixed(4)) : 0
      }
    };

    // 5. Save to DB
    await prisma.merchantSnapshot.upsert({
      where: { accountId },
      update: { snapshot },
      create: {
        accountId,
        snapshot
      }
    });

    return snapshot;

  } catch (err) {
    console.error(`Error updating snapshot for ${accountId}:`, err);
    throw err;
  }
}

module.exports = {
  updateSnapshot
};
