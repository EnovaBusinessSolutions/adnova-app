const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const router = express.Router();

const pluginDir = path.join(__dirname, '../../wordpress-plugin/adray-pixel');
const pluginMainFile = path.join(pluginDir, 'adray-pixel.php');

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

function streamPluginZip(res, folderName = 'adray-pixel') {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', reject);
    archive.on('end', resolve);

    res.on('close', resolve);
    archive.pipe(res);
    archive.directory(pluginDir, folderName);
    archive.finalize();
  });
}

function buildUpdatePayload(req, { name, slug, downloadFilename }) {
  const version = getPluginVersion();
  const lastUpdated = getLatestPluginMtime(pluginDir);
  const appBase = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  return {
    name,
    slug,
    version,
    homepage: appBase,
    download_url: `${appBase}/wp-plugin/${slug}/download/${downloadFilename}?v=${version}`,
    requires: '6.0',
    tested: '6.7',
    requires_php: '7.4',
    last_updated: lastUpdated,
    sections: {
      description: 'Adray Pixel for WooCommerce with automatic sync to Adray.',
      installation: 'Install once manually. Future updates are served automatically through the WordPress updater.',
      changelog: `Current version: ${version}`,
    },
    banners: {},
  };
}

// ─── New canonical routes (slug: adray-pixel) ──────────────────────────────
router.get('/adray-pixel/update.json', (req, res) => {
  res.json(buildUpdatePayload(req, {
    name: 'Adray Pixel',
    slug: 'adray-pixel',
    downloadFilename: 'adray-pixel.zip',
  }));
});

router.get('/adray-pixel/download/adray-pixel.zip', (_req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="adray-pixel.zip"');
  streamPluginZip(res, 'adray-pixel').catch((error) => {
    console.error('[WordPress plugin] Failed to stream plugin ZIP:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate plugin ZIP' });
    }
  });
});

router.get('/adray-pixel/download', (_req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="adray-pixel.zip"');
  streamPluginZip(res, 'adray-pixel').catch((error) => {
    console.error('[WordPress plugin] Failed to stream plugin ZIP:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate plugin ZIP' });
    }
  });
});

// ─── Legacy aliases (slug: adnova-pixel) ───────────────────────────────────
// Pre-rename installs query /wp-plugin/adnova-pixel/update.json. We respond
// with metadata that keeps the legacy slug + folder name so WP's updater
// stays internally consistent for those installs until they're reinstalled.
router.get('/adnova-pixel/update.json', (req, res) => {
  res.json(buildUpdatePayload(req, {
    name: 'Adnova Pixel',
    slug: 'adnova-pixel',
    downloadFilename: 'adnova-pixel.zip',
  }));
});

router.get('/adnova-pixel/download/adnova-pixel.zip', (_req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="adnova-pixel.zip"');
  streamPluginZip(res, 'adnova-pixel').catch((error) => {
    console.error('[WordPress plugin] Failed to stream plugin ZIP:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate plugin ZIP' });
    }
  });
});

router.get('/adnova-pixel/download', (_req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="adnova-pixel.zip"');
  streamPluginZip(res, 'adnova-pixel').catch((error) => {
    console.error('[WordPress plugin] Failed to stream plugin ZIP:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate plugin ZIP' });
    }
  });
});

module.exports = router;
