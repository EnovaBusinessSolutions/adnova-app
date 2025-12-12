'use strict';

const express = require('express');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const PLUGIN_DIR = path.join(__dirname, '../../woocommerce-plugin');
const PLUGIN_NAME = 'adray-woocommerce';

/**
 * GET /api/plugin/download
 * 
 * Streams the WooCommerce plugin as a zip file.
 * The plugin is zipped on-the-fly from the woocommerce-plugin directory.
 */
router.get('/download', (req, res) => {
    // Check if plugin directory exists
    if (!fs.existsSync(PLUGIN_DIR)) {
        console.error('[PLUGIN_DOWNLOAD] Plugin directory not found:', PLUGIN_DIR);
        return res.status(404).json({
            ok: false,
            error: 'Plugin not found'
        });
    }

    // Set headers for zip download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${PLUGIN_NAME}.zip"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Create archive
    const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
    });

    // Handle archive errors
    archive.on('error', (err) => {
        console.error('[PLUGIN_DOWNLOAD] Archive error:', err);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: 'Failed to create zip' });
        }
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add plugin directory to archive with the plugin name as the root folder
    // This ensures when extracted, it creates a folder called "adray-woocommerce"
    archive.directory(PLUGIN_DIR, PLUGIN_NAME);

    // Finalize the archive
    archive.finalize();

    console.log('[PLUGIN_DOWNLOAD] Plugin download started');
});

/**
 * GET /api/plugin/info
 * 
 * Returns plugin metadata without downloading.
 */
router.get('/info', (req, res) => {
    const pluginFile = path.join(PLUGIN_DIR, 'adray-woocommerce.php');

    if (!fs.existsSync(pluginFile)) {
        return res.status(404).json({
            ok: false,
            error: 'Plugin not found'
        });
    }

    // Read plugin header to get version
    const content = fs.readFileSync(pluginFile, 'utf8');
    const versionMatch = content.match(/Version:\s*([^\s\n]+)/i);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    res.json({
        ok: true,
        plugin: {
            name: 'ADRAY for WooCommerce',
            slug: PLUGIN_NAME,
            version,
            downloadUrl: '/api/plugin/download',
            requires: {
                wordpress: '5.8',
                woocommerce: '5.0',
                php: '7.4'
            }
        }
    });
});

module.exports = router;
