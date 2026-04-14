import type {
  AnalyticsDashboardResponse,
  AttributionModel,
  DeliveryPlatformStatus,
  JourneyEvent,
  LiveFeedEvent,
  RecentPurchase,
} from "@/types/attribution";

export const ATTRIBUTION_SHOP_STORAGE_KEY = "adray_analytics_shop";
export const JOURNEY_PAGE_SIZE = 10;
export const LIVE_FEED_PAGE_SIZE = 10;
export const LIVE_FEED_BUFFER_LIMIT = 80;

export const ATTRIBUTION_MODEL_OPTIONS: Array<{ value: AttributionModel; label: string }> = [
  { value: "last_touch", label: "Last click" },
  { value: "first_touch", label: "First click" },
  { value: "linear", label: "Linear" },
  { value: "meta", label: "Meta-assisted" },
  { value: "google_ads", label: "Google Ads-assisted" },
];

export const RANGE_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "180d", label: "180 days" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All history" },
] as const;

export type RangePreset = (typeof RANGE_OPTIONS)[number]["value"];

export function normalizeShop(value?: string | null) {
  return String(value || "").trim();
}

export function readStoredAttributionShop() {
  try {
    return normalizeShop(window.localStorage.getItem(ATTRIBUTION_SHOP_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function persistAttributionShop(shop: string) {
  try {
    window.localStorage.setItem(ATTRIBUTION_SHOP_STORAGE_KEY, shop);
  } catch {
    // noop
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload: any = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || text || `HTTP ${response.status}`);
  }

  return payload as T;
}

export function addDays(input: Date, amount: number) {
  const next = new Date(input);
  next.setDate(next.getDate() + amount);
  return next;
}

export function formatDateInput(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function buildPresetDates(preset: RangePreset) {
  const today = new Date();
  const end = formatDateInput(today);

  if (preset === "all") {
    return {
      start: "",
      end: "",
      allTime: true,
    };
  }

  const days =
    preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : preset === "180d" ? 180 : 30;

  return {
    start: formatDateInput(addDays(today, -(days - 1))),
    end,
    allTime: false,
  };
}

export function makePurchaseKey(purchase?: RecentPurchase | null) {
  if (!purchase) return "";
  return [
    purchase.orderId || "",
    purchase.checkoutToken || "",
    purchase.createdAt || "",
  ].join("::");
}

export function formatMoney(value?: number | null, currency = "MXN") {
  if (!Number.isFinite(Number(value))) return "—";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "MXN",
      maximumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return `$${Number(value || 0).toFixed(2)}`;
  }
}

export function formatNumber(value?: number | null) {
  if (!Number.isFinite(Number(value))) return "0";
  return new Intl.NumberFormat("en-US").format(Number(value));
}

export function formatPercent(value?: number | null, decimals = 0) {
  if (!Number.isFinite(Number(value))) return "0%";
  return `${(Number(value) * 100).toFixed(decimals)}%`;
}

export function formatTimestamp(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatShortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatRelativeGap(from?: string | null, to?: string | null) {
  if (!from || !to) return null;
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime <= fromTime) return null;

  const seconds = Math.round((toTime - fromTime) / 1000);
  if (seconds < 60) return `${seconds}s later`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m later`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h later`;

  const days = Math.round(hours / 24);
  return `${days}d later`;
}

export function resolveChannelTone(channel?: string | null) {
  const key = String(channel || "").trim().toLowerCase();
  if (key.includes("meta")) {
    return {
      badge: "border-[#6A82FF]/35 bg-[#6A82FF]/12 text-[#DCE4FF]",
      dot: "bg-[#6A82FF]",
    };
  }
  if (key.includes("google")) {
    return {
      badge: "border-[#F3C77A]/35 bg-[#F3C77A]/12 text-[#FFE6B8]",
      dot: "bg-[#F3C77A]",
    };
  }
  if (key.includes("tiktok")) {
    return {
      badge: "border-[#4FE3C1]/35 bg-[#4FE3C1]/12 text-[#DBFFF6]",
      dot: "bg-[#4FE3C1]",
    };
  }
  if (key.includes("organic") || key.includes("referral") || key.includes("direct")) {
    return {
      badge: "border-[#7EF0C8]/28 bg-[#7EF0C8]/10 text-[#DFFBF3]",
      dot: "bg-[#7EF0C8]",
    };
  }
  if (key.includes("other") || key.includes("unattributed")) {
    return {
      badge: "border-white/12 bg-white/[0.05] text-white/72",
      dot: "bg-white/55",
    };
  }

  return {
    badge: "border-white/12 bg-white/[0.05] text-white/78",
    dot: "bg-[#D2A7FF]",
  };
}

export function eventDisplayName(eventName?: string | null) {
  const normalized = String(eventName || "").trim().toLowerCase();
  if (!normalized) return "Unknown event";
  if (["page_view", "pageview", "view_page"].includes(normalized)) return "Page view";
  if (["view_item", "view_product", "product_view", "product_detail_view"].includes(normalized)) return "View product";
  if (["add_to_cart", "added_to_cart", "addtocart", "cart_add"].includes(normalized)) return "Add to cart";
  if (["begin_checkout", "checkout_started", "start_checkout"].includes(normalized)) return "Begin checkout";
  if (["purchase", "order_completed", "checkout_completed", "order_create", "orders_create"].includes(normalized)) return "Purchase";
  if (["user_logged_in", "user_login", "login"].includes(normalized)) return "User login";
  if (["user_logged_out", "user_logout", "logout"].includes(normalized)) return "User logout";
  return normalized
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isPurchaseEvent(eventName?: string | null) {
  return eventDisplayName(eventName) === "Purchase";
}

export function isSignificantJourneyEvent(eventName?: string | null) {
  const normalized = String(eventName || "").trim().toLowerCase();
  return [
    "page_view",
    "pageview",
    "view_page",
    "view_item",
    "view_product",
    "product_view",
    "product_detail_view",
    "add_to_cart",
    "added_to_cart",
    "addtocart",
    "cart_add",
    "begin_checkout",
    "checkout_started",
    "start_checkout",
    "purchase",
    "order_completed",
    "checkout_completed",
    "order_create",
    "orders_create",
    "user_logged_in",
    "user_login",
    "login",
  ].includes(normalized);
}

export function resolveAttributionLabel(purchase?: RecentPurchase | null) {
  if (!purchase) return "No campaign";

  return (
    purchase.attributedAdLabel ||
    purchase.attributedAdsetLabel ||
    purchase.attributedCampaignLabel ||
    purchase.attributedCampaign ||
    purchase.attributedPlatform ||
    purchase.attributedChannel ||
    purchase.wooSourceLabel ||
    "No campaign"
  );
}

export function extractJourneySignals(purchase?: RecentPurchase | null) {
  const labels = new Set<string>();
  const events = Array.isArray(purchase?.events) ? purchase?.events || [] : [];

  events.forEach((event) => {
    if (event.fbp) labels.add("FBP");
    if (event.fbc) labels.add("FBC");
    if (event.gclid) labels.add("GCLID");
    if (event.ttclid) labels.add("TTCLID");
    if (event.customerEmail) labels.add("Email (Hashed)");
    if (event.clientIp) labels.add("IP Address");
    if (event.userAgent) labels.add("User Agent");
  });

  return Array.from(labels);
}

export function parseMaybeJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function collectJourneyUtmHistory(purchase?: RecentPurchase | null) {
  const grouped = new Map<string, Array<{ url: string; source?: string | null; medium?: string | null; campaign?: string | null; capturedAt?: string | null }>>();

  const pushEntry = (
    sessionKey: string,
    entry: {
      url?: string | null;
      session_id?: string | null;
      captured_at?: string | null;
      utm_source?: string | null;
      utm_medium?: string | null;
      utm_campaign?: string | null;
      ga4_session_source?: string | null;
    }
  ) => {
    const url = String(entry.url || "").trim();
    if (!url) return;
    const list = grouped.get(sessionKey) || [];
    if (list.some((item) => item.url === url)) return;
    list.push({
      url,
      source: entry.utm_source || entry.ga4_session_source || null,
      medium: entry.utm_medium || null,
      campaign: entry.utm_campaign || null,
      capturedAt: entry.captured_at || null,
    });
    grouped.set(sessionKey, list);
  };

  (purchase?.events || []).forEach((event) => {
    const sessionKey = String(event.sessionId || "unlinked");
    if (event.utmEntryUrl) {
      pushEntry(sessionKey, {
        url: event.utmEntryUrl,
        utm_source: event.utmSource,
        utm_medium: event.utmMedium,
        utm_campaign: event.utmCampaign,
      });
    }

    parseMaybeJsonArray(event.utmSessionHistory).forEach((entry) => pushEntry(sessionKey, entry || {}));
    parseMaybeJsonArray(event.utmBrowserHistory).forEach((entry) => pushEntry(sessionKey, entry || {}));
  });

  return Array.from(grouped.entries()).map(([sessionKey, urls]) => ({
    sessionKey,
    urls,
  }));
}

export function buildJourneyNarrative(purchase?: RecentPurchase | null, sessionId?: string | null) {
  if (!purchase) return "No stitched touchpoints were found for this journey.";
  const channel = purchase.attributedChannel || purchase.attributedPlatform || purchase.wooSourceLabel || "Direct";
  const label = resolveAttributionLabel(purchase);
  const sessionEvents = (purchase.events || []).filter((event) => (sessionId ? event.sessionId === sessionId : true));
  const firstPage = sessionEvents.find((event) => event.pageUrl)?.pageUrl || null;
  const landing = firstPage ? safePathname(firstPage) : null;
  const purchaseInSession = sessionEvents.some((event) => isPurchaseEvent(event.eventName));

  const parts = [`Opened through ${channel}`];
  if (label && label !== "No campaign" && label !== channel) parts.push(`via ${label}`);
  if (landing) parts.push(`landing on ${landing}`);
  if (purchaseInSession) parts.push("Purchase completed in this session");
  return `${parts.join(", ")}.`;
}

export function safePathname(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw, window.location.origin);
    return parsed.pathname + parsed.search;
  } catch {
    return raw;
  }
}

export function getSessionIdsForPurchase(purchase?: RecentPurchase | null) {
  const sessionIds = new Set<string>();
  (purchase?.events || []).forEach((event) => {
    const sessionId = String(event.sessionId || "").trim();
    if (sessionId) sessionIds.add(sessionId);
  });
  return Array.from(sessionIds);
}

export function buildCondensedJourneyEvents(events: JourneyEvent[]) {
  const result: JourneyEvent[] = [];
  let previousKey = "";

  events.forEach((event, index) => {
    const currentKey = `${event.sessionId || "unlinked"}::${eventDisplayName(event.eventName)}`;
    const significant = isSignificantJourneyEvent(event.eventName);
    const keep = significant || index === 0 || index === events.length - 1;
    if (!keep) return;
    if (currentKey === previousKey && !isPurchaseEvent(event.eventName)) return;
    previousKey = currentKey;
    result.push(event);
  });

  return result;
}

export function groupJourneyEventsBySession(events: JourneyEvent[]) {
  const groups: Array<{ sessionId: string; events: JourneyEvent[] }> = [];
  const groupMap = new Map<string, { sessionId: string; events: JourneyEvent[] }>();

  events.forEach((event) => {
    const sessionId = String(event.sessionId || "unlinked");
    if (!groupMap.has(sessionId)) {
      const group = { sessionId, events: [] };
      groupMap.set(sessionId, group);
      groups.push(group);
    }
    groupMap.get(sessionId)?.events.push(event);
  });

  return groups;
}

export function liveFeedEventLabel(event: LiveFeedEvent) {
  return eventDisplayName(event.payload?.eventName || event.payload?.eventType);
}

export function liveFeedEventPath(event: LiveFeedEvent) {
  return safePathname(event.payload?.pageUrl);
}

export function liveFeedEventTimestamp(event: LiveFeedEvent) {
  return formatTimestamp(event.payload?.timestamp || event.timestamp || event.payload?.collectedAt);
}

export function liveFeedCommerceLabel(event: LiveFeedEvent) {
  const productName = String(event.payload?.productName || event.payload?.itemName || "").trim();
  if (productName) return productName;
  const productId = String(event.payload?.productId || "").trim();
  if (!productId) return null;
  return `Product ${productId}`;
}

export function summarizeDeliveryStatus(delivery?: DeliveryPlatformStatus | null) {
  if (!delivery) return "Not recorded";
  const status = String(delivery.status || "").trim().toLowerCase();
  if (!status) return "Not recorded";

  if (status === "accepted") return "Accepted";
  if (status === "sending") return "Sending";
  if (status === "queued") return "Queued";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "unknown") return "Unknown";
  return status
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function deliveryTone(status?: string | null) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "accepted") return "border-[#4FE3C1]/30 bg-[#4FE3C1]/10 text-[#DFFBF3]";
  if (normalized === "failed") return "border-red-400/25 bg-red-400/10 text-red-200";
  if (normalized === "sending" || normalized === "queued") return "border-[#F3C77A]/25 bg-[#F3C77A]/10 text-[#FFE6B8]";
  if (normalized === "skipped") return "border-white/10 bg-white/[0.05] text-white/68";
  return "border-white/10 bg-white/[0.05] text-white/70";
}

export function getInitialSelectedPurchase(data?: AnalyticsDashboardResponse | null) {
  return data?.recentPurchases?.[0] || null;
}
