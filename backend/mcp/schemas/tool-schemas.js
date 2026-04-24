'use strict';

const { z } = require('zod');

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
// LLM clients (Claude.ai, ChatGPT) sometimes send null for date_from/date_to
// when the user asks an open-ended question like "what was my spend last week".
// Accept null/undefined at the schema level and default in the handler via
// resolveDateRangeDefaults() — this keeps Zod validation happy and makes tool
// calls forgiving for the user without losing regex validation when a real
// date string is provided.
const dateStringOrNull = dateString.nullable().optional();

const dateFromDesc =
  'Start of the date range (inclusive) as YYYY-MM-DD in UTC. Omit or pass null to default to 30 days before date_to.';
const dateToDesc =
  'End of the date range (inclusive) as YYYY-MM-DD in UTC. Omit or pass null to default to today.';

const channelAds = z
  .enum(['meta', 'google'])
  .describe('Ad channel: "meta" for Facebook/Instagram Ads, "google" for Google Ads.');
const channelAll = z
  .enum(['meta', 'google', 'all'])
  .describe('Ad channel: "meta", "google", or "all" to fetch both in parallel.');
const channelComparison = z
  .enum(['meta', 'google', 'shopify', 'all'])
  .describe('Source to compare: "meta", "google", "shopify", or "all" combined.');
const granularity = z
  .enum(['day', 'week', 'month', 'total'])
  .default('total')
  .describe(
    'Time bucketing for rows: "day" / "week" / "month" produce a time series; "total" returns a single aggregate.'
  );
const campaignStatus = z
  .enum(['active', 'paused', 'all'])
  .default('all')
  .describe('Filter campaigns by status. Defaults to "all".');

const getAccountInfoInput = z.object({});

const getAdPerformanceInput = z.object({
  channel: channelAll,
  date_from: dateStringOrNull.describe(dateFromDesc),
  date_to: dateStringOrNull.describe(dateToDesc),
  granularity: granularity.optional(),
});

const getCampaignPerformanceInput = z.object({
  channel: channelAds,
  date_from: dateStringOrNull.describe(dateFromDesc),
  date_to: dateStringOrNull.describe(dateToDesc),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .optional()
    .describe('Maximum number of campaigns to return, ordered by spend desc. 1–50, defaults to 10.'),
  status: campaignStatus.optional(),
});

const getAdsetPerformanceInput = z.object({
  channel: channelAds,
  campaign_id: z
    .string()
    .min(1)
    .describe(
      'Platform campaign ID to drill into. Obtain it from get_campaign_performance.campaigns[].campaign_id.'
    ),
  date_from: dateStringOrNull.describe(dateFromDesc),
  date_to: dateStringOrNull.describe(dateToDesc),
});

const getShopifyRevenueInput = z.object({
  date_from: dateStringOrNull.describe(dateFromDesc),
  date_to: dateStringOrNull.describe(dateToDesc),
  granularity: granularity.optional(),
});

const getShopifyProductsInput = z.object({
  date_from: dateStringOrNull.describe(dateFromDesc),
  date_to: dateStringOrNull.describe(dateToDesc),
  sort_by: z
    .enum(['revenue', 'units_sold'])
    .default('revenue')
    .optional()
    .describe('Sort the product ranking by "revenue" (default) or "units_sold".'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .optional()
    .describe('Maximum number of products to return. 1–50, defaults to 10.'),
});

const getChannelSummaryInput = z.object({
  date_from: dateStringOrNull.describe(dateFromDesc),
  date_to: dateStringOrNull.describe(dateToDesc),
});

const getDateComparisonInput = z.object({
  channel: channelComparison,
  period_a_from: dateStringOrNull.describe(
    'Start of period A (the earlier/baseline window). YYYY-MM-DD in UTC. Defaults anchor off period_b.'
  ),
  period_a_to: dateStringOrNull.describe(
    'End of period A (inclusive). YYYY-MM-DD in UTC.'
  ),
  period_b_from: dateStringOrNull.describe(
    'Start of period B (the more recent window). YYYY-MM-DD in UTC. Defaults to 30 days before period_b_to.'
  ),
  period_b_to: dateStringOrNull.describe(
    'End of period B (inclusive). YYYY-MM-DD in UTC. Defaults to today.'
  ),
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

/** Returns today in UTC as YYYY-MM-DD. */
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/** Subtracts `days` from a YYYY-MM-DD string and returns a new YYYY-MM-DD string. */
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fill in sensible defaults when the LLM omits/nulls date_from or date_to.
 * - date_to defaults to today (UTC).
 * - date_from defaults to `fallbackDays` days before date_to.
 * Always returns concrete YYYY-MM-DD strings.
 */
function resolveDateRangeDefaults(dateFrom, dateTo, fallbackDays = 30) {
  const to = dateTo || todayUTC();
  const from = dateFrom || shiftDate(to, -fallbackDays);
  return { date_from: from, date_to: to };
}

/**
 * Fill in defaults for a two-period comparison.
 * When dates are missing we default to "last 30 days" vs "previous 30 days"
 * so get_date_comparison still returns something useful when the LLM is lazy.
 * Period A = earlier window, Period B = recent window.
 */
function resolveComparisonDefaults(periodAFrom, periodATo, periodBFrom, periodBTo, fallbackDays = 30) {
  const pbTo = periodBTo || todayUTC();
  const pbFrom = periodBFrom || shiftDate(pbTo, -fallbackDays);
  const paTo = periodATo || shiftDate(pbFrom, -1);
  const paFrom = periodAFrom || shiftDate(paTo, -fallbackDays);
  return {
    period_a_from: paFrom,
    period_a_to: paTo,
    period_b_from: pbFrom,
    period_b_to: pbTo,
  };
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
  resolveDateRangeDefaults,
  resolveComparisonDefaults,
};
