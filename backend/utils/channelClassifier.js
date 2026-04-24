'use strict';

/**
 * Lightweight attribution channel classifier.
 * Same semantics as stitchSnapshotAttribution in backend/routes/analytics.js,
 * but packaged as a shared helper so the real-time feed (collect.js) and the
 * batch analytics can agree on the channel of a click without duplicating
 * logic. Prefer this over re-implementing the rules anywhere else.
 *
 * Input is a plain object with any combination of:
 *   gclid, fbclid, ttclid, utm_source, utm_medium, referrer
 *
 * Output:
 *   {
 *     channel:  'meta' | 'google' | 'tiktok' | 'organic' | 'organic_social'
 *             | 'organic_search' | 'referral' | 'other' | 'direct',
 *     platform: the user-facing source label (e.g. 'facebook', 'fb',
 *               'bing.com', 'google', 'newsletter'), or null,
 *     source:   'click_id' | 'utm' | 'referrer' | 'none',
 *     clickId:  the id string when source === 'click_id',
 *     clickIdProvider: 'meta' | 'google' | 'tiktok' | null,
 *   }
 */
function getDomain(url) {
  if (!url) return null;
  try {
    const host = new URL(String(url).includes('://') ? url : `https://${url}`).hostname;
    return host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function classifyChannel(input = {}) {
  const fbclid     = input.fbclid     || input.fbc || null;
  const gclid      = input.gclid      || null;
  const ttclid     = input.ttclid     || null;
  const utm_source = input.utm_source || null;
  const utm_medium = input.utm_medium || null;
  const referrer   = input.referrer   || input.document_referrer || null;

  // 1. Click IDs — highest confidence.
  if (gclid) {
    return {
      channel: 'google',
      platform: 'google',
      source: 'click_id',
      clickId: String(gclid),
      clickIdProvider: 'google',
    };
  }
  if (fbclid) {
    return {
      channel: 'meta',
      platform: 'facebook',
      source: 'click_id',
      clickId: String(fbclid),
      clickIdProvider: 'meta',
    };
  }
  if (ttclid) {
    return {
      channel: 'tiktok',
      platform: 'tiktok',
      source: 'click_id',
      clickId: String(ttclid),
      clickIdProvider: 'tiktok',
    };
  }

  // 2. UTM parameters.
  if (utm_source) {
    const src = String(utm_source).toLowerCase();
    const med = String(utm_medium || '').toLowerCase();
    const isOrganic = med === 'organic';

    let channel;
    if (['fb', 'facebook', 'ig', 'instagram', 'meta'].some((p) => src.includes(p))) {
      channel = isOrganic ? 'organic_social' : 'meta';
    } else if (src.includes('tiktok') || src === 'tt') {
      channel = isOrganic ? 'organic_social' : 'tiktok';
    } else if (src.includes('google') || src === 'googleads' || src === 'adwords') {
      channel = isOrganic ? 'organic_search' : 'google';
    } else if (['cpc', 'paid_search'].includes(med)) {
      channel = 'google';
    } else if (['paid', 'paid_social', 'social'].includes(med)) {
      // Unknown source but paid-social medium — bucket as "other" (we don't
      // know the network). Platform stays as the raw utm_source string.
      channel = 'other';
    } else {
      channel = med || 'referral';
    }

    return {
      channel,
      platform: String(utm_source),
      source: 'utm',
      clickId: null,
      clickIdProvider: null,
    };
  }

  // 3. Referrer — low confidence, domain-based.
  if (referrer) {
    const domain = getDomain(referrer);
    if (!domain) {
      return { channel: 'direct', platform: null, source: 'none', clickId: null, clickIdProvider: null };
    }
    if (['google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'ecosia.org'].some((d) => domain.includes(d))) {
      return { channel: 'organic_search', platform: domain, source: 'referrer', clickId: null, clickIdProvider: null };
    }
    if (['facebook.com', 'instagram.com', 't.co', 'twitter.com', 'x.com', 'pinterest.com', 'linkedin.com'].some((d) => domain.includes(d))) {
      return { channel: 'organic_social', platform: domain, source: 'referrer', clickId: null, clickIdProvider: null };
    }
    return { channel: 'referral', platform: domain, source: 'referrer', clickId: null, clickIdProvider: null };
  }

  return { channel: 'direct', platform: null, source: 'none', clickId: null, clickIdProvider: null };
}

/**
 * Collapse a raw channel name into the short set used by dashboard stats.
 * Mirrors normalizeChannelForStats in analytics.js.
 */
function normalizeChannel(channelRaw) {
  const ch = String(channelRaw || 'unattributed').toLowerCase();
  if (ch === 'facebook' || ch === 'instagram' || ch === 'paid_social') return 'meta';
  if (ch === 'paid_search' || ch === 'google_ads' || ch === 'cpc') return 'google';
  if (ch === 'organic_search' || ch === 'organic' || ch === 'google_organic') return 'organic';
  if (['meta', 'google', 'tiktok', 'organic', 'organic_social', 'direct', 'referral', 'unattributed'].includes(ch)) {
    return ch === 'organic_social' ? 'organic' : ch === 'direct' ? 'direct' : ch === 'referral' ? 'other' : ch;
  }
  return 'other';
}

module.exports = { classifyChannel, normalizeChannel };
