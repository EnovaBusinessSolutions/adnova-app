'use strict';

const { z } = require('zod');

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const channelAds = z.enum(['meta', 'google']);
const channelAll = z.enum(['meta', 'google', 'all']);
const channelComparison = z.enum(['meta', 'google', 'shopify', 'all']);
const granularity = z.enum(['day', 'week', 'month', 'total']).default('total');
const campaignStatus = z.enum(['active', 'paused', 'all']).default('all');

const getAccountInfoInput = z.object({});

const getAdPerformanceInput = z.object({
  channel: channelAll,
  date_from: dateString,
  date_to: dateString,
  granularity: granularity.optional(),
});

const getCampaignPerformanceInput = z.object({
  channel: channelAds,
  date_from: dateString,
  date_to: dateString,
  limit: z.number().int().min(1).max(50).default(10).optional(),
  status: campaignStatus.optional(),
});

const getAdsetPerformanceInput = z.object({
  channel: channelAds,
  campaign_id: z.string().min(1),
  date_from: dateString,
  date_to: dateString,
});

const getShopifyRevenueInput = z.object({
  date_from: dateString,
  date_to: dateString,
  granularity: granularity.optional(),
});

const getShopifyProductsInput = z.object({
  date_from: dateString,
  date_to: dateString,
  sort_by: z.enum(['revenue', 'units_sold']).default('revenue').optional(),
  limit: z.number().int().min(1).max(50).default(10).optional(),
});

const getChannelSummaryInput = z.object({
  date_from: dateString,
  date_to: dateString,
});

const getDateComparisonInput = z.object({
  channel: channelComparison,
  period_a_from: dateString,
  period_a_to: dateString,
  period_b_from: dateString,
  period_b_to: dateString,
});

function validateDateRange(from, to, maxDays = 365) {
  const a = new Date(from);
  const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 'Invalid date format';
  if (a > b) return 'date_from must be before date_to';
  const diff = (b - a) / (1000 * 60 * 60 * 24);
  if (diff > maxDays) return `Date range exceeds ${maxDays} days`;
  return null;
}

module.exports = {
  getAccountInfoInput,
  getAdPerformanceInput,
  getCampaignPerformanceInput,
  getAdsetPerformanceInput,
  getShopifyRevenueInput,
  getShopifyProductsInput,
  getChannelSummaryInput,
  getDateComparisonInput,
  validateDateRange,
};
