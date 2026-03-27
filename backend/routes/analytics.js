
const express = require('express');
const router = express.Router();
const prisma = require('../utils/prismaClient');
const { startOfDay, endOfDay, subDays, eachDayOfInterval, format } = require('date-fns');
const { getCustomerDisplayNames } = require('../services/shopifyService');
const { hashPII } = require('../utils/encryption');

let McpData = null;
let ShopConnections = null;
let User = null;
let MetaAccount = null;
let GoogleAccount = null;
let formatMetaForLlmMini = null;
let formatGoogleAdsForLlmMini = null;

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
const ATTRIBUTION_MODELS = new Set(['first_touch', 'last_touch', 'linear']);
const ATTRIBUTION_LOOKBACK_DAYS = 30;
const JOURNEY_STITCH_LOOKBACK_DAYS = 7;
const ROUTE_RESPONSE_CACHE = new Map();
const ROUTE_CACHE_MAX_ENTRIES = 300;

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
    if (ROUTE_RESPONSE_CACHE.size <= ROUTE_CACHE_MAX_ENTRIES) break;
  }
}

router.use('/:account_id', (req, res, next) => {
  const accountId = req.params?.account_id;
  if (isAccountAllowed(accountId)) return next();
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
  if (rootDoc?.latestSnapshotId) return rootDoc.latestSnapshotId;

  const datasetPrefix = source === 'googleAds' ? '^google\\.' : '^meta\\.';
  const latestChunk = await McpData.findOne({
    userId,
    source,
    dataset: { $regex: datasetPrefix },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

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

  return docs.filter(isChunkMcpDoc);
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

async function resolvePaidMediaUserId({ accountId, domain, platformConnections = [] }) {
  const candidates = Array.from(new Set([
    normalizeShopDomain(accountId),
    normalizeShopDomain(domain),
  ].filter(Boolean)));

  const fromShopConnection = await resolveUserIdByShopConnection(candidates);
  if (fromShopConnection) return fromShopConnection;

  const fromUserShop = await resolveUserIdByUserShop(candidates);
  if (fromUserShop) return fromUserShop;

  const fromConnectedAccounts = await resolveUserIdByConnectedAccountDocs(platformConnections);
  if (fromConnectedAccounts) return fromConnectedAccounts;

  const fromPlatformConnections = await resolveUserIdByPlatformConnections(platformConnections);
  if (fromPlatformConnections) return fromPlatformConnections;

  return null;
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
  };
}

async function buildPaidMediaSummary({ accountId, domain, platformConnections = [] }) {
  const base = {
    linked: false,
    available: false,
    reason: 'not_linked',
    meta: buildPaidMediaSourceSummary({ sourceState: null, payload: null, snapshotId: null, revenueKey: 'purchase_value' }),
    google: buildPaidMediaSourceSummary({ sourceState: null, payload: null, snapshotId: null, revenueKey: 'conversion_value' }),
    blended: {
      spend: 0,
      revenue: 0,
      roas: null,
      currency: null,
    },
  };

  if (!McpData || !formatMetaForLlmMini || !formatGoogleAdsForLlmMini) {
    return { ...base, reason: 'marketing_models_unavailable' };
  }

  try {
    const userId = await resolvePaidMediaUserId({ accountId, domain, platformConnections });
    if (!userId) return base;

    const rootDoc = await findMcpRoot(userId);
    if (!rootDoc) {
      return { ...base, linked: true, reason: 'root_not_found' };
    }

    const [metaSnapshotId, googleSnapshotId] = await Promise.all([
      findLatestSnapshotId(userId, 'metaAds', rootDoc),
      findLatestSnapshotId(userId, 'googleAds', rootDoc),
    ]);

    const [metaChunks, googleChunks] = await Promise.all([
      findMcpChunks(userId, 'metaAds', metaSnapshotId, 'meta.'),
      findMcpChunks(userId, 'googleAds', googleSnapshotId, 'google.'),
    ]);

    const metaPayload = metaChunks.length ? formatMetaForLlmMini({ datasets: metaChunks, topCampaigns: 4 }) : null;
    const googlePayload = googleChunks.length ? formatGoogleAdsForLlmMini({ datasets: googleChunks, topCampaigns: 4 }) : null;

    const meta = buildPaidMediaSourceSummary({
      sourceState: rootDoc?.sources?.metaAds || null,
      payload: metaPayload,
      snapshotId: metaSnapshotId,
      revenueKey: 'purchase_value',
    });

    const google = buildPaidMediaSourceSummary({
      sourceState: rootDoc?.sources?.googleAds || null,
      payload: googlePayload,
      snapshotId: googleSnapshotId,
      revenueKey: 'conversion_value',
    });

    const blendedSpend = meta.spend + google.spend;
    const blendedRevenue = meta.revenue + google.revenue;
    const hasAnySnapshot = meta.hasSnapshot || google.hasSnapshot;

    return {
      linked: true,
      available: hasAnySnapshot,
      reason: hasAnySnapshot ? null : 'snapshots_not_found',
      meta,
      google,
      blended: {
        spend: blendedSpend,
        revenue: blendedRevenue,
        roas: blendedSpend > 0 ? Number((blendedRevenue / blendedSpend).toFixed(2)) : null,
        currency: meta.currency || google.currency || null,
      },
    };
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

function stitchSnapshotAttribution(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
  }

  if (snapshot.fbclid) {
    return {
      channel: 'paid_social',
      platform: 'facebook',
      clickId: snapshot.fbclid,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  if (snapshot.gclid) {
    return {
      channel: 'paid_search',
      platform: 'google',
      clickId: snapshot.gclid,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 1.0,
      source: 'click_id',
    };
  }

  if (snapshot.ttclid) {
    return {
      channel: 'paid_social',
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
    return {
      channel: snapshot.utm_medium || 'referral',
      platform: snapshot.utm_source,
      campaign: snapshot.utm_campaign || null,
      adset: snapshot.utm_content || null,
      ad: snapshot.utm_term || null,
      confidence: 0.85,
      source: 'utm',
    };
  }

  if (snapshot.referrer) {
    const domain = getDomain(snapshot.referrer);
    if (!domain) {
      return { channel: 'unattributed', platform: null, confidence: 0.0, source: 'none' };
    }
    if (['google.com', 'bing.com', 'yahoo.com'].some((d) => domain.includes(d))) {
      return { channel: 'organic_search', platform: domain, confidence: 0.7, source: 'referrer' };
    }
    if (['facebook.com', 'instagram.com', 't.co', 'twitter.com'].some((d) => domain.includes(d))) {
      return { channel: 'organic_social', platform: domain, confidence: 0.7, source: 'referrer' };
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

function normalizeChannelForStats(channelRaw) {
  let ch = String(channelRaw || 'unattributed').toLowerCase();
  if (ch === 'facebook' || ch === 'instagram' || ch === 'paid_social') ch = 'meta';
  if (ch === 'paid_search') ch = 'google';
  if (ch !== 'meta' && ch !== 'google' && ch !== 'tiktok' && ch !== 'unattributed') ch = 'other';
  return ch;
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
  return arr.map((item) => ({
    id: String(item?.product_id || item?.productId || item?.id || item?.variant_id || item?.variantId || ''),
    name: String(item?.name || item?.title || 'Producto'),
    quantity: Number(item?.quantity || item?.qty || 1),
    price: Number(item?.price || item?.unit_price || item?.unitPrice || 0),
    lineTotal: Number(
      item?.line_total ?? item?.lineTotal ?? item?.total ?? item?.final_line_price ?? item?.finalLinePrice ?? 0
    ),
  }));
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
    const ch = normalizeChannelForStats(tp?.attribution?.channel);
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
    const channel = normalizeChannelForStats(first.channel);
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
      const ch = normalizeChannelForStats(tp.attribution.channel);
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

  const last = valid[valid.length - 1].attribution;
  const channel = normalizeChannelForStats(last.channel);
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

  if (utmSource === 'google') {
    return {
      channel: 'google',
      platform: 'google',
      confidence: 0.6,
      source: 'woo_fallback',
    };
  }

  if (utmSource === 'facebook' || utmSource === 'instagram') {
    return {
      channel: 'meta',
      platform: utmSource,
      confidence: 0.6,
      source: 'woo_fallback',
    };
  }

  if (utmSource === 'tiktok') {
    return {
      channel: 'tiktok',
      platform: 'tiktok',
      confidence: 0.6,
      source: 'woo_fallback',
    };
  }

  if (sourceLabel) {
    const normalized = sourceLabel.toLowerCase();
    if (normalized.includes('google')) {
      return {
        channel: 'google',
        platform: 'google',
        confidence: 0.55,
        source: 'woo_fallback',
      };
    }
      if (normalized.includes('yahoo')) {
        return {
          channel: 'other',
          platform: 'mx.search.yahoo.com',
          confidence: 0.55,
          source: 'woo_fallback',
        };
      }
      if (normalized.includes('hostinger')) {
        return {
          channel: 'other',
          platform: 'hpanel.hostinger.com',
          confidence: 0.55,
          source: 'woo_fallback',
        };
      }
    if (normalized.includes('facebook') || normalized.includes('instagram')) {
      return {
        channel: 'meta',
        platform: 'meta',
        confidence: 0.55,
        source: 'woo_fallback',
      };
    }
    if (normalized.includes('tiktok')) {
      return {
        channel: 'tiktok',
        platform: 'tiktok',
        confidence: 0.55,
        source: 'woo_fallback',
      };
    }
    if (normalized.includes('directo') || normalized.includes('direct')) {
      return {
        channel: 'direct',
        platform: 'direct',
        confidence: 0.5,
        source: 'woo_fallback',
      };
    }
  }

  if (sourceType === 'direct') {
    return {
      channel: 'direct',
      platform: 'direct',
      confidence: 0.5,
      source: 'woo_fallback',
    };
  }

  return null;
}

// Use existing sessionGuard from index.js mount, assuming it's available or implemented here?
// The pipeline says "All routes require sessionGuard".
// For now, I'll rely on index.js to wrap this router with sessionGuard.

/**
 * GET /api/analytics/:account_id
 * Returns core dashboard metrics: Revenue, Orders, Attribution Breakdown
 */
router.get('/:account_id', async (req, res) => {
  try {
    const { account_id } = req.params;
    const { start, end } = req.query;
    const requestedModelRaw = String(req.query.attribution_model || req.query.attributionModel || 'last_touch').toLowerCase();
    const attributionModel = ATTRIBUTION_MODELS.has(requestedModelRaw) ? requestedModelRaw : 'last_touch';
    const allTime = String(req.query.all_time || '0') === '1';
    const recentLimitRaw = String(req.query.recent_limit || '100').toLowerCase();
    const recentLimit = recentLimitRaw === 'all'
      ? 5000
      : Math.max(15, Math.min(1000, Number.parseInt(recentLimitRaw, 10) || 100));

    const analyticsCacheKey = buildRouteCacheKey('analytics', req);
    const cachedAnalytics = readRouteCache(analyticsCacheKey);
    if (cachedAnalytics) {
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
      select: {
        createdAt: true,
        platformCreatedAt: true,
        revenue: true,
        currency: true,
        attributedChannel: true,
        attributionSnapshot: true,
        confidenceScore: true,
        attributionModel: true,
        checkoutToken: true,
        userKey: true,
        orderId: true,
        orderNumber: true,
        lineItems: true
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
        select: { platform: true, status: true, updatedAt: true },
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

    try {
      paidMedia = await buildPaidMediaSummary({
        accountId: account_id,
        domain: accountRecord?.domain || account_id,
        platformConnections,
      });
    } catch (paidMediaError) {
      warnings.push({
        label: 'paid_media.summary',
        error: String(paidMediaError?.message || paidMediaError),
      });
    }

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
      let ch = (order.attributedChannel || 'unattributed').toLowerCase();
      if (ch === 'facebook' || ch === 'instagram') ch = 'meta';

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

    const purchaseEventsForModel = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: startDate, lte: endDate },
        eventName: { in: PURCHASE_ALIASES },
      },
      select: {
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
      revenue: Number(order.revenue || 0),
      currency: order.currency || 'MXN',
      items: normalizeLineItems(order.lineItems),
      orderAttributedChannel: order.attributedChannel || null,
      orderAttributionSnapshot: order.attributionSnapshot || null,
      orderAttributionConfidence: Number(order.confidenceScore || 0),
      orderAttributionModel: order.attributionModel || null,
      wooSourceLabel: order?.attributionSnapshot?.woo_source_label || null,
      wooSourceType: order?.attributionSnapshot?.woo_source_type || null,
      customerName: extractOrderCustomerDisplayName(order.attributionSnapshot),
      payloadSnapshot: order.attributionSnapshot || null,
    }));

    const conversionInputsFromEvents = purchaseEventsForModel.map((ev) => {
      const eventIdentity = extractEventIdentity(ev?.rawPayload || {});
      return {
        source: 'events',
        createdAt: ev.createdAt,
        orderId: ev.orderId || null,
        orderNumber: null,
        checkoutToken: ev.checkoutToken || null,
        sessionId: ev.sessionId || null,
        userKey: ev.userKey || null,
        customerId: eventIdentity.customerId || null,
        emailHash: eventIdentity.emailHash || null,
        phoneHash: eventIdentity.phoneHash || null,
        revenue: Number(ev.revenue || 0),
        currency: ev.currency || 'MXN',
        items: [],
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
      });

      const orderStoredAttribution = (conv.source === 'orders' && conv.orderAttributedChannel && conv.orderAttributedChannel !== 'unattributed')
        ? {
            primary: {
              channel: conv.orderAttributedChannel,
              platform: conv?.wooSourceLabel || conv?.orderAttributionSnapshot?.utm_source || conv.orderAttributedChannel,
              campaign: conv?.orderAttributionSnapshot?.utm_campaign || null,
              adset: conv?.orderAttributionSnapshot?.utm_content || null,
              ad: conv?.orderAttributionSnapshot?.utm_term || null,
              clickId: conv?.orderAttributionSnapshot?.gclid || conv?.orderAttributionSnapshot?.fbclid || conv?.orderAttributionSnapshot?.ttclid || null,
              confidence: Number(conv.orderAttributionConfidence || 0.75),
              source: String(conv.orderAttributionModel || '').startsWith('woo_') ? 'woo_fallback' : 'orders_sync',
            },
            splits: [{ channel: conv.orderAttributedChannel, weight: 1 }],
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
    const recentCheckoutTokens = Array.from(new Set(recentConversions.map((c) => c.checkoutToken).filter(Boolean)));
    let recentSessionIds = Array.from(new Set(recentConversions.map((c) => c.sessionId).filter(Boolean)));
    let recentUserKeys = Array.from(new Set(recentConversions.map((c) => c.userKey).filter(Boolean)));
    const recentCustomerIds = Array.from(new Set(recentConversions.map((c) => c.customerId).filter(Boolean)));
    const recentEmailHashes = Array.from(new Set(recentConversions.map((c) => c.emailHash).filter(Boolean)));
    const recentPhoneHashes = Array.from(new Set(recentConversions.map((c) => c.phoneHash).filter(Boolean)));

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
      });

      if (identityClauses.length) {
        const identityRowsForJourney = await prisma.identityGraph.findMany({
          where: {
            accountId: account_id,
            OR: identityClauses,
          },
          select: {
            userKey: true,
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
          pageUrl: true,
          productId: true,
          orderId: true,
          checkoutToken: true,
          sessionId: true,
          userKey: true,
          rawPayload: true,
        },
        orderBy: { createdAt: 'asc' },
      });
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

      const purchaseEventCandidates = stitchedCandidateEvents.filter(ev => Boolean(conv.orderId && ev.orderId && String(ev.orderId) === String(conv.orderId)) || Boolean(conv.checkoutToken && ev.checkoutToken && String(ev.checkoutToken) === String(conv.checkoutToken)));
      const inferredSessionId = conv.sessionId || purchaseEventCandidates.find(e => e.sessionId)?.sessionId;
      const inferredUserKey = conv.userKey || purchaseEventCandidates.find(e => e.userKey)?.userKey;

      let stitchedEvents = stitchedCandidateEvents
        .filter((ev) => {
          const evTs = new Date(ev.createdAt).getTime();
          if (!Number.isFinite(evTs)) return false;
          if (evTs < earliestTs || evTs > latestTs) return false;

          const byOrder = Boolean(conv.orderId && ev.orderId && String(ev.orderId) === String(conv.orderId));
          const byCheckout = Boolean(conv.checkoutToken && ev.checkoutToken && String(ev.checkoutToken) === String(conv.checkoutToken));
          const bySession = Boolean(inferredSessionId && ev.sessionId && String(ev.sessionId) === String(inferredSessionId));
          const byUser = Boolean(inferredUserKey && ev.userKey && String(ev.userKey) === String(inferredUserKey));
          const eventIdentity = extractEventIdentity(ev.rawPayload || {});
          const byCustomer = Boolean(conv.customerId && eventIdentity.customerId && String(eventIdentity.customerId) === String(conv.customerId));

          return byOrder || byCheckout || bySession || byUser || byCustomer;
        })
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

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
              pageUrl: true,
              productId: true,
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
          pageUrl: ev.pageUrl || null,
          productId: ev.productId || null,
          productName: ev?.rawPayload?.product_name || ev?.rawPayload?.item_name || ev?.rawPayload?.name || null,
          itemId: ev?.rawPayload?.item_id || ev?.rawPayload?.product_id || null,
          utmSource: ev?.rawPayload?.utm_source || null,
          checkoutToken: ev.checkoutToken || null,
          orderId: ev.orderId || null,
        }));

      return {
        ...conv,
        items: normalizedItems,
        events: journeyEvents,
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
        const ch = normalizeChannelForStats(split.channel);
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

    writeRouteCache(analyticsCacheKey, responsePayload, 120000);
    res.json(responsePayload);

  } catch (error) {
    console.error('[Analytics API] Error:', error);
    if (isDatabaseConnectivityError(error)) {
      const { account_id } = req.params;
      const fallbackModelRaw = String(req.query.attribution_model || req.query.attributionModel || 'last_touch').toLowerCase();
      const fallbackAttributionModel = ATTRIBUTION_MODELS.has(fallbackModelRaw) ? fallbackModelRaw : 'last_touch';
      const fallbackRecentLimitRaw = String(req.query.recent_limit || req.query.recentLimit || '100').toLowerCase();
      const fallbackRecentLimit = fallbackRecentLimitRaw === 'all' 
        ? 5000 
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

function extractEventIdentity(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object'
    ? rawPayload
    : {};

  const customer = payload.customer && typeof payload.customer === 'object' ? payload.customer : {};
  const billing = payload.billing && typeof payload.billing === 'object' ? payload.billing : {};
  const userData = payload.user_data && typeof payload.user_data === 'object' ? payload.user_data : {};

  const email = String(payload.email || payload.customer_email || '').trim().toLowerCase();
  const phone = String(payload.phone || payload.customer_phone || '').trim();

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

function buildIdentityProfileDescriptor({ customerId, emailHash, phoneHash, userKey, customerDisplayName }) {
  const normalizedCustomerId = normalizeWooCustomerId(customerId);
  const normalizedCustomerDisplayName = normalizeCustomerDisplayName(customerDisplayName);

  if (normalizedCustomerId) {
    return {
      profileKey: `customer:${normalizedCustomerId}`,
      profileType: 'woocommerce_customer',
      customerDisplayName: normalizedCustomerDisplayName,
      profileLabel: normalizedCustomerDisplayName ? `${normalizedCustomerDisplayName} · Woo #${normalizedCustomerId}` : `Woo customer #${normalizedCustomerId}`,
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

function buildIdentityOrClauses({ userKeys = [], customerIds = [], emailHashes = [], phoneHashes = [] }) {
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
        attributedChannel: true,
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

  const sharedIdentityClauses = buildIdentityOrClauses({
    userKeys: seedUserKeys,
    customerIds: seedCustomerIds,
    emailHashes: seedEmailHashes,
    phoneHashes: seedPhoneHashes,
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

  const historicalOrderClauses = buildIdentityOrClauses({
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
          attributedChannel: true,
        },
        orderBy: [{ platformCreatedAt: 'desc' }, { createdAt: 'desc' }],
        take: 250,
      })
    : [];

  const resolvedCustomerDisplayName = historicalOrders
    .map((order) => extractOrderCustomerDisplayName(order.attributionSnapshot) || extractOrderCustomerDisplayName(order.rawPayload))
    .find(Boolean)
    || latestIdentitySignal?.customerDisplayName
    || null;

  const profileDescriptor = buildIdentityProfileDescriptor({
    customerId: finalCustomerIds[0] || null,
    emailHash: finalEmailHashes[0] || null,
    phoneHash: finalPhoneHashes[0] || null,
    userKey: finalUserKeys[0] || sessionUserKey || null,
    customerDisplayName: resolvedCustomerDisplayName,
  });

  return {
    userKeys: finalUserKeys,
    customerIds: finalCustomerIds,
    emailHashes: finalEmailHashes,
    phoneHashes: finalPhoneHashes,
    profile: profileDescriptor,
    identifiedUser: {
      customerId: finalCustomerIds[0] || latestIdentitySignal?.customerId || null,
      customerDisplayName: resolvedCustomerDisplayName,
      emailPreview: latestIdentitySignal?.emailPreview || null,
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

    const recentEvents = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: since },
      },
      select: {
        eventName: true,
        createdAt: true,
        sessionId: true,
        userKey: true,
        rawPayload: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
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

    const users = Array.from(userMap.values())
      .filter((item) => item.lastAuthState !== 'logout')
      .map((item) => ({
        id: item.id,
        customerId: item.customerId,
        customerName: item.customerName,
        emailPreview: item.emailPreview,
        phonePreview: item.phonePreview,
        sessionCount: item.sessionIds.size,
        sessionIds: Array.from(item.sessionIds),
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
          attributionSnapshot: true,
          createdAt: true,
          platformCreatedAt: true,
          attributedChannel: true,
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

    const orderClauses = buildIdentityOrClauses({
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
            createdAt: true,
            platformCreatedAt: true,
            attributedChannel: true,
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
      return profile;
    };

    const orderSignalBySessionId = new Map();
    historicalOrders.forEach((order) => {
      const resolvedUserKey = order.userKey || checkoutByToken.get(order.checkoutToken || '')?.userKey || null;
      const identity = resolvedUserKey ? (identityByUserKey.get(resolvedUserKey) || {}) : {};
      const customerDisplayName = extractOrderCustomerDisplayName(order.attributionSnapshot) || extractOrderCustomerDisplayName(order.rawPayload) || identity.customerDisplayName || null;
      const signal = {
        customerId: order.customerId || null,
        emailHash: order.emailHash || null,
        phoneHash: order.phoneHash || null,
        userKey: resolvedUserKey,
        customerDisplayName,
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
      const customerDisplayName = extractOrderCustomerDisplayName(order.attributionSnapshot) || extractOrderCustomerDisplayName(order.rawPayload) || identity.customerDisplayName || null;
      const descriptor = buildIdentityProfileDescriptor({
        customerId: order.customerId || identity.customerId || null,
        emailHash: order.emailHash || identity.emailHash || null,
        phoneHash: order.phoneHash || identity.phoneHash || null,
        userKey: bridgedUserKey || null,
        customerDisplayName,
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
      return {
        ...profile,
        customerDisplayName: displayName,
        profileLabel: displayName ? `${displayName} · Woo #${customerId}` : profile.profileLabel,
      };
    });

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

    writeRouteCache(sessionExplorerCacheKey, responsePayload, 120000);
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
      safeFindMany('platform_connections.list', () => prisma.platformConnection.findMany({ where: { accountId: account_id }, select: { platform: true, status: true } }), []),
    ]);

    const paidMedia = await buildPaidMediaSummary({
      accountId: account_id,
      domain: accountRecord?.domain || account_id,
      platformConnections,
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
          attributionSnapshot: true,
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
      },
    });

    const seedUserKeys = collectUniqueStrings([userKey, ...seedIdentityRows.map((row) => row.userKey)]);
    const seedCustomerIds = collectUniqueStrings(seedIdentityRows.map((row) => row.customerId));
    const seedEmailHashes = collectUniqueStrings(seedIdentityRows.map((row) => row.emailHash));
    const seedPhoneHashes = collectUniqueStrings(seedIdentityRows.map((row) => row.phoneHash));

    const sharedIdentityClauses = buildIdentityOrClauses({
      userKeys: seedUserKeys,
      customerIds: seedCustomerIds,
      emailHashes: seedEmailHashes,
      phoneHashes: seedPhoneHashes,
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

    const orderClauses = buildIdentityOrClauses({
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
    let customerEmailHash = identity?.emailHash || null;
    let customerPhoneHash = identity?.phoneHash || null;

    for (const order of orders) {
       if (!customerName) {
           customerName = extractOrderCustomerDisplayName(order.attributionSnapshot) || extractOrderCustomerDisplayName(order.rawPayload?.billing || {});
       }
       if (order.emailHash && !customerEmailHash) customerEmailHash = order.emailHash;
       if (order.phoneHash && !customerPhoneHash) customerPhoneHash = order.phoneHash;
    }

    const profileDescriptor = buildIdentityProfileDescriptor({
      customerId: finalCustomerIds[0] || null,
      emailHash: finalEmailHashes[0] || null,
      phoneHash: finalPhoneHashes[0] || null,
      userKey: finalUserKeys[0] || userKey || null,
      customerDisplayName: customerName,
    });

    const attributionStats = orders.reduce((acc, order) => {
      const channel = normalizeChannelForStats(order?.attributedChannel || 'unattributed');
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

