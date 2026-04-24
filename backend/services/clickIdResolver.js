'use strict';

/**
 * Click-ID resolver
 * -----------------
 * Given a click identifier (gclid / fbclid / ttclid), try to resolve the
 * campaign/adset/ad *name* that generated the click by querying the ad
 * platform's API.
 *
 * - Google Ads (gclid): resolvable via the `click_view` report using the
 *   user's connected Google Ads account + refresh token. Results are cached
 *   in-memory to avoid re-hitting the API for the same click id.
 *
 * - Meta Ads (fbclid): NOT resolvable via public API. Meta does not expose a
 *   fbclid → campaign lookup for privacy/policy reasons. The only reliable way
 *   to get campaign names for Meta traffic is for the advertiser to set URL
 *   tags in Ads Manager ( {{campaign.name}}, {{adset.name}}, {{ad.name}} ).
 *   This resolver returns null for fbclid and sets `reason` so the UI can
 *   render a sensible fallback ("Meta Ads · click ID: …" instead of blank).
 *
 * - TikTok Ads (ttclid): stub — TikTok Ads API supports click-level reports
 *   but we don't yet have integration wiring. Returns null for now.
 */

const GoogleAccount = (() => {
  try { return require('../models/GoogleAccount'); } catch { return null; }
})();

const googleAdsService = (() => {
  try { return require('./googleAdsService'); } catch { return null; }
})();

const ShopConnections = (() => {
  try { return require('../models/ShopConnections'); } catch { return null; }
})();

const User = (() => {
  try { return require('../models/User'); } catch { return null; }
})();

// ─── In-memory cache ──────────────────────────────────────────
// Keyed by `${provider}:${clickId}`. Entries include null results so we
// don't keep hammering the API when the platform simply doesn't know the id.
const CACHE = new Map();
const TTL_MS = 12 * 60 * 60 * 1000; // 12h
const NEG_TTL_MS = 30 * 60 * 1000;  // 30m for negative results
const MAX_ENTRIES = 5000;

function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { CACHE.delete(key); return undefined; }
  return entry.value;
}

function cacheSet(key, value, isNegative = false) {
  if (CACHE.size >= MAX_ENTRIES) {
    // evict oldest 10%
    const toDrop = Math.ceil(MAX_ENTRIES * 0.1);
    const it = CACHE.keys();
    for (let i = 0; i < toDrop; i++) CACHE.delete(it.next().value);
  }
  CACHE.set(key, {
    value,
    expiresAt: Date.now() + (isNegative ? NEG_TTL_MS : TTL_MS),
  });
}

// ─── Account resolution ───────────────────────────────────────
async function resolveUserIdForAccount(accountId) {
  if (!accountId) return null;
  // 1) ShopConnections.matchedToUserId by shop
  if (ShopConnections) {
    try {
      const sc = await ShopConnections.findOne({
        shop: accountId,
        matchedToUserId: { $ne: null },
      }).select('matchedToUserId').lean();
      if (sc?.matchedToUserId) return sc.matchedToUserId;
    } catch { /* ignore */ }
  }
  // 2) User.shop
  if (User) {
    try {
      const u = await User.findOne({ shop: accountId }).select('_id').lean();
      if (u?._id) return u._id;
    } catch { /* ignore */ }
  }
  return null;
}

async function loadGoogleAccount(accountId) {
  const userId = await resolveUserIdForAccount(accountId);
  if (!userId || !GoogleAccount) return null;
  try {
    const doc = await GoogleAccount
      .findOne({ $or: [{ user: userId }, { userId }] })
      .select('+refreshToken +accessToken selectedCustomerIds defaultCustomerId customers')
      .lean();
    return doc || null;
  } catch {
    return null;
  }
}

// ─── Google Ads: gclid → campaign name ────────────────────────
function pickGoogleCustomerIds(googleAccount) {
  if (!googleAccount) return [];
  const list = [];
  if (googleAccount.defaultCustomerId) list.push(googleAccount.defaultCustomerId);
  if (Array.isArray(googleAccount.selectedCustomerIds)) list.push(...googleAccount.selectedCustomerIds);
  if (Array.isArray(googleAccount.customers)) {
    for (const c of googleAccount.customers) if (c?.id) list.push(c.id);
  }
  return Array.from(new Set(list.map((v) => String(v || '').replace(/[^\d]/g, '')).filter(Boolean)));
}

function ymd(d) {
  const z = new Date(d);
  if (Number.isNaN(z.getTime())) return null;
  return z.toISOString().slice(0, 10);
}

/**
 * Queries Google Ads click_view report for a specific gclid on a specific day.
 * Returns { campaign, adset, ad } or null if not found / not resolvable.
 */
async function resolveGclidViaGoogleAds({ gclid, clickDate, accountId }) {
  if (!gclid || !googleAdsService || !googleAdsService.searchGAQLStream) return null;

  const googleAccount = await loadGoogleAccount(accountId);
  if (!googleAccount) return null;
  const cids = pickGoogleCustomerIds(googleAccount);
  if (!cids.length) return null;

  const date = ymd(clickDate) || ymd(new Date());
  if (!date) return null;

  const safeGclid = String(gclid).replace(/'/g, "\\'");
  const GAQL = `
    SELECT
      click_view.gclid,
      campaign.name,
      ad_group.name,
      ad_group_ad.ad.name,
      segments.date
    FROM click_view
    WHERE segments.date = '${date}'
      AND click_view.gclid = '${safeGclid}'
    LIMIT 1
  `;

  // Try each accessible customer id in order; stop at first hit.
  for (const cid of cids) {
    try {
      const rows = await googleAdsService.searchGAQLStream(googleAccount, cid, GAQL);
      if (Array.isArray(rows) && rows.length) {
        const row = rows[0];
        const campaign = row?.campaign?.name || null;
        const adset    = row?.adGroup?.name || row?.ad_group?.name || null;
        const ad       = row?.adGroupAd?.ad?.name || row?.ad_group_ad?.ad?.name || null;
        if (campaign || adset || ad) {
          return { campaign, adset, ad, provider: 'google', resolvedVia: 'click_view' };
        }
      }
    } catch (err) {
      // If this customer doesn't have the click, silently continue.
      // Log only truly unexpected failures.
      if (!/NOT_FOUND|PERMISSION_DENIED|INVALID_ARGUMENT/i.test(String(err?.message || ''))) {
        console.warn('[clickIdResolver] google ads query failed for cid', cid, err?.message);
      }
    }
  }
  return null;
}

// ─── Meta / TikTok stubs ──────────────────────────────────────
async function resolveFbclidViaMeta({ fbclid, accountId: _accountId }) {
  // Meta does NOT expose fbclid → campaign/ad via public Marketing API.
  // Best alternative: advertiser configures URL tags in Ads Manager so that
  // utm_campaign / utm_content / utm_term arrive populated at the pixel.
  // See docs/attribution-panel-fixes.md Fix #6 for user-facing instructions.
  if (!fbclid) return null;
  return null;
}

async function resolveTtclidViaTikTok({ ttclid, accountId: _accountId }) {
  // Not yet integrated. TikTok Ads API has click-level reports but we don't
  // have the token plumbing here yet. Add when TikTok OAuth is wired.
  if (!ttclid) return null;
  return null;
}

// ─── Public API ───────────────────────────────────────────────
/**
 * Resolve a single click ID to campaign/adset/ad names.
 * @param {Object} p
 * @param {string} [p.gclid]
 * @param {string} [p.fbclid]
 * @param {string} [p.ttclid]
 * @param {Date|string} [p.clickDate] - when the click happened; required for
 *        Google Ads click_view queries. Defaults to today.
 * @param {string} p.accountId - the shop / account id (used to find OAuth tokens).
 * @returns {Promise<{ campaign: string|null, adset: string|null, ad: string|null,
 *                     provider: 'google'|'meta'|'tiktok', resolvedVia: string } | null>}
 */
async function resolveClickId({ gclid, fbclid, ttclid, clickDate, accountId }) {
  if (!accountId) return null;

  if (gclid) {
    const key = `google:${gclid}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
    const res = await resolveGclidViaGoogleAds({ gclid, clickDate, accountId });
    cacheSet(key, res, !res);
    return res;
  }

  if (fbclid) {
    const key = `meta:${fbclid}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
    const res = await resolveFbclidViaMeta({ fbclid, accountId });
    cacheSet(key, res, true); // always negative cache for now
    return res;
  }

  if (ttclid) {
    const key = `tiktok:${ttclid}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
    const res = await resolveTtclidViaTikTok({ ttclid, accountId });
    cacheSet(key, res, true);
    return res;
  }

  return null;
}

/**
 * Bulk resolve — resolves up to `concurrency` click ids in parallel with a
 * soft timeout, so a slow Google Ads call doesn't hold the whole request.
 */
async function resolveMany(entries, { concurrency = 4, timeoutMs = 6000 } = {}) {
  const results = new Map();
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (idx < entries.length) {
      const i = idx++;
      const e = entries[i];
      const key = e.gclid ? `gclid:${e.gclid}` : e.fbclid ? `fbclid:${e.fbclid}` : e.ttclid ? `ttclid:${e.ttclid}` : null;
      if (!key) continue;
      try {
        const res = await Promise.race([
          resolveClickId(e),
          new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        if (res) results.set(key, res);
      } catch {
        /* swallow — best-effort */
      }
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = {
  resolveClickId,
  resolveMany,
};
