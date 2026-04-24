'use strict';

/**
 * Output schemas for MCP tools.
 *
 * These are intentionally permissive — they declare the top-level fields that
 * clients and LLMs can rely on, but use `.passthrough()` so backend changes
 * that add new fields do not break tool calls. The SDK validates
 * `structuredContent` against these schemas when a tool declares `outputSchema`
 * (see @modelcontextprotocol/sdk/dist/cjs/server/mcp.js validateToolOutput).
 *
 * Tools whose output shape is not a stable single object (e.g. get_ad_performance
 * returns an array when channel="all") intentionally have NO output schema —
 * structured content is still emitted via createToolResponse but is not
 * validated.
 */

const { z } = require('zod');

const dateRangeFields = {
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  currency: z.string().nullable().optional(),
};

const getAccountInfoOutput = z
  .object({
    connected_accounts: z
      .array(
        z
          .object({
            platform: z.string(),
            account_id: z.string().nullable().optional(),
            account_name: z.string().nullable().optional(),
            currency: z.string().nullable().optional(),
            timezone: z.string().nullable().optional(),
            status: z.string().optional(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();

const getCampaignPerformanceOutput = z
  .object({
    channel: z.string().optional(),
    campaigns: z.array(z.record(z.any())).default([]),
    total_spend: z.number().optional(),
    ...dateRangeFields,
  })
  .passthrough();

const getAdsetPerformanceOutput = z
  .object({
    channel: z.string().optional(),
    campaign_id: z.string().nullable().optional(),
    campaign_name: z.string().nullable().optional(),
    adsets: z.array(z.record(z.any())).default([]),
    ...dateRangeFields,
  })
  .passthrough();

const getShopifyRevenueOutput = z
  .object({
    total_revenue: z.number().optional(),
    net_revenue: z.number().optional(),
    total_orders: z.number().optional(),
    average_order_value: z.number().optional(),
    new_customer_orders: z.number().optional(),
    returning_customer_orders: z.number().optional(),
    new_customer_pct: z.number().optional(),
    ...dateRangeFields,
    rows: z.array(z.record(z.any())).optional(),
  })
  .passthrough();

const getShopifyProductsOutput = z
  .object({
    products: z.array(z.record(z.any())).default([]),
    ...dateRangeFields,
  })
  .passthrough();

// channel_summary and date_comparison responses are aggregate objects built by
// services/adsPerformanceResolve.js. Shape can evolve, so stay permissive.
const getChannelSummaryOutput = z.object({}).passthrough();
const getDateComparisonOutput = z.object({}).passthrough();

module.exports = {
  getAccountInfoOutput,
  getCampaignPerformanceOutput,
  getAdsetPerformanceOutput,
  getShopifyRevenueOutput,
  getShopifyProductsOutput,
  getChannelSummaryOutput,
  getDateComparisonOutput,
};
