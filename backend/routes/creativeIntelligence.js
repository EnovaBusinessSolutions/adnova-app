// backend/routes/creativeIntelligence.js
'use strict';

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');

const router = express.Router();

const FB_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

// Models
const CreativeSnapshot = require('../models/CreativeSnapshot');
let MetaAccount;
try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema } = mongoose;
  MetaAccount = mongoose.models.MetaAccount || mongoose.model('MetaAccount', new Schema({}, { strict: false, collection: 'metaaccounts' }));
}

// Services
const { calculateCreativeScores, getTierFromScore } = require('../services/creativeScoreEngine');
const { generateRecommendations } = require('../services/creativeRecommendationEngine');

/* =============== Helpers =============== */

const normActId = (s = '') => String(s).replace(/^act_/, '').trim();

function appSecretProof(accessToken) {
  if (!APP_SECRET) return undefined;
  return crypto.createHmac('sha256', APP_SECRET).update(accessToken).digest('hex');
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function resolveAccessToken(metaAcc) {
  return (
    metaAcc?.access_token ||
    metaAcc?.token ||
    metaAcc?.longlivedToken ||
    metaAcc?.accessToken ||
    metaAcc?.longLivedToken ||
    null
  );
}

function normalizeAccountsList(metaAcc) {
  if (Array.isArray(metaAcc?.ad_accounts)) return metaAcc.ad_accounts;
  if (Array.isArray(metaAcc?.adAccounts)) return metaAcc.adAccounts;
  return [];
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function getDateRanges(daysBack = 7) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  // Current period: last N complete days (excluding today)
  const currUntil = addDays(today, -1);  // yesterday
  const currSince = addDays(currUntil, -(daysBack - 1));
  
  // Previous period: same length before current
  const prevUntil = addDays(currSince, -1);
  const prevSince = addDays(prevUntil, -(daysBack - 1));
  
  return {
    current: { since: ymd(currSince), until: ymd(currUntil) },
    previous: { since: ymd(prevSince), until: ymd(prevUntil) },
    days: daysBack,
  };
}

function normalizeMetaObjective(raw) {
  const o = String(raw || '').toUpperCase().trim();
  if (!o) return 'OTHER';
  if (o.includes('OUTCOME_SALES') || o === 'CONVERSIONS' || o.includes('PURCHASE') || o.includes('CATALOG_SALES')) return 'SALES';
  if (o.includes('OUTCOME_LEADS') || o.includes('LEAD')) return 'LEADS';
  if (o.includes('OUTCOME_TRAFFIC') || o === 'TRAFFIC' || o.includes('LINK_CLICKS')) return 'TRAFFIC';
  if (o.includes('OUTCOME_AWARENESS') || o.includes('AWARENESS') || o === 'REACH') return 'AWARENESS';
  if (o.includes('ENGAGEMENT') || o.includes('VIDEO_VIEWS')) return 'ENGAGEMENT';
  if (o.includes('MESSAGES')) return 'MESSAGES';
  if (o.includes('APP')) return 'APP';
  return 'OTHER';
}

/* =============== Meta API Fetchers =============== */

async function fetchAdsWithInsights(accountId, accessToken, dateRange) {
  const { current, previous } = dateRange;
  
  // Fetch ads with creative info
  const adsUrl = `${FB_GRAPH}/act_${accountId}/ads`;
  const adsParams = {
    access_token: accessToken,
    appsecret_proof: appSecretProof(accessToken),
    fields: [
      'id', 'name', 'status', 'effective_status',
      'adset_id', 'adset{id,name}',
      'campaign_id', 'campaign{id,name,objective}',
      'creative{id,name,thumbnail_url,object_story_spec,asset_feed_spec,effective_object_story_id}'
    ].join(','),
    limit: 500,
  };
  
  const ads = [];
  let nextUrl = adsUrl;
  let params = adsParams;
  let guard = 0;
  
  while (nextUrl && guard < 10) {
    const { data } = await axios.get(nextUrl, { params });
    if (Array.isArray(data?.data)) ads.push(...data.data);
    nextUrl = data?.paging?.next || null;
    params = undefined;
    guard++;
  }
  
  if (ads.length === 0) return [];
  
  // Fetch insights for current period (ad level)
  const insightsCurrUrl = `${FB_GRAPH}/act_${accountId}/insights`;
  const insightsParams = {
    access_token: accessToken,
    appsecret_proof: appSecretProof(accessToken),
    level: 'ad',
    time_range: JSON.stringify(current),
    fields: [
      'ad_id', 'ad_name', 'campaign_id', 'adset_id',
      'spend', 'impressions', 'reach', 'frequency',
      'clicks', 'ctr', 'cpc', 'cpm',
      'inline_link_clicks',
      'actions', 'action_values',
      'video_avg_time_watched_actions',
      'video_p25_watched_actions', 'video_p50_watched_actions',
      'video_p75_watched_actions', 'video_p100_watched_actions',
    ].join(','),
    limit: 1000,
    action_report_time: 'conversion',
    use_unified_attribution_setting: true,
  };
  
  const insightsCurr = [];
  nextUrl = insightsCurrUrl;
  params = insightsParams;
  guard = 0;
  
  while (nextUrl && guard < 10) {
    const { data } = await axios.get(nextUrl, { params });
    if (Array.isArray(data?.data)) insightsCurr.push(...data.data);
    nextUrl = data?.paging?.next || null;
    params = undefined;
    guard++;
  }
  
  // Fetch insights for previous period
  const insightsPrevParams = {
    ...insightsParams,
    time_range: JSON.stringify(previous),
  };
  
  const insightsPrev = [];
  nextUrl = insightsCurrUrl;
  params = insightsPrevParams;
  guard = 0;
  
  while (nextUrl && guard < 10) {
    const { data } = await axios.get(nextUrl, { params });
    if (Array.isArray(data?.data)) insightsPrev.push(...data.data);
    nextUrl = data?.paging?.next || null;
    params = undefined;
    guard++;
  }
  
  // Index insights by ad_id
  const currByAd = new Map(insightsCurr.map(i => [i.ad_id, i]));
  const prevByAd = new Map(insightsPrev.map(i => [i.ad_id, i]));
  
  return { ads, currByAd, prevByAd };
}

/* =============== Metric Extraction =============== */

const PURCHASE_PRIORITIES = [
  'omni_purchase', 'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase', 'purchase'
];
const LEAD_PRIORITIES = [
  'omni_lead', 'offsite_conversion.fb_pixel_lead', 'lead'
];

function pickActionValue(actions, priorities) {
  if (!Array.isArray(actions)) return 0;
  for (const key of priorities) {
    const found = actions.find(a => String(a?.action_type) === key);
    if (found && Number.isFinite(Number(found.value))) return Number(found.value);
  }
  return 0;
}

function extractMetrics(insight) {
  if (!insight) {
    return {
      spend: 0, impressions: 0, reach: 0, clicks: 0,
      ctr: 0, cpc: null, cpm: null,
      purchases: 0, revenue: 0, roas: null, cpa: null,
      leads: 0, cpl: null, frequency: null,
    };
  }
  
  const spend = Number(insight.spend || 0);
  const impressions = Number(insight.impressions || 0);
  const reach = Number(insight.reach || 0);
  const clicks = Number(insight.inline_link_clicks || insight.clicks || 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const cpc = clicks > 0 ? spend / clicks : null;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
  const frequency = reach > 0 ? impressions / reach : null;
  
  const purchases = pickActionValue(insight.actions, PURCHASE_PRIORITIES);
  const revenue = pickActionValue(insight.action_values, PURCHASE_PRIORITIES);
  const roas = spend > 0 && revenue > 0 ? revenue / spend : null;
  const cpa = purchases > 0 ? spend / purchases : null;
  const cvr = clicks > 0 && purchases > 0 ? purchases / clicks : 0;
  
  const leads = pickActionValue(insight.actions, LEAD_PRIORITIES);
  const cpl = leads > 0 ? spend / leads : null;
  
  return {
    spend, impressions, reach, clicks,
    ctr, cpc, cpm, frequency,
    purchases, revenue, roas, cpa, cvr,
    leads, cpl,
  };
}

function detectCreativeType(creative) {
  if (!creative) return 'unknown';
  
  const spec = creative.object_story_spec || {};
  const assetFeed = creative.asset_feed_spec;
  
  if (assetFeed?.videos?.length) return 'video';
  if (assetFeed?.images?.length > 1) return 'carousel';
  if (spec.video_data) return 'video';
  if (spec.template_data?.multi_share_end_card !== undefined) return 'carousel';
  if (spec.link_data?.image_hash || spec.link_data?.picture) return 'image';
  if (spec.photo_data) return 'image';
  
  return 'unknown';
}

/* =============== Main Routes =============== */

/**
 * GET /api/creative-intelligence/creatives
 * Fetch creatives with scores for an ad account
 */
router.get('/creatives', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const accountIdParam = normActId(req.query.account_id || '');
    const objectiveParam = (req.query.objective || 'ventas').toLowerCase();
    const objective = ['ventas', 'alcance', 'leads'].includes(objectiveParam) ? objectiveParam : 'ventas';
    const daysBack = Math.min(30, Math.max(3, Number(req.query.days) || 7));
    
    // Load MetaAccount
    const metaAcc = await MetaAccount
      .findOne({ $or: [{ user: userId }, { userId }] })
      .select('+access_token +token +longlivedToken +accessToken +longLivedToken ad_accounts adAccounts defaultAccountId objective')
      .lean();
    
    if (!metaAcc) {
      return res.status(404).json({ ok: false, error: 'META_NOT_CONNECTED' });
    }
    
    const accessToken = resolveAccessToken(metaAcc);
    if (!accessToken) {
      return res.status(401).json({ ok: false, error: 'NO_META_TOKEN' });
    }
    
    // Resolve account ID
    const accountsList = normalizeAccountsList(metaAcc);
    let accountId = accountIdParam;
    
    if (!accountId) {
      accountId = normActId(metaAcc.defaultAccountId || '');
    }
    if (!accountId && accountsList.length > 0) {
      accountId = normActId(accountsList[0].id || accountsList[0].account_id || '');
    }
    
    if (!accountId) {
      return res.status(400).json({ ok: false, error: 'NO_ACCOUNT_ID' });
    }
    
    // Get date ranges
    const dateRange = getDateRanges(daysBack);
    
    // Fetch from Meta
    const { ads, currByAd, prevByAd } = await fetchAdsWithInsights(accountId, accessToken, dateRange);
    
    if (!ads || ads.length === 0) {
      return res.json({
        ok: true,
        accountId,
        objective,
        dateRange: dateRange.current,
        creatives: [],
        summary: { total: 0, stars: 0, good: 0, average: 0, poor: 0, critical: 0 },
      });
    }
    
    // Process each ad
    const creatives = [];
    const tierCounts = { star: 0, good: 0, average: 0, poor: 0, critical: 0 };
    
    for (const ad of ads) {
      const adId = ad.id;
      const currInsight = currByAd.get(adId);
      const prevInsight = prevByAd.get(adId);
      
      const metrics = extractMetrics(currInsight);
      const metricsPrev = extractMetrics(prevInsight);
      
      // Skip ads with no activity
      if (metrics.spend === 0 && metrics.impressions === 0) continue;
      
      // Calculate scores
      const { scores, tier, deltas } = calculateCreativeScores(metrics, metricsPrev, objective);
      
      // Generate recommendations
      const recommendations = generateRecommendations({
        scores,
        metrics,
        deltas,
        tier,
        objective,
        effectiveStatus: ad.effective_status,
      });
      
      // Detect creative type
      const creativeType = detectCreativeType(ad.creative);
      
      // Get campaign info
      const campaign = ad.campaign || {};
      const adset = ad.adset || {};
      const campaignObjective = campaign.objective || null;
      
      // Build creative snapshot
      const snapshot = {
        adId,
        adName: ad.name || '',
        adsetId: ad.adset_id || adset.id || '',
        adsetName: adset.name || '',
        campaignId: ad.campaign_id || campaign.id || '',
        campaignName: campaign.name || '',
        creativeType,
        thumbnailUrl: ad.creative?.thumbnail_url || null,
        effectiveStatus: ad.effective_status || ad.status || 'UNKNOWN',
        campaignObjective,
        campaignObjectiveNorm: normalizeMetaObjective(campaignObjective),
        userObjective: objective,
        metrics,
        metricsPrev,
        deltas,
        scores,
        tier,
        recommendations,
      };
      
      creatives.push(snapshot);
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }
    
    // Sort by total score descending
    creatives.sort((a, b) => b.scores.total - a.scores.total);
    
    return res.json({
      ok: true,
      accountId,
      objective,
      dateRange: dateRange.current,
      creatives,
      summary: {
        total: creatives.length,
        ...tierCounts,
      },
    });
    
  } catch (error) {
    console.error('creative-intelligence/creatives error:', error);
    
    // Handle Meta API errors
    if (error.response?.data?.error) {
      const metaError = error.response.data.error;
      return res.status(400).json({
        ok: false,
        error: 'META_API_ERROR',
        detail: metaError.message || metaError.error_user_msg || 'Unknown Meta error',
        code: metaError.code,
      });
    }
    
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/creative-intelligence/recommendation/:creativeId/check
 * Mark a recommendation as checked
 */
router.post('/recommendation/:adId/check', requireAuth, express.json(), async (req, res) => {
  try {
    const { adId } = req.params;
    const { recommendationId, checked } = req.body;
    
    if (!recommendationId) {
      return res.status(400).json({ ok: false, error: 'RECOMMENDATION_ID_REQUIRED' });
    }
    
    const userId = req.user._id;
    const accountId = normActId(req.query.account_id || req.body.account_id || '');
    
    // Find or create snapshot in DB
    let snapshot = await CreativeSnapshot.findOne({
      user: userId,
      adAccountId: accountId,
      adId: adId,
    });
    
    if (!snapshot) {
      // Create minimal snapshot for tracking
      snapshot = new CreativeSnapshot({
        user: userId,
        adAccountId: accountId,
        adId: adId,
        recommendations: [],
      });
    }
    
    // Find recommendation
    const rec = snapshot.recommendations.find(r => r.id === recommendationId);
    
    if (rec) {
      rec.checked = !!checked;
      rec.checkedAt = checked ? new Date() : null;
    } else {
      // Add new recommendation tracking entry
      snapshot.recommendations.push({
        id: recommendationId,
        category: 'info',
        priority: 0,
        message: '',
        checked: !!checked,
        checkedAt: checked ? new Date() : null,
      });
    }
    
    await snapshot.save();
    
    return res.json({ ok: true, recommendationId, checked: !!checked });
    
  } catch (error) {
    console.error('recommendation check error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/creative-intelligence/objective/:adId
 * Set per-creative objective override
 */
router.post('/objective/:adId', requireAuth, express.json(), async (req, res) => {
  try {
    const { adId } = req.params;
    const { objective, override } = req.body;
    
    if (!['ventas', 'alcance', 'leads'].includes(objective)) {
      return res.status(400).json({ ok: false, error: 'INVALID_OBJECTIVE' });
    }
    
    const userId = req.user._id;
    const accountId = normActId(req.query.account_id || req.body.account_id || '');
    
    await CreativeSnapshot.updateOne(
      { user: userId, adAccountId: accountId, adId: adId },
      {
        $set: {
          userObjective: objective,
          objectiveOverride: !!override,
        },
        $setOnInsert: {
          user: userId,
          adAccountId: accountId,
          adId: adId,
        },
      },
      { upsert: true }
    );
    
    return res.json({ ok: true, adId, objective, override: !!override });
    
  } catch (error) {
    console.error('objective set error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/creative-intelligence/accounts
 * Get available ad accounts for selector
 */
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    
    const metaAcc = await MetaAccount
      .findOne({ $or: [{ user: userId }, { userId }] })
      .select('ad_accounts adAccounts defaultAccountId objective')
      .lean();
    
    if (!metaAcc) {
      return res.json({ ok: true, accounts: [], defaultAccountId: null, objective: null });
    }
    
    const accounts = normalizeAccountsList(metaAcc).map(acc => ({
      id: normActId(acc.id || acc.account_id || ''),
      name: acc.name || acc.account_name || 'Sin nombre',
      currency: acc.currency || acc.account_currency || null,
    })).filter(a => a.id);
    
    return res.json({
      ok: true,
      accounts,
      defaultAccountId: normActId(metaAcc.defaultAccountId || ''),
      objective: metaAcc.objective || 'ventas',
    });
    
  } catch (error) {
    console.error('creative-intelligence/accounts error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
