'use strict';

/**
 * WooCommerce Data Collector for ADRAY Audits
 * 
 * Collects order, product, customer, and coupon data from MongoDB
 * for use in the AI-powered audit generation pipeline.
 */

const WooCommerceData = require('../../models/WooCommerceData');
const WooConnections = require('../../models/WooConnections');

/**
 * Collect WooCommerce data for a user
 * 
 * @param {string} userId - The ADRAY user ID
 * @returns {Object|null} - Collected data snapshot or null if no data
 */
async function collectWooCommerceData(userId) {
    try {
        // Find the user's WooCommerce connection
        const connection = await WooConnections.findOne({ matchedToUserId: userId });

        if (!connection) {
            console.log('[WOO_COLLECTOR] No WooCommerce connection for user:', userId);
            return null;
        }

        // Get the stored webhook data
        const wooData = await WooCommerceData.findOne({ userId });

        if (!wooData || (wooData.orders.length === 0 && wooData.products.length === 0)) {
            console.log('[WOO_COLLECTOR] No WooCommerce data for user:', userId);
            return null;
        }

        // Compute fresh stats
        wooData.computeStats();
        await wooData.save();

        // Build the snapshot for audit processing
        const snapshot = buildSnapshot(wooData, connection);

        console.log('[WOO_COLLECTOR] Collected data for', connection.shop, {
            orders: snapshot.orders.length,
            products: snapshot.products.length,
            customers: snapshot.customers.length,
            revenue: snapshot.summary.totalRevenue
        });

        return snapshot;

    } catch (err) {
        console.error('[WOO_COLLECTOR] Error collecting data:', err);
        return null;
    }
}

/**
 * Build a structured snapshot for the audit LLM
 */
function buildSnapshot(wooData, connection) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Filter recent orders
    const recentOrders = wooData.orders.filter(o =>
        o.date_created && new Date(o.date_created) >= thirtyDaysAgo
    );
    const weeklyOrders = recentOrders.filter(o =>
        o.date_created && new Date(o.date_created) >= sevenDaysAgo
    );

    // Calculate order metrics
    const totalRevenue30d = recentOrders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
    const totalRevenue7d = weeklyOrders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
    const avgOrderValue = recentOrders.length > 0 ? totalRevenue30d / recentOrders.length : 0;

    // Product analysis
    const productsOnSale = wooData.products.filter(p => p.on_sale);
    const lowStockProducts = wooData.products.filter(p =>
        p.stock_status === 'instock' && p.stock_quantity !== null && p.stock_quantity < 5
    );
    const outOfStock = wooData.products.filter(p => p.stock_status === 'outofstock');

    // Order status breakdown
    const ordersByStatus = {};
    recentOrders.forEach(o => {
        ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1;
    });

    // Payment method breakdown
    const ordersByPayment = {};
    recentOrders.forEach(o => {
        const method = o.payment_method_title || o.payment_method || 'Unknown';
        ordersByPayment[method] = (ordersByPayment[method] || 0) + 1;
    });

    // Customer location breakdown
    const ordersByCountry = {};
    recentOrders.forEach(o => {
        const country = o.billing_country || 'Unknown';
        ordersByCountry[country] = (ordersByCountry[country] || 0) + 1;
    });

    // Top products by frequency in orders
    const productFrequency = {};
    recentOrders.forEach(o => {
        (o.line_items || []).forEach(li => {
            const key = li.product_id || li.name;
            if (!productFrequency[key]) {
                productFrequency[key] = {
                    name: li.name,
                    count: 0,
                    revenue: 0,
                    sku: li.sku
                };
            }
            productFrequency[key].count += li.quantity || 1;
            productFrequency[key].revenue += parseFloat(li.total || 0);
        });
    });
    const topProducts = Object.values(productFrequency)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

    // Coupon usage
    const couponUsage = {};
    recentOrders.forEach(o => {
        (o.coupon_lines || []).forEach(c => {
            couponUsage[c.code] = (couponUsage[c.code] || 0) + 1;
        });
    });

    // Customer metrics
    const repeatCustomers = {};
    recentOrders.forEach(o => {
        if (o.customer_id && o.customer_id > 0) {
            repeatCustomers[o.customer_id] = (repeatCustomers[o.customer_id] || 0) + 1;
        }
    });
    const repeatRate = Object.values(repeatCustomers).filter(c => c > 1).length /
        Math.max(Object.keys(repeatCustomers).length, 1);

    return {
        platform: 'woocommerce',
        shop: connection.shop,
        collectedAt: new Date().toISOString(),
        dataRange: {
            from: thirtyDaysAgo.toISOString(),
            to: now.toISOString()
        },

        summary: {
            totalOrders30d: recentOrders.length,
            totalOrders7d: weeklyOrders.length,
            totalRevenue30d: Math.round(totalRevenue30d * 100) / 100,
            totalRevenue7d: Math.round(totalRevenue7d * 100) / 100,
            avgOrderValue: Math.round(avgOrderValue * 100) / 100,
            totalProducts: wooData.products.length,
            totalCustomers: wooData.customers.length,
            repeatCustomerRate: Math.round(repeatRate * 100) / 100
        },

        orders: recentOrders.slice(0, 100).map(o => ({
            id: o.woo_id,
            status: o.status,
            total: o.total,
            currency: o.currency,
            paymentMethod: o.payment_method_title || o.payment_method,
            itemCount: (o.line_items || []).length,
            country: o.billing_country,
            date: o.date_created
        })),

        products: wooData.products.slice(0, 50).map(p => ({
            id: p.woo_id,
            name: p.name,
            sku: p.sku,
            price: p.price,
            regularPrice: p.regular_price,
            salePrice: p.sale_price,
            onSale: p.on_sale,
            stockStatus: p.stock_status,
            stockQty: p.stock_quantity,
            totalSales: p.total_sales,
            categories: (p.categories || []).map(c => c.name)
        })),

        customers: wooData.customers.slice(0, 50).map(c => ({
            id: c.woo_id,
            ordersCount: c.orders_count,
            totalSpent: c.total_spent,
            country: c.billing_country
        })),

        analysis: {
            ordersByStatus,
            ordersByPayment,
            ordersByCountry,
            topProducts,
            couponUsage,
            productsOnSale: productsOnSale.length,
            lowStockProducts: lowStockProducts.map(p => ({ name: p.name, qty: p.stock_quantity })),
            outOfStockCount: outOfStock.length
        }
    };
}

/**
 * Build diagnostic text for LLM prompt
 */
function buildDiagnosticText(snapshot) {
    if (!snapshot) return '';

    const lines = [];
    lines.push('=== WooCommerce Store Data ===');
    lines.push(`Store: ${snapshot.shop}`);
    lines.push(`Data period: ${snapshot.dataRange.from.split('T')[0]} to ${snapshot.dataRange.to.split('T')[0]}`);
    lines.push('');

    lines.push('--- Performance Summary ---');
    lines.push(`Orders (30 days): ${snapshot.summary.totalOrders30d}`);
    lines.push(`Orders (7 days): ${snapshot.summary.totalOrders7d}`);
    lines.push(`Revenue (30 days): $${snapshot.summary.totalRevenue30d}`);
    lines.push(`Revenue (7 days): $${snapshot.summary.totalRevenue7d}`);
    lines.push(`Average Order Value: $${snapshot.summary.avgOrderValue}`);
    lines.push(`Repeat Customer Rate: ${(snapshot.summary.repeatCustomerRate * 100).toFixed(1)}%`);
    lines.push('');

    lines.push('--- Inventory ---');
    lines.push(`Total Products: ${snapshot.summary.totalProducts}`);
    lines.push(`Products on Sale: ${snapshot.analysis.productsOnSale}`);
    lines.push(`Out of Stock: ${snapshot.analysis.outOfStockCount}`);
    if (snapshot.analysis.lowStockProducts.length > 0) {
        lines.push(`Low Stock Items: ${snapshot.analysis.lowStockProducts.map(p => `${p.name} (${p.qty})`).join(', ')}`);
    }
    lines.push('');

    lines.push('--- Order Status Breakdown ---');
    Object.entries(snapshot.analysis.ordersByStatus).forEach(([status, count]) => {
        lines.push(`  ${status}: ${count}`);
    });
    lines.push('');

    lines.push('--- Payment Methods ---');
    Object.entries(snapshot.analysis.ordersByPayment).forEach(([method, count]) => {
        lines.push(`  ${method}: ${count}`);
    });
    lines.push('');

    lines.push('--- Top Products by Revenue ---');
    snapshot.analysis.topProducts.slice(0, 5).forEach((p, i) => {
        lines.push(`  ${i + 1}. ${p.name}: $${p.revenue.toFixed(2)} (${p.count} sold)`);
    });
    lines.push('');

    if (Object.keys(snapshot.analysis.couponUsage).length > 0) {
        lines.push('--- Coupon Usage ---');
        Object.entries(snapshot.analysis.couponUsage).forEach(([code, count]) => {
            lines.push(`  ${code}: ${count} uses`);
        });
        lines.push('');
    }

    lines.push('--- Customer Geography ---');
    Object.entries(snapshot.analysis.ordersByCountry)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([country, count]) => {
            lines.push(`  ${country}: ${count} orders`);
        });

    return lines.join('\n');
}

module.exports = {
    collectWooCommerceData,
    buildDiagnosticText
};
