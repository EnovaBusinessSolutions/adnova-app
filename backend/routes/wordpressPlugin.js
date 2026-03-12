const express = require('express');
const fs = require('fs');
const path = require('path');

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

router.get('/adnova-pixel/update.json', (_req, res) => {
  const version = getPluginVersion();
  const lastUpdated = fs.existsSync(pluginZipFile)
    ? fs.statSync(pluginZipFile).mtime.toISOString()
    : new Date().toISOString();

  res.json({
    name: 'Adnova Pixel',
    slug: 'adnova-pixel',
    version,
    homepage: 'https://adray-app-staging-german.onrender.com',
    download_url: `https://adray-app-staging-german.onrender.com/wp-plugin/adnova-pixel/download?v=${version}`,
    requires: '6.0',
    tested: '6.7',
    requires_php: '7.4',
    last_updated: lastUpdated,
    sections: {
      description: 'Adnova Pixel for WooCommerce with automatic sync to AdRay staging.',
      installation: 'Install once manually. Future updates are served from AdRay staging through the WordPress updater.',
      changelog: `Current version: ${version}`,
    },
    banners: {},
  });
});

router.get('/adnova-pixel/download', (_req, res) => {
  if (!fs.existsSync(pluginZipFile)) {
    return res.status(404).json({ error: 'Plugin ZIP not found' });
  }

  return res.download(pluginZipFile, 'adnova-pixel.zip');
});

module.exports = router;