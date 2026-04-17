// backend/routes/googleConnect.js
'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const axios = require('axios');

const { discoverAndEnrich, selfTest } = require('../services/googleAdsService');
const { collectGoogle } = require('../jobs/collect/googleCollector');

const router = express.Router();

const User = require('../models/User');
const Audit = require('../models/Audit');

const { deleteAuditsForUserSources } = require('../services/auditCleanup');
const McpData = require('../models/McpData');

const {
  enqueueGoogleAdsCollectBestEffort,
  enqueueGa4CollectBestEffort,
} = require('../queues/mcpQueue');

let markContextStale = null;
try {
  ({ markContextStale } = require('../services/mcpContextBuilder'));
} catch (_) {
  markContextStale = null;
}

/* =========================
 * Analytics Events
 * ========================= */
let trackEvent = null;
try {
  ({ trackEvent } = require('../services/trackEvent'));
} catch (_) {
  trackEvent = null;
}

/* =========================================================
 *  Modelo GoogleAccount (fallback si no existe el archivo)
 * =======================================================*/
let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;

  const AdAccountSchema = new Schema(
    {
      id: { type: String, required: true },
      name: { type: String },
      currencyCode: { type: String },
      timeZone: { type: String },
      status: { type: String },
    },
    { _id: false }
  );

  const schema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },

      email: { type: String, default: null },

      accessToken: { type: String, select: false },
      refreshToken: { type: String, select: false },
      scope: { type: [String], default: [] },
      expiresAt: { type: Date },

      managerCustomerId: { type: String },
      loginCustomerId: { type: String },
      defaultCustomerId: { type: String },
      customers: { type: Array, default: [] },
      ad_accounts: { type: [AdAccountSchema], default: [] },

      selectedCustomerIds: { type: [String], default: [] },

      gaProperties: { type: Array, default: [] },
      defaultPropertyId: { type: String },

      selectedPropertyIds: { type: [String], default: [] },

      selectedGaPropertyId: { type: String },

      connectedAds: { type: Boolean, default: false },
      connectedGa4: { type: Boolean, default: false },

      objective: { type: String, enum: ['ventas', 'alcance', 'leads'], default: null },
      lastAdsDiscoveryError: { type: String, default: null },
      lastAdsDiscoveryLog: { type: mongoose.Schema.Types.Mixed, default: null, select: false },

      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );

  schema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
  });

  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* =========================
 * ENV (Ads + GA4 separados)
 * ========================= */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_CONNECT_CALLBACK_URL,

  GOOGLE_GA4_CLIENT_ID,
  GOOGLE_GA4_CLIENT_SECRET,
  GOOGLE_GA4_REDIRECT_URI,
  GOOGLE_GA4_CALLBACK_URL,

  GOOGLE_MERCHANT_CLIENT_ID,
  GOOGLE_MERCHANT_CLIENT_SECRET,
  GOOGLE_MERCHANT_REDIRECT_URI,
  GOOGLE_MERCHANT_CALLBACK_URL,
} = process.env;

const DEFAULT_GOOGLE_OBJECTIVE = 'ventas';

const PRODUCT_ADS = 'ads';
const PRODUCT_GA4 = 'ga4';
const PRODUCT_MERCHANT = 'merchant';

/* =========================
 * Helpers
 * ========================= */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function oauthForProduct(product) {
  let clientId = GOOGLE_CLIENT_ID;
  let clientSecret = GOOGLE_CLIENT_SECRET;
  let redirectUri = GOOGLE_REDIRECT_URI || GOOGLE_CONNECT_CALLBACK_URL;

  if (product === PRODUCT_GA4) {
    clientId = GOOGLE_GA4_CLIENT_ID || clientId;
    clientSecret = GOOGLE_GA4_CLIENT_SECRET || clientSecret;
    redirectUri = GOOGLE_GA4_REDIRECT_URI || GOOGLE_GA4_CALLBACK_URL || redirectUri;
  } else if (product === PRODUCT_MERCHANT) {
    clientId     = GOOGLE_MERCHANT_CLIENT_ID     || clientId;
    clientSecret = GOOGLE_MERCHANT_CLIENT_SECRET || clientSecret;
    redirectUri  = GOOGLE_MERCHANT_REDIRECT_URI  || GOOGLE_MERCHANT_CALLBACK_URL || redirectUri;
  }

  if (!clientId || !clientSecret || !redirectUri) {
    console.warn('[googleConnect] Missing OAuth env vars for product:', product, {
      hasAdsClient: !!GOOGLE_CLIENT_ID,
      hasAdsSecret: !!GOOGLE_CLIENT_SECRET,
      hasAdsRedirect: !!(GOOGLE_REDIRECT_URI || GOOGLE_CONNECT_CALLBACK_URL),
      hasGa4Client: !!GOOGLE_GA4_CLIENT_ID,
      hasGa4Secret: !!GOOGLE_GA4_CLIENT_SECRET,
      hasGa4Redirect: !!(GOOGLE_GA4_REDIRECT_URI || GOOGLE_GA4_CALLBACK_URL),
    });
  }

  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
  });
}

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

async function revokeGoogleTokenBestEffort({ refreshToken, accessToken }) {
  const token = refreshToken || accessToken;
  if (!token) return { attempted: false, ok: true };

  const attempts = [
    { product: PRODUCT_ADS, client: oauthForProduct(PRODUCT_ADS) },
    { product: PRODUCT_GA4, client: oauthForProduct(PRODUCT_GA4) },
  ];

  let lastErr = null;
  for (const a of attempts) {
    try {
      await a.client.revokeToken(token);
      return { attempted: true, ok: true, via: a.product };
    } catch (e) {
      lastErr = e;
    }
  }

  console.warn(
    '[googleConnect] revokeToken failed (best-effort):',
    lastErr?.response?.data || lastErr?.message || lastErr
  );
  return { attempted: true, ok: false };
}

const normCustomerId = (s = '') =>
  String(s || '').replace(/^customers\//, '').replace(/[^\d]/g, '');
const normId = (s = '') => normCustomerId(s);

const normPropertyId = (val = '') => {
  const raw = String(val || '').trim();
  if (!raw) return '';
  if (/^properties\/\d+$/.test(raw)) return raw;
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits ? `properties/${digits}` : '';
};

const normMerchantId = (val = '') =>
  String(val || '').trim().replace(/^accounts\//, '').replace(/[^\d]/g, '');

const uniq = (arr = []) => [...new Set((arr || []).filter(Boolean))];

const normalizeScopes = (raw) =>
  Array.from(
    new Set(
      (Array.isArray(raw) ? raw : String(raw || '').split(/[,\s]+/))
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    )
  );

const ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const MERCHANT_SCOPE = 'https://www.googleapis.com/auth/content';

const hasAdwordsScope = (scopes = []) =>
  Array.isArray(scopes) && scopes.some((s) => String(s).includes('/auth/adwords'));

const hasGaScope = (scopes = []) =>
  Array.isArray(scopes) && scopes.some((s) => String(s).includes('/auth/analytics.readonly'));

const hasMerchantScope = (scopes = []) =>
  Array.isArray(scopes) && scopes.some((s) => String(s).includes('/auth/content'));

function getAdsTokenBundle(ga) {
  return {
    accessToken: ga?.accessToken || null,
    refreshToken: ga?.refreshToken || null,
    expiresAt: ga?.expiresAt || null,
    scopes: Array.isArray(ga?.scope) ? ga.scope : [],
  };
}

function getGa4TokenBundle(ga) {
  return {
    accessToken: ga?.ga4AccessToken || ga?.accessToken || null,
    refreshToken: ga?.ga4RefreshToken || ga?.refreshToken || null,
    expiresAt: ga?.ga4ExpiresAt || ga?.expiresAt || null,
    scopes: Array.isArray(ga?.ga4Scope) && ga.ga4Scope.length
      ? ga.ga4Scope
      : (Array.isArray(ga?.scope) ? ga.scope : []),
  };
}

function getMerchantTokenBundle(ga) {
  return {
    accessToken:  ga?.merchantAccessToken  || null,
    refreshToken: ga?.merchantRefreshToken || null,
    expiresAt:    ga?.merchantExpiresAt    || null,
    scopes: Array.isArray(ga?.merchantScope) && ga.merchantScope.length
      ? ga.merchantScope
      : (Array.isArray(ga?.scope) ? ga.scope : []),
  };
}

async function getFreshAccessTokenForProduct(gaDoc, product) {
  const bundle = product === PRODUCT_GA4
    ? getGa4TokenBundle(gaDoc)
    : product === PRODUCT_MERCHANT
      ? getMerchantTokenBundle(gaDoc)
      : getAdsTokenBundle(gaDoc);

  if (bundle?.accessToken && bundle?.expiresAt) {
    const ms = new Date(bundle.expiresAt).getTime() - Date.now();
    if (ms > 60_000) return bundle.accessToken;
  }

  const refreshToken = bundle?.refreshToken || null;
  const accessToken = bundle?.accessToken || null;

  if (!refreshToken && !accessToken) {
    throw new Error(`NO_${String(product || 'GOOGLE').toUpperCase()}_TOKENS`);
  }

  const client = oauthForProduct(product || null);
  client.setCredentials({
    refresh_token: refreshToken || undefined,
    access_token: accessToken || undefined,
  });

  try {
    const { credentials } = await client.refreshAccessToken();
    const freshAccess = credentials?.access_token || null;
    const freshExpiry = credentials?.expiry_date ? new Date(credentials.expiry_date) : null;

    if (freshAccess) {
      const $set = { updatedAt: new Date() };

      if (product === PRODUCT_GA4) {
        $set.ga4AccessToken = freshAccess;
        $set.ga4ExpiresAt = freshExpiry;
      } else if (product === PRODUCT_MERCHANT) {
        $set.merchantAccessToken = freshAccess;
        $set.merchantExpiresAt   = freshExpiry;
      } else {
        $set.accessToken = freshAccess;
        $set.expiresAt = freshExpiry;
      }

      await GoogleAccount.updateOne(
        { _id: gaDoc._id },
        { $set }
      );

      return freshAccess;
    }
  } catch (_) {
    // fallback
  }

  const t = await client.getAccessToken().catch(() => null);
  if (t?.token) return t.token;

  if (accessToken) return accessToken;

  throw new Error(`NO_${String(product || 'GOOGLE').toUpperCase()}_ACCESS_TOKEN`);
}

async function buildOAuthClientForProductFromDoc(gaDoc, product) {
  const accessToken = await getFreshAccessTokenForProduct(gaDoc, product);
  const client = oauthForProduct(product || null);
  client.setCredentials({ access_token: accessToken });
  return client;
}

function getProductFromReq(req) {
  const q = String(req.query.product || '').trim().toLowerCase();
  if (q === PRODUCT_ADS) return PRODUCT_ADS;
  if (q === PRODUCT_GA4) return PRODUCT_GA4;

  const path = String(req.path || '').toLowerCase();
  const full = String(req.originalUrl || '').toLowerCase();

  if (path.includes('/merchant') || full.includes('/merchant')) return PRODUCT_MERCHANT;
  if (path.includes('/ga') || full.includes('/ga/connect') || full.includes('/connect/ga4')) return PRODUCT_GA4;
  if (path.includes('/ads') || full.includes('/ads/connect') || full.includes('/connect/ads')) return PRODUCT_ADS;

  const rt = String(req.query.returnTo || '').toLowerCase();
  if (rt.includes('product=merchant') || rt.includes('merchant')) return PRODUCT_MERCHANT;
  if (rt.includes('product=ga4') || rt.includes('ga4')) return PRODUCT_GA4;
  if (rt.includes('product=ads') || rt.includes('google-ads') || rt.includes('gads')) return PRODUCT_ADS;

  return null;
}

function scopesForProduct(product) {
  const base = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  if (product === PRODUCT_ADS) return [...base, ADS_SCOPE];
  if (product === PRODUCT_GA4) return [...base, GA_SCOPE];
  if (product === PRODUCT_MERCHANT) return [...base, MERCHANT_SCOPE];

  return [...base, GA_SCOPE, ADS_SCOPE];
}

function filterSelectedByAvailable(selectedIds, availableSet) {
  const sel = Array.isArray(selectedIds) ? selectedIds : [];
  return sel.map(normId).filter(Boolean).filter((id) => availableSet.has(id));
}

function filterSelectedPropsByAvailable(selectedPropIds, availableSet) {
  const sel = Array.isArray(selectedPropIds) ? selectedPropIds : [];
  return sel.map(normPropertyId).filter(Boolean).filter((pid) => availableSet.has(pid));
}

function filterSelectedMerchantsByAvailable(selectedMerchantIds, availableSet) {
  return (Array.isArray(selectedMerchantIds) ? selectedMerchantIds : [])
    .map(normMerchantId).filter(Boolean).filter((id) => availableSet.has(id));
}

function emitEventBestEffort(req, name, props = {}, opts = {}) {
  if (!trackEvent) return;
  const userId = req?.user?._id;
  if (!userId) return;

  const ip =
    String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() ||
    req.ip ||
    null;

  const ua = String(req.headers['user-agent'] || '').slice(0, 240) || null;

  const payload = {
    name,
    userId,
    props: {
      ...props,
      route: req.originalUrl || null,
      ip,
      ua,
    },
  };

  if (opts.dedupeKey) payload.dedupeKey = opts.dedupeKey;

  Promise.resolve()
    .then(() => trackEvent(payload))
    .catch(() => {});
}

function shouldAutoEnqueueAdsAfterOAuth({ customers = [], selectedCustomerIds = [] } = {}) {
  return Array.isArray(customers) && customers.length === 1 &&
    Array.isArray(selectedCustomerIds) && selectedCustomerIds.length === 1;
}

function shouldAutoEnqueueGa4AfterOAuth({ properties = [], selectedPropertyIds = [] } = {}) {
  return Array.isArray(properties) && properties.length === 1 &&
    Array.isArray(selectedPropertyIds) && selectedPropertyIds.length === 1;
}

async function enqueueGoogleAdsAfterConnectBestEffort(req, { accountId = null, reason = 'google_ads_connect' } = {}) {
  const userId = req?.user?._id;
  if (!userId) return { ok: false, error: 'NO_USER' };

  // Mark signal stale immediately so frontend stops showing old signal as valid
  if (markContextStale) {
    try {
      await markContextStale(userId, 'source_connected', {
        source: 'googleAds',
        reason,
        triggeredAt: new Date().toISOString(),
      });
    } catch (_) { /* best effort */ }
  }

  const result = await enqueueGoogleAdsCollectBestEffort({
    userId,
    accountId: accountId || null,
    rangeDays: 30,
    reason,
    trigger: 'googleConnect',
    forceFull: true,
    extra: {
      route: req.originalUrl || null,
    },
  });

  emitEventBestEffort(req, 'google_ads_mcp_enqueue_result', {
    ok: !!result?.ok,
    jobId: result?.jobId || null,
    error: result?.error || null,
    accountId: accountId || null,
    reason,
  });

  return result;
}

async function enqueueGa4AfterConnectBestEffort(req, { propertyId = null, reason = 'ga4_connect' } = {}) {
  const userId = req?.user?._id;
  if (!userId) return { ok: false, error: 'NO_USER' };

  // Mark signal stale immediately so frontend stops showing old signal as valid
  if (markContextStale) {
    try {
      await markContextStale(userId, 'source_connected', {
        source: 'ga4',
        reason,
        triggeredAt: new Date().toISOString(),
      });
    } catch (_) { /* best effort */ }
  }

  const result = await enqueueGa4CollectBestEffort({
    userId,
    propertyId: propertyId || null,
    rangeDays: 30,
    reason,
    trigger: 'googleConnect',
    forceFull: true,
    extra: {
      route: req.originalUrl || null,
    },
  });

  emitEventBestEffort(req, 'ga4_mcp_enqueue_result', {
    ok: !!result?.ok,
    jobId: result?.jobId || null,
    error: result?.error || null,
    propertyId: propertyId || null,
    reason,
  });

  return result;
}

async function fetchGA4Properties(oauthClient) {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: oauthClient });

  try {
    const props = [];
    const accounts = await admin.accounts
      .list({ pageSize: 200 })
      .then((r) => r.data.accounts || [])
      .catch(() => []);

    for (const acc of accounts) {
      const accountId = (acc.name || '').split('/')[1];
      if (!accountId) continue;
      try {
        const resp = await admin.properties.list({
          filter: `parent:accounts/${accountId}`,
          pageSize: 200,
        });
        const list = resp.data.properties || [];
        for (const p of list) {
          props.push({
            propertyId: p.name,
            displayName: p.displayName || p.name,
            timeZone: p.timeZone,
            currencyCode: p.currencyCode,
          });
        }
      } catch (e) {
        console.warn(
          'properties.list fail for account',
          accountId,
          e?.response?.data || e.message
        );
      }
    }

    if (props.length) return props;
  } catch (_) {
    // fallback
  }

  const out = [];
  let pageToken;

  do {
    const resp = await admin.accountSummaries.list({
      pageSize: 200,
      pageToken,
    });

    const summaries = resp?.data?.accountSummaries || [];
    for (const s of summaries) {
      const props = Array.isArray(s?.propertySummaries) ? s.propertySummaries : [];
      for (const p of props) {
        out.push({
          propertyId: p.property,
          displayName: p.displayName || p.property,
          timeZone: null,
          currencyCode: null,
        });
      }
    }

    pageToken = resp?.data?.nextPageToken || undefined;
  } while (pageToken);

  return out;
}

async function fetchMerchantAccounts(oauthClient) {
  const accessToken = oauthClient?.credentials?.access_token;
  if (!accessToken) throw new Error('MERCHANT_ACCESS_TOKEN_MISSING');

  const out = [];
  let pageToken = null;

  do {
    const { data } = await axios.get(
      'https://merchantapi.googleapis.com/accounts/v1beta/accounts',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { pageSize: 250, ...(pageToken ? { pageToken } : {}) },
        timeout: 30000,
      }
    );

    for (const account of Array.isArray(data?.accounts) ? data.accounts : []) {
      const merchantId = normMerchantId(account?.accountId || account?.name || '');
      if (!merchantId) continue;
      out.push({
        merchantId,
        displayName:   account?.accountName || account?.displayName || `Merchant ${merchantId}`,
        websiteUrl:    account?.homepage || account?.homepageUri || null,
        accountStatus: account?.accountStatus || account?.state || null,
        aggregatorId:  normMerchantId(account?.aggregatorId || ''),
        source: 'merchant',
      });
    }
    pageToken = data?.nextPageToken || null;
  } while (pageToken);

  const map = new Map();
  for (const a of out) map.set(a.merchantId, a);
  return Array.from(map.values()).sort((a, b) =>
    String(a.displayName || a.merchantId).localeCompare(String(b.displayName || b.merchantId))
  );
}

function buildAuthUrl(req, returnTo, product) {
  const client = oauthForProduct(product);
  const safeReturnTo = sanitizeReturnTo(returnTo) || '/dashboard/';

  const state = JSON.stringify({
    uid: String(req.user._id),
    returnTo: safeReturnTo,
    product: product || null,
  });

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: false,
    scope: scopesForProduct(product),
    state,
  });
}

async function startConnect(req, res) {
  try {
    const returnTo =
      typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
        ? req.query.returnTo
        : '/dashboard/';

    const product = getProductFromReq(req);

    emitEventBestEffort(req, 'google_connect_started', {
      returnTo: sanitizeReturnTo(returnTo) || '/dashboard/',
      product: product || 'both',
    });

    const url = buildAuthUrl(req, returnTo, product);
    return res.redirect(url);
  } catch (err) {
    console.error('[googleConnect] connect error:', err);
    emitEventBestEffort(req, 'google_connect_failed', {
      stage: 'build_auth_url',
      error: String(err?.message || err),
    });

    return res.redirect('/dashboard/?google=error&reason=connect_build');
  }
}

router.get('/connect', requireSession, startConnect);

router.get('/ads', requireSession, (req, res) => {
  req.query.product = PRODUCT_ADS;
  return startConnect(req, res);
});

router.get('/ga', requireSession, (req, res) => {
  req.query.product = PRODUCT_GA4;
  return startConnect(req, res);
});

router.get('/ads/connect', requireSession, (req, res) => {
  req.query.product = PRODUCT_ADS;
  return startConnect(req, res);
});

router.get('/ga/connect', requireSession, (req, res) => {
  req.query.product = PRODUCT_GA4;
  return startConnect(req, res);
});

router.get('/connect/ads', requireSession, (req, res) => {
  req.query.product = PRODUCT_ADS;
  return startConnect(req, res);
});

router.get('/connect/ga4', requireSession, (req, res) => {
  req.query.product = PRODUCT_GA4;
  return startConnect(req, res);
});

router.get('/merchant', requireSession, (req, res) => {
  req.query.product = PRODUCT_MERCHANT;
  return startConnect(req, res);
});
router.get('/merchant/connect', requireSession, (req, res) => {
  req.query.product = PRODUCT_MERCHANT;
  return startConnect(req, res);
});
router.get('/connect/merchant', requireSession, (req, res) => {
  req.query.product = PRODUCT_MERCHANT;
  return startConnect(req, res);
});

async function googleCallbackHandler(req, res) {
  try {
    if (req.query.error) {
      emitEventBestEffort(req, 'google_connect_failed', {
        stage: 'oauth_error',
        error: String(req.query.error),
      });
      return res.redirect(`/dashboard/?google=error&reason=${encodeURIComponent(req.query.error)}`);
    }

    const code = req.query.code;
    if (!code) {
      emitEventBestEffort(req, 'google_connect_failed', { stage: 'missing_code' });
      return res.redirect('/dashboard/?google=error&reason=no_code');
    }

    let returnTo = '/dashboard/';
    let productFromState = null;

    if (req.query.state) {
      try {
        const s = JSON.parse(req.query.state);
        if (s && typeof s.returnTo === 'string' && s.returnTo.trim()) {
          const safe = sanitizeReturnTo(s.returnTo);
          if (safe) returnTo = safe;
        }
        if (s && typeof s.product === 'string') {
          const p = String(s.product).toLowerCase();
          if (p === PRODUCT_ADS || p === PRODUCT_GA4 || p === PRODUCT_MERCHANT) productFromState = p;
        }
      } catch {
        // ignore
      }
    }

    const client = oauthForProduct(productFromState || null);

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    const grantedScopes = normalizeScopes(tokens.scope || []);

    if (!accessToken) {
      emitEventBestEffort(req, 'google_connect_failed', { stage: 'missing_access_token' });
      return res.redirect('/dashboard/?google=error&reason=no_access_token');
    }

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: profile } = await oauth2.userinfo.get().catch(() => ({ data: {} }));

    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    let ga = await GoogleAccount.findOne(q).select(
      [
        '+refreshToken',
        '+accessToken',
        '+scope',
        '+ga4RefreshToken',
        '+ga4AccessToken',
        '+ga4Scope',
        '+merchantRefreshToken',
        '+merchantAccessToken',
        '+merchantScope',
        'selectedCustomerIds',
        'selectedPropertyIds',
        'selectedGaPropertyId',
        'defaultCustomerId',
        'defaultPropertyId',
        'customers',
        'ad_accounts',
        'gaProperties',
        'merchantAccounts',
        'selectedMerchantIds',
        'defaultMerchantId',
        'connectedAds',
        'connectedGa4',
        'connectedMerchant',
      ].join(' ')
    );

    if (!ga) {
      ga = new GoogleAccount({ user: req.user._id, userId: req.user._id });
    }

    ga.email = profile.email || ga.email || null;

    if (productFromState === PRODUCT_GA4) {
      if (refreshToken) ga.ga4RefreshToken = refreshToken;
      else if (!ga.ga4RefreshToken && tokens.refresh_token) ga.ga4RefreshToken = tokens.refresh_token;

      ga.ga4AccessToken = accessToken;
      ga.ga4ExpiresAt = expiresAt;

      const existing = Array.isArray(ga.ga4Scope) ? ga.ga4Scope : [];
      ga.ga4Scope = normalizeScopes([...existing, ...grantedScopes]);

      ga.connectedGa4 = true;
    } else if (productFromState === PRODUCT_MERCHANT) {
      if (refreshToken) ga.merchantRefreshToken = refreshToken;
      ga.merchantAccessToken  = accessToken;
      ga.merchantExpiresAt    = expiresAt;
      ga.merchantConnectedAt  = new Date();
      const existing = Array.isArray(ga.merchantScope) ? ga.merchantScope : [];
      ga.merchantScope = normalizeScopes([...existing, ...grantedScopes]);
      ga.connectedMerchant = true;
    } else {
      if (refreshToken) ga.refreshToken = refreshToken;
      else if (!ga.refreshToken && tokens.refresh_token) ga.refreshToken = tokens.refresh_token;

      ga.accessToken = accessToken;
      ga.expiresAt = expiresAt;

      const existing = Array.isArray(ga.scope) ? ga.scope : [];
      ga.scope = normalizeScopes([...existing, ...grantedScopes]);

      ga.connectedAds = true;
    }

    ga.updatedAt = new Date();
    await ga.save();

    const adsScopesNow = Array.isArray(ga.scope) ? ga.scope : [];
    const ga4ScopesNow = Array.isArray(ga.ga4Scope) ? ga.ga4Scope : [];

    emitEventBestEffort(req, 'google_connect_completed', {
      product: productFromState || 'both',
      hasAdsRefreshToken: !!ga.refreshToken,
      hasAdsAccessToken: !!ga.accessToken,
      hasGa4RefreshToken: !!ga.ga4RefreshToken,
      hasGa4AccessToken: !!ga.ga4AccessToken,
      adsScopesCount: adsScopesNow.length,
      ga4ScopesCount: ga4ScopesNow.length,
      adsScopeOk: hasAdwordsScope(adsScopesNow),
      ga4ScopeOk: hasGaScope(ga4ScopesNow),
      connectedAds: !!ga.connectedAds,
      connectedGa4: !!ga.connectedGa4,
    });

    const shouldDoAds      = productFromState === PRODUCT_ADS || (!productFromState);
    const shouldDoGa4      = productFromState === PRODUCT_GA4 || (!productFromState);
    const shouldDoMerchant = productFromState === PRODUCT_MERCHANT;

    // ============================
    // 1) Descubrir cuentas de Ads (solo si aplica)
    // ============================
    if (shouldDoAds && hasAdwordsScope(ga.scope) && ga.refreshToken) {
      try {
        const enriched = await discoverAndEnrich(ga);

        const customers = enriched.map((c) => ({
          id: normId(c.id),
          descriptiveName: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        const ad_accounts = enriched.map((c) => ({
          id: normId(c.id),
          name: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        const previous = normId(ga.defaultCustomerId || '');
        const firstEnabledId = ad_accounts.find((a) => (a.status || '').toUpperCase() === 'ENABLED')?.id;
        const defaultCustomerId = previous || firstEnabledId || (ad_accounts[0]?.id || null);

        ga.customers = customers;
        ga.ad_accounts = ad_accounts;

        if (defaultCustomerId) ga.defaultCustomerId = normId(defaultCustomerId);

        const available = new Set(customers.map((c) => normId(c.id)).filter(Boolean));
        const adsCount = customers.length;

        if (adsCount === 1) {
          const onlyId = normId(customers[0].id);
          ga.selectedCustomerIds = [onlyId];

          await User.updateOne(
            { _id: req.user._id },
            {
              $set: {
                selectedGoogleAccounts: [onlyId],
                'preferences.googleAds.auditAccountIds': [onlyId],
              },
            }
          );

          emitEventBestEffort(req, 'google_ads_selection_autoset', {
            selectedCustomerIds: [onlyId],
            reason: 'single_account',
          });
        } else if (adsCount > 1) {
          const kept = filterSelectedByAvailable(ga.selectedCustomerIds, available);
          ga.selectedCustomerIds = kept;
        }

        if (Array.isArray(ga.selectedCustomerIds) && ga.selectedCustomerIds.length) {
          const d = normId(ga.defaultCustomerId || '');
          if (!d || !ga.selectedCustomerIds.includes(d)) {
            ga.defaultCustomerId = ga.selectedCustomerIds[0];
          }
        }

        ga.lastAdsDiscoveryError = null;
        ga.lastAdsDiscoveryLog = null;
        ga.updatedAt = new Date();
        await ga.save();

        emitEventBestEffort(req, 'google_ads_discovered', {
          customersCount: customers.length,
          adAccountsCount: ad_accounts.length,
          selectedCount: Array.isArray(ga.selectedCustomerIds) ? ga.selectedCustomerIds.length : 0,
          hasDefaultCustomerId: !!ga.defaultCustomerId,
        });

        const shouldAutoEnqueueAds = shouldAutoEnqueueAdsAfterOAuth({
          customers,
          selectedCustomerIds: ga.selectedCustomerIds,
        });

        if (shouldAutoEnqueueAds) {
          const adsMcpAccountId =
            (Array.isArray(ga.selectedCustomerIds) && ga.selectedCustomerIds.length
              ? ga.selectedCustomerIds[0]
              : null) ||
            normId(ga.defaultCustomerId || '') ||
            normId(ad_accounts?.[0]?.id || '') ||
            null;

          await enqueueGoogleAdsAfterConnectBestEffort(req, {
            accountId: adsMcpAccountId,
            reason: 'google_ads_selection_autoset',
          });

          void (async () => {
            try {
              const userId = req?.user?._id;
              if (!userId || !adsMcpAccountId) return;

              const bootstrapSnapshotId = `snap_bootstrap_google_${Date.now()}`;
              const r = await collectGoogle(userId, {
                account_id: adsMcpAccountId,
                rangeDays: 120,
                storageRangeDays: 30,
                buildHistoricalDatasets: false,
                historyIncludeCampaignDaily: false,
              });

              if (!r?.ok || !Array.isArray(r?.datasets)) return;

              const dailyDs = r.datasets.filter((ds) => ds?.dataset === 'google.daily_trends_ai');
              if (!dailyDs.length) return;

              for (const ds of dailyDs) {
                await McpData.upsertChunk({
                  userId,
                  snapshotId: bootstrapSnapshotId,
                  source: ds.source,
                  dataset: ds.dataset,
                  range: ds.range,
                  data: ds.data,
                  stats: ds.stats,
                });
              }

              console.log('[googleConnect] bootstrap google.daily_trends_ai saved', {
                userId: String(userId),
                snapshotId: bootstrapSnapshotId,
                chunks: dailyDs.length,
              });
            } catch (e) {
              console.warn('[googleConnect] bootstrap google failed (best-effort):', e?.message || e);
            }
          })();
        }

        try {
          const st = await selfTest(ga);
          console.log('[googleConnect] Google Ads selfTest:', st);
        } catch (err) {
          console.warn('[googleConnect] selfTest error:', err.message);
        }
      } catch (e) {
        const reason = e?.response?.data || e?.message || 'DISCOVERY_FAILED';
        console.warn('Ads discovery failed:', reason);
        ga.lastAdsDiscoveryError = String(reason).slice(0, 4000);
        ga.updatedAt = new Date();
        await ga.save();

        emitEventBestEffort(req, 'google_ads_discovery_failed', {
          error: String(e?.message || e),
        });
      }
    } else {
      if (shouldDoAds && !hasAdwordsScope(ga.scope)) {
        ga.lastAdsDiscoveryError = 'ADS_SCOPE_MISSING';
        await ga.save();
        emitEventBestEffort(req, 'google_ads_scope_missing', { scopes: ga.scope || [] });
      }
    }

    // ============================
    // 2) Listar properties GA4 (solo si aplica)
    // ============================
    const ga4Scopes = Array.isArray(ga.ga4Scope) ? ga.ga4Scope : [];
    const ga4HasScope = hasGaScope(ga4Scopes) || hasGaScope(ga.scope);
    const ga4HasRefresh = !!(ga.ga4RefreshToken || ga.refreshToken);

    if (shouldDoGa4 && ga4HasScope && ga4HasRefresh) {
      try {
        const ga4Client = await buildOAuthClientForProductFromDoc(ga, PRODUCT_GA4);
        const propsRaw = await fetchGA4Properties(ga4Client);

        const map = new Map();
        for (const p of Array.isArray(propsRaw) ? propsRaw : []) {
          const pid = normPropertyId(p?.propertyId || p?.name || '');
          if (!pid) continue;
          map.set(pid, {
            propertyId: pid,
            displayName: p?.displayName || pid,
            timeZone: p?.timeZone || null,
            currencyCode: p?.currencyCode || null,
          });
        }
        const props = Array.from(map.values());

        if (props.length > 0) {
          ga.gaProperties = props;

          const availableProps = new Set(props.map((p) => p.propertyId));

          const currDefault = normPropertyId(ga.defaultPropertyId);
          if (!currDefault || !availableProps.has(currDefault)) {
            ga.defaultPropertyId = props[0].propertyId;
          } else {
            ga.defaultPropertyId = currDefault;
          }

          if (props.length === 1) {
            const onlyPid = props[0].propertyId;
            ga.selectedPropertyIds = [onlyPid];
            ga.selectedGaPropertyId = onlyPid;
            ga.defaultPropertyId = onlyPid;

            await User.updateOne(
              { _id: req.user._id },
              {
                $set: {
                  selectedGAProperties: [onlyPid],
                  'preferences.googleAnalytics.auditPropertyIds': [onlyPid],
                },
              }
            );

            emitEventBestEffort(req, 'ga4_selection_autoset', {
              selectedPropertyIds: [onlyPid],
              reason: 'single_property',
            });
          } else if (props.length > 1) {
            let kept = filterSelectedPropsByAvailable(ga.selectedPropertyIds, availableProps);

            if (!kept.length) {
              const legacy = normPropertyId(ga.selectedGaPropertyId);
              if (legacy && availableProps.has(legacy)) kept = [legacy];
            }

            ga.selectedPropertyIds = kept;

            if (kept.length) {
              ga.selectedGaPropertyId = kept[0];
              if (!ga.defaultPropertyId || !kept.includes(normPropertyId(ga.defaultPropertyId))) {
                ga.defaultPropertyId = kept[0];
              }
            } else {
              ga.selectedGaPropertyId = null;
            }
          }

          ga.updatedAt = new Date();
          await ga.save();

          emitEventBestEffort(req, 'ga4_properties_discovered', {
            propertiesCount: props.length,
            selectedCount: Array.isArray(ga.selectedPropertyIds) ? ga.selectedPropertyIds.length : 0,
            hasDefaultPropertyId: !!ga.defaultPropertyId,
          });

          const shouldAutoEnqueueGa4 = shouldAutoEnqueueGa4AfterOAuth({
            properties: props,
            selectedPropertyIds: ga.selectedPropertyIds,
          });

          if (shouldAutoEnqueueGa4) {
            const ga4McpPropertyId =
              (Array.isArray(ga.selectedPropertyIds) && ga.selectedPropertyIds.length
                ? ga.selectedPropertyIds[0]
                : null) ||
              normPropertyId(ga.selectedGaPropertyId || '') ||
              normPropertyId(ga.defaultPropertyId || '') ||
              normPropertyId(props?.[0]?.propertyId || '') ||
              null;

            await enqueueGa4AfterConnectBestEffort(req, {
              propertyId: ga4McpPropertyId,
              reason: 'ga4_selection_autoset',
            });
          }
        }
      } catch (e) {
        console.warn('GA4 properties listing failed:', e?.response?.data || e.message);
        emitEventBestEffort(req, 'ga4_properties_discovery_failed', { error: String(e?.message || e) });
      }
    } else {
      const ga4ScopesNow = Array.isArray(ga.ga4Scope) ? ga.ga4Scope : [];
      const ga4ScopePresent = hasGaScope(ga4ScopesNow) || hasGaScope(ga.scope);

      if (shouldDoGa4 && !ga4ScopePresent) {
        emitEventBestEffort(req, 'ga4_scope_missing', {
          scopes: ga.scope || [],
          ga4Scopes: ga.ga4Scope || [],
        });
      }
    }

    // ============================
    // 3) Descubrir cuentas Merchant (solo si aplica)
    // ============================
    const merchantHasScope   = hasMerchantScope(ga.merchantScope || []);
    const merchantHasRefresh = !!(ga.merchantRefreshToken || ga.merchantAccessToken);

    if (shouldDoMerchant && merchantHasScope && merchantHasRefresh) {
      try {
        const merchantClient   = await buildOAuthClientForProductFromDoc(ga, PRODUCT_MERCHANT);
        const merchantAccounts = await fetchMerchantAccounts(merchantClient);

        ga.merchantAccounts = merchantAccounts;
        const availableIds  = new Set(merchantAccounts.map((a) => normMerchantId(a.merchantId)).filter(Boolean));
        const kept          = filterSelectedMerchantsByAvailable(ga.selectedMerchantIds, availableIds);

        if (merchantAccounts.length === 1) {
          const onlyId = normMerchantId(merchantAccounts[0].merchantId);
          ga.selectedMerchantIds = onlyId ? [onlyId] : [];
          ga.defaultMerchantId   = onlyId || null;
        } else {
          ga.selectedMerchantIds = kept;
          ga.defaultMerchantId   = kept.length ? kept[0] : null;
        }

        ga.lastMerchantDiscoveryError = null;
        ga.lastMerchantDiscoveryLog   = { discoveredAt: new Date().toISOString(), count: merchantAccounts.length };
        ga.updatedAt = new Date();
        await ga.save();
      } catch (e) {
        const reason = e?.response?.data || e?.message || 'MERCHANT_DISCOVERY_FAILED';
        ga.lastMerchantDiscoveryError = String(typeof reason === 'string' ? reason : JSON.stringify(reason)).slice(0, 4000);
        ga.updatedAt = new Date();
        await ga.save();
      }
    }

    await User.findByIdAndUpdate(req.user._id, {
      $set: { googleConnected: true },
    });

    const [uObj, gaObj] = await Promise.all([
      User.findById(req.user._id).select('googleObjective').lean(),
      GoogleAccount.findOne(q).select('objective').lean(),
    ]);

    if (!(uObj?.googleObjective) && !(gaObj?.objective)) {
      await Promise.all([
        User.findByIdAndUpdate(req.user._id, {
          $set: { googleObjective: DEFAULT_GOOGLE_OBJECTIVE },
        }),
        GoogleAccount.findOneAndUpdate(
          q,
          { $set: { objective: DEFAULT_GOOGLE_OBJECTIVE, updatedAt: new Date() } },
          { upsert: true }
        ),
      ]);
    }

    const freshGa = await GoogleAccount.findOne(q)
      .select('customers gaProperties merchantAccounts selectedCustomerIds selectedPropertyIds selectedGaPropertyId selectedMerchantIds')
      .lean();

    const customers = Array.isArray(freshGa?.customers) ? freshGa.customers : [];
    const gaProps = Array.isArray(freshGa?.gaProperties) ? freshGa.gaProperties : [];

    const adsCount = customers.length;
    const gaCount = gaProps.length;

    const selAds = Array.isArray(freshGa?.selectedCustomerIds)
      ? freshGa.selectedCustomerIds.map(normId).filter(Boolean)
      : [];
    const selGa = Array.isArray(freshGa?.selectedPropertyIds)
      ? freshGa.selectedPropertyIds.map(normPropertyId).filter(Boolean)
      : [];

    const legacyGa = freshGa?.selectedGaPropertyId ? normPropertyId(freshGa.selectedGaPropertyId) : null;
    const gaEffectiveSel = selGa.length ? selGa : legacyGa ? [legacyGa] : [];

    const selMerchant   = Array.isArray(freshGa?.selectedMerchantIds)
      ? freshGa.selectedMerchantIds.map(normMerchantId).filter(Boolean) : [];
    const merchantCount = Array.isArray(freshGa?.merchantAccounts) ? freshGa.merchantAccounts.length : 0;

    const needsSelector =
      (shouldDoAds && adsCount > 1 && selAds.length === 0) ||
      (shouldDoGa4 && gaCount > 1 && gaEffectiveSel.length === 0) ||
      (shouldDoMerchant && merchantCount > 1 && selMerchant.length === 0);

    returnTo = appendQuery(returnTo, 'google', 'ok');

    if (String(returnTo).startsWith('/dashboard/settings')) {
      returnTo = appendQuery(returnTo, 'tab', 'integrations');
    }

    returnTo = appendQuery(returnTo, 'selector', needsSelector ? '1' : '0');

    if (productFromState) {
      returnTo = appendQuery(returnTo, 'product', String(productFromState));
    }

    emitEventBestEffort(req, 'google_connect_result', {
      needsSelector,
      product: productFromState || 'both',
      adsCount,
      ga4Count: gaCount,
      selectedAdsCount: selAds.length,
      selectedGa4Count: gaEffectiveSel.length,
      returnTo,
    });

    return res.redirect(returnTo);
  } catch (err) {
    console.error('[googleConnect] callback error:', err?.response?.data || err.message || err);
    emitEventBestEffort(req, 'google_connect_failed', {
      stage: 'callback_exception',
      error: String(err?.message || err),
    });
    return res.redirect('/dashboard/?google=error&reason=callback_exception');
  }
}

router.get('/callback', requireSession, googleCallbackHandler);
router.get('/connect/callback', requireSession, googleCallbackHandler);
router.get('/ads/callback', requireSession, googleCallbackHandler);
router.get('/ga/callback', requireSession, googleCallbackHandler);
router.get('/ga4/callback', requireSession, googleCallbackHandler);
router.get('/merchant/callback', requireSession, googleCallbackHandler);

/* =========================
 * Preview disconnect
 * ========================= */
router.get('/disconnect/preview', requireSession, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

    const googleAdsCount = await Audit.countDocuments({ userId, type: 'google' });
    const ga4Count = await Audit.countDocuments({ userId, type: { $in: ['ga4', 'ga'] } });

    return res.json({
      ok: true,
      auditsToDelete: googleAdsCount + ga4Count,
      breakdown: {
        googleAds: googleAdsCount,
        ga4: ga4Count,
      },
    });
  } catch (e) {
    console.error('[googleConnect] disconnect preview error:', e);
    return res.status(500).json({ ok: false, error: 'PREVIEW_ERROR' });
  }
});

router.get('/ads/disconnect/preview', requireSession, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

    const googleAdsCount = await Audit.countDocuments({ userId, type: 'google' });

    return res.json({
      ok: true,
      auditsToDelete: googleAdsCount,
      breakdown: { googleAds: googleAdsCount },
    });
  } catch (e) {
    console.error('[googleConnect] ads disconnect preview error:', e);
    return res.status(500).json({ ok: false, error: 'PREVIEW_ERROR' });
  }
});

router.get('/ga/disconnect/preview', requireSession, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

    const ga4Count = await Audit.countDocuments({ userId, type: { $in: ['ga4', 'ga'] } });

    return res.json({
      ok: true,
      auditsToDelete: ga4Count,
      breakdown: { ga4: ga4Count },
    });
  } catch (e) {
    console.error('[googleConnect] ga disconnect preview error:', e);
    return res.status(500).json({ ok: false, error: 'PREVIEW_ERROR' });
  }
});

router.get('/merchant/disconnect/preview', requireSession, async (req, res) => {
  try {
    return res.json({ ok: true, auditsToDelete: 0, breakdown: { merchant: 0 } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'PREVIEW_ERROR' });
  }
});

router.get('/status', requireSession, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).lean();

    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select(
        '+refreshToken +accessToken +ga4RefreshToken +ga4AccessToken ' +
        '+merchantRefreshToken +merchantAccessToken +merchantScope ' +
        'objective defaultCustomerId ' +
        'customers ad_accounts scope ga4Scope gaProperties defaultPropertyId ' +
        'lastAdsDiscoveryError lastAdsDiscoveryLog expiresAt ga4ExpiresAt ' +
        'selectedCustomerIds selectedGaPropertyId selectedPropertyIds ' +
        'merchantAccounts selectedMerchantIds defaultMerchantId ' +
        'merchantExpiresAt lastMerchantDiscoveryError ' +
        'connectedAds connectedGa4 connectedMerchant'
      )
      .lean();

    const hasTokens = !!(ga?.refreshToken || ga?.accessToken || ga?.ga4RefreshToken || ga?.ga4AccessToken);
    const customers = Array.isArray(ga?.customers) ? ga.customers : [];
    const adAccounts = Array.isArray(ga?.ad_accounts) ? ga.ad_accounts : [];
    const gaProperties = Array.isArray(ga?.gaProperties) ? ga.gaProperties : [];

    const previous = normId(ga?.defaultCustomerId || '');
    const firstEnabledId = adAccounts.find((a) => (a.status || '').toUpperCase() === 'ENABLED')?.id;
    const fallbackDefault = normId(customers?.[0]?.id || '') || null;
    const defaultCustomerId = previous || firstEnabledId || fallbackDefault;

    const scopesArr = Array.isArray(ga?.scope) ? ga.scope : [];
    const ga4ScopesArr = Array.isArray(ga?.ga4Scope) ? ga.ga4Scope : [];
    const gaScopeOk = hasGaScope(ga4ScopesArr) || hasGaScope(scopesArr);
    const adsScopeOk = hasAdwordsScope(scopesArr);

    const connectedAds = typeof ga?.connectedAds === 'boolean' ? ga.connectedAds : !!adsScopeOk;
    const connectedGa4 = typeof ga?.connectedGa4 === 'boolean' ? ga.connectedGa4 : !!gaScopeOk;

    const merchantScopesArr = Array.isArray(ga?.merchantScope) ? ga.merchantScope : [];
    const merchantScopeOk   = hasMerchantScope(merchantScopesArr);
    const connectedMerchant = typeof ga?.connectedMerchant === 'boolean' ? ga.connectedMerchant : !!merchantScopeOk;

    const merchantAccounts      = Array.isArray(ga?.merchantAccounts) ? ga.merchantAccounts : [];
    const rawSelectedMerchants  = Array.isArray(ga?.selectedMerchantIds) ? ga.selectedMerchantIds : [];
    const merchantAvailableSet  = new Set(merchantAccounts.map((a) => normMerchantId(a?.merchantId || '')).filter(Boolean));
    const selectedMerchantIds   = rawSelectedMerchants.map(normMerchantId).filter((id) => merchantAvailableSet.has(id));

    const rawDefaultMerchant    = ga?.defaultMerchantId ? normMerchantId(ga.defaultMerchantId) : null;
    const defaultMerchantIdSafe = rawDefaultMerchant && merchantAvailableSet.has(rawDefaultMerchant)
      ? rawDefaultMerchant
      : (merchantAccounts[0]?.merchantId ? normMerchantId(merchantAccounts[0].merchantId) : null);

    const requiredSelectionMerchant = merchantAccounts.length > 1 && selectedMerchantIds.length === 0;

    const selectedCustomerIds = Array.isArray(ga?.selectedCustomerIds)
      ? ga.selectedCustomerIds.map(normId).filter(Boolean)
      : [];

    const canonicalProps = Array.isArray(ga?.selectedPropertyIds)
      ? ga.selectedPropertyIds.map(normPropertyId).filter(Boolean)
      : [];

    const legacySelectedGaPropertyId = ga?.selectedGaPropertyId ? normPropertyId(ga.selectedGaPropertyId) : null;

    const gaAvailableSet = new Set(
      gaProperties.map((p) => normPropertyId(p?.propertyId || p?.name)).filter(Boolean)
    );

    let selectedPropertyIds = canonicalProps.filter((pid) => gaAvailableSet.has(pid));
    if (!selectedPropertyIds.length && legacySelectedGaPropertyId && gaAvailableSet.has(legacySelectedGaPropertyId)) {
      selectedPropertyIds = [legacySelectedGaPropertyId];
    }

    const defaultPropertyId = ga?.defaultPropertyId ? normPropertyId(ga.defaultPropertyId) : null;
    const defaultPropertyIdSafe =
      defaultPropertyId && gaAvailableSet.has(defaultPropertyId)
        ? defaultPropertyId
        : (gaProperties[0]?.propertyId ? normPropertyId(gaProperties[0].propertyId) : null);

    const requiredSelectionAds = customers.length > 1 && selectedCustomerIds.length === 0;
    const requiredSelectionGa4 = gaProperties.length > 1 && selectedPropertyIds.length === 0;

    res.json({
      ok: true,
      connected: !!u?.googleConnected && hasTokens,
      connectedAds,
      connectedGa4,
      connectedMerchant,
      hasCustomers: customers.length > 0,
      defaultCustomerId,
      customers,
      ad_accounts: adAccounts,
      selectedCustomerIds,
      scopes: scopesArr,
      adsScopeOk,
      gaScopeOk,
      merchantScopeOk,
      objective: u?.googleObjective || ga?.objective || null,
      gaProperties,
      defaultPropertyId: defaultPropertyIdSafe,
      selectedPropertyIds,
      selectedGaPropertyId: legacySelectedGaPropertyId,
      requiredSelectionAds,
      requiredSelectionGa4,
      merchantAccounts,
      defaultMerchantId:          defaultMerchantIdSafe,
      selectedMerchantIds,
      requiredSelectionMerchant,
      merchantExpiresAt:          ga?.merchantExpiresAt || null,
      lastMerchantDiscoveryError: ga?.lastMerchantDiscoveryError || null,
      expiresAt: ga?.expiresAt || null,
      lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
      lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
    });
  } catch (err) {
    console.error('[googleConnect] status error:', err);
    res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

router.get('/merchant/accounts', requireSession, async (req, res) => {
  try {
    const q  = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const ga = await GoogleAccount.findOne(q)
      .select('+merchantRefreshToken +merchantAccessToken +merchantScope merchantAccounts selectedMerchantIds defaultMerchantId lastMerchantDiscoveryError')
      .lean();

    if (!ga || (!ga.merchantRefreshToken && !ga.merchantAccessToken)) {
      return res.json({ ok: true, merchantAccounts: [], selectedMerchantIds: [], defaultMerchantId: null });
    }

    if (!hasMerchantScope(ga.merchantScope || [])) {
      return res.status(428).json({ ok: false, error: 'MERCHANT_SCOPE_MISSING' });
    }

    let merchantAccounts = Array.isArray(ga.merchantAccounts) ? ga.merchantAccounts : [];
    const forceRefresh   = req.query.refresh === '1';

    if (forceRefresh || !merchantAccounts.length) {
      try {
        const fullGa       = await GoogleAccount.findOne(q);
        const client       = await buildOAuthClientForProductFromDoc(fullGa, PRODUCT_MERCHANT);
        merchantAccounts   = await fetchMerchantAccounts(client);
        const availableIds = new Set(merchantAccounts.map((a) => normMerchantId(a.merchantId)).filter(Boolean));
        const kept         = filterSelectedMerchantsByAvailable(fullGa.selectedMerchantIds, availableIds);

        fullGa.merchantAccounts          = merchantAccounts;
        fullGa.selectedMerchantIds       = kept;
        fullGa.lastMerchantDiscoveryError = null;
        fullGa.updatedAt                 = new Date();
        await fullGa.save();
      } catch (e) {
        console.warn('[googleConnect] merchant/accounts lazy refresh failed:', e?.message);
      }
    }

    const availableIds      = new Set(merchantAccounts.map((a) => normMerchantId(a.merchantId)).filter(Boolean));
    const selectedMerchantIds = (ga.selectedMerchantIds || []).map(normMerchantId).filter((id) => availableIds.has(id));
    const defaultMerchantId   = ga.defaultMerchantId ? normMerchantId(ga.defaultMerchantId) : (merchantAccounts[0]?.merchantId || null);

    return res.json({ ok: true, merchantAccounts, selectedMerchantIds, defaultMerchantId });
  } catch (err) {
    console.error('[googleConnect] merchant/accounts error:', err);
    return res.status(500).json({ ok: false, error: 'MERCHANT_ACCOUNTS_ERROR' });
  }
});

router.post('/objective', requireSession, express.json(), async (req, res) => {
  try {
    const val = String(req.body?.objective || '').trim().toLowerCase();
    if (!['ventas', 'alcance', 'leads'].includes(val)) {
      return res.status(400).json({ ok: false, error: 'BAD_OBJECTIVE' });
    }

    await User.findByIdAndUpdate(req.user._id, { $set: { googleObjective: val } });
    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { objective: val, updatedAt: new Date() } },
      { upsert: true }
    );

    emitEventBestEffort(req, 'google_objective_saved', { objective: val });

    res.json({ ok: true });
  } catch (err) {
    console.error('[googleConnect] save objective error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_OBJECTIVE_ERROR' });
  }
});

router.get('/accounts', requireSession, async (req, res) => {
  try {
    let ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select(
        '+refreshToken +accessToken customers ad_accounts scope defaultCustomerId ' +
        'lastAdsDiscoveryError lastAdsDiscoveryLog selectedCustomerIds'
      )
      .lean();

    if (!ga || (!ga.refreshToken && !ga.accessToken)) {
      return res.json({
        ok: true,
        customers: [],
        ad_accounts: [],
        defaultCustomerId: null,
        selectedCustomerIds: [],
        scopes: [],
        lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
        lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
      });
    }

    const scopesArr = Array.isArray(ga?.scope) ? ga.scope : [];
    if (!hasAdwordsScope(scopesArr)) {
      return res.status(428).json({
        ok: false,
        error: 'ADS_SCOPE_MISSING',
        message: 'Necesitamos permiso de Google Ads para listar tus cuentas.',
        connectUrl: '/auth/google/ads/connect?returnTo=/dashboard/settings?tab=integrations',
      });
    }

    let customers = ga.customers || [];
    let ad_accounts = ga.ad_accounts || [];
    const forceRefresh = req.query.refresh === '1';

    if (forceRefresh || customers.length === 0 || ad_accounts.length === 0) {
      const fullGa = await GoogleAccount.findOne({
        $or: [{ user: req.user._id }, { userId: req.user._id }],
      });

      if (!fullGa || !fullGa.refreshToken) {
        return res.json({
          ok: true,
          customers: [],
          ad_accounts: [],
          defaultCustomerId: null,
          selectedCustomerIds: [],
          scopes: scopesArr,
          lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
          lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
        });
      }

      try {
        const enriched = await discoverAndEnrich(fullGa);

        customers = enriched.map((c) => ({
          id: normId(c.id),
          descriptiveName: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        ad_accounts = enriched.map((c) => ({
          id: normId(c.id),
          name: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        fullGa.customers = customers;
        fullGa.ad_accounts = ad_accounts;
        fullGa.lastAdsDiscoveryError = null;
        fullGa.lastAdsDiscoveryLog = null;

        const avail = new Set(customers.map((c) => normId(c?.id)).filter(Boolean));
        const kept = filterSelectedByAvailable(fullGa.selectedCustomerIds, avail);
        fullGa.selectedCustomerIds = kept;

        if (kept.length) {
          const d = normId(fullGa.defaultCustomerId || '');
          if (!d || !kept.includes(d)) fullGa.defaultCustomerId = kept[0];
        }

        fullGa.updatedAt = new Date();
        await fullGa.save();

        ga = fullGa.toObject();
      } catch (e) {
        const reason = e?.response?.data || e?.message || 'LAZY_DISCOVERY_FAILED';
        console.warn('lazy ads refresh failed:', reason);
        await GoogleAccount.updateOne(
          { $or: [{ user: req.user._id }, { userId: req.user._id }] },
          { $set: { lastAdsDiscoveryError: String(reason).slice(0, 4000), updatedAt: new Date() } }
        );
      }
    }

    const previous = normId(ga?.defaultCustomerId || '');
    const firstEnabledId = ad_accounts.find((a) => (a.status || '').toUpperCase() === 'ENABLED')?.id;
    const defaultCustomerId =
      previous || firstEnabledId || normId(customers?.[0]?.id || '') || null;

    const selectedCustomerIds = Array.isArray(ga?.selectedCustomerIds)
      ? ga.selectedCustomerIds.map(normId).filter(Boolean)
      : [];

    res.json({
      ok: true,
      customers,
      ad_accounts,
      defaultCustomerId,
      selectedCustomerIds,
      scopes: scopesArr,
      lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
      lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
    });
  } catch (err) {
    console.error('[googleConnect] accounts error:', err?.response?.data || err);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

router.post('/accounts/selection', requireSession, express.json(), async (req, res) => {
  try {
    const customerIds = req.body?.customerIds || req.body?.accountIds;
    if (!Array.isArray(customerIds)) {
      return res.status(400).json({ ok: false, error: 'customerIds[] requerido' });
    }

    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('_id customers ad_accounts defaultCustomerId selectedCustomerIds');

    if (!doc) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = new Set(
      uniq([
        ...(Array.isArray(doc.customers) ? doc.customers.map((c) => normId(c?.id)) : []),
        ...(Array.isArray(doc.ad_accounts) ? doc.ad_accounts.map((a) => normId(a?.id)) : []),
      ]).filter(Boolean)
    );

    const wanted = uniq(customerIds.map(normId)).filter(Boolean);
    const selected = wanted.filter((id) => available.has(id));

    if (!selected.length) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_CUSTOMERS' });
    }

    let nextDefault = doc.defaultCustomerId ? normId(doc.defaultCustomerId) : '';
    if (!nextDefault || !selected.includes(nextDefault)) nextDefault = selected[0];

    await GoogleAccount.updateOne(
      { _id: doc._id },
      { $set: { selectedCustomerIds: selected, defaultCustomerId: nextDefault, updatedAt: new Date() } }
    );

    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          selectedGoogleAccounts: selected,
          'preferences.googleAds.auditAccountIds': selected,
        },
      }
    );

    emitEventBestEffort(req, 'google_ads_selection_saved', {
      selectedCount: selected.length,
      selectedCustomerIds: selected,
      defaultCustomerId: nextDefault,
    });

    await enqueueGoogleAdsAfterConnectBestEffort(req, {
      accountId: nextDefault || selected[0] || null,
      reason: 'google_ads_selection_saved',
    });

    return res.json({ ok: true, selectedCustomerIds: selected, defaultCustomerId: nextDefault });
  } catch (e) {
    console.error('[googleConnect] accounts/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
});

router.post('/default-customer', requireSession, express.json(), async (req, res) => {
  try {
    const cid = normId(req.body?.customerId || '');
    if (!cid) return res.status(400).json({ ok: false, error: 'CUSTOMER_REQUIRED' });

    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultCustomerId: cid, updatedAt: new Date() } },
      { upsert: true }
    );

    emitEventBestEffort(req, 'google_ads_default_customer_saved', { defaultCustomerId: cid });

    await enqueueGoogleAdsAfterConnectBestEffort(req, {
      accountId: cid,
      reason: 'google_ads_default_customer_saved',
    });

    res.json({ ok: true, defaultCustomerId: cid });
  } catch (err) {
    console.error('[googleConnect] default-customer error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_CUSTOMER_ERROR' });
  }
});

router.post('/default-property', requireSession, express.json(), async (req, res) => {
  try {
    const pid = normPropertyId(req.body?.propertyId || '');
    if (!pid) return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });

    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultPropertyId: pid, updatedAt: new Date() } },
      { upsert: true }
    );

    emitEventBestEffort(req, 'ga4_default_property_saved', { defaultPropertyId: pid });

    await enqueueGa4AfterConnectBestEffort(req, {
      propertyId: pid,
      reason: 'ga4_default_property_saved',
    });

    res.json({ ok: true, defaultPropertyId: pid });
  } catch (err) {
    console.error('[googleConnect] default-property error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_PROPERTY_ERROR' });
  }
});

router.post('/merchant/selection', requireSession, express.json(), async (req, res) => {
  try {
    const ids = req.body?.merchantIds;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ ok: false, error: 'merchantIds[] requerido' });
    }

    const q   = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const doc = await GoogleAccount.findOne(q).select('_id merchantAccounts defaultMerchantId selectedMerchantIds');
    if (!doc) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = new Set((doc.merchantAccounts || []).map((a) => normMerchantId(a.merchantId)).filter(Boolean));
    const selected  = ids.map(normMerchantId).filter(Boolean).filter((id) => available.has(id));
    if (!selected.length) return res.status(400).json({ ok: false, error: 'NO_VALID_MERCHANT_IDS' });

    const nextDefault = selected.includes(normMerchantId(doc.defaultMerchantId || '')) ? normMerchantId(doc.defaultMerchantId) : selected[0];

    await GoogleAccount.updateOne({ _id: doc._id }, {
      $set: { selectedMerchantIds: selected, defaultMerchantId: nextDefault, updatedAt: new Date() },
    });

    await User.updateOne({ _id: req.user._id }, {
      $set: { selectedMerchantIds: selected, 'preferences.googleMerchant.selectedMerchantIds': selected },
    });

    return res.json({ ok: true, selectedMerchantIds: selected, defaultMerchantId: nextDefault });
  } catch (e) {
    console.error('[googleConnect] merchant/selection error:', e);
    return res.status(500).json({ ok: false, error: 'MERCHANT_SELECTION_ERROR' });
  }
});

router.post('/ga4/selection', requireSession, express.json(), async (req, res) => {
  try {
    const propertyIds = req.body?.propertyIds;
    if (!Array.isArray(propertyIds)) {
      return res.status(400).json({ ok: false, error: 'propertyIds[] requerido' });
    }

    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('_id gaProperties defaultPropertyId selectedPropertyIds selectedGaPropertyId');

    if (!doc) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = new Set(
      (Array.isArray(doc.gaProperties) ? doc.gaProperties : [])
        .map((p) => normPropertyId(p?.propertyId || p?.name))
        .filter(Boolean)
    );

    const wanted = uniq(propertyIds.map(normPropertyId)).filter(Boolean);
    const selected = wanted.filter((pid) => available.has(pid));

    if (!selected.length) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_PROPERTIES' });
    }

    let nextDefault = doc.defaultPropertyId ? normPropertyId(doc.defaultPropertyId) : '';
    if (!nextDefault || !selected.includes(nextDefault)) nextDefault = selected[0];

    await GoogleAccount.updateOne(
      { _id: doc._id },
      {
        $set: {
          selectedPropertyIds: selected,
          selectedGaPropertyId: selected[0],
          defaultPropertyId: nextDefault,
          updatedAt: new Date(),
        },
      }
    );

    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          selectedGAProperties: selected,
          'preferences.googleAnalytics.auditPropertyIds': selected,
        },
      }
    );

    emitEventBestEffort(req, 'ga4_selection_saved', {
      selectedCount: selected.length,
      selectedPropertyIds: selected,
      defaultPropertyId: nextDefault,
    });

    await enqueueGa4AfterConnectBestEffort(req, {
      propertyId: nextDefault || selected[0] || null,
      reason: 'ga4_selection_saved',
    });

    return res.json({ ok: true, selectedPropertyIds: selected, defaultPropertyId: nextDefault });
  } catch (e) {
    console.error('[googleConnect] ga4/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
});

router.post('/ads/disconnect', requireSession, express.json(), async (req, res) => {
  try {
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const userId = req.user._id;

    const beforeGoogle = await Audit.countDocuments({ userId, type: 'google' });

    const ga = await GoogleAccount.findOne(q)
      .select('+refreshToken +accessToken +ga4RefreshToken +ga4AccessToken connectedAds connectedGa4')
      .lean();

    const revoke = await revokeGoogleTokenBestEffort({
      refreshToken: ga?.refreshToken || null,
      accessToken: ga?.accessToken || null,
    });

    await GoogleAccount.updateOne(
      q,
      { $set: { ...buildUnsetForAdsOnly(), updatedAt: new Date() } },
      { upsert: false }
    );

    let auditsDeleteOk = true;
    let auditsDeleteError = null;

    try {
      await deleteAuditsForUserSources(userId, ['google']);
    } catch (e) {
      auditsDeleteOk = false;
      auditsDeleteError = e?.message || 'AUDIT_DELETE_FAILED';
      console.warn('[googleConnect] ads auditCleanup failed (best-effort):', auditsDeleteError);
    }

    try {
      await Audit.deleteMany({ userId, type: 'google' });
    } catch (e) {
      auditsDeleteOk = false;
      auditsDeleteError = auditsDeleteError || (e?.message || 'AUDIT_DELETE_FALLBACK_FAILED');
      console.warn('[googleConnect] ads audit delete fallback failed:', e?.message || e);
    }

    const afterGoogle = await Audit.countDocuments({ userId, type: 'google' });
    const auditsDeleted = Math.max(0, beforeGoogle - afterGoogle);

    const fresh = await GoogleAccount.findOne(q)
      .select('+refreshToken +accessToken +ga4RefreshToken +ga4AccessToken connectedAds connectedGa4')
      .lean();

    const googleConnected = computeGoogleConnectedAfter(fresh);

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          googleConnected,
          selectedGoogleAccounts: [],
          'preferences.googleAds.auditAccountIds': [],
        },
      }
    );

    emitEventBestEffort(req, 'google_ads_disconnected', {
      revokeAttempted: revoke.attempted,
      revokeOk: revoke.ok,
      revokeVia: revoke.via || null,
      auditsDeleted,
      auditsDeleteOk,
      auditsDeleteError,
      googleConnectedAfter: googleConnected,
    });

    return res.json({
      ok: true,
      disconnected: true,
      product: 'ads',
      googleConnectedAfter: googleConnected,
      revokeAttempted: revoke.attempted,
      revokeOk: revoke.ok,
      revokeVia: revoke.via || null,
      auditsDeleted,
      auditsDeleteOk,
      auditsDeleteError,
    });
  } catch (err) {
    console.error('[googleConnect] ads disconnect error:', err?.response?.data || err?.message || err);
    emitEventBestEffort(req, 'google_ads_disconnect_failed', { error: String(err?.message || err) });
    return res.status(500).json({ ok: false, error: 'DISCONNECT_ERROR' });
  }
});

router.post('/ga/disconnect', requireSession, express.json(), async (req, res) => {
  try {
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const userId = req.user._id;

    const beforeGA4 = await Audit.countDocuments({ userId, type: { $in: ['ga4', 'ga'] } });

    const ga = await GoogleAccount.findOne(q)
      .select('+refreshToken +accessToken +ga4RefreshToken +ga4AccessToken connectedAds connectedGa4')
      .lean();

    const revoke = await revokeGoogleTokenBestEffort({
      refreshToken: ga?.ga4RefreshToken || null,
      accessToken: ga?.ga4AccessToken || null,
    });

    await GoogleAccount.updateOne(
      q,
      { $set: { ...buildUnsetForGa4Only(), updatedAt: new Date() } },
      { upsert: false }
    );

    let auditsDeleteOk = true;
    let auditsDeleteError = null;

    try {
      await deleteAuditsForUserSources(userId, ['ga4', 'ga']);
    } catch (e) {
      auditsDeleteOk = false;
      auditsDeleteError = e?.message || 'AUDIT_DELETE_FAILED';
      console.warn('[googleConnect] ga4 auditCleanup failed (best-effort):', auditsDeleteError);
    }

    try {
      await Audit.deleteMany({ userId, type: { $in: ['ga4', 'ga'] } });
    } catch (e) {
      auditsDeleteOk = false;
      auditsDeleteError = auditsDeleteError || (e?.message || 'AUDIT_DELETE_FALLBACK_FAILED');
      console.warn('[googleConnect] ga4 audit delete fallback failed:', e?.message || e);
    }

    const afterGA4 = await Audit.countDocuments({ userId, type: { $in: ['ga4', 'ga'] } });
    const auditsDeleted = Math.max(0, beforeGA4 - afterGA4);

    const fresh = await GoogleAccount.findOne(q)
      .select('+refreshToken +accessToken +ga4RefreshToken +ga4AccessToken connectedAds connectedGa4')
      .lean();

    const googleConnected = computeGoogleConnectedAfter(fresh);

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          googleConnected,
          selectedGAProperties: [],
          'preferences.googleAnalytics.auditPropertyIds': [],
        },
      }
    );

    emitEventBestEffort(req, 'ga4_disconnected', {
      revokeAttempted: revoke.attempted,
      revokeOk: revoke.ok,
      revokeVia: revoke.via || null,
      auditsDeleted,
      auditsDeleteOk,
      auditsDeleteError,
      googleConnectedAfter: googleConnected,
    });

    return res.json({
      ok: true,
      disconnected: true,
      product: 'ga4',
      googleConnectedAfter: googleConnected,
      revokeAttempted: revoke.attempted,
      revokeOk: revoke.ok,
      revokeVia: revoke.via || null,
      auditsDeleted,
      auditsDeleteOk,
      auditsDeleteError,
    });
  } catch (err) {
    console.error('[googleConnect] ga4 disconnect error:', err?.response?.data || err?.message || err);
    emitEventBestEffort(req, 'ga4_disconnect_failed', { error: String(err?.message || err) });
    return res.status(500).json({ ok: false, error: 'DISCONNECT_ERROR' });
  }
});

function isTruthyToken(x) {
  return !!(x && String(x).trim());
}

function computeGoogleConnectedAfter(gaDoc) {
  const ads = !!gaDoc?.connectedAds || isTruthyToken(gaDoc?.refreshToken) || isTruthyToken(gaDoc?.accessToken);
  const ga4 = !!gaDoc?.connectedGa4 || isTruthyToken(gaDoc?.ga4RefreshToken) || isTruthyToken(gaDoc?.ga4AccessToken);
  return ads || ga4;
}

function buildUnsetForAdsOnly() {
  return {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    scope: [],
    customers: [],
    ad_accounts: [],
    defaultCustomerId: null,
    selectedCustomerIds: [],
    managerCustomerId: null,
    loginCustomerId: null,
    connectedAds: false,
    lastAdsDiscoveryError: null,
    lastAdsDiscoveryLog: null,
  };
}

function buildUnsetForGa4Only() {
  return {
    ga4AccessToken: null,
    ga4RefreshToken: null,
    ga4ExpiresAt: null,
    ga4Scope: [],
    ga4ConnectedAt: null,
    gaProperties: [],
    defaultPropertyId: null,
    selectedPropertyIds: [],
    selectedGaPropertyId: null,
    connectedGa4: false,
  };
}

router.post('/merchant/disconnect', requireSession, async (req, res) => {
  try {
    const q  = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const ga = await GoogleAccount.findOne(q).select('+merchantRefreshToken +merchantAccessToken connectedAds connectedGa4');
    if (!ga) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    await revokeGoogleTokenBestEffort({ refreshToken: ga.merchantRefreshToken, accessToken: ga.merchantAccessToken });

    await GoogleAccount.updateOne({ _id: ga._id }, {
      $set: {
        merchantAccessToken:        null,
        merchantRefreshToken:       null,
        merchantScope:              [],
        merchantExpiresAt:          null,
        merchantConnectedAt:        null,
        merchantAccounts:           [],
        selectedMerchantIds:        [],
        defaultMerchantId:          null,
        connectedMerchant:          false,
        lastMerchantDiscoveryError: null,
        updatedAt:                  new Date(),
      },
    });

    const stillConnected = !!(ga.connectedAds || ga.connectedGa4);
    if (!stillConnected) {
      await User.updateOne({ _id: req.user._id }, { $set: { googleConnected: false } });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[googleConnect] merchant/disconnect error:', err);
    return res.status(500).json({ ok: false, error: 'MERCHANT_DISCONNECT_ERROR' });
  }
});

router.post('/disconnect', requireSession, express.json(), async (req, res) => {
  try {
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const userId = req.user._id;

    const beforeGoogle = await Audit.countDocuments({ userId, type: 'google' });
    const beforeGA4 = await Audit.countDocuments({ userId, type: { $in: ['ga4', 'ga'] } });
    const beforeTotal = beforeGoogle + beforeGA4;

    const ga = await GoogleAccount.findOne(q)
      .select('+refreshToken +accessToken +ga4RefreshToken +ga4AccessToken')
      .lean();

    const refreshToken = ga?.refreshToken || ga?.ga4RefreshToken || null;
    const accessToken = ga?.accessToken || ga?.ga4AccessToken || null;

    const revoke = await revokeGoogleTokenBestEffort({ refreshToken, accessToken });

    await GoogleAccount.updateOne(
      q,
      {
        $set: {
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          scope: [],
          ga4AccessToken: null,
          ga4RefreshToken: null,
          ga4ExpiresAt: null,
          ga4Scope: [],
          ga4ConnectedAt: null,
          customers: [],
          ad_accounts: [],
          defaultCustomerId: null,
          selectedCustomerIds: [],
          managerCustomerId: null,
          loginCustomerId: null,
          gaProperties: [],
          defaultPropertyId: null,
          selectedPropertyIds: [],
          selectedGaPropertyId: null,
          connectedAds: false,
          connectedGa4: false,
          lastAdsDiscoveryError: null,
          lastAdsDiscoveryLog: null,
          updatedAt: new Date(),
        },
      },
      { upsert: false }
    );

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          googleConnected: false,
          selectedGoogleAccounts: [],
          selectedGAProperties: [],
          'preferences.googleAds.auditAccountIds': [],
          'preferences.googleAnalytics.auditPropertyIds': [],
        },
      }
    );

    let auditsDeleteOk = true;
    let auditsDeleteError = null;

    try {
      await deleteAuditsForUserSources(userId, ['google', 'ga4', 'ga']);
    } catch (e) {
      auditsDeleteOk = false;
      auditsDeleteError = e?.message || 'AUDIT_DELETE_FAILED';
      console.warn('[googleConnect] auditCleanup failed (best-effort):', auditsDeleteError);
    }

    try {
      await Audit.deleteMany({ userId, type: { $in: ['google', 'ga4', 'ga'] } });
    } catch (e) {
      auditsDeleteOk = false;
      auditsDeleteError = auditsDeleteError || (e?.message || 'AUDIT_DELETE_FALLBACK_FAILED');
      console.warn('[googleConnect] audit delete fallback failed:', e?.message || e);
    }

    const afterGoogle = await Audit.countDocuments({ userId, type: 'google' });
    const afterGA4 = await Audit.countDocuments({ userId, type: { $in: ['ga4', 'ga'] } });
    const afterTotal = afterGoogle + afterGA4;

    const auditsDeleted = Math.max(0, beforeTotal - afterTotal);

    emitEventBestEffort(req, 'google_disconnected', {
      revokeAttempted: revoke.attempted,
      revokeOk: revoke.ok,
      revokeVia: revoke.via || null,
      auditsDeleted,
      auditsDeleteOk,
      auditsDeleteError,
    });

    return res.json({
      ok: true,
      disconnected: true,
      revokeAttempted: revoke.attempted,
      revokeOk: revoke.ok,
      revokeVia: revoke.via || null,
      auditsDeleted,
      auditsDeleteOk,
      auditsDeleteError,
    });
  } catch (err) {
    console.error('[googleConnect] disconnect error:', err?.response?.data || err?.message || err);
    emitEventBestEffort(req, 'google_disconnect_failed', { error: String(err?.message || err) });
    return res.status(500).json({ ok: false, error: 'DISCONNECT_ERROR' });
  }
});

module.exports = router;