export interface Shop {
  shop: string;
  type: string;
  sources: string[];
  matchPlatforms: string[];
  isDefault: boolean;
}

export interface ShopsResponse {
  ok: boolean;
  defaultShop: string | null;
  defaultShopSource: string | null;
  shops: Shop[];
}

export type AttributionModel =
  | 'last_touch'
  | 'first_touch'
  | 'linear'
  | 'time_decay'
  | 'position';

export type RangePreset = 7 | 14 | 30 | 90;

export interface ChannelStats {
  revenue: number;
  orders: number;
}

export interface AnalyticsSummary {
  totalRevenue: number;
  totalRevenueOrders: number;
  totalRevenueEvents: number;
  revenueSource: 'orders' | 'events';
  totalOrders: number;
  attributedRevenue: number;
  attributedOrders: number;
  unattributedOrders: number;
  unattributedRevenue: number;
  attributionModel: AttributionModel;
  allTime: boolean;
  startDate: string;
  endDate: string;
  recentLimit: number;
  totalSessions: number;
  conversionRate: number;
  pageViews: number;
  viewItem: number;
  addToCart: number;
  beginCheckout: number;
  purchaseEvents: number;
  purchaseEventsRaw: number;
  purchaseOrders: number;
  totalEvents: number;
}

export interface IntegrationStatus {
  connected: boolean;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  updatedAt: string | null;
}

export interface PaidMediaPlatform {
  hasSnapshot: boolean;
  spend: number | null;
  revenue: number | null;
  clicks: number | null;
  roas?: number | null;
}

export interface PaidMedia {
  linked: boolean;
  available: boolean;
  reason: string;
  meta: PaidMediaPlatform;
  google: PaidMediaPlatform;
  blended: {
    spend: number;
    revenue: number;
    roas: number | null;
    currency: string | null;
  };
}

export interface EventStats {
  page_view: number;
  view_item: number;
  add_to_cart: number;
  begin_checkout: number;
  purchase: number;
  other: number;
  total: number;
}

export interface PixelHealth {
  eventsReceived: number;
  purchaseSignals: number;
  orders: number;
  matchedOrders: number;
  orderMatchRate: number;
  purchaseSignalCoverage: number;
}

export interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
}

export interface TopProduct {
  id: string;
  name: string;
  revenue: number;
  quantity: number;
}

export interface LineItem {
  product_id?: string | number;
  productId?: string | number;
  variant_id?: string | number;
  name?: string;
  title?: string;
  price?: number | string;
  quantity?: number;
  [key: string]: unknown;
}

export interface JourneyEvent {
  eventId: string;
  eventName: string;
  createdAt: string;
  collectedAt: string | null;
  pageUrl: string | null;
  productId: string | null;
  productName: string | null;
  itemId: string | null;
  utmSource: string | null;
  checkoutToken: string | null;
  orderId: string | null;
  fbp: string | null;
  fbc: string | null;
  ttclid: string | null;
  gclid: string | null;
  clickId: string | null;
  customerEmail: string | null;
  clientIp: string | null;
  userAgent: string | null;
}

export interface RecentPurchase {
  orderId: string;
  orderNumber: string | null;
  revenue: number;
  currency: string | null;
  attributedChannel: string | null;
  confidenceScore: number | null;
  createdAt: string;
  sessionId: string | null;
  rrwebRecordingId: string | null;
  behavioralSignals: unknown;
  recordingStatus: string | null;
  items: LineItem[];
  events: JourneyEvent[];
}

export interface LiveFeedEvent {
  type: string;
  accountId: string;
  sessionId?: string;
  userKey?: string;
  eventId?: string;
  timestamp?: string;
  payload?: {
    eventName: string;
    timestamp: string;
    pageUrl?: string;
    platform?: string;
    rawSource?: string;
    matchType?: string | null;
    confidenceScore?: number | null;
    collectedAt?: string;
    productId?: string | null;
    [key: string]: unknown;
  };
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary;
  dataQuality: {
    revenueSource: 'orders' | 'events';
    fallbackActive: boolean;
    snapshotUpdatedAt: string | null;
  };
  integrationHealth: {
    meta: IntegrationStatus;
    google: IntegrationStatus;
    tiktok: IntegrationStatus;
  };
  paidMedia: PaidMedia;
  events: EventStats;
  pixelHealth: PixelHealth;
  channels: {
    meta: ChannelStats;
    google: ChannelStats;
    tiktok: ChannelStats;
    organic: ChannelStats;
    other: ChannelStats;
    unattributed: ChannelStats;
  };
  topProducts: TopProduct[];
  recentPurchases: RecentPurchase[];
  daily: DailyPoint[];
  degraded?: boolean;
  degradedReason?: string;
  cache?: { hit: boolean; ttlMs: number };
}
