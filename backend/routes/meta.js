// backend/routes/meta.js
const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const User    = require('../models/User');

let MetaAccount = null; 
try { MetaAccount = require('../models/MetaAccount'); } catch (_) {}

const router = express.Router();

const FB_VERSION   = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_DIALOG    = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_GRAPH     = `https://graph.facebook.com/${FB_VERSION}`;

const APP_ID       = process.env.FACEBOOK_APP_ID;
const APP_SECRET   = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;

const SCOPES = ['public_profile', 'email'].join(',');


function makeAppSecretProof(accessToken) {
  return crypto.createHmac('sha256', APP_SECRET).update(accessToken).digest('hex');
}


router.get('/login', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  
  const state = crypto.randomBytes(16).toString('hex');
  req.session.fb_state = state;

  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_type: 'code',
    state
  });

  return res.redirect(`${FB_DIALOG}?${params.toString()}`);
});


router.get('/callback', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const { code, state } = req.query || {};
  if (!code || !state || state !== req.session.fb_state) {
    return res.redirect('/onboarding?meta=fail');
  }
  
  delete req.session.fb_state;

  try {
    
    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code
      },
      timeout: 15000
    });

    let { access_token, token_type, expires_in } = tokenRes.data;
    let finalAccessToken = access_token;
    let finalExpiresAt   = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

    
    try {
      const longRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: APP_ID,
          client_secret: APP_SECRET,
          fb_exchange_token: access_token
        },
        timeout: 15000
      });
      if (longRes.data?.access_token) {
        finalAccessToken = longRes.data.access_token;
        if (longRes.data.expires_in) {
          finalExpiresAt = new Date(Date.now() + longRes.data.expires_in * 1000);
        }
      }
    } catch (_) {
      
    }

    
    const meRes = await axios.get(`${FB_GRAPH}/me`, {
      params: {
        fields: 'id,name,email',
        access_token: finalAccessToken,
        appsecret_proof: makeAppSecretProof(finalAccessToken)
      },
      timeout: 15000
    });

    const { id: fbUserId, email, name } = meRes.data;

    
    const updates = {
      metaConnected: true,
      metaAccessToken: finalAccessToken,
      metaFbUserId: fbUserId,
      metaEmail: email || null,
      metaTokenType: token_type || null,
      metaTokenExpiresAt: finalExpiresAt || null
    };

    const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, { new: true });

    
    if (MetaAccount) {
      await MetaAccount.findOneAndUpdate(
        { user: updatedUser._id, fb_user_id: fbUserId },
        {
          user: updatedUser._id,
          fb_user_id: fbUserId,
          email: email || null,
          name: name || null,
          access_token: finalAccessToken,
          expires_at: finalExpiresAt || null
        },
        { upsert: true, new: true }
      );
    }

    
    req.login(updatedUser, (err) => {
      if (err) {
        console.error('req.login error:', err);
        return res.redirect('/onboarding?meta=error');
      }
      return res.redirect('/onboarding?meta=ok');
    });
  } catch (err) {
    console.error('❌ Error en callback de Meta:', err.response?.data || err.message);
    return res.redirect('/onboarding?meta=error');
  }
});

module.exports = router;
