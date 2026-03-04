// backend/routes/onboardingReset.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');

let MetaAccount, GoogleAccount, ShopConnections, PixelSelection;

try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema, model } = mongoose;
  MetaAccount =
    mongoose.models.MetaAccount ||
    model('MetaAccount', new Schema({}, { strict: false, collection: 'metaaccounts' }));
}

try {
  GoogleAccount = require('../models/GoogleAccount');
} catch {
  const { Schema, model } = mongoose;
  GoogleAccount =
    mongoose.models.GoogleAccount ||
    model('GoogleAccount', new Schema({}, { strict: false, collection: 'googleaccounts' }));
}

try {
  ShopConnections = require('../models/ShopConnections');
} catch {
  const { Schema, model } = mongoose;
  ShopConnections =
    mongoose.models.ShopConnections ||
    model('ShopConnections', new Schema({}, { strict: false, collection: 'shopconnections' }));
}

try {
  PixelSelection = require('../models/PixelSelection');
} catch {
  PixelSelection = null;
}

/* ======================= helpers ======================= */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function safeStr(v) {
  return String(v || '').trim();
}

function normalizeTarget(raw) {
  const t = safeStr(raw).toLowerCase();

  // aliases
  if (t === 'meta_ads' || t === 'metaads') return 'meta';
  if (t === 'google' || t === 'gads' || t === 'ads' || t === 'googleads') return 'google_ads';
  if (t === 'google_ga' || t === 'googleanalytics' || t === 'ga' || t === 'analytics') return 'ga4';

  if (['meta', 'google_ads', 'ga4', 'shopify', 'pixels', 'all'].includes(t)) return t;
  return 'all';
}

/**
 * POST /api/onboarding/reset
 * - Clears onboarding data for a target:
 *   target: "meta" | "google_ads" | "ga4" | "shopify" | "all"
 */
router.post('/reset', requireAuth, async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

    const now = new Date();

    const target = normalizeTarget(req.body?.target || req.body?.provider || req.body?.kind || 'all');

    const actions = [{ kind: 'target', target }];

    // 1) Pixels selections (scoped)
    if (PixelSelection) {
      let pxQuery = { $or: [{ userId: uid }, { user: uid }] };

      // If we are resetting a single integration, only delete that provider's selection
      if (target === 'meta') pxQuery = { ...pxQuery, provider: 'meta' };
      if (target === 'google_ads') pxQuery = { ...pxQuery, provider: 'google_ads' };

      // If target is ga4/shopify, we usually don't touch pixel selections
      if (target === 'ga4' || target === 'shopify') {
        actions.push({ kind: 'pixels', skipped: true, reason: `target=${target}` });
      } else {
        const px = await PixelSelection.deleteMany(pxQuery);
        actions.push({ kind: 'pixels', deleted: px?.deletedCount || 0 });
      }
    } else {
      actions.push({ kind: 'pixels', skipped: true });
    }

    // 2) MetaAccount (tokens + selection + defaults + discovery) — only if meta/all
    if (target === 'meta' || target === 'all') {
      const metaRes = await MetaAccount.updateMany(
        { $or: [{ user: uid }, { userId: uid }] },
        {
          $unset: {
            access_token: 1,
            token: 1,
            accessToken: 1,
            longLivedToken: 1,
            longlivedToken: 1,

            selectedAccountIds: 1,
            defaultAccountId: 1,

            ad_accounts: 1,
            adAccounts: 1,
            ad_accounts_all: 1,
            accounts: 1,
            accounts_all: 1,

            connected: 1,
            connectedMeta: 1,
          },
          $set: { updatedAt: now },
        }
      );
      actions.push({ kind: 'meta', matched: metaRes?.matchedCount ?? metaRes?.n ?? 0 });
    } else {
      actions.push({ kind: 'meta', skipped: true, reason: `target=${target}` });
    }

    // 3) GoogleAccount — partial reset for ads/ga4, full for all
    if (target === 'google_ads' || target === 'ga4' || target === 'all') {
      const unset = {};

      // ADS reset
      if (target === 'google_ads' || target === 'all') {
        Object.assign(unset, {
          refreshToken: 1,
          accessToken: 1,
          scope: 1,
          connectedAds: 1,

          selectedCustomerIds: 1,
          defaultCustomerId: 1,

          ad_accounts: 1,
          customers: 1,

          // sometimes used in older code
          connected: 1,
          googleConnected: 1,
        });
      }

      // GA4 reset
      if (target === 'ga4' || target === 'all') {
        Object.assign(unset, {
          ga4RefreshToken: 1,
          ga4AccessToken: 1,
          ga4Scope: 1,
          connectedGa4: 1,

          selectedPropertyIds: 1,
          selectedGaPropertyId: 1,
          defaultPropertyId: 1,

          gaProperties: 1,

          // sometimes used in older code
          connected: 1,
          googleConnected: 1,
        });
      }

      const gRes = await GoogleAccount.updateMany(
        { $or: [{ user: uid }, { userId: uid }] },
        {
          $unset: unset,
          $set: { updatedAt: now },
        }
      );

      actions.push({ kind: 'google', matched: gRes?.matchedCount ?? gRes?.n ?? 0, target });
    } else {
      actions.push({ kind: 'google', skipped: true, reason: `target=${target}` });
    }

    // 4) Shopify — only if shopify/all
    if (target === 'shopify' || target === 'all') {
      const sRes = await ShopConnections.updateMany(
        { $or: [{ user: uid }, { userId: uid }] },
        {
          $unset: {
            shop: 1,
            accessToken: 1,
            access_token: 1,
            token: 1,
          },
          $set: { updatedAt: now },
        }
      );
      actions.push({ kind: 'shopify', matched: sRes?.matchedCount ?? sRes?.n ?? 0 });
    } else {
      actions.push({ kind: 'shopify', skipped: true, reason: `target=${target}` });
    }

    // 5) User flags — only clear what matches the target
    const userSet = {};
    const userUnset = {
      metaAccessToken: 1,
      // legacy selections
      selectedMetaAccounts: 1,
      selectedGoogleAccounts: 1,
      selectedGAProperties: 1,
    };

    if (target === 'meta' || target === 'all') userSet.metaConnected = false;
    if (target === 'google_ads' || target === 'ga4' || target === 'all') userSet.googleConnected = false;
    if (target === 'shopify' || target === 'all') userSet.shopifyConnected = false;

    const uRes = await User.updateOne({ _id: uid }, { $set: userSet, $unset: userUnset });
    actions.push({
      kind: 'user',
      matched: uRes?.matchedCount ?? uRes?.n ?? 0,
      target,
      userSet,
    });

    return res.json({ ok: true, reset: true, target, actions });
  } catch (e) {
    console.error('[onboarding/reset] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'RESET_FAILED' });
  }
});

module.exports = router;