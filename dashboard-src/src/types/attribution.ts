export type AttributionModel =
  | "last_touch"
  | "first_touch"
  | "linear"
  | "meta"
  | "google_ads";

export type AnalyticsShopOption = {
  shop?: string | null;
  type?: string | null;
  sources?: string[] | null;
  matchPlatforms?: string[] | null;
  isDefault?: boolean;
};

export type AnalyticsShopsResponse = {
  ok?: boolean;
  defaultShop?: string | null;
  defaultShopSource?: string | null;
  shops?: AnalyticsShopOption[];
};

export type SessionResponse = {
  authenticated?: boolean;
  user?: {
    shop?: string | null;
    resolvedShop?: string | null;
  };
};

export type AnalyticsSummary = {
  totalRevenue?: number;
  totalRevenueOrders?: number;
  totalRevenueEvents?: number;
  revenueSource?: string;
  totalOrders?: number;
  attributedRevenue?: number;
  attributedOrders?: number;
  unattributedOrders?: number;
  unattributedRevenue?: number;
  attributionModel?: AttributionModel | string;
  allTime?: boolean;
  startDate?: string;
  endDate?: string;
  recentLimit?: number;
  totalSessions?: number;
  conversionRate?: number;
  pageViews?: number;
  viewItem?: number;
  addToCart?: number;
  beginCheckout?: number;
  purchaseEvents?: number;
  purchaseEventsRaw?: number;
  purchaseOrders?: number;
  totalEvents?: number;
};

export type ChannelMetric = {
  revenue?: number;
  orders?: number;
};

export type AnalyticsChannels = Record<string, ChannelMetric>;

export type DailyPoint = {
  date: string;
  revenue?: number;
  orders?: number;
};

export type PaidMediaSource = {
  hasSnapshot?: boolean;
  spend?: number | null;
  revenue?: number | null;
  clicks?: number | null;
  roas?: number | null;
  connectedResourceName?: string | null;
  connectedResourceId?: string | null;
};

export type PaidMediaSummary = {
  linked?: boolean;
  available?: boolean;
  reason?: string | null;
  meta?: PaidMediaSource;
  google?: PaidMediaSource;
  tiktok?: PaidMediaSource;
  blended?: {
    spend?: number;
    revenue?: number;
    roas?: number | null;
    currency?: string | null;
  };
};

export type IntegrationHealthEntry = {
  connected?: boolean;
  status?: string | null;
  updatedAt?: string | null;
};

export type IntegrationHealth = {
  meta?: IntegrationHealthEntry;
  google?: IntegrationHealthEntry;
  tiktok?: IntegrationHealthEntry;
};

export type ProductSummary = {
  id?: string | null;
  name?: string | null;
  units?: number;
  revenue?: number;
  orderCount?: number;
};

export type JourneyEvent = {
  eventId?: string | null;
  eventName?: string | null;
  createdAt?: string;
  collectedAt?: string | null;
  sessionId?: string | null;
  pageUrl?: string | null;
  productId?: string | null;
  productName?: string | null;
  itemId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  ga4SessionSource?: string | null;
  utmEntryUrl?: string | null;
  utmSessionHistory?: unknown;
  utmBrowserHistory?: unknown;
  checkoutToken?: string | null;
  orderId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ttclid?: string | null;
  gclid?: string | null;
  clickId?: string | null;
  customerEmail?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
};

export type DeliveryPlatformStatus = {
  platform?: string | null;
  status?: string | null;
  sent?: boolean;
  [key: string]: unknown;
};

export type DeliveryStatus = {
  meta?: DeliveryPlatformStatus | null;
  google?: DeliveryPlatformStatus | null;
  tiktok?: DeliveryPlatformStatus | null;
};

export type AttributionSplit = {
  channel?: string | null;
  weight?: number;
};

export type RecentPurchase = {
  source?: string;
  createdAt?: string;
  storedAt?: string;
  orderId?: string | null;
  orderNumber?: string | null;
  checkoutToken?: string | null;
  sessionId?: string | null;
  userKey?: string | null;
  customerId?: string | null;
  emailHash?: string | null;
  phoneHash?: string | null;
  browserFingerprintHash?: string | null;
  revenue?: number;
  currency?: string | null;
  items?: Array<Record<string, unknown>>;
  customerName?: string | null;
  attributedChannel?: string | null;
  attributedPlatform?: string | null;
  attributedCampaign?: string | null;
  attributedCampaignLabel?: string | null;
  attributedAdset?: string | null;
  attributedAdsetLabel?: string | null;
  attributedAd?: string | null;
  attributedAdLabel?: string | null;
  attributedClickId?: string | null;
  attributionConfidence?: number;
  attributionSource?: string | null;
  attributionModel?: string | null;
  attributionSplits?: AttributionSplit[];
  isAttributed?: boolean;
  wooSourceLabel?: string | null;
  wooSourceType?: string | null;
  attributionDebug?: Record<string, unknown>;
  events?: JourneyEvent[];
  deliveryStatus?: DeliveryStatus;
};

export type AnalyticsDashboardResponse = {
  degraded?: boolean;
  degradedReason?: string;
  summary?: AnalyticsSummary;
  dataQuality?: {
    revenueSource?: string;
    fallbackActive?: boolean;
    snapshotUpdatedAt?: string | null;
  };
  integrationHealth?: IntegrationHealth;
  paidMedia?: PaidMediaSummary;
  events?: Record<string, number>;
  pixelHealth?: Record<string, number>;
  channels?: AnalyticsChannels;
  topProducts?: ProductSummary[];
  recentPurchases?: RecentPurchase[];
  daily?: DailyPoint[];
};

export type LiveFeedPayload = {
  eventName?: string | null;
  eventType?: string | null;
  timestamp?: string | null;
  pageUrl?: string | null;
  platform?: string | null;
  rawSource?: string | null;
  matchType?: string | null;
  confidenceScore?: number | null;
  collectedAt?: string | null;
  productId?: string | null;
  productName?: string | null;
  itemName?: string | null;
  cartValue?: number | null;
  checkoutToken?: string | null;
  orderId?: string | null;
  revenue?: number | null;
  currency?: string | null;
  source?: string | null;
};

export type LiveFeedEvent = {
  type?: string | null;
  accountId?: string | null;
  shopId?: string | null;
  sessionId?: string | null;
  userKey?: string | null;
  eventId?: string | null;
  timestamp?: string | null;
  payload?: LiveFeedPayload;
};
