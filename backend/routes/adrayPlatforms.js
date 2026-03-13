const express = require('express');
const router = express.Router();
const axios = require('axios');
const prisma = require('../utils/prismaClient');
const { encrypt, decrypt } = require('../utils/encryption');
const { OAuth2Client } = require('google-auth-library');
const googleAdsService = require('../services/googleAdsService');
const MetaAccount = require('../models/MetaAccount');
const GoogleAccount = require('../models/GoogleAccount');

const safeStr = (value) => String(value || '').trim();
const normDigits = (value) => safeStr(value).replace(/[^\d]/g, '');

function getSelectedGoogleCustomerId(accountDoc) {
  if (!accountDoc) return '';
  const selected = Array.isArray(accountDoc.selectedCustomerIds) && accountDoc.selectedCustomerIds.length
    ? accountDoc.selectedCustomerIds[0]
    : '';
  return normDigits(selected || accountDoc.defaultCustomerId || '');
}

function getGoogleOauthClient() {
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CONNECT_CALLBACK_URL,
  });
}

async function getFreshGoogleAccessToken(accountDoc) {
  if (accountDoc?.accessToken && accountDoc?.expiresAt) {
    const remainingMs = new Date(accountDoc.expiresAt).getTime() - Date.now();
    if (remainingMs > 60000) return accountDoc.accessToken;
  }

  const oauth = getGoogleOauthClient();
  oauth.setCredentials({
    refresh_token: accountDoc?.refreshToken || undefined,
    access_token: accountDoc?.accessToken || undefined,
  });

  try {
    const { credentials } = await oauth.refreshAccessToken();
    const token = credentials?.access_token;
    if (token) {
      await GoogleAccount.updateOne(
        { _id: accountDoc._id },
        {
          $set: {
            accessToken: token,
            expiresAt: credentials?.expiry_date ? new Date(credentials.expiry_date) : null,
            updatedAt: new Date(),
          },
        }
      );
      return token;
    }
  } catch (_) {
    // Fallback below
  }

  const access = await oauth.getAccessToken().catch(() => null);
  if (access?.token) return access.token;
  return safeStr(accountDoc?.accessToken);
}

/**
 * Get Meta Pixels for an account
 */
router.get('/pixels/:account_id/meta', async (req, res) => {
  try {
    const { account_id } = req.params;
    
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
router.get('/conversions/:account_id/google', async (req, res) => {
  try {
    const { account_id } = req.params;

    if (!req.user || !req.user._id) {
       return res.status(401).json({ error: 'Unauthorized' });
    }

    const account = await GoogleAccount.loadForUserWithTokens(req.user._id)
      .select('selectedCustomerIds defaultCustomerId connectedAds expiresAt');

    if (!account) {
      return res.status(404).json({ error: 'Google account not connected' });
    }

    const customerId = getSelectedGoogleCustomerId(account);
    if (!customerId) {
      return res.status(400).json({ error: 'No Google Ads customer selected' });
    }

    const accessToken = await getFreshGoogleAccessToken(account);
    if (!accessToken) {
      return res.status(400).json({ error: 'Google access token unavailable' });
    }

    const gaql = `
      SELECT
        conversion_action.resource_name,
        conversion_action.name,
        conversion_action.status,
        conversion_action.type
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
      ORDER BY conversion_action.name
      LIMIT 200
    `.replace(/\s+/g, ' ').trim();

    const rowsRaw = await googleAdsService.searchGAQLStream(accessToken, customerId, gaql);
    const conversions = (Array.isArray(rowsRaw) ? rowsRaw : [])
      .map((row) => row?.conversionAction || row?.conversion_action || null)
      .filter(Boolean)
      .map((item) => {
        const resourceName = safeStr(item.resourceName || item.resource_name);
        if (!resourceName) return null;
        return {
          resourceName,
          name: safeStr(item.name) || resourceName,
          status: safeStr(item.status) || null,
          type: safeStr(item.type) || null,
        };
      })
      .filter(Boolean);

    const recommendedRegex = /purchase|compra|checkout|order|pedido|conversion/i;
    const recommended = conversions.find((item) => recommendedRegex.test(item.name || '')) || null;

    res.json({
      data: conversions,
      recommendedResource: recommended?.resourceName || (conversions[0]?.resourceName || null),
      meta: {
        accountId: account_id,
        customerId,
      },
    });
  } catch (error) {
    console.error('Error fetching Google conversions:', error);
    res.status(500).json({ error: 'Failed to fetch conversion actions' });
  }
});

/**
 * Save Platform Connection
 */
router.post('/connections/:account_id', async (req, res) => {
  try {
    const { account_id } = req.params;
    const { platform, accessToken, pixelId, adAccountId } = req.body;

    if (!['META', 'GOOGLE', 'TIKTOK'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    const encryptedToken = encrypt(accessToken);

    // Upsert into Prisma Account just to ensure the rel exists
    await prisma.account.upsert({
      where: { accountId: account_id },
      create: { 
        accountId: account_id, 
        domain: account_id, 
        platform: 'CUSTOM'
      },
      update: {}
    });

    const connection = await prisma.platformConnection.create({
      data: {
        accountId: account_id,
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
