'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const WooConnections = require('../models/WooConnections');

// Helper: generate token (UUID-like)
function genToken() {
    return crypto.randomBytes(24).toString('hex');
}

// POST /api/woocommerce/install
// Body: { shopDomain, adminEmail, pluginVersion }
// Server generates an access token and returns it to the plugin.
router.post('/install', async (req, res) => {
    try {
        const { shopDomain, adminEmail, pluginVersion } = req.body || {};
        if (!shopDomain) return res.status(400).json({ ok: false, error: 'MISSING_SHOP' });

        const token = genToken();

        const payload = {
            shop: shopDomain,
            accessToken: token,
            pluginVersion: pluginVersion || 'unknown',
            adminEmail: adminEmail || null,
        };

        await WooConnections.findOneAndUpdate(
            { shop: shopDomain },
            { $set: payload },
            { upsert: true, new: true }
        );

        return res.json({ ok: true, token });
    } catch (err) {
        console.error('woocommerce/install error', err);
        return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
});

// Middleware: validate bearer token for webhook endpoints
async function requirePluginAuth(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ ok: false, error: 'NO_AUTH' });
        const token = m[1];

        // try to find connection by token
        const conn = await WooConnections.findOne({ accessToken: token }).select('+accessToken').lean();
        if (!conn) return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });

        req.wooConnection = conn;
        return next();
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'AUTH_ERROR' });
    }
}

// POST /api/woocommerce/webhook
// Plugin registers webhooks to point here and sends them with Authorization: Bearer <token>
router.post('/webhook', requirePluginAuth, async (req, res) => {
    try {
        const event = req.headers['x-wc-webhook-event'] || req.headers['x-event'] || 'unknown';
        const payload = req.body;

        // TODO: enqueue processing or forward to audit pipeline
        console.log('Received Woo webhook', { shop: req.wooConnection.shop, event, payloadSummary: Object.keys(payload || {}).slice(0, 10) });

        // quick response for plugin
        return res.json({ ok: true });
    } catch (err) {
        console.error('woocommerce/webhook error', err);
        return res.status(500).json({ ok: false, error: 'WEBHOOK_ERROR' });
    }
});

// GET /api/woocommerce/healthz
router.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

module.exports = router;
