const express = require('express');
const router = express.Router();
const axios = require('axios');
const prisma = require('../utils/prismaClient');
const { encrypt, decrypt } = require('../utils/encryption');
const MetaAccount = require('../models/MetaAccount');
const GoogleAccount = require('../models/GoogleAccount');

/**
 * Get Meta Pixels for a shop
 */
router.get('/pixels/:shop_id/meta', async (req, res) => {
  try {
    const { shop_id } = req.params;
    
    // Auth guard ensures req.user is set (from sessionGuard)
    if (!req.user || !req.user._id) {
       return res.status(401).json({ error: 'Unauthorized' });
    }

    const account = await MetaAccount.findOne({ userId: req.user._id });
    if (!account || !account.accessToken) {
      return res.status(404).json({ error: 'Meta account not connected' });
    }

    // Call Graph API
    const response = await axios.get('https://graph.facebook.com/v18.0/me/adspixels', {
      params: {
        fields: 'id,name,last_fired_time',
        access_token: account.accessToken
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching Meta pixels:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch pixels' });
  }
});

/**
 * Get Google Conversion Actions
 */
router.get('/conversions/:shop_id/google', async (req, res) => {
  try {
    const { shop_id } = req.params;

    if (!req.user || !req.user._id) {
       return res.status(401).json({ error: 'Unauthorized' });
    }

    const account = await GoogleAccount.findOne({ userId: req.user._id });
    if (!account || !account.accessToken) {
      // NOTE: Google API expects googleAdsService or similar to handle refresh
      return res.status(404).json({ error: 'Google account not connected' });
    }

    // STUB: Actual Google Ads API requires complex SDK setup
    // For now, return empty or mock until Google CAPI is fully implemented
    res.json({ data: [] });
  } catch (error) {
    console.error('Error fetching Google conversions:', error);
    res.status(500).json({ error: 'Failed to fetch conversion actions' });
  }
});

/**
 * Save Platform Connection
 */
router.post('/connections/:shop_id', async (req, res) => {
  try {
    const { shop_id } = req.params;
    const { platform, accessToken, pixelId, adAccountId } = req.body;

    if (!['META', 'GOOGLE', 'TIKTOK'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    const encryptedToken = encrypt(accessToken);

    // Upsert into Prisma Shop just to ensure the rel exists
    await prisma.shop.upsert({
      where: { shopId: shop_id },
      create: { 
        shopId: shop_id, 
        shopDomain: shop_id, 
        accessToken: '' // we don't have shopify access token right now
      },
      update: {}
    });

    const connection = await prisma.platformConnection.create({
      data: {
        shopId: shop_id,
        platform,
        accessToken: encryptedToken,
        pixelId,
        adAccountId,
        status: 'ACTIVE'
      }
    });

    res.json({ success: true, connectionId: connection.id, status: 'ACTIVE' });
  } catch (error) {
    console.error('Error saving connection:', error);
    res.status(500).json({ error: 'Failed to save connection' });
  }
});

module.exports = router;
