const prisma = require('../utils/prismaClient');

/**
 * Updates the 30-day analytics snapshot for the merchant
 * Used as context for LLM audits
 * @param {string} accountId 
 */
async function updateSnapshot(accountId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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

    // 3. Build snapshot JSON
    const snapshot = {
      period: 'last_30_days',
      generatedAt: new Date().toISOString(),
      orderMetrics: {
        totalRevenue,
        orderCount,
        aov: orderCount > 0 ? (totalRevenue / orderCount).toFixed(2) : 0,
        unattributedRate: orderCount > 0 ? (unattributedCount / orderCount).toFixed(2) : 0
      },
      revenueByChannel,
      confidenceDistribution,
      funnel
    };

    // 4. Save to DB
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
