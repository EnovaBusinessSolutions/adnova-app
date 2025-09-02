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


const SCOPES = [
  'public_profile',
  'email',
  'ads_read',
  'ads_management',           
  'business_management',     
  'pages_read_engagement',
  'pages_show_list',
  'pages_manage_ads',         
  'leads_retrieval',
  'pages_manage_metadata',    
  'read_insights'            
].join(',');

function makeAppSecretProof(accessToken) {
  return crypto.createHmac('sha256', APP_SECRET).update(accessToken).digest('hex');
}

async function exchangeCodeForToken(code) {
  const { data } = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
    params: {
      client_id: APP_ID,
      client_secret: APP_SECRET,
      redirect_uri: REDIRECT_URI,
      code
    },
    timeout: 15000
  });
  return data; 
}

async function toLongLivedToken(shortToken) {
  const { data } = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: APP_ID,
      client_secret: APP_SECRET,
      fb_exchange_token: shortToken
    },
    timeout: 15000
  });
  return data; 
}

async function debugToken(userToken) {
  const appToken = `${APP_ID}|${APP_SECRET}`;
  const { data } = await axios.get(`${FB_GRAPH}/debug_token`, {
    params: { input_token: userToken, access_token: appToken },
    timeout: 15000
  });
  return data.data; 
}

function requireAuth(req, res, next) {
  if (!req.isAuthenticated?.() || !req.user?._id) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  next();
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
  
    const t1 = await exchangeCodeForToken(code);
    let finalAccessToken = t1.access_token;
    let finalExpiresAt   = t1.expires_in ? new Date(Date.now() + t1.expires_in * 1000) : null;

  
    try {
      const t2 = await toLongLivedToken(t1.access_token);
      if (t2?.access_token) {
        finalAccessToken = t2.access_token;
        if (t2.expires_in) finalExpiresAt = new Date(Date.now() + t2.expires_in * 1000);
      }
    } catch (_) { /* opcionalmente log */ }

    
    const dbg = await debugToken(finalAccessToken);
    if (dbg.app_id !== APP_ID || !dbg.is_valid) {
      return res.redirect('/onboarding?meta=error');
    }

    
    const meRes = await axios.get(`${FB_GRAPH}/me`, {
      params: {
        fields: 'id,name,email',
        access_token: finalAccessToken,
        appsecret_proof: makeAppSecretProof(finalAccessToken)
      },
      timeout: 15000
    });
    const { id: fbUserId, email, name } = meRes.data || {};

    
    let adAccounts = [], pages = [];
    try {
      const proof = makeAppSecretProof(finalAccessToken);
      const [ads, pgs] = await Promise.all([
        axios.get(`${FB_GRAPH}/me/adaccounts`, { params: { fields:'account_id,name', access_token: finalAccessToken, appsecret_proof: proof }, timeout: 15000 }),
        axios.get(`${FB_GRAPH}/me/accounts`,   { params: { fields:'id,name',        access_token: finalAccessToken, appsecret_proof: proof }, timeout: 15000 })
      ]);
      adAccounts = (ads.data?.data || []).map(a => ({ id: a.account_id, name: a.name }));
      pages      = (pgs.data?.data || []).map(p => ({ id: p.id,        name: p.name  }));
    } catch (_) { /* no-op */ }

    
    const updates = {
      metaConnected: true,
      metaAccessToken: finalAccessToken,
      metaFbUserId: fbUserId,
      metaEmail: email || null,
      metaTokenType: t1.token_type || null,
      metaTokenExpiresAt: finalExpiresAt || null
    };
    const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, { new: true });

    if (MetaAccount) {
      await MetaAccount.findOneAndUpdate(
        { user: updatedUser._id },
        {
          $set: {
            user: updatedUser._id,
            fb_user_id: fbUserId,
            email: email || null,
            name: name || null,
            access_token: finalAccessToken,
            expires_at: finalExpiresAt || null,
            scopes: dbg.scopes || [],
            ad_accounts: adAccounts,
            pages
          
          }
        },
        { upsert: true, new: true }
      );
    }

    
    req.login(updatedUser, (err) => {
      if (err) return res.redirect('/onboarding?meta=error');
      return res.redirect('/onboarding?meta=ok');
    });
  } catch (err) {
    console.error('❌ Error en callback de Meta:', err.response?.data || err.message);
    return res.redirect('/onboarding?meta=error');
  }
});


router.get(['/status', '/api/status'], requireAuth, async (req, res) => {
  let connected = false, objective = null;

  try {
    if (MetaAccount) {
      const doc = await MetaAccount.findOne({ user: req.user._id }).select('access_token objective').lean();
      connected = !!doc?.access_token;
      objective = doc?.objective || null;
    } else {
    
      const u = await User.findById(req.user._id).select('metaAccessToken metaObjective').lean();
      connected = !!u?.metaAccessToken;
      objective = u?.metaObjective || null;
    }
  } catch (_) {}

  res.json({ connected, objective });
});


router.post(['/objective', '/api/objective'], requireAuth, express.json(), async (req, res) => {
  const allowed = ['ventas', 'alcance', 'leads'];
  const { objective } = req.body || {};
  if (!allowed.includes(objective)) {
    return res.status(400).json({ error: 'objetivo_invalido' });
  }

  try {
    if (MetaAccount) {
      await MetaAccount.findOneAndUpdate(
        { user: req.user._id },
        { $set: { objective, updatedAt: new Date() } },
        { upsert: true }
      );
    } else {
      await User.findByIdAndUpdate(req.user._id, { $set: { metaObjective: objective } });
    }
    res.json({ ok: true, objective });
  } catch (e) {
    res.status(500).json({ error: 'save_failed' });
  }
});

module.exports = router;
