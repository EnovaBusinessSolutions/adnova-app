'use strict';

const prisma = require('../utils/prismaClient');

let User = null;
let ShopConnections = null;
let MetaAccount = null;
let GoogleAccount = null;
let McpData = null;

try {
  User = require('../models/User');
} catch (_) {}

try {
  ShopConnections = require('../models/ShopConnections');
} catch (_) {}

try {
  MetaAccount = require('../models/MetaAccount');
} catch (_) {}

try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {}

try {
  McpData = require('../models/McpData');
} catch (_) {}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
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

function mapStoreType(value, fallbackShop = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.includes('shopify') || raw.includes('myshopify')) return 'shopify';
  if (raw.includes('woo') || raw.includes('wordpress')) return 'woocommerce';
  if (raw.includes('magento')) return 'magento';
  if (raw.includes('custom')) return 'custom';
  if (String(fallbackShop || '').toLowerCase().includes('.myshopify.com')) return 'shopify';
  return 'woocommerce';
}

function collectMetaAccountIds(metaDoc, userDoc) {
  return uniqueStrings([
    ...(Array.isArray(metaDoc?.selectedAccountIds) ? metaDoc.selectedAccountIds : []),
    metaDoc?.defaultAccountId || '',
    ...(Array.isArray(metaDoc?.ad_accounts) ? metaDoc.ad_accounts.map((item) => item?.id || item?.account_id) : []),
    ...(Array.isArray(metaDoc?.adAccounts) ? metaDoc.adAccounts.map((item) => item?.id || item?.account_id) : []),
    ...(Array.isArray(userDoc?.selectedMetaAccounts) ? userDoc.selectedMetaAccounts : []),
    userDoc?.metaDefaultAccountId || '',
  ].map(normalizeMetaAccountId));
}

function collectGoogleAccountIds(googleDoc, userDoc) {
  return uniqueStrings([
    ...(Array.isArray(googleDoc?.selectedCustomerIds) ? googleDoc.selectedCustomerIds : []),
    googleDoc?.defaultCustomerId || '',
    ...(Array.isArray(googleDoc?.ad_accounts) ? googleDoc.ad_accounts.map((item) => item?.id) : []),
    ...(Array.isArray(googleDoc?.customers) ? googleDoc.customers.map((item) => item?.id) : []),
    ...(Array.isArray(userDoc?.selectedGoogleAccounts) ? userDoc.selectedGoogleAccounts : []),
  ].map(normalizeGoogleCustomerId));
}

function createShopEntry(shop) {
  return {
    shop,
    label: shop,
    type: mapStoreType('', shop),
    sources: new Set(),
    matchPlatforms: new Set(),
    updatedAt: null,
    score: 0,
  };
}

function bumpShopEntry(entry, input = {}) {
  const type = mapStoreType(input.type, entry.shop);
  if (type && (entry.type === 'custom' || type !== 'custom')) {
    entry.type = type;
  }

  if (input.source) {
    entry.sources.add(input.source);
    if (input.source === 'shop_connection') entry.score += 1200;
    else if (input.source === 'user') entry.score += 1000;
    else if (input.source === 'platform_connection') entry.score += 250;
    else if (input.source === 'platform_token_match') entry.score += 700;
    else if (input.source === 'mcp_root_source_name') entry.score += 900;
  }

  if (input.platformMatch) {
    entry.matchPlatforms.add(String(input.platformMatch || '').trim().toUpperCase());
    entry.score += 120;
  }

  const updatedAt = input.updatedAt ? new Date(input.updatedAt) : null;
  if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
    if (!entry.updatedAt || updatedAt > entry.updatedAt) entry.updatedAt = updatedAt;
  }

  if (entry.type === 'shopify') entry.score += 20;
  else if (entry.type === 'woocommerce') entry.score += 10;

  return entry;
}

function addShopCandidate(map, input = {}) {
  const shop = normalizeShopDomain(input.shop || input.accountId || input.domain);
  if (!shop) return;

  const existing = map.get(shop) || createShopEntry(shop);
  map.set(shop, bumpShopEntry(existing, { ...input, shop }));
}

async function loadUserAccessDocs(userId) {
  const [userDoc, metaDoc, googleDoc, matchedShopDocs] = await Promise.all([
    User
      ? User.findById(userId)
          .select('shop shopifyConnected metaDefaultAccountId selectedMetaAccounts selectedGoogleAccounts')
          .lean()
      : Promise.resolve(null),
    MetaAccount
      ? MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
          .select('+access_token +token +accessToken +longLivedToken +longlivedToken selectedAccountIds defaultAccountId ad_accounts adAccounts')
          .lean()
      : Promise.resolve(null),
    GoogleAccount
      ? GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
          .select('+accessToken selectedCustomerIds defaultCustomerId ad_accounts customers')
          .lean()
      : Promise.resolve(null),
    ShopConnections
      ? ShopConnections.find({
          matchedToUserId: userId,
          shop: { $exists: true, $ne: '' },
        })
          .select('shop accessToken installedAt')
          .lean()
      : Promise.resolve([]),
  ]);

  return {
    userDoc,
    metaDoc,
    googleDoc,
    matchedShopDocs: Array.isArray(matchedShopDocs) ? matchedShopDocs : [],
  };
}

function collectMetaTokens(metaDoc) {
  return uniqueStrings([
    metaDoc?.longLivedToken || '',
    metaDoc?.longlivedToken || '',
    metaDoc?.access_token || '',
    metaDoc?.accessToken || '',
    metaDoc?.token || '',
  ]);
}

function collectGoogleTokens(googleDoc) {
  return uniqueStrings([
    googleDoc?.accessToken || '',
  ]);
}

async function findPlatformMatchedAccounts(metaAccountIds, googleAccountIds, metaTokens, googleTokens) {
  const orClauses = [];

  if (metaAccountIds.length) {
    orClauses.push({
      platform: 'META',
      status: 'ACTIVE',
      adAccountId: { in: metaAccountIds },
    });
  }

  if (metaTokens.length) {
    orClauses.push({
      platform: 'META',
      status: 'ACTIVE',
      accessToken: { in: metaTokens },
    });
  }

  if (googleAccountIds.length) {
    orClauses.push({
      platform: 'GOOGLE',
      status: 'ACTIVE',
      adAccountId: { in: googleAccountIds },
    });
  }

  if (googleTokens.length) {
    orClauses.push({
      platform: 'GOOGLE',
      status: 'ACTIVE',
      accessToken: { in: googleTokens },
    });
  }

  if (!orClauses.length) return [];

  try {
    return await prisma.platformConnection.findMany({
      where: { OR: orClauses },
      include: {
        account: {
          select: {
            accountId: true,
            domain: true,
            platform: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  } catch (error) {
    console.warn('[analyticsAccess] platform match lookup failed:', error?.message || error);
    return [];
  }
}

async function findMcpRootMatchedAccounts(userId, metaAccountIds, googleAccountIds) {
  if (!McpData || !userId) return { matches: [], rootSources: null };

  try {
    const rootDoc = await McpData.findOne({ userId, kind: 'root' })
      .select('sources')
      .lean();

    const rootSources = rootDoc?.sources || null;
    if (!rootSources || typeof rootSources !== 'object') {
      return { matches: [], rootSources: null };
    }

    const sourceCandidates = [];

    const metaRootAccountId = normalizeMetaAccountId(rootSources?.metaAds?.accountId || '');
    if (metaRootAccountId && metaAccountIds.includes(metaRootAccountId)) {
      const normalizedName = normalizeShopDomain(rootSources?.metaAds?.name || '');
      if (normalizedName) {
        sourceCandidates.push({
          shopLike: normalizedName,
          platform: 'META',
          sourceName: 'metaAds',
          sourceAccountId: metaRootAccountId,
        });
      }
    }

    const googleRootCustomerId = normalizeGoogleCustomerId(rootSources?.googleAds?.customerId || '');
    if (googleRootCustomerId && googleAccountIds.includes(googleRootCustomerId)) {
      const normalizedName = normalizeShopDomain(rootSources?.googleAds?.name || '');
      if (normalizedName) {
        sourceCandidates.push({
          shopLike: normalizedName,
          platform: 'GOOGLE',
          sourceName: 'googleAds',
          sourceAccountId: googleRootCustomerId,
        });
      }
    }

    if (!sourceCandidates.length) {
      return { matches: [], rootSources };
    }

    const lookupValues = uniqueStrings(sourceCandidates.map((entry) => entry.shopLike));
    const accounts = await prisma.account.findMany({
      where: {
        OR: [
          { accountId: { in: lookupValues } },
          { domain: { in: lookupValues } },
        ],
      },
      select: {
        accountId: true,
        domain: true,
        platform: true,
        updatedAt: true,
      },
    });

    const accountByValue = new Map();
    accounts.forEach((account) => {
      const accountId = normalizeShopDomain(account.accountId || '');
      const domain = normalizeShopDomain(account.domain || '');
      if (accountId) accountByValue.set(accountId, account);
      if (domain) accountByValue.set(domain, account);
    });

    const matches = sourceCandidates
      .map((candidate) => {
        const account = accountByValue.get(candidate.shopLike);
        if (!account) return null;
        return {
          account,
          platform: candidate.platform,
          sourceName: candidate.sourceName,
          sourceAccountId: candidate.sourceAccountId,
          matchReason: 'mcp_root_source_name',
        };
      })
      .filter(Boolean);

    return { matches, rootSources };
  } catch (error) {
    console.warn('[analyticsAccess] mcp root shop lookup failed:', error?.message || error);
    return { matches: [], rootSources: null };
  }
}

async function listAuthorizedAnalyticsShopsForUser(userId) {
  if (!userId) {
    return {
      defaultShop: null,
      defaultShopSource: null,
      shops: [],
      debug: {
        userId: null,
        userShop: null,
        matchedShopConnections: [],
        metaAccountIds: [],
        googleAccountIds: [],
        platformMatches: [],
      },
    };
  }

  const { userDoc, metaDoc, googleDoc, matchedShopDocs } = await loadUserAccessDocs(userId);
  const candidates = new Map();

  if (userDoc?.shop) {
    addShopCandidate(candidates, {
      shop: userDoc.shop,
      type: userDoc.shopifyConnected ? 'shopify' : null,
      source: 'user',
    });
  }

  matchedShopDocs.forEach((doc) => {
    addShopCandidate(candidates, {
      shop: doc?.shop,
      type: 'shopify',
      source: 'shop_connection',
      updatedAt: doc?.installedAt || null,
    });
  });

  const metaAccountIds = collectMetaAccountIds(metaDoc, userDoc);
  const googleAccountIds = collectGoogleAccountIds(googleDoc, userDoc);
  const metaTokens = collectMetaTokens(metaDoc);
  const googleTokens = collectGoogleTokens(googleDoc);
  const platformMatches = await findPlatformMatchedAccounts(metaAccountIds, googleAccountIds, metaTokens, googleTokens);
  const mcpRootMatchResult = await findMcpRootMatchedAccounts(userId, metaAccountIds, googleAccountIds);
  const mcpRootMatches = Array.isArray(mcpRootMatchResult?.matches) ? mcpRootMatchResult.matches : [];

  platformMatches.forEach((row) => {
    const platformName = String(row?.platform || '').trim().toUpperCase();
    const normalizedAdAccountId = platformName === 'META'
      ? normalizeMetaAccountId(row?.adAccountId)
      : platformName === 'GOOGLE'
        ? normalizeGoogleCustomerId(row?.adAccountId)
        : String(row?.adAccountId || '').trim();
    const matchedByAdAccount = platformName === 'META'
      ? metaAccountIds.includes(normalizedAdAccountId)
      : platformName === 'GOOGLE'
        ? googleAccountIds.includes(normalizedAdAccountId)
        : false;
    const matchedByToken = platformName === 'META'
      ? metaTokens.includes(String(row?.accessToken || '').trim())
      : platformName === 'GOOGLE'
        ? googleTokens.includes(String(row?.accessToken || '').trim())
        : false;
    const matchReason = matchedByAdAccount
      ? 'ad_account_id'
      : matchedByToken
        ? 'access_token'
        : 'unknown';

    addShopCandidate(candidates, {
      shop: row?.account?.accountId || row?.accountId || row?.account?.domain || '',
      type: row?.account?.platform || '',
      source: matchedByToken ? 'platform_token_match' : 'platform_connection',
      platformMatch: row?.platform || '',
      updatedAt: row?.updatedAt || row?.account?.updatedAt || null,
    });

    row.__matchReason = matchReason;
  });

  mcpRootMatches.forEach((row) => {
    addShopCandidate(candidates, {
      shop: row?.account?.accountId || row?.account?.domain || '',
      type: row?.account?.platform || '',
      source: 'mcp_root_source_name',
      platformMatch: row?.platform || '',
      updatedAt: row?.account?.updatedAt || null,
    });
  });

  const shops = Array.from(candidates.values())
    .map((entry) => ({
      shop: entry.shop,
      label: entry.label,
      type: entry.type,
      sources: Array.from(entry.sources),
      matchPlatforms: Array.from(entry.matchPlatforms),
      updatedAt: entry.updatedAt ? entry.updatedAt.toISOString() : null,
      _score: entry.score,
    }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (bUpdated !== aUpdated) return bUpdated - aUpdated;
      return a.shop.localeCompare(b.shop);
    });

  const defaultShop = shops[0]?.shop || null;
  const defaultShopSource = shops[0]?.sources?.[0] || null;

  return {
    defaultShop,
    defaultShopSource,
    shops: shops.map(({ _score, ...entry }, index) => ({
      ...entry,
      isDefault: index === 0,
    })),
    debug: {
      userId: String(userId),
      userShop: normalizeShopDomain(userDoc?.shop || '') || null,
      shopifyConnected: !!userDoc?.shopifyConnected,
        matchedShopConnections: matchedShopDocs.map((doc) => ({
          shop: normalizeShopDomain(doc?.shop || '') || null,
          hasAccessToken: !!doc?.accessToken,
          installedAt: doc?.installedAt ? new Date(doc.installedAt).toISOString() : null,
        })),
      metaAccountIds,
      googleAccountIds,
      metaTokenCount: metaTokens.length,
      googleTokenCount: googleTokens.length,
      platformMatches: platformMatches.map((row) => ({
        accountId: normalizeShopDomain(row?.accountId || row?.account?.accountId || '') || null,
        domain: normalizeShopDomain(row?.account?.domain || '') || null,
        accountPlatform: String(row?.account?.platform || '').trim() || null,
        platform: String(row?.platform || '').trim() || null,
        adAccountId: String(row?.adAccountId || '').trim() || null,
        status: String(row?.status || '').trim() || null,
        matchReason: row?.__matchReason || 'unknown',
        updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      })),
      mcpRootSources: mcpRootMatchResult?.rootSources || null,
      mcpRootMatches: mcpRootMatches.map((row) => ({
        accountId: normalizeShopDomain(row?.account?.accountId || '') || null,
        domain: normalizeShopDomain(row?.account?.domain || '') || null,
        accountPlatform: String(row?.account?.platform || '').trim() || null,
        platform: String(row?.platform || '').trim() || null,
        sourceName: String(row?.sourceName || '').trim() || null,
        sourceAccountId: String(row?.sourceAccountId || '').trim() || null,
        matchReason: row?.matchReason || 'unknown',
        updatedAt: row?.account?.updatedAt ? new Date(row.account.updatedAt).toISOString() : null,
      })),
      resolvedShops: shops.map(({ _score, ...entry }) => entry),
    },
  };
}

async function isAnalyticsShopAuthorizedForUser(userId, shop) {
  const normalizedShop = normalizeShopDomain(shop);
  if (!userId || !normalizedShop) return false;

  const access = await listAuthorizedAnalyticsShopsForUser(userId);
  return access.shops.some((entry) => normalizeShopDomain(entry.shop) === normalizedShop);
}

module.exports = {
  isAnalyticsShopAuthorizedForUser,
  listAuthorizedAnalyticsShopsForUser,
  normalizeGoogleCustomerId,
  normalizeMetaAccountId,
  normalizeShopDomain,
};
