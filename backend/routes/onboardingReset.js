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

/**
 * POST /api/onboarding/reset
 * - Clears everything connected/selected for onboarding (Meta/Google/GA4/Shopify/Pixels)
 */
router.post('/reset', requireAuth, async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

    const now = new Date();

    const actions = [];

    // 1) Pixels selections
    if (PixelSelection) {
      const px = await PixelSelection.deleteMany({ $or: [{ userId: uid }, { user: uid }] });
      actions.push({ kind: 'pixels', deleted: px?.deletedCount || 0 });
    } else {
      actions.push({ kind: 'pixels', skipped: true });
    }

    // 2) MetaAccount (tokens + selection + defaults + discovery)
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

    // 3) GoogleAccount (ADS + GA4 tokens + selection + defaults + discovery)
    const gRes = await GoogleAccount.updateMany(
      { $or: [{ user: uid }, { userId: uid }] },
      {
        $unset: {
          // ADS
          refreshToken: 1,
          accessToken: 1,
          scope: 1,
          connectedAds: 1,

          // GA4
          ga4RefreshToken: 1,
          ga4AccessToken: 1,
          ga4Scope: 1,
          connectedGa4: 1,

          // selection/defaults
          selectedCustomerIds: 1,
          defaultCustomerId: 1,

          selectedPropertyIds: 1,
          selectedGaPropertyId: 1,
          defaultPropertyId: 1,

          // discovery data
          ad_accounts: 1,
          customers: 1,
          gaProperties: 1,

          // sometimes used in older code
          connected: 1,
          googleConnected: 1,
        },
        $set: { updatedAt: now },
      }
    );
    actions.push({ kind: 'google', matched: gRes?.matchedCount ?? gRes?.n ?? 0 });

    // 4) Shopify
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

    // 5) User legacy flags / selections
    const uRes = await User.updateOne(
      { _id: uid },
      {
        $set: {
          metaConnected: false,
          googleConnected: false,
          shopifyConnected: false,
        },
        $unset: {
          metaAccessToken: 1,
          // legacy selections
          selectedMetaAccounts: 1,
          selectedGoogleAccounts: 1,
          selectedGAProperties: 1,
        },
      }
    );
    actions.push({ kind: 'user', matched: uRes?.matchedCount ?? uRes?.n ?? 0 });

    return res.json({ ok: true, reset: true, actions });
  } catch (e) {
    console.error('[onboarding/reset] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'RESET_FAILED' });
  }
});

module.exports = router;