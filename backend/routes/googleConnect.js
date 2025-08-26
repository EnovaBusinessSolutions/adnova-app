// backend/routes/googleConnect.js
const express = require('express');
const router = express.Router();
const axios  = require('axios');
const qs     = require('querystring');
const User   = require('../models/User');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GOOGLE_CONNECT_CALLBACK_URL;

router.get('/connect', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const state = req.sessionID;

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    access_type:   'offline',           
    include_granted_scopes: 'true',     
    prompt:        'consent',           
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/analytics.edit' 
    ].join(' '),
    state
  });

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/connect/callback', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const { code } = req.query;
  if (!code) return res.redirect('/onboarding?google=fail');

  try {
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, id_token } = tokenRes.data;

    let decodedEmail = '';
    if (id_token) {
      const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64').toString());
      decodedEmail = payload.email || '';
    }

    const updateData = {
      googleConnected:    true,
      googleAccessToken:  access_token,
      googleRefreshToken: refresh_token 
    };
    if (decodedEmail) updateData.googleEmail = decodedEmail;

    await User.findByIdAndUpdate(req.user._id, updateData);
    console.log('✅ Google Analytics/Ads conectado para usuario:', req.user._id);

    return res.redirect('/onboarding');
  } catch (err) {
    console.error('❌ Error intercambiando tokens de Analytics/Ads:', err.response?.data || err.message);
    return res.redirect('/onboarding?google=error');
  }
});

const ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta';

router.post('/ga/demo-create-conversion', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.status(401).json({ ok: false, error: 'No auth' });
    const { propertyId } = req.body;            
    if (!propertyId) return res.status(400).json({ ok: false, error: 'Falta propertyId' });

    const token = req.user.googleAccessToken;
    if (!token) return res.status(400).json({ ok: false, error: 'Falta token de Google' });

    const eventName = `adnova_demo_conv_${Date.now()}`;

    const r = await axios.post(
      `${ADMIN_BASE}/${propertyId}/conversionEvents`,
      { eventName },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return res.json({ ok: true, created: r.data });
  } catch (err) {
    console.error('GA Admin create conversion error:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({ ok: false, error: err.response?.data || err.message });
  }
});

module.exports = router;
