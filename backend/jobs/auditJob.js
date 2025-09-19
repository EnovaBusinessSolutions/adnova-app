// backend/jobs/auditJob.js
'use strict';

const axios = require('axios');
const ShopConnections = require('../models/ShopConnections');

/**
 * Utilidad para llamar REST Admin Shopify
 */
async function shopifyGET(shop, token, path, params = {}) {
  const url = `https://${shop}/admin/api/2024-10/${path}.json`;
  const { data } = await axios.get(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    params,
    timeout: 30000,
  });
  return data;
}

/**
 * Auditoría de Shopify
 * Intenta: (1) por userId hallando ShopConnections, (2) si se le pasa shop/token directo
 * Soporta ambos modos para compatibilidad.
 */
async function generarAuditoriaIA(shopOrUserId, tokenMaybe) {
  try {
    let shop = null;
    let token = null;

    if (typeof shopOrUserId === 'string' && shopOrUserId.includes('.myshopify.com')) {
      shop = shopOrUserId;
      token = tokenMaybe;
    } else {
      // asume userId
      const conn = await ShopConnections.findOne({ matchedToUserId: shopOrUserId }).lean();
      if (!conn) {
        return {
          productsAnalizados: 0,
          resumen: 'No hay tienda Shopify conectada.',
          actionCenter: [],
          issues: { productos: [], ux: [], seo: [], performance: [], media: [] },
        };
      }
      shop = conn.shop;
      token = conn.accessToken;
    }

    // Fechas (últimos 30 días)
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
    const isoSince = since.toISOString();

    // 1) Últimos pedidos (limitamos por performance)
    const ordersRes = await shopifyGET(shop, token, 'orders', {
      status: 'any',
      limit: 50,
      order: 'created_at desc',
      created_at_min: isoSince,
      fields: 'id,created_at,total_price,customer,line_items,financial_status,fulfillment_status,contact_email,currency',
    }).catch(() => ({ orders: [] }));

    const orders = ordersRes.orders || [];

    // KPIs simples
    let ordersLast30 = orders.length;
    let salesLast30 = 0;
    const productAgg = new Map(); // name -> {qty, revenue}

    for (const o of orders) {
      const total = Number(o.total_price || 0);
      salesLast30 += total;

      for (const li of (o.line_items || [])) {
        const name = li.title || 'Producto';
        const qty = Number(li.quantity || 0);
        const price = Number(li.price || 0);
        if (!productAgg.has(name)) productAgg.set(name, { qty: 0, revenue: 0 });
        const p = productAgg.get(name);
        p.qty += qty;
        p.revenue += qty * price;
      }
    }

    const avgOrderValue = ordersLast30 ? (salesLast30 / ordersLast30) : 0;

    // Top productos (máx 5)
    const topProducts = [...productAgg.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([name, v]) => ({ name, sales: v.qty, revenue: v.revenue }));

    // Heurísticas / hallazgos
    const productos = [{ nombre: 'Catálogo/Órdenes (muestra 50)', hallazgos: [] }];
    const ux = [], seo = [], performance = [], media = [];
    const actionCenter = [];

    if (ordersLast30 > 0 && avgOrderValue < 10) {
      ux.push({
        title: 'Ticket promedio bajo',
        description: `AOV ${avgOrderValue.toFixed(2)} muy bajo.`,
        severity: 'medium',
        recommendation: 'Revisa bundles, upsells/cross-sells y gastos de envío.'
      });
      actionCenter.push({
        title: 'Mejora de AOV',
        description: 'Implementa bundles/upsell en PDP y checkout para elevar el ticket.',
        severity: 'medium',
        button: 'Ver ideas'
      });
    }

    if (topProducts.length === 0) {
      performance.push({
        title: 'Sin ventas en últimos 30 días',
        description: 'No se detectaron pedidos recientes.',
        severity: 'high',
        recommendation: 'Activa campañas de remarketing, revisa inventario y promociones.'
      });
      actionCenter.push({
        title: 'Activar campañas de remarketing',
        description: 'Recupera tráfico y clientes con campañas en Meta/Google.',
        severity: 'high',
        button: 'Ver guía'
      });
    }

    // Resultado
    const resumen = `Pedidos: ${ordersLast30}. Ventas: ${salesLast30.toFixed(2)}. AOV: ${avgOrderValue.toFixed(2)}.`;

    return {
      productsAnalizados: topProducts.length,
      resumen,
      actionCenter,
      issues: { productos, ux, seo, performance, media },
      salesLast30,
      ordersLast30,
      avgOrderValue,
      topProducts,
      customerStats: { newPct: undefined, repeatPct: undefined },
    };
  } catch (err) {
    console.error('❌ Shopify audit error:', err?.response?.data || err);
    return {
      productsAnalizados: 0,
      resumen: 'Error al consultar Shopify.',
      actionCenter: [],
      issues: { productos: [], ux: [], seo: [], performance: [], media: [] },
    };
  }
}

module.exports = { generarAuditoriaIA };
