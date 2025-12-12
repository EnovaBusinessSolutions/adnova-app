'use strict';

const mongoose = require('mongoose');

/**
 * WooCommerceData Schema
 * 
 * Stores webhook data from WooCommerce stores for audit processing.
 * Each document represents a snapshot of store data.
 */

// Order line item schema
const LineItemSchema = new mongoose.Schema({
    id: Number,
    name: String,
    product_id: Number,
    sku: String,
    quantity: Number,
    price: String,
    total: String
}, { _id: false });

// Order schema (embedded)
const OrderSchema = new mongoose.Schema({
    woo_id: { type: Number, index: true },
    status: String,
    currency: String,
    total: String,
    subtotal: String,
    discount_total: String,
    shipping_total: String,
    payment_method: String,
    payment_method_title: String,
    customer_id: Number,
    customer_email: String,
    billing_city: String,
    billing_state: String,
    billing_country: String,
    line_items: [LineItemSchema],
    coupon_lines: [{
        code: String,
        discount: String
    }],
    date_created: Date,
    date_completed: Date,
    receivedAt: { type: Date, default: Date.now }
}, { _id: false });

// Product schema (embedded)
const ProductSchema = new mongoose.Schema({
    woo_id: { type: Number, index: true },
    name: String,
    slug: String,
    type: String, // simple, variable, grouped
    status: String,
    sku: String,
    price: String,
    regular_price: String,
    sale_price: String,
    on_sale: Boolean,
    stock_status: String,
    stock_quantity: Number,
    categories: [{ id: Number, name: String }],
    tags: [{ id: Number, name: String }],
    total_sales: Number,
    date_created: Date,
    date_modified: Date,
    receivedAt: { type: Date, default: Date.now }
}, { _id: false });

// Customer schema (embedded)
const CustomerSchema = new mongoose.Schema({
    woo_id: { type: Number, index: true },
    email: String,
    first_name: String,
    last_name: String,
    role: String,
    billing_city: String,
    billing_state: String,
    billing_country: String,
    orders_count: Number,
    total_spent: String,
    date_created: Date,
    receivedAt: { type: Date, default: Date.now }
}, { _id: false });

// Coupon schema (embedded)
const CouponSchema = new mongoose.Schema({
    woo_id: { type: Number, index: true },
    code: String,
    discount_type: String, // percent, fixed_cart, fixed_product
    amount: String,
    usage_count: Number,
    usage_limit: Number,
    date_created: Date,
    date_expires: Date,
    receivedAt: { type: Date, default: Date.now }
}, { _id: false });

// Main WooCommerceData schema
const WooCommerceDataSchema = new mongoose.Schema({
    // Link to WooConnections
    shopDomain: {
        type: String,
        required: true,
        index: true
    },

    // Link to User (via WooConnections.matchedToUserId)
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },

    // Orders received via webhook
    orders: [OrderSchema],

    // Products received via webhook
    products: [ProductSchema],

    // Customers received via webhook
    customers: [CustomerSchema],

    // Coupons received via webhook
    coupons: [CouponSchema],

    // Metadata
    lastWebhookAt: Date,
    webhookCount: { type: Number, default: 0 },

    // Stats (computed periodically)
    stats: {
        totalOrders: { type: Number, default: 0 },
        totalRevenue: { type: Number, default: 0 },
        totalProducts: { type: Number, default: 0 },
        totalCustomers: { type: Number, default: 0 },
        avgOrderValue: { type: Number, default: 0 },
        lastComputed: Date
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
WooCommerceDataSchema.index({ shopDomain: 1, 'orders.woo_id': 1 });
WooCommerceDataSchema.index({ shopDomain: 1, 'products.woo_id': 1 });
WooCommerceDataSchema.index({ userId: 1, updatedAt: -1 });

// Add or update an order
WooCommerceDataSchema.methods.upsertOrder = function (orderData) {
    const idx = this.orders.findIndex(o => o.woo_id === orderData.id);
    const order = {
        woo_id: orderData.id,
        status: orderData.status,
        currency: orderData.currency,
        total: orderData.total,
        subtotal: orderData.subtotal,
        discount_total: orderData.discount_total,
        shipping_total: orderData.shipping_total,
        payment_method: orderData.payment_method,
        payment_method_title: orderData.payment_method_title,
        customer_id: orderData.customer_id,
        customer_email: orderData.billing?.email,
        billing_city: orderData.billing?.city,
        billing_state: orderData.billing?.state,
        billing_country: orderData.billing?.country,
        line_items: (orderData.line_items || []).map(li => ({
            id: li.id,
            name: li.name,
            product_id: li.product_id,
            sku: li.sku,
            quantity: li.quantity,
            price: li.price,
            total: li.total
        })),
        coupon_lines: (orderData.coupon_lines || []).map(c => ({
            code: c.code,
            discount: c.discount
        })),
        date_created: orderData.date_created ? new Date(orderData.date_created) : null,
        date_completed: orderData.date_completed ? new Date(orderData.date_completed) : null,
        receivedAt: new Date()
    };

    if (idx >= 0) {
        this.orders[idx] = order;
    } else {
        this.orders.push(order);
    }
};

// Add or update a product
WooCommerceDataSchema.methods.upsertProduct = function (productData) {
    const idx = this.products.findIndex(p => p.woo_id === productData.id);
    const product = {
        woo_id: productData.id,
        name: productData.name,
        slug: productData.slug,
        type: productData.type,
        status: productData.status,
        sku: productData.sku,
        price: productData.price,
        regular_price: productData.regular_price,
        sale_price: productData.sale_price,
        on_sale: productData.on_sale,
        stock_status: productData.stock_status,
        stock_quantity: productData.stock_quantity,
        categories: (productData.categories || []).map(c => ({ id: c.id, name: c.name })),
        tags: (productData.tags || []).map(t => ({ id: t.id, name: t.name })),
        total_sales: productData.total_sales,
        date_created: productData.date_created ? new Date(productData.date_created) : null,
        date_modified: productData.date_modified ? new Date(productData.date_modified) : null,
        receivedAt: new Date()
    };

    if (idx >= 0) {
        this.products[idx] = product;
    } else {
        this.products.push(product);
    }
};

// Add or update a customer
WooCommerceDataSchema.methods.upsertCustomer = function (customerData) {
    const idx = this.customers.findIndex(c => c.woo_id === customerData.id);
    const customer = {
        woo_id: customerData.id,
        email: customerData.email,
        first_name: customerData.first_name,
        last_name: customerData.last_name,
        role: customerData.role,
        billing_city: customerData.billing?.city,
        billing_state: customerData.billing?.state,
        billing_country: customerData.billing?.country,
        orders_count: customerData.orders_count,
        total_spent: customerData.total_spent,
        date_created: customerData.date_created ? new Date(customerData.date_created) : null,
        receivedAt: new Date()
    };

    if (idx >= 0) {
        this.customers[idx] = customer;
    } else {
        this.customers.push(customer);
    }
};

// Add or update a coupon
WooCommerceDataSchema.methods.upsertCoupon = function (couponData) {
    const idx = this.coupons.findIndex(c => c.woo_id === couponData.id);
    const coupon = {
        woo_id: couponData.id,
        code: couponData.code,
        discount_type: couponData.discount_type,
        amount: couponData.amount,
        usage_count: couponData.usage_count,
        usage_limit: couponData.usage_limit,
        date_created: couponData.date_created ? new Date(couponData.date_created) : null,
        date_expires: couponData.date_expires ? new Date(couponData.date_expires) : null,
        receivedAt: new Date()
    };

    if (idx >= 0) {
        this.coupons[idx] = coupon;
    } else {
        this.coupons.push(coupon);
    }
};

// Compute stats
WooCommerceDataSchema.methods.computeStats = function () {
    const totalOrders = this.orders.length;
    const totalRevenue = this.orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
    const totalProducts = this.products.length;
    const totalCustomers = this.customers.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    this.stats = {
        totalOrders,
        totalRevenue,
        totalProducts,
        totalCustomers,
        avgOrderValue,
        lastComputed: new Date()
    };
};

module.exports = mongoose.model('WooCommerceData', WooCommerceDataSchema);
