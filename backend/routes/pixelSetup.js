const express = require("express");

const router = express.Router();

let prisma = null;
let User = null;
let ShopConnections = null;

try { prisma = require('../utils/prismaClient'); } catch (_) {}
try { User = require('../models/User'); } catch (_) {}
try { ShopConnections = require('../models/ShopConnections'); } catch (_) {}

function normalizeHostname(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch (_) {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null;
  }
}

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_LENGTH = 500000;

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeDomainInput(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    throw makeError("INVALID_DOMAIN", "Enter a valid domain to continue.");
  }

  const hasProtocol = /^https?:\/\//i.test(raw);
  const candidate = hasProtocol ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw makeError("INVALID_DOMAIN", "Enter a valid domain to continue.");
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw makeError("INVALID_DOMAIN", "Only http and https domains are supported.");
  }

  const hostname = String(parsed.hostname || "").trim().replace(/\.+$/, "");
  if (!hostname) {
    throw makeError("INVALID_DOMAIN", "Enter a valid domain to continue.");
  }

  const preferredProtocol = hasProtocol ? parsed.protocol : "https:";
  const attempts = [`${preferredProtocol}//${hostname}/`];
  if (!hasProtocol && preferredProtocol === "https:") {
    attempts.push(`http://${hostname}/`);
  }

  return {
    hostname,
    attempts,
  };
}

async function fetchHomepage(candidateUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(candidateUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      throw makeError(
        "FETCH_FAILED",
        `The site returned HTTP ${response.status}. Check the domain and try again.`
      );
    }

    const html = String(await response.text()).slice(0, MAX_HTML_LENGTH);
    return {
      response,
      finalUrl: response.url || candidateUrl,
      html,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw makeError("FETCH_TIMEOUT", "The site took too long to respond. Try again in a moment.");
    }
    if (error?.code) {
      throw error;
    }
    throw makeError("FETCH_FAILED", "We could not reach that site. Check the domain and try again.");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithFallback(attempts) {
  let lastError = null;

  for (const attempt of attempts) {
    try {
      return await fetchHomepage(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || makeError("FETCH_FAILED", "We could not reach that site. Check the domain and try again.");
}

function classifyStore({ finalUrl, html }) {
  const lowerHtml = String(html || "").toLowerCase();
  const final = new URL(finalUrl);
  const origin = final.origin;
  const hostname = final.hostname.toLowerCase();

  const scores = {
    woocommerce: 0,
    shopify: 0,
    magento: 0,
  };

  const matchedSignals = {
    woocommerce: [],
    shopify: [],
    magento: [],
  };

  const pushSignal = (type, matched, label, weight) => {
    if (!matched) return;
    matchedSignals[type].push(label);
    scores[type] += weight;
  };

  pushSignal("shopify", hostname.endsWith(".myshopify.com"), "MyShopify hostname detected", 4);
  pushSignal("shopify", lowerHtml.includes("window.shopify"), "window.Shopify is present", 3);
  pushSignal("shopify", lowerHtml.includes("web-pixels-manager"), "Shopify web pixels manager detected", 3);
  pushSignal("shopify", lowerHtml.includes("shopify monorail"), "Shopify Monorail signal detected", 2);
  pushSignal("shopify", lowerHtml.includes("trekkie"), "Shopify Trekkie analytics detected", 2);
  pushSignal("shopify", lowerHtml.includes("cdn.shopify.com"), "Shopify CDN assets detected", 2);
  pushSignal("shopify", lowerHtml.includes("shopify-analytics"), "Shopify analytics script detected", 2);

  const wordpressSignals = [];
  if (lowerHtml.includes("wp-content/themes")) wordpressSignals.push("WordPress theme assets detected");
  if (lowerHtml.includes("wp-includes")) wordpressSignals.push("WordPress core assets detected");
  if (lowerHtml.includes("wp-json")) wordpressSignals.push("WordPress REST API marker detected");

  pushSignal("woocommerce", lowerHtml.includes("wc_add_to_cart_params"), "WooCommerce add-to-cart script detected", 3);
  pushSignal("woocommerce", lowerHtml.includes("woocommerce_params"), "WooCommerce storefront params detected", 3);
  pushSignal("woocommerce", lowerHtml.includes("wp-content/plugins/woocommerce"), "WooCommerce plugin assets detected", 3);
  pushSignal("woocommerce", /class=["'][^"']*woocommerce/.test(lowerHtml), "WooCommerce storefront markup detected", 2);
  pushSignal("woocommerce", wordpressSignals.length >= 2, "WordPress storefront markers detected", 1);

  pushSignal("magento", lowerHtml.includes("window.magento"), "window.Magento is present", 3);
  pushSignal("magento", lowerHtml.includes("magento_ui"), "Magento UI assets detected", 3);
  pushSignal("magento", lowerHtml.includes("mage-cache-storage"), "Magento cache storage marker detected", 2);
  pushSignal("magento", lowerHtml.includes("x-magento-init"), "Magento init config detected", 3);
  pushSignal("magento", /\/static\/version[^"' ]*\/frontend\//.test(lowerHtml), "Magento frontend assets detected", 2);

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;

  let detectedType = "custom";
  let confidence = "low";
  let signals = [];

  if (topScore > 0) {
    detectedType = topType;
    signals = matchedSignals[topType].slice(0, 5);

    if (topScore >= 5 || topScore - secondScore >= 3) {
      confidence = "high";
    } else if (topScore >= 2) {
      confidence = "medium";
    }
  } else {
    signals = ["No platform-specific storefront markers were detected on the homepage."];
  }

  const looksWordPress =
    detectedType === "woocommerce" ||
    wordpressSignals.length >= 2 ||
    hostname.includes("wp");

  return {
    normalizedUrl: `${origin}/`,
    hostname: final.hostname,
    detectedType,
    confidence,
    signals,
    suggestedPluginsUrl: looksWordPress ? `${origin}/wp-admin/plugins.php` : undefined,
  };
}

router.use((req, res, next) => {
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) {
    return next();
  }

  if (req.user) return next();

  return res.status(401).json({
    ok: false,
    error: "Unauthorized",
  });
});

router.post("/detect-store", async (req, res) => {
  try {
    const { domain } = req.body || {};
    const { attempts } = normalizeDomainInput(domain);
    const payload = await fetchWithFallback(attempts);
    const data = classifyStore(payload);

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    const status =
      error?.code === "INVALID_DOMAIN"
        ? 400
        : error?.code === "FETCH_TIMEOUT"
          ? 504
          : 502;

    return res.status(status).json({
      ok: false,
      error: error?.message || "We could not detect this store type right now.",
    });
  }
});

const PLATFORM_MAP = {
  woocommerce: 'WOOCOMMERCE',
  shopify: 'SHOPIFY',
  magento: 'MAGENTO',
  custom: 'WOOCOMMERCE',
};

router.post('/confirm-shop', async (req, res) => {
  try {
    const { hostname, normalizedUrl, storeType } = req.body || {};
    const domain = normalizeHostname(hostname || normalizedUrl);
    if (!domain) {
      return res.status(400).json({ ok: false, error: 'hostname is required' });
    }

    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const platform = PLATFORM_MAP[String(storeType || '').toLowerCase()] || 'WOOCOMMERCE';

    // 1. Ensure Account row exists in Prisma so analytics queries work immediately
    if (prisma) {
      await prisma.account.upsert({
        where: { accountId: domain },
        create: { accountId: domain, domain, platform },
        update: { domain, platform },
      }).catch((err) => console.warn('[pixelSetup] account upsert failed:', err?.message));
    }

    // 2. Upsert ShopConnections in MongoDB so the user can see this shop's data
    if (ShopConnections) {
      await ShopConnections.findOneAndUpdate(
        { shop: domain },
        { shop: domain, accessToken: 'pixel-setup', matchedToUserId: userId, installedAt: new Date() },
        { upsert: true, new: true }
      ).catch((err) => console.warn('[pixelSetup] shopconn upsert failed:', err?.message));
    }

    // 3. Update user.shop so session-based shop resolution works immediately
    if (User) {
      await User.findByIdAndUpdate(userId, { shop: domain })
        .catch((err) => console.warn('[pixelSetup] user.shop update failed:', err?.message));
    }

    return res.json({ ok: true, shop: domain });
  } catch (error) {
    console.error('[pixelSetup] confirm-shop error:', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// Informative pixel verification — checks if adray-pixel.js is present on the storefront homepage
router.get('/verify', async (req, res) => {
  const domain = normalizeHostname(req.query.shop || req.query.domain);
  if (!domain) return res.status(400).json({ ok: false, error: 'shop is required' });

  const url = `https://${domain}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AdrayPixelVerifier/1.0' },
    }).finally(() => clearTimeout(timer));

    const text = await response.text().catch(() => '');
    const detected = /adray[-_]pixel\.js/i.test(text) || /adray\.ai\/pixel/i.test(text);
    return res.json({ ok: true, detected, shop: domain });
  } catch (err) {
    return res.json({ ok: true, detected: false, shop: domain, fetchError: err?.message });
  }
});

// Disconnect: unlink the user's current shop
router.post('/disconnect', async (req, res) => {
  const userId = req.user?._id;
  if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    const user = await User.findById(userId).lean();
    const shop = user?.shop;

    if (shop && ShopConnections) {
      await ShopConnections.findOneAndUpdate(
        { shop, matchedToUserId: userId },
        { $unset: { matchedToUserId: '' } }
      ).catch(() => {});
    }

    if (User) {
      await User.findByIdAndUpdate(userId, { $unset: { shop: '' } }).catch(() => {});
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[pixelSetup] disconnect error:', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

module.exports = router;
