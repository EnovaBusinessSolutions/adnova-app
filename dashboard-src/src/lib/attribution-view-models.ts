import {
  deliveryTone,
  extractJourneySignals,
  formatMoney,
  formatNumber,
  formatPercent,
  getSessionIdsForPurchase,
  resolveAttributionLabel,
  summarizeDeliveryStatus,
} from "@/lib/attribution";
import type {
  AnalyticsDashboardResponse,
  DeliveryPlatformStatus,
  RecentPurchase,
} from "@/types/attribution";

export type SummaryCardModel = {
  label: string;
  value: string;
  helper: string;
  accentClassName: string;
};

export type ChartPoint = {
  label: string;
  revenue: number;
  orders: number;
};

export type DeliveryPlatformRow = {
  key: "meta" | "google" | "tiktok";
  label: string;
  statusLabel: string;
  toneClassName: string;
  detailLines: string[];
};

const PLATFORM_LABELS: Record<DeliveryPlatformRow["key"], string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
};

function humanizeKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (value) => value.toUpperCase());
}

function formatReceiptValue(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractReceiptDetails(delivery?: DeliveryPlatformStatus | null) {
  if (!delivery) return [];

  const detailLines: string[] = [];
  const preferredKeys = [
    "destination",
    "attempts",
    "sentAt",
    "recordedAt",
    "jobId",
    "requestId",
    "fbtrace_id",
    "fbtraceId",
    "testEventCode",
    "conversionAction",
    "clickId",
    "reason",
    "message",
    "note",
  ];

  preferredKeys.forEach((key) => {
    const formatted = formatReceiptValue(delivery[key]);
    if (!formatted) return;
    detailLines.push(`${humanizeKey(key)}: ${formatted}`);
  });

  Object.entries(delivery).forEach(([key, value]) => {
    if (["platform", "status", "sent", ...preferredKeys].includes(key)) return;
    const formatted = formatReceiptValue(value);
    if (!formatted) return;
    detailLines.push(`${humanizeKey(key)}: ${formatted}`);
  });

  return detailLines;
}

function shouldShowPlatform(key: DeliveryPlatformRow["key"], purchase?: RecentPurchase | null) {
  if (!purchase) return false;

  const delivery = purchase.deliveryStatus?.[key];
  if (delivery) return true;

  const events = purchase.events || [];
  const channel = `${purchase.attributedChannel || ""} ${purchase.attributedPlatform || ""}`.toLowerCase();

  if (key === "meta") {
    return channel.includes("meta") || events.some((event) => Boolean(event.fbp || event.fbc));
  }
  if (key === "google") {
    return channel.includes("google") || events.some((event) => Boolean(event.gclid));
  }
  return channel.includes("tiktok") || events.some((event) => Boolean(event.ttclid));
}

export function buildSummaryCards(data?: AnalyticsDashboardResponse | null): SummaryCardModel[] {
  const summary = data?.summary;

  return [
    {
      label: "Revenue",
      value: formatMoney(summary?.totalRevenue, "MXN"),
      helper: `${formatNumber(summary?.purchaseOrders)} orders recorded`,
      accentClassName: "from-[#B55CFF]/30 to-[#7C3AED]/10",
    },
    {
      label: "Attributed revenue",
      value: formatMoney(summary?.attributedRevenue, "MXN"),
      helper: `${formatNumber(summary?.attributedOrders)} attributed orders`,
      accentClassName: "from-[#4FE3C1]/25 to-transparent",
    },
    {
      label: "Conversion rate",
      value: formatPercent(summary?.conversionRate, 1),
      helper: `${formatNumber(summary?.totalSessions)} stitched sessions`,
      accentClassName: "from-[#F3C77A]/22 to-transparent",
    },
    {
      label: "Live events",
      value: formatNumber(summary?.totalEvents),
      helper: `${formatNumber(summary?.pageViews)} page views, ${formatNumber(summary?.addToCart)} carts`,
      accentClassName: "from-[#60A5FA]/20 to-transparent",
    },
  ];
}

export function buildChannelChartData(data?: AnalyticsDashboardResponse | null): ChartPoint[] {
  return Object.entries(data?.channels || {})
    .map(([label, metric]) => ({
      label,
      revenue: Number(metric?.revenue || 0),
      orders: Number(metric?.orders || 0),
    }))
    .filter((entry) => entry.revenue > 0 || entry.orders > 0)
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 8);
}

export function buildDailyRevenueChartData(data?: AnalyticsDashboardResponse | null): ChartPoint[] {
  return (data?.daily || []).map((point) => ({
    label: point.date,
    revenue: Number(point.revenue || 0),
    orders: Number(point.orders || 0),
  }));
}

export function buildJourneySummary(purchase?: RecentPurchase | null) {
  return {
    sessionCount: getSessionIdsForPurchase(purchase).length,
    signalChips: extractJourneySignals(purchase),
    attributionLabel: resolveAttributionLabel(purchase),
  };
}

export function buildDeliveryPlatformRows(
  purchase?: RecentPurchase | null
): DeliveryPlatformRow[] {
  const keys: DeliveryPlatformRow["key"][] = ["meta", "google", "tiktok"];

  return keys
    .filter((key) => shouldShowPlatform(key, purchase))
    .map((key) => {
      const delivery = purchase?.deliveryStatus?.[key] || null;
      return {
        key,
        label: PLATFORM_LABELS[key],
        statusLabel: summarizeDeliveryStatus(delivery),
        toneClassName: deliveryTone(delivery?.status),
        detailLines: extractReceiptDetails(delivery),
      };
    });
}
