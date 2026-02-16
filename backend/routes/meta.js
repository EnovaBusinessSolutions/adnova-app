// backend/routes/meta.js
'use strict';

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const router  = express.Router();

const User  = require('../models/User');
const Audit = require('../models/Audit');

// ✅ Analytics events (Internal Admin / DB analytics)
const { trackEvent } = require('../services/trackEvent');

// ✅ Auditorías: cleanup al desconectar (best-effort)
const {
  deleteAuditsForUserSources,
  countAuditsForUserSources,
} = require('../services/auditCleanup');

let MetaAccount = null;
try { MetaAccount = require('../models/MetaAccount'); } catch (_) {}

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_DIALOG  = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_GRAPH   = `https://graph.facebook.com/${FB_VERSION}`;

const APP_ID       = process.env.FACEBOOK_APP_ID;
const APP_SECRET   = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;

// ✅ Nuevo UX: máximo 1 cuenta por tipo
const MAX_SELECT = 1;

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

// ✅ Defaults de UX (sin onboarding)
const DEFAULT_RETURN_TO = '/dashboard/settings?tab=integrations';

/* =========================
 * Helpers
 * ========================= */
function safeAppSecretProof(accessToken) {
  if (!accessToken) return null;
  if (!APP_SECRET) return null;
  try {
    return crypto.createHmac('sha256', APP_SECRET).update(accessToken).digest('hex');
  } catch {
    return null;
  }
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

function appendQuery(url, key, value) {
  try {
    const u = new URL(url, 'http://local');
    u.searchParams.set(key, value);
    return u.pathname + (u.search ? u.search : '') + (u.hash ? u.hash : '');
  } catch {
    if (url.includes('?')) return `${url}&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    return `${url}?${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

/**
 * ✅ Blindaje anti open-redirect:
 * Solo permitimos returnTo relativo y dentro del dashboard/settings.
 */
function sanitizeReturnTo(raw) {
  const val = String(raw || '').trim();
  if (!val) return '';

  if (/^https?:\/\//i.test(val)) return '';
  if (val.includes('\n') || val.includes('\r')) return '';
  if (!val.startsWith('/')) return '';

  const allowed = [
    '/dashboard/settings',
    '/dashboard',
  ];
  const ok = allowed.some(prefix => val.startsWith(prefix));
  if (!ok) return '';

  if (val.startsWith('/dashboard/settings')) {
    return appendQuery(val, 'tab', 'integrations');
  }

  return val;
}

/**
 * ✅ Flow key para dedupe idempotente por sesión/flujo
 * - Evita que "meta_connected:<user>" mate el tracking para siempre.
 * - Idempotente dentro de una sesión: si Meta redirige 2 veces, no duplica.
 */
function getFlowKey(req) {
  const sid = req?.sessionID || req?.session?.id || null;
  if (sid) return String(sid);
  // fallback si por alguna razón no hay sessionID
  const tmp = crypto.randomBytes(12).toString('hex');
  return `nosession_${tmp}`;
}

/**
 * ✅ Revocar permisos de Meta (best-effort)
 */
async function revokeMetaPermissionsBestEffort(accessToken) {
  if (!accessToken) return { attempted: false, ok: true };

  try {
    const proof = safeAppSecretProof(accessToken);

    await axios.delete(`${FB_GRAPH}/me/permissions`, {
      params: {
        access_token: accessToken,
        ...(proof ? { appsecret_proof: proof } : {})
      },
      timeout: 15000
    });

    return { attempted: true, ok: true };
  } catch (e) {
    console.warn('[meta] revoke permissions failed (best-effort):', e?.response?.data || e.message);
    return { attempted: true, ok: false };
  }
}

/* =========================
 * LOGIN
 * ========================= */
router.get('/login', (req, res) => {
  if (!req.isAuthenticated?.() || !req.user?._id) return res.redirect('/login');

  // Validación suave de ENV (para no crashear)
  if (!APP_ID || !APP_SECRET || !REDIRECT_URI) {
    console.warn('[meta] Missing FACEBOOK_APP_ID/SECRET/REDIRECT_URI');
    const dest = appendQuery(DEFAULT_RETURN_TO, 'meta', 'error');
    return res.redirect(appendQuery(dest, 'reason', 'missing_env'));
  }

  const state = crypto.randomBytes(20).toString('hex');
  req.session.fb_state = state;

  const returnTo = sanitizeReturnTo(req.query.returnTo);
  if (returnTo) req.session.fb_returnTo = returnTo;
  else delete req.session.fb_returnTo;

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
    delete req.session.fb_returnTo;

    const dest0 = appendQuery(DEFAULT_RETURN_TO, 'meta', 'fail');
    return res.redirect(appendQuery(dest0, 'reason', 'bad_state'));
  }

  delete req.session.fb_state;

  try {
    // 1) exchange code -> short token
    const t1 = await exchangeCodeForToken(code);
    let accessToken = t1.access_token;
    let expiresAt   = t1.expires_in ? new Date(Date.now() + t1.expires_in * 1000) : null;

    if (!accessToken) {
      delete req.session.fb_returnTo;
      const dest0 = appendQuery(DEFAULT_RETURN_TO, 'meta', 'error');
      return res.redirect(appendQuery(dest0, 'reason', 'no_token'));
    }

    // 2) upgrade to long-lived (best effort)
    try {
      const t2 = await toLongLivedToken(accessToken);
      if (t2?.access_token) {
        accessToken = t2.access_token;
        if (t2.expires_in) expiresAt = new Date(Date.now() + t2.expires_in * 1000);
      }
    } catch (e) {
      console.warn('[meta] long-lived exchange falló:', e?.response?.data || e.message);
    }

    // 3) debug token validity
    const dbg = await debugToken(accessToken);
    if (String(dbg?.app_id) !== String(APP_ID) || dbg?.is_valid !== true) {
      delete req.session.fb_returnTo;
      const dest0 = appendQuery(DEFAULT_RETURN_TO, 'meta', 'error');
      return res.redirect(appendQuery(dest0, 'reason', 'invalid_token'));
    }

    // 4) basic profile
    let fbUserId = null, email = null, name = null;
    try {
      const proof = safeAppSecretProof(accessToken);
      const me = await axios.get(`${FB_GRAPH}/me`, {
        params: {
          fields: 'id,name,email',
          access_token: accessToken,
          ...(proof ? { appsecret_proof: proof } : {})
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
      const proof = safeAppSecretProof(accessToken);
      const ads = await axios.get(`${FB_GRAPH}/me/adaccounts`, {
        params: {
          fields: 'account_id,name,currency,configured_status,timezone_name',
          access_token: accessToken,
          ...(proof ? { appsecret_proof: proof } : {}),
          limit: 100
        },
        timeout: 15000
      });

      adAccounts = (ads.data?.data || []).map((a) => ({
        id: toActId(a.account_id),              // "act_XXXX"
        account_id: normActId(a.account_id),    // "XXXX"
        name: a.name,
        currency: a.currency,
        configured_status: a.configured_status,
        timezone_name: a.timezone_name || null
      }));
    } catch (e) {
      console.warn('[meta] No se pudieron leer adaccounts:', e?.response?.data || e.message);
    }

    // 6) granted scopes
    let grantedScopes = [];
    try {
      const proof = safeAppSecretProof(accessToken);
      const perms = await axios.get(`${FB_GRAPH}/me/permissions`, {
        params: {
          access_token: accessToken,
          ...(proof ? { appsecret_proof: proof } : {}),
          limit: 200
        },
        timeout: 15000
      });
      grantedScopes = (perms.data?.data || [])
        .filter(p => p.status === 'granted' && p.permission)
        .map(p => String(p.permission));
      grantedScopes = uniq(grantedScopes);
    } catch (e) {
      console.warn('[meta] No se pudieron leer /me/permissions:', e?.response?.data || e.message);
    }

    const userId = req.user._id;

    // 7) actualiza User
    await User.findByIdAndUpdate(userId, {
      $set: {
        metaConnected: true,
        metaFbUserId: fbUserId || undefined,
        metaScopes: grantedScopes
      }
    });

    // ✅ UX selector con MAX_SELECT=1
    const allDigits = adAccounts.map(a => normActId(a.account_id)).filter(Boolean);
    const availableCount = allDigits.length;
    const shouldForceSelector = availableCount > MAX_SELECT;

    const selectedDigits = shouldForceSelector ? [] : uniq(allDigits).slice(0, MAX_SELECT);
    const defaultAccountId = shouldForceSelector ? null : (selectedDigits[0] || null);

    if (MetaAccount) {
      const up = await MetaAccount.findOneAndUpdate(
        { $or: [{ userId }, { user: userId }] },
        {
          $set: {
            userId,
            user: userId,

            fb_user_id: fbUserId || undefined,
            email: email || undefined,
            name:  name  || undefined,

            // tokens (aliases por compat)
            longLivedToken: accessToken,
            longlivedToken: accessToken,
            access_token:   accessToken,
            accessToken:    accessToken,
            token:          accessToken,

            expiresAt:  expiresAt || null,
            expires_at: expiresAt || null,

            ad_accounts: adAccounts,
            adAccounts:  adAccounts,

            // ✅ selección/default canónicos
            selectedAccountIds: selectedDigits,     // digits sin act_
            defaultAccountId:   defaultAccountId,   // digits sin act_

            updatedAt: new Date()
          },
          $addToSet: { scopes: { $each: grantedScopes } }
        },
        { upsert: true, new: true }
      );

      if (!up.objective) {
        await MetaAccount.updateOne(
          { _id: up._id },
          { $set: { objective: DEFAULT_META_OBJECTIVE, updatedAt: new Date() } }
        );
      }

      // espejo legacy en User (UI vieja)
      await User.findByIdAndUpdate(userId, {
        $set: {
          metaObjective: DEFAULT_META_OBJECTIVE,
          selectedMetaAccounts: selectedDigits.map(toActId)
        }
      });
    } else {
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

    // ✅ 8) TRACK: meta_connected (E2E Internal Analytics)
    // FIX: dedupeKey por sesión/flow (no por usuario fijo)
    try {
      const flowKey = getFlowKey(req);
      await trackEvent({
        name: 'meta_connected',
        userId,
        source: 'app',
        dedupeKey: `meta_connected:${String(userId)}:${flowKey}`,
        ts: new Date(),
        props: {
          flowKey,
          sessionId: req.sessionID || null,
          fbUserId: fbUserId || null,
          accountsCount: Array.isArray(adAccounts) ? adAccounts.length : 0,
          scopesCount: Array.isArray(grantedScopes) ? grantedScopes.length : 0,
          forcedSelector: !!shouldForceSelector,
          selectedAccountIds: Array.isArray(selectedDigits) ? selectedDigits : [],
          defaultAccountId: defaultAccountId || null,
        },
      });
    } catch (e) {
      if (process.env.ANALYTICS_DEBUG === '1') {
        console.warn('[meta] track meta_connected failed:', e?.message || e);
      }
    }

    // ✅ 9) redirect final
    let destino = '';
    const sessionReturnTo = sanitizeReturnTo(req.session.fb_returnTo);
    delete req.session.fb_returnTo;

    destino = sessionReturnTo || DEFAULT_RETURN_TO;

    if (shouldForceSelector) {
      destino = appendQuery(destino, 'selector', '1');
    } else {
      destino = appendQuery(destino, 'selector', '0');
    }

    destino = appendQuery(destino, 'meta', 'ok');

    req.login(req.user, (err) => {
      if (err) {
        const dest0 = appendQuery(DEFAULT_RETURN_TO, 'meta', 'error');
        return res.redirect(appendQuery(dest0, 'reason', 'login_failed'));
      }
      return res.redirect(destino);
    });
  } catch (err) {
    console.error('❌ Meta callback error:', err?.response?.data || err.message);
    delete req.session.fb_returnTo;

    const dest0 = appendQuery(DEFAULT_RETURN_TO, 'meta', 'error');
    return res.redirect(appendQuery(dest0, 'reason', 'callback_exception'));
  }
});

/* =========================
 * ✅ ACCOUNTS (para selector / integraciones)
 * GET /auth/meta/accounts
 * ========================= */
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    if (!MetaAccount) {
      const u = await User.findById(userId).lean();
      const selected = Array.isArray(u?.selectedMetaAccounts)
        ? u.selectedMetaAccounts.map(normActId).filter(Boolean).slice(0, MAX_SELECT)
        : [];
      const def = u?.metaDefaultAccountId ? normActId(u.metaDefaultAccountId) : (selected[0] || null);

      return res.json({
        ok: true,
        accounts: [],
        selectedAccountIds: selected,
        defaultAccountId: def || null,
        selectionRequired: false,
      });
    }

    const doc = await MetaAccount
      .findOne({ $or: [{ userId }, { user: userId }] })
      .select('ad_accounts adAccounts defaultAccountId selectedAccountIds')
      .lean();

    const raw = doc?.ad_accounts || doc?.adAccounts || [];
    const accounts = raw.map((a) => ({
      id: toActId(a?.account_id || a?.accountId || a?.id),
      account_id: normActId(a?.account_id || a?.accountId || a?.id),
      name: a?.name || '',
      currency: a?.currency || null,
      configured_status: a?.configured_status || a?.configuredStatus || null,
      timezone_name: a?.timezone_name || a?.timezoneName || null,
    }));

    const available = new Set(accounts.map(a => normActId(a.account_id)).filter(Boolean));

    let selectedAccountIds = Array.isArray(doc?.selectedAccountIds)
      ? doc.selectedAccountIds.map(normActId).filter(Boolean)
      : [];

    selectedAccountIds = selectedAccountIds.filter(id => available.has(id)).slice(0, MAX_SELECT);

    const defaultAccountId =
      doc?.defaultAccountId && available.has(normActId(doc.defaultAccountId))
        ? normActId(doc.defaultAccountId)
        : (selectedAccountIds[0] || (accounts[0]?.account_id || null));

    const selectionRequired = accounts.length > MAX_SELECT && selectedAccountIds.length === 0;

    return res.json({
      ok: true,
      accounts,
      selectedAccountIds,
      defaultAccountId: defaultAccountId || null,
      selectionRequired,
    });
  } catch (e) {
    console.error('[meta] accounts error:', e);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

/* =========================
 * ✅ SAVE SELECTION (MAX_SELECT=1)
 * POST /auth/meta/accounts/selection
 * ========================= */
router.post('/accounts/selection', requireAuth, express.json(), async (req, res) => {
  try {
    const userId = req.user._id;

    const accountIdsRaw =
      req.body?.accountIds ||
      req.body?.accounts ||
      (req.body?.accountId ? [req.body.accountId] : null);

    if (!Array.isArray(accountIdsRaw)) {
      return res.status(400).json({ ok: false, error: 'accountIds[] requerido' });
    }

    const wanted = uniq(accountIdsRaw.map(normActId)).filter(Boolean).slice(0, MAX_SELECT);
    if (!wanted.length) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_ACCOUNTS' });
    }

    let finalSelected = wanted;

    if (!MetaAccount) {
      await User.updateOne(
        { _id: userId },
        {
          $set: {
            metaDefaultAccountId: wanted[0],
            selectedMetaAccounts: wanted.map(toActId),
          },
        }
      );

      // ✅ TRACK: meta_ads_selected (FIX dedupeKey por flow)
      try {
        const flowKey = getFlowKey(req);
        await trackEvent({
          name: 'meta_ads_selected',
          userId,
          source: 'app',
          dedupeKey: `meta_ads_selected:${String(userId)}:${flowKey}`,
          ts: new Date(),
          props: {
            flowKey,
            sessionId: req.sessionID || null,
            selectedAccountId: wanted[0],
            selectedAccountIds: wanted,
          },
        });
      } catch (e) {
        if (process.env.ANALYTICS_DEBUG === '1') {
          console.warn('[meta] track meta_ads_selected failed (no MetaAccount):', e?.message || e);
        }
      }

      return res.json({ ok: true, selectedAccountIds: wanted, defaultAccountId: wanted[0] });
    }

    const doc = await MetaAccount
      .findOne({ $or: [{ userId }, { user: userId }] })
      .select('_id ad_accounts adAccounts')
      .lean();

    if (!doc) return res.status(404).json({ ok: false, error: 'NO_METAACCOUNT' });

    const raw = doc?.ad_accounts || doc?.adAccounts || [];
    const available = new Set(raw.map(a => normActId(a?.account_id || a?.accountId || a?.id)).filter(Boolean));

    const selected = wanted.filter(id => available.has(id)).slice(0, MAX_SELECT);
    if (!selected.length) {
      return res.status(400).json({ ok: false, error: 'ACCOUNT_NOT_ALLOWED' });
    }

    finalSelected = selected;

    await MetaAccount.updateOne(
      { _id: doc._id },
      {
        $set: {
          selectedAccountIds: selected,
          defaultAccountId: selected[0],
          updatedAt: new Date(),
        },
      }
    );

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          selectedMetaAccounts: selected.map(toActId),
        },
      }
    );

    // ✅ TRACK: meta_ads_selected (FIX dedupeKey por flow)
    try {
      const flowKey = getFlowKey(req);
      await trackEvent({
        name: 'meta_ads_selected',
        userId,
        source: 'app',
        dedupeKey: `meta_ads_selected:${String(userId)}:${flowKey}`,
        ts: new Date(),
        props: {
          flowKey,
          sessionId: req.sessionID || null,
          selectedAccountId: selected[0],
          selectedAccountIds: selected,
        },
      });
    } catch (e) {
      if (process.env.ANALYTICS_DEBUG === '1') {
        console.warn('[meta] track meta_ads_selected failed:', e?.message || e);
      }
    }

    return res.json({ ok: true, selectedAccountIds: finalSelected, defaultAccountId: finalSelected[0] });
  } catch (e) {
    console.error('[meta] accounts/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
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
      selectedAccountIds: Array.isArray(doc?.selectedAccountIds) ? doc.selectedAccountIds : [],
      selectionRequired: accounts.length > MAX_SELECT && (!doc?.selectedAccountIds || doc.selectedAccountIds.length === 0),
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
      const doc = await MetaAccount
        .findOne({ $or: [{ userId: req.user._id }, { user: req.user._id }] })
        .select('ad_accounts adAccounts selectedAccountIds defaultAccountId')
        .lean();

      const raw = doc?.ad_accounts || doc?.adAccounts || [];
      const available = new Set(raw.map(a => normActId(a?.account_id || a?.accountId || a?.id)));

      if (!available.has(accountId)) {
        return res.status(400).json({ ok: false, error: 'ACCOUNT_NOT_ALLOWED' });
      }

      const nextSelected = [accountId];

      await MetaAccount.findOneAndUpdate(
        { $or: [{ userId: req.user._id }, { user: req.user._id }] },
        {
          $set: {
            defaultAccountId: accountId,
            selectedAccountIds: nextSelected,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      await User.findByIdAndUpdate(req.user._id, {
        $set: { selectedMetaAccounts: nextSelected.map(toActId) }
      });

      return res.json({ ok: true, defaultAccountId: accountId, selectedAccountIds: nextSelected });
    }

    await User.findByIdAndUpdate(req.user._id, { $set: { metaDefaultAccountId: accountId } });
    res.json({ ok: true, defaultAccountId: accountId });
  } catch (e) {
    console.error('default-account meta error:', e);
    res.status(500).json({ ok: false, error: 'save_failed' });
  }
});

/* =========================
 * ✅ Preview disconnect
 * ========================= */
router.get('/disconnect/preview', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    let count = 0;
    try {
      count = await Audit.countDocuments({ userId, type: 'meta' });
    } catch {
      count = 0;
    }

    try {
      const c = await countAuditsForUserSources(userId, ['meta']);
      if (typeof c?.count === 'number') count = c.count;
    } catch {}

    return res.json({
      ok: true,
      auditsToDelete: count,
      breakdown: { meta: count },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'PREVIEW_ERROR' });
  }
});

/* =========================
 * ✅ DISCONNECT META
 * ========================= */
router.post('/disconnect', requireAuth, express.json(), async (req, res) => {
  try {
    const userId = req.user._id;

    const before = await Audit.countDocuments({ userId, type: 'meta' }).catch(() => 0);

    let accessToken = null;

    if (MetaAccount) {
      const docTok = await MetaAccount
        .findOne({ $or: [{ userId }, { user: userId }] })
        .select('+longLivedToken +longlivedToken +access_token +accessToken +token')
        .lean();

      accessToken =
        docTok?.longLivedToken ||
        docTok?.longlivedToken ||
        docTok?.access_token ||
        docTok?.accessToken ||
        docTok?.token ||
        null;
    } else {
      const u = await User.findById(userId).select('metaAccessToken').lean();
      accessToken = u?.metaAccessToken || null;
    }

    const revoke = await revokeMetaPermissionsBestEffort(accessToken);

    if (MetaAccount) {
      await MetaAccount.updateOne(
        { $or: [{ userId }, { user: userId }] },
        {
          $set: {
            longLivedToken: null,
            longlivedToken: null,
            access_token: null,
            accessToken: null,
            token: null,

            expiresAt: null,
            expires_at: null,

            ad_accounts: [],
            adAccounts: [],

            selectedAccountIds: [],
            defaultAccountId: null,

            scopes: [],

            fb_user_id: null,
            email: null,
            name: null,

            updatedAt: new Date()
          }
        }
      );
    }

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          metaConnected: false,
          metaFbUserId: null,

          metaAccessToken: null,
          metaTokenExpiresAt: null,
          metaDefaultAccountId: null,
          metaScopes: [],

          selectedMetaAccounts: [],
        }
      }
    );

    let auditsDeleteOk = true;
    let auditsDeleteError = null;

    try {
      await deleteAuditsForUserSources(userId, ['meta']);
    } catch (e) {
      auditsDeleteOk = false;
      auditsDeleteError = e?.message || 'AUDIT_DELETE_FAILED';
      console.warn('[meta] audit cleanup failed (best-effort):', auditsDeleteError);
    }

    try {
      await Audit.deleteMany({ userId, type: 'meta' });
    } catch (e) {
      auditsDeleteOk = false;
      auditsDeleteError = auditsDeleteError || (e?.message || 'AUDIT_DELETE_FALLBACK_FAILED');
      console.warn('[meta] audit delete fallback failed:', e?.message || e);
    }

    const after = await Audit.countDocuments({ userId, type: 'meta' }).catch(() => 0);
    const auditsDeleted = Math.max(0, before - after);

    // ✅ TRACK: meta_disconnected (FIX dedupeKey por flow)
    try {
      const flowKey = getFlowKey(req);
      await trackEvent({
        name: 'meta_disconnected',
        userId,
        source: 'app',
        dedupeKey: `meta_disconnected:${String(userId)}:${flowKey}`,
        ts: new Date(),
        props: {
          flowKey,
          sessionId: req.sessionID || null,
          revokeAttempted: !!revoke?.attempted,
          revokeOk: !!revoke?.ok,
          auditsDeleted,
          auditsDeleteOk,
        },
      });
    } catch (e) {
      if (process.env.ANALYTICS_DEBUG === '1') {
        console.warn('[meta] track meta_disconnected failed:', e?.message || e);
      }
    }

    return res.json({
      ok: true,
      disconnected: true,
      revokeAttempted: revoke.attempted,
      revokeOk: revoke.ok,

      auditsDeleted,
      auditsDeleteOk,
      auditsDeleteError,
    });
  } catch (err) {
    console.error('[meta] disconnect error:', err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, error: 'DISCONNECT_ERROR' });
  }
});

module.exports = router;
