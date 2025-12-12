'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const WooConnections = require('../models/WooConnections');
const WooConnectionCode = require('../models/WooConnectionCode');
const WooCommerceData = require('../models/WooCommerceData');

// Helper: generate token (UUID-like)
function genToken() {
    return crypto.randomBytes(24).toString('hex');
}

// ============================================
// Connection Code Endpoints (for user linking)
// ============================================

// POST /api/woocommerce/generate-code
// Called by ADRAY dashboard when logged-in user wants to connect WooCommerce
// Requires session authentication
router.post('/generate-code', async (req, res) => {
    try {
        // Check if user is logged in
        if (!req.session?.userId && !req.user?._id) {
            return res.status(401).json({ ok: false, error: 'NOT_LOGGED_IN' });
        }

        const userId = req.session?.userId || req.user?._id;

        // Generate a connection code for this user
        const connectionCode = await WooConnectionCode.createForUser(userId);

        console.log('[WOOCOMMERCE] Generated connection code for user:', userId, 'code:', connectionCode.code);

        return res.json({
            ok: true,
            code: connectionCode.code,
            expiresIn: 3600 // 1 hour
        });
    } catch (err) {
        console.error('woocommerce/generate-code error', err);
        return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
});

// ============================================
// Install Endpoint (called by WordPress plugin)
// ============================================

// POST /api/woocommerce/install
// Body: { shopDomain, adminEmail, pluginVersion, connectionCode }
// Server validates code, generates access token, links to user
router.post('/install', async (req, res) => {
    try {
        const { shopDomain, adminEmail, pluginVersion, connectionCode } = req.body || {};

        if (!shopDomain) {
            return res.status(400).json({ ok: false, error: 'MISSING_SHOP' });
        }

        let matchedUserId = null;

        // If connection code provided, validate and get userId
        if (connectionCode) {
            const validCode = await WooConnectionCode.validateAndConsume(connectionCode);
            if (validCode) {
                matchedUserId = validCode.userId;
                console.log('[WOOCOMMERCE] Connection code validated, linking to user:', matchedUserId);
            } else {
                console.warn('[WOOCOMMERCE] Invalid or expired connection code:', connectionCode);
                // Don't fail - just won't be linked to a user
            }
        }

        const token = genToken();

        const payload = {
            shop: shopDomain,
            accessToken: token,
            pluginVersion: pluginVersion || 'unknown',
            adminEmail: adminEmail || null,
            matchedToUserId: matchedUserId,
            installedAt: new Date()
        };

        await WooConnections.findOneAndUpdate(
            { shop: shopDomain },
            { $set: payload },
            { upsert: true, new: true }
        );

        // Create or update WooCommerceData document for this store
        if (matchedUserId) {
            await WooCommerceData.findOneAndUpdate(
                { shopDomain },
                {
                    $set: { userId: matchedUserId },
                    $setOnInsert: {
                        orders: [],
                        products: [],
                        customers: [],
                        coupons: []
                    }
                },
                { upsert: true }
            );
        }

        console.log('[WOOCOMMERCE] Store installed:', shopDomain, matchedUserId ? `(linked to user ${matchedUserId})` : '(no user linked)');

        return res.json({
            ok: true,
            token,
            userLinked: !!matchedUserId
        });
    } catch (err) {
        console.error('woocommerce/install error', err);
        return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
});

// ============================================
// Auth Middleware
// ============================================

async function requirePluginAuth(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ ok: false, error: 'NO_AUTH' });
        const token = m[1];

        const conn = await WooConnections.findOne({ accessToken: token }).select('+accessToken').lean();
        if (!conn) return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });

        req.wooConnection = conn;
        return next();
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'AUTH_ERROR' });
    }
}

// ============================================
// Webhook Endpoint (receives data from plugin)
// ============================================

// POST /api/woocommerce/webhook
router.post('/webhook', requirePluginAuth, async (req, res) => {
    try {
        const event = req.headers['x-wc-webhook-event'] || req.headers['x-event'] || 'unknown';
        const payload = req.body;
        const { shop, matchedToUserId } = req.wooConnection;

        console.log('[WOOCOMMERCE] Webhook received:', { shop, event, id: payload?.id });

        // Find or create WooCommerceData document
        let wooData = await WooCommerceData.findOne({ shopDomain: shop });
        if (!wooData) {
            wooData = new WooCommerceData({
                shopDomain: shop,
                userId: matchedToUserId,
                orders: [],
                products: [],
                customers: [],
                coupons: []
            });
        }

        // Update based on event type
        const [resource, action] = event.split('.');

        switch (resource) {
            case 'order':
                if (action === 'deleted') {
                    wooData.orders = wooData.orders.filter(o => o.woo_id !== payload.id);
                } else {
                    wooData.upsertOrder(payload);
                }
                break;

            case 'product':
                if (action === 'deleted') {
                    wooData.products = wooData.products.filter(p => p.woo_id !== payload.id);
                } else {
                    wooData.upsertProduct(payload);
                }
                break;

            case 'customer':
                if (action === 'deleted') {
                    wooData.customers = wooData.customers.filter(c => c.woo_id !== payload.id);
                } else {
                    wooData.upsertCustomer(payload);
                }
                break;

            case 'coupon':
                if (action === 'deleted') {
                    wooData.coupons = wooData.coupons.filter(c => c.woo_id !== payload.id);
                } else {
                    wooData.upsertCoupon(payload);
                }
                break;

            default:
                console.log('[WOOCOMMERCE] Unknown event type:', event);
        }

        // Update metadata
        wooData.lastWebhookAt = new Date();
        wooData.webhookCount = (wooData.webhookCount || 0) + 1;

        await wooData.save();

        return res.json({ ok: true });
    } catch (err) {
        console.error('woocommerce/webhook error', err);
        return res.status(500).json({ ok: false, error: 'WEBHOOK_ERROR' });
    }
});

// ============================================
// Disconnect Endpoint
// ============================================

// DELETE /api/woocommerce/install
router.delete('/install', requirePluginAuth, async (req, res) => {
    try {
        const { shop } = req.wooConnection;
        await WooConnections.deleteOne({ shop });
        // Note: We keep WooCommerceData for historical purposes
        console.log('[WOOCOMMERCE] Store disconnected:', shop);
        return res.json({ ok: true });
    } catch (err) {
        console.error('woocommerce/uninstall error', err);
        return res.status(500).json({ ok: false, error: 'UNINSTALL_ERROR' });
    }
});

// ============================================
// Status Endpoint (for dashboard)
// ============================================

// GET /api/woocommerce/status
// Returns connection status for logged-in user
router.get('/status', async (req, res) => {
    try {
        if (!req.session?.userId && !req.user?._id) {
            return res.status(401).json({ ok: false, error: 'NOT_LOGGED_IN' });
        }

        const userId = req.session?.userId || req.user?._id;

        // Find connection for this user
        const connection = await WooConnections.findOne({ matchedToUserId: userId });

        if (!connection) {
            return res.json({
                ok: true,
                connected: false
            });
        }

        // Get stats from WooCommerceData
        const wooData = await WooCommerceData.findOne({ userId });

        return res.json({
            ok: true,
            connected: true,
            shop: connection.shop,
            installedAt: connection.installedAt,
            stats: wooData?.stats || null,
            dataReceived: {
                orders: wooData?.orders?.length || 0,
                products: wooData?.products?.length || 0,
                customers: wooData?.customers?.length || 0,
                coupons: wooData?.coupons?.length || 0
            }
        });
    } catch (err) {
        console.error('woocommerce/status error', err);
        return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
});

// GET /api/woocommerce/healthz
router.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

module.exports = router;
