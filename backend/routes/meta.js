// backend/routes/meta.js
'use strict';

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const router  = express.Router();

const User = require('../models/User');

let MetaAccount = null;
try { MetaAccount = require('../models/MetaAccount'); } catch (_) {}

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_DIALOG  = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;

const APP_ID       = process.env.FACEBOOK_APP_ID;
const APP_SECRET   = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;

// regla de UX: selector sólo si hay >3 cuentas
const MAX_BY_RULE = 3;

const SCOPES = [
  'ads_read',
  'ads_management',
  'business_management',
  'pages_read_engagement',
  'pages_show_list',
  'pages_manage_ads',
  'leads_retrieval',
  'email'
].join(',');

const DEFAULT_META_OBJECTIVE = 'ventas';

/* =========================
 * Helpers
 * ========================= */
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
  return data?.data || {};
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user?._id) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}

const normActId = (s = '') => String(s || '').replace(/^act_/, '').trim();
const toActId   = (s = '') => {
  const id = normActId(s);
  return id ? `act_${id}` : '';
};

const uniq = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).filter(Boolean)));

/* =========================
 * LOGIN
 * ========================= */
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

/* =========================
 * CALLBACK
 * ========================= */
router.get('/callback', async (req, res) => {
  if (!req.isAuthenticated?.() || !req.user?._id) return res.redirect('/login');

  const { code, state } = req.query || {};
  if (!code || !state || state !== req.session.fb_state) {
    delete req.session.fb_state;
    return res.redirect('/onboarding?meta=fail');
  }
  delete req.session.fb_state;

  try {
    // 1) exchange code -> short token
    const t1 = await exchangeCodeForToken(code);
    let accessToken = t1.access_token;
    let expiresAt   = t1.expires_in ? new Date(Date.now() + t1.expires_in * 1000) : null;

    // 2) upgrade to long-lived (best effort)
    try {
      const t2 = await toLongLivedToken(accessToken);
      if (t2?.access_token) {
        accessToken = t2.access_token;
        if (t2.expires_in) expiresAt = new Date(Date.now() + t2.expires_in * 1000);
      }
    } catch (e) {
      console.warn('Meta long-lived exchange falló:', e?.response?.data || e.message);
    }

    // 3) debug token validity
    const dbg = await debugToken(accessToken);
    if (dbg?.app_id !== APP_ID || dbg?.is_valid !== true) {
      return res.redirect('/onboarding?meta=error');
    }

    // 4) basic profile
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
    } catch {}

    // 5) ad accounts
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
        // guardamos ambos formatos por compatibilidad
        id: toActId(a.account_id),              // "act_XXXX"
        account_id: normActId(a.account_id),    // "XXXX"
        name: a.name,
        currency: a.currency,
        configured_status: a.configured_status,
        timezone_name: a.timezone_name || null
      }));
    } catch (e) {
      console.warn('No se pudieron leer adaccounts:', e?.response?.data || e.message);
    }

    // 6) granted scopes
    let grantedScopes = [];
    try {
      const proof = makeAppSecretProof(accessToken);
      const perms = await axios.get(`${FB_GRAPH}/me/permissions`, {
        params: { access_token: accessToken, appsecret_proof: proof, limit: 200 },
        timeout: 15000
      });
      grantedScopes = (perms.data?.data || [])
        .filter(p => p.status === 'granted' && p.permission)
        .map(p => String(p.permission));
      grantedScopes = uniq(grantedScopes);
    } catch (e) {
      console.warn('No se pudieron leer /me/permissions:', e?.response?.data || e.message);
    }

    const userId = req.user._id;

    // 7) actualiza User (no romper)
    await User.findByIdAndUpdate(userId, {
      $set: {
        metaConnected: true,
        metaFbUserId: fbUserId || undefined,
        metaScopes: grantedScopes
      }
    });

    // 8) persistencia en MetaAccount (canónico)
    const allDigits = adAccounts.map(a => normActId(a.account_id)).filter(Boolean);
    const shouldForceSelector = allDigits.length > MAX_BY_RULE;

    // selección canónica:
    // - si <=3: selecciona todas
    // - si >3: vacío (UI debe seleccionar)
    const selectedDigits = shouldForceSelector ? [] : uniq(allDigits);

    // default canónico:
    // - si <=3: primero
    // - si >3: null (para forzar selector)
    const defaultAccountId = shouldForceSelector ? null : (selectedDigits[0] || null);

    if (MetaAccount) {
      const up = await MetaAccount.findOneAndUpdate(
        { $or: [{ userId }, { user: userId }] },
        {
          $set: {
            userId,
            user: userId,

            // OJO: el modelo que me pasaste usa fb_user_id (snake_case)
            fb_user_id: fbUserId || undefined,
            email: email || undefined,
            name:  name  || undefined,

            // tokens (guardamos todos los alias por compatibilidad)
            longLivedToken: accessToken,
            longlivedToken: accessToken,
            access_token:   accessToken,
            accessToken:    accessToken,
            token:          accessToken,

            expiresAt:  expiresAt || null,
            expires_at: expiresAt || null,

            // cuentas (guardamos canónico; el router metaAccounts lee ambos de todos modos)
            ad_accounts: adAccounts,
            adAccounts:  adAccounts,

            // ✅ selección / default canónicos (Integraciones)
            selectedAccountIds: selectedDigits,     // sin act_
            defaultAccountId:   defaultAccountId,   // sin act_

            updatedAt: new Date()
          },
          $addToSet: { scopes: { $each: grantedScopes } }
        },
        { upsert: true, new: true }
      );

      // objetivo por defecto (si no existe)
      if (!up.objective) {
        await MetaAccount.updateOne(
          { _id: up._id },
          { $set: { objective: DEFAULT_META_OBJECTIVE, updatedAt: new Date() } }
        );
      }

      // espejo en User (legacy / UI vieja)
      // - si autoseleccionamos (<=3) reflejamos act_XXXX
      // - si >3 dejamos vacío para forzar selector
      await User.findByIdAndUpdate(userId, {
        $set: {
          metaObjective: DEFAULT_META_OBJECTIVE,
          selectedMetaAccounts: selectedDigits.map(toActId) // legacy con act_
        }
      });
    } else {
      // fallback legacy puro en User
      await User.findByIdAndUpdate(userId, {
        $set: {
          metaAccessToken: accessToken,
          metaTokenExpiresAt: expiresAt || null,
          metaDefaultAccountId: defaultAccountId,
          metaScopes: grantedScopes,
          metaObjective: DEFAULT_META_OBJECTIVE,
          selectedMetaAccounts: selectedDigits.map(toActId)
        }
      });
    }

    // 9) redirect final (mantenemos tu comportamiento actual)
    const destino = req.user.onboardingComplete
      ? '/dashboard'
      : `/onboarding?meta=ok&selector=${shouldForceSelector ? '1' : '0'}`;

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
 * STATUS (legacy)
 * ========================= */
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (!MetaAccount) {
      const u = await User.findById(req.user._id).lean();
      const scopes = Array.isArray(u?.metaScopes) ? u.metaScopes : [];
      return res.json({
        ok: true,
        connected: !!u?.metaAccessToken,
        hasAccounts: !!u?.metaDefaultAccountId,
        defaultAccountId: u?.metaDefaultAccountId || null,
        accounts: [],
        objective: u?.metaObjective ?? null,
        scopes,
        hasAdsRead: scopes.includes('ads_read'),
        hasAdsMgmt: scopes.includes('ads_management'),
        // extras útiles (no rompen)
        selectedMetaAccounts: Array.isArray(u?.selectedMetaAccounts) ? u.selectedMetaAccounts : [],
      });
    }

    const doc = await MetaAccount
      .findOne({ $or: [{ userId: req.user._id }, { user: req.user._id }] })
      .select('+longLivedToken +longlivedToken +access_token +token objective ad_accounts adAccounts defaultAccountId selectedAccountIds scopes')
      .lean();

    const connected = !!(doc?.longLivedToken || doc?.longlivedToken || doc?.access_token || doc?.token);
    const accounts  = doc?.ad_accounts || doc?.adAccounts || [];

    const defaultAccountId = doc?.defaultAccountId || accounts?.[0]?.account_id || null;
    const objective = doc?.objective ?? null;
    const scopes = Array.isArray(doc?.scopes) ? doc.scopes : [];
    const hasAdsRead = scopes.includes('ads_read');
    const hasAdsMgmt = scopes.includes('ads_management');

    res.json({
      ok: true,
      connected,
      hasAccounts: accounts.length > 0,
      defaultAccountId,
      accounts,
      objective,
      scopes,
      hasAdsRead,
      hasAdsMgmt,
      // extras útiles (no rompen)
      selectedAccountIds: Array.isArray(doc?.selectedAccountIds) ? doc.selectedAccountIds : [],
      selectionRequired: accounts.length > MAX_BY_RULE && (!doc?.selectedAccountIds || doc.selectedAccountIds.length === 0),
    });
  } catch (e) {
    console.error('status meta error:', e);
    res.status(500).json({ ok: false, error: 'status_error' });
  }
});

/* =========================
 * DEFAULT ACCOUNT (legacy)
 * ========================= */
router.post('/default-account', requireAuth, express.json(), async (req, res) => {
  try {
    const bodyId = req.body?.accountId || req.body?.account_id || '';
    const accountId = normActId(bodyId);
    if (!accountId) return res.status(400).json({ ok: false, error: 'account_required' });

    if (MetaAccount) {
      // carga cuentas para validar y ajustar selección
      const doc = await MetaAccount
        .findOne({ $or: [{ userId: req.user._id }, { user: req.user._id }] })
        .select('ad_accounts adAccounts selectedAccountIds defaultAccountId')
        .lean();

      const raw = doc?.ad_accounts || doc?.adAccounts || [];
      const available = new Set(raw.map(a => normActId(a?.account_id || a?.accountId || a?.id)));

      if (!available.has(accountId)) {
        return res.status(400).json({ ok: false, error: 'ACCOUNT_NOT_ALLOWED' });
      }

      // si ya hay selección canónica, garantizamos que el default esté dentro
      const prevSelected = Array.isArray(doc?.selectedAccountIds) ? doc.selectedAccountIds.map(normActId) : [];
      const nextSelected = prevSelected.length ? uniq([...prevSelected, accountId]) : prevSelected;

      await MetaAccount.findOneAndUpdate(
        { $or: [{ userId: req.user._id }, { user: req.user._id }] },
        {
          $set: {
            defaultAccountId: accountId,
            ...(nextSelected.length ? { selectedAccountIds: nextSelected } : {}),
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      // espejo legacy en User para no romper frontend viejo
      if (nextSelected.length) {
        await User.findByIdAndUpdate(req.user._id, {
          $set: { selectedMetaAccounts: nextSelected.map(toActId) }
        });
      }

      return res.json({ ok: true, defaultAccountId: accountId });
    }

    await User.findByIdAndUpdate(req.user._id, { $set: { metaDefaultAccountId: accountId } });
    res.json({ ok: true, defaultAccountId: accountId });
  } catch (e) {
    console.error('default-account meta error:', e);
    res.status(500).json({ ok: false, error: 'save_failed' });
  }
});

module.exports = router;
