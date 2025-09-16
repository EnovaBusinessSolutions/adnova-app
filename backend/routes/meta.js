// backend/routes/meta.js
'use strict';

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const router  = express.Router();

const User = require('../models/User');

let MetaAccount = null;
try { MetaAccount = require('../models/MetaAccount'); } catch (_) {}

/* =========================
   Config & constantes
   ========================= */
const FB_VERSION   = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_DIALOG    = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_GRAPH     = `https://graph.facebook.com/${FB_VERSION}`;

const APP_ID       = process.env.FACEBOOK_APP_ID;
const APP_SECRET   = process.env.FACEBOOK_APP_SECRET;
// Debe apuntar a /auth/meta/callback exactamente
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;

// Scopes mínimos para Marketing API
const SCOPES = [
  'ads_read', 'ads_management', 'business_management',
  // opcionales útiles
  'pages_read_engagement', 'pages_show_list', 'pages_manage_ads',
  'pages_manage_metadata', 'leads_retrieval', 'read_insights', 'email'
].join(',');

/* =========================
   Utils
   ========================= */
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
  return data; // { access_token, token_type, expires_in }
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
  return data; // { access_token, token_type, expires_in }
}

async function debugToken(userToken) {
  const appToken = `${APP_ID}|${APP_SECRET}`;
  const { data } = await axios.get(`${FB_GRAPH}/debug_token`, {
    params: { input_token: userToken, access_token: appToken },
    timeout: 15000
  });
  return data?.data || {};
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user?._id) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}

const normActId = (s = '') => s.toString().replace(/^act_/, '').trim();
const toActId   = (s = '') => {
  const id = normActId(s);
  return id ? `act_${id}` : '';
};

/* =========================
   OAuth
   ========================= */

// GET /auth/meta/login
router.get('/login', (req, res) => {
  if (!req.isAuthenticated?.() || !req.user?._id) return res.redirect('/login');

  const state = crypto.randomBytes(20).toString('hex');
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

// GET /auth/meta/callback
router.get('/callback', async (req, res) => {
  if (!req.isAuthenticated?.() || !req.user?._id) return res.redirect('/login');

  // Validar state
  const { code, state } = req.query || {};
  if (!code || !state || state !== req.session.fb_state) {
    delete req.session.fb_state;
    return res.redirect('/onboarding?meta=fail');
  }
  delete req.session.fb_state;

  try {
    // 1) code -> short token
    const t1 = await exchangeCodeForToken(code);
    let accessToken = t1.access_token;
    let expiresAt   = t1.expires_in ? new Date(Date.now() + t1.expires_in * 1000) : null;

    // 2) short -> long lived
    try {
      const t2 = await toLongLivedToken(accessToken);
      if (t2?.access_token) {
        accessToken = t2.access_token;
        if (t2.expires_in) expiresAt = new Date(Date.now() + t2.expires_in * 1000);
      }
    } catch (e) {
      console.warn('Meta long-lived exchange falló:', e?.response?.data || e.message);
    }

    // 3) Validar token
    const dbg = await debugToken(accessToken);
    if (dbg?.app_id !== APP_ID || dbg?.is_valid !== true) {
      return res.redirect('/onboarding?meta=error');
    }

    // 4) Datos de usuario (opcional)
    let fbUserId = null, email = null, name = null;
    try {
      const me = await axios.get(`${FB_GRAPH}/me`, {
        params: {
          fields: 'id,name,email',
          access_token: accessToken,
          appsecret_proof: makeAppSecretProof(accessToken)
        },
        timeout: 15000
      });
      fbUserId = me.data?.id || null;
      email    = me.data?.email || null;
      name     = me.data?.name  || null;
    } catch {
      // no bloquea
    }

    // 5) Cuentas publicitarias
    let adAccounts = [];
    try {
      const proof = makeAppSecretProof(accessToken);
      const ads = await axios.get(`${FB_GRAPH}/me/adaccounts`, {
        params: {
          fields: 'account_id,name,currency,configured_status,timezone_name',
          access_token: accessToken,
          appsecret_proof: proof,
          limit: 100
        },
        timeout: 15000
      });
      adAccounts = (ads.data?.data || []).map((a) => ({
        id: toActId(a.account_id),             // "act_123"
        account_id: normActId(a.account_id),   // "123"
        name: a.name,
        currency: a.currency,
        configured_status: a.configured_status,
        timezone_name: a.timezone_name || null
      }));
    } catch (e) {
      console.warn('No se pudieron leer adaccounts:', e?.response?.data || e.message);
    }

    // 6) Persistir (User + MetaAccount)
    const userId = req.user._id;

    await User.findByIdAndUpdate(userId, {
      $set: {
        metaConnected: true,
        metaFbUserId: fbUserId || undefined
      }
    });

    // Guardamos con ambos nombres de token y ambos arrays (ad_accounts/adAccounts)
    const defaultAccountId = adAccounts?.[0]?.account_id || null; // "123"

    if (MetaAccount) {
      await MetaAccount.findOneAndUpdate(
        { $or: [{ userId }, { user: userId }] },
        {
          $set: {
            userId, user: userId,
            fbUserId: fbUserId || undefined,
            // compatibilidad de nombres:
            longLivedToken: accessToken,
            longlivedToken: accessToken,
            access_token:   accessToken,
            expiresAt:      expiresAt || null,
            ad_accounts:    adAccounts,
            adAccounts:     adAccounts,
            defaultAccountId,
            updatedAt: new Date()
          }
        },
        { upsert: true, new: true }
      );
    } else {
      // Fallback: si no existe el modelo, guarda al menos flag en User
      await User.findByIdAndUpdate(userId, {
        $set: {
          metaAccessToken: accessToken,
          metaTokenExpiresAt: expiresAt || null,
          metaDefaultAccountId: defaultAccountId
        }
      });
    }

    // 7) refrescar sesión y redirigir
    const destino = req.user.onboardingComplete ? '/dashboard' : '/onboarding?meta=ok';
    req.login(req.user, (err) => {
      if (err) return res.redirect('/onboarding?meta=error');
      return res.redirect(destino);
    });
  } catch (err) {
    console.error('❌ Meta callback error:', err?.response?.data || err.message);
    return res.redirect('/onboarding?meta=error');
  }
});

/* =========================
   API de estado y selección (compatibilidad)
   ========================= */

// GET /auth/meta/status  -> usado por código antiguo; ahora también devuelve `objective`
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (!MetaAccount) {
      const u = await User.findById(req.user._id).lean();
      return res.json({
        connected: !!u?.metaAccessToken,
        hasAccounts: !!u?.metaDefaultAccountId,
        defaultAccountId: u?.metaDefaultAccountId || null,
        accounts: [],
        objective: null
      });
    }

    const doc = await MetaAccount
      .findOne({ $or: [{ userId: req.user._id }, { user: req.user._id }] })
      .lean();

    const connected = !!(doc?.longLivedToken || doc?.longlivedToken || doc?.access_token || doc?.token);
    const accounts  = doc?.ad_accounts || doc?.adAccounts || [];
    const defaultAccountId = doc?.defaultAccountId || accounts?.[0]?.account_id || null;
    const objective = doc?.objective ?? null;

    res.json({
      connected,
      hasAccounts: accounts.length > 0,
      defaultAccountId,
      accounts,
      objective
    });
  } catch (e) {
    console.error('status meta error:', e);
    res.status(500).json({ error: 'status_error' });
  }
});

// POST /auth/meta/default-account  body: { accountId: "act_123" | "123" }
router.post('/default-account', requireAuth, express.json(), async (req, res) => {
  try {
    const bodyId = req.body?.accountId || '';
    const accountId = normActId(bodyId); // guardamos "123"
    if (!accountId) return res.status(400).json({ error: 'account_required' });

    if (MetaAccount) {
      await MetaAccount.findOneAndUpdate(
        { $or: [{ userId: req.user._id }, { user: req.user._id }] },
        { $set: { defaultAccountId: accountId, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.json({ ok: true, defaultAccountId: accountId });
    }

    await User.findByIdAndUpdate(req.user._id, { $set: { metaDefaultAccountId: accountId } });
    res.json({ ok: true, defaultAccountId: accountId });
  } catch (e) {
    console.error('default-account meta error:', e);
    res.status(500).json({ error: 'save_failed' });
  }
});

module.exports = router;
