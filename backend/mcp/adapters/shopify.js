'use strict';

const axios = require('axios');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';

let User, ShopConnections;
try { User = require('../../models/User'); } catch { User = null; }
try { ShopConnections = require('../../models/ShopConnections'); } catch { ShopConnections = null; }

function toNum(v) { return Number(v || 0) || 0; }
function round(n, d = 2) { return Number(Number(n || 0).toFixed(d)); }
function safeDiv(n, d) { return d ? n / d : 0; }

function gql(shop, token) {
  return axios.create({
    baseURL: `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

async function resolveShopifyCredentials(userId) {
  let shop = null;
  let accessToken = null;

  if (User) {
    const user = await User.findById(userId).select('shop shopifyAccessToken shopifyConnected').lean();
    if (user?.shop && user?.shopifyAccessToken) {
      shop = user.shop;
      accessToken = user.shopifyAccessToken;
    }
  }

  if (!shop && ShopConnections) {
    const conn = await ShopConnections.findOne({ matchedToUserId: userId }).lean();
    if (conn?.shop && conn?.accessToken) {
      shop = conn.shop;
      accessToken = conn.accessToken;
    }
  }

  if (!shop || !accessToken) return null;
  return { shop, accessToken };
}

async function fetchOrdersInRange(shop, token, dateFrom, dateTo) {
  const client = gql(shop, token);
  let allOrders = [];
  let cursor = null;
  let hasNext = true;

  while (hasNext && allOrders.length < 5000) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const query = `{
      orders(first: 250, query: "created_at:>=${dateFrom} created_at:<=${dateTo}T23:59:59"${afterClause}, sortKey: CREATED_AT) {
        pageInfo { hasNextPage }
        edges {
          cursor
          node {
            id name createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
            subtotalPriceSet { shopMoney { amount } }
            totalRefundedSet { shopMoney { amount } }
            currentTotalPriceSet { shopMoney { amount } }
            cancelledAt
            customer { id numberOfOrders }
            lineItems(first: 50) {
              edges {
                node {
                  title quantity
                  product { id title }
                  originalUnitPriceSet { shopMoney { amount } }
                  discountedUnitPriceSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      }
    }`;

    const { data } = await client.post('', { query });
    const edges = data?.data?.orders?.edges || [];
    for (const e of edges) {
      allOrders.push(e.node);
      cursor = e.cursor;
    }
    hasNext = data?.data?.orders?.pageInfo?.hasNextPage && edges.length > 0;
  }

  return allOrders;
}

async function getShopifyRevenue(userId, dateFrom, dateTo, granularity) {
  const creds = await resolveShopifyCredentials(userId);
  if (!creds) throw Object.assign(new Error('ACCOUNT_NOT_CONNECTED'), { code: 'ACCOUNT_NOT_CONNECTED' });

  const orders = await fetchOrdersInRange(creds.shop, creds.accessToken, dateFrom, dateTo);

  let totalRevenue = 0;
  let refunds = 0;
  let newCustomerOrders = 0;
  let returningCustomerOrders = 0;
  let currency = 'USD';

  const dailyBuckets = {};

  for (const o of orders) {
    const amount = toNum(o.totalPriceSet?.shopMoney?.amount);
    const refund = toNum(o.totalRefundedSet?.shopMoney?.amount);
    currency = o.totalPriceSet?.shopMoney?.currencyCode || currency;
    totalRevenue += amount;
    refunds += refund;

    const custOrders = toNum(o.customer?.numberOfOrders);
    if (custOrders <= 1) newCustomerOrders++;
    else returningCustomerOrders++;

    if (granularity && granularity !== 'total') {
      const dateKey = o.createdAt?.slice(0, 10) || 'unknown';
      if (!dailyBuckets[dateKey]) dailyBuckets[dateKey] = { revenue: 0, orders: 0 };
      dailyBuckets[dateKey].revenue += amount;
      dailyBuckets[dateKey].orders += 1;
    }
  }

  const netRevenue = totalRevenue - refunds;
  const totalOrders = orders.length;
  const aov = safeDiv(totalRevenue, totalOrders);

  let rows = [];
  if (granularity && granularity !== 'total') {
    const sortedDates = Object.keys(dailyBuckets).sort();
    if (granularity === 'day') {
      rows = sortedDates.map(d => ({ date: d, revenue: round(dailyBuckets[d].revenue), orders: dailyBuckets[d].orders }));
    } else {
      const grouped = {};
      for (const d of sortedDates) {
        let key;
        const dt = new Date(d);
        if (granularity === 'week') {
          const weekStart = new Date(dt);
          weekStart.setDate(dt.getDate() - dt.getDay());
          key = weekStart.toISOString().slice(0, 10);
        } else {
          key = d.slice(0, 7);
        }
        if (!grouped[key]) grouped[key] = { revenue: 0, orders: 0 };
        grouped[key].revenue += dailyBuckets[d].revenue;
        grouped[key].orders += dailyBuckets[d].orders;
      }
      rows = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({ date: k, revenue: round(v.revenue), orders: v.orders }));
    }
  }

  return {
    total_revenue: round(totalRevenue),
    net_revenue: round(netRevenue),
    total_orders: totalOrders,
    average_order_value: round(aov),
    new_customer_orders: newCustomerOrders,
    returning_customer_orders: returningCustomerOrders,
    new_customer_pct: round(safeDiv(newCustomerOrders, totalOrders) * 100),
    currency,
    date_from: dateFrom,
    date_to: dateTo,
    rows,
  };
}

async function getShopifyProducts(userId, dateFrom, dateTo, sortBy = 'revenue', limit = 10) {
  const creds = await resolveShopifyCredentials(userId);
  if (!creds) throw Object.assign(new Error('ACCOUNT_NOT_CONNECTED'), { code: 'ACCOUNT_NOT_CONNECTED' });

  const orders = await fetchOrdersInRange(creds.shop, creds.accessToken, dateFrom, dateTo);

  const productMap = {};
  let currency = 'USD';

  for (const o of orders) {
    currency = o.totalPriceSet?.shopMoney?.currencyCode || currency;
    const lineItems = o.lineItems?.edges || [];
    for (const li of lineItems) {
      const node = li.node;
      const productId = node.product?.id || node.title || 'unknown';
      const productName = node.product?.title || node.title || 'Unknown';
      const qty = toNum(node.quantity);
      const price = toNum(node.discountedUnitPriceSet?.shopMoney?.amount || node.originalUnitPriceSet?.shopMoney?.amount);
      const lineRevenue = price * qty;

      if (!productMap[productId]) {
        productMap[productId] = { product_id: productId, product_name: productName, units_sold: 0, revenue: 0, orders: 0, prices: [] };
      }
      productMap[productId].units_sold += qty;
      productMap[productId].revenue += lineRevenue;
      productMap[productId].orders += 1;
      productMap[productId].prices.push(price);
    }
  }

  let products = Object.values(productMap);
  products.sort((a, b) => sortBy === 'units_sold' ? b.units_sold - a.units_sold : b.revenue - a.revenue);
  products = products.slice(0, Math.min(limit, 50));

  const result = products.map(p => ({
    product_id: p.product_id,
    product_name: p.product_name,
    units_sold: p.units_sold,
    revenue: round(p.revenue),
    orders: p.orders,
    avg_selling_price: round(safeDiv(p.revenue, p.units_sold)),
  }));

  return { products: result, currency, date_from: dateFrom, date_to: dateTo };
}

module.exports = {
  resolveShopifyCredentials,
  getShopifyRevenue,
  getShopifyProducts,
};
