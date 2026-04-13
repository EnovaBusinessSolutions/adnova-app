
const express = require('express');
const router = express.Router();
const axios = require('axios');
const archiver = require('archiver');
const crypto = require('crypto');
const prisma = require('../utils/prismaClient');
const { startOfDay, endOfDay, subDays, eachDayOfInterval, format } = require('date-fns');
const {
  isAnalyticsShopAuthorizedForUser,
  listAuthorizedAnalyticsShopsForUser,
} = require('../services/analyticsAccess');
const { getCustomerDisplayNames } = require('../services/shopifyService');
const { hashPII } = require('../utils/encryption');

let McpData = null;
let ShopConnections = null;
let User = null;
let MetaAccount = null;
let GoogleAccount = null;
let formatMetaForLlmMini = null;
let formatGoogleAdsForLlmMini = null;
let enqueueMetaCollectBestEffort = null;
let enqueueGoogleAdsCollectBestEffort = null;
let googleAdsService = null;

try {
  McpData = require('../models/McpData');
} catch (_) {}

try {
  ShopConnections = require('../models/ShopConnections');
} catch (_) {}

try {
  User = require('../models/User');
} catch (_) {}

try {
  MetaAccount = require('../models/MetaAccount');
} catch (_) {}

try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {}

try {
  ({ formatMetaForLlmMini } = require('../jobs/transform/metaLlmFormatter'));
} catch (_) {}

try {
  ({ formatGoogleAdsForLlmMini } = require('../jobs/transform/googleAdsLlmFormatter'));
} catch (_) {}

try {
  ({ enqueueMetaCollectBestEffort, enqueueGoogleAdsCollectBestEffort } = require('../queues/mcpQueue'));
} catch (_) {}

try {
  googleAdsService = require('../services/googleAdsService');
} catch (_) {}

const EVENT_BUCKET_ALIASES = {
  page_view: ['page_view', 'pageview', 'view_page'],
  view_item: ['view_item', 'product_view', 'view_product', 'product_detail_view'],
  add_to_cart: ['add_to_cart', 'addtocart', 'cart_add'],
  begin_checkout: ['begin_checkout', 'checkout_started', 'start_checkout'],
  purchase: ['purchase', 'order_completed', 'checkout_completed', 'order_create', 'orders_create'],
  login: ['user_logged_in', 'user_login', 'login'],
  logout: ['user_logged_out', 'user_logout', 'logout'],
};

const PURCHASE_ALIASES = EVENT_BUCKET_ALIASES.purchase;
const ATTRIBUTION_MODELS = new Set(['first_touch', 'last_touch', 'linear', 'meta', 'google_ads']);
const ATTRIBUTION_LOOKBACK_DAYS = 30;
const JOURNEY_STITCH_LOOKBACK_DAYS = 7;
const ROUTE_RESPONSE_CACHE = new Map();
const ROUTE_CACHE_MAX_ENTRIES = 300;
const PAID_MEDIA_SYNC_DEBOUNCE = new Map();
const PAID_MEDIA_SYNC_DEBOUNCE_MS = 10 * 60 * 1000;
const ATTRIBUTION_LABEL_CACHE = new Map();
const ATTRIBUTION_LABEL_CACHE_MAX_ENTRIES = 500;
const ATTRIBUTION_LABEL_CACHE_TTL_MS = 30 * 60 * 1000;

function parseAllowedAccountIds() {
  const raw = String(process.env.ADRAY_ALLOWED_ACCOUNT_IDS || '').trim();
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((item) => normalizeShopDomain(item) || String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return values.length ? new Set(values) : null;
}

function isAccountAllowed(accountId) {
  const allowed = parseAllowedAccountIds();
  if (!allowed) return true;
  const normalized = normalizeShopDomain(accountId) || String(accountId || '').trim().toLowerCase();
  return normalized ? allowed.has(normalized) : false;
}

function buildRouteCacheKey(routeName, req) {
  const accountId = String(req?.params?.account_id || '-');
  const query = String(req?.originalUrl || '').split('?')[1] || '';
  return `${routeName}:${accountId}:${query}`;
}

function readRouteCache(cacheKey) {
  const entry = ROUTE_RESPONSE_CACHE.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ROUTE_RESPONSE_CACHE.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function writeRouteCache(cacheKey, payload, ttlMs) {
  if (!cacheKey || !payload || !Number.isFinite(ttlMs) || ttlMs <= 0) return;
  ROUTE_RESPONSE_CACHE.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });

  if (ROUTE_RESPONSE_CACHE.size <= ROUTE_CACHE_MAX_ENTRIES) return;
  
  const now = Date.now();
  for (const [key, value] of ROUTE_RESPONSE_CACHE.entries()) {
    if (value.expiresAt <= now) ROUTE_RESPONSE_CACHE.delete(key);
  }

  if (ROUTE_RESPONSE_CACHE.size > ROUTE_CACHE_MAX_ENTRIES) {
    const toDelete = ROUTE_RESPONSE_CACHE.size - ROUTE_CACHE_MAX_ENTRIES;
    let deleted = 0;
    for (const key of ROUTE_RESPONSE_CACHE.keys()) {
      ROUTE_RESPONSE_CACHE.delete(key);
      deleted++;
      if (deleted >= toDelete) break;
    }
  }
}

router.get('/shops', async (req, res) => {
  if (!req.user?._id) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const access = await listAuthorizedAnalyticsShopsForUser(req.user._id);
    console.log('[Attribution Debug][/api/analytics/shops]', {
      userId: String(req.user._id),
      email: req.user?.email || null,
      defaultShop: access.defaultShop || null,
      defaultShopSource: access.defaultShopSource || null,
      shopCount: Array.isArray(access.shops) ? access.shops.length : 0,
      shops: Array.isArray(access.shops)
        ? access.shops.map((entry) => ({
            shop: entry.shop,
            type: entry.type,
            sources: entry.sources,
            matchPlatforms: entry.matchPlatforms,
            isDefault: entry.isDefault,
          }))
        : [],
      resolverDebug: access.debug || null,
    });
    return res.json({
      ok: true,
      defaultShop: access.defaultShop || null,
      defaultShopSource: access.defaultShopSource || null,
      shops: Array.isArray(access.shops) ? access.shops : [],
    });
  } catch (error) {
    console.error('[Analytics shops] Failed to resolve authorized shops:', error?.message || error);
    return res.status(500).json({
      ok: false,
      error: 'Failed to resolve authorized shops',
      shops: [],
      defaultShop: null,
    });
  }
});

router.use('/:account_id', async (req, res, next) => {
  const accountId = req.params?.account_id;
  
  // Enforce session ownership if accessed via browser session
  if (req.user) {
    const userShop = req.user.shop ? normalizeShopDomain(req.user.shop) : null;
    const requestedShop = normalizeShopDomain(accountId);
    
    // Quick admin bypass can go here if needed, otherwise strict match
    const isAdmin = req.user.email?.includes('@adray.ai') || 
                    req.user.email?.includes('@enova') || 
                    req.user.email?.includes('german') ||
                    req.user.email?.includes('shogun');

    // Temporal bypass para entornos Staging / desarrollo
    const _env = String(process.env.NODE_ENV || '').toLowerCase();
    const isStaging = _env !== 'production' || 
                      process.env.RENDER_EXTERNAL_URL?.includes('staging') ||
                      req.headers.host?.includes('staging');

    let authorized = userShop === requestedShop;

    if (!authorized && requestedShop && !isAdmin && !isStaging) {
      try {
        authorized = await isAnalyticsShopAuthorizedForUser(req.user._id, requestedShop);
      } catch (error) {
        console.warn('[Analytics auth] Authorized shop lookup failed:', error?.message || error);
      }
    }

    if (!authorized && !isAdmin && !isStaging) {
      console.warn(`[Auth 403] User ${req.user.email} (shop: ${userShop}) attempted to access analytics for ${requestedShop}`);
      return res.status(403).json({
        error: 'Unauthorized: You do not have permission for this account',
        accountId
      });
    }
  }

  // Bypass allowed if it's staging or admin
  const isStaging = (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') || 
                    (process.env.RENDER_EXTERNAL_URL?.includes('staging')) || 
                    (req.headers.host?.includes('staging'));
                    
  const isAdmin = req.user?.email?.includes('@adray.ai') || 
                 req.user?.email?.includes('@enova') || 
                 req.user?.email?.includes('german') || 
                 req.user?.email?.includes('shogun');

  if (isAdmin || isStaging || isAccountAllowed(accountId)) return next();
  return res.status(403).json({
    error: 'Account not allowed in this deployment',
    accountId,
  });
});

function isDatabaseConnectivityError(error) {
  if (!error) return false;
  if (error.code === 'P1001') return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes("can't reach database server")
    || message.includes('database server')
    || message.includes('connection refused')
    || message.includes('timed out');
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFiniteNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeShopDomain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch (_) {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function normalizeMetaAccountId(value) {
  return String(value || '').trim().replace(/^act_/, '').replace(/\s+/g, '');
}

function normalizeGoogleCustomerId(value) {
  return String(value || '')
    .trim()
    .replace(/^customers\//, '')
    .replace(/-/g, '')
    .replace(/\s+/g, '');
}

function isRootMcpDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.kind === 'root') return true;
  if (doc.isRoot === true) return true;
  if (doc.type === 'root') return true;
  if (doc.docType === 'root') return true;
  return Boolean(doc.latestSnapshotId && !doc.dataset);
}

function isChunkMcpDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (isRootMcpDoc(doc)) return false;
  return Boolean(doc.dataset);
}

async function findMcpRoot(userId) {
  if (!McpData || !userId) return null;

  const docs = await McpData.find({ userId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return docs.find(isRootMcpDoc) || null;
}

async function findLatestSnapshotId(userId, source, rootDoc) {
  if (!McpData || !userId) return null;
  if (rootDoc?.latestSnapshotId) {
    console.log(`[PaidMedia Trace] latestSnapshotId from root user=${userId} source=${source} snapshot=${rootDoc.latestSnapshotId}`);
    return rootDoc.latestSnapshotId;
  }

  const datasetPrefix = source === 'googleAds' ? '^google\\.' : '^meta\\.';
  const latestChunk = await McpData.findOne({
    userId,
    source,
    dataset: { $regex: datasetPrefix },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  console.log(`[PaidMedia Trace] latestSnapshotId from chunks user=${userId} source=${source} snapshot=${latestChunk?.snapshotId || 'none'} dataset=${latestChunk?.dataset || 'n/a'}`);
  return latestChunk?.snapshotId || null;
}

async function findMcpChunks(userId, source, snapshotId, datasetPrefix) {
  if (!McpData || !userId || !snapshotId) return [];

  const docs = await McpData.find({
    userId,
    source,
    snapshotId,
    dataset: { $regex: `^${datasetPrefix.replace('.', '\\.')}` },
  })
    .sort({ createdAt: 1, updatedAt: 1 })
    .lean();

  const chunks = docs.filter(isChunkMcpDoc);
  console.log(`[PaidMedia Trace] findMcpChunks user=${userId} source=${source} snapshot=${snapshotId} prefix=${datasetPrefix} count=${chunks.length}`);
  if (chunks.length) {
    console.log('[PaidMedia Trace] chunk datasets:', chunks.map((d) => d?.dataset).filter(Boolean).slice(0, 20));
  }

  return chunks;
}

async function resolveUserIdByShopConnection(candidates) {
  if (!ShopConnections || !candidates.length) return null;
  const normalizedCandidates = Array.from(new Set(candidates.filter(Boolean)));
  const shopConnection = await ShopConnections.findOne({
    shop: { $in: normalizedCandidates },
    matchedToUserId: { $ne: null },
  })
    .select('matchedToUserId')
    .lean();

  return shopConnection?.matchedToUserId || null;
}

async function resolveUserIdByUserShop(candidates) {
  if (!User || !candidates.length) return null;

  const user = await User.findOne({
    shop: { $in: candidates },
  })
    .select('_id')
    .lean();

  return user?._id || null;
}

async function resolveUserIdByPlatformConnections(platformConnections = []) {
  if (!McpData || !Array.isArray(platformConnections) || platformConnections.length === 0) return null;

  const metaIds = Array.from(new Set(
    platformConnections
      .filter((conn) => String(conn.platform || '').toUpperCase() === 'META')
      .map((conn) => normalizeMetaAccountId(conn.adAccountId))
      .filter(Boolean)
  ));

  const googleIds = Array.from(new Set(
    platformConnections
      .filter((conn) => String(conn.platform || '').toUpperCase() === 'GOOGLE')
      .map((conn) => normalizeGoogleCustomerId(conn.adAccountId))
      .filter(Boolean)
  ));

  if (!metaIds.length && !googleIds.length) return null;

  const orClauses = [];
  if (metaIds.length) orClauses.push({ 'sources.metaAds.accountId': { $in: metaIds } });
  if (googleIds.length) orClauses.push({ 'sources.googleAds.customerId': { $in: googleIds } });

  if (!orClauses.length) return null;

  const rootDoc = await McpData.findOne({
    kind: 'root',
    $or: orClauses,
    latestSnapshotId: { $ne: null }
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return rootDoc?.userId || null;
}

async function resolveUserIdByConnectedAccountDocs(platformConnections = []) {
  if (!Array.isArray(platformConnections) || platformConnections.length === 0) return null;

  const metaIds = Array.from(new Set(
    platformConnections
      .filter((conn) => String(conn.platform || '').toUpperCase() === 'META')
      .map((conn) => normalizeMetaAccountId(conn.adAccountId))
      .filter(Boolean)
  ));

  const googleIds = Array.from(new Set(
    platformConnections
      .filter((conn) => String(conn.platform || '').toUpperCase() === 'GOOGLE')
      .map((conn) => normalizeGoogleCustomerId(conn.adAccountId))
      .filter(Boolean)
  ));

  if (metaIds.length && MetaAccount) {
    const metaDoc = await MetaAccount.findOne({
      $or: [
        { defaultAccountId: { $in: metaIds } },
        { selectedAccountIds: { $in: metaIds } },
        { 'ad_accounts.id': { $in: metaIds } },
        { 'ad_accounts.account_id': { $in: metaIds } },
        { 'adAccounts.id': { $in: metaIds } },
        { 'adAccounts.account_id': { $in: metaIds } },
      ],
    })
      .select('user userId')
      .lean();

    const metaUserId = metaDoc?.userId || metaDoc?.user || null;
    if (metaUserId) return metaUserId;
  }

  if (googleIds.length && GoogleAccount) {
    const googleDoc = await GoogleAccount.findOne({
      $or: [
        { defaultCustomerId: { $in: googleIds } },
        { selectedCustomerIds: { $in: googleIds } },
        { 'customers.id': { $in: googleIds } },
        { 'ad_accounts.id': { $in: googleIds } },
      ],
    })
      .select('user userId')
      .lean();

    const googleUserId = googleDoc?.userId || googleDoc?.user || null;
    if (googleUserId) return googleUserId;
  }

  return null;
}

async function resolvePaidMediaUserId({ accountId, domain, platformConnections = [], fallbackUserId = null }) {
  const candidates = Array.from(new Set([
    normalizeShopDomain(accountId),
    normalizeShopDomain(domain),
  ].filter(Boolean)));

  console.log(`[PaidMedia Trace] resolvePaidMediaUserId account=${accountId} domain=${domain} fallbackUserId=${fallbackUserId || 'none'}`);
  console.log('[PaidMedia Trace] resolve candidates:', candidates);
  console.log('[PaidMedia Trace] incoming platformConnections:', (platformConnections || []).map((conn) => ({
    platform: conn?.platform || null,
    status: conn?.status || null,
    adAccountId: conn?.adAccountId || null,
  })));

  // If the logged-in user actually has their own root doc connected to this account, use it first to ensure data consistency
  if (fallbackUserId && Array.isArray(platformConnections) && platformConnections.length > 0) {
    const rootDoc = await findMcpRoot(fallbackUserId);
    if (rootDoc?.sources) {
      const hasMetaMatch = rootDoc.sources.metaAds?.accountId && platformConnections.some(c => String(c.platform || '').toUpperCase() === 'META' && normalizeMetaAccountId(c.adAccountId) === rootDoc.sources.metaAds.accountId);
      const hasGoogleMatch = rootDoc.sources.googleAds?.customerId && platformConnections.some(c => String(c.platform || '').toUpperCase() === 'GOOGLE' && normalizeGoogleCustomerId(c.adAccountId) === rootDoc.sources.googleAds.customerId);
      if (hasMetaMatch || hasGoogleMatch) {
         console.log(`[PaidMedia Trace] resolvePaidMediaUserId matched fallbackUserId via root/source match user=${fallbackUserId}`);
         return fallbackUserId;
      }
    }
  }

  const fromPlatformConnections = await resolveUserIdByPlatformConnections(platformConnections);
  console.log(`[PaidMedia Trace] resolver fromPlatformConnections => ${fromPlatformConnections || 'none'}`);
  if (fromPlatformConnections) return fromPlatformConnections;

  const fromConnectedAccounts = await resolveUserIdByConnectedAccountDocs(platformConnections);
  console.log(`[PaidMedia Trace] resolver fromConnectedAccounts => ${fromConnectedAccounts || 'none'}`);
  if (fromConnectedAccounts) return fromConnectedAccounts;

  const fromShopConnection = await resolveUserIdByShopConnection(candidates);
  console.log(`[PaidMedia Trace] resolver fromShopConnection => ${fromShopConnection || 'none'}`);
  if (fromShopConnection) return fromShopConnection;

  const fromUserShop = await resolveUserIdByUserShop(candidates);
  console.log(`[PaidMedia Trace] resolver fromUserShop => ${fromUserShop || 'none'}`);
  if (fromUserShop) return fromUserShop;

  console.log(`[PaidMedia Trace] resolver fallback to req.user => ${fallbackUserId || 'none'}`);
  return fallbackUserId;
}

async function resolveShopifyAdminContext(candidates = []) {
  const normalizedCandidates = Array.from(new Set(candidates.filter(Boolean).map(normalizeShopDomain).filter(Boolean)));

  if (ShopConnections && normalizedCandidates.length) {
    const shopConnection = await ShopConnections.findOne({
      shop: { $in: normalizedCandidates },
      accessToken: { $exists: true, $ne: '' },
    })
      .select('shop accessToken matchedToUserId')
      .lean();

    if (shopConnection?.shop && shopConnection?.accessToken) {
      return {
        shop: shopConnection.shop,
        accessToken: shopConnection.accessToken,
        userId: shopConnection.matchedToUserId || null,
      };
    }
  }

  if (User && normalizedCandidates.length) {
    const user = await User.findOne({
      shop: { $in: normalizedCandidates },
      shopifyAccessToken: { $exists: true, $ne: '' },
    })
      .select('shop shopifyAccessToken')
      .lean();

    if (user?.shop && user?.shopifyAccessToken) {
      return {
        shop: user.shop,
        accessToken: user.shopifyAccessToken,
        userId: user._id || null,
      };
    }
  }

  return null;
}

function buildPaidMediaSourceSummary({ sourceState, payload, snapshotId, revenueKey }) {
  const kpis = payload?.headline_kpis || {};
  const spend = toFiniteNumber(kpis.spend, 0);
  const revenue = toFiniteNumber(kpis[revenueKey], toFiniteNumber(kpis.purchase_value || kpis.conversion_value, 0));

  return {
    connected: Boolean(sourceState?.connected),
    ready: Boolean(sourceState?.ready),
    status: String(sourceState?.status || (sourceState?.ready ? 'ready' : sourceState?.connected ? 'connected' : 'disconnected')).toUpperCase(),
    hasSnapshot: Boolean(payload && snapshotId),
    snapshotId: snapshotId || null,
    currency: sourceState?.currency || payload?.meta?.currency || null,
    lastSyncAt: sourceState?.lastSyncAt || null,
    spend,
    revenue,
    roas: toFiniteNumberOrNull(kpis.roas),
    conversions: toFiniteNumber(kpis.purchases ?? kpis.conversions, 0),
    clicks: toFiniteNumber(kpis.link_clicks ?? kpis.clicks, 0),
    spendDeltaPct: toFiniteNumberOrNull(payload?.last7_vs_prev7?.spend_pct),
      roasDelta: toFiniteNumberOrNull(payload?.last7_vs_prev7?.roas_diff),
      campaigns: payload?.top_campaigns || [],
    };
}

function readAttributionLabelCache(cacheKey) {
  const entry = ATTRIBUTION_LABEL_CACHE.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ATTRIBUTION_LABEL_CACHE.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function writeAttributionLabelCache(cacheKey, payload, ttlMs = ATTRIBUTION_LABEL_CACHE_TTL_MS) {
  if (!cacheKey) return;
  ATTRIBUTION_LABEL_CACHE.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });

  if (ATTRIBUTION_LABEL_CACHE.size <= ATTRIBUTION_LABEL_CACHE_MAX_ENTRIES) return;

  const now = Date.now();
  for (const [key, value] of ATTRIBUTION_LABEL_CACHE.entries()) {
    if (value.expiresAt <= now) ATTRIBUTION_LABEL_CACHE.delete(key);
  }

  if (ATTRIBUTION_LABEL_CACHE.size > ATTRIBUTION_LABEL_CACHE_MAX_ENTRIES) {
    const toDelete = ATTRIBUTION_LABEL_CACHE.size - ATTRIBUTION_LABEL_CACHE_MAX_ENTRIES;
    let deleted = 0;
    for (const key of ATTRIBUTION_LABEL_CACHE.keys()) {
      ATTRIBUTION_LABEL_CACHE.delete(key);
      deleted += 1;
      if (deleted >= toDelete) break;
    }
  }
}

function normalizeAttributionLookupValue(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^act_/, '')
    .replace(/^customers\//, '')
    .replace(/-/g, '')
    .replace(/[^\w.]+/g, '');
}

function isOpaqueAttributionIdentifier(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const compact = raw.replace(/[^\da-z]/gi, '');
  if (/^\d{8,}$/.test(raw.replace(/[^\d]/g, ''))) return true;
  if (/^[a-f0-9]{16,}$/i.test(compact)) return true;
  return false;
}

function sanitizeReadableAttributionLabel(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (['-', 'n/a', 'na', 'none', 'null', 'undefined', 'unknown', 'not set'].includes(raw.toLowerCase())) {
    return null;
  }
  if (isOpaqueAttributionIdentifier(raw)) return null;
  return raw;
}

function appendUniqueValue(list, value, { readable = false } = {}) {
  if (!Array.isArray(list)) return;
  const normalized = readable
    ? sanitizeReadableAttributionLabel(value)
    : String(value || '').trim();
  if (!normalized) return;
  if (!list.some((entry) => String(entry || '').trim().toLowerCase() === normalized.toLowerCase())) {
    list.push(normalized);
  }
}

function getObjectStringValue(source, key) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const value = source[key];
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return null;
}

function collectAttributionSignalObjects({ purchase = {}, stitchedEvents = [] } = {}) {
  const objects = [];

  const pushObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    objects.push(value);
  };

  pushObject(purchase);
  pushObject(purchase.orderAttributionSnapshot);
  pushObject(purchase.payloadSnapshot);

  (Array.isArray(stitchedEvents) ? stitchedEvents : []).forEach((event) => {
    pushObject(event);
    const rawPayload = event?.rawPayload && typeof event.rawPayload === 'object'
      ? event.rawPayload
      : event?.payload && typeof event.payload === 'object'
        ? event.payload
        : null;
    pushObject(rawPayload);
    pushObject(rawPayload?.user_data);
    pushObject(rawPayload?.attribution);
    pushObject(rawPayload?.attribution_data);
    pushObject(rawPayload?.source_data);
    pushObject(rawPayload?.sourceData);
    pushObject(rawPayload?.traffic_source);
    pushObject(rawPayload?.trafficSource);
    pushObject(rawPayload?.campaign);
    pushObject(rawPayload?.adset);
    pushObject(rawPayload?.adGroup);
    pushObject(rawPayload?.ad_group);
    pushObject(rawPayload?.ad);
    pushObject(rawPayload?.creative);
    pushObject(rawPayload?.meta);
    pushObject(rawPayload?.google);
  });

  return objects;
}

function collectReadableAttributionCandidates({ purchase = {}, stitchedEvents = [] } = {}) {
  const signalObjects = collectAttributionSignalObjects({ purchase, stitchedEvents });
  const campaignLabels = [];
  const adsetLabels = [];
  const adLabels = [];
  const campaignIds = [];
  const adsetIds = [];
  const adIds = [];
  const gclids = [];
  const fbclids = [];
  const ttclids = [];

  const appendRawLabelOrId = (value, labels, ids) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    if (sanitizeReadableAttributionLabel(raw)) appendUniqueValue(labels, raw, { readable: true });
    else appendUniqueValue(ids, raw);
  };

  appendRawLabelOrId(purchase?.attributedCampaignLabel, campaignLabels, campaignIds);
  appendRawLabelOrId(purchase?.attributedAdsetLabel, adsetLabels, adsetIds);
  appendRawLabelOrId(purchase?.attributedAdLabel, adLabels, adIds);
  appendRawLabelOrId(purchase?.attributedCampaign, campaignLabels, campaignIds);
  appendRawLabelOrId(purchase?.attributedAdset, adsetLabels, adsetIds);
  appendRawLabelOrId(purchase?.attributedAd, adLabels, adIds);

  [
    purchase?.attributedClickId,
    purchase?.orderAttributionSnapshot?.gclid,
    purchase?.orderAttributionSnapshot?.wbraid,
    purchase?.orderAttributionSnapshot?.gbraid,
    purchase?.orderAttributionSnapshot?.msclkid,
    purchase?.payloadSnapshot?.gclid,
    purchase?.payloadSnapshot?.wbraid,
    purchase?.payloadSnapshot?.gbraid,
    purchase?.payloadSnapshot?.msclkid,
  ].forEach((value) => appendUniqueValue(gclids, value));
  [
    purchase?.orderAttributionSnapshot?.fbclid,
    purchase?.payloadSnapshot?.fbclid,
    purchase?.payloadSnapshot?.fbc,
  ].forEach((value) => appendUniqueValue(fbclids, value));
  [
    purchase?.orderAttributionSnapshot?.ttclid,
    purchase?.payloadSnapshot?.ttclid,
  ].forEach((value) => appendUniqueValue(ttclids, value));

  const campaignLabelKeys = [
    'campaign_name',
    'campaignName',
    'utm_campaign_name',
    'utmCampaignName',
    'meta_campaign_name',
    'metaCampaignName',
    'google_campaign_name',
    'googleCampaignName',
    'campaign_label',
    'campaignLabel',
    'source_name',
  ];
  const campaignIdKeys = [
    'campaign_id',
    'campaignId',
    'meta_campaign_id',
    'metaCampaignId',
    'google_campaign_id',
    'googleCampaignId',
  ];
  const adsetLabelKeys = [
    'adset_name',
    'adsetName',
    'ad_group_name',
    'adGroupName',
    'adgroup_name',
    'adGroupLabel',
    'google_adgroup_name',
    'googleAdGroupName',
  ];
  const adsetIdKeys = [
    'adset_id',
    'adsetId',
    'ad_group_id',
    'adGroupId',
    'adgroup_id',
    'google_adgroup_id',
    'googleAdGroupId',
  ];
  const adLabelKeys = [
    'ad_name',
    'adName',
    'creative_name',
    'creativeName',
    'google_ad_name',
    'googleAdName',
    'ad_label',
    'adLabel',
  ];
  const adIdKeys = [
    'ad_id',
    'adId',
    'creative_id',
    'creativeId',
    'google_ad_id',
    'googleAdId',
  ];

  signalObjects.forEach((obj) => {
    campaignLabelKeys.forEach((key) => appendUniqueValue(campaignLabels, getObjectStringValue(obj, key), { readable: true }));
    campaignIdKeys.forEach((key) => appendUniqueValue(campaignIds, getObjectStringValue(obj, key)));
    adsetLabelKeys.forEach((key) => appendUniqueValue(adsetLabels, getObjectStringValue(obj, key), { readable: true }));
    adsetIdKeys.forEach((key) => appendUniqueValue(adsetIds, getObjectStringValue(obj, key)));
    adLabelKeys.forEach((key) => appendUniqueValue(adLabels, getObjectStringValue(obj, key), { readable: true }));
    adIdKeys.forEach((key) => appendUniqueValue(adIds, getObjectStringValue(obj, key)));
    appendUniqueValue(gclids, getObjectStringValue(obj, 'gclid'));
    appendUniqueValue(gclids, getObjectStringValue(obj, 'wbraid'));
    appendUniqueValue(gclids, getObjectStringValue(obj, 'gbraid'));
    appendUniqueValue(gclids, getObjectStringValue(obj, 'msclkid'));
    appendUniqueValue(fbclids, getObjectStringValue(obj, 'fbclid'));
    appendUniqueValue(fbclids, getObjectStringValue(obj, 'fbc'));
    appendUniqueValue(fbclids, getObjectStringValue(obj, '_fbc'));
    appendUniqueValue(ttclids, getObjectStringValue(obj, 'ttclid'));
  });

  return {
    campaignLabels,
    adsetLabels,
    adLabels,
    campaignIds,
    adsetIds,
    adIds,
    gclids,
    fbclids,
    ttclids,
  };
}

function findPaidMediaCampaignLabelFromSummary({ paidMedia = {}, channel = '', campaignIds = [], campaignLabels = [] } = {}) {
  const channelKey = normalizeChannelForStats(channel, channel);
  const rows = channelKey === 'meta'
    ? (Array.isArray(paidMedia?.meta?.campaigns) ? paidMedia.meta.campaigns : [])
    : channelKey === 'google'
      ? (Array.isArray(paidMedia?.google?.campaigns) ? paidMedia.google.campaigns : [])
      : [];
  if (!rows.length) return null;

  const candidates = new Set(
    [...campaignIds, ...campaignLabels]
      .map((value) => normalizeAttributionLookupValue(value))
      .filter(Boolean)
  );
  if (!candidates.size) return null;

  const row = rows.find((entry) => {
    const id = normalizeAttributionLookupValue(entry?.id || entry?.campaign_id || '');
    const name = normalizeAttributionLookupValue(entry?.name || entry?.campaign_name || '');
    return (id && candidates.has(id)) || (name && candidates.has(name));
  });

  return sanitizeReadableAttributionLabel(row?.name || row?.campaign_name || '');
}

async function buildMetaAttributionLookupContext({ userId, paidMedia = {} } = {}) {
  if (!MetaAccount || !userId) return null;

  const doc = await MetaAccount.findOne({
    $or: [{ user: userId }, { userId }],
  })
    .select('+access_token +token +longlivedToken +accessToken +longLivedToken selectedAccountIds defaultAccountId ad_accounts adAccounts')
    .lean()
    .catch(() => null);

  if (!doc) return null;

  const accessToken =
    doc?.access_token ||
    doc?.token ||
    doc?.longlivedToken ||
    doc?.accessToken ||
    doc?.longLivedToken ||
    null;
  if (!accessToken) return null;

  const adAccounts = Array.isArray(doc?.ad_accounts)
    ? doc.ad_accounts
    : Array.isArray(doc?.adAccounts)
      ? doc.adAccounts
      : [];

  const selectedAccountId = Array.isArray(doc?.selectedAccountIds) && doc.selectedAccountIds.length
    ? normalizeMetaAccountId(doc.selectedAccountIds[0])
    : null;
  const defaultAccountId = normalizeMetaAccountId(doc?.defaultAccountId);
  const listedAccountId = normalizeMetaAccountId(adAccounts?.[0]?.id || adAccounts?.[0]?.account_id || null);
  const accountId = normalizeMetaAccountId(paidMedia?.meta?.connectedResourceId || selectedAccountId || defaultAccountId || listedAccountId);
  if (!accountId) return null;

  return {
    accessToken,
    accountId,
    graphBase: `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION || 'v23.0'}`,
    appSecretProof: buildMetaAppSecretProof(accessToken),
  };
}

async function fetchMetaAttributionEntityById(context, entityType, entityId) {
  const normalizedId = String(entityId || '').trim();
  if (!context || !entityType || !normalizedId) return null;

  const cacheKey = `meta:${entityType}:${normalizedId}`;
  const cached = readAttributionLabelCache(cacheKey);
  if (cached) return cached;

  let fields = 'id,name';
  if (entityType === 'ad') fields = 'id,name,adset{id,name,campaign{id,name}}';
  if (entityType === 'adset') fields = 'id,name,campaign{id,name}';

  try {
    const response = await axios.get(`${context.graphBase}/${normalizedId}`, {
      params: {
        access_token: context.accessToken,
        ...(context.appSecretProof ? { appsecret_proof: context.appSecretProof } : {}),
        fields,
      },
      timeout: 15000,
    });

    const payload = response?.data || {};
    const result = {
      campaignLabel: sanitizeReadableAttributionLabel(
        payload?.campaign?.name || payload?.adset?.campaign?.name || (entityType === 'campaign' ? payload?.name : '')
      ),
      adsetLabel: sanitizeReadableAttributionLabel(
        payload?.adset?.name || (entityType === 'adset' ? payload?.name : '')
      ),
      adLabel: sanitizeReadableAttributionLabel(entityType === 'ad' ? payload?.name : ''),
    };
    writeAttributionLabelCache(cacheKey, result);
    return result;
  } catch (error) {
    const fallback = {};
    writeAttributionLabelCache(cacheKey, fallback, 5 * 60 * 1000);
    console.warn('[Attribution Labels] Meta lookup failed', {
      entityType,
      entityId: normalizedId,
      status: error?.response?.status || null,
      message: error?.message || String(error),
    });
    return fallback;
  }
}

function escapeGaqlString(value = '') {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function buildGoogleAttributionLookupContext({ userId, paidMedia = {} } = {}) {
  if (!GoogleAccount || !googleAdsService?.searchGAQLStream || !userId) return null;

  const googleDoc = await GoogleAccount.findOne({
    $or: [{ user: userId }, { userId }],
  })
    .select('+accessToken +refreshToken selectedCustomerIds defaultCustomerId customers ad_accounts')
    .lean()
    .catch(() => null);

  if (!googleDoc) return null;

  const selectedCustomerId = Array.isArray(googleDoc?.selectedCustomerIds) && googleDoc.selectedCustomerIds.length
    ? normalizeGoogleCustomerId(googleDoc.selectedCustomerIds[0])
    : null;
  const defaultCustomerId = normalizeGoogleCustomerId(googleDoc?.defaultCustomerId);
  const customerList = Array.isArray(googleDoc?.ad_accounts) && googleDoc.ad_accounts.length
    ? googleDoc.ad_accounts
    : (Array.isArray(googleDoc?.customers) ? googleDoc.customers : []);
  const listedCustomerId = normalizeGoogleCustomerId(customerList?.[0]?.id || null);
  const customerId = normalizeGoogleCustomerId(
    paidMedia?.google?.connectedResourceId || selectedCustomerId || defaultCustomerId || listedCustomerId
  );
  if (!customerId) return null;

  return {
    googleDoc,
    customerId,
  };
}

async function fetchGoogleAttributionEntityByQuery(context, cacheKey, query) {
  if (!context || !cacheKey || !query) return null;

  const cached = readAttributionLabelCache(cacheKey);
  if (cached) return cached;

  try {
    const rows = await googleAdsService.searchGAQLStream(context.googleDoc, context.customerId, query);
    const first = Array.isArray(rows) ? rows[0] || null : null;
    const result = {
      campaignLabel: sanitizeReadableAttributionLabel(first?.campaign?.name || first?.campaign?.campaignName || ''),
      adsetLabel: sanitizeReadableAttributionLabel(first?.adGroup?.name || first?.ad_group?.name || ''),
      adLabel: sanitizeReadableAttributionLabel(first?.adGroupAd?.ad?.name || first?.ad_group_ad?.ad?.name || ''),
    };
    writeAttributionLabelCache(cacheKey, result);
    return result;
  } catch (error) {
    const fallback = {};
    writeAttributionLabelCache(cacheKey, fallback, 5 * 60 * 1000);
    console.warn('[Attribution Labels] Google lookup failed', {
      cacheKey,
      customerId: context?.customerId || null,
      status: error?.status || error?.response?.status || null,
      message: error?.message || String(error),
    });
    return fallback;
  }
}

function mergeReadableAttributionLabels(base = {}, incoming = {}) {
  return {
    campaignLabel: base.campaignLabel || incoming.campaignLabel || null,
    adsetLabel: base.adsetLabel || incoming.adsetLabel || null,
    adLabel: base.adLabel || incoming.adLabel || null,
  };
}

function pickBestAttributionDisplayLabel(labels = {}) {
  return labels.adLabel || labels.adsetLabel || labels.campaignLabel || null;
}

function createAttributionLabelResolver({ userId = null, paidMedia = {} } = {}) {
  let metaContextPromise = null;
  let googleContextPromise = null;

  const getMetaContext = async () => {
    if (!metaContextPromise) {
      metaContextPromise = buildMetaAttributionLookupContext({ userId, paidMedia });
    }
    return metaContextPromise;
  };

  const getGoogleContext = async () => {
    if (!googleContextPromise) {
      googleContextPromise = buildGoogleAttributionLookupContext({ userId, paidMedia });
    }
    return googleContextPromise;
  };

  return {
    async resolveForPurchase({ purchase = {}, stitchedEvents = [] } = {}) {
      const channelKey = normalizeChannelForStats(purchase?.attributedChannel || '', purchase?.attributedPlatform || '');
      const candidates = collectReadableAttributionCandidates({ purchase, stitchedEvents });

      let labels = {
        campaignLabel: candidates.campaignLabels[0] || null,
        adsetLabel: candidates.adsetLabels[0] || null,
        adLabel: candidates.adLabels[0] || null,
      };

      const summaryCampaignLabel = findPaidMediaCampaignLabelFromSummary({
        paidMedia,
        channel: channelKey,
        campaignIds: candidates.campaignIds,
        campaignLabels: candidates.campaignLabels,
      });
      if (!labels.campaignLabel && summaryCampaignLabel) {
        labels.campaignLabel = summaryCampaignLabel;
      }

      if (channelKey === 'meta') {
        const metaContext = await getMetaContext();
        if (metaContext) {
          const metaLookupResults = await Promise.all([
            ...candidates.adIds.slice(0, 2).map((id) => fetchMetaAttributionEntityById(metaContext, 'ad', id)),
            ...candidates.adsetIds.slice(0, 2).map((id) => fetchMetaAttributionEntityById(metaContext, 'adset', id)),
            ...candidates.campaignIds.slice(0, 2).map((id) => fetchMetaAttributionEntityById(metaContext, 'campaign', id)),
          ]);

          metaLookupResults.forEach((result) => {
            labels = mergeReadableAttributionLabels(labels, result || {});
          });
        }
      }

      if (channelKey === 'google') {
        const googleContext = await getGoogleContext();
        if (googleContext) {
          const googleQueries = [];

          candidates.adIds.slice(0, 2).forEach((id) => {
            const normalizedId = String(id || '').replace(/[^\d]/g, '');
            if (!normalizedId) return;
            googleQueries.push(
              fetchGoogleAttributionEntityByQuery(
                googleContext,
                `google:ad:${googleContext.customerId}:${normalizedId}`,
                `
                  SELECT
                    campaign.id,
                    campaign.name,
                    ad_group.id,
                    ad_group.name
                  FROM ad_group_ad
                  WHERE ad_group_ad.ad.id = ${normalizedId}
                  LIMIT 1
                `
              )
            );
          });

          candidates.adsetIds.slice(0, 2).forEach((id) => {
            const normalizedId = String(id || '').replace(/[^\d]/g, '');
            if (!normalizedId) return;
            googleQueries.push(
              fetchGoogleAttributionEntityByQuery(
                googleContext,
                `google:adgroup:${googleContext.customerId}:${normalizedId}`,
                `
                  SELECT
                    campaign.id,
                    campaign.name,
                    ad_group.id,
                    ad_group.name
                  FROM ad_group
                  WHERE ad_group.id = ${normalizedId}
                  LIMIT 1
                `
              )
            );
          });

          candidates.campaignIds.slice(0, 2).forEach((id) => {
            const normalizedId = String(id || '').replace(/[^\d]/g, '');
            if (!normalizedId) return;
            googleQueries.push(
              fetchGoogleAttributionEntityByQuery(
                googleContext,
                `google:campaign:${googleContext.customerId}:${normalizedId}`,
                `
                  SELECT
                    campaign.id,
                    campaign.name
                  FROM campaign
                  WHERE campaign.id = ${normalizedId}
                  LIMIT 1
                `
              )
            );
          });

          const primaryCreatedAt = purchase?.createdAt || purchase?.platformCreatedAt || new Date();
          const gclidWindowEnd = formatYmd(primaryCreatedAt);
          const gclidWindowStart = formatYmd(subDays(primaryCreatedAt instanceof Date ? primaryCreatedAt : new Date(primaryCreatedAt), 90));

          candidates.gclids.slice(0, 2).forEach((gclid) => {
            const safeGclid = escapeGaqlString(gclid);
            if (!safeGclid) return;
            googleQueries.push(
              fetchGoogleAttributionEntityByQuery(
                googleContext,
                `google:gclid:${googleContext.customerId}:${safeGclid}:${gclidWindowStart}:${gclidWindowEnd}`,
                `
                  SELECT
                    click_view.gclid,
                    campaign.id,
                    campaign.name,
                    ad_group.id,
                    ad_group.name
                  FROM click_view
                  WHERE segments.date BETWEEN '${gclidWindowStart}' AND '${gclidWindowEnd}'
                    AND click_view.gclid = '${safeGclid}'
                  ORDER BY segments.date DESC
                  LIMIT 1
                `
              )
            );
          });

          const googleLookupResults = await Promise.all(googleQueries);
          googleLookupResults.forEach((result) => {
            labels = mergeReadableAttributionLabels(labels, result || {});
          });
        }
      }

      return {
        ...labels,
        displayLabel: pickBestAttributionDisplayLabel(labels),
      };
    },
  };
}

function formatYmd(dateValue) {
  const dt = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
  if (Number.isNaN(dt.getTime())) return format(new Date(), 'yyyy-MM-dd');
  return format(dt, 'yyyy-MM-dd');
}

function pickMetaValueByPriority(items = [], priorities = []) {
  if (!Array.isArray(items)) return 0;
  for (const key of priorities) {
    const found = items.find((entry) => String(entry?.action_type || '') === key);
    const value = Number(found?.value || 0);
    if (Number.isFinite(value) && value !== 0) return value;
  }
  return 0;
}

function mapMetaCampaignRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const campaignRevenue = toFiniteNumber(
      pickMetaValueByPriority(row?.action_values || [], [
        'omni_purchase',
        'offsite_conversion.fb_pixel_purchase',
        'onsite_conversion.purchase',
        'purchase',
      ]),
      0
    );
    const campaignSpend = toFiniteNumber(row?.spend, 0);
    return {
      id: row?.campaign_id || null,
      name: row?.campaign_name || null,
      spend: campaignSpend,
      revenue: campaignRevenue,
      roas: campaignSpend > 0 ? Number((campaignRevenue / campaignSpend).toFixed(2)) : null,
      status: null,
    };
  });
}

function buildMetaAppSecretProof(accessToken) {
  const appSecret = String(process.env.FACEBOOK_APP_SECRET || '').trim();
  if (!appSecret || !accessToken) return null;
  try {
    return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
  } catch (_) {
    return null;
  }
}

async function fetchMetaPaidMediaDirect({ userId, startDate, endDate }) {
  if (!MetaAccount) return null;

  const metaDoc = await MetaAccount.findOne({
    $or: [{ user: userId }, { userId }],
  })
    .select('+access_token +token +longlivedToken +accessToken +longLivedToken defaultAccountId ad_accounts adAccounts selectedAccountIds')
    .lean();

  if (!metaDoc) return null;

  const accessToken =
    metaDoc?.access_token ||
    metaDoc?.token ||
    metaDoc?.longlivedToken ||
    metaDoc?.accessToken ||
    metaDoc?.longLivedToken ||
    null;

  if (!accessToken) return null;

  const adAccounts = Array.isArray(metaDoc?.ad_accounts)
    ? metaDoc.ad_accounts
    : Array.isArray(metaDoc?.adAccounts)
      ? metaDoc.adAccounts
      : [];

  const selectedAccountId = Array.isArray(metaDoc?.selectedAccountIds) && metaDoc.selectedAccountIds.length
    ? normalizeMetaAccountId(metaDoc.selectedAccountIds[0])
    : null;

  const defaultAccountId = normalizeMetaAccountId(metaDoc?.defaultAccountId);
  const listAccountId = normalizeMetaAccountId(adAccounts?.[0]?.id || adAccounts?.[0]?.account_id || null);
  const accountId = selectedAccountId || defaultAccountId || listAccountId;
  if (!accountId) return null;

  const docAccounts = adAccounts.map((entry) => ({
    accountId: normalizeMetaAccountId(entry?.id || entry?.account_id || null),
    name: entry?.name || entry?.account_name || null,
    status: entry?.account_status ?? entry?.configured_status ?? null,
    currency: entry?.currency || entry?.account_currency || null,
  })).filter((entry) => entry.accountId);

  const since = formatYmd(startDate);
  const until = formatYmd(endDate);
  const fbVersion = process.env.FACEBOOK_API_VERSION || 'v23.0';
  const graphBase = `https://graph.facebook.com/${fbVersion}`;
  const appSecretProof = buildMetaAppSecretProof(accessToken);

  const paramsBase = {
    access_token: accessToken,
    time_range: JSON.stringify({ since, until }),
    action_report_time: 'conversion',
    use_unified_attribution_setting: true,
  };
  if (appSecretProof) {
    paramsBase.appsecret_proof = appSecretProof;
  }

  console.log('[PaidMedia Direct] meta request context:', {
    userId: String(userId),
    accountId,
    selectedAccountId,
    defaultAccountId,
    listAccountId,
    since,
    until,
    hasAppSecretProof: Boolean(appSecretProof),
    docAccounts,
  });

  let accessibleAccounts = [];
  try {
    const meAccountsRes = await axios.get(`${graphBase}/me/adaccounts`, {
      params: {
        access_token: accessToken,
        ...(appSecretProof ? { appsecret_proof: appSecretProof } : {}),
        fields: 'account_id,name,account_status,currency,timezone_name,amount_spent',
        limit: 100,
      },
    });
    accessibleAccounts = (Array.isArray(meAccountsRes?.data?.data) ? meAccountsRes.data.data : []).map((entry) => ({
      accountId: normalizeMetaAccountId(entry?.account_id || null),
      name: entry?.name || null,
      status: entry?.account_status ?? null,
      currency: entry?.currency || null,
      timezone: entry?.timezone_name || null,
      amountSpentLifetime: toFiniteNumber(entry?.amount_spent, 0),
    })).filter((entry) => entry.accountId);

    console.log('[PaidMedia Direct] meta accessible accounts:', accessibleAccounts);

    const selectedAccessible = accessibleAccounts.find((entry) => entry.accountId === accountId);
    if (!selectedAccessible) {
      console.warn('[PaidMedia Direct] Selected account is not present in /me/adaccounts list', { accountId });
    }
  } catch (meAccountsErr) {
    console.warn('[PaidMedia Direct] Could not fetch /me/adaccounts for diagnostics:', {
      status: meAccountsErr?.response?.status || null,
      message: meAccountsErr?.message || String(meAccountsErr),
      detail: meAccountsErr?.response?.data || null,
    });
  }

  let accountInsightsRes = null;
  try {
    accountInsightsRes = await axios.get(`${graphBase}/act_${accountId}/insights`, {
      params: {
        ...paramsBase,
        level: 'account',
        limit: 1,
        fields: 'date_start,date_stop,spend,clicks,impressions,actions,action_values,purchase_roas',
      },
    });
  } catch (error) {
    const status = error?.response?.status || null;
    const detail = error?.response?.data || error?.message || error;
    const wrapped = new Error(`[meta account insights] ${status || 'ERR'}: ${error?.message || 'failed'}`);
    wrapped.status = status;
    wrapped.data = detail;
    throw wrapped;
  }

  const accountRows = Array.isArray(accountInsightsRes?.data?.data) ? accountInsightsRes.data.data : [];
  const accountRow = accountRows[0] || null;
  console.log('[PaidMedia Direct] Meta account insights rows:', {
    accountId,
    since,
    until,
    rows: accountRows.length,
    firstRow: accountRow ? {
      date_start: accountRow?.date_start || null,
      date_stop: accountRow?.date_stop || null,
      spend: accountRow?.spend || null,
      clicks: accountRow?.clicks || null,
      impressions: accountRow?.impressions || null,
    } : null,
  });

  let spend = toFiniteNumber(accountRow?.spend, 0);
  let revenue = toFiniteNumber(
    pickMetaValueByPriority(accountRow?.action_values || [], [
      'omni_purchase',
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.purchase',
      'purchase',
    ]),
    0
  );

  if (!accountRows.length) {
    console.warn('[PaidMedia Direct] Meta account insights returned no rows for range', { accountId, since, until });
  }

  let currency = null;
  let accountName = null;
  try {
    const accountInfoRes = await axios.get(`${graphBase}/act_${accountId}`, {
      params: {
        access_token: accessToken,
        ...(appSecretProof ? { appsecret_proof: appSecretProof } : {}),
        fields: 'currency,account_id,name',
      },
    });
    currency = accountInfoRes?.data?.currency || null;
    accountName = accountInfoRes?.data?.name || null;
  } catch (_) {}

  let campaigns = [];
  let effectiveSince = since;
  let effectiveUntil = until;
  let rangeFallbackUsed = false;
  try {
    const campaignInsightsRes = await axios.get(`${graphBase}/act_${accountId}/insights`, {
      params: {
        ...paramsBase,
        level: 'campaign',
        limit: 10,
        fields: 'campaign_id,campaign_name,spend,clicks,impressions,actions,action_values,purchase_roas',
      },
    });

    campaigns = mapMetaCampaignRows(Array.isArray(campaignInsightsRes?.data?.data) ? campaignInsightsRes.data.data : []);
    console.log('[PaidMedia Direct] Meta campaign insights rows:', {
      accountId,
      since,
      until,
      rows: campaigns.length,
      top: campaigns.slice(0, 3).map((campaign) => ({
        id: campaign?.id || null,
        name: campaign?.name || null,
        spend: campaign?.spend || 0,
        revenue: campaign?.revenue || 0,
      })),
    });
  } catch (campaignErr) {
    console.warn('[PaidMedia Direct] Meta campaign fetch failed:', {
      status: campaignErr?.response?.status || null,
      message: campaignErr?.message || String(campaignErr),
      detail: campaignErr?.response?.data || null,
    });
  }

  if (spend <= 0 && campaigns.length > 0) {
    const campaignSpendSum = campaigns.reduce((acc, campaign) => acc + toFiniteNumber(campaign?.spend, 0), 0);
    const campaignRevenueSum = campaigns.reduce((acc, campaign) => acc + toFiniteNumber(campaign?.revenue, 0), 0);
    if (campaignSpendSum > 0) {
      spend = Number(campaignSpendSum.toFixed(2));
      if (revenue <= 0 && campaignRevenueSum > 0) {
        revenue = Number(campaignRevenueSum.toFixed(2));
      }
      console.log('[PaidMedia Direct] Meta spend derived from campaign rows:', { accountId, spend, revenue });
    }
  }

  if (spend <= 0 && campaigns.length === 0) {
    const fallbackSince = formatYmd(subDays(endDate instanceof Date ? endDate : new Date(), 365));
    if (fallbackSince !== since) {
      console.log('[PaidMedia Direct] Meta range fallback to 12 months:', { accountId, from: since, to: until, fallbackSince });

      const fallbackParamsBase = {
        ...paramsBase,
        time_range: JSON.stringify({ since: fallbackSince, until }),
      };

      try {
        const fallbackAccountRes = await axios.get(`${graphBase}/act_${accountId}/insights`, {
          params: {
            ...fallbackParamsBase,
            level: 'account',
            limit: 1,
            fields: 'date_start,date_stop,spend,clicks,impressions,actions,action_values,purchase_roas',
          },
        });
        const fallbackAccountRow = Array.isArray(fallbackAccountRes?.data?.data) ? fallbackAccountRes.data.data[0] : null;
        console.log('[PaidMedia Direct] Meta fallback account row:', {
          accountId,
          fallbackSince,
          until,
          row: fallbackAccountRow ? {
            date_start: fallbackAccountRow?.date_start || null,
            date_stop: fallbackAccountRow?.date_stop || null,
            spend: fallbackAccountRow?.spend || null,
            clicks: fallbackAccountRow?.clicks || null,
            impressions: fallbackAccountRow?.impressions || null,
          } : null,
        });

        const fallbackSpend = toFiniteNumber(fallbackAccountRow?.spend, 0);
        const fallbackRevenue = toFiniteNumber(
          pickMetaValueByPriority(fallbackAccountRow?.action_values || [], [
            'omni_purchase',
            'offsite_conversion.fb_pixel_purchase',
            'onsite_conversion.purchase',
            'purchase',
          ]),
          0
        );

        const fallbackCampaignRes = await axios.get(`${graphBase}/act_${accountId}/insights`, {
          params: {
            ...fallbackParamsBase,
            level: 'campaign',
            limit: 10,
            fields: 'campaign_id,campaign_name,spend,clicks,impressions,actions,action_values,purchase_roas',
          },
        });
        const fallbackCampaigns = mapMetaCampaignRows(Array.isArray(fallbackCampaignRes?.data?.data) ? fallbackCampaignRes.data.data : []);
        console.log('[PaidMedia Direct] Meta fallback campaign rows:', {
          accountId,
          fallbackSince,
          until,
          rows: fallbackCampaigns.length,
          top: fallbackCampaigns.slice(0, 3).map((campaign) => ({
            id: campaign?.id || null,
            name: campaign?.name || null,
            spend: campaign?.spend || 0,
            revenue: campaign?.revenue || 0,
          })),
        });

        let resolvedFallbackSpend = fallbackSpend;
        let resolvedFallbackRevenue = fallbackRevenue;
        if (resolvedFallbackSpend <= 0 && fallbackCampaigns.length > 0) {
          resolvedFallbackSpend = Number(fallbackCampaigns.reduce((acc, campaign) => acc + toFiniteNumber(campaign?.spend, 0), 0).toFixed(2));
          if (resolvedFallbackRevenue <= 0) {
            resolvedFallbackRevenue = Number(fallbackCampaigns.reduce((acc, campaign) => acc + toFiniteNumber(campaign?.revenue, 0), 0).toFixed(2));
          }
        }

        if (resolvedFallbackSpend > 0 || fallbackCampaigns.length > 0) {
          spend = resolvedFallbackSpend;
          revenue = resolvedFallbackRevenue;
          campaigns = fallbackCampaigns;
          effectiveSince = fallbackSince;
          effectiveUntil = until;
          rangeFallbackUsed = true;
          console.log('[PaidMedia Direct] Meta fallback produced data:', {
            accountId,
            spend,
            revenue,
            campaigns: campaigns.length,
            effectiveSince,
            effectiveUntil,
          });
        }
      } catch (fallbackErr) {
        console.warn('[PaidMedia Direct] Meta 12m fallback failed:', {
          status: fallbackErr?.response?.status || null,
          message: fallbackErr?.message || String(fallbackErr),
          detail: fallbackErr?.response?.data || null,
        });
      }
    }
  }

  const roas = spend > 0 ? Number((revenue / spend).toFixed(2)) : null;
  console.log('[PaidMedia Direct] Meta resolved payload:', {
    accountId,
    spend,
    revenue,
    roas,
    campaigns: campaigns.length,
    range: { since: effectiveSince, until: effectiveUntil, fallbackUsed: rangeFallbackUsed },
  });

  return {
    provider: 'meta',
    accountId,
    accountName,
    snapshotId: `direct_meta_${Date.now()}`,
    spend,
    revenue,
    roas,
    clicks: toFiniteNumber(accountRow?.clicks, 0),
    conversions: toFiniteNumber(pickMetaValueByPriority(accountRow?.actions || [], ['purchase', 'omni_purchase']), 0),
    currency: currency || 'MXN',
    campaigns,
    rangeUsed: {
      since: effectiveSince,
      until: effectiveUntil,
      fallbackUsed: rangeFallbackUsed,
    },
  };
}

async function fetchGooglePaidMediaDirect({ userId, startDate, endDate }) {
  if (!GoogleAccount || !googleAdsService?.fetchInsights) return null;

  const googleDoc = await GoogleAccount.findOne({
    $or: [{ user: userId }, { userId }],
  })
    .select('+accessToken +refreshToken selectedCustomerIds defaultCustomerId customers ad_accounts objective')
    .lean();

  if (!googleDoc) return null;

  const selectedCustomerId = Array.isArray(googleDoc?.selectedCustomerIds) && googleDoc.selectedCustomerIds.length
    ? normalizeGoogleCustomerId(googleDoc.selectedCustomerIds[0])
    : null;
  const defaultCustomerId = normalizeGoogleCustomerId(googleDoc?.defaultCustomerId);
  const customerList = Array.isArray(googleDoc?.ad_accounts) && googleDoc.ad_accounts.length
    ? googleDoc.ad_accounts
    : (Array.isArray(googleDoc?.customers) ? googleDoc.customers : []);
  const listCustomerId = normalizeGoogleCustomerId(customerList?.[0]?.id || null);
  const customerId = selectedCustomerId || defaultCustomerId || listCustomerId;
  if (!customerId) return null;
  const connectedCustomer = customerList.find((entry) => normalizeGoogleCustomerId(entry?.id || '') === customerId) || null;
  const customerName = connectedCustomer?.name || connectedCustomer?.descriptiveName || connectedCustomer?.descriptive_name || null;

  const start = startDate instanceof Date ? startDate : new Date(startDate || Date.now());
  const end = endDate instanceof Date ? endDate : new Date(endDate || Date.now());
  const rangeDays = Math.max(1, Math.min(90, Math.round((end.getTime() - start.getTime()) / 86400000) + 1));

  const payload = await googleAdsService.fetchInsights({
    googleAccount: googleDoc,
    customerId,
    range: rangeDays,
    includeToday: true,
    objective: googleDoc?.objective || 'ventas',
  });

  const spend = toFiniteNumber(payload?.kpis?.cost, 0);
  const revenue = toFiniteNumber(payload?.kpis?.conv_value, 0);
  const roas = payload?.kpis?.roas != null ? toFiniteNumberOrNull(payload?.kpis?.roas) : (spend > 0 ? Number((revenue / spend).toFixed(2)) : null);
  const campaigns = Array.isArray(payload?.campaigns)
    ? payload.campaigns.slice(0, 10).map((campaign) => ({
        id: campaign?.id || null,
        name: campaign?.name || null,
        spend: toFiniteNumber(campaign?.cost, 0),
        revenue: toFiniteNumber(campaign?.conv_value, 0),
        roas: toFiniteNumberOrNull(campaign?.roas),
        status: campaign?.status || null,
      }))
    : [];

  return {
    provider: 'google',
    customerId,
    customerName,
    snapshotId: `direct_google_${Date.now()}`,
    spend,
    revenue,
    roas,
    clicks: toFiniteNumber(payload?.kpis?.clicks, 0),
    conversions: toFiniteNumber(payload?.kpis?.conversions, 0),
    currency: payload?.currency || 'MXN',
    campaigns,
    rangeUsed: {
      since: payload?.range?.since || null,
      until: payload?.range?.until || null,
      fallbackUsed: false,
    },
  };
}

function shouldDebouncePaidMediaSync(userId, source) {
  const key = `${String(userId || '')}:${String(source || '')}`;
  if (!key || key === ':') return true;

  const now = Date.now();
  const prev = PAID_MEDIA_SYNC_DEBOUNCE.get(key) || 0;
  if (now - prev < PAID_MEDIA_SYNC_DEBOUNCE_MS) {
    return true;
  }

  PAID_MEDIA_SYNC_DEBOUNCE.set(key, now);
  return false;
}

async function triggerPaidMediaAutoSyncIfNeeded({ userId, accountId, summary, rootDoc }) {
  if (!userId || !summary || !rootDoc?.sources) return;

  const userIdStr = String(userId);
  const metaState = rootDoc.sources?.metaAds || {};
  const googleState = rootDoc.sources?.googleAds || {};

  const metaNeedsSync = Boolean(
    summary?.meta?.connected &&
    (
      !summary?.meta?.hasSnapshot ||
      summary?.meta?.status === 'QUEUED' ||
      summary?.meta?.spend <= 0
    )
  );

  const googleNeedsSync = Boolean(
    summary?.google?.connected &&
    (
      !summary?.google?.hasSnapshot ||
      summary?.google?.status === 'QUEUED' ||
      summary?.google?.spend <= 0
    )
  );

  console.log('[PaidMedia Trace] auto-sync decision:', {
    userId: userIdStr,
    accountId,
    metaNeedsSync,
    googleNeedsSync,
    metaStatus: summary?.meta?.status || null,
    googleStatus: summary?.google?.status || null,
    metaHasSnapshot: summary?.meta?.hasSnapshot || false,
    googleHasSnapshot: summary?.google?.hasSnapshot || false,
  });

  if (metaNeedsSync && enqueueMetaCollectBestEffort && !shouldDebouncePaidMediaSync(userIdStr, 'metaAds')) {
    const metaAccountId =
      metaState?.selectedAccountId ||
      metaState?.accountId ||
      null;

    const metaEnqueue = await enqueueMetaCollectBestEffort({
      userId: userIdStr,
      metaAccountId,
      rangeDays: 60,
      reason: 'paid_media_auto_sync',
      trigger: 'analytics_paid_media',
      forceFull: false,
      extra: { accountId },
    });

    console.log('[PaidMedia Trace] meta auto-sync enqueue result:', metaEnqueue);
  }

  if (googleNeedsSync && enqueueGoogleAdsCollectBestEffort && !shouldDebouncePaidMediaSync(userIdStr, 'googleAds')) {
    const googleAccountId =
      googleState?.selectedCustomerId ||
      googleState?.customerId ||
      null;

    const googleEnqueue = await enqueueGoogleAdsCollectBestEffort({
      userId: userIdStr,
      accountId: googleAccountId,
      rangeDays: 60,
      reason: 'paid_media_auto_sync',
      trigger: 'analytics_paid_media',
      forceFull: false,
      extra: { accountId },
    });

    console.log('[PaidMedia Trace] google auto-sync enqueue result:', googleEnqueue);
  }
}

async function buildPaidMediaSummary({ accountId, domain, platformConnections = [], fallbackUserId = null, startDate = null, endDate = null }) {
  console.log(`[PaidMedia] Starting buildPaidMediaSummary for accountId: ${accountId}, domain: ${domain}, mode=direct_api_only`);

  const sourceTemplate = () => ({
    connected: false,
    ready: false,
    status: 'DISCONNECTED',
    hasSnapshot: false,
    snapshotId: null,
    currency: null,
    lastSyncAt: null,
    spend: 0,
    revenue: 0,
    roas: null,
    conversions: 0,
    clicks: 0,
    spendDeltaPct: null,
    roasDelta: null,
    campaigns: [],
    connectedResourceId: null,
    connectedResourceName: null,
    activeCampaignId: null,
    activeCampaignName: null,
    dataOrigin: 'direct_api',
  });

  const base = {
    linked: false,
    available: false,
    reason: 'not_linked',
    meta: sourceTemplate(),
    google: sourceTemplate(),
    blended: {
      spend: 0,
      revenue: 0,
      roas: null,
      currency: null,
    },
  };

  const userId = fallbackUserId ? String(fallbackUserId) : null;
  if (!userId) {
    console.warn(`[PaidMedia] No authenticated user context for ${accountId}`);
    return { ...base, reason: 'user_not_resolved' };
  }

  const start = startDate instanceof Date ? startDate : subDays(new Date(), 30);
  const end = endDate instanceof Date ? endDate : new Date();

  try {
    const [metaDoc, googleDoc] = await Promise.all([
      MetaAccount
        ? MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
            .select('+access_token +token +longlivedToken +accessToken +longLivedToken selectedAccountIds defaultAccountId ad_accounts adAccounts')
            .lean()
        : null,
      GoogleAccount
        ? GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
            .select('+accessToken +refreshToken selectedCustomerIds defaultCustomerId ad_accounts customers')
            .lean()
        : null,
    ]);

    const metaToken =
      metaDoc?.access_token ||
      metaDoc?.token ||
      metaDoc?.longlivedToken ||
      metaDoc?.accessToken ||
      metaDoc?.longLivedToken ||
      null;

    const metaAccounts = Array.isArray(metaDoc?.ad_accounts)
      ? metaDoc.ad_accounts
      : Array.isArray(metaDoc?.adAccounts)
        ? metaDoc.adAccounts
        : [];
    const metaSelectedId = Array.isArray(metaDoc?.selectedAccountIds) && metaDoc.selectedAccountIds.length
      ? normalizeMetaAccountId(metaDoc.selectedAccountIds[0])
      : null;
    const metaDefaultId = normalizeMetaAccountId(metaDoc?.defaultAccountId);
    const metaListId = normalizeMetaAccountId(metaAccounts?.[0]?.id || metaAccounts?.[0]?.account_id || null);
    const metaConnectedId = metaSelectedId || metaDefaultId || metaListId;
    const metaConnectedAccount = metaAccounts.find((entry) => normalizeMetaAccountId(entry?.id || entry?.account_id || '') === metaConnectedId) || null;
    const metaConnectedName = metaConnectedAccount?.name || metaConnectedAccount?.account_name || null;
    const metaConnected = Boolean(metaToken && metaConnectedId);

    const googleToken = googleDoc?.accessToken || googleDoc?.refreshToken || null;
    const googleAccounts = Array.isArray(googleDoc?.ad_accounts) && googleDoc.ad_accounts.length
      ? googleDoc.ad_accounts
      : (Array.isArray(googleDoc?.customers) ? googleDoc.customers : []);
    const googleSelectedId = Array.isArray(googleDoc?.selectedCustomerIds) && googleDoc.selectedCustomerIds.length
      ? normalizeGoogleCustomerId(googleDoc.selectedCustomerIds[0])
      : null;
    const googleDefaultId = normalizeGoogleCustomerId(googleDoc?.defaultCustomerId);
    const googleListId = normalizeGoogleCustomerId(googleAccounts?.[0]?.id || null);
    const googleConnectedId = googleSelectedId || googleDefaultId || googleListId;
    const googleConnectedAccount = googleAccounts.find((entry) => normalizeGoogleCustomerId(entry?.id || '') === googleConnectedId) || null;
    const googleConnectedName = googleConnectedAccount?.name || googleConnectedAccount?.descriptiveName || googleConnectedAccount?.descriptive_name || null;
    const googleConnected = Boolean(googleToken && googleConnectedId);

    const summary = {
      ...base,
      linked: metaConnected || googleConnected,
      reason: (metaConnected || googleConnected) ? 'live_data_unavailable' : 'not_linked',
      meta: {
        ...base.meta,
        connected: metaConnected,
        status: metaConnected ? 'CONNECTED' : 'DISCONNECTED',
        connectedResourceId: metaConnectedId || null,
        connectedResourceName: metaConnectedName || null,
      },
      google: {
        ...base.google,
        connected: googleConnected,
        status: googleConnected ? 'CONNECTED' : 'DISCONNECTED',
        connectedResourceId: googleConnectedId || null,
        connectedResourceName: googleConnectedName || null,
      },
    };

    let metaLive = null;
    if (metaConnected) {
      try {
        metaLive = await fetchMetaPaidMediaDirect({ userId, startDate: start, endDate: end });
      } catch (metaDirectError) {
        console.warn('[PaidMedia Direct] meta live fetch failed:', {
          message: metaDirectError?.message || String(metaDirectError),
          status: metaDirectError?.status || metaDirectError?.response?.status || null,
          detail: metaDirectError?.data || metaDirectError?.response?.data || null,
        });
      }
    }

    if (metaLive) {
      summary.meta.connected = true;
      summary.meta.ready = true;
      summary.meta.status = 'LIVE';
      summary.meta.hasSnapshot = true;
      summary.meta.snapshotId = metaLive.snapshotId;
      summary.meta.currency = metaLive.currency || null;
      summary.meta.spend = metaLive.spend;
      summary.meta.revenue = metaLive.revenue;
      summary.meta.roas = metaLive.roas;
      summary.meta.conversions = metaLive.conversions;
      summary.meta.clicks = metaLive.clicks;
      summary.meta.campaigns = metaLive.campaigns || [];
      summary.meta.connectedResourceId = metaLive.accountId || summary.meta.connectedResourceId;
      summary.meta.connectedResourceName = metaLive.accountName || summary.meta.connectedResourceName;
      summary.meta.activeCampaignId = summary.meta.campaigns?.[0]?.id || null;
      summary.meta.activeCampaignName = summary.meta.campaigns?.[0]?.name || null;
      summary.meta.rangeUsed = metaLive.rangeUsed || null;
    }

    let googleLive = null;
    if (googleConnected) {
      try {
        googleLive = await fetchGooglePaidMediaDirect({ userId, startDate: start, endDate: end });
      } catch (googleDirectError) {
        console.warn('[PaidMedia Direct] google live fetch failed:', googleDirectError?.message || googleDirectError);
      }
    }

    if (googleLive) {
      summary.google.connected = true;
      summary.google.ready = true;
      summary.google.status = 'LIVE';
      summary.google.hasSnapshot = true;
      summary.google.snapshotId = googleLive.snapshotId;
      summary.google.currency = googleLive.currency || null;
      summary.google.spend = googleLive.spend;
      summary.google.revenue = googleLive.revenue;
      summary.google.roas = googleLive.roas;
      summary.google.conversions = googleLive.conversions;
      summary.google.clicks = googleLive.clicks;
      summary.google.campaigns = googleLive.campaigns || [];
      summary.google.connectedResourceId = googleLive.customerId || summary.google.connectedResourceId;
      summary.google.connectedResourceName = googleLive.customerName || summary.google.connectedResourceName;
      summary.google.activeCampaignId = summary.google.campaigns?.[0]?.id || null;
      summary.google.activeCampaignName = summary.google.campaigns?.[0]?.name || null;
      summary.google.rangeUsed = googleLive.rangeUsed || null;
    }

    const blendedSpend = Number(summary.meta.spend || 0) + Number(summary.google.spend || 0);
    const blendedRevenue = Number(summary.meta.revenue || 0) + Number(summary.google.revenue || 0);
    summary.blended = {
      spend: blendedSpend,
      revenue: blendedRevenue,
      roas: blendedSpend > 0 ? Number((blendedRevenue / blendedSpend).toFixed(2)) : null,
      currency: summary.meta.currency || summary.google.currency || null,
    };

    const hasLiveData = Boolean(metaLive || googleLive);
    summary.available = hasLiveData;
    summary.reason = summary.linked ? (hasLiveData ? null : 'live_data_unavailable') : 'not_linked';

    console.log('[PaidMedia Trace] direct-only summary:', {
      userId,
      accountId,
      linked: summary.linked,
      available: summary.available,
      metaConnected: summary.meta.connected,
      metaSpend: summary.meta.spend,
      googleConnected: summary.google.connected,
      googleSpend: summary.google.spend,
    });

    return summary;
  } catch (error) {
    console.error('[Analytics API] Paid media summary error:', error);
    return { ...base, reason: 'lookup_failed' };
  }
}

function normalizeEventName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function resolveEventBucket(rawName) {
  const normalized = normalizeEventName(rawName);
  for (const [bucket, aliases] of Object.entries(EVENT_BUCKET_ALIASES)) {
    if (aliases.includes(normalized)) return bucket;
  }
  return 'other';
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch (_) {
    return null;
  }
}

function normalizeAttributionToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function includesAny(value, needles = []) {
  const safe = normalizeAttributionToken(value);
  if (!safe) return false;
  return needles.some((needle) => safe.includes(normalizeAttributionToken(needle)));
}

function normalizeDisplayAttributionChannel(channelRaw, platformRaw = '') {
  const channel = normalizeAttributionToken(channelRaw);
  const platform = normalizeAttributionToken(platformRaw);
  const combined = `${channel} ${platform}`.trim();

  if (!combined || channel === 'unattributed' || channel === 'none') return 'unattributed';

  if (includesAny(combined, ['tiktok', 'ttclid'])) return 'tiktok';
  if (includesAny(combined, ['facebook', 'instagram', 'meta', 'fbclid'])) return 'meta';
  if (includesAny(combined, ['google', 'adwords', 'gclid'])) return 'google';

  if (channel === 'paid social') {
    if (includesAny(platform, ['tiktok'])) return 'tiktok';
    if (includesAny(platform, ['facebook', 'instagram', 'meta'])) return 'meta';
    return 'paid social';
  }

  if (channel === 'paid search' || channel === 'cpc' || channel === 'ppc') {
    if (includesAny(platform, ['google'])) return 'google';
    return 'paid search';
  }

  if (channel === 'organic social') return 'organic social';
  if (channel === 'organic search') return 'organic search';

  if (includesAny(combined, ['email', 'newsletter', 'klaviyo', 'mailchimp', 'sendgrid', 'brevo', 'hubspot', 'activecampaign', 'convertkit'])) {
    return 'email';
  }

  if (includesAny(combined, ['direct'])) return 'direct';

  if (includesAny(combined, ['referral', 'partner', 'affiliate', 'hostinger', 'linktr', 'whatsapp', 'sms', 'text'])) {
    return 'referral';
  }

  if (includesAny(combined, ['yahoo', 'bing', 'duckduckgo', 'baidu'])) {
    return includesAny(channel, ['paid', 'cpc', 'ppc']) ? 'paid search' : 'organic search';
  }

  if (includesAny(combined, ['organic', 'seo'])) return 'organic';
  if (includesAny(combined, ['social'])) return 'organic social';

  return channel || platform || 'other';
}

function inferAttributionFromSignals({ source = '', medium = '', referrerDomain = '' } = {}) {
  const src = normalizeAttributionToken(source);
  const med = normalizeAttributionToken(medium);
  const ref = normalizeAttributionToken(referrerDomain);
  const combined = `${src} ${med} ${ref}`.trim();

  if (!combined) return null;

  const isPaid = includesAny(med, ['paid', 'cpc', 'ppc', 'ads', 'ad', 'paid search', 'paid social']);
  const isEmail = includesAny(combined, ['email', 'newsletter', 'klaviyo', 'mailchimp', 'sendgrid', 'brevo', 'hubspot', 'activecampaign', 'convertkit']);

  if (isEmail) {
    return { channel: 'email', platform: src || 'email', confidence: 0.82 };
  }

  if (includesAny(combined, ['tiktok'])) {
    return { channel: isPaid ? 'tiktok' : 'organic social', platform: 'tiktok', confidence: isPaid ? 0.9 : 0.76 };
  }

  if (includesAny(combined, ['facebook', 'instagram', 'meta'])) {
    return { channel: isPaid ? 'meta' : 'organic social', platform: src || ref || 'meta', confidence: isPaid ? 0.9 : 0.76 };
  }

  if (includesAny(combined, ['google'])) {
    return { channel: isPaid ? 'google' : 'organic search', platform: src || ref || 'google', confidence: isPaid ? 0.88 : 0.76 };
  }

  if (includesAny(combined, ['yahoo', 'bing', 'duckduckgo', 'baidu'])) {
    return { channel: isPaid ? 'paid search' : 'organic search', platform: src || ref, confidence: isPaid ? 0.82 : 0.72 };
  }

  if (includesAny(combined, ['direct'])) {
    return { channel: 'direct', platform: 'direct', confidence: 0.55 };
  }

  if (includesAny(combined, ['referral', 'partner', 'affiliate', 'hostinger', 'linktr'])) {
    return { channel: 'referral', platform: src || ref, confidence: 0.68 };
  }

  if (includesAny(combined, ['social', 'twitter', 'x.com', 't.co', 'linkedin', 'pinterest'])) {
    return { channel: 'organic social', platform: src || ref, confidence: 0.72 };
  }

  if (src) {
    return { channel: src, platform: src, confidence: 0.6 };
  }

  return null;
}

function stitchSnapshotAttribution(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
  }

  const metaClickId = snapshot.fbclid || snapshot.fbc || snapshot._fbc || null;
  if (metaClickId) {
    return {
      channel: 'meta',
      platform: 'meta',
      clickId: metaClickId,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  const googleClickId = snapshot.gclid || snapshot.wbraid || snapshot.gbraid || null;
  if (googleClickId) {
    return {
      channel: 'google',
      platform: 'google',
      clickId: googleClickId,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  if (snapshot.msclkid) {
    return {
      channel: 'paid search',
      platform: 'microsoft ads',
      clickId: snapshot.msclkid,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  if (snapshot.ttclid) {
    return {
      channel: 'tiktok',
      platform: 'tiktok',
      clickId: snapshot.ttclid,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  if (snapshot.utm_source) {
    const inferred = inferAttributionFromSignals({
      source: snapshot.utm_source,
      medium: snapshot.utm_medium,
      referrerDomain: getDomain(snapshot.referrer || snapshot.referer || ''),
    });

    return {
      channel: inferred?.channel || normalizeDisplayAttributionChannel(snapshot.utm_medium || snapshot.utm_source, snapshot.utm_source),
      platform: inferred?.platform || snapshot.utm_source,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: Number(inferred?.confidence || 0.85),
      source: 'utm',
    };
  }

  if (snapshot.referrer) {
    const domain = getDomain(snapshot.referrer);
    if (!domain) {
      return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
    }
    if (['google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'search.yahoo.com'].some((d) => domain.includes(d))) {
      return { channel: 'organic search', platform: domain, confidence: 0.7, source: 'referrer' };
    }
    if (['facebook.com', 'instagram.com', 't.co', 'twitter.com', 'x.com', 'linkedin.com', 'pinterest.com', 'tiktok.com'].some((d) => domain.includes(d))) {
      return { channel: 'organic social', platform: domain, confidence: 0.7, source: 'referrer' };
    }
    return { channel: 'referral', platform: domain, confidence: 0.7, source: 'referrer' };
  }

  return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
}

function isSameSiteReferrer(referrerValue, accountId) {
  const referrerDomain = getDomain(referrerValue);
  const accountDomain = String(accountId || '').replace(/^www\./, '').toLowerCase();
  if (!referrerDomain || !accountDomain) return false;
  return referrerDomain === accountDomain || referrerDomain.endsWith('.' + accountDomain);
}

function stitchSnapshotAttributionForAccount(snapshot = {}, accountId) {
  const attribution = stitchSnapshotAttribution(snapshot);
  if (attribution.source === 'referrer' && isSameSiteReferrer(snapshot?.referrer, accountId)) {
    return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
  }
  return attribution;
}

function normalizeChannelForStats(channelRaw, platformRaw = '') {
  const displayChannel = normalizeDisplayAttributionChannel(channelRaw, platformRaw);
  const platform = normalizeAttributionToken(platformRaw);

  if (displayChannel === 'meta') return 'meta';
  if (displayChannel === 'google') return 'google';
  if (displayChannel === 'tiktok') return 'tiktok';
  if (displayChannel === 'organic' || displayChannel === 'organic search' || displayChannel === 'organic social') return 'organic';
  if (displayChannel === 'direct') return 'direct';
  if (displayChannel === 'referral') return 'referral';
  if (displayChannel === 'email') return 'email';
  if (displayChannel === 'paid social') {
    if (includesAny(platform, ['tiktok'])) return 'tiktok';
    if (includesAny(platform, ['facebook', 'instagram', 'meta'])) return 'meta';
    return 'other';
  }
  if (displayChannel === 'paid search') {
    if (includesAny(platform, ['google'])) return 'google';
    return 'other';
  }
  if (displayChannel === 'unattributed') return 'unattributed';
  return 'other';
}

function isStoredGoogleOrganicFallback({ channel = '', snapshot = {}, wooSourceLabel = '' } = {}) {
  if (normalizeAttributionToken(channel) !== 'google') return false;
  const medium = normalizeAttributionToken(snapshot?.utm_medium || '');
  const label = normalizeAttributionToken(wooSourceLabel || '');
  const hasPaidSignal = includesAny(medium, ['cpc', 'paid search', 'ppc', 'ads', 'adwords'])
    || includesAny(label, ['cpc', 'paid search', 'ppc', 'ads', 'adwords'])
    || Boolean(snapshot?.gclid);
  return !hasPaidSignal;
}

function resolveStoredDisplayAttribution({ channel = '', platform = '', snapshot = {}, wooSourceLabel = '' } = {}) {
  if (isStoredGoogleOrganicFallback({ channel, snapshot, wooSourceLabel })) {
    return 'organic search';
  }

  return normalizeDisplayAttributionChannel(
    channel,
    platform || snapshot?.utm_source || snapshot?.referrer || wooSourceLabel || ''
  );
}

function compactSessionPath(timeline = []) {
  const labels = [];
  const seen = new Set();

  timeline.forEach((event) => {
    const bucket = String(event?.bucket || 'other');
    if (seen.has(bucket)) return;
    seen.add(bucket);

    let label = 'Otro';
    if (bucket === 'page_view') label = 'Landing';
    if (bucket === 'view_item') label = 'Producto';
    if (bucket === 'add_to_cart') label = 'Carrito';
    if (bucket === 'begin_checkout') label = 'Checkout';
    if (bucket === 'purchase') label = 'Compra';

    labels.push({ bucket, label, occurredAt: event.createdAt || null });
  });

  return labels;
}

function computeStageDepthFromCounts(counts = {}) {
  if (Number(counts.purchase || 0) > 0) return 4;
  if (Number(counts.begin_checkout || 0) > 0) return 3;
  if (Number(counts.add_to_cart || 0) > 0) return 2;
  if (Number(counts.view_item || 0) > 0) return 1;
  if (Number(counts.page_view || 0) > 0) return 0;
  return -1;
}

function getSessionDaypartLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  const hour = date.getHours();
  if (hour < 12) return 'mañana';
  if (hour < 18) return 'tarde';
  return 'noche';
}

function buildRecommendedComparison({ currentSession, currentMetrics, peerSessions, peerEventCounts }) {
  const peers = Array.isArray(peerSessions) ? peerSessions : [];
  if (!peers.length) return null;

  const currentCounts = {
    page_view: Number(currentMetrics.pageViews || 0),
    view_item: Number(currentMetrics.viewItem || 0),
    add_to_cart: Number(currentMetrics.addToCart || 0),
    begin_checkout: Number(currentMetrics.beginCheckout || 0),
    purchase: Number(currentMetrics.purchase || 0),
  };

  const currentDepth = computeStageDepthFromCounts(currentCounts);
  const currentTotalEvents = Number(currentMetrics.totalEvents || 0);
  const currentStartedAt = currentSession?.startedAt ? new Date(currentSession.startedAt).getTime() : null;
  const currentPurchased = currentDepth >= 4;
  const currentReachedCheckout = currentDepth >= 3;

  let best = null;

  peers.forEach((peer) => {
    const counts = peerEventCounts.get(peer.sessionId) || {};
    const peerDepth = computeStageDepthFromCounts(counts);
    const peerTotalEvents = Number(counts._totalEvents || peer._totalEvents || 0);
    let score = 12 - Math.abs(currentDepth - peerDepth) * 3;

    score += Math.max(0, 4 - Math.abs(currentTotalEvents - peerTotalEvents));

    if (!currentPurchased && Number(counts.purchase || 0) > 0) score += 6;
    if (currentReachedCheckout && !currentPurchased && Number(counts.purchase || 0) > 0) score += 4;
    if (!currentReachedCheckout && Number(counts.begin_checkout || 0) > 0) score += 3;
    if ((currentSession?.utmCampaign || '') && peer.utmCampaign === currentSession.utmCampaign) score += 2;
    if ((currentSession?.landingPageUrl || '') && peer.landingPageUrl === currentSession.landingPageUrl) score += 2;

    const peerStartedAt = peer.startedAt ? new Date(peer.startedAt).getTime() : null;
    if (currentStartedAt && peerStartedAt) {
      const hoursDiff = Math.abs(currentStartedAt - peerStartedAt) / 3600000;
      score += Math.max(0, 2 - Math.min(2, hoursDiff / 24));
    }

    const reason = !currentPurchased && Number(counts.purchase || 0) > 0
      ? 'Comparar contra una sesión del mismo usuario que sí terminó comprando.'
      : Math.abs(currentDepth - peerDepth) <= 1
        ? 'Comparar contra la sesión más parecida en intensidad y profundidad de recorrido.'
        : 'Comparar contra una sesión cercana en contexto para detectar fricción o mejora.';

    if (!best || score > best.score) {
      best = {
        sessionId: peer.sessionId,
        score,
        reason,
        headline: !currentPurchased && Number(counts.purchase || 0) > 0
          ? 'Referencia de conversión'
          : 'Comparación sugerida',
      };
    }
  });

  return best
    ? {
        sessionId: best.sessionId,
        reason: best.reason,
        headline: best.headline,
      }
    : null;
}

function buildBehaviorPatternSummary({ currentSession, currentMetrics, peerSessions, peerEventCounts, currentPath }) {
  const peers = Array.isArray(peerSessions) ? peerSessions : [];
  const peerSessionCount = peers.length;
  const currentCounts = {
    page_view: Number(currentMetrics.pageViews || 0),
    view_item: Number(currentMetrics.viewItem || 0),
    add_to_cart: Number(currentMetrics.addToCart || 0),
    begin_checkout: Number(currentMetrics.beginCheckout || 0),
    purchase: Number(currentMetrics.purchase || 0),
  };

  const aggregate = {
    page_view: 0,
    view_item: 0,
    add_to_cart: 0,
    begin_checkout: 0,
    purchase: 0,
    avgEvents: 0,
    avgDurationSeconds: 0,
  };

  const landingMap = new Map();
  const campaignMap = new Map();
  const daypartMap = new Map();

  const sessionSnapshots = [
    {
      sessionId: currentSession?.sessionId || 'current',
      startedAt: currentSession?.startedAt || null,
      lastEventAt: currentSession?.lastEventAt || null,
      landingPageUrl: currentSession?.landingPageUrl || null,
      utmCampaign: currentSession?.utmCampaign || null,
      counts: currentCounts,
      totalEvents: Number(currentMetrics.totalEvents || 0),
      isCurrent: true,
    },
  ];

  peers.forEach((session) => {
    const counts = peerEventCounts.get(session.sessionId) || {};
    const durationSeconds = session.startedAt && session.lastEventAt
      ? Math.max(0, Math.round((new Date(session.lastEventAt).getTime() - new Date(session.startedAt).getTime()) / 1000))
      : 0;

    aggregate.avgEvents += Number(session._totalEvents || 0);
    aggregate.avgDurationSeconds += durationSeconds;

    ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase'].forEach((bucket) => {
      if (Number(counts[bucket] || 0) > 0) aggregate[bucket] += 1;
    });

    if (session.landingPageUrl) {
      landingMap.set(session.landingPageUrl, Number(landingMap.get(session.landingPageUrl) || 0) + 1);
    }
    if (session.utmCampaign) {
      campaignMap.set(session.utmCampaign, Number(campaignMap.get(session.utmCampaign) || 0) + 1);
    }

    const daypart = getSessionDaypartLabel(session.startedAt);
    if (daypart) daypartMap.set(daypart, Number(daypartMap.get(daypart) || 0) + 1);

    sessionSnapshots.push({
      sessionId: session.sessionId,
      startedAt: session.startedAt || null,
      lastEventAt: session.lastEventAt || null,
      landingPageUrl: session.landingPageUrl || null,
      utmCampaign: session.utmCampaign || null,
      counts,
      totalEvents: Number(session._totalEvents || 0),
      isCurrent: false,
    });
  });

  const currentDaypart = getSessionDaypartLabel(currentSession?.startedAt || null);
  if (currentDaypart) daypartMap.set(currentDaypart, Number(daypartMap.get(currentDaypart) || 0) + 1);

  if (peerSessionCount > 0) {
    aggregate.avgEvents = Number((aggregate.avgEvents / peerSessionCount).toFixed(1));
    aggregate.avgDurationSeconds = Math.round(aggregate.avgDurationSeconds / peerSessionCount);
  }

  const stageComparison = [
    { key: 'page_view', label: 'Landing', current: Number(currentMetrics.pageViews || 0) > 0, peerRate: peerSessionCount ? Number((aggregate.page_view / peerSessionCount).toFixed(2)) : 0 },
    { key: 'view_item', label: 'Producto', current: Number(currentMetrics.viewItem || 0) > 0, peerRate: peerSessionCount ? Number((aggregate.view_item / peerSessionCount).toFixed(2)) : 0 },
    { key: 'add_to_cart', label: 'Carrito', current: Number(currentMetrics.addToCart || 0) > 0, peerRate: peerSessionCount ? Number((aggregate.add_to_cart / peerSessionCount).toFixed(2)) : 0 },
    { key: 'begin_checkout', label: 'Checkout', current: Number(currentMetrics.beginCheckout || 0) > 0, peerRate: peerSessionCount ? Number((aggregate.begin_checkout / peerSessionCount).toFixed(2)) : 0 },
    { key: 'purchase', label: 'Compra', current: Number(currentMetrics.purchase || 0) > 0, peerRate: peerSessionCount ? Number((aggregate.purchase / peerSessionCount).toFixed(2)) : 0 },
  ];

  const topLandingPages = Array.from(landingMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([url, sessions]) => ({ url, sessions }));

  const topCampaigns = Array.from(campaignMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([campaign, sessions]) => ({ campaign, sessions }));

  const trackedSessions = sessionSnapshots.filter((item) => item.startedAt);
  const totalTrackedSessions = trackedSessions.length;
  const checkoutSessions = trackedSessions.filter((item) => Number(item.counts.begin_checkout || 0) > 0).length;
  const purchaseSessions = trackedSessions.filter((item) => Number(item.counts.purchase || 0) > 0).length;
  const productSessions = trackedSessions.filter((item) => Number(item.counts.view_item || 0) > 0).length;

  const sortedByStartedAt = trackedSessions
    .slice()
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  let averageGapHours = 0;
  if (sortedByStartedAt.length > 1) {
    let totalGapHours = 0;
    for (let index = 1; index < sortedByStartedAt.length; index += 1) {
      const previous = new Date(sortedByStartedAt[index - 1].startedAt).getTime();
      const current = new Date(sortedByStartedAt[index].startedAt).getTime();
      totalGapHours += Math.max(0, (current - previous) / 3600000);
    }
    averageGapHours = Number((totalGapHours / (sortedByStartedAt.length - 1)).toFixed(1));
  }

  const topDaypartEntry = Array.from(daypartMap.entries()).sort((a, b) => b[1] - a[1])[0] || null;
  const topDaypart = topDaypartEntry
    ? {
        label: topDaypartEntry[0],
        sessions: Number(topDaypartEntry[1] || 0),
        rate: totalTrackedSessions ? Number((Number(topDaypartEntry[1] || 0) / totalTrackedSessions).toFixed(2)) : 0,
      }
    : null;

  const longitudinalCards = [];

  if (totalTrackedSessions > 1) {
    longitudinalCards.push({
      title: 'Recurrencia real',
      detail: `Hay ${totalTrackedSessions} sesiones trazadas para este usuario. ${Math.round((productSessions / totalTrackedSessions) * 100)}% llega a producto y ${Math.round((checkoutSessions / totalTrackedSessions) * 100)}% alcanza checkout.`,
      action: 'Usar este volumen para distinguir si la sesión actual es anomalía o parte de un patrón repetido.',
    });
  }

  if (topDaypart) {
    longitudinalCards.push({
      title: 'Ventana dominante',
      detail: `${Math.round(topDaypart.rate * 100)}% de las sesiones ocurre en la ${topDaypart.label}.`,
      action: averageGapHours > 0
        ? `La separación media entre sesiones es de ${averageGapHours} horas; sirve para decidir retargeting inmediato vs recordatorio diferido.`
        : 'Aún no hay suficiente separación temporal para estimar ritmo de retorno.',
    });
  }

  longitudinalCards.push({
    title: 'Desenlace histórico',
    detail: `${Math.round((purchaseSessions / Math.max(totalTrackedSessions, 1)) * 100)}% de las sesiones termina en compra.`,
    action: purchaseSessions > 0
      ? 'Comparar la sesión actual con una sesión compradora ayuda a ubicar la fricción que faltó resolver.'
      : 'Todavía no hay compra previa; conviene enfocarse en el salto de producto a carrito y de carrito a checkout.',
  });

  const recommendedComparison = buildRecommendedComparison({
    currentSession,
    currentMetrics,
    peerSessions: peers,
    peerEventCounts,
  });

  const patternCards = [];
  const currentReachedCheckout = Number(currentMetrics.beginCheckout || 0) > 0;
  const currentPurchased = Number(currentMetrics.purchase || 0) > 0;
  const peerCheckoutRate = stageComparison.find((item) => item.key === 'begin_checkout')?.peerRate || 0;
  const peerPurchaseRate = stageComparison.find((item) => item.key === 'purchase')?.peerRate || 0;

  if (currentReachedCheckout && !currentPurchased) {
    patternCards.push({
      title: 'Sesión con alta intención',
      detail: `Esta sesión llegó a checkout. En otras sesiones comparables, ${Math.round(peerPurchaseRate * 100)}% termina comprando.`,
      action: 'Reforzar remarketing o recuperación de checkout durante la siguiente ventana corta.',
    });
  }

  if (Number(currentMetrics.viewItem || 0) > 0 && Number(currentMetrics.addToCart || 0) === 0) {
    patternCards.push({
      title: 'Explora productos pero no añade al carrito',
      detail: `Vio ${currentMetrics.viewItem || 0} productos y no añadió ninguno.`,
      action: 'Revisar claridad de oferta, precio, shipping o CTAs en PDP.',
    });
  }

  if (!currentReachedCheckout && peerCheckoutRate >= 0.35) {
    patternCards.push({
      title: 'Sesión por debajo del patrón habitual',
      detail: `Otros recorridos del mismo usuario llegan a checkout en ${Math.round(peerCheckoutRate * 100)}% de los casos.`,
      action: 'Analizar qué faltó en esta visita: fuente, landing o fricción previa al carrito.',
    });
  }

  if (!patternCards.length) {
    patternCards.push({
      title: 'Patrón todavía estable',
      detail: 'No hay una desviación fuerte entre esta sesión y las demás disponibles del mismo usuario.',
      action: 'Seguir acumulando sesiones para afinar el patrón conductual y los disparadores.',
    });
  }

  return {
    peerSessionCount,
    totalTrackedSessions,
    avgEvents: aggregate.avgEvents,
    avgDurationSeconds: aggregate.avgDurationSeconds,
    averageGapHours,
    currentPath,
    stageComparison,
    topLandingPages,
    topCampaigns,
    topDaypart,
    longitudinalCards: longitudinalCards.slice(0, 3),
    recommendedComparison,
    patternCards: patternCards.slice(0, 3),
  };
}

function normalizeLineItems(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr.map((item) => {
    const quantity = toFiniteNumber(item?.quantity ?? item?.qty, 1);
    const price = toFiniteNumberOrNull(item?.price ?? item?.unit_price ?? item?.unitPrice);
    let subtotal = toFiniteNumberOrNull(item?.subtotal ?? item?.line_subtotal ?? item?.lineSubtotal);
    let lineTotal = toFiniteNumberOrNull(
      item?.line_total ?? item?.lineTotal ?? item?.total ?? item?.final_line_price ?? item?.finalLinePrice
    );

    if (subtotal === null && price !== null) {
      subtotal = Number((quantity * price).toFixed(2));
    }

    if (lineTotal === null && subtotal !== null) {
      lineTotal = subtotal;
    } else if (lineTotal === null && price !== null) {
      lineTotal = Number((quantity * price).toFixed(2));
    }

    return {
      id: String(item?.product_id || item?.productId || item?.id || item?.variant_id || item?.variantId || ''),
      productId: String(item?.product_id || item?.productId || item?.id || ''),
      variantId: String(item?.variant_id || item?.variantId || ''),
      sku: String(item?.sku || item?.product_sku || item?.productSku || ''),
      name: String(item?.name || item?.title || 'Producto'),
      quantity,
      price: price ?? 0,
      subtotal,
      lineTotal,
      currency: String(item?.currency || item?.currency_code || item?.currencyCode || ''),
      rawItem: item && typeof item === 'object' ? item : null,
    };
  });
}

function buildProductAffinityFromOrders(orders = []) {
  const productMap = new Map();

  orders.forEach((order) => {
    const lineItems = normalizeLineItems(order?.lineItems);
    lineItems.forEach((item) => {
      const key = String(item.id || item.name || '').trim();
      if (!key) return;

      const current = productMap.get(key) || {
        id: item.id || key,
        name: item.name || 'Producto',
        units: 0,
        orderCount: 0,
        revenue: 0,
        lastPurchasedAt: null,
      };

      current.units += Number(item.quantity || 0);
      current.orderCount += 1;
      current.revenue += Number(item.lineTotal || item.price || 0);
      const purchasedAt = order?.platformCreatedAt || order?.createdAt || null;
      if (purchasedAt && (!current.lastPurchasedAt || new Date(purchasedAt).getTime() > new Date(current.lastPurchasedAt).getTime())) {
        current.lastPurchasedAt = purchasedAt;
      }

      productMap.set(key, current);
    });
  });

  return Array.from(productMap.values())
    .sort((a, b) => {
      if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
      if (b.units !== a.units) return b.units - a.units;
      return b.revenue - a.revenue;
    })
    .slice(0, 5);
}

function buildTopProductPairings(orders = []) {
  const pairMap = new Map();

  orders.forEach((order) => {
    const uniqueItems = normalizeLineItems(order?.lineItems)
      .map((item) => ({
        id: String(item.id || item.name || '').trim(),
        name: String(item.name || 'Producto').trim(),
      }))
      .filter((item) => item.id)
      .filter((item, index, arr) => arr.findIndex((other) => other.id === item.id) === index);

    for (let i = 0; i < uniqueItems.length; i += 1) {
      for (let j = i + 1; j < uniqueItems.length; j += 1) {
        const first = uniqueItems[i];
        const second = uniqueItems[j];
        const key = [first.id, second.id].sort().join('::');
        const current = pairMap.get(key) || {
          primary: first.name,
          secondary: second.name,
          orders: 0,
        };
        current.orders += 1;
        pairMap.set(key, current);
      }
    }
  });

  return Array.from(pairMap.values())
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 3);
}

function buildActionRecommendations({ topProducts = [], topPairings = [], totalOrders = 0, sessionSignals = {}, profileLabel = 'este perfil' }) {
  const recommendations = [];
  const leadProduct = topProducts[0] || null;
  const secondProduct = topProducts[1] || null;
  const topPairing = topPairings[0] || null;

  if (leadProduct && Number(leadProduct.orderCount || 0) >= 2) {
    recommendations.push({
      title: 'Recompra sugerida',
      detail: `${profileLabel} suele comprar ${leadProduct.name} con frecuencia (${leadProduct.orderCount} órdenes).`,
      action: `Muéstrale primero ${leadProduct.name} y prueba una promo de recompra o recordatorio de stock.`
    });
  }

  if (topPairing && Number(topPairing.orders || 0) >= 2) {
    recommendations.push({
      title: 'Bundle con alta afinidad',
      detail: `${topPairing.primary} y ${topPairing.secondary} aparecen juntos en ${topPairing.orders} órdenes.`,
      action: `Crea bundle o cross-sell directo entre ${topPairing.primary} + ${topPairing.secondary}.`
    });
  }

  if (leadProduct && secondProduct && Number(totalOrders || 0) >= 2) {
    recommendations.push({
      title: 'Upsell inmediato',
      detail: `El perfil ya mostró historial suficiente para empujar ${secondProduct.name} junto a ${leadProduct.name}.`,
      action: `Si vuelve a interesarse por ${leadProduct.name}, ofrece ${secondProduct.name} como complemento con descuento leve.`
    });
  }

  if (Number(sessionSignals.beginCheckout || 0) > 0 && Number(sessionSignals.purchase || 0) === 0 && leadProduct) {
    recommendations.push({
      title: 'Recuperación de intención',
      detail: `La sesión actual mostró intención alta pero no cerró compra.`,
      action: `Lanza remarketing corto con ${leadProduct.name} o incentivo puntual antes de que se enfríe la sesión.`
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      title: 'Seguir acumulando señal',
      detail: 'Todavía no hay patrón comercial lo bastante fuerte para personalizar una oferta específica.',
      action: 'Prioriza capturar más sesiones, productos vistos y próximas órdenes para afinar la recomendación.'
    });
  }

  return recommendations.slice(0, 4);
}

function toSnapshotFromSession(session) {
  if (!session) return null;
  return {
    utm_source: session.utmSource || null,
    utm_medium: session.utmMedium || null,
    utm_campaign: session.utmCampaign || null,
    utm_content: session.utmContent || null,
    utm_term: session.utmTerm || null,
    referrer: session.referrer || null,
    fbclid: session.fbclid || null,
    gclid: session.gclid || null,
    ttclid: session.ttclid || null,
  };
}

function buildAttributionTouchpoints({ snapshots = [], sessions = [] }) {
  const touchpoints = [];

  snapshots.forEach((snap) => {
    const attribution = stitchSnapshotAttribution(snap.snapshot || {});
    touchpoints.push({
      timestamp: new Date(snap.timestamp),
      attribution,
      source: snap.source || 'checkout_snapshot',
    });
  });

  sessions.forEach((session) => {
    const attribution = stitchSnapshotAttribution(toSnapshotFromSession(session) || {});
    touchpoints.push({
      timestamp: new Date(session.startedAt),
      attribution,
      source: 'session',
      isFirstTouch: Boolean(session.isFirstTouch),
    });
  });

  return touchpoints
    .filter((tp) => tp.timestamp && !Number.isNaN(tp.timestamp.getTime()))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildAttributionTouchpointsForAccount({ snapshots = [], sessions = [], accountId }) {
  const touchpoints = [];

  snapshots.forEach((snap) => {
    const attribution = stitchSnapshotAttributionForAccount(snap.snapshot || {}, accountId);
    touchpoints.push({
      timestamp: new Date(snap.timestamp),
      attribution,
      source: snap.source || 'checkout_snapshot',
    });
  });

  sessions.forEach((session) => {
    const attribution = stitchSnapshotAttributionForAccount(toSnapshotFromSession(session) || {}, accountId);
    touchpoints.push({
      timestamp: new Date(session.startedAt),
      attribution,
      source: 'session',
      isFirstTouch: Boolean(session.isFirstTouch),
    });
  });

  return touchpoints
    .filter((tp) => tp.timestamp && !Number.isNaN(tp.timestamp.getTime()))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function resolveConversionAttribution({ model, touchpoints }) {
  const valid = touchpoints.filter((tp) => {
    const ch = normalizeChannelForStats(tp?.attribution?.channel, tp?.attribution?.platform);
    return ch !== 'unattributed';
  });

  if (valid.length === 0) {
    return {
      primary: { channel: 'unattributed', platform: null, campaign: null, adset: null, ad: null, clickId: null, confidence: 0, source: 'none' },
      splits: [{ channel: 'unattributed', weight: 1 }],
      isAttributed: false,
    };
  }

  if (model === 'first_touch') {
    const first = valid[0].attribution;
    const channel = normalizeDisplayAttributionChannel(first.channel, first.platform);
    return {
      primary: {
        channel,
        platform: first.platform || null,
        campaign: first.campaign || null,
        adset: first.adset || null,
        ad: first.ad || null,
        clickId: first.clickId || null,
        confidence: Number(first.confidence || 0),
        source: first.source || 'first_touch',
      },
      splits: [{ channel, weight: 1 }],
      isAttributed: true,
    };
  }

  if (model === 'linear') {
    const perTouch = 1 / valid.length;
    const splitMap = new Map();
    valid.forEach((tp) => {
      const ch = normalizeDisplayAttributionChannel(tp.attribution.channel, tp.attribution.platform);
      splitMap.set(ch, Number(splitMap.get(ch) || 0) + perTouch);
    });

    const last = valid[valid.length - 1].attribution;
    const splits = Array.from(splitMap.entries()).map(([channel, weight]) => ({
      channel,
      weight,
    }));

    return {
      primary: {
        channel: 'multi_touch',
        platform: last.platform || null,
        campaign: last.campaign || null,
        adset: last.adset || null,
        ad: last.ad || null,
        clickId: last.clickId || null,
        confidence: Number(last.confidence || 0),
        source: 'linear',
      },
      splits,
      isAttributed: true,
    };
  }

  if (model === 'meta' || model === 'google_ads') {
    const targetChannel = model === 'meta' ? 'meta' : 'google';
    const specificTouch = valid.slice().reverse().find(t => normalizeChannelForStats(t.attribution.channel, t.attribution.platform) === targetChannel);
    if (specificTouch) {
      const attr = specificTouch.attribution;
      return {
        primary: {
          channel: targetChannel,
          platform: attr.platform || null,
          campaign: attr.campaign || null,
          adset: attr.adset || null,
          ad: attr.ad || null,
          clickId: attr.clickId || null,
          confidence: Number(attr.confidence || 0),
          source: model,
        },
        splits: [{ channel: targetChannel, weight: 1 }],
        isAttributed: true,
      };
    } else {
      return {
        primary: { channel: 'unattributed', platform: null, campaign: null, adset: null, ad: null, clickId: null, confidence: 0, source: 'none' },
        splits: [{ channel: 'unattributed', weight: 1 }],
        isAttributed: false,
      };
    }
  }

  const last = valid[valid.length - 1].attribution;
  const channel = normalizeDisplayAttributionChannel(last.channel, last.platform);
  return {
    primary: {
      channel,
      platform: last.platform || null,
      campaign: last.campaign || null,
      adset: last.adset || null,
      ad: last.ad || null,
      clickId: last.clickId || null,
      confidence: Number(last.confidence || 0),
      source: last.source || 'last_touch',
    },
    splits: [{ channel, weight: 1 }],
    isAttributed: true,
  };
}

function conversionPriorityScore(conv) {
  let score = 0;
  if (conv.isAttributed) score += 100;
  score += Number(conv.attributionConfidence || 0) * 10;
  if (Number(conv.revenue || 0) > 0) score += 8;
  if (Array.isArray(conv.items) && conv.items.length > 0) score += 4;
  if (conv.wooSourceLabel) score += 6;
  if (conv.userKey) score += 2;
  if (conv.checkoutToken) score += 2;
  if (conv.orderId) score += 2;
  return score;
}

function dedupeEventConversions(conversions) {
  const byKey = new Map();

  conversions.forEach((conv) => {
    const key = conv.orderId
      ? `order:${conv.orderId}`
      : conv.checkoutToken
        ? `checkout:${conv.checkoutToken}`
        : `fallback:${new Date(conv.createdAt).toISOString()}:${conv.revenue}:${conv.userKey || ''}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, conv);
      return;
    }

    const currentScore = conversionPriorityScore(conv);
    const existingScore = conversionPriorityScore(existing);
    if (currentScore > existingScore) {
      byKey.set(key, conv);
      return;
    }

    if (currentScore === existingScore && new Date(conv.createdAt) > new Date(existing.createdAt)) {
      byKey.set(key, conv);
    }
  });

  return Array.from(byKey.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function deriveWooFallbackAttribution(rawPayload = {}) {
  const sourceLabel = String(rawPayload?.woo_source_label || '').trim();
  const sourceType = String(rawPayload?.woo_source_type || '').trim().toLowerCase();
  const utmSource = String(rawPayload?.utm_source || '').trim().toLowerCase();
  const utmMedium = String(rawPayload?.utm_medium || '').trim().toLowerCase();

  const inferred = inferAttributionFromSignals({
    source: utmSource || sourceLabel || sourceType,
    medium: utmMedium || sourceType,
    referrerDomain: sourceLabel,
  });

  if (inferred) {
    return {
      channel: normalizeDisplayAttributionChannel(inferred.channel, inferred.platform || sourceLabel || utmSource || sourceType),
      platform: inferred.platform || sourceLabel || utmSource || sourceType || null,
      confidence: Math.max(0.5, Number(inferred.confidence || 0.55)),
      source: 'woo_fallback',
    };
  }

  const normalizedFallback = normalizeDisplayAttributionChannel(
    sourceType || sourceLabel || utmSource,
    sourceLabel || utmSource || sourceType
  );

  if (normalizedFallback && normalizedFallback !== 'other' && normalizedFallback !== 'unattributed') {
    return {
      channel: normalizedFallback,
      platform: sourceLabel || utmSource || sourceType || null,
      confidence: 0.5,
      source: 'woo_fallback',
    };
  }

  return sourceType === 'direct'
    ? {
        channel: 'direct',
        platform: 'direct',
        confidence: 0.5,
        source: 'woo_fallback',
      }
    : null;
}

// Use existing sessionGuard from index.js mount, assuming it's available or implemented here?
// The pipeline says "All routes require sessionGuard".
// For now, I'll rely on index.js to wrap this router with sessionGuard.

/**
 * GET /api/analytics/:account_id
 * Returns core dashboard metrics: Revenue, Orders, Attribution Breakdown
 */
const getAnalyticsDashboardHandler = async (req, res) => {
  try {
    const { account_id } = req.params;
    const { start, end } = req.query;
    const requestedModelRaw = String(req.query.attribution_model || req.query.attributionModel || 'last_touch').toLowerCase();
    const attributionModel = ATTRIBUTION_MODELS.has(requestedModelRaw) ? requestedModelRaw : 'last_touch';
    const allTime = String(req.query.all_time || '0') === '1';
    const recentLimitRaw = String(req.query.recent_limit || '100').toLowerCase();
    const recentLimit = recentLimitRaw === 'all'
      ? 400
      : Math.max(15, Math.min(400, Number.parseInt(recentLimitRaw, 10) || 100));

    const analyticsCacheKey = buildRouteCacheKey('analytics', req);
    const cachedAnalytics = readRouteCache(analyticsCacheKey);
      if (cachedAnalytics && String(req.query.nocache) !== '1') {
        console.log(`[Analytics API] Returning cached dashboard for ${account_id}`);
        return res.json({
          ...cachedAnalytics,
          cache: { hit: true, ttlMs: 120000 },
        });
      }

    // Default to last 30 days
    const startDate = allTime ? new Date(0) : (start ? startOfDay(new Date(start)) : startOfDay(subDays(new Date(), 30)));
    const endDate = end ? endOfDay(new Date(end)) : endOfDay(new Date());
    const periodDays = allTime
      ? 365
      : Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
    const journeyStitchLookbackDays = Math.max(
      JOURNEY_STITCH_LOOKBACK_DAYS,
      Math.min(365, periodDays)
    );
    const journeyStitchLookbackMs = journeyStitchLookbackDays * 24 * 60 * 60 * 1000;
    const broadOrdersDateWhere = {
      OR: [
        { createdAt: { gte: startDate, lte: endDate } },
        { platformCreatedAt: { gte: startDate, lte: endDate } },
      ],
    };

    // 1. Fetch Orders in range
    const orders = await prisma.order.findMany({
      where: {
        accountId: account_id,
        ...broadOrdersDateWhere,
      },
      take: 4000,
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        platformCreatedAt: true,
        revenue: true,
        subtotal: true,
        discountTotal: true,
        shippingTotal: true,
        taxTotal: true,
        refundAmount: true,
        chargebackFlag: true,
        ordersCount: true,
        currency: true,
        attributedChannel: true,
        attributionSnapshot: true,
        confidenceScore: true,
        attributionModel: true,
        checkoutToken: true,
        userKey: true,
        orderId: true,
        orderNumber: true,
        lineItems: true,
        sessionId: true,
        customerId: true,
        emailHash: true,
        phoneHash: true,
        eventId: true,
        capiSentMeta: true,
        capiSentGoogle: true,
        capiSentTiktok: true,
        capiMetaResponse: true,
        capiGoogleResponse: true,
      },
      orderBy: [
        { platformCreatedAt: 'desc' },
        { createdAt: 'desc' },
      ]
    });

    const filteredOrders = orders
      .filter((order) => {
        const effectiveOrderDate = new Date(order.platformCreatedAt || order.createdAt);
        return effectiveOrderDate >= startDate && effectiveOrderDate <= endDate;
      })
      .sort((a, b) => {
        const aTime = new Date(a.platformCreatedAt || a.createdAt).getTime();
        const bTime = new Date(b.platformCreatedAt || b.createdAt).getTime();
        return bTime - aTime;
      });

    // 2. Fetch Sessions in range (for conversion rate, approximate)
    const [sessionCount, merchantSnapshot, platformConnections, accountRecord] = await Promise.all([
      prisma.session.count({
        where: {
          accountId: account_id,
          startedAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.merchantSnapshot.findUnique({
        where: { accountId: account_id },
        select: { updatedAt: true },
      }),
      prisma.platformConnection.findMany({
        where: { accountId: account_id },
        select: { platform: true, status: true, updatedAt: true, adAccountId: true },
      }),
      prisma.account.findUnique({
        where: { accountId: account_id },
        select: { domain: true },
      }),
    ]);

    const integrationHealth = {
      meta: { connected: false, status: 'DISCONNECTED', updatedAt: null },
      google: { connected: false, status: 'DISCONNECTED', updatedAt: null },
      tiktok: { connected: false, status: 'DISCONNECTED', updatedAt: null },
    };

    platformConnections.forEach((conn) => {
      const platformKey = String(conn.platform || '').toLowerCase();
      if (!integrationHealth[platformKey]) return;
      integrationHealth[platformKey] = {
        connected: conn.status === 'ACTIVE',
        status: conn.status,
        updatedAt: conn.updatedAt || null,
      };
    });

    let paidMedia = {
      linked: false,
      available: false,
      reason: 'lookup_skipped',
      meta: { hasSnapshot: false, spend: null, revenue: null, clicks: null },
      google: { hasSnapshot: false, spend: null, revenue: null, clicks: null },
      blended: { spend: 0, revenue: 0, roas: null, currency: null },
    };

    const requestUserId = req.user?._id || req.user?.id || null;
    const warnings = [];

    try {
      paidMedia = await buildPaidMediaSummary({
        accountId: account_id,
        domain: accountRecord?.domain || account_id,
        platformConnections,
        fallbackUserId: requestUserId,
        startDate,
        endDate,
      });
    } catch (paidMediaError) {
      warnings.push({
        label: 'paid_media.summary',
        error: String(paidMediaError?.message || paidMediaError),
      });
    }

    const attributionLabelResolver = createAttributionLabelResolver({
      userId: requestUserId,
      paidMedia,
    });

    // 3. Fetch Events in range (for pixel activity visibility)
    const groupedEvents = await prisma.event.groupBy({
      by: ['eventName'],
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
      },
      _count: {
        _all: true,
      },
    });

    // Revenue fallback for sources that only send browser/server purchase events
    // but do not yet sync orders into the orders table (e.g., early WooCommerce setup).
    const purchaseRevenueAgg = await prisma.event.aggregate({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
        eventName: { in: PURCHASE_ALIASES },
      },
      _sum: {
        revenue: true,
      },
    });

    // 4. Aggregate Data
    let totalRevenue = 0;
    let attributedRevenue = 0;
    const channelStats = {
      meta: { revenue: 0, orders: 0 },
      google: { revenue: 0, orders: 0 },
      tiktok: { revenue: 0, orders: 0 },
      organic: { revenue: 0, orders: 0 },
      direct: { revenue: 0, orders: 0 },
      referral: { revenue: 0, orders: 0 },
      email: { revenue: 0, orders: 0 },
      other: { revenue: 0, orders: 0 },
      unattributed: { revenue: 0, orders: 0 }
    };

    const eventStats = {
      page_view: 0,
      view_item: 0,
      add_to_cart: 0,
      begin_checkout: 0,
      purchase: 0,
      other: 0,
      total: 0,
    };
    const productMap = new Map();

    // Daily breakdown map
    const dailyMap = {};
    const interval = eachDayOfInterval({ start: startDate, end: endDate });
    interval.forEach(day => {
       dailyMap[format(day, 'yyyy-MM-dd')] = { date: format(day, 'yyyy-MM-dd'), revenue: 0, orders: 0 };
    });

    filteredOrders.forEach(order => {
      const effectiveOrderDate = order.platformCreatedAt || order.createdAt;
      const rev = order.revenue || 0;
      totalRevenue += rev;

      // Channel normalization
      const orderDisplayChannel = resolveStoredDisplayAttribution({
        channel: order.attributedChannel,
        snapshot: order.attributionSnapshot || {},
        wooSourceLabel: order?.attributionSnapshot?.woo_source_label || '',
      });
      const ch = normalizeChannelForStats(
        orderDisplayChannel,
        order?.attributionSnapshot?.utm_source || order?.attributionSnapshot?.referrer || order?.attributionSnapshot?.woo_source_label || ''
      );

      if (channelStats[ch]) {
        channelStats[ch].revenue += rev;
        channelStats[ch].orders += 1;
      } else {
        channelStats.other.revenue += rev;
        channelStats.other.orders += 1;
      }

      if (ch !== 'unattributed') {
        attributedRevenue += rev;
      }

      // Daily
      const day = format(new Date(effectiveOrderDate), 'yyyy-MM-dd');
      if (dailyMap[day]) {
        dailyMap[day].revenue += rev;
        dailyMap[day].orders += 1;
      }

      // Top products by revenue
      const items = Array.isArray(order.lineItems) ? order.lineItems : [];
      items.forEach((item) => {
        const id = String(item?.product_id || item?.productId || item?.id || item?.variant_id || item?.variantId || 'unknown');
        const name = String(item?.name || item?.title || 'Unknown Product');
        const qty = Number(item?.quantity || item?.qty || 1);
        const unitPrice = Number(item?.price || item?.unit_price || item?.unitPrice || 0);
        const lineRevenueRaw =
          item?.line_total ?? item?.lineTotal ?? item?.total ?? item?.final_line_price ?? item?.finalLinePrice;
        const lineRevenue = Number.isFinite(Number(lineRevenueRaw))
          ? Number(lineRevenueRaw)
          : (Number.isFinite(unitPrice) ? unitPrice * (Number.isFinite(qty) ? qty : 1) : 0);

        const key = `${id}::${name}`;
        const current = productMap.get(key) || { id, name, units: 0, revenue: 0, orderCount: 0 };
        current.units += Number.isFinite(qty) ? qty : 1;
        current.revenue += Number.isFinite(lineRevenue) ? lineRevenue : 0;
        current.orderCount += 1;
        productMap.set(key, current);
      });
    });

    groupedEvents.forEach((row) => {
      const count = row?._count?._all || 0;
      const bucket = resolveEventBucket(row.eventName);
      if (typeof eventStats[bucket] === 'number') eventStats[bucket] += count;
      eventStats.total += count;
    });

    const purchaseEventOrderIds = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
        eventName: { in: PURCHASE_ALIASES },
        orderId: { not: null },
      },
      select: { orderId: true },
      distinct: ['orderId'],
    });

    const purchaseOrderIds = purchaseEventOrderIds.map((x) => x.orderId).filter(Boolean);
    const matchedOrders = purchaseOrderIds.length
      ? await prisma.order.count({
          where: {
            accountId: account_id,
            ...broadOrdersDateWhere,
            orderId: { in: purchaseOrderIds },
          },
        })
      : 0;

    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const purchaseEventsDetailed = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
        eventName: { in: PURCHASE_ALIASES },
      },
      select: {
        createdAt: true,
        orderId: true,
        checkoutToken: true,
        userKey: true,
        revenue: true,
        currency: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
      take: recentLimit,
    });

    const purchaseEventsForModel = await prisma.event.findMany({ where: { accountId: account_id, createdAt: { gte: startDate, lte: endDate }, eventName: { in: PURCHASE_ALIASES }, }, take: 4000, orderBy: { createdAt: 'desc' }, select: {
        createdAt: true,
        orderId: true,
        checkoutToken: true,
        sessionId: true,
        userKey: true,
        revenue: true,
        currency: true,
        rawPayload: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 400, // Reduced from 2000 to prevent OOM
    });

    const conversionInputsFromOrders = filteredOrders.map((order) => ({
      source: 'orders',
      createdAt: order.platformCreatedAt || order.createdAt,
      storedAt: order.createdAt,
      orderId: order.orderId,
      orderNumber: order.orderNumber || null,
      checkoutToken: order.checkoutToken || null,
      sessionId: order.sessionId || null,
      userKey: order.userKey || null,
      customerId: order.customerId || extractOrderCustomerId(order.attributionSnapshot) || null,
      emailHash: order.emailHash || null,
      phoneHash: order.phoneHash || null,
      browserFingerprintHash: hashBrowserId(order?.attributionSnapshot?.browser_id || null),
      revenue: Number(order.revenue || 0),
      subtotal: toFiniteNumberOrNull(order.subtotal),
      discountTotal: toFiniteNumberOrNull(order.discountTotal),
      shippingTotal: toFiniteNumberOrNull(order.shippingTotal),
      taxTotal: toFiniteNumberOrNull(order.taxTotal),
      refundAmount: toFiniteNumberOrNull(order.refundAmount),
      chargebackFlag: typeof order.chargebackFlag === 'boolean' ? order.chargebackFlag : null,
      ordersCount: Number.isFinite(Number(order.ordersCount)) ? Number(order.ordersCount) : null,
      currency: order.currency || 'MXN',
      items: normalizeLineItems(order.lineItems),
      orderAttributedChannel: order.attributedChannel || null,
      orderAttributionSnapshot: order.attributionSnapshot || null,
      orderAttributionConfidence: Number(order.confidenceScore || 0),
      orderAttributionModel: order.attributionModel || null,
      eventId: order.eventId || null,
      wooSourceLabel: order?.attributionSnapshot?.woo_source_label || null,
      wooSourceType: order?.attributionSnapshot?.woo_source_type || null,
      customerName: extractOrderCustomerDisplayName(order.attributionSnapshot) || extractOrderCustomerDisplayName(order.rawPayload),
      payloadSnapshot: order.attributionSnapshot || null,
      deliveryStatus: extractOrderDeliveryStatus(order),
    }));

    const conversionInputsFromEvents = purchaseEventsForModel.map((ev) => {
      const eventIdentity = extractEventIdentity(ev?.rawPayload || {});
      return {
        source: 'events',
        createdAt: ev.createdAt,
        storedAt: ev.createdAt,
        orderId: ev.orderId || null,
        orderNumber: null,
        checkoutToken: ev.checkoutToken || null,
        sessionId: ev.sessionId || null,
        userKey: ev.userKey || null,
        customerId: eventIdentity.customerId || null,
        emailHash: eventIdentity.emailHash || null,
        phoneHash: eventIdentity.phoneHash || null,
        browserFingerprintHash: eventIdentity.browserFingerprintHash || null,
        revenue: Number(ev.revenue || 0),
        subtotal: null,
        discountTotal: null,
        shippingTotal: null,
        taxTotal: null,
        refundAmount: null,
        chargebackFlag: null,
        ordersCount: null,
        currency: ev.currency || 'MXN',
        items: [],
        eventId: null,
        payloadSnapshot: {
          utm_source: ev?.rawPayload?.utm_source || null,
          utm_medium: ev?.rawPayload?.utm_medium || null,
          utm_campaign: ev?.rawPayload?.utm_campaign || null,
          utm_content: ev?.rawPayload?.utm_content || null,
          utm_term: ev?.rawPayload?.utm_term || null,
          referrer: ev?.rawPayload?.referrer || null,
          gclid: ev?.rawPayload?.gclid || null,
          fbclid: ev?.rawPayload?.fbclid || null,
          ttclid: ev?.rawPayload?.ttclid || null,
        },
        wooSourceLabel: ev?.rawPayload?.woo_source_label || null,
        wooSourceType: ev?.rawPayload?.woo_source_type || null,
        customerName: eventIdentity.customerDisplayName
          || (ev?.rawPayload?.user_data?.fn ? `${ev.rawPayload.user_data.fn} ${ev.rawPayload.user_data.ln || ''}`.trim() : null),
      };
    });

    const conversionInputs = (filteredOrders.length > 0 ? conversionInputsFromOrders : conversionInputsFromEvents);

    const checkoutTokens = Array.from(new Set(conversionInputs.map((c) => c.checkoutToken).filter(Boolean)));
    const userKeys = Array.from(new Set(conversionInputs.map((c) => c.userKey).filter(Boolean)));

    const [checkoutSnapshots, relevantSessions] = await Promise.all([
      checkoutTokens.length > 0
        ? prisma.checkoutSessionMap.findMany({
            where: {
              accountId: account_id,
              checkoutToken: { in: checkoutTokens },
            },
            select: {
              checkoutToken: true,
              attributionSnapshot: true,
              createdAt: true,
              sessionId: true,
              userKey: true,
            },
          })
        : Promise.resolve([]),
      userKeys.length > 0
        ? prisma.session.findMany({
            where: {
              accountId: account_id,
              userKey: { in: userKeys },
              startedAt: {
                lte: endDate,
                gte: subDays(startDate, ATTRIBUTION_LOOKBACK_DAYS),
              },
            },
            select: {
              userKey: true,
              startedAt: true,
              isFirstTouch: true,
              utmSource: true,
              utmMedium: true,
              utmCampaign: true,
              utmContent: true,
              utmTerm: true,
              referrer: true,
              fbclid: true,
              gclid: true,
              ttclid: true,
            },
            orderBy: { startedAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const checkoutByToken = new Map(checkoutSnapshots.map((m) => [m.checkoutToken, m]));
    const sessionsByUserKey = new Map();
    relevantSessions.forEach((s) => {
      if (!sessionsByUserKey.has(s.userKey)) sessionsByUserKey.set(s.userKey, []);
      sessionsByUserKey.get(s.userKey).push(s);
    });

    const conversionsWithAttribution = conversionInputs.map((conv) => {
      const checkout = conv.checkoutToken ? checkoutByToken.get(conv.checkoutToken) : null;
      const resolvedUserKey = conv.userKey || checkout?.userKey || null;
      const resolvedSessionId = conv.sessionId || checkout?.sessionId || null;
      const conversionDate = new Date(conv.createdAt);
      const lookbackStart = subDays(conversionDate, ATTRIBUTION_LOOKBACK_DAYS);

      const snapshots = [];
      if (conv.orderAttributedChannel) {
        snapshots.push({
          snapshot: conv.orderAttributionSnapshot || { utm_source: conv.orderAttributedChannel, utm_medium: conv.orderAttributedChannel },
          timestamp: conv.createdAt,
          source: 'order_snapshot',
        });
      }
      if (checkout?.attributionSnapshot) {
        snapshots.push({
          snapshot: checkout.attributionSnapshot,
          timestamp: checkout.createdAt || conv.createdAt,
          source: 'checkout_snapshot',
        });
      }
      if (conv.payloadSnapshot) {
        snapshots.push({
          snapshot: conv.payloadSnapshot,
          timestamp: conv.createdAt,
          source: 'purchase_payload',
        });
      }

      const sessions = resolvedUserKey
        ? (sessionsByUserKey.get(resolvedUserKey) || []).filter(
            (s) => new Date(s.startedAt) <= conversionDate && new Date(s.startedAt) >= lookbackStart
          )
        : [];

      const touchpoints = buildAttributionTouchpointsForAccount({ snapshots, sessions, accountId: account_id });
      const attribution = resolveConversionAttribution({ model: attributionModel, touchpoints });
      const wooFallback = deriveWooFallbackAttribution({
        woo_source_label: conv.wooSourceLabel,
        woo_source_type: conv.wooSourceType,
        utm_source: conv?.payloadSnapshot?.utm_source || conv?.orderAttributionSnapshot?.utm_source || null,
        utm_medium: conv?.payloadSnapshot?.utm_medium || conv?.orderAttributionSnapshot?.utm_medium || null,
      });

      const orderStoredAttribution = (conv.source === 'orders' && conv.orderAttributedChannel && conv.orderAttributedChannel !== 'unattributed')
        ? {
            primary: {
              channel: resolveStoredDisplayAttribution({
                channel: conv.orderAttributedChannel,
                platform: conv?.orderAttributionSnapshot?.utm_source || conv?.wooSourceLabel || conv.orderAttributedChannel,
                snapshot: conv.orderAttributionSnapshot || {},
                wooSourceLabel: conv.wooSourceLabel || '',
              }),
              platform: conv?.wooSourceLabel || conv?.orderAttributionSnapshot?.utm_source || conv.orderAttributedChannel,
              campaign: conv?.orderAttributionSnapshot?.utm_campaign || null,
              adset: conv?.orderAttributionSnapshot?.utm_content || null,
              ad: conv?.orderAttributionSnapshot?.utm_term || null,
              clickId: conv?.orderAttributionSnapshot?.gclid
                || conv?.orderAttributionSnapshot?.wbraid
                || conv?.orderAttributionSnapshot?.gbraid
                || conv?.orderAttributionSnapshot?.fbclid
                || conv?.orderAttributionSnapshot?.ttclid
                || conv?.orderAttributionSnapshot?.msclkid
                || conv?.orderAttributionSnapshot?.fbc
                || conv?.orderAttributionSnapshot?._fbc
                || null,
              confidence: Number(conv.orderAttributionConfidence || 0.75),
              source: String(conv.orderAttributionModel || '').startsWith('woo_') ? 'woo_fallback' : 'orders_sync',
            },
            splits: [{
              channel: resolveStoredDisplayAttribution({
                channel: conv.orderAttributedChannel,
                platform: conv?.orderAttributionSnapshot?.utm_source || conv?.wooSourceLabel || conv.orderAttributedChannel,
                snapshot: conv.orderAttributionSnapshot || {},
                wooSourceLabel: conv.wooSourceLabel || '',
              }),
              weight: 1,
            }],
            isAttributed: true,
          }
        : null;

      const finalAttribution = orderStoredAttribution || ((!attribution.isAttributed && wooFallback)
        ? {
            primary: wooFallback,
            splits: [{ channel: wooFallback.channel, weight: 1 }],
            isAttributed: true,
          }
        : attribution);

      return {
        ...conv,
        userKey: resolvedUserKey,
        sessionId: resolvedSessionId,
        attributedChannel: finalAttribution.primary.channel,
        attributedPlatform: finalAttribution.primary.platform,
        attributedCampaign: finalAttribution.primary.campaign || null,
        attributedAdset: finalAttribution.primary.adset || null,
        attributedAd: finalAttribution.primary.ad || null,
        attributedClickId: finalAttribution.primary.clickId || null,
        attributionConfidence: finalAttribution.primary.confidence,
        attributionSource: finalAttribution.primary.source,
        attributionModel,
        attributionSplits: finalAttribution.splits,
        isAttributed: finalAttribution.isAttributed,
        wooSourceLabel: conv.wooSourceLabel || null,
        wooSourceType: conv.wooSourceType || null,
        attributionDebug: {
          wooSourceLabel: conv.wooSourceLabel || null,
          wooSourceType: conv.wooSourceType || null,
          payloadUtmSource: conv?.payloadSnapshot?.utm_source || conv?.orderAttributionSnapshot?.utm_source || null,
          payloadReferrer: conv?.payloadSnapshot?.referrer || conv?.orderAttributionSnapshot?.referrer || null,
        },
      };
    });

    const detailedByKey = new Map(
      purchaseEventsDetailed.map((ev) => {
        const key = `${ev.orderId || ''}::${ev.checkoutToken || ''}::${new Date(ev.createdAt).toISOString()}`;
        return [key, ev];
      })
    );

    const modeledConversions = filteredOrders.length > 0
      ? conversionsWithAttribution
      : dedupeEventConversions(conversionsWithAttribution);

    const recentConversions = modeledConversions.slice(0, recentLimit);
    const recentOrderIds = Array.from(new Set(recentConversions.map((c) => c.orderId).filter(Boolean)));
    
    // WooCommerce fallback check: try to find sessionId/userKey from their events if missing from order
    if (recentOrderIds.length > 0) {
      const resolvingEvents = await prisma.event.findMany({
        where: { accountId: account_id, orderId: { in: recentOrderIds } },
        select: { orderId: true, sessionId: true, userKey: true }
      });
      
      const sessionByOrder = new Map();
      const userKeyByOrder = new Map();
      for (const ev of resolvingEvents) {
        if (ev.sessionId && !sessionByOrder.has(ev.orderId)) sessionByOrder.set(ev.orderId, ev.sessionId);
        if (ev.userKey && !userKeyByOrder.has(ev.orderId)) userKeyByOrder.set(ev.orderId, ev.userKey);
      }
      
      for (const rc of recentConversions) {
        if (!rc.sessionId && sessionByOrder.has(rc.orderId)) rc.sessionId = sessionByOrder.get(rc.orderId);
        if (!rc.userKey && userKeyByOrder.has(rc.orderId)) rc.userKey = userKeyByOrder.get(rc.orderId);
      }
    }

    const recentCheckoutTokens = Array.from(new Set(recentConversions.map((c) => c.checkoutToken).filter(Boolean)));
    let recentSessionIds = Array.from(new Set(recentConversions.map((c) => c.sessionId).filter(Boolean)));
    let recentUserKeys = Array.from(new Set(recentConversions.map((c) => c.userKey).filter(Boolean)));
    const recentCustomerIds = Array.from(new Set(recentConversions.map((c) => c.customerId).filter(Boolean)));
    const recentEmailHashes = Array.from(new Set(recentConversions.map((c) => c.emailHash).filter(Boolean)));
    const recentPhoneHashes = Array.from(new Set(recentConversions.map((c) => c.phoneHash).filter(Boolean)));
    const recentFingerprintHashes = Array.from(new Set(recentConversions.map((c) => c.browserFingerprintHash).filter(Boolean)));

    const recentConversionTimes = recentConversions
      .map((c) => new Date(c.createdAt).getTime())
      .filter((ts) => Number.isFinite(ts));

    if (recentConversionTimes.length) {
      const earliestTs = Math.min(...recentConversionTimes) - journeyStitchLookbackMs;
      const latestTs = Math.max(...recentConversionTimes) + (60 * 60 * 1000);

      const identityClauses = buildIdentityOrClauses({
        userKeys: recentUserKeys,
        customerIds: recentCustomerIds,
        emailHashes: recentEmailHashes,
        phoneHashes: recentPhoneHashes,
        fingerprintHashes: recentFingerprintHashes,
      });

      if (identityClauses.length) {
        const identityRowsForJourney = await prisma.identityGraph.findMany({
          where: {
            accountId: account_id,
            OR: identityClauses,
          },
          select: {
            userKey: true,
            fingerprintHash: true,
          },
          take: 800,
        });

        const graphUserKeys = identityRowsForJourney.map((row) => row.userKey).filter(Boolean);
        recentUserKeys = Array.from(new Set([...recentUserKeys, ...graphUserKeys]));

        if (recentUserKeys.length) {
          const sessionsByIdentity = await prisma.session.findMany({
            where: {
              accountId: account_id,
              userKey: { in: recentUserKeys },
              startedAt: {
                gte: new Date(earliestTs),
                lte: new Date(latestTs),
              },
            },
            select: {
              sessionId: true,
            },
            take: 800,
          });
          const graphSessionIds = sessionsByIdentity.map((row) => row.sessionId).filter(Boolean);
          recentSessionIds = Array.from(new Set([...recentSessionIds, ...graphSessionIds]));
        }
      }
    }

    const journeyEventOrFilters = [];
    if (recentOrderIds.length) journeyEventOrFilters.push({ orderId: { in: recentOrderIds } });
    if (recentCheckoutTokens.length) journeyEventOrFilters.push({ checkoutToken: { in: recentCheckoutTokens } });
    if (recentSessionIds.length) journeyEventOrFilters.push({ sessionId: { in: recentSessionIds } });
    if (recentUserKeys.length) journeyEventOrFilters.push({ userKey: { in: recentUserKeys } });

    let stitchedCandidateEvents = [];
    if (journeyEventOrFilters.length && recentConversionTimes.length) {
      const earliestTs = Math.min(...recentConversionTimes) - journeyStitchLookbackMs;
      const latestTs = Math.max(...recentConversionTimes) + (60 * 60 * 1000);
      stitchedCandidateEvents = await prisma.event.findMany({
        where: {
          accountId: account_id,
          createdAt: {
            gte: new Date(earliestTs),
            lte: new Date(latestTs),
          },
          OR: journeyEventOrFilters,
        },
        select: {
          eventId: true,
          eventName: true,
          createdAt: true,
          collectedAt: true,
          browserReceivedAt: true,
          serverReceivedAt: true,
          pageType: true,
          pageUrl: true,
          productId: true,
          variantId: true,
          cartId: true,
          cartValue: true,
          rawSource: true,
          matchType: true,
          confidenceScore: true,
          revenue: true,
          currency: true,
          orderId: true,
          checkoutToken: true,
          sessionId: true,
          userKey: true,
          rawPayload: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1500,
      });
      stitchedCandidateEvents.reverse(); // put back to asc
    }

    const eventsByOrderId = new Map();
    const eventsByCheckoutToken = new Map();
    const eventsBySessionId = new Map();
    const eventsByUserKey = new Map();
    const eventsByCustomerId = new Map();
    
    for (const ev of stitchedCandidateEvents) {
      const evTs = new Date(ev.createdAt).getTime();
      if (!Number.isFinite(evTs)) continue;
      ev._evTs = evTs;
      if (ev.orderId) { const k = String(ev.orderId); if (!eventsByOrderId.has(k)) eventsByOrderId.set(k, []); eventsByOrderId.get(k).push(ev); }
      if (ev.checkoutToken) { const k = String(ev.checkoutToken); if (!eventsByCheckoutToken.has(k)) eventsByCheckoutToken.set(k, []); eventsByCheckoutToken.get(k).push(ev); }
      if (ev.sessionId) { const k = String(ev.sessionId); if (!eventsBySessionId.has(k)) eventsBySessionId.set(k, []); eventsBySessionId.get(k).push(ev); }
      if (ev.userKey) { const k = String(ev.userKey); if (!eventsByUserKey.has(k)) eventsByUserKey.set(k, []); eventsByUserKey.get(k).push(ev); }
      
      const eventIdentity = extractEventIdentity(ev.rawPayload || {});
      if (eventIdentity.customerId) {
        const k = String(eventIdentity.customerId);
        if (!eventsByCustomerId.has(k)) eventsByCustomerId.set(k, []);
        eventsByCustomerId.get(k).push(ev);
      }
    }

    const recentPurchases = await Promise.all(recentConversions.map(async (conv) => {
      const key = `${conv.orderId || ''}::${conv.checkoutToken || ''}::${new Date(conv.createdAt).toISOString()}`;
      const detailed = detailedByKey.get(key);
      const normalizedItems = conv.source === 'orders'
        ? conv.items
        : (detailed ? normalizeLineItems(detailed.items) : conv.items);

      const convTs = new Date(conv.createdAt).getTime();
      const earliestTs = convTs - journeyStitchLookbackMs;
      const latestTs = convTs + (15 * 60 * 1000);

      const purchaseEventCandidates = [
        ...(conv.orderId ? (eventsByOrderId.get(String(conv.orderId)) || []) : []),
        ...(conv.checkoutToken ? (eventsByCheckoutToken.get(String(conv.checkoutToken)) || []) : [])
      ];
      
      const inferredSessionId = conv.sessionId || purchaseEventCandidates.find(e => e.sessionId)?.sessionId;
      const inferredUserKey = conv.userKey || purchaseEventCandidates.find(e => e.userKey)?.userKey;

      const rawStitched = [
          ...(conv.orderId ? (eventsByOrderId.get(String(conv.orderId)) || []) : []),
          ...(conv.checkoutToken ? (eventsByCheckoutToken.get(String(conv.checkoutToken)) || []) : []),
          ...(inferredSessionId ? (eventsBySessionId.get(String(inferredSessionId)) || []) : []),
          ...(inferredUserKey ? (eventsByUserKey.get(String(inferredUserKey)) || []) : []),
          ...(conv.customerId ? (eventsByCustomerId.get(String(conv.customerId)) || []) : [])
      ];

      const uniqueEventsMap = new Map();
      for (const ev of rawStitched) {
          if (!uniqueEventsMap.has(ev.eventId) && ev._evTs >= earliestTs && ev._evTs <= latestTs) {
             uniqueEventsMap.set(ev.eventId, ev);
          }
      }

      let stitchedEvents = Array.from(uniqueEventsMap.values())
        .sort((a, b) => a._evTs - b._evTs);

      // Fallback: if stitching only found sparse purchase signals, try customer-id linkage.
      if (stitchedEvents.length <= 2 && conv.customerId) {
        try {
          const customerLinkedEvents = await prisma.event.findMany({
            where: {
              accountId: account_id,
              createdAt: {
                gte: new Date(earliestTs),
                lte: new Date(latestTs),
              },
              OR: [
                { rawPayload: { path: ['customer_id'], equals: String(conv.customerId) } },
                { rawPayload: { path: ['customerId'], equals: String(conv.customerId) } },
              ],
            },
            select: {
              eventId: true,
              eventName: true,
              createdAt: true,
              collectedAt: true,
              browserReceivedAt: true,
              serverReceivedAt: true,
              pageType: true,
              pageUrl: true,
              productId: true,
              variantId: true,
              cartId: true,
              cartValue: true,
              rawSource: true,
              matchType: true,
              confidenceScore: true,
              revenue: true,
              currency: true,
              orderId: true,
              checkoutToken: true,
              sessionId: true,
              userKey: true,
              rawPayload: true,
            },
            orderBy: { createdAt: 'asc' },
            take: 300,
          });

          if (customerLinkedEvents.length) {
            stitchedEvents = [...stitchedEvents, ...customerLinkedEvents]
              .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          }
        } catch (_) {
          // Ignore JSON-path incompatibilities and keep primary stitched timeline.
        }
      }

      const seenEventIds = new Set();
      const journeyEvents = stitchedEvents
        .filter((ev) => {
          const uniqueKey = String(ev.eventId || `${ev.eventName || 'event'}:${new Date(ev.createdAt).toISOString()}`);
          if (seenEventIds.has(uniqueKey)) return false;
          seenEventIds.add(uniqueKey);
          return true;
        })
        .slice(0, 120)
        .map((ev) => ({
          eventId: ev.eventId,
          eventName: ev.eventName,
          createdAt: ev.createdAt,
          collectedAt: ev.collectedAt || null,
          browserReceivedAt: ev.browserReceivedAt || null,
          serverReceivedAt: ev.serverReceivedAt || null,
          sessionId: ev.sessionId || null,
          pageType: ev.pageType || null,
          pageUrl: ev.pageUrl || null,
          productId: ev.productId || null,
          variantId: ev.variantId || null,
          cartId: ev.cartId || null,
          cartValue: ev.cartValue ?? null,
          rawSource: ev.rawSource || null,
          matchType: ev.matchType || null,
          confidenceScore: toFiniteNumberOrNull(ev.confidenceScore),
          revenue: toFiniteNumberOrNull(ev.revenue),
          currency: ev.currency || null,
          productName: ev?.rawPayload?.product_name || ev?.rawPayload?.item_name || ev?.rawPayload?.name || null,
          itemId: ev?.rawPayload?.item_id || ev?.rawPayload?.product_id || null,
          utmSource: ev?.rawPayload?.utm_source || null,
          utmMedium: ev?.rawPayload?.utm_medium || null,
          utmCampaign: ev?.rawPayload?.utm_campaign || null,
          utmContent: ev?.rawPayload?.utm_content || null,
          utmTerm: ev?.rawPayload?.utm_term || null,
          ga4SessionSource: ev?.rawPayload?.ga4_session_source || null,
          utmEntryUrl: ev?.rawPayload?.utm_entry_url || null,
          utmSessionHistory: ev?.rawPayload?.utm_session_history || null,
          utmBrowserHistory: ev?.rawPayload?.utm_browser_history || null,
          referrer: ev?.rawPayload?.referrer || ev?.rawPayload?.referer || null,
          checkoutToken: ev.checkoutToken || null,
          orderId: ev.orderId || null,
          fbp: ev?.rawPayload?.fbp || ev?.rawPayload?._fbp || ev?.rawPayload?.user_data?.fbp || null,
          fbclid: ev?.rawPayload?.fbclid || null,
          fbc: ev?.rawPayload?.fbc || ev?.rawPayload?._fbc || ev?.rawPayload?.user_data?.fbc || null,
          ttclid: ev?.rawPayload?.ttclid || ev?.rawPayload?.user_data?.ttclid || null,
          gclid: ev?.rawPayload?.gclid || ev?.rawPayload?.user_data?.gclid || null,
          wbraid: ev?.rawPayload?.wbraid || ev?.rawPayload?.user_data?.wbraid || null,
          gbraid: ev?.rawPayload?.gbraid || ev?.rawPayload?.user_data?.gbraid || null,
          msclkid: ev?.rawPayload?.msclkid || ev?.rawPayload?.user_data?.msclkid || null,
          clickId: ev?.rawPayload?.click_id
            || ev?.rawPayload?.gclid
            || ev?.rawPayload?.wbraid
            || ev?.rawPayload?.gbraid
            || ev?.rawPayload?.fbclid
            || ev?.rawPayload?.ttclid
            || ev?.rawPayload?.msclkid
            || ev?.rawPayload?.fbc
            || ev?.rawPayload?._fbc
            || null,
          customerEmail: ev?.rawPayload?.user_data?.em || ev?.rawPayload?.customer_email || ev?.rawPayload?.user_email || ev?.rawPayload?.email || null,
          clientIp: ev?.rawPayload?.user_data?.client_ip_address || ev?.rawPayload?.client_ip_address || ev?.rawPayload?.client_ip || ev?.rawPayload?.ip || null,
          userAgent: ev?.rawPayload?.user_data?.client_user_agent || ev?.rawPayload?.client_user_agent || ev?.rawPayload?.user_agent || null,
        }));

      const readableAttribution = await attributionLabelResolver.resolveForPurchase({
        purchase: conv,
        stitchedEvents,
      });

      return {
        ...conv,
        selectionKey: getAnalyticsPurchaseSelectionKey(conv),
        items: normalizedItems,
        attributedCampaignLabel: readableAttribution.campaignLabel || null,
        attributedAdsetLabel: readableAttribution.adsetLabel || null,
        attributedAdLabel: readableAttribution.adLabel || null,
        events: journeyEvents,
        attributionDebug: {
          ...(conv.attributionDebug || {}),
          resolvedAttributionLabel: readableAttribution.displayLabel || null,
        },
      };
    }));

    // Recompute channel stats by selected attribution model over resolved conversions.
    Object.keys(channelStats).forEach((key) => {
      channelStats[key].revenue = 0;
      channelStats[key].orders = 0;
    });

    let modeledAttributedRevenue = 0;
    let modeledUnattributedRevenue = 0;
    let modeledAttributedOrders = 0;
    let modeledUnattributedOrders = 0;

    modeledConversions.forEach((conv) => {
      const rev = Number(conv.revenue || 0);
      const splits = Array.isArray(conv.attributionSplits) && conv.attributionSplits.length > 0
        ? conv.attributionSplits
        : [{ channel: 'unattributed', weight: 1 }];

      splits.forEach((split) => {
        const ch = normalizeChannelForStats(split.channel, split.platform || '');
        const weight = Number(split.weight || 0);
        const revenueShare = rev * weight;

        if (!channelStats[ch]) {
          channelStats.other.revenue += revenueShare;
          channelStats.other.orders += weight;
        } else {
          channelStats[ch].revenue += revenueShare;
          channelStats[ch].orders += weight;
        }
      });

      if (conv.isAttributed) {
        modeledAttributedRevenue += rev;
        modeledAttributedOrders += 1;
      } else {
        modeledUnattributedRevenue += rev;
        modeledUnattributedOrders += 1;
      }
    });

    attributedRevenue = modeledAttributedRevenue;
    channelStats.unattributed.revenue = modeledUnattributedRevenue;
    channelStats.unattributed.orders = modeledUnattributedOrders;

    // Purchase events often come via Shopify webhook -> Order table (without Event row).
    // Use the max as a safe dashboard metric that avoids showing 0 when orders exist.
    const modeledEventOrders = filteredOrders.length > 0 ? eventStats.purchase : modeledConversions.length;
    const purchaseEventsResolved = Math.max(modeledEventOrders, filteredOrders.length);
    const totalOrdersResolved = filteredOrders.length > 0 ? filteredOrders.length : modeledConversions.length;
    const purchaseRevenueFromEvents = Number(purchaseRevenueAgg?._sum?.revenue || 0);
    const purchaseRevenueFromEventsModeled = filteredOrders.length > 0
      ? purchaseRevenueFromEvents
      : modeledConversions.reduce((acc, conv) => acc + Number(conv.revenue || 0), 0);
    const totalRevenueResolved = filteredOrders.length > 0 ? totalRevenue : purchaseRevenueFromEventsModeled;

    // Fallback if DB lacks platform connections but MCP holds data
    if (paidMedia?.meta?.hasSnapshot && integrationHealth.meta) {
      integrationHealth.meta.connected = true;
      integrationHealth.meta.status = 'ACTIVE';
    }
    if (paidMedia?.google?.hasSnapshot && integrationHealth.google) {
      integrationHealth.google.connected = true;
      integrationHealth.google.status = 'ACTIVE';
    }

    // 5. Return JSON
    const responsePayload = {
      summary: {
        totalRevenue: totalRevenueResolved,
        totalRevenueOrders: totalRevenue,
        totalRevenueEvents: purchaseRevenueFromEventsModeled,
        revenueSource: filteredOrders.length > 0 ? 'orders' : 'events',
        totalOrders: totalOrdersResolved,
        attributedRevenue,
        attributedOrders: modeledAttributedOrders,
        unattributedOrders: channelStats.unattributed.orders,
        unattributedRevenue: channelStats.unattributed.revenue,
        attributionModel,
        allTime,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        recentLimit,
        totalSessions: sessionCount,
        conversionRate: sessionCount > 0 ? (totalOrdersResolved / sessionCount) : 0,
        pageViews: eventStats.page_view,
        viewItem: eventStats.view_item,
        addToCart: eventStats.add_to_cart,
        beginCheckout: eventStats.begin_checkout,
        purchaseEvents: purchaseEventsResolved,
        purchaseEventsRaw: eventStats.purchase,
        purchaseOrders: totalOrdersResolved,
        totalEvents: eventStats.total,
      },
      dataQuality: {
        revenueSource: filteredOrders.length > 0 ? 'orders' : 'events',
        fallbackActive: filteredOrders.length === 0,
        snapshotUpdatedAt: merchantSnapshot?.updatedAt || null,
      },
      integrationHealth,
      paidMedia,
      events: eventStats,
      pixelHealth: {
        eventsReceived: eventStats.total,
        purchaseSignals: eventStats.purchase,
        orders: filteredOrders.length,
        matchedOrders,
        orderMatchRate: filteredOrders.length > 0 ? Number((matchedOrders / filteredOrders.length).toFixed(4)) : 0,
        purchaseSignalCoverage: filteredOrders.length > 0 ? Number((eventStats.purchase / filteredOrders.length).toFixed(4)) : 0,
      },
      channels: channelStats,
      topProducts,
      recentPurchases,
      daily: Object.values(dailyMap) // sorted array by date
    };

    writeRouteCache(analyticsCacheKey, responsePayload, 10000);
    res.json(responsePayload);

  } catch (error) {
    console.error('[Analytics API] Error:', error);
    if (isDatabaseConnectivityError(error)) {
      const { account_id } = req.params;
      const fallbackModelRaw = String(req.query.attribution_model || req.query.attributionModel || 'last_touch').toLowerCase();
      const fallbackAttributionModel = ATTRIBUTION_MODELS.has(fallbackModelRaw) ? fallbackModelRaw : 'last_touch';
      const fallbackRecentLimitRaw = String(req.query.recent_limit || req.query.recentLimit || '100').toLowerCase();
      const fallbackRecentLimit = fallbackRecentLimitRaw === 'all'
        ? 400
        : Math.max(5, Math.min(300, Number.parseInt(fallbackRecentLimitRaw, 10) || 100));
      const now = new Date();
      const fallbackStart = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

      return res.json({
        degraded: true,
        degradedReason: 'database_unreachable',
        summary: {
          totalRevenue: 0,
          totalRevenueOrders: 0,
          totalRevenueEvents: 0,
          revenueSource: 'events',
          totalOrders: 0,
          attributedRevenue: 0,
          attributedOrders: 0,
          unattributedOrders: 0,
          unattributedRevenue: 0,
          attributionModel: fallbackAttributionModel,
          allTime: false,
          startDate: fallbackStart.toISOString(),
          endDate: now.toISOString(),
          recentLimit: fallbackRecentLimit,
          totalSessions: 0,
          conversionRate: 0,
          pageViews: 0,
          viewItem: 0,
          addToCart: 0,
          beginCheckout: 0,
          purchaseEvents: 0,
          purchaseEventsRaw: 0,
          purchaseOrders: 0,
          totalEvents: 0,
        },
        dataQuality: {
          revenueSource: 'events',
          fallbackActive: true,
          snapshotUpdatedAt: null,
        },
        integrationHealth: {
          meta: { connected: false, status: 'DISCONNECTED', updatedAt: null },
          google: { connected: false, status: 'DISCONNECTED', updatedAt: null },
          tiktok: { connected: false, status: 'DISCONNECTED', updatedAt: null },
        },
        paidMedia: {
          linked: false,
          available: false,
          reason: 'database_unreachable',
          meta: { hasSnapshot: false, spend: null, revenue: null, clicks: null },
          google: { hasSnapshot: false, spend: null, revenue: null, clicks: null },
          blended: { spend: 0, revenue: 0, roas: null, currency: null },
        },
        events: {
          page_view: 0,
          view_item: 0,
          add_to_cart: 0,
          begin_checkout: 0,
          purchase: 0,
          other: 0,
          total: 0,
        },
        pixelHealth: {
          eventsReceived: 0,
          purchaseSignals: 0,
          orders: 0,
          matchedOrders: 0,
          orderMatchRate: 0,
          purchaseSignalCoverage: 0,
        },
        channels: {
          meta: { revenue: 0, orders: 0 },
          google: { revenue: 0, orders: 0 },
          tiktok: { revenue: 0, orders: 0 },
          organic: { revenue: 0, orders: 0 },
          other: { revenue: 0, orders: 0 },
          unattributed: { revenue: 0, orders: 0 },
        },
        topProducts: [],
        recentPurchases: [],
        daily: [],
        accountId: account_id,
      });
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

router.get('/:account_id', getAnalyticsDashboardHandler);

const EXPORT_PREVIEW_PAGE_SIZE = 20;
const EXPORT_MAX_SELECTIONS = 200;
const EXPORT_MAX_RECENT_PURCHASES = 400;
const EXPORT_STRICT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const EXPORT_STRICT_FORWARD_MS = 2 * 60 * 60 * 1000;

function resolveAnalyticsExportStitchScope(input = {}) {
  const raw = String(input.stitch_scope || input.stitchScope || '').trim().toLowerCase();
  return raw === 'full' ? 'full' : 'strict';
}

function getAnalyticsPurchaseSelectionKey(purchase = {}) {
  const orderId = String(purchase.orderId || '').trim();
  if (orderId) return `order:${orderId}`;

  const orderNumber = String(purchase.orderNumber || '').trim();
  if (orderNumber) return `order-number:${orderNumber}`;

  const checkoutToken = String(purchase.checkoutToken || '').trim();
  if (checkoutToken) return `checkout:${checkoutToken}`;

  const createdAt = String(purchase.platformCreatedAt || purchase.createdAt || '').trim();
  const userKey = String(purchase.userKey || '').trim();
  const customerId = String(purchase.customerId || '').trim();
  const revenue = String(Number(purchase.revenue || 0));
  return `fallback:${createdAt}:${userKey}:${customerId}:${revenue}`;
}

function resolveAnalyticsPurchaseCustomerName(purchase = {}) {
  const directCandidates = [
    purchase.customerName,
    purchase.customerDisplayName,
    purchase.displayName,
    purchase.billingName,
    purchase.shippingName,
    [purchase.billingFirstName, purchase.billingLastName].filter(Boolean).join(' ').trim(),
    [purchase.customerFirstName, purchase.customerLastName].filter(Boolean).join(' ').trim(),
    [purchase.firstName, purchase.lastName].filter(Boolean).join(' ').trim(),
  ];

  const directHit = directCandidates.find((value) => String(value || '').trim());
  if (directHit) return String(directHit || '').trim();

  const events = Array.isArray(purchase.events) ? purchase.events : [];
  for (const event of events) {
    const hit = [
      event?.customerName,
      event?.customerDisplayName,
      event?.customerEmail,
    ].find((value) => String(value || '').trim());
    if (hit) return String(hit || '').trim();
  }

  return '';
}

function resolveAnalyticsPurchaseCustomerEmail(purchase = {}) {
  const directCandidates = [
    purchase.customerEmail,
    purchase.email,
    purchase.billingEmail,
    purchase.shippingEmail,
    purchase.userEmail,
  ];

  const directHit = directCandidates.find((value) => String(value || '').trim());
  if (directHit) return String(directHit || '').trim().toLowerCase();

  const events = Array.isArray(purchase.events) ? purchase.events : [];
  for (const event of events) {
    const eventHit = [
      event?.customerEmail,
      event?.email,
      event?.userEmail,
    ].find((value) => String(value || '').trim());
    if (eventHit) return String(eventHit || '').trim().toLowerCase();
  }

  return '';
}

function normalizeAnalyticsExportPath(urlLike) {
  if (!urlLike) return '-';
  try {
    return new URL(urlLike, 'https://adray.ai').pathname || '-';
  } catch (_) {
    return String(urlLike || '-').trim() || '-';
  }
}

function shortenAnalyticsIdentifier(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function normalizeAnalyticsAttributionLabelType(type = '') {
  const value = String(type || '').trim().toLowerCase();
  if (value === 'ad') return 'ad';
  if (value === 'adset') return 'ad set';
  if (value === 'click') return 'click';
  return 'campaign';
}

function humanizeAnalyticsChannel(channel = '', platform = '') {
  const normalized = normalizeChannelForStats(channel, platform);
  if (normalized === 'meta') return 'Meta Ads';
  if (normalized === 'google') return 'Google Ads';
  if (normalized === 'tiktok') return 'TikTok Ads';
  if (normalized === 'organic') return 'Organic';
  if (normalized === 'direct') return 'Direct';
  if (normalized === 'referral') return 'Referral';
  if (normalized === 'email') return 'Email';
  if (normalized === 'unattributed') return 'Unattributed';
  return 'Other';
}

function isAnalyticsPurchaseJourneyEventName(rawName = '') {
  return PURCHASE_ALIASES.includes(String(rawName || '').trim().toLowerCase());
}

function resolveAnalyticsJourneyReferrerLabel(referrer = '') {
  const value = String(referrer || '').trim();
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch (_) {
    return value;
  }
}

function normalizeAnalyticsComparableHost(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '');
}

function sanitizeAnalyticsMarketingValue(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const token = normalizeAttributionToken(normalized);
  if (!token) return null;
  if (['unknown', 'null', 'undefined', 'n/a', 'none', '-', 'no campaign'].includes(token)) return null;
  if (/^[\/\\|]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeAnalyticsExportPlatformValue(...candidates) {
  const combined = candidates
    .map((value) => normalizeAttributionToken(value))
    .filter(Boolean)
    .join(' ');

  if (!combined) return null;
  if (includesAny(combined, ['facebook', 'instagram', 'meta', 'fbclid', 'm.facebook.com'])) return 'meta';
  if (includesAny(combined, ['google', 'adwords', 'gclid', 'google.com'])) return 'google';
  if (includesAny(combined, ['tiktok', 'ttclid'])) return 'tiktok';
  if (includesAny(combined, ['email', 'newsletter', 'klaviyo', 'mailchimp', 'sendgrid', 'brevo', 'hubspot'])) return 'email';
  if (includesAny(combined, ['direct'])) return 'direct';
  if (includesAny(combined, ['organic', 'seo'])) return 'organic';
  if (includesAny(combined, ['referral', 'affiliate', 'partner'])) return 'referral';

  const firstCandidate = candidates
    .map((value) => sanitizeAnalyticsMarketingValue(value))
    .find(Boolean);

  return firstCandidate ? normalizeAttributionToken(firstCandidate).replace(/\s+/g, '_') : null;
}

function resolveAnalyticsExportResolvedAttributionLabel(purchase = {}) {
  const prioritizedLabels = [
    purchase.attributedAdLabel,
    purchase.attributedAd,
    purchase.attributedAdsetLabel,
    purchase.attributedAdset,
    purchase.attributedCampaignLabel,
    purchase.attributedCampaign,
    purchase?.attributionDebug?.resolvedAttributionLabel,
  ]
    .map((value) => sanitizeAnalyticsMarketingValue(value))
    .filter(Boolean);

  if (prioritizedLabels.length) return prioritizedLabels[0];

  const clickId = sanitizeAnalyticsMarketingValue(purchase.attributedClickId);
  if (clickId) {
    const platformLabel = humanizeAnalyticsChannel(purchase.attributedChannel || '', purchase.attributedPlatform || '');
    return `${platformLabel} click ${shortenAnalyticsIdentifier(clickId)}`.trim();
  }

  const wooSourceLabel = sanitizeAnalyticsMarketingValue(purchase.wooSourceLabel);
  const wooSourceType = normalizeAttributionToken(purchase.wooSourceType || '');
  if (wooSourceType === 'organic' && normalizeAnalyticsExportPlatformValue(purchase.attributedPlatform, purchase.wooSourceLabel) === 'google') {
    return 'Google Organic';
  }
  if (wooSourceType === 'organic') {
    return `${humanizeAnalyticsChannel('organic', purchase.attributedPlatform || purchase.wooSourceLabel || '')}`.trim();
  }
  if (wooSourceLabel) {
    const channelLabel = humanizeAnalyticsChannel(purchase.attributedChannel || '', purchase.attributedPlatform || purchase.wooSourceLabel || '');
    return `${channelLabel} via ${wooSourceLabel}`.trim();
  }

  const channelLabel = humanizeAnalyticsChannel(purchase.attributedChannel || '', purchase.attributedPlatform || '');
  return sanitizeAnalyticsMarketingValue(channelLabel) || 'No campaign';
}

function resolveAnalyticsAttributedSourceDescriptor(purchase = {}) {
  const campaignLabel = sanitizeAnalyticsMarketingValue(purchase.attributedCampaignLabel || purchase.attributedCampaign || '');
  const adsetLabel = sanitizeAnalyticsMarketingValue(purchase.attributedAdsetLabel || purchase.attributedAdset || '');
  const adLabel = sanitizeAnalyticsMarketingValue(purchase.attributedAdLabel || purchase.attributedAd || '');
  const clickId = String(purchase.attributedClickId || '').trim();

  if (adLabel) return { label: adLabel, type: 'ad' };
  if (adsetLabel) return { label: adsetLabel, type: 'adset' };
  if (campaignLabel) return { label: campaignLabel, type: 'campaign' };
  if (clickId) return { label: shortenAnalyticsIdentifier(clickId), type: 'click' };
  return { label: 'No campaign', type: 'campaign' };
}

function dedupeAdjacentAnalyticsJourneyEvents(eventsArray = []) {
  if (!Array.isArray(eventsArray) || eventsArray.length === 0) return [];
  const result = [];
  let current = eventsArray[0];

  for (let index = 1; index < eventsArray.length; index += 1) {
    const next = eventsArray[index];
    const currentName = String(current.eventName || '').trim().toLowerCase();
    const nextName = String(next.eventName || '').trim().toLowerCase();
    const currentPath = normalizeAnalyticsExportPath(current.pageUrl || '');
    const nextPath = normalizeAnalyticsExportPath(next.pageUrl || '');

    if (currentName === nextName && currentPath === nextPath) continue;

    result.push(current);
    current = next;
  }

  result.push(current);
  return result;
}

function resolveAnalyticsJourneyTouchpoint({ event = {}, purchase = {} } = {}) {
  const utmSource = String(event.utmSource || '').trim().toLowerCase();
  const utmMedium = String(event.utmMedium || '').trim().toLowerCase();
  const utmCampaign = sanitizeAnalyticsMarketingValue(event.utmCampaign || '');
  const referrer = String(event.referrer || '').trim();
  let referrerLabel = resolveAnalyticsJourneyReferrerLabel(referrer);
  const pageDomain = resolveAnalyticsJourneyReferrerLabel(event.pageUrl || '');
  if (
    referrerLabel
    && pageDomain
    && normalizeAnalyticsComparableHost(referrerLabel) === normalizeAnalyticsComparableHost(pageDomain)
  ) {
    referrerLabel = '';
  }
  const gclid = String(event.gclid || '').trim();
  const metaClickId = String(event.fbclid || event.fbc || '').trim();
  const ttclid = String(event.ttclid || '').trim();
  const genericClickId = String(event.clickId || '').trim();
  const hasPaidGoogleUtm = utmSource.includes('google') && /(cpc|paid|search|ads)/.test(utmMedium);
  const hasPaidMetaUtm = utmSource.includes('meta') || utmSource.includes('facebook') || utmSource.includes('instagram');
  const fallbackChannel = normalizeChannelForStats(purchase.attributedChannel || '', purchase.attributedPlatform || '');
  const fallbackSource = resolveAnalyticsAttributedSourceDescriptor(purchase);
  const fallbackCampaign = sanitizeAnalyticsMarketingValue(fallbackSource.label || '');
  const fallbackClickId = String(purchase.attributedClickId || '').trim();

  let channelKey = 'direct';
  let label = 'Direct';
  let reason = 'No explicit campaign or click id was found in this session.';
  let clickId = '';

  if (gclid || hasPaidGoogleUtm) {
    channelKey = 'google';
    label = 'Google Ads';
    reason = gclid ? 'Matched by Google click id.' : 'Paid Google UTM detected.';
    clickId = gclid || (hasPaidGoogleUtm ? genericClickId : '');
  } else if (metaClickId || (genericClickId && hasPaidMetaUtm)) {
    channelKey = 'meta';
    label = 'Meta Ads';
    reason = metaClickId ? 'Matched by Meta click id.' : 'Detected from Meta campaign click id.';
    clickId = metaClickId || genericClickId;
  } else if (ttclid) {
    channelKey = 'tiktok';
    label = 'TikTok Ads';
    reason = 'Matched by TikTok click id.';
    clickId = ttclid;
  } else if (hasPaidMetaUtm) {
    channelKey = 'meta';
    label = /(organic|social)/.test(utmMedium) ? 'Meta Organic' : 'Meta Ads';
    reason = 'Detected from Meta UTM source.';
  } else if (utmSource.includes('tiktok')) {
    channelKey = 'tiktok';
    label = /(organic|social)/.test(utmMedium) ? 'TikTok Organic' : 'TikTok Ads';
    reason = 'Detected from TikTok UTM source.';
  } else if (utmSource.includes('google')) {
    channelKey = /(cpc|paid|search|ads)/.test(utmMedium) ? 'google' : 'organic';
    label = channelKey === 'google' ? 'Google Ads' : 'Google Organic';
    reason = 'Detected from Google UTM source.';
  } else if (referrerLabel.includes('google')) {
    channelKey = 'organic';
    label = 'Google Organic';
    reason = `Referrer ${referrerLabel} indicates search traffic.`;
  } else if (referrerLabel.includes('facebook') || referrerLabel.includes('instagram')) {
    channelKey = 'organic';
    label = 'Meta Organic';
    reason = `Referrer ${referrerLabel} indicates social traffic.`;
  } else if (referrerLabel.includes('tiktok')) {
    channelKey = 'organic';
    label = 'TikTok Organic';
    reason = `Referrer ${referrerLabel} indicates social traffic.`;
  } else if (utmSource) {
    channelKey = normalizeChannelForStats(utmSource, utmMedium || utmSource);
    label = humanizeAnalyticsChannel(utmSource, utmMedium || utmSource);
    reason = `UTM source ${utmSource} was captured in this session.`;
  } else if (referrerLabel) {
    channelKey = 'referral';
    label = 'Referral';
    reason = `Referrer ${referrerLabel} stitched this session.`;
  } else if (fallbackChannel && fallbackChannel !== 'other' && fallbackChannel !== 'unattributed') {
    channelKey = fallbackChannel;
    label = `${humanizeAnalyticsChannel(purchase.attributedChannel || fallbackChannel, purchase.attributedPlatform || '')} inferred`;
    reason = 'Inherited from the final attributed purchase when this session had no explicit source.';
    clickId = fallbackClickId;
  }

  const campaign = sanitizeAnalyticsMarketingValue(utmCampaign || fallbackCampaign || '');
  const sourceType = utmCampaign ? 'campaign' : (fallbackSource.type || 'campaign');
  const subLabel = campaign
    ? `Attributed ${normalizeAnalyticsAttributionLabelType(sourceType)}: ${campaign}`
    : clickId
      ? `Click ID: ${shortenAnalyticsIdentifier(clickId)}`
      : referrerLabel
        ? `Referrer: ${referrerLabel}`
        : 'No campaign metadata';

  return {
    channelKey,
    label,
    reason,
    campaign,
    clickId,
    referrerLabel,
    utmSource: utmSource || null,
    utmMedium: utmMedium || null,
    utmCampaign: utmCampaign || null,
    utmContent: event.utmContent || null,
    utmTerm: event.utmTerm || null,
    ga4SessionSource: event.ga4SessionSource || null,
    gclid: event.gclid || null,
    fbp: event.fbp || null,
    fbc: event.fbc || null,
    ttclid: event.ttclid || null,
    sourceType,
    subLabel,
  };
}

function buildAnalyticsJourneySessionSentence(group = {}) {
  const touchpoint = group.touchpoint || {};
  const sessionLabel = String(group.label || 'This session').trim();
  const entryPage = group.entryPage && group.entryPage !== '-' ? group.entryPage : '';
  const campaign = String(touchpoint.campaign || '').trim();
  const sourceTypeLabel = normalizeAnalyticsAttributionLabelType(touchpoint.sourceType || 'campaign');
  const clickId = String(touchpoint.clickId || '').trim();
  const referrerLabel = String(touchpoint.referrerLabel || '').trim();
  const channelLabel = String(touchpoint.label || 'Direct').trim();
  const actionCopy = String(group.actionCopy || '').trim();
  const lowerLabel = channelLabel.toLowerCase();

  let intro = `${sessionLabel} opened directly because no new ad click or campaign was captured before the return`;
  if (clickId && campaign) {
    intro = `${sessionLabel} opened after a ${channelLabel} click from ${sourceTypeLabel} ${campaign} (${shortenAnalyticsIdentifier(clickId)})`;
  } else if (clickId) {
    intro = `${sessionLabel} opened after a ${channelLabel} click (${shortenAnalyticsIdentifier(clickId)})`;
  } else if (campaign) {
    intro = `${sessionLabel} opened through ${channelLabel} ${sourceTypeLabel} ${campaign}`;
  } else if (referrerLabel) {
    intro = `${sessionLabel} opened from ${channelLabel} traffic coming from ${referrerLabel}`;
  } else if (lowerLabel.includes('direct')) {
    intro = `${sessionLabel} opened directly because no new ad click or campaign was captured before the return`;
  } else if (lowerLabel.includes('referral')) {
    intro = `${sessionLabel} opened from a referral source`;
  } else if (lowerLabel.includes('organic')) {
    intro = `${sessionLabel} opened through ${channelLabel} with no paid click id captured`;
  } else if (lowerLabel.includes('inferred')) {
    intro = `${sessionLabel} was inferred from the final purchase attribution when this session had no fresh source metadata`;
  } else {
    intro = `${sessionLabel} opened through ${channelLabel}`;
  }

  const landingCopy = entryPage ? `, landing on ${entryPage}` : ', returning to the site';
  const actionSentence = actionCopy ? ` ${actionCopy}` : '';
  return `${intro}${landingCopy}.${actionSentence}`.trim();
}

const ANALYTICS_JOURNEY_EVENT_SELECT = {
  eventId: true,
  eventName: true,
  createdAt: true,
  collectedAt: true,
  browserReceivedAt: true,
  serverReceivedAt: true,
  pageType: true,
  pageUrl: true,
  productId: true,
  variantId: true,
  cartId: true,
  cartValue: true,
  rawSource: true,
  matchType: true,
  confidenceScore: true,
  ipHash: true,
  revenue: true,
  currency: true,
  orderId: true,
  checkoutToken: true,
  sessionId: true,
  userKey: true,
  rawPayload: true,
};

function getAnalyticsJourneyEventStableKey(event = {}) {
  const eventId = String(event.eventId || '').trim();
  if (eventId) return eventId;
  const createdAt = new Date(event.createdAt || event.collectedAt || 0).toISOString();
  return [
    String(event.eventName || '').trim().toLowerCase(),
    createdAt,
    String(event.sessionId || '').trim(),
    String(event.orderId || '').trim(),
    String(event.checkoutToken || '').trim(),
    String(event.pageUrl || '').trim(),
    String(event.rawSource || '').trim(),
  ].join('::');
}

function mapAnalyticsJourneyEventRecord(ev = {}) {
  return {
    eventId: ev.eventId || null,
    eventName: ev.eventName || null,
    createdAt: ev.createdAt || null,
    collectedAt: ev.collectedAt || null,
    browserReceivedAt: ev.browserReceivedAt || null,
    serverReceivedAt: ev.serverReceivedAt || null,
    sessionId: ev.sessionId || null,
    userKey: ev.userKey || null,
    pageType: ev.pageType || null,
    pageUrl: ev.pageUrl || null,
    productId: ev.productId || null,
    variantId: ev.variantId || null,
    cartId: ev.cartId || null,
    cartValue: ev.cartValue ?? null,
    rawSource: ev.rawSource || null,
    matchType: ev.matchType || null,
    confidenceScore: toFiniteNumberOrNull(ev.confidenceScore),
    ipHash: ev.ipHash || null,
    revenue: toFiniteNumberOrNull(ev.revenue),
    currency: ev.currency || null,
    productName: ev?.rawPayload?.product_name || ev?.rawPayload?.item_name || ev?.rawPayload?.name || null,
    itemId: ev?.rawPayload?.item_id || ev?.rawPayload?.product_id || null,
    utmSource: ev?.rawPayload?.utm_source || null,
    utmMedium: ev?.rawPayload?.utm_medium || null,
    utmCampaign: ev?.rawPayload?.utm_campaign || null,
    utmContent: ev?.rawPayload?.utm_content || null,
    utmTerm: ev?.rawPayload?.utm_term || null,
    ga4SessionSource: ev?.rawPayload?.ga4_session_source || null,
    utmEntryUrl: ev?.rawPayload?.utm_entry_url || null,
    utmSessionHistory: ev?.rawPayload?.utm_session_history || null,
    utmBrowserHistory: ev?.rawPayload?.utm_browser_history || null,
    referrer: ev?.rawPayload?.referrer || ev?.rawPayload?.referer || null,
    checkoutToken: ev.checkoutToken || null,
    orderId: ev.orderId || null,
    fbp: ev?.rawPayload?.fbp || ev?.rawPayload?._fbp || ev?.rawPayload?.user_data?.fbp || null,
    fbclid: ev?.rawPayload?.fbclid || null,
    fbc: ev?.rawPayload?.fbc || ev?.rawPayload?._fbc || ev?.rawPayload?.user_data?.fbc || null,
    ttclid: ev?.rawPayload?.ttclid || ev?.rawPayload?.user_data?.ttclid || null,
    gclid: ev?.rawPayload?.gclid || ev?.rawPayload?.user_data?.gclid || null,
    wbraid: ev?.rawPayload?.wbraid || ev?.rawPayload?.user_data?.wbraid || null,
    gbraid: ev?.rawPayload?.gbraid || ev?.rawPayload?.user_data?.gbraid || null,
    msclkid: ev?.rawPayload?.msclkid || ev?.rawPayload?.user_data?.msclkid || null,
    clickId: ev?.rawPayload?.click_id
      || ev?.rawPayload?.gclid
      || ev?.rawPayload?.wbraid
      || ev?.rawPayload?.gbraid
      || ev?.rawPayload?.fbclid
      || ev?.rawPayload?.ttclid
      || ev?.rawPayload?.msclkid
      || ev?.rawPayload?.fbc
      || ev?.rawPayload?._fbc
      || null,
    customerEmail: ev?.rawPayload?.user_data?.em || ev?.rawPayload?.customer_email || ev?.rawPayload?.user_email || ev?.rawPayload?.email || null,
    clientIp: ev?.rawPayload?.user_data?.client_ip_address || ev?.rawPayload?.client_ip_address || ev?.rawPayload?.client_ip || ev?.rawPayload?.ip || null,
    userAgent: ev?.rawPayload?.user_data?.client_user_agent || ev?.rawPayload?.client_user_agent || ev?.rawPayload?.user_agent || null,
  };
}

function scoreAnalyticsPurchaseEvent(event = {}, purchase = {}) {
  let score = 0;
  const pageUrl = String(event.pageUrl || '').toLowerCase();
  const rawSource = normalizeAttributionToken(event.rawSource || '');
  const matchType = normalizeAttributionToken(event.matchType || '');

  if (pageUrl.includes('/order-received/')) score += 400;
  if (rawSource === 'pixel') score += 300;
  if (rawSource === 'plugin_server') score += 180;
  if (rawSource === 'plugin_order_sync') score += 120;
  if (matchType === 'deterministic') score += 120;
  if (matchType === 'probabilistic') score += 40;
  if (event.pageUrl) score += 50;
  if (event.sessionId && purchase.sessionId && String(event.sessionId) === String(purchase.sessionId)) score += 80;
  score += Math.round(Number(event.confidenceScore || 0) * 100);
  return score;
}

function buildSyntheticAnalyticsPurchaseEvent(purchase = {}, events = []) {
  const fallbackEvent = [...(Array.isArray(events) ? events : [])]
    .reverse()
    .find((event) => String(event.pageUrl || '').trim())
    || (Array.isArray(events) ? events[events.length - 1] : null)
    || {};

  return {
    eventId: `synthetic-purchase:${getAnalyticsPurchaseSelectionKey(purchase)}`,
    eventName: 'purchase',
    createdAt: purchase.platformCreatedAt || purchase.createdAt || fallbackEvent.createdAt || new Date().toISOString(),
    collectedAt: purchase.platformCreatedAt || purchase.createdAt || fallbackEvent.collectedAt || null,
    browserReceivedAt: fallbackEvent.browserReceivedAt || null,
    serverReceivedAt: fallbackEvent.serverReceivedAt || null,
    sessionId: purchase.sessionId || fallbackEvent.sessionId || null,
    userKey: purchase.userKey || fallbackEvent.userKey || null,
    pageType: fallbackEvent.pageType || null,
    pageUrl: fallbackEvent.pageUrl || null,
    productId: null,
    variantId: null,
    cartId: fallbackEvent.cartId || null,
    cartValue: fallbackEvent.cartValue ?? null,
    rawSource: 'order_anchor',
    matchType: 'synthetic',
    confidenceScore: Number(purchase.attributionConfidence || 0.5),
    revenue: toFiniteNumberOrNull(purchase.revenue),
    currency: purchase.currency || fallbackEvent.currency || 'MXN',
    productName: null,
    itemId: null,
    utmSource: fallbackEvent.utmSource || null,
    utmMedium: fallbackEvent.utmMedium || null,
    utmCampaign: fallbackEvent.utmCampaign || null,
    utmContent: fallbackEvent.utmContent || null,
    utmTerm: fallbackEvent.utmTerm || null,
    ga4SessionSource: fallbackEvent.ga4SessionSource || null,
    utmEntryUrl: fallbackEvent.utmEntryUrl || null,
    utmSessionHistory: fallbackEvent.utmSessionHistory || null,
    utmBrowserHistory: fallbackEvent.utmBrowserHistory || null,
    referrer: fallbackEvent.referrer || null,
    checkoutToken: purchase.checkoutToken || fallbackEvent.checkoutToken || null,
    orderId: purchase.orderId || fallbackEvent.orderId || null,
    fbp: fallbackEvent.fbp || null,
    fbclid: fallbackEvent.fbclid || null,
    fbc: fallbackEvent.fbc || null,
    ttclid: fallbackEvent.ttclid || null,
    gclid: fallbackEvent.gclid || null,
    clickId: fallbackEvent.clickId || null,
    customerEmail: resolveAnalyticsPurchaseCustomerEmail(purchase) || fallbackEvent.customerEmail || null,
    clientIp: fallbackEvent.clientIp || null,
    userAgent: fallbackEvent.userAgent || null,
  };
}

function rankAnalyticsExportEventWithinTimestamp(event = {}, canonicalPurchaseKey = '') {
  const stableKey = getAnalyticsJourneyEventStableKey(event);
  if (canonicalPurchaseKey && stableKey === canonicalPurchaseKey) return 100;

  const eventName = String(event.eventName || '').trim().toLowerCase();
  if (eventName === 'purchase') return 90;
  if (eventName === 'begin_checkout') return 60;
  if (eventName === 'add_to_cart') return 50;
  if (eventName === 'page_view') return 10;
  return 20;
}

function finalizeAnalyticsExportEvents(events = [], purchase = {}) {
  const sorted = (Array.isArray(events) ? events : [])
    .map((event) => ({
      ...event,
      _ts: new Date(event.createdAt || event.collectedAt || purchase.platformCreatedAt || purchase.createdAt || 0).getTime(),
    }))
    .filter((event) => Number.isFinite(event._ts))
    .sort((a, b) => a._ts - b._ts);

  const seenKeys = new Set();
  const deduped = [];
  sorted.forEach((event) => {
    const stableKey = getAnalyticsJourneyEventStableKey(event);
    if (seenKeys.has(stableKey)) return;
    seenKeys.add(stableKey);
    deduped.push(event);
  });

  const matchingPurchaseEvents = [];
  const otherEvents = [];

  deduped.forEach((event) => {
    if (!isAnalyticsPurchaseJourneyEventName(event.eventName || '')) {
      otherEvents.push(event);
      return;
    }

    const conflictsWithOrder = purchase.orderId && event.orderId && String(event.orderId) !== String(purchase.orderId);
    const conflictsWithCheckout = purchase.checkoutToken && event.checkoutToken && String(event.checkoutToken) !== String(purchase.checkoutToken);
    if (conflictsWithOrder || conflictsWithCheckout) return;

    matchingPurchaseEvents.push(event);
  });

  const canonicalPurchase = matchingPurchaseEvents.length
    ? [...matchingPurchaseEvents].sort((a, b) => {
        const scoreDelta = scoreAnalyticsPurchaseEvent(b, purchase) - scoreAnalyticsPurchaseEvent(a, purchase);
        if (scoreDelta !== 0) return scoreDelta;
        return new Date(b.createdAt || b.collectedAt || 0).getTime() - new Date(a.createdAt || a.collectedAt || 0).getTime();
      })[0]
    : buildSyntheticAnalyticsPurchaseEvent(purchase, deduped);

  const canonicalPurchaseKey = getAnalyticsJourneyEventStableKey(canonicalPurchase);
  const timeline = [...otherEvents, canonicalPurchase]
    .sort((a, b) => {
      const timeDelta = Number(a._ts || 0) - Number(b._ts || 0);
      if (timeDelta !== 0) return timeDelta;

      const rankDelta = rankAnalyticsExportEventWithinTimestamp(a, canonicalPurchaseKey)
        - rankAnalyticsExportEventWithinTimestamp(b, canonicalPurchaseKey);
      if (rankDelta !== 0) return rankDelta;

      return getAnalyticsJourneyEventStableKey(a).localeCompare(getAnalyticsJourneyEventStableKey(b));
    });

  const purchaseIndex = timeline.findIndex((event) => getAnalyticsJourneyEventStableKey(event) === canonicalPurchaseKey);
  const trimmedTimeline = purchaseIndex >= 0 ? timeline.slice(0, purchaseIndex + 1) : timeline;

  return trimmedTimeline.map(({ _ts, ...event }) => event);
}

function buildAnalyticsPurchaseSessionGroups(purchase = {}) {
  const availableEvents = Array.isArray(purchase.events) ? purchase.events : [];
  const purchaseTimestamp = new Date(purchase.platformCreatedAt || purchase.createdAt || Date.now()).getTime();
  const fallbackUserKey = String(purchase.userKey || '').trim();
  const maxSessionGapMs = 30 * 60 * 1000;

  const rawEvents = availableEvents
    .map((event) => ({
      ...event,
      _ts: new Date(event.createdAt || event.collectedAt || purchase.platformCreatedAt || purchase.createdAt || 0).getTime(),
      _pagePath: normalizeAnalyticsExportPath(event.pageUrl || ''),
    }))
    .filter((event) => Number.isFinite(event._ts))
    .sort((a, b) => a._ts - b._ts);

  const groups = [];

  rawEvents.forEach((event) => {
    const sessionId = String(event.sessionId || '').trim();
    const userKey = String(event.userKey || fallbackUserKey || '').trim();
    const groupingKey = sessionId || (userKey ? `user:${userKey}` : 'anonymous');
    const previous = groups[groups.length - 1];
    const shouldStartNewGroup = !previous
      || previous.groupingKey !== groupingKey
      || (!sessionId && (event._ts - previous.lastTs) > maxSessionGapMs);

    if (shouldStartNewGroup) {
      groups.push({
        groupingKey,
        sessionId,
        userKey,
        startedTs: event._ts,
        endedTs: event._ts,
        lastTs: event._ts,
        events: [event],
      });
      return;
    }

    previous.events.push(event);
    previous.endedTs = event._ts;
    previous.lastTs = event._ts;
    if (!previous.sessionId && sessionId) previous.sessionId = sessionId;
    if (!previous.userKey && userKey) previous.userKey = userKey;
  });

  const purchaseSignalGroupIndexes = groups.reduce((indexes, group, index) => {
    if (group.events.some((event) => isAnalyticsPurchaseJourneyEventName(event.eventName || ''))) {
      indexes.push(index);
    }
    return indexes;
  }, []);

  const terminalPurchaseGroupIndex = purchaseSignalGroupIndexes.length
    ? purchaseSignalGroupIndexes[purchaseSignalGroupIndexes.length - 1]
    : Math.max(0, groups.length - 1);

  return groups.map((group, index) => {
    const firstEvent = group.events[0] || {};
    const lastEvent = group.events[group.events.length - 1] || {};
    const touchpointEvent = group.events.find((event) => (
      event.fbc || event.gclid || event.ttclid || event.utmSource || event.referrer
    )) || firstEvent;
    const touchpoint = resolveAnalyticsJourneyTouchpoint({ event: touchpointEvent, purchase });
    const entryEvent = group.events.find((event) => event._pagePath && event._pagePath !== '-') || firstEvent;
    const exitEvent = [...group.events].reverse().find((event) => event._pagePath && event._pagePath !== '-') || lastEvent;
    const purchaseEventCount = group.events.filter((event) => isAnalyticsPurchaseJourneyEventName(event.eventName || '')).length;
    const containsPurchase = purchaseEventCount > 0;
    const isTerminalPurchaseGroup = index === terminalPurchaseGroupIndex;
    const containsCheckout = group.events.some((event) => String(event.eventName || '').toLowerCase() === 'begin_checkout');
    const containsCart = group.events.some((event) => String(event.eventName || '').toLowerCase() === 'add_to_cart');
    const containsLogin = group.events.some((event) => /login/.test(String(event.eventName || '').toLowerCase()));

    let actionCopy = 'Browsing and consideration.';
    if (containsPurchase && isTerminalPurchaseGroup) actionCopy = 'Purchase completed in this session.';
    else if (containsPurchase) actionCopy = 'Purchase signal continued into a later session before the final order was confirmed.';
    else if (containsCheckout) actionCopy = 'Reached checkout in this session.';
    else if (containsCart) actionCopy = 'Added product(s) to cart.';
    else if (containsLogin) actionCopy = 'User identified with a login event.';

    const sessionGroup = {
      label: `Session ${index + 1}`,
      sessionId: group.sessionId || null,
      userKey: group.userKey || null,
      sessionIndex: index + 1,
      startedAt: new Date(group.startedTs).toISOString(),
      endedAt: new Date(group.endedTs).toISOString(),
      eventCount: group.events.length,
      purchaseEventCount,
      entryPage: normalizeAnalyticsExportPath(entryEvent.pageUrl || ''),
      exitPage: normalizeAnalyticsExportPath(exitEvent.pageUrl || ''),
      landingPageUrl: entryEvent.pageUrl || null,
      touchpoint,
      actionCopy,
      containsPurchase,
      isTerminalPurchaseGroup,
      purchaseAt: containsPurchase
        ? new Date(group.events[group.events.length - 1]._ts).toISOString()
        : (isTerminalPurchaseGroup && Number.isFinite(purchaseTimestamp) ? new Date(purchaseTimestamp).toISOString() : null),
    };

    sessionGroup.sourceExplanation = buildAnalyticsJourneySessionSentence(sessionGroup);
    return sessionGroup;
  });
}

function resolveAnalyticsPurchaseLandingPage(purchase = {}) {
  const events = Array.isArray(purchase.events) ? purchase.events : [];
  const firstWithPage = events.find((event) => String(event.pageUrl || '').trim());
  return normalizeAnalyticsExportPath(firstWithPage?.pageUrl || purchase.pageUrl || purchase.landingPageUrl || '');
}

function buildAnalyticsExportCandidate(purchase = {}) {
  const sessions = buildAnalyticsPurchaseSessionGroups(purchase);
  const channel = normalizeAnalyticsExportChannelValue(purchase);
  const platform = normalizeAnalyticsExportPlatformValue(
    purchase.attributedPlatform,
    purchase.wooSourceLabel,
    purchase?.orderAttributionSnapshot?.utm_source,
    purchase?.payloadSnapshot?.utm_source,
    channel
  );
  return {
    selectionKey: getAnalyticsPurchaseSelectionKey(purchase),
    orderId: purchase.orderId || null,
    orderNumber: purchase.orderNumber || null,
    checkoutToken: purchase.checkoutToken || null,
    customerName: resolveAnalyticsPurchaseCustomerName(purchase) || 'Customer',
    customerEmail: resolveAnalyticsPurchaseCustomerEmail(purchase) || null,
    revenue: Number(purchase.revenue || 0),
    currency: purchase.currency || 'MXN',
    channel,
    platform,
    channelLabel: humanizeAnalyticsChannel(channel, platform || ''),
    date: purchase.platformCreatedAt || purchase.createdAt || null,
    sessionCount: sessions.length,
    eventCount: Array.isArray(purchase.events) ? purchase.events.length : 0,
  };
}

function filterAnalyticsExportPurchases(purchases = [], { search = '', channel = 'all' } = {}) {
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedChannel = String(channel || 'all').trim().toLowerCase();

  return (Array.isArray(purchases) ? purchases : []).filter((purchase) => {
    const purchaseChannel = normalizeAnalyticsExportChannelValue(purchase);
    if (normalizedChannel && normalizedChannel !== 'all' && purchaseChannel !== normalizedChannel) {
      return false;
    }

    if (!normalizedSearch) return true;

    const haystack = [
      getAnalyticsPurchaseSelectionKey(purchase),
      purchase.orderId,
      purchase.orderNumber,
      purchase.checkoutToken,
      resolveAnalyticsPurchaseCustomerName(purchase),
      resolveAnalyticsPurchaseCustomerEmail(purchase),
      purchase.attributedCampaignLabel,
      purchase.attributedCampaign,
    ]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');

    return haystack.includes(normalizedSearch);
  });
}

function toCsvCell(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (/[",\r\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function formatAnalyticsCsvDecimal(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = toFiniteNumberOrNull(value);
  if (parsed === null) return value;
  return parsed.toFixed(decimals);
}

function buildCsvString(columns = [], rows = []) {
  const header = columns.map((column) => toCsvCell(column)).join(',');
  const lines = [header];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    lines.push(columns.map((column) => toCsvCell(row?.[column])).join(','));
  });

  return `${lines.join('\r\n')}\r\n`;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_) {
    return '';
  }
}

function buildAnalyticsBaseQueryFromInput(input = {}) {
  const query = {};
  if (input.start) query.start = input.start;
  if (input.end) query.end = input.end;
  if (String(input.all_time || input.allTime || '0') === '1' || input.allTime === true) {
    query.all_time = '1';
  }
  if (input.attribution_model || input.attributionModel) {
    query.attribution_model = String(input.attribution_model || input.attributionModel);
  }
  return query;
}

function resolveAnalyticsJourneyLookbackMs(input = {}) {
  const allTime = String(input.all_time || input.allTime || '0') === '1' || input.allTime === true;
  const start = input.start ? new Date(input.start) : null;
  const end = input.end ? new Date(input.end) : null;

  const periodDays = allTime
    ? 365
    : (start && end && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()))
      ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1)
      : 30;

  return Math.max(JOURNEY_STITCH_LOOKBACK_DAYS, Math.min(365, periodDays)) * 24 * 60 * 60 * 1000;
}

function buildAnalyticsInternalOriginalUrl(accountId, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const suffix = params.toString();
  return `/api/analytics/${encodeURIComponent(accountId)}${suffix ? `?${suffix}` : ''}`;
}

async function invokeAnalyticsDashboardPayloadForExport({ accountId, user, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const fakeReq = {
      params: { account_id: accountId },
      query,
      user: user || null,
      headers: {},
      originalUrl: buildAnalyticsInternalOriginalUrl(accountId, query),
    };

    const fakeRes = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400) {
          reject(new Error(payload?.error || 'Analytics export payload failed'));
          return this;
        }
        resolve(payload);
        return this;
      },
    };

    Promise.resolve(getAnalyticsDashboardHandler(fakeReq, fakeRes)).catch(reject);
  });
}

function pushAnalyticsMapArray(map, key, value) {
  const normalized = String(key || '').trim();
  if (!normalized) return;
  if (!map.has(normalized)) map.set(normalized, []);
  map.get(normalized).push(value);
}

function reconcileAnalyticsLineItemsToOrderSubtotal(purchase = {}, items = []) {
  const orderSubtotal = toFiniteNumberOrNull(purchase.subtotal);
  if (!Array.isArray(items) || !items.length || orderSubtotal === null) return Array.isArray(items) ? items : [];

  const normalizedItems = items.map((item) => ({ ...item }));
  const currentSubtotal = normalizedItems.reduce((sum, item) => (
    sum + toFiniteNumber(item.lineTotal ?? item.subtotal ?? 0, 0)
  ), 0);
  const roundedDelta = Number((orderSubtotal - currentSubtotal).toFixed(2));

  if (Math.abs(roundedDelta) < 0.01) return normalizedItems;

  const maxAllowedDelta = Math.max(2, normalizedItems.length * 0.5, Math.abs(orderSubtotal) * 0.02);
  if (Math.abs(roundedDelta) > maxAllowedDelta) return normalizedItems;

  let targetIndex = 0;
  let bestValue = -Infinity;
  normalizedItems.forEach((item, index) => {
    const value = toFiniteNumber(item.lineTotal ?? item.subtotal ?? item.price ?? 0, 0);
    if (value > bestValue) {
      bestValue = value;
      targetIndex = index;
    }
  });

  const target = normalizedItems[targetIndex];
  target.subtotal = Number((toFiniteNumber(target.subtotal ?? target.lineTotal ?? 0, 0) + roundedDelta).toFixed(2));
  target.lineTotal = Number((toFiniteNumber(target.lineTotal ?? target.subtotal ?? 0, 0) + roundedDelta).toFixed(2));
  return normalizedItems;
}

async function buildAnalyticsExportStitchContext({ accountId, purchases = [], journeyStitchLookbackMs, stitchScope = 'strict' } = {}) {
  const selectedPurchases = (Array.isArray(purchases) ? purchases : []).map((purchase) => ({ ...purchase }));
  const effectiveScope = stitchScope === 'full' ? 'full' : 'strict';
  const recentOrderIds = Array.from(new Set(selectedPurchases.map((purchase) => purchase.orderId).filter(Boolean)));

  if (recentOrderIds.length > 0) {
    const resolvingEvents = await prisma.event.findMany({
      where: { accountId, orderId: { in: recentOrderIds } },
      select: { orderId: true, sessionId: true, userKey: true },
      orderBy: { createdAt: 'asc' },
      take: Math.max(500, recentOrderIds.length * 8),
    });

    const sessionByOrder = new Map();
    const userKeyByOrder = new Map();
    for (const ev of resolvingEvents) {
      if (ev.sessionId && !sessionByOrder.has(ev.orderId)) sessionByOrder.set(ev.orderId, ev.sessionId);
      if (ev.userKey && !userKeyByOrder.has(ev.orderId)) userKeyByOrder.set(ev.orderId, ev.userKey);
    }

    for (const purchase of selectedPurchases) {
      if (!purchase.sessionId && sessionByOrder.has(purchase.orderId)) purchase.sessionId = sessionByOrder.get(purchase.orderId);
      if (!purchase.userKey && userKeyByOrder.has(purchase.orderId)) purchase.userKey = userKeyByOrder.get(purchase.orderId);
    }
  }

  const recentCheckoutTokens = Array.from(new Set(selectedPurchases.map((purchase) => purchase.checkoutToken).filter(Boolean)));
  let recentSessionIds = Array.from(new Set(selectedPurchases.map((purchase) => purchase.sessionId).filter(Boolean)));
  let recentUserKeys = Array.from(new Set(selectedPurchases.map((purchase) => purchase.userKey).filter(Boolean)));
  const recentCustomerIds = Array.from(new Set(selectedPurchases.map((purchase) => purchase.customerId).filter(Boolean)));
  const recentEmailHashes = Array.from(new Set(selectedPurchases.map((purchase) => purchase.emailHash).filter(Boolean)));
  const recentPhoneHashes = Array.from(new Set(selectedPurchases.map((purchase) => purchase.phoneHash).filter(Boolean)));
  const recentFingerprintHashes = Array.from(new Set(selectedPurchases.map((purchase) => purchase.browserFingerprintHash).filter(Boolean)));

  const recentConversionTimes = selectedPurchases
    .map((purchase) => new Date(purchase.createdAt || purchase.platformCreatedAt || 0).getTime())
    .filter((timestamp) => Number.isFinite(timestamp));

  if (recentConversionTimes.length && effectiveScope === 'full') {
    const earliestTs = Math.min(...recentConversionTimes) - journeyStitchLookbackMs;
    const latestTs = Math.max(...recentConversionTimes) + (60 * 60 * 1000);
    const identityClauses = buildIdentityOrClauses({
      userKeys: recentUserKeys,
      customerIds: recentCustomerIds,
      emailHashes: recentEmailHashes,
      phoneHashes: recentPhoneHashes,
      fingerprintHashes: recentFingerprintHashes,
    });

    if (identityClauses.length) {
      const identityRowsForJourney = await prisma.identityGraph.findMany({
        where: {
          accountId,
          OR: identityClauses,
        },
        select: {
          userKey: true,
          fingerprintHash: true,
        },
        take: 4000,
      });

      const graphUserKeys = identityRowsForJourney.map((row) => row.userKey).filter(Boolean);
      recentUserKeys = Array.from(new Set([...recentUserKeys, ...graphUserKeys]));

      if (recentUserKeys.length) {
        const sessionsByIdentity = await prisma.session.findMany({
          where: {
            accountId,
            userKey: { in: recentUserKeys },
            startedAt: {
              gte: new Date(earliestTs),
              lte: new Date(latestTs),
            },
          },
          select: {
            sessionId: true,
          },
          take: 4000,
        });
        const graphSessionIds = sessionsByIdentity.map((row) => row.sessionId).filter(Boolean);
        recentSessionIds = Array.from(new Set([...recentSessionIds, ...graphSessionIds]));
      }
    }
  }

  const journeyEventOrFilters = [];
  if (recentOrderIds.length) journeyEventOrFilters.push({ orderId: { in: recentOrderIds } });
  if (recentCheckoutTokens.length) journeyEventOrFilters.push({ checkoutToken: { in: recentCheckoutTokens } });
  if (recentSessionIds.length) journeyEventOrFilters.push({ sessionId: { in: recentSessionIds } });
  if (effectiveScope === 'full' && recentUserKeys.length) journeyEventOrFilters.push({ userKey: { in: recentUserKeys } });

  const eventsByOrderId = new Map();
  const eventsByCheckoutToken = new Map();
  const eventsBySessionId = new Map();
  const eventsByUserKey = new Map();
  const eventsByCustomerId = new Map();

  if (journeyEventOrFilters.length && recentConversionTimes.length) {
    const earliestTs = effectiveScope === 'full'
      ? (Math.min(...recentConversionTimes) - journeyStitchLookbackMs)
      : (Math.min(...recentConversionTimes) - EXPORT_STRICT_LOOKBACK_MS);
    const latestTs = effectiveScope === 'full'
      ? (Math.max(...recentConversionTimes) + (60 * 60 * 1000))
      : (Math.max(...recentConversionTimes) + EXPORT_STRICT_FORWARD_MS);
    const stitchedCandidateEvents = await prisma.event.findMany({
      where: {
        accountId,
        createdAt: {
          gte: new Date(earliestTs),
          lte: new Date(latestTs),
        },
        OR: journeyEventOrFilters,
      },
      select: ANALYTICS_JOURNEY_EVENT_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 20000,
    });

    for (const ev of stitchedCandidateEvents) {
      const evTs = new Date(ev.createdAt).getTime();
      if (!Number.isFinite(evTs)) continue;
      ev._evTs = evTs;
      pushAnalyticsMapArray(eventsByOrderId, ev.orderId, ev);
      pushAnalyticsMapArray(eventsByCheckoutToken, ev.checkoutToken, ev);
      pushAnalyticsMapArray(eventsBySessionId, ev.sessionId, ev);
      pushAnalyticsMapArray(eventsByUserKey, ev.userKey, ev);

      const eventIdentity = extractEventIdentity(ev.rawPayload || {});
      if (eventIdentity.customerId) {
        pushAnalyticsMapArray(eventsByCustomerId, eventIdentity.customerId, ev);
      }
    }
  }

  const detailedFilters = [];
  if (recentOrderIds.length) detailedFilters.push({ orderId: { in: recentOrderIds } });
  if (recentCheckoutTokens.length) detailedFilters.push({ checkoutToken: { in: recentCheckoutTokens } });

  const detailedPurchases = detailedFilters.length
    ? await prisma.event.findMany({
        where: {
          accountId,
          eventName: { in: PURCHASE_ALIASES },
          OR: detailedFilters,
        },
        select: {
          createdAt: true,
          orderId: true,
          checkoutToken: true,
          items: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Math.max(500, selectedPurchases.length * 6),
      })
    : [];

  const purchaseDetailsByOrderId = new Map();
  const purchaseDetailsByCheckoutToken = new Map();
  detailedPurchases.forEach((detail) => {
    pushAnalyticsMapArray(purchaseDetailsByOrderId, detail.orderId, detail);
    pushAnalyticsMapArray(purchaseDetailsByCheckoutToken, detail.checkoutToken, detail);
  });

  return {
    purchases: selectedPurchases,
    eventsByOrderId,
    eventsByCheckoutToken,
    eventsBySessionId,
    eventsByUserKey,
    eventsByCustomerId,
    purchaseDetailsByOrderId,
    purchaseDetailsByCheckoutToken,
  };
}

function resolveAnalyticsDetailedPurchaseItems(purchase = {}, stitchContext = {}) {
  const directItems = normalizeLineItems(purchase.items);
  if (directItems.length) {
    return reconcileAnalyticsLineItemsToOrderSubtotal(purchase, directItems);
  }

  const candidates = [
    ...(stitchContext.purchaseDetailsByOrderId?.get(String(purchase.orderId || '')) || []),
    ...(stitchContext.purchaseDetailsByCheckoutToken?.get(String(purchase.checkoutToken || '')) || []),
  ];

  if (!candidates.length) return reconcileAnalyticsLineItemsToOrderSubtotal(purchase, directItems);

  const purchaseTs = new Date(purchase.platformCreatedAt || purchase.createdAt || 0).getTime();
  const detail = [...candidates]
    .filter((candidate) => Array.isArray(candidate.items) && candidate.items.length)
    .sort((a, b) => {
      const deltaA = Math.abs(new Date(a.createdAt || 0).getTime() - purchaseTs);
      const deltaB = Math.abs(new Date(b.createdAt || 0).getTime() - purchaseTs);
      return deltaA - deltaB;
    })[0];

  const resolvedItems = detail ? normalizeLineItems(detail.items) : directItems;
  return reconcileAnalyticsLineItemsToOrderSubtotal(purchase, resolvedItems);
}

async function buildAnalyticsStitchedEventsForExportPurchase({ accountId, purchase, stitchContext = {}, journeyStitchLookbackMs, stitchScope = 'strict' } = {}) {
  const purchaseTimestamp = new Date(purchase.createdAt || purchase.platformCreatedAt || 0).getTime();
  if (!Number.isFinite(purchaseTimestamp)) {
    return Array.isArray(purchase.events) ? purchase.events : [];
  }

  const effectiveScope = stitchScope === 'full' ? 'full' : 'strict';

  const earliestTs = effectiveScope === 'full'
    ? (purchaseTimestamp - journeyStitchLookbackMs)
    : (purchaseTimestamp - EXPORT_STRICT_LOOKBACK_MS);
  const latestTs = effectiveScope === 'full'
    ? (purchaseTimestamp + (15 * 60 * 1000))
    : (purchaseTimestamp + EXPORT_STRICT_FORWARD_MS);
  const purchaseEventCandidates = [
    ...(stitchContext.eventsByOrderId?.get(String(purchase.orderId || '')) || []),
    ...(stitchContext.eventsByCheckoutToken?.get(String(purchase.checkoutToken || '')) || []),
  ];

  const inferredSessionId = purchase.sessionId || purchaseEventCandidates.find((event) => event.sessionId)?.sessionId;
  const inferredUserKey = purchase.userKey || purchaseEventCandidates.find((event) => event.userKey)?.userKey;

  const rawStitched = [
    ...(stitchContext.eventsByOrderId?.get(String(purchase.orderId || '')) || []),
    ...(stitchContext.eventsByCheckoutToken?.get(String(purchase.checkoutToken || '')) || []),
    ...(inferredSessionId ? (stitchContext.eventsBySessionId?.get(String(inferredSessionId)) || []) : []),
    ...(effectiveScope === 'full' && inferredUserKey ? (stitchContext.eventsByUserKey?.get(String(inferredUserKey)) || []) : []),
    ...(effectiveScope === 'full' && purchase.customerId ? (stitchContext.eventsByCustomerId?.get(String(purchase.customerId)) || []) : []),
  ];

  const uniqueEventsMap = new Map();
  for (const event of rawStitched) {
    const eventTs = Number(event._evTs || new Date(event.createdAt || 0).getTime());
    if (!Number.isFinite(eventTs) || eventTs < earliestTs || eventTs > latestTs) continue;
    const stableKey = getAnalyticsJourneyEventStableKey(event);
    if (!uniqueEventsMap.has(stableKey)) uniqueEventsMap.set(stableKey, event);
  }

  let stitchedEvents = Array.from(uniqueEventsMap.values())
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

  if (effectiveScope === 'full' && stitchedEvents.length <= 2 && purchase.customerId) {
    try {
      const customerLinkedEvents = await prisma.event.findMany({
        where: {
          accountId,
          createdAt: {
            gte: new Date(earliestTs),
            lte: new Date(latestTs),
          },
          OR: [
            { rawPayload: { path: ['customer_id'], equals: String(purchase.customerId) } },
            { rawPayload: { path: ['customerId'], equals: String(purchase.customerId) } },
          ],
        },
        select: ANALYTICS_JOURNEY_EVENT_SELECT,
        orderBy: { createdAt: 'asc' },
        take: 500,
      });

      customerLinkedEvents.forEach((event) => {
        const stableKey = getAnalyticsJourneyEventStableKey(event);
        if (!uniqueEventsMap.has(stableKey)) uniqueEventsMap.set(stableKey, event);
      });

      stitchedEvents = Array.from(uniqueEventsMap.values())
        .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    } catch (_) {
      // Keep the primary stitched timeline if JSON-path lookup is unavailable.
    }
  }

  return stitchedEvents.map((event) => mapAnalyticsJourneyEventRecord(event));
}

function normalizeAnalyticsExportChannelValue(purchase = {}) {
  const normalized = normalizeChannelForStats(purchase.attributedChannel || '', purchase.attributedPlatform || purchase.wooSourceLabel || '');
  const platform = normalizeAnalyticsExportPlatformValue(
    purchase.attributedPlatform,
    purchase.wooSourceLabel,
    purchase?.orderAttributionSnapshot?.utm_source,
    purchase?.payloadSnapshot?.utm_source
  );
  const wooSourceType = normalizeAttributionToken(purchase.wooSourceType || '');
  const hasPaidSignal = Boolean(
    sanitizeAnalyticsMarketingValue(purchase.attributedCampaign)
    || sanitizeAnalyticsMarketingValue(purchase.attributedCampaignLabel)
    || sanitizeAnalyticsMarketingValue(purchase.attributedAdset)
    || sanitizeAnalyticsMarketingValue(purchase.attributedAdsetLabel)
    || sanitizeAnalyticsMarketingValue(purchase.attributedAd)
    || sanitizeAnalyticsMarketingValue(purchase.attributedAdLabel)
    || sanitizeAnalyticsMarketingValue(purchase.attributedClickId)
  );

  if (!hasPaidSignal && wooSourceType === 'organic') return 'organic';
  if (!hasPaidSignal && normalized === 'google' && platform === 'google' && includesAny(purchase.wooSourceLabel || '', ['organic', 'orgánico'])) {
    return 'organic';
  }

  return normalized || 'other';
}

async function prepareAnalyticsPurchasesForExport({ accountId, purchases = [], query = {} } = {}) {
  const journeyStitchLookbackMs = resolveAnalyticsJourneyLookbackMs(query);
  const stitchScope = resolveAnalyticsExportStitchScope(query);
  const stitchContext = await buildAnalyticsExportStitchContext({
    accountId,
    purchases,
    journeyStitchLookbackMs,
    stitchScope,
  });

  const preparedPurchases = await Promise.all((stitchContext.purchases || []).map(async (purchase) => {
    const fullEvents = await buildAnalyticsStitchedEventsForExportPurchase({
      accountId,
      purchase,
      stitchContext,
      journeyStitchLookbackMs,
      stitchScope,
    });

    const eventsForExport = fullEvents.length
      ? fullEvents
      : (stitchScope === 'full' ? (Array.isArray(purchase.events) ? purchase.events : []) : []);

    const exportChannel = normalizeAnalyticsExportChannelValue(purchase);
    const exportPlatform = normalizeAnalyticsExportPlatformValue(
      purchase.attributedPlatform,
      purchase.wooSourceLabel,
      purchase?.orderAttributionSnapshot?.utm_source,
      purchase?.payloadSnapshot?.utm_source,
      exportChannel
    );

    const exportReadyPurchase = {
      ...purchase,
      items: resolveAnalyticsDetailedPurchaseItems(purchase, stitchContext),
      events: finalizeAnalyticsExportEvents(eventsForExport, purchase),
      attributedChannel: exportChannel,
      attributedPlatform: exportPlatform,
      attributedCampaign: sanitizeAnalyticsMarketingValue(purchase.attributedCampaign || ''),
      attributedCampaignLabel: sanitizeAnalyticsMarketingValue(purchase.attributedCampaignLabel || ''),
      attributedAdset: sanitizeAnalyticsMarketingValue(purchase.attributedAdset || ''),
      attributedAdsetLabel: sanitizeAnalyticsMarketingValue(purchase.attributedAdsetLabel || ''),
      attributedAd: sanitizeAnalyticsMarketingValue(purchase.attributedAd || ''),
      attributedAdLabel: sanitizeAnalyticsMarketingValue(purchase.attributedAdLabel || ''),
      attributedClickId: String(purchase.attributedClickId || '').trim() || null,
      attributionDebug: {
        ...(purchase.attributionDebug || {}),
        exportStitchScope: stitchScope,
        resolvedAttributionLabel: resolveAnalyticsExportResolvedAttributionLabel({
          ...purchase,
          attributedChannel: exportChannel,
          attributedPlatform: exportPlatform,
        }),
      },
    };

    return exportReadyPurchase;
  }));

  return preparedPurchases;
}

async function buildAnalyticsExportRows({ accountId, purchases = [], query = {} } = {}) {
  const ordersRows = [];
  const sessionsRows = [];
  const eventsRows = [];
  const itemsRows = [];

  const exportPurchases = await prepareAnalyticsPurchasesForExport({ accountId, purchases, query });

  (Array.isArray(exportPurchases) ? exportPurchases : []).forEach((purchase) => {
    const selectionKey = getAnalyticsPurchaseSelectionKey(purchase);
    const sessionGroups = buildAnalyticsPurchaseSessionGroups(purchase);
    const customerName = resolveAnalyticsPurchaseCustomerName(purchase);
    const customerEmail = resolveAnalyticsPurchaseCustomerEmail(purchase);
    const deliveryStatus = normalizeObject(purchase.deliveryStatus);
    const metaStatus = normalizeObject(deliveryStatus.meta);
    const googleStatus = normalizeObject(deliveryStatus.google);
    const tiktokStatus = normalizeObject(deliveryStatus.tiktok);

    ordersRows.push({
      selection_key: selectionKey,
      shop: accountId,
      account_id: accountId,
      source: purchase.source || null,
      order_id: purchase.orderId || null,
      order_number: purchase.orderNumber || null,
      checkout_token: purchase.checkoutToken || null,
      platform_created_at: purchase.platformCreatedAt || purchase.createdAt || null,
      stored_at: purchase.storedAt || purchase.createdAt || null,
      revenue: formatAnalyticsCsvDecimal(purchase.revenue ?? 0),
      currency: purchase.currency || 'MXN',
      subtotal: formatAnalyticsCsvDecimal(purchase.subtotal ?? null),
      discount_total: formatAnalyticsCsvDecimal(purchase.discountTotal ?? null),
      shipping_total: formatAnalyticsCsvDecimal(purchase.shippingTotal ?? null),
      tax_total: formatAnalyticsCsvDecimal(purchase.taxTotal ?? null),
      refund_amount: formatAnalyticsCsvDecimal(purchase.refundAmount ?? null),
      chargeback_flag: purchase.chargebackFlag ?? null,
      customer_id: purchase.customerId || null,
      customer_name: customerName || null,
      customer_email_resolved: customerEmail || null,
      email_hash: purchase.emailHash || null,
      phone_hash: purchase.phoneHash || null,
      user_key: purchase.userKey || null,
      session_id: purchase.sessionId || null,
      orders_count: purchase.ordersCount ?? null,
      attributed_channel: purchase.attributedChannel || null,
      attributed_platform: purchase.attributedPlatform || null,
      attributed_campaign: purchase.attributedCampaign || null,
      attributed_campaign_label: purchase.attributedCampaignLabel || null,
      attributed_adset: purchase.attributedAdset || null,
      attributed_adset_label: purchase.attributedAdsetLabel || null,
      attributed_ad: purchase.attributedAd || null,
      attributed_ad_label: purchase.attributedAdLabel || null,
      attributed_click_id: purchase.attributedClickId || null,
      attribution_model: purchase.attributionModel || null,
      attribution_confidence: purchase.attributionConfidence ?? null,
      attribution_source: purchase.attributionSource || null,
      resolved_attribution_label: purchase?.attributionDebug?.resolvedAttributionLabel || null,
      woo_source_label: purchase.wooSourceLabel || null,
      woo_source_type: purchase.wooSourceType || null,
      landing_page: resolveAnalyticsPurchaseLandingPage(purchase),
      stitched_session_count: sessionGroups.length,
      stitched_event_count: Array.isArray(purchase.events) ? purchase.events.length : 0,
      meta_status: metaStatus.status || null,
      meta_reason: metaStatus.reason || null,
      google_status: googleStatus.status || null,
      google_reason: googleStatus.reason || null,
      tiktok_status: tiktokStatus.status || null,
      tiktok_reason: tiktokStatus.reason || null,
      delivery_status_json: safeJsonStringify(purchase.deliveryStatus || null),
      attribution_snapshot_json: safeJsonStringify(purchase.orderAttributionSnapshot || purchase.payloadSnapshot || null),
    });

    sessionGroups.forEach((group) => {
      sessionsRows.push({
        selection_key: selectionKey,
        order_id: purchase.orderId || null,
        order_number: purchase.orderNumber || null,
        session_id: group.sessionId || null,
        session_index: group.sessionIndex,
        started_at_inferred: group.startedAt || null,
        ended_at_inferred: group.endedAt || null,
        event_count: group.eventCount,
        purchase_event_count: group.purchaseEventCount,
        entry_page: group.entryPage || null,
        exit_page: group.exitPage || null,
        landing_page_url: group.landingPageUrl || null,
        utm_source: group.touchpoint?.utmSource || null,
        utm_medium: group.touchpoint?.utmMedium || null,
        utm_campaign: sanitizeAnalyticsMarketingValue(group.touchpoint?.utmCampaign) || null,
        utm_content: sanitizeAnalyticsMarketingValue(group.touchpoint?.utmContent) || null,
        utm_term: sanitizeAnalyticsMarketingValue(group.touchpoint?.utmTerm) || null,
        ga4_session_source: group.touchpoint?.ga4SessionSource || null,
        referrer: group.touchpoint?.referrerLabel || null,
        gclid: group.touchpoint?.gclid || null,
        fbp: group.touchpoint?.fbp || null,
        fbc: group.touchpoint?.fbc || null,
        ttclid: group.touchpoint?.ttclid || null,
        source_explanation: group.sourceExplanation || null,
      });
    });

    const events = Array.isArray(purchase.events) ? purchase.events : [];
    events.forEach((event, index) => {
      eventsRows.push({
        selection_key: selectionKey,
        order_id: purchase.orderId || null,
        order_number: purchase.orderNumber || null,
        session_id: event.sessionId || null,
        event_index: index + 1,
        event_id: event.eventId || null,
        event_name: event.eventName || null,
        event_bucket: resolveEventBucket(event.eventName || ''),
        created_at: event.createdAt || null,
        collected_at: event.collectedAt || null,
        browser_received_at: event.browserReceivedAt || null,
        server_received_at: event.serverReceivedAt || null,
        page_url: event.pageUrl || null,
        page_type: event.pageType || null,
        product_id: event.productId || null,
        variant_id: event.variantId || null,
        product_name: event.productName || null,
        item_id: event.itemId || null,
        cart_id: event.cartId || null,
        cart_value: formatAnalyticsCsvDecimal(event.cartValue ?? null),
        revenue: formatAnalyticsCsvDecimal(event.revenue ?? null),
        currency: event.currency || null,
        raw_source: event.rawSource || null,
        match_type: event.matchType || null,
        confidence_score: event.confidenceScore ?? null,
        utm_source: event.utmSource || null,
        utm_medium: event.utmMedium || null,
        utm_campaign: event.utmCampaign || null,
        utm_content: event.utmContent || null,
        utm_term: event.utmTerm || null,
        ga4_session_source: event.ga4SessionSource || null,
        utm_entry_url: event.utmEntryUrl || null,
        utm_session_history_json: safeJsonStringify(event.utmSessionHistory || null),
        utm_browser_history_json: safeJsonStringify(event.utmBrowserHistory || null),
        fbclid: event.fbclid || null,
        gclid: event.gclid || null,
        wbraid: event.wbraid || null,
        gbraid: event.gbraid || null,
        msclkid: event.msclkid || null,
        fbp: event.fbp || null,
        fbc: event.fbc || null,
        ttclid: event.ttclid || null,
        click_id: event.clickId || null,
        customer_email: event.customerEmail || customerEmail || null,
        client_ip: event.clientIp || null,
        ip_hash: event.ipHash || null,
        user_agent: event.userAgent || null,
      });
    });

    const items = Array.isArray(purchase.items) ? purchase.items : [];
    items.forEach((item, index) => {
      itemsRows.push({
        selection_key: selectionKey,
        order_id: purchase.orderId || null,
        order_number: purchase.orderNumber || null,
        item_index: index + 1,
        product_id: item.productId || item.id || null,
        variant_id: item.variantId || null,
        sku: item.sku || null,
        name: item.name || null,
        quantity: item.quantity ?? null,
        price: formatAnalyticsCsvDecimal(item.price ?? null),
        subtotal: formatAnalyticsCsvDecimal(item.subtotal ?? null),
        total: formatAnalyticsCsvDecimal(item.lineTotal ?? null),
        currency: item.currency || purchase.currency || 'MXN',
        raw_item_json: safeJsonStringify(item.rawItem || item),
      });
    });
  });

  return { ordersRows, sessionsRows, eventsRows, itemsRows };
}

const EXPORT_ORDERS_COLUMNS = [
  'selection_key', 'shop', 'account_id', 'source', 'order_id', 'order_number', 'checkout_token',
  'platform_created_at', 'stored_at', 'revenue', 'currency', 'subtotal', 'discount_total',
  'shipping_total', 'tax_total', 'refund_amount', 'chargeback_flag', 'customer_id', 'customer_name',
  'customer_email_resolved', 'email_hash', 'phone_hash', 'user_key', 'session_id', 'orders_count',
  'attributed_channel', 'attributed_platform', 'attributed_campaign', 'attributed_campaign_label',
  'attributed_adset', 'attributed_adset_label', 'attributed_ad', 'attributed_ad_label',
  'attributed_click_id', 'attribution_model', 'attribution_confidence', 'attribution_source',
  'resolved_attribution_label', 'woo_source_label', 'woo_source_type', 'landing_page',
  'stitched_session_count', 'stitched_event_count', 'meta_status', 'meta_reason', 'google_status',
  'google_reason', 'tiktok_status', 'tiktok_reason', 'delivery_status_json', 'attribution_snapshot_json',
];

const EXPORT_SESSIONS_COLUMNS = [
  'selection_key', 'order_id', 'order_number', 'session_id', 'session_index', 'started_at_inferred',
  'ended_at_inferred', 'event_count', 'purchase_event_count', 'entry_page', 'exit_page',
  'landing_page_url', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ga4_session_source', 'referrer', 'gclid', 'fbp', 'fbc', 'ttclid', 'source_explanation',
];

const EXPORT_EVENTS_COLUMNS = [
  'selection_key', 'order_id', 'order_number', 'session_id', 'event_index', 'event_id', 'event_name',
  'event_bucket', 'created_at', 'collected_at', 'browser_received_at', 'server_received_at', 'page_url',
  'page_type', 'product_id', 'variant_id', 'product_name', 'item_id', 'cart_id', 'cart_value',
  'revenue', 'currency', 'raw_source', 'match_type', 'confidence_score', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_content', 'utm_term', 'ga4_session_source', 'utm_entry_url',
  'utm_session_history_json', 'utm_browser_history_json', 'fbclid', 'gclid', 'wbraid', 'gbraid', 'msclkid', 'fbp', 'fbc', 'ttclid', 'click_id',
  'customer_email', 'client_ip', 'ip_hash', 'user_agent',
];

const EXPORT_ITEMS_COLUMNS = [
  'selection_key', 'order_id', 'order_number', 'item_index', 'product_id', 'variant_id', 'sku',
  'name', 'quantity', 'price', 'subtotal', 'total', 'currency', 'raw_item_json',
];

router.get('/:account_id/export/candidates', async (req, res) => {
  try {
    const { account_id } = req.params;
    const search = String(req.query.search || '').trim();
    const channel = String(req.query.channel || 'all').trim();
    const offset = Math.max(0, Number.parseInt(String(req.query.offset || '0'), 10) || 0);
    const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || EXPORT_PREVIEW_PAGE_SIZE), 10) || EXPORT_PREVIEW_PAGE_SIZE));
    const analyticsQuery = {
      ...buildAnalyticsBaseQueryFromInput(req.query),
      recent_limit: String(EXPORT_MAX_RECENT_PURCHASES),
    };

    const payload = await invokeAnalyticsDashboardPayloadForExport({
      accountId: account_id,
      user: req.user,
      query: analyticsQuery,
    });

    const filtered = filterAnalyticsExportPurchases(payload?.recentPurchases || [], { search, channel });
    const items = filtered.slice(offset, offset + limit).map((purchase) => buildAnalyticsExportCandidate(purchase));

    return res.json({
      ok: true,
      total: filtered.length,
      offset,
      limit,
      items,
    });
  } catch (error) {
    console.error('[Analytics Export] Candidates error:', error);
    return res.status(500).json({ ok: false, error: 'Failed to load export candidates' });
  }
});

router.post('/:account_id/export/download', async (req, res) => {
  try {
    const { account_id } = req.params;
    const selectionKeys = Array.isArray(req.body?.selectionKeys)
      ? req.body.selectionKeys.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const include = normalizeObject(req.body?.include);
    const format = String(req.body?.format || 'csv_zip').trim().toLowerCase();

    if (format !== 'csv_zip') {
      return res.status(400).json({ ok: false, error: 'Unsupported export format' });
    }

    if (!selectionKeys.length) {
      return res.status(400).json({ ok: false, error: 'At least one selection key is required' });
    }

    if (selectionKeys.length > EXPORT_MAX_SELECTIONS) {
      return res.status(400).json({
        ok: false,
        error: `You can export up to ${EXPORT_MAX_SELECTIONS} journeys at a time`,
      });
    }

    const analyticsQuery = {
      ...buildAnalyticsBaseQueryFromInput(req.body || {}),
      recent_limit: String(EXPORT_MAX_RECENT_PURCHASES),
      stitch_scope: resolveAnalyticsExportStitchScope(req.body || {}),
    };

    const payload = await invokeAnalyticsDashboardPayloadForExport({
      accountId: account_id,
      user: req.user,
      query: analyticsQuery,
    });

    const purchaseMap = new Map(
      (Array.isArray(payload?.recentPurchases) ? payload.recentPurchases : []).map((purchase) => [
        getAnalyticsPurchaseSelectionKey(purchase),
        purchase,
      ])
    );

    const missing = selectionKeys.filter((key) => !purchaseMap.has(key));
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: 'Some selected journeys are no longer available in the current filtered window',
        missingSelectionKeys: missing,
      });
    }

    const selectedPurchases = selectionKeys.map((key) => purchaseMap.get(key)).filter(Boolean);
    const { ordersRows, sessionsRows, eventsRows, itemsRows } = await buildAnalyticsExportRows({
      accountId: account_id,
      purchases: selectedPurchases,
      query: analyticsQuery,
    });

    const includeOrders = include.orders !== false;
    const includeSessions = include.sessions !== false;
    const includeEvents = include.events !== false;
    const includeItems = include.items !== false;
    const filename = `adray-attribution-export-${account_id}-${new Date().toISOString().slice(0, 10)}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (error) => {
      console.error('[Analytics Export] ZIP error:', error);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'Failed to generate export ZIP' });
        return;
      }
      res.destroy(error);
    });

    archive.pipe(res);

    if (includeOrders) archive.append(buildCsvString(EXPORT_ORDERS_COLUMNS, ordersRows), { name: 'orders.csv' });
    if (includeSessions) archive.append(buildCsvString(EXPORT_SESSIONS_COLUMNS, sessionsRows), { name: 'sessions.csv' });
    if (includeEvents) archive.append(buildCsvString(EXPORT_EVENTS_COLUMNS, eventsRows), { name: 'events.csv' });
    if (includeItems) archive.append(buildCsvString(EXPORT_ITEMS_COLUMNS, itemsRows), { name: 'items.csv' });

    await archive.finalize();
  } catch (error) {
    console.error('[Analytics Export] Download error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: 'Failed to download export' });
    }
    res.destroy(error);
  }
});

function collectUniqueStrings(values = []) {
  const invalidTokens = new Set(['unknown', 'null', 'undefined', 'n/a', 'none', '-']);
  return Array.from(new Set(
    values
      .map((value) => String(value || '').trim())
      .filter((value) => value && !invalidTokens.has(value.toLowerCase()))
  ));
}

function normalizeCustomerDisplayName(value) {
  const invalidTokens = new Set(['unknown', 'undefined', 'null', 'n/a', 'none', '-']);
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (invalidTokens.has(normalized.toLowerCase())) return null;
  if (/^\d+$/.test(normalized)) return null;
  return normalized;
}

function firstTruthyString(candidates = []) {
  for (const value of candidates) {
    const normalized = normalizeCustomerDisplayName(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeEmailPreview(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['unknown', 'undefined', 'null', 'n/a', 'none', '-'].includes(normalized)) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function normalizeWooCustomerId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (['unknown', 'undefined', 'null', 'n/a', 'none', '-'].includes(normalized.toLowerCase())) return null;
  return normalized;
}

function extractOrderCustomerDisplayName(attributionSnapshot) {
  const snapshot = attributionSnapshot && typeof attributionSnapshot === 'object'
    ? attributionSnapshot
    : {};

  const customer = snapshot.customer && typeof snapshot.customer === 'object' ? snapshot.customer : {};
  const billing = snapshot.billing && typeof snapshot.billing === 'object' ? snapshot.billing : {};
  const shipping = snapshot.shipping && typeof snapshot.shipping === 'object' ? snapshot.shipping : {};

  return firstTruthyString([
    snapshot.customer_name,
    snapshot.customer_display_name,
    snapshot.display_name,
    snapshot.customerName,
    snapshot.customerDisplayName,
    snapshot.displayName,
    [snapshot.customer_first_name, snapshot.customer_last_name].filter(Boolean).join(' '),
    [snapshot.customerFirstName, snapshot.customerLastName].filter(Boolean).join(' '),
    [snapshot.billing_first_name, snapshot.billing_last_name].filter(Boolean).join(' '),
    [snapshot.billingFirstName, snapshot.billingLastName].filter(Boolean).join(' '),
    [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    [customer.firstName, customer.lastName].filter(Boolean).join(' '),
    customer.name,
    customer.display_name,
    customer.displayName,
    [billing.first_name, billing.last_name].filter(Boolean).join(' '),
    [billing.firstName, billing.lastName].filter(Boolean).join(' '),
    billing.company,
    [shipping.first_name, shipping.last_name].filter(Boolean).join(' '),
    [shipping.firstName, shipping.lastName].filter(Boolean).join(' '),
    shipping.company,
    snapshot.billing_company,
    snapshot.billingCompany,
  ]);
}

function extractOrderCustomerEmailPreview(attributionSnapshot) {
  const snapshot = attributionSnapshot && typeof attributionSnapshot === 'object'
    ? attributionSnapshot
    : {};

  const customer = snapshot.customer && typeof snapshot.customer === 'object' ? snapshot.customer : {};
  const billing = snapshot.billing && typeof snapshot.billing === 'object' ? snapshot.billing : {};

  return normalizeEmailPreview(
    snapshot.customer_email
    || snapshot.customerEmail
    || snapshot.email
    || snapshot.user_email
    || snapshot.userEmail
    || snapshot.billing_email
    || snapshot.billingEmail
    || customer.email
    || customer.customer_email
    || customer.customerEmail
    || billing.email
  );
}

function extractOrderCustomerId(attributionSnapshot) {
  const snapshot = attributionSnapshot && typeof attributionSnapshot === 'object'
    ? attributionSnapshot
    : {};
  const customer = snapshot.customer && typeof snapshot.customer === 'object' ? snapshot.customer : {};

  return normalizeWooCustomerId(
    snapshot.customer_id
    || snapshot.customerId
    || customer.id
    || customer.customer_id
    || customer.customerId
  );
}

function normalizeBrowserId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function hashBrowserId(value) {
  const normalized = normalizeBrowserId(value);
  return normalized ? hashPII(`browser:${normalized}`) : null;
}

function extractEventIdentity(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object'
    ? rawPayload
    : {};

  const customer = payload.customer && typeof payload.customer === 'object' ? payload.customer : {};
  const billing = payload.billing && typeof payload.billing === 'object' ? payload.billing : {};
  const userData = payload.user_data && typeof payload.user_data === 'object' ? payload.user_data : {};

  const emailCandidate = payload.email || payload.customer_email || billing.email || customer.email || userData.email || '';
    const email = String(emailCandidate).trim().toLowerCase();
    const phoneCandidate = payload.phone || payload.customer_phone || billing.phone || customer.phone || userData.phone || '';
    const phone = String(phoneCandidate).trim();

  return {
    customerId: normalizeWooCustomerId(
      payload.customer_id
      || payload.customerId
      || customer.id
      || customer.customer_id
      || customer.customerId
      || userData.customer_id
      || userData.customerId
    ),
    emailHash: email ? hashPII(email) : null,
    phoneHash: phone ? hashPII(phone) : null,
    browserFingerprintHash: hashBrowserId(payload.browser_id || payload.visitor_id || payload.browserId || payload.visitorId),
    emailPreview: email || null,
    phonePreview: phone || null,
    customerDisplayName: firstTruthyString([
      payload.customer_name,
      payload.customer_display_name,
      payload.customerName,
      payload.customerDisplayName,
      payload.display_name,
      payload.displayName,
      [payload.customer_first_name, payload.customer_last_name].filter(Boolean).join(' '),
      [payload.customerFirstName, payload.customerLastName].filter(Boolean).join(' '),
      [payload.first_name, payload.last_name].filter(Boolean).join(' '),
      [payload.firstName, payload.lastName].filter(Boolean).join(' '),
      [customer.first_name, customer.last_name].filter(Boolean).join(' '),
      [customer.firstName, customer.lastName].filter(Boolean).join(' '),
      customer.name,
      customer.display_name,
      customer.displayName,
      [billing.first_name, billing.last_name].filter(Boolean).join(' '),
      [billing.firstName, billing.lastName].filter(Boolean).join(' '),
      billing.company,
      payload.billing_company,
      payload.billingCompany,
    ]),
  };
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function extractOrderDeliveryStatus(order = {}) {
  const snapshot = normalizeObject(order?.attributionSnapshot);
  const fallbackStatus = normalizeObject(snapshot.deliveryStatus);

  const buildStatus = (platform) => {
    const lowerPlatform = String(platform || '').trim().toLowerCase();
    const sentField =
      lowerPlatform === 'meta' ? Boolean(order?.capiSentMeta)
        : lowerPlatform === 'google' ? Boolean(order?.capiSentGoogle)
          : Boolean(order?.capiSentTiktok);
    const responseField =
      lowerPlatform === 'meta' ? normalizeObject(order?.capiMetaResponse)
        : lowerPlatform === 'google' ? normalizeObject(order?.capiGoogleResponse)
          : {};
    const fallbackField = normalizeObject(fallbackStatus[lowerPlatform]);
    const hasRecordedFields = Object.keys(fallbackField).length > 0 || Object.keys(responseField).length > 0;
    const merged = {
      platform: lowerPlatform,
      ...fallbackField,
      ...responseField,
    };
    const status = String(merged.status || '').trim().toLowerCase() || (sentField ? 'accepted' : '');
    if (!status && !hasRecordedFields && !sentField) return null;

    return {
      platform: lowerPlatform,
      status: status || 'unknown',
      sent: sentField || status === 'accepted',
      ...merged,
    };
  };

  return {
    meta: buildStatus('meta'),
    google: buildStatus('google'),
    tiktok: buildStatus('tiktok'),
  };
}

function normalizeTrackedUtmUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw, 'https://adray.ai');
    parsed.hash = '';
    return parsed.toString().slice(0, 900) || null;
  } catch (_) {
    return raw.split('#')[0].slice(0, 900) || null;
  }
}

function isTrackedUtmUrl(value) {
  const normalized = normalizeTrackedUtmUrl(value);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized, 'https://adray.ai');
    const params = parsed.searchParams;
    return [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'fbclid',
      'gclid',
      'wbraid',
      'gbraid',
      'msclkid',
      'fbc',
      'ttclid',
      'ga4_session_source',
    ].some((key) => params.has(key) && params.get(key));
  } catch (_) {
    return false;
  }
}

function parseTrackedUtmHistoryArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeTrackedUtmEntry(entry, fallback = {}) {
  if (!entry || typeof entry !== 'object') return null;

  const url = normalizeTrackedUtmUrl(
    entry.url
    || entry.page_url
    || entry.pageUrl
    || entry.u
    || fallback.url
    || ''
  );

  if (!url || !isTrackedUtmUrl(url)) return null;

  let parsed;
  try {
    parsed = new URL(url, 'https://adray.ai');
  } catch (_) {
    parsed = null;
  }

  const params = parsed ? parsed.searchParams : new URLSearchParams();
  const clickId = String(
    entry.click_id
    || entry.clickId
    || entry.fbclid
    || entry.gclid
    || entry.wbraid
    || entry.gbraid
    || entry.msclkid
    || entry.fbc
    || entry._fbc
    || entry.ttclid
    || params.get('fbclid')
    || params.get('gclid')
    || params.get('wbraid')
    || params.get('gbraid')
    || params.get('msclkid')
    || params.get('fbc')
    || params.get('ttclid')
    || ''
  ).trim();

  return {
    sessionId: String(entry.session_id || entry.sessionId || fallback.sessionId || '').trim() || null,
    capturedAt: String(entry.captured_at || entry.capturedAt || entry.ts || fallback.capturedAt || '').trim() || null,
    url,
    utmSource: String(entry.utm_source || entry.utmSource || params.get('utm_source') || '').trim() || null,
    utmMedium: String(entry.utm_medium || entry.utmMedium || params.get('utm_medium') || '').trim() || null,
    utmCampaign: String(entry.utm_campaign || entry.utmCampaign || params.get('utm_campaign') || '').trim() || null,
    utmContent: String(entry.utm_content || entry.utmContent || params.get('utm_content') || '').trim() || null,
    utmTerm: String(entry.utm_term || entry.utmTerm || params.get('utm_term') || '').trim() || null,
    ga4SessionSource: String(entry.ga4_session_source || entry.ga4SessionSource || params.get('ga4_session_source') || '').trim() || null,
    fbclid: String(entry.fbclid || params.get('fbclid') || '').trim() || null,
    gclid: String(entry.gclid || params.get('gclid') || '').trim() || null,
    wbraid: String(entry.wbraid || params.get('wbraid') || '').trim() || null,
    gbraid: String(entry.gbraid || params.get('gbraid') || '').trim() || null,
    msclkid: String(entry.msclkid || params.get('msclkid') || '').trim() || null,
    fbc: String(entry.fbc || entry._fbc || params.get('fbc') || '').trim() || null,
    ttclid: String(entry.ttclid || params.get('ttclid') || '').trim() || null,
    clickId: clickId || null,
    sourceType: String(entry.source_type || entry.sourceType || fallback.sourceType || 'captured_url').trim() || 'captured_url',
  };
}

function extractTrackedUtmEntriesFromPayload(rawPayload, fallback = {}) {
  const payload = rawPayload && typeof rawPayload === 'object'
    ? rawPayload
    : {};

  const touches = [];
  const pushTouch = (entry) => {
    const normalized = normalizeTrackedUtmEntry(entry, fallback);
    if (normalized) touches.push(normalized);
  };

  [
    { url: payload.utm_entry_url, sourceType: 'utm_entry_url' },
    { url: payload.page_url || payload.pageUrl || payload.url, sourceType: 'page_url' },
    { url: payload.landing_page_url || payload.landingPageUrl, sourceType: 'landing_page_url' },
  ].forEach((entry) => pushTouch(entry));

  [
    payload.utm_session_history,
    payload.utm_browser_history,
    payload.utm_touch_history,
    payload.utm_url_history,
  ].forEach((historyValue) => {
    parseTrackedUtmHistoryArray(historyValue).forEach((entry) => pushTouch(entry));
  });

  const deduped = new Map();
  touches.forEach((item) => {
    const key = `${item.sessionId || fallback.sessionId || 'global'}::${item.url}`;
    const previous = deduped.get(key);
    if (!previous) {
      deduped.set(key, item);
      return;
    }

    const prevTs = new Date(previous.capturedAt || 0).getTime();
    const nextTs = new Date(item.capturedAt || 0).getTime();
    if (nextTs && (!prevTs || nextTs < prevTs)) {
      deduped.set(key, item);
    }
  });

  return Array.from(deduped.values())
    .sort((a, b) => new Date(a.capturedAt || 0).getTime() - new Date(b.capturedAt || 0).getTime());
}

function buildRecognizedUserTrackedUtmHistory({ currentSession = {}, peerSessions = [], currentEvents = [], peerEvents = [] }) {
  const sessionMap = new Map();

  const ensureSessionGroup = (session, isCurrentSession = false) => {
    const sessionId = String(session?.sessionId || '').trim();
    if (!sessionId) return null;

    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, {
        sessionId,
        startedAt: session?.startedAt || null,
        lastEventAt: session?.lastEventAt || session?.sessionEndAt || null,
        landingPageUrl: session?.landingPageUrl || null,
        utmSource: session?.utmSource || null,
        utmMedium: session?.utmMedium || null,
        utmCampaign: session?.utmCampaign || null,
        isCurrentSession: Boolean(isCurrentSession),
        urlMap: new Map(),
      });
    } else if (isCurrentSession) {
      sessionMap.get(sessionId).isCurrentSession = true;
    }

    return sessionMap.get(sessionId);
  };

  ensureSessionGroup(currentSession, true);
  peerSessions.forEach((session) => ensureSessionGroup(session, false));

  const addTouchToSession = (sessionId, touch, fallbackMeta = {}) => {
    const effectiveSessionId = String(touch?.sessionId || sessionId || '').trim();
    if (!effectiveSessionId || !touch?.url) return;

    const group = ensureSessionGroup({
      sessionId: effectiveSessionId,
      startedAt: fallbackMeta.startedAt || null,
      lastEventAt: fallbackMeta.lastEventAt || null,
      landingPageUrl: fallbackMeta.landingPageUrl || null,
      utmSource: fallbackMeta.utmSource || null,
      utmMedium: fallbackMeta.utmMedium || null,
      utmCampaign: fallbackMeta.utmCampaign || null,
    }, effectiveSessionId === String(currentSession?.sessionId || '').trim());

    if (!group) return;

    const key = touch.url;
    const previous = group.urlMap.get(key);
    if (!previous) {
      group.urlMap.set(key, touch);
      return;
    }

    const prevTs = new Date(previous.capturedAt || 0).getTime();
    const nextTs = new Date(touch.capturedAt || 0).getTime();
    if (nextTs && (!prevTs || nextTs < prevTs)) {
      group.urlMap.set(key, touch);
    }
  };

  const allEventRows = [
    ...currentEvents.map((event) => ({
      sessionId: event.sessionId || currentSession?.sessionId || null,
      createdAt: event.createdAt || event.collectedAt || null,
      pageUrl: event.pageUrl || null,
      rawPayload: event.rawPayload || null,
    })),
    ...peerEvents.map((event) => ({
      sessionId: event.sessionId || null,
      createdAt: event.createdAt || event.collectedAt || null,
      pageUrl: event.pageUrl || null,
      rawPayload: event.rawPayload || null,
    })),
  ];

  allEventRows.forEach((event) => {
    const sessionId = String(event.sessionId || '').trim();
    if (!sessionId) return;
    const group = ensureSessionGroup({ sessionId }, sessionId === String(currentSession?.sessionId || '').trim());
    const touches = extractTrackedUtmEntriesFromPayload(event.rawPayload || {}, {
      sessionId,
      capturedAt: event.createdAt || null,
      url: event.pageUrl || null,
      sourceType: 'event_payload',
    });

    touches.forEach((touch) => addTouchToSession(sessionId, touch, group || {}));
  });

  Array.from(sessionMap.values()).forEach((group) => {
    if (group.urlMap.size === 0 && isTrackedUtmUrl(group.landingPageUrl || '')) {
      const fallbackTouch = normalizeTrackedUtmEntry({
        url: group.landingPageUrl,
        session_id: group.sessionId,
        captured_at: group.startedAt || group.lastEventAt || null,
        utm_source: group.utmSource,
        utm_medium: group.utmMedium,
        utm_campaign: group.utmCampaign,
        source_type: 'session_landing',
      }, {
        sessionId: group.sessionId,
        capturedAt: group.startedAt || group.lastEventAt || null,
      });
      if (fallbackTouch) addTouchToSession(group.sessionId, fallbackTouch, group);
    }
  });

  const sessions = Array.from(sessionMap.values())
    .map((group) => {
      const urls = Array.from(group.urlMap.values())
        .sort((a, b) => new Date(a.capturedAt || 0).getTime() - new Date(b.capturedAt || 0).getTime());

      return {
        sessionId: group.sessionId,
        startedAt: group.startedAt || null,
        lastEventAt: group.lastEventAt || null,
        landingPageUrl: group.landingPageUrl || null,
        utmSource: group.utmSource || null,
        utmMedium: group.utmMedium || null,
        utmCampaign: group.utmCampaign || null,
        isCurrentSession: Boolean(group.isCurrentSession),
        touchCount: urls.length,
        entryUrl: urls[0]?.url || null,
        urls,
      };
    })
    .filter((group) => group.touchCount > 0)
    .sort((a, b) => {
      if (a.isCurrentSession !== b.isCurrentSession) return a.isCurrentSession ? -1 : 1;
      return new Date(b.startedAt || b.lastEventAt || 0).getTime() - new Date(a.startedAt || a.lastEventAt || 0).getTime();
    });

  const totalUrls = sessions.reduce((sum, group) => sum + Number(group.touchCount || 0), 0);

  return {
    totalUrls,
    sessionCount: sessions.length,
    sessions,
  };
}

function buildIdentityProfileDescriptor({ customerId, emailHash, phoneHash, userKey, customerDisplayName, emailPreview }) {
  const normalizedCustomerId = normalizeWooCustomerId(customerId);
  const normalizedCustomerDisplayName = normalizeCustomerDisplayName(customerDisplayName);
  const normalizedEmailPreview = normalizeEmailPreview(emailPreview);

  const buildReadableWooProfileLabel = () => {
    if (!normalizedCustomerId) return null;
    if (normalizedCustomerDisplayName) return `${normalizedCustomerDisplayName} · Woo #${normalizedCustomerId}`;
    if (normalizedEmailPreview) return `${normalizedEmailPreview} · Woo #${normalizedCustomerId}`;
    return null;
  };

  if (normalizedCustomerId) {
    return {
      profileKey: `customer:${normalizedCustomerId}`,
      profileType: 'woocommerce_customer',
      customerDisplayName: normalizedCustomerDisplayName,
      customerEmailPreview: normalizedEmailPreview,
      profileLabel: buildReadableWooProfileLabel() || `Woo customer #${normalizedCustomerId}`,
    };
  }

  if (emailHash) {
    return {
      profileKey: `email:${emailHash}`,
      profileType: 'email_hash',
      profileLabel: 'Perfil por email',
    };
  }

  if (phoneHash) {
    return {
      profileKey: `phone:${phoneHash}`,
      profileType: 'phone_hash',
      profileLabel: 'Perfil por teléfono',
    };
  }

  return {
    profileKey: `user:${userKey || 'unknown'}`,
    profileType: 'user_key',
    profileLabel: userKey ? `Browser profile ${String(userKey).slice(0, 10)}` : 'Perfil web',
  };
}

function buildIdentityOrClauses({ userKeys = [], customerIds = [], emailHashes = [], phoneHashes = [], fingerprintHashes = [] }) {
  const clauses = [];
  if (userKeys.length) clauses.push({ userKey: { in: userKeys } });
  if (customerIds.length) clauses.push({ customerId: { in: customerIds } });
  if (emailHashes.length) clauses.push({ emailHash: { in: emailHashes } });
  if (phoneHashes.length) clauses.push({ phoneHash: { in: phoneHashes } });
  if (fingerprintHashes.length) clauses.push({ fingerprintHash: { in: fingerprintHashes } });
  return clauses;
}

function buildOrderIdentityOrClauses({ userKeys = [], customerIds = [], emailHashes = [], phoneHashes = [] }) {
  const clauses = [];
  if (userKeys.length) clauses.push({ userKey: { in: userKeys } });
  if (customerIds.length) clauses.push({ customerId: { in: customerIds } });
  if (emailHashes.length) clauses.push({ emailHash: { in: emailHashes } });
  if (phoneHashes.length) clauses.push({ phoneHash: { in: phoneHashes } });
  return clauses;
}

async function resolveSessionIdentityContext({ accountId, sessionId, sessionUserKey, checkoutTokens = [], sessionEvents = [] }) {
  const seedOrderClauses = [{ sessionId }];
  if (checkoutTokens.length) seedOrderClauses.push({ checkoutToken: { in: checkoutTokens } });
  if (sessionUserKey) seedOrderClauses.push({ userKey: sessionUserKey });

  const eventIdentitySignals = sessionEvents
    .map((event) => ({
      eventName: event.eventName,
      createdAt: event.createdAt,
      ...extractEventIdentity(event.rawPayload),
    }))
    .filter((item) => item.customerId || item.emailHash || item.phoneHash || item.customerDisplayName || item.emailPreview);

  const loginEvents = eventIdentitySignals.filter((item) => resolveEventBucket(item.eventName) === 'login');
  const latestIdentitySignal = [...eventIdentitySignals]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const [seedOrders, seedIdentityRows] = await Promise.all([
    prisma.order.findMany({
      where: {
        accountId,
        OR: seedOrderClauses,
      },
      select: {
        sessionId: true,
        userKey: true,
        customerId: true,
        emailHash: true,
        phoneHash: true,
        lineItems: true,
        attributionSnapshot: true,
        orderId: true,
        orderNumber: true,
        revenue: true,
        currency: true,
        createdAt: true,
        platformCreatedAt: true,
        attributedChannel: true
      },
      orderBy: [{ platformCreatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    sessionUserKey
      ? prisma.identityGraph.findMany({
          where: { accountId, userKey: sessionUserKey },
          select: {
            userKey: true,
            customerId: true,
            emailHash: true,
            phoneHash: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const seedUserKeys = collectUniqueStrings([
    sessionUserKey,
    ...seedOrders.map((item) => item.userKey),
    ...seedIdentityRows.map((item) => item.userKey),
  ]);
  const seedCustomerIds = collectUniqueStrings([
    ...eventIdentitySignals.map((item) => item.customerId),
    ...seedOrders.map((item) => item.customerId),
    ...seedIdentityRows.map((item) => item.customerId),
  ]);
  const seedEmailHashes = collectUniqueStrings([
    ...eventIdentitySignals.map((item) => item.emailHash),
    ...seedOrders.map((item) => item.emailHash),
    ...seedIdentityRows.map((item) => item.emailHash),
  ]);
  const seedPhoneHashes = collectUniqueStrings([
    ...eventIdentitySignals.map((item) => item.phoneHash),
    ...seedOrders.map((item) => item.phoneHash),
    ...seedIdentityRows.map((item) => item.phoneHash),
  ]);
  const seedFingerprintHashes = collectUniqueStrings([
    ...eventIdentitySignals.map((item) => item.browserFingerprintHash),
    ...seedIdentityRows.map((item) => item.fingerprintHash),
  ]);

  const sharedIdentityClauses = buildIdentityOrClauses({
    userKeys: seedUserKeys,
    customerIds: seedCustomerIds,
    emailHashes: seedEmailHashes,
    phoneHashes: seedPhoneHashes,
    fingerprintHashes: seedFingerprintHashes,
  });

  const sharedIdentityRows = sharedIdentityClauses.length
    ? await prisma.identityGraph.findMany({
        where: {
          accountId,
          OR: sharedIdentityClauses,
        },
        select: {
          userKey: true,
          customerId: true,
          emailHash: true,
          phoneHash: true,
          fingerprintHash: true,
          lastSeenAt: true,
        },
      })
    : [];

  const finalUserKeys = collectUniqueStrings([
    ...seedUserKeys,
    ...sharedIdentityRows.map((item) => item.userKey),
  ]);
  const finalCustomerIds = collectUniqueStrings([
    ...seedCustomerIds,
    ...sharedIdentityRows.map((item) => item.customerId),
  ]);
  const finalEmailHashes = collectUniqueStrings([
    ...seedEmailHashes,
    ...sharedIdentityRows.map((item) => item.emailHash),
  ]);
  const finalPhoneHashes = collectUniqueStrings([
    ...seedPhoneHashes,
    ...sharedIdentityRows.map((item) => item.phoneHash),
  ]);
  const finalFingerprintHashes = collectUniqueStrings([
    ...seedFingerprintHashes,
    ...sharedIdentityRows.map((item) => item.fingerprintHash),
  ]);

  const historicalOrderClauses = buildOrderIdentityOrClauses({
    userKeys: finalUserKeys,
    customerIds: finalCustomerIds,
    emailHashes: finalEmailHashes,
    phoneHashes: finalPhoneHashes,
  });

  const historicalOrders = historicalOrderClauses.length
    ? await prisma.order.findMany({
        where: {
          accountId,
          OR: historicalOrderClauses,
        },
        select: {
          sessionId: true,
          userKey: true,
          customerId: true,
          emailHash: true,
          phoneHash: true,
          lineItems: true,
          attributionSnapshot: true,
          orderId: true,
          orderNumber: true,
          revenue: true,
          currency: true,
          createdAt: true,
          platformCreatedAt: true,
          attributedChannel: true
        },
        orderBy: [{ platformCreatedAt: 'desc' }, { createdAt: 'desc' }],
        take: 250,
      })
    : [];

  const resolvedCustomerDisplayName = historicalOrders
    .map((order) => extractOrderCustomerDisplayName(order.attributionSnapshot))
    .find(Boolean)
    || latestIdentitySignal?.customerDisplayName
    || null;

  const resolvedCustomerEmailPreview = historicalOrders
    .map((order) => extractOrderCustomerEmailPreview(order.attributionSnapshot))
    .find(Boolean)
    || latestIdentitySignal?.emailPreview
    || null;

  const profileDescriptor = buildIdentityProfileDescriptor({
    customerId: finalCustomerIds[0] || null,
    emailHash: finalEmailHashes[0] || null,
    phoneHash: finalPhoneHashes[0] || null,
    userKey: finalUserKeys[0] || sessionUserKey || null,
    customerDisplayName: resolvedCustomerDisplayName,
    emailPreview: resolvedCustomerEmailPreview,
  });

  return {
    userKeys: finalUserKeys,
    customerIds: finalCustomerIds,
    emailHashes: finalEmailHashes,
    phoneHashes: finalPhoneHashes,
    fingerprintHashes: finalFingerprintHashes,
    profile: profileDescriptor,
    identifiedUser: {
      customerId: finalCustomerIds[0] || latestIdentitySignal?.customerId || null,
      customerDisplayName: resolvedCustomerDisplayName,
      emailPreview: resolvedCustomerEmailPreview,
      phonePreview: latestIdentitySignal?.phonePreview || null,
      loginCount: loginEvents.length,
      lastLoginAt: loginEvents.length ? loginEvents[loginEvents.length - 1].createdAt : null,
    },
    loginEvents,
    sharedIdentityRows,
    historicalOrders,
  };
}

router.get('/:account_id/wordpress-users-online', async (req, res) => {
  try {
    const { account_id } = req.params;
    const windowMinutes = Math.max(5, Math.min(180, Number.parseInt(String(req.query.window_minutes || '30'), 10) || 30));
    const limit = Math.max(5, Math.min(50, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
    const wpUsersCacheKey = buildRouteCacheKey('wordpress-users-online', req);
    const cachedWpUsers = readRouteCache(wpUsersCacheKey);
    if (cachedWpUsers) {
      return res.json({
        ...cachedWpUsers,
        cache: { hit: true, ttlMs: 2500 },
      });
    }
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const loginAliases = EVENT_BUCKET_ALIASES.login.map((name) => normalizeEventName(name));
    const logoutAliases = EVENT_BUCKET_ALIASES.logout.map((name) => normalizeEventName(name));

    // Optimización crítica: Solo traer eventos de auth en la Query de base de datos para no desbordar la memoria (OOM)
    // porque rawPayload puede ser inmenso en eventos tipo 'purchase' o 'page_view'.
    const targetEventNames = [...EVENT_BUCKET_ALIASES.login, ...EVENT_BUCKET_ALIASES.logout];

    const recentEvents = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: since },
        eventName: { in: targetEventNames }
      },
      select: {
        eventName: true,
        createdAt: true,
        sessionId: true,
        userKey: true,
        rawPayload: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const woocommerceEvents = recentEvents.filter((event) => {
      const payloadPlatform = String(event?.rawPayload?.platform || '').trim().toLowerCase();
      return payloadPlatform === 'woocommerce';
    });

    const authEvents = woocommerceEvents.filter((event) => {
      const eventName = normalizeEventName(event.eventName);
      return loginAliases.includes(eventName) || logoutAliases.includes(eventName);
    });
    const sessionIds = collectUniqueStrings(authEvents.map((event) => event.sessionId));

    const activeSessions = sessionIds.length
      ? await prisma.session.findMany({
          where: {
            accountId: account_id,
            sessionId: { in: sessionIds },
            lastEventAt: { gte: since },
          },
          select: {
            sessionId: true,
            lastEventAt: true,
          },
        })
      : [];

    const activeSessionMap = new Map(activeSessions.map((item) => [item.sessionId, item.lastEventAt]));
    const userMap = new Map();

    for (const event of authEvents) {
      const identity = extractEventIdentity(event.rawPayload || {});
      const normalizedEventName = normalizeEventName(event.eventName);
      const eventState = logoutAliases.includes(normalizedEventName) ? 'logout' : 'login';
      const dedupKey = identity.customerId
        ? `customer:${identity.customerId}`
        : identity.emailHash
          ? `email:${identity.emailHash}`
          : identity.phoneHash
            ? `phone:${identity.phoneHash}`
            : event.userKey
              ? `user:${event.userKey}`
              : null;

      if (!dedupKey) continue;

      const existing = userMap.get(dedupKey) || {
        id: dedupKey,
        customerId: identity.customerId || null,
        customerName: identity.customerDisplayName || null,
        emailPreview: identity.emailPreview || null,
        phonePreview: identity.phonePreview || null,
        lastLoginAt: null,
        lastLogoutAt: null,
        lastAuthState: null,
        lastSeenAt: null,
        sessionIds: new Set(),
        source: eventState === 'logout' ? 'user_logged_out' : 'user_logged_in',
      };

      const eventAt = event.createdAt ? new Date(event.createdAt) : null;
      const sessionSeenAt = event.sessionId ? activeSessionMap.get(event.sessionId) : null;
      const seenAt = sessionSeenAt || eventAt;

      if (eventState === 'login' && eventAt && (!existing.lastLoginAt || eventAt > existing.lastLoginAt)) {
        existing.lastLoginAt = eventAt;
      }
      if (eventState === 'logout' && eventAt && (!existing.lastLogoutAt || eventAt > existing.lastLogoutAt)) {
        existing.lastLogoutAt = eventAt;
      }
      if (eventAt) {
        const latestKnownAuthAt = existing.lastAuthAt ? new Date(existing.lastAuthAt).getTime() : 0;
        if (!latestKnownAuthAt || eventAt.getTime() >= latestKnownAuthAt) {
          existing.lastAuthAt = eventAt.toISOString();
          existing.lastAuthState = eventState;
          existing.source = eventState === 'logout' ? 'user_logged_out' : 'user_logged_in';
        }
      }
      if (seenAt && (!existing.lastSeenAt || seenAt > existing.lastSeenAt)) {
        existing.lastSeenAt = seenAt;
      }
      if (event.sessionId) {
        if (eventState === 'logout') existing.sessionIds.delete(event.sessionId);
        else existing.sessionIds.add(event.sessionId);
      }

      if (!existing.customerName && identity.customerDisplayName) {
        existing.customerName = identity.customerDisplayName;
      }
      if (!existing.customerId && identity.customerId) {
        existing.customerId = identity.customerId;
      }
      if (!existing.emailPreview && identity.emailPreview) {
        existing.emailPreview = identity.emailPreview;
      }
      if (!existing.phonePreview && identity.phonePreview) {
        existing.phonePreview = identity.phonePreview;
      }

      userMap.set(dedupKey, existing);
    }

    const sanitizeStr = (str, len = 70) => {
      if (!str || typeof str !== 'string') return null;
      return str.length > len ? str.substring(0, len) + '...' : str.trim();
    };

    const users = Array.from(userMap.values())
      .filter((item) => item.lastAuthState !== 'logout')
      .map((item) => ({
        id: sanitizeStr(item.id, 100),
        customerId: sanitizeStr(item.customerId, 50),
        customerName: sanitizeStr(item.customerName, 80),
        emailPreview: sanitizeStr(item.emailPreview, 80),
        phonePreview: sanitizeStr(item.phonePreview, 50),
        sessionCount: item.sessionIds.size,
        sessionIds: Array.from(item.sessionIds).slice(0, 5), // Only return max 5 sessions to keep JSON small
        lastLoginAt: item.lastLoginAt ? item.lastLoginAt.toISOString() : null,
        lastLogoutAt: item.lastLogoutAt ? item.lastLogoutAt.toISOString() : null,
        lastSeenAt: item.lastSeenAt ? item.lastSeenAt.toISOString() : null,
        source: item.source,
      }))
      .sort((a, b) => {
        const aTs = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
        const bTs = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
        return bTs - aTs;
      })
      .slice(0, limit);

    const responsePayload = {
      success: true,
      accountId: account_id,
      windowMinutes,
      users,
      totalUsers: users.length,
      message: users.length
        ? `Se detectaron ${users.length} usuarios WordPress activos en la ventana reciente.`
        : 'No se detectaron usuarios WordPress conectados en la ventana reciente.',
    };

    writeRouteCache(wpUsersCacheKey, responsePayload, 2500);
    return res.json(responsePayload);
  } catch (error) {
    console.error('[Analytics API] WordPress users online error:', error);
    return res.json({
      success: true,
      accountId: req.params.account_id,
      windowMinutes: Math.max(5, Math.min(180, Number.parseInt(String(req.query.window_minutes || '30'), 10) || 30)),
      users: [],
      totalUsers: 0,
      degraded: true,
      message: 'WordPress online users temporarily unavailable; returning empty list.',
    });
  }
});

router.get('/:account_id/session-explorer', async (req, res) => {
  try {
    const { account_id } = req.params;
    const limit = Math.max(5, Math.min(500, Number.parseInt(String(req.query.limit || '120'), 10) || 120));
    const sessionExplorerCacheKey = buildRouteCacheKey('session-explorer', req);
    const cachedSessionExplorer = readRouteCache(sessionExplorerCacheKey);
    if (cachedSessionExplorer) {
      return res.json({
        ...cachedSessionExplorer,
        cache: { hit: true, ttlMs: 120000 },
      });
    }

    const accountRecord = await prisma.account.findUnique({
      where: { accountId: account_id },
      select: {
        platform: true,
        domain: true,
      },
    });
    const storePlatform = String(accountRecord?.platform || 'CUSTOM').toUpperCase();

    const [recentSessions, recentOrders] = await Promise.all([
      prisma.session.findMany({
        where: { accountId: account_id },
        select: {
          sessionId: true,
          userKey: true,
          startedAt: true,
          lastEventAt: true,
          landingPageUrl: true,
          utmSource: true,
          utmCampaign: true,
        },
        orderBy: { startedAt: 'desc' },
        take: 250,
      }),
      prisma.order.findMany({
        where: { accountId: account_id },
        select: {
          sessionId: true,
          checkoutToken: true,
          userKey: true,
          customerId: true,
          emailHash: true,
          phoneHash: true,
          attributionSnapshot: true,
          orderId: true,
          orderNumber: true,
          revenue: true,
          currency: true,
          lineItems: true,
          createdAt: true,
          platformCreatedAt: true,
          attributedChannel: true
        },
        orderBy: [{ platformCreatedAt: 'desc' }, { createdAt: 'desc' }],
        take: 250,
      }),
    ]);

    const checkoutTokens = collectUniqueStrings(recentOrders.map((item) => item.checkoutToken));
    const checkoutMappings = checkoutTokens.length
      ? await prisma.checkoutSessionMap.findMany({
          where: {
            accountId: account_id,
            checkoutToken: { in: checkoutTokens },
          },
          select: {
            checkoutToken: true,
            userKey: true,
            sessionId: true,
            createdAt: true,
          },
        })
      : [];

    const checkoutByToken = new Map(checkoutMappings.map((item) => [item.checkoutToken, item]));
    const seedUserKeys = collectUniqueStrings([
      ...recentSessions.map((item) => item.userKey),
      ...recentOrders.map((item) => item.userKey),
      ...checkoutMappings.map((item) => item.userKey),
    ]);
    const seedCustomerIds = collectUniqueStrings(recentOrders.map((item) => item.customerId));
    const seedEmailHashes = collectUniqueStrings(recentOrders.map((item) => item.emailHash));
    const seedPhoneHashes = collectUniqueStrings(recentOrders.map((item) => item.phoneHash));

    const identitySeedClauses = buildIdentityOrClauses({
      userKeys: seedUserKeys,
      customerIds: seedCustomerIds,
      emailHashes: seedEmailHashes,
      phoneHashes: seedPhoneHashes,
    });

    const identityRows = identitySeedClauses.length
      ? await prisma.identityGraph.findMany({
          where: {
            accountId: account_id,
            OR: identitySeedClauses,
          },
          select: {
            userKey: true,
            customerId: true,
            emailHash: true,
            phoneHash: true,
            lastSeenAt: true,
          },
        })
      : [];

    const resolvedUserKeys = collectUniqueStrings([
      ...seedUserKeys,
      ...identityRows.map((item) => item.userKey),
    ]);
    const resolvedCustomerIds = collectUniqueStrings([
      ...seedCustomerIds,
      ...identityRows.map((item) => item.customerId),
    ]);
    const resolvedEmailHashes = collectUniqueStrings([
      ...seedEmailHashes,
      ...identityRows.map((item) => item.emailHash),
    ]);
    const resolvedPhoneHashes = collectUniqueStrings([
      ...seedPhoneHashes,
      ...identityRows.map((item) => item.phoneHash),
    ]);

    const orderClauses = buildOrderIdentityOrClauses({
      userKeys: resolvedUserKeys,
      customerIds: resolvedCustomerIds,
      emailHashes: resolvedEmailHashes,
      phoneHashes: resolvedPhoneHashes,
    });

    const historicalOrders = orderClauses.length
      ? await prisma.order.findMany({
          where: {
            accountId: account_id,
            OR: orderClauses,
          },
          select: {
            sessionId: true,
            checkoutToken: true,
            userKey: true,
            customerId: true,
            emailHash: true,
            phoneHash: true,
            orderId: true,
            orderNumber: true,
            revenue: true,
            currency: true,
            attributionSnapshot: true,
            createdAt: true,
            platformCreatedAt: true,
            attributedChannel: true
          },
          orderBy: [{ platformCreatedAt: 'desc' }, { createdAt: 'desc' }],
          take: 400,
        })
      : recentOrders;

    console.info('[Analytics API] Session explorer seeds', {
      accountId: account_id,
      recentSessions: recentSessions.length,
      recentOrders: recentOrders.length,
      checkoutMappings: checkoutMappings.length,
      seedUserKeys: seedUserKeys.length,
      seedCustomerIds: seedCustomerIds.length,
      seedEmailHashes: seedEmailHashes.length,
      seedPhoneHashes: seedPhoneHashes.length,
      identityRows: identityRows.length,
      historicalOrders: historicalOrders.length,
    });

    const identityByUserKey = new Map();
    identityRows.forEach((row) => {
      if (!row.userKey) return;
      if (!identityByUserKey.has(row.userKey)) {
        identityByUserKey.set(row.userKey, row);
      }
    });

    const profiles = new Map();
    const ensureProfile = (descriptor) => {
      if (!profiles.has(descriptor.profileKey)) {
        profiles.set(descriptor.profileKey, {
          profileKey: descriptor.profileKey,
          profileType: descriptor.profileType,
          profileLabel: descriptor.profileLabel,
          customerDisplayName: descriptor.customerDisplayName || null,
          customerEmailPreview: descriptor.customerEmailPreview || null,
          customerId: descriptor.profileType === 'woocommerce_customer'
            ? String(descriptor.profileKey || '').replace(/^customer:/, '')
            : null,
          sessionCount: 0,
          orderCount: 0,
          totalRevenue: 0,
          recentSessionId: null,
          recentSessionStartedAt: null,
          lastSeenAt: null,
          lastOrderAt: null,
          lastLandingPageUrl: null,
          lastCampaign: null,
          userKeys: new Set(),
          _orders: [],
        });
      }
      const profile = profiles.get(descriptor.profileKey);
      if (descriptor.customerDisplayName && !profile.customerDisplayName) {
        profile.customerDisplayName = descriptor.customerDisplayName;
        if (profile.customerId) {
          profile.profileLabel = `${descriptor.customerDisplayName} · Woo #${profile.customerId}`;
        }
      }
      if (descriptor.customerEmailPreview && !profile.customerEmailPreview) {
        profile.customerEmailPreview = descriptor.customerEmailPreview;
        if (!profile.customerDisplayName && profile.customerId) {
          profile.profileLabel = `${descriptor.customerEmailPreview} · Woo #${profile.customerId}`;
        }
      }
      return profile;
    };

    const orderSignalBySessionId = new Map();
    historicalOrders.forEach((order) => {
      const resolvedUserKey = order.userKey || checkoutByToken.get(order.checkoutToken || '')?.userKey || null;
      const identity = resolvedUserKey ? (identityByUserKey.get(resolvedUserKey) || {}) : {};
      const customerDisplayName = extractOrderCustomerDisplayName(order.attributionSnapshot) || identity.customerDisplayName || null;
      const customerEmailPreview = extractOrderCustomerEmailPreview(order.attributionSnapshot) || null;
      const signal = {
        customerId: order.customerId || null,
        emailHash: order.emailHash || null,
        phoneHash: order.phoneHash || null,
        userKey: resolvedUserKey,
        customerDisplayName,
        emailPreview: customerEmailPreview,
      };
      if (order.sessionId && !orderSignalBySessionId.has(order.sessionId)) {
        orderSignalBySessionId.set(order.sessionId, signal);
      }
    });

    recentSessions.forEach((session) => {
      const identity = identityByUserKey.get(session.userKey) || orderSignalBySessionId.get(session.sessionId) || {};
      const descriptor = buildIdentityProfileDescriptor({
        customerId: identity.customerId || null,
        emailHash: identity.emailHash || null,
        phoneHash: identity.phoneHash || null,
        userKey: session.userKey,
        customerDisplayName: identity.customerDisplayName || null,
        emailPreview: identity.emailPreview || null,
      });
      const profile = ensureProfile(descriptor);
      profile.sessionCount += 1;
      profile.userKeys.add(String(session.userKey || '').trim());
      const startedAtIso = session.startedAt ? new Date(session.startedAt).toISOString() : null;
      if (!profile.recentSessionStartedAt || (startedAtIso && startedAtIso > profile.recentSessionStartedAt)) {
        profile.recentSessionId = session.sessionId;
        profile.recentSessionStartedAt = startedAtIso;
        profile.lastLandingPageUrl = session.landingPageUrl || null;
        profile.lastCampaign = session.utmCampaign || session.utmSource || null;
      }
      const lastSeenIso = session.lastEventAt ? new Date(session.lastEventAt).toISOString() : startedAtIso;
      if (!profile.lastSeenAt || (lastSeenIso && lastSeenIso > profile.lastSeenAt)) {
        profile.lastSeenAt = lastSeenIso;
      }
    });

    historicalOrders.forEach((order) => {
      const bridgedUserKey = order.userKey || checkoutByToken.get(order.checkoutToken || '')?.userKey || null;
      const identity = bridgedUserKey ? (identityByUserKey.get(bridgedUserKey) || {}) : {};
      const customerDisplayName = extractOrderCustomerDisplayName(order.attributionSnapshot) || identity.customerDisplayName || null;
      const customerEmailPreview = extractOrderCustomerEmailPreview(order.attributionSnapshot) || null;
      const descriptor = buildIdentityProfileDescriptor({
        customerId: order.customerId || identity.customerId || null,
        emailHash: order.emailHash || identity.emailHash || null,
        phoneHash: order.phoneHash || identity.phoneHash || null,
        userKey: bridgedUserKey || null,
        customerDisplayName,
        emailPreview: customerEmailPreview,
      });
      const profile = ensureProfile(descriptor);
      profile.orderCount += 1;
      profile.totalRevenue += Number(order.revenue || 0);
      if (bridgedUserKey) profile.userKeys.add(String(bridgedUserKey).trim());
      const orderSeenAt = order.platformCreatedAt || order.createdAt;
      const orderSeenIso = orderSeenAt ? new Date(orderSeenAt).toISOString() : null;
      if (!profile.lastOrderAt || (orderSeenIso && orderSeenIso > profile.lastOrderAt)) {
        profile.lastOrderAt = orderSeenIso;
      }
      if (!profile.lastSeenAt || (orderSeenIso && orderSeenIso > profile.lastSeenAt)) {
        profile.lastSeenAt = orderSeenIso;
      }
      profile._orders.push(order);
    });

    const allProfiles = Array.from(profiles.values())
      .map((profile) => {
        const topProducts = buildProductAffinityFromOrders(profile._orders);
        const topPairings = buildTopProductPairings(profile._orders);
        const actionRecommendations = buildActionRecommendations({
          topProducts,
          topPairings,
          totalOrders: profile.orderCount,
          profileLabel: profile.customerDisplayName || profile.profileLabel || 'este perfil',
        });

        return {
          ...profile,
          userKeys: Array.from(profile.userKeys).filter(Boolean),
          topProducts,
          topPairings,
          actionRecommendations,
        };
      })
      .sort((a, b) => {
        if (storePlatform === 'WOOCOMMERCE') {
          const aOrderScore = Number(a.orderCount || 0) > 0 ? 1 : 0;
          const bOrderScore = Number(b.orderCount || 0) > 0 ? 1 : 0;
          if (bOrderScore !== aOrderScore) return bOrderScore - aOrderScore;
          const aRevenue = Number(a.totalRevenue || 0);
          const bRevenue = Number(b.totalRevenue || 0);
          if (bRevenue !== aRevenue) return bRevenue - aRevenue;
          const aLinkedSessionScore = a.recentSessionStartedAt ? 1 : 0;
          const bLinkedSessionScore = b.recentSessionStartedAt ? 1 : 0;
          if (bLinkedSessionScore !== aLinkedSessionScore) return bLinkedSessionScore - aLinkedSessionScore;
          const aRecentSessionAt = new Date(a.recentSessionStartedAt || 0).getTime();
          const bRecentSessionAt = new Date(b.recentSessionStartedAt || 0).getTime();
          if (bRecentSessionAt !== aRecentSessionAt) return bRecentSessionAt - aRecentSessionAt;
          const aSeen = new Date(a.lastSeenAt || 0).getTime();
          const bSeen = new Date(b.lastSeenAt || 0).getTime();
          if (bSeen !== aSeen) return bSeen - aSeen;
          return String(a.profileLabel || '').localeCompare(String(b.profileLabel || ''), 'es');
        }

        const aLinkedSessionScore = a.recentSessionStartedAt ? 1 : 0;
        const bLinkedSessionScore = b.recentSessionStartedAt ? 1 : 0;
        if (bLinkedSessionScore !== aLinkedSessionScore) return bLinkedSessionScore - aLinkedSessionScore;
        const aRecentSessionAt = new Date(a.recentSessionStartedAt || 0).getTime();
        const bRecentSessionAt = new Date(b.recentSessionStartedAt || 0).getTime();
        if (bRecentSessionAt !== aRecentSessionAt) return bRecentSessionAt - aRecentSessionAt;
        const aWooScore = a.profileType === 'woocommerce_customer' ? 1 : 0;
        const bWooScore = b.profileType === 'woocommerce_customer' ? 1 : 0;
        if (bWooScore !== aWooScore) return bWooScore - aWooScore;
        const aOrderScore = Number(a.orderCount || 0) > 0 ? 1 : 0;
        const bOrderScore = Number(b.orderCount || 0) > 0 ? 1 : 0;
        if (bOrderScore !== aOrderScore) return bOrderScore - aOrderScore;
        const aRevenue = Number(a.totalRevenue || 0);
        const bRevenue = Number(b.totalRevenue || 0);
        if (bRevenue !== aRevenue) return bRevenue - aRevenue;
        const aSeen = new Date(a.lastSeenAt || 0).getTime();
        const bSeen = new Date(b.lastSeenAt || 0).getTime();
        if (bSeen !== aSeen) return bSeen - aSeen;
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
        return String(a.profileLabel || '').localeCompare(String(b.profileLabel || ''), 'es');
      });

    const shopifyContext = storePlatform === 'SHOPIFY'
      ? await resolveShopifyAdminContext([account_id, accountRecord?.domain || null])
      : null;
    const wooCustomerIds = allProfiles
      .filter((profile) => profile.profileType === 'woocommerce_customer')
      .map((profile) => String(profile.customerId || '').trim())
      .filter(Boolean)
      .slice(0, Math.max(limit * 2, 24));

    let customerDisplayNames = {};
    if (shopifyContext?.shop && shopifyContext?.accessToken && wooCustomerIds.length) {
      try {
        customerDisplayNames = await getCustomerDisplayNames(shopifyContext.shop, shopifyContext.accessToken, wooCustomerIds);
      } catch (error) {
        console.warn('[Analytics API] Shopify customer name lookup failed', {
          accountId: account_id,
          shop: shopifyContext.shop,
          customerIds: wooCustomerIds.length,
          error: error?.message || String(error),
        });
      }
    }

    const hydratedProfiles = allProfiles.map((profile) => {
      if (profile.profileType !== 'woocommerce_customer') return profile;
      const customerId = String(profile.customerId || '').trim();
      const displayName = profile.customerDisplayName || (customerId ? customerDisplayNames[customerId] || null : null);
      const emailPreview = normalizeEmailPreview(profile.customerEmailPreview || null);
      const resolvedLabel = displayName
        ? `${displayName} · Woo #${customerId}`
        : (emailPreview ? `${emailPreview} · Woo #${customerId}` : null);

      if (!resolvedLabel) return null;

      return {
        ...profile,
        customerDisplayName: displayName,
        customerEmailPreview: emailPreview,
        profileLabel: resolvedLabel,
      };
    }).filter(Boolean);

    const serializedProfiles = hydratedProfiles
      .slice(0, limit);

    console.info('[Analytics API] Session explorer result', {
      accountId: account_id,
      storePlatform,
      totalProfilesBuilt: profiles.size,
      returnedProfiles: serializedProfiles.length,
      allWooProfiles: allProfiles.filter((item) => item.profileType === 'woocommerce_customer').length,
      wooProfiles: serializedProfiles.filter((item) => item.profileType === 'woocommerce_customer').length,
      allProfilesWithOrders: allProfiles.filter((item) => Number(item.orderCount || 0) > 0).length,
      profilesWithOrders: serializedProfiles.filter((item) => Number(item.orderCount || 0) > 0).length,
      resolvedCustomerNames: hydratedProfiles.filter((item) => item.profileType === 'woocommerce_customer' && item.customerDisplayName).length,
    });

    const responsePayload = {
      summary: {
        storePlatform,
        totalProfiles: hydratedProfiles.length,
        totalSessions: recentSessions.length,
        totalOrders: historicalOrders.length,
        totalRevenue: historicalOrders.reduce((sum, item) => sum + Number(item.revenue || 0), 0),
        resolvedCustomerNames: hydratedProfiles.filter((item) => item.profileType === 'woocommerce_customer' && item.customerDisplayName).length,
        shopifyNameLookupActive: Boolean(shopifyContext?.shop && shopifyContext?.accessToken),
      },
      profiles: serializedProfiles,
    };

    writeRouteCache(sessionExplorerCacheKey, responsePayload, 10000);
    res.json(responsePayload);
  } catch (error) {
    console.error('[Analytics API] Session explorer overview error:', error);
    if (isDatabaseConnectivityError(error)) {
      return res.json({
        degraded: true,
        degradedReason: 'database_unreachable',
        summary: {
          storePlatform: 'CUSTOM',
          totalProfiles: 0,
          totalSessions: 0,
          totalOrders: 0,
          totalRevenue: 0,
          resolvedCustomerNames: 0,
          shopifyNameLookupActive: false,
        },
        profiles: [],
      });
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/analytics/:account_id/data-coverage
 * Audits Phase 1 data coverage (datos-pixel.md) for a given account.
 */
router.get('/:account_id/data-coverage', async (req, res) => {
  try {
    const { account_id } = req.params;
    const days = Math.max(1, Math.min(90, Number.parseInt(String(req.query.days || '30'), 10) || 30));
    const since = subDays(new Date(), days);
    const warnings = [];

    const isSchemaDriftError = (error) => {
      if (!error) return false;
      if (error.code === 'P2022') return true;
      const msg = String(error.message || '').toLowerCase();
      return msg.includes('does not exist') || (msg.includes('column') && msg.includes('exist'));
    };

    const safeCount = async (label, queryBuilder) => {
      try {
        return await queryBuilder();
      } catch (error) {
        if (isSchemaDriftError(error)) {
          warnings.push({ label, error: String(error?.message || error) });
          return 0;
        }
        throw error;
      }
    };

    const safeFindUnique = async (label, queryBuilder, fallback = null) => {
      try {
        return await queryBuilder();
      } catch (error) {
        if (isSchemaDriftError(error)) {
          warnings.push({ label, error: String(error?.message || error) });
          return fallback;
        }
        throw error;
      }
    };

    const safeFindMany = async (label, queryBuilder, fallback = []) => {
      try {
        return await queryBuilder();
      } catch (error) {
        if (isSchemaDriftError(error)) {
          warnings.push({ label, error: String(error?.message || error) });
          return fallback;
        }
        throw error;
      }
    };

    const eventBaseWhere = {
      accountId: account_id,
      createdAt: { gte: since },
    };

    const sessionBaseWhere = {
      accountId: account_id,
      startedAt: { gte: since },
    };

    const orderBaseWhere = {
      accountId: account_id,
      OR: [
        { createdAt: { gte: since } },
        { platformCreatedAt: { gte: since } },
      ],
    };

    const [
      totalEvents,
      totalSessions,
      totalOrders,
      totalIdentity,
      totalCheckoutMaps,
      eventsRawSource,
      eventsMatchType,
      eventsConfidence,
      eventsCollectedAt,
      sessionsUtmSource,
      sessionsUtmMedium,
      sessionsUtmCampaign,
      sessionsLanding,
      sessionsReferrer,
      sessionsIpHash,
      sessionsGa4Source,
      sessionsEndAt,
      sessionsFbclid,
      sessionsGclid,
      sessionsTtclid,
      identityFingerprint,
      identityEmail,
      identityPhone,
      identityCustomer,
      ordersCheckoutToken,
      ordersCustomer,
      ordersEmail,
      ordersPhone,
      ordersRefund,
      ordersChargeback,
      ordersCountStamped,
      ordersPlatformCreated,
      accountRecord,
      platformConnections,
    ] = await Promise.all([
      safeCount('events.total', () => prisma.event.count({ where: eventBaseWhere })),
      safeCount('sessions.total', () => prisma.session.count({ where: sessionBaseWhere })),
      safeCount('orders.total', () => prisma.order.count({ where: orderBaseWhere })),
      safeCount('identity.total', () => prisma.identityGraph.count({ where: { accountId: account_id } })),
      safeCount('checkout_map.total', () => prisma.checkoutSessionMap.count({ where: { accountId: account_id, createdAt: { gte: since } } })),

      safeCount('events.raw_source', () => prisma.event.count({ where: { ...eventBaseWhere, rawSource: { not: null } } })),
      safeCount('events.match_type', () => prisma.event.count({ where: { ...eventBaseWhere, matchType: { not: null } } })),
      safeCount('events.confidence_score', () => prisma.event.count({ where: { ...eventBaseWhere, confidenceScore: { not: null } } })),
      safeCount('events.collected_at', () => prisma.event.count({ where: { ...eventBaseWhere, collectedAt: { not: null } } })),

      safeCount('sessions.utm_source', () => prisma.session.count({ where: { ...sessionBaseWhere, utmSource: { not: null } } })),
      safeCount('sessions.utm_medium', () => prisma.session.count({ where: { ...sessionBaseWhere, utmMedium: { not: null } } })),
      safeCount('sessions.utm_campaign', () => prisma.session.count({ where: { ...sessionBaseWhere, utmCampaign: { not: null } } })),
      safeCount('sessions.landing_page', () => prisma.session.count({ where: { ...sessionBaseWhere, landingPageUrl: { not: null } } })),
      safeCount('sessions.referrer', () => prisma.session.count({ where: { ...sessionBaseWhere, referrer: { not: null } } })),
      safeCount('sessions.ip_hash', () => prisma.session.count({ where: { ...sessionBaseWhere, ipHash: { not: null } } })),
      safeCount('sessions.ga4_session_source', () => prisma.session.count({ where: { ...sessionBaseWhere, ga4SessionSource: { not: null } } })),
      safeCount('sessions.session_end_at', () => prisma.session.count({ where: { ...sessionBaseWhere, sessionEndAt: { not: null } } })),
      safeCount('sessions.fbclid', () => prisma.session.count({ where: { ...sessionBaseWhere, fbclid: { not: null } } })),
      safeCount('sessions.gclid', () => prisma.session.count({ where: { ...sessionBaseWhere, gclid: { not: null } } })),
      safeCount('sessions.ttclid', () => prisma.session.count({ where: { ...sessionBaseWhere, ttclid: { not: null } } })),

      safeCount('identity.fingerprint_hash', () => prisma.identityGraph.count({ where: { accountId: account_id, fingerprintHash: { not: null } } })),
      safeCount('identity.email_hash', () => prisma.identityGraph.count({ where: { accountId: account_id, emailHash: { not: null } } })),
      safeCount('identity.phone_hash', () => prisma.identityGraph.count({ where: { accountId: account_id, phoneHash: { not: null } } })),
      safeCount('identity.customer_id', () => prisma.identityGraph.count({ where: { accountId: account_id, customerId: { not: null } } })),

      safeCount('orders.checkout_token', () => prisma.order.count({ where: { ...orderBaseWhere, checkoutToken: { not: null } } })),
      safeCount('orders.customer_id', () => prisma.order.count({ where: { ...orderBaseWhere, customerId: { not: null } } })),
      safeCount('orders.email_hash', () => prisma.order.count({ where: { ...orderBaseWhere, emailHash: { not: null } } })),
      safeCount('orders.phone_hash', () => prisma.order.count({ where: { ...orderBaseWhere, phoneHash: { not: null } } })),
      safeCount('orders.refund_amount', () => prisma.order.count({ where: { ...orderBaseWhere, refundAmount: { gt: 0 } } })),
      safeCount('orders.chargeback_flag', () => prisma.order.count({ where: { ...orderBaseWhere, chargebackFlag: true } })),
      safeCount('orders.orders_count', () => prisma.order.count({ where: { ...orderBaseWhere, ordersCount: { not: null } } })),
      safeCount('orders.created_at', () => prisma.order.count({ where: orderBaseWhere })),

      safeFindUnique('account.domain', () => prisma.account.findUnique({ where: { accountId: account_id }, select: { domain: true } }), null),
      safeFindMany('platform_connections.list', () => prisma.platformConnection.findMany({ where: { accountId: account_id }, select: { platform: true, status: true, adAccountId: true } }), []),
    ]);

    const paidMedia = await buildPaidMediaSummary({
      accountId: account_id,
      domain: accountRecord?.domain || account_id,
      platformConnections,
      fallbackUserId: req.user?._id || req.user?.id || null,
      startDate: since,
      endDate: new Date(),
    });

    const isOk = (value) => value > 0;
    const ratio = (value, total) => (total > 0 ? Number((value / total).toFixed(4)) : null);

    const layers = {
      layer1_identity_anchors: {
        user_key: { ok: totalEvents > 0 || totalSessions > 0, sampleCount: Math.max(totalEvents, totalSessions) },
        email_hash: { ok: isOk(identityEmail) || isOk(ordersEmail), identityCount: identityEmail, orderCount: ordersEmail },
        phone_hash: { ok: isOk(identityPhone) || isOk(ordersPhone), identityCount: identityPhone, orderCount: ordersPhone },
        customer_id: { ok: isOk(identityCustomer) || isOk(ordersCustomer), identityCount: identityCustomer, orderCount: ordersCustomer },
      },
      layer2_session_events: {
        session_id: { ok: totalSessions > 0, count: totalSessions },
        utm_source: { ok: isOk(sessionsUtmSource), count: sessionsUtmSource, ratio: ratio(sessionsUtmSource, totalSessions) },
        utm_medium: { ok: isOk(sessionsUtmMedium), count: sessionsUtmMedium, ratio: ratio(sessionsUtmMedium, totalSessions) },
        utm_campaign: { ok: isOk(sessionsUtmCampaign), count: sessionsUtmCampaign, ratio: ratio(sessionsUtmCampaign, totalSessions) },
        fingerprint_hash: { ok: isOk(identityFingerprint), count: identityFingerprint, ratio: ratio(identityFingerprint, totalIdentity) },
        ip_hash: { ok: isOk(sessionsIpHash), count: sessionsIpHash, ratio: ratio(sessionsIpHash, totalSessions) },
        page_events: { ok: totalEvents > 0, count: totalEvents, note: 'Stored as event rows in events table.' },
        session_start_at: { ok: totalSessions > 0, count: totalSessions },
        session_end_at: { ok: isOk(sessionsEndAt), count: sessionsEndAt, ratio: ratio(sessionsEndAt, totalSessions) },
      },
      layer3_touchpoints_click_ids: {
        fbclid: { ok: isOk(sessionsFbclid), count: sessionsFbclid },
        gclid: { ok: isOk(sessionsGclid), count: sessionsGclid },
        ttclid: { ok: isOk(sessionsTtclid), count: sessionsTtclid },
        event_id: { ok: totalEvents > 0, count: totalEvents },
        landing_page: { ok: isOk(sessionsLanding), count: sessionsLanding, ratio: ratio(sessionsLanding, totalSessions) },
        referrer: { ok: isOk(sessionsReferrer), count: sessionsReferrer, ratio: ratio(sessionsReferrer, totalSessions) },
      },
      layer4_order_truth: {
        order_id: { ok: totalOrders > 0, count: totalOrders },
        gross_revenue: { ok: totalOrders > 0, count: totalOrders },
        refund_amount: { ok: totalOrders > 0, withRefunds: ordersRefund, note: 'Can be zero for most orders.' },
        chargeback_flag: { ok: totalOrders > 0, withChargeback: ordersChargeback, note: 'May remain zero if disputes are absent.' },
        orders_count: { ok: isOk(ordersCountStamped), count: ordersCountStamped, ratio: ratio(ordersCountStamped, totalOrders) },
        checkout_token: { ok: isOk(ordersCheckoutToken) || totalCheckoutMaps > 0, orderCount: ordersCheckoutToken, mapCount: totalCheckoutMaps },
        customer_id: { ok: isOk(ordersCustomer), count: ordersCustomer, ratio: ratio(ordersCustomer, totalOrders) },
        created_at: { ok: isOk(ordersPlatformCreated), count: ordersPlatformCreated, ratio: ratio(ordersPlatformCreated, totalOrders) },
      },
      layer5_platform_signals_daily_pull: {
        meta_spend: { ok: Boolean(paidMedia?.meta?.hasSnapshot), value: paidMedia?.meta?.spend ?? null },
        meta_impressions: { ok: false, note: 'Not exposed as canonical field in this API yet.' },
        meta_reported_conv_value: { ok: Boolean(paidMedia?.meta?.hasSnapshot), value: paidMedia?.meta?.revenue ?? null },
        google_spend: { ok: Boolean(paidMedia?.google?.hasSnapshot), value: paidMedia?.google?.spend ?? null },
        google_clicks: { ok: Boolean(paidMedia?.google?.hasSnapshot), value: paidMedia?.google?.clicks ?? null },
        ga4_session_source: { ok: isOk(sessionsGa4Source), count: sessionsGa4Source, ratio: ratio(sessionsGa4Source, totalSessions) },
      },
      layer6_raw_enrichment_every_event: {
        confidence_score: { ok: isOk(eventsConfidence), count: eventsConfidence, ratio: ratio(eventsConfidence, totalEvents) },
        match_type: { ok: isOk(eventsMatchType), count: eventsMatchType, ratio: ratio(eventsMatchType, totalEvents) },
        raw_source: { ok: isOk(eventsRawSource), count: eventsRawSource, ratio: ratio(eventsRawSource, totalEvents) },
        collected_at: { ok: isOk(eventsCollectedAt), count: eventsCollectedAt, ratio: ratio(eventsCollectedAt, totalEvents) },
      },
      critical_stitch: {
        checkout_token_to_session_id: {
          ok: totalCheckoutMaps > 0,
          count: totalCheckoutMaps,
          note: 'Stored in checkout_session_map and enriched from collect/checkouts-create webhooks.',
        },
      },
    };

    const missing = [];
    Object.entries(layers).forEach(([layerName, fields]) => {
      Object.entries(fields).forEach(([fieldName, state]) => {
        if (state && state.ok === false) {
          missing.push(`${layerName}.${fieldName}`);
        }
      });
    });

    return res.json({
      success: true,
      accountId: account_id,
      windowDays: days,
      since: since.toISOString(),
      warnings,
      totals: {
        events: totalEvents,
        sessions: totalSessions,
        orders: totalOrders,
        identities: totalIdentity,
        checkoutMaps: totalCheckoutMaps,
      },
      layers,
      missing,
    });
  } catch (error) {
    console.error('[Analytics API] data-coverage error:', error);
    return res.status(200).json({
      success: false,
      degraded: true,
      error: 'Data coverage failed, returned degraded response',
      details: String(error?.message || error),
      accountId: req.params?.account_id || null,
      windowDays: Number.parseInt(String(req.query?.days || '30'), 10) || 30,
      totals: {
        events: 0,
        sessions: 0,
        orders: 0,
        identities: 0,
        checkoutMaps: 0,
      },
      layers: {},
      missing: [],
      warnings: [{ label: 'data_coverage.endpoint', error: String(error?.message || error) }],
    });
  }
});

router.get('/:account_id/sessions/:session_id', async (req, res) => {
  try {
    const { account_id, session_id } = req.params;

    const session = await prisma.session.findUnique({
      where: { sessionId: session_id },
      select: {
        sessionId: true,
        accountId: true,
        userKey: true,
        startedAt: true,
        lastEventAt: true,
        sessionEndAt: true,
        ga4SessionSource: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        utmContent: true,
        utmTerm: true,
        referrer: true,
        landingPageUrl: true,
        ipHash: true,
        fbclid: true,
        gclid: true,
        ttclid: true,
        fbp: true,
        fbc: true,
      },
    });

    if (!session || session.accountId !== account_id) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const [events, currentSessionOrders] = await Promise.all([
      prisma.event.findMany({
        where: { accountId: account_id, sessionId: session_id },
        select: {
          eventId: true,
          eventName: true,
          createdAt: true,
          collectedAt: true,
          rawSource: true,
          matchType: true,
          confidenceScore: true,
          ipHash: true,
          pageUrl: true,
          pageType: true,
          productId: true,
          variantId: true,
          cartId: true,
          cartValue: true,
          checkoutToken: true,
          orderId: true,
          revenue: true,
          currency: true,
          rawPayload: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.order.findMany({
        where: { accountId: account_id, sessionId: session_id },
        select: {
          orderId: true,
          orderNumber: true,
          revenue: true,
          currency: true,
          lineItems: true,
          createdAt: true,
          platformCreatedAt: true,
          attributedChannel: true,
          attributionSnapshot: true
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const checkoutTokenSet = new Set();
    events.forEach((event) => {
      if (event.checkoutToken) checkoutTokenSet.add(String(event.checkoutToken));
    });

    const identityContext = await resolveSessionIdentityContext({
      accountId: account_id,
      sessionId: session_id,
      sessionUserKey: session.userKey || null,
      checkoutTokens: Array.from(checkoutTokenSet),
      sessionEvents: events,
    });

    console.info('[Analytics API] Session detail identity', {
      accountId: account_id,
      sessionId: session_id,
      sessionUserKey: session.userKey || null,
      checkoutTokens: checkoutTokenSet.size,
      resolvedUserKeys: identityContext.userKeys.length,
      resolvedCustomerIds: identityContext.customerIds.length,
      resolvedEmailHashes: identityContext.emailHashes.length,
      resolvedPhoneHashes: identityContext.phoneHashes.length,
      historicalOrders: identityContext.historicalOrders.length,
      profileType: identityContext.profile?.profileType || null,
    });

    const peerSessions = identityContext.userKeys.length
      ? await prisma.session.findMany({
          where: {
            accountId: account_id,
            userKey: { in: identityContext.userKeys },
            sessionId: { not: session_id },
          },
          select: {
            sessionId: true,
            startedAt: true,
            lastEventAt: true,
            landingPageUrl: true,
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
            userKey: true,
          },
          orderBy: { startedAt: 'desc' },
          take: 24,
        })
      : [];

    const peerSessionIds = peerSessions.map((item) => item.sessionId).filter(Boolean);
    const peerEventRows = peerSessionIds.length
      ? await prisma.event.groupBy({
          by: ['sessionId', 'eventName'],
          where: {
            accountId: account_id,
            sessionId: { in: peerSessionIds },
          },
          _count: { _all: true },
        })
      : [];

    const peerTrackedUtmEvents = peerSessionIds.length
      ? await prisma.event.findMany({
          where: {
            accountId: account_id,
            sessionId: { in: peerSessionIds },
          },
          select: {
            sessionId: true,
            createdAt: true,
            collectedAt: true,
            pageUrl: true,
            rawPayload: true,
          },
          orderBy: { createdAt: 'asc' },
          take: 1500,
        })
      : [];

    const peerEventCounts = new Map();
    peerEventRows.forEach((row) => {
      const sessionIdKey = row.sessionId;
      if (!peerEventCounts.has(sessionIdKey)) peerEventCounts.set(sessionIdKey, { _totalEvents: 0 });
      const current = peerEventCounts.get(sessionIdKey);
      const bucket = resolveEventBucket(row.eventName);
      current[bucket] = Number(current[bucket] || 0) + Number(row._count?._all || 0);
      current._totalEvents = Number(current._totalEvents || 0) + Number(row._count?._all || 0);
      peerEventCounts.set(sessionIdKey, current);
    });

    const normalizedPeerSessions = peerSessions.map((item) => ({
      ...item,
      _totalEvents: Number(peerEventCounts.get(item.sessionId)?._totalEvents || 0),
    }));

    const metrics = {
      totalEvents: events.length,
      logins: 0,
      pageViews: 0,
      viewItem: 0,
      addToCart: 0,
      beginCheckout: 0,
      purchase: 0,
      revenue: 0,
      uniquePages: 0,
      uniqueProducts: 0,
      orderCount: currentSessionOrders.length,
    };

    const pageSet = new Set();
    const productSet = new Set();
    const pageMap = new Map();
    const productMap = new Map();
    const timeline = events.map((event) => {
      const bucket = resolveEventBucket(event.eventName);
      if (bucket === 'login') metrics.logins += 1;
      if (bucket === 'page_view') metrics.pageViews += 1;
      if (bucket === 'view_item') metrics.viewItem += 1;
      if (bucket === 'add_to_cart') metrics.addToCart += 1;
      if (bucket === 'begin_checkout') metrics.beginCheckout += 1;
      if (bucket === 'purchase') metrics.purchase += 1;
      metrics.revenue += Number(event.revenue || 0);

      if (event.pageUrl) pageSet.add(event.pageUrl);
      if (event.productId) productSet.add(String(event.productId));
      if (event.checkoutToken) checkoutTokenSet.add(String(event.checkoutToken));

      if (event.pageUrl) {
        const currentPage = pageMap.get(event.pageUrl) || {
          url: event.pageUrl,
          hits: 0,
          firstSeenAt: event.createdAt,
          lastSeenAt: event.createdAt,
        };
        currentPage.hits += 1;
        currentPage.lastSeenAt = event.createdAt;
        pageMap.set(event.pageUrl, currentPage);
      }

      if (event.productId) {
        const productKey = String(event.productId);
        const currentProduct = productMap.get(productKey) || {
          productId: productKey,
          events: 0,
          firstSeenAt: event.createdAt,
          lastSeenAt: event.createdAt,
        };
        currentProduct.events += 1;
        currentProduct.lastSeenAt = event.createdAt;
        productMap.set(productKey, currentProduct);
      }

      return {
        eventId: event.eventId,
        eventName: event.eventName,
        bucket,
        createdAt: event.createdAt,
        collectedAt: event.collectedAt || null,
        rawSource: event.rawSource || null,
        matchType: event.matchType || null,
        confidenceScore: event.confidenceScore,
        ipHash: event.ipHash || null,
        pageUrl: event.pageUrl,
        pageType: event.pageType,
        productId: event.productId,
        variantId: event.variantId,
        cartId: event.cartId,
        cartValue: event.cartValue,
        checkoutToken: event.checkoutToken,
        orderId: event.orderId,
        revenue: event.revenue,
        currency: event.currency,
        utmSource: event?.rawPayload?.utm_source || null,
        utmCampaign: event?.rawPayload?.utm_campaign || null,
        customerId: event?.rawPayload?.customer_id || null,
        customerName: event?.rawPayload?.customer_name || null,
        customerEmail: event?.rawPayload?.email || event?.rawPayload?.customer_email || null,
      };
    });

    metrics.uniquePages = pageSet.size;
    metrics.uniqueProducts = productSet.size;

    const pathHighlights = Array.from(pageMap.values())
      .sort((a, b) => {
        if (b.hits !== a.hits) return b.hits - a.hits;
        return new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime();
      })
      .slice(0, 8);

    const productHighlights = Array.from(productMap.values())
      .sort((a, b) => {
        if (b.events !== a.events) return b.events - a.events;
        return new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime();
      })
      .slice(0, 8);

    const attributedTouchpoint = stitchSnapshotAttributionForAccount(toSnapshotFromSession(session) || {}, account_id);
    const pageUrlsInOrder = timeline.map((item) => item.pageUrl).filter(Boolean);
    const currentPath = compactSessionPath(timeline);
    const utmHistory = buildRecognizedUserTrackedUtmHistory({
      currentSession: session,
      peerSessions,
      currentEvents: events,
      peerEvents: peerTrackedUtmEvents,
    });
    const patterns = buildBehaviorPatternSummary({
      currentSession: session,
      currentMetrics: metrics,
      peerSessions: normalizedPeerSessions,
      peerEventCounts,
      currentPath,
    });

    const historicalOrdersWithItems = identityContext.historicalOrders.map((order) => ({
      ...order,
      lineItems: normalizeLineItems(order.lineItems),
    }));
    const topProducts = buildProductAffinityFromOrders(historicalOrdersWithItems);
    const topPairings = buildTopProductPairings(historicalOrdersWithItems);
    const actionRecommendations = buildActionRecommendations({
      topProducts,
      topPairings,
      totalOrders: historicalOrdersWithItems.length,
      sessionSignals: {
        viewItem: metrics.viewItem,
        addToCart: metrics.addToCart,
        beginCheckout: metrics.beginCheckout,
        purchase: metrics.purchase,
      },
      profileLabel: identityContext.profile?.profileLabel || 'este perfil',
    });

    const sessionDurationSeconds = session.startedAt && session.lastEventAt
      ? Math.max(0, Math.round((new Date(session.lastEventAt).getTime() - new Date(session.startedAt).getTime()) / 1000))
      : 0;

    res.json({
      session: {
        ...session,
        sessionEndAt: session.sessionEndAt || session.lastEventAt || null,
        sessionDurationSeconds,
      },
      metrics,
      journey: {
        entryPage: pageUrlsInOrder[0] || session.landingPageUrl || null,
        exitPage: pageUrlsInOrder[pageUrlsInOrder.length - 1] || null,
        checkoutTokens: Array.from(checkoutTokenSet),
        pages: pathHighlights,
        products: productHighlights,
        attribution: {
          channel: attributedTouchpoint.channel || 'unattributed',
          platform: attributedTouchpoint.platform || null,
          campaign: attributedTouchpoint.campaign || null,
          clickId: attributedTouchpoint.clickId || null,
          confidence: Number(attributedTouchpoint.confidence || 0),
          source: attributedTouchpoint.source || 'none',
        },
      },
      patterns,
      commerceProfile: {
        topProducts,
        topPairings,
        totalOrders: historicalOrdersWithItems.length,
        totalRevenue: historicalOrdersWithItems.reduce((sum, order) => sum + Number(order.revenue || 0), 0),
        lastOrderAt: historicalOrdersWithItems[0]?.platformCreatedAt || historicalOrdersWithItems[0]?.createdAt || null,
      },
      actionRecommendations,
      profile: {
        ...identityContext.profile,
        userKeys: identityContext.userKeys,
        customerIds: identityContext.customerIds,
        emailHashes: identityContext.emailHashes,
        phoneHashes: identityContext.phoneHashes,
        relatedSessionCount: normalizedPeerSessions.length + 1,
        historicalOrderCount: identityContext.historicalOrders.length,
      },
      identifiedUser: identityContext.identifiedUser,
      utmHistory,
      loginEvents: identityContext.loginEvents,
      peers: normalizedPeerSessions.map((item) => {
        const counts = peerEventCounts.get(item.sessionId) || {};
        const durationSeconds = item.startedAt && item.lastEventAt
          ? Math.max(0, Math.round((new Date(item.lastEventAt).getTime() - new Date(item.startedAt).getTime()) / 1000))
          : 0;

        return {
          sessionId: item.sessionId,
          startedAt: item.startedAt,
          lastEventAt: item.lastEventAt,
          landingPageUrl: item.landingPageUrl || null,
          utmCampaign: item.utmCampaign || null,
          totalEvents: Number(item._totalEvents || 0),
          durationSeconds,
          flags: {
            viewedProduct: Number(counts.view_item || 0) > 0,
            addedToCart: Number(counts.add_to_cart || 0) > 0,
            reachedCheckout: Number(counts.begin_checkout || 0) > 0,
            purchased: Number(counts.purchase || 0) > 0,
          },
        };
      }),
      timeline,
      orders: identityContext.historicalOrders.map((order) => ({
        ...order,
        isCurrentSession: order.sessionId === session_id,
      })),
    });
  } catch (error) {
    console.error('[Analytics API] Session detail error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/:account_id/users/:userKey/timeline', async (req, res) => {
  try {
    const { account_id, userKey } = req.params;

    const seedIdentityRows = await prisma.identityGraph.findMany({
      where: { accountId: account_id, userKey },
      select: {
        userKey: true,
        customerId: true,
        emailHash: true,
        phoneHash: true,
        fingerprintHash: true,
      },
    });

    const seedUserKeys = collectUniqueStrings([userKey, ...seedIdentityRows.map((row) => row.userKey)]);
    const seedCustomerIds = collectUniqueStrings(seedIdentityRows.map((row) => row.customerId));
    const seedEmailHashes = collectUniqueStrings(seedIdentityRows.map((row) => row.emailHash));
    const seedPhoneHashes = collectUniqueStrings(seedIdentityRows.map((row) => row.phoneHash));
    const seedFingerprintHashes = collectUniqueStrings(seedIdentityRows.map((row) => row.fingerprintHash));

    const sharedIdentityClauses = buildIdentityOrClauses({
      userKeys: seedUserKeys,
      customerIds: seedCustomerIds,
      emailHashes: seedEmailHashes,
      phoneHashes: seedPhoneHashes,
      fingerprintHashes: seedFingerprintHashes,
    });

    const sharedIdentityRows = sharedIdentityClauses.length
      ? await prisma.identityGraph.findMany({
          where: {
            accountId: account_id,
            OR: sharedIdentityClauses,
          },
          select: {
            userKey: true,
            customerId: true,
            emailHash: true,
            phoneHash: true,
            fbp: true,
            fbc: true,
            fingerprintHash: true,
            firstSeenAt: true,
            lastSeenAt: true,
            deviceCount: true,
            confidenceScore: true,
          },
        })
      : [];

    const finalUserKeys = collectUniqueStrings([
      ...seedUserKeys,
      ...sharedIdentityRows.map((row) => row.userKey),
    ]);
    const finalCustomerIds = collectUniqueStrings([
      ...seedCustomerIds,
      ...sharedIdentityRows.map((row) => row.customerId),
    ]);
    const finalEmailHashes = collectUniqueStrings([
      ...seedEmailHashes,
      ...sharedIdentityRows.map((row) => row.emailHash),
    ]);
    const finalPhoneHashes = collectUniqueStrings([
      ...seedPhoneHashes,
      ...sharedIdentityRows.map((row) => row.phoneHash),
    ]);
    const finalFingerprintHashes = collectUniqueStrings([
      ...seedFingerprintHashes,
      ...sharedIdentityRows.map((row) => row.fingerprintHash),
    ]);

    const orderClauses = buildOrderIdentityOrClauses({
      userKeys: finalUserKeys,
      customerIds: finalCustomerIds,
      emailHashes: finalEmailHashes,
      phoneHashes: finalPhoneHashes,
    });

    const [sessions, events, orders] = await Promise.all([
      finalUserKeys.length
        ? prisma.session.findMany({
            where: {
              accountId: account_id,
              userKey: { in: finalUserKeys },
            },
            orderBy: { startedAt: 'desc' },
            take: 250,
          })
        : Promise.resolve([]),
      finalUserKeys.length
        ? prisma.event.findMany({
            where: {
              accountId: account_id,
              userKey: { in: finalUserKeys },
            },
            orderBy: { createdAt: 'desc' },
            take: 2000,
          })
        : Promise.resolve([]),
      orderClauses.length
        ? prisma.order.findMany({
            where: {
              accountId: account_id,
              OR: orderClauses,
            },
            orderBy: [{ platformCreatedAt: 'desc' }, { createdAt: 'desc' }],
            take: 500,
          })
        : Promise.resolve([]),
    ]);

    const identity = sharedIdentityRows
      .slice()
      .sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime())[0] || null;

    // Since customer name might be in order's attributionSnapshot, let's try to extract it
    let customerName = null;
    let customerEmailPreview = null;
    let customerEmailHash = identity?.emailHash || null;
    let customerPhoneHash = identity?.phoneHash || null;

    for (const order of orders) {
       if (!customerName) {
         customerName = extractOrderCustomerDisplayName(order.attributionSnapshot);
       }
       if (!customerEmailPreview) customerEmailPreview = extractOrderCustomerEmailPreview(order.attributionSnapshot);
       if (order.emailHash && !customerEmailHash) customerEmailHash = order.emailHash;
       if (order.phoneHash && !customerPhoneHash) customerPhoneHash = order.phoneHash;
    }

    const profileDescriptor = buildIdentityProfileDescriptor({
      customerId: finalCustomerIds[0] || null,
      emailHash: finalEmailHashes[0] || null,
      phoneHash: finalPhoneHashes[0] || null,
      userKey: finalUserKeys[0] || userKey || null,
      customerDisplayName: customerName,
      emailPreview: customerEmailPreview,
    });

    const attributionStats = orders.reduce((acc, order) => {
      const channel = normalizeChannelForStats(
        order?.attributedChannel || 'unattributed',
        order?.attributedPlatform || order?.attributionSnapshot?.utm_source || order?.attributionSnapshot?.referrer || ''
      );
      const revenue = Number(order?.revenue || 0);
      if (!acc[channel]) acc[channel] = { orders: 0, revenue: 0 };
      acc[channel].orders += 1;
      acc[channel].revenue += revenue;
      return acc;
    }, {});

    const eventMetrics = events.reduce((acc, event) => {
      const bucket = resolveEventBucket(event.eventName);
      acc.total += 1;
      if (bucket === 'add_to_cart') acc.addToCart += 1;
      if (bucket === 'begin_checkout') acc.beginCheckout += 1;
      if (bucket === 'purchase') acc.purchaseEvents += 1;
      return acc;
    }, { total: 0, addToCart: 0, beginCheckout: 0, purchaseEvents: 0 });

    const totalRevenue = orders.reduce((sum, order) => sum + Number(order.revenue || 0), 0);
    const firstSeenAt = sessions.length ? sessions[sessions.length - 1].startedAt : (identity?.firstSeenAt || null);
    const lastSeenAt = sessions[0]?.lastEventAt || sessions[0]?.startedAt || identity?.lastSeenAt || null;

    res.json({
      success: true,
      user: {
        userKey,
        stitchedUserKeys: finalUserKeys,
        stitchedCustomerIds: finalCustomerIds,
        stitchedEmailHashes: finalEmailHashes,
        stitchedPhoneHashes: finalPhoneHashes,
        profileKey: profileDescriptor.profileKey,
        profileType: profileDescriptor.profileType,
        profileLabel: profileDescriptor.profileLabel,
        name: customerName,
        emailHash: customerEmailHash,
        phoneHash: customerPhoneHash,
        identity,
      },
      summary: {
        firstSeenAt,
        lastSeenAt,
        totalSessions: sessions.length,
        totalEvents: eventMetrics.total,
        totalOrders: orders.length,
        totalRevenue,
        totalAddToCart: eventMetrics.addToCart,
        totalBeginCheckout: eventMetrics.beginCheckout,
        totalPurchaseEvents: eventMetrics.purchaseEvents,
        attribution: attributionStats,
      },
      sessions,
      events,
      orders
    });
  } catch (error) {
    console.error('[Analytics API] User timeline error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
module.exports.__testables = {
  normalizeLineItems,
  finalizeAnalyticsExportEvents,
  normalizeAnalyticsExportPlatformValue,
  resolveAnalyticsExportResolvedAttributionLabel,
  normalizeAnalyticsExportChannelValue,
  formatAnalyticsCsvDecimal,
  reconcileAnalyticsLineItemsToOrderSubtotal,
  resolveAnalyticsJourneyTouchpoint,
};

