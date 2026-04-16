const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const router = express.Router();

const pluginDir = path.join(__dirname, '../../wordpress-plugin/adnova-pixel');
const pluginMainFile = path.join(pluginDir, 'adnova-pixel.php');
const pluginZipFile = path.join(__dirname, '../../wordpress-plugin/adnova-pixel.zip');

function getPluginVersion() {
  try {
    const content = fs.readFileSync(pluginMainFile, 'utf8');
    const match = content.match(/\* Version:\s*([^\r\n]+)/);
    return match ? String(match[1]).trim() : '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function getLatestPluginMtime(dirPath) {
  let latest = 0;

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const stat = fs.statSync(entryPath);
      latest = Math.max(latest, stat.mtimeMs);
      if (entry.isDirectory()) {
        walk(entryPath);
      }
    }
  }

  try {
    walk(dirPath);
  } catch (_) {
    return new Date().toISOString();
  }

  return new Date(latest || Date.now()).toISOString();
}

function streamPluginZip(res) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', reject);
    archive.on('end', resolve);

    res.on('close', resolve);
    archive.pipe(res);
    archive.directory(pluginDir, 'adnova-pixel');
    archive.finalize();
  });
}

router.get('/adnova-pixel/update.json', (req, res) => {
  const version = getPluginVersion();
  const lastUpdated = getLatestPluginMtime(pluginDir);
  const appBase = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  res.json({
    name: 'Adnova Pixel',
    slug: 'adnova-pixel',
    version,
    homepage: appBase,
    download_url: `${appBase}/wp-plugin/adnova-pixel/download/adnova-pixel.zip?v=${version}`,
    requires: '6.0',
    tested: '6.7',
    requires_php: '7.4',
    last_updated: lastUpdated,
    sections: {
      description: 'Adnova Pixel for WooCommerce with automatic sync to AdRay.',
      installation: 'Install once manually. Future updates are served automatically through the WordPress updater.',
      changelog: `Current version: ${version}`,
    },
    banners: {},
  });
});

router.get('/adnova-pixel/download/adnova-pixel.zip', (_req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="adnova-pixel.zip"');
  streamPluginZip(res).catch((error) => {
    console.error('[WordPress plugin] Failed to stream plugin ZIP:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate plugin ZIP' });
    }
  });
});

// Alias for backward compatibility
router.get('/adnova-pixel/download', (_req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="adnova-pixel.zip"');
  streamPluginZip(res).catch((error) => {
    console.error('[WordPress plugin] Failed to stream plugin ZIP:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate plugin ZIP' });
    }
  });
});

module.exports = router;