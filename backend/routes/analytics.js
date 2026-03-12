
const express = require('express');
const router = express.Router();
const prisma = require('../utils/prismaClient');
const { startOfDay, endOfDay, subDays, eachDayOfInterval, format } = require('date-fns');

let McpData = null;
let ShopConnections = null;
let formatMetaForLlmMini = null;
let formatGoogleAdsForLlmMini = null;

try {
  McpData = require('../models/McpData');
} catch (_) {}

try {
  ShopConnections = require('../models/ShopConnections');
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
};

const PURCHASE_ALIASES = EVENT_BUCKET_ALIASES.purchase;
const ATTRIBUTION_MODELS = new Set(['first_touch', 'last_touch', 'linear']);
const ATTRIBUTION_LOOKBACK_DAYS = 30;

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

async function resolvePaidMediaUserId(accountId, domain) {
  if (!ShopConnections) return null;

  const candidates = Array.from(new Set([
    normalizeShopDomain(accountId),
    normalizeShopDomain(domain),
  ].filter(Boolean)));

  if (!candidates.length) return null;

  const shopConnection = await ShopConnections.findOne({
    shop: { $in: candidates },
    matchedToUserId: { $ne: null },
  })
    .select('matchedToUserId')
    .lean();

  return shopConnection?.matchedToUserId || null;
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

async function buildPaidMediaSummary({ accountId, domain }) {
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

  if (!McpData || !ShopConnections || !formatMetaForLlmMini || !formatGoogleAdsForLlmMini) {
    return { ...base, reason: 'marketing_models_unavailable' };
  }

  try {
    const userId = await resolvePaidMediaUserId(accountId, domain);
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

    // Default to last 30 days
    const startDate = allTime ? new Date(0) : (start ? startOfDay(new Date(start)) : startOfDay(subDays(new Date(), 30)));
    const endDate = end ? endOfDay(new Date(end)) : endOfDay(new Date());
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

    const paidMedia = await buildPaidMediaSummary({
      accountId: account_id,
      domain: accountRecord?.domain || account_id,
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
      userKey: order.userKey || null,
      revenue: Number(order.revenue || 0),
      currency: order.currency || 'MXN',
      items: normalizeLineItems(order.lineItems),
      orderAttributedChannel: order.attributedChannel || null,
      orderAttributionSnapshot: order.attributionSnapshot || null,
      orderAttributionConfidence: Number(order.confidenceScore || 0),
      orderAttributionModel: order.attributionModel || null,
      wooSourceLabel: order?.attributionSnapshot?.woo_source_label || null,
      wooSourceType: order?.attributionSnapshot?.woo_source_type || null,
      payloadSnapshot: order.attributionSnapshot || null,
    }));

    const conversionInputsFromEvents = purchaseEventsForModel.map((ev) => ({
      source: 'events',
      createdAt: ev.createdAt,
      orderId: ev.orderId || null,
      orderNumber: null,
      checkoutToken: ev.checkoutToken || null,
      userKey: ev.userKey || null,
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
    }));

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

    const recentPurchases = modeledConversions.slice(0, recentLimit).map((conv) => {
      if (conv.source === 'orders') return conv;
      const key = `${conv.orderId || ''}::${conv.checkoutToken || ''}::${new Date(conv.createdAt).toISOString()}`;
      const detailed = detailedByKey.get(key);
      return {
        ...conv,
        items: detailed ? normalizeLineItems(detailed.items) : conv.items,
      };
    });

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
    res.json({
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
    });

  } catch (error) {
    console.error('[Analytics API] Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
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
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        utmContent: true,
        utmTerm: true,
        referrer: true,
        landingPageUrl: true,
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

    const [events, relatedOrders] = await Promise.all([
      prisma.event.findMany({
        where: { accountId: account_id, sessionId: session_id },
        select: {
          eventId: true,
          eventName: true,
          createdAt: true,
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
          createdAt: true,
          platformCreatedAt: true,
          attributedChannel: true,
          attributionSnapshot: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const metrics = {
      totalEvents: events.length,
      pageViews: 0,
      viewItem: 0,
      addToCart: 0,
      beginCheckout: 0,
      purchase: 0,
      revenue: 0,
      uniquePages: 0,
      uniqueProducts: 0,
      orderCount: relatedOrders.length,
    };

    const pageSet = new Set();
    const productSet = new Set();

    const timeline = events.map((event) => {
      const bucket = resolveEventBucket(event.eventName);
      if (bucket === 'page_view') metrics.pageViews += 1;
      if (bucket === 'view_item') metrics.viewItem += 1;
      if (bucket === 'add_to_cart') metrics.addToCart += 1;
      if (bucket === 'begin_checkout') metrics.beginCheckout += 1;
      if (bucket === 'purchase') metrics.purchase += 1;
      metrics.revenue += Number(event.revenue || 0);

      if (event.pageUrl) pageSet.add(event.pageUrl);
      if (event.productId) productSet.add(String(event.productId));

      return {
        eventId: event.eventId,
        eventName: event.eventName,
        bucket,
        createdAt: event.createdAt,
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
      };
    });

    metrics.uniquePages = pageSet.size;
    metrics.uniqueProducts = productSet.size;

    const sessionDurationSeconds = session.startedAt && session.lastEventAt
      ? Math.max(0, Math.round((new Date(session.lastEventAt).getTime() - new Date(session.startedAt).getTime()) / 1000))
      : 0;

    res.json({
      session: {
        ...session,
        sessionDurationSeconds,
      },
      metrics,
      timeline,
      orders: relatedOrders,
    });
  } catch (error) {
    console.error('[Analytics API] Session detail error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
