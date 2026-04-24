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
  | 'linear';

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

/**
 * Response shape of GET /api/analytics/:id/pixel-health — the ad-blocker
 * bulletproof plan's coverage report (Phase D).
 */
export interface PixelHealthCoverage {
  accountId: string;
  windowDays: number;
  totalOrders: number;
  pixelCoverage: CoverageRatio;
  attributionCoverage: CoverageRatio;
  serverSideCoverage: CoverageRatio;
  blockedOrders: { count: number; total: number; rate: number };
  generatedAt: string;
}

export interface CoverageRatio {
  covered?: number;
  attributed?: number;
  total: number;
  rate: number;
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
  capturedAt: string | null;   // client-clock timestamp (preferred for ordering)
  seq: number | null;          // per-session monotonic sequence
  postPurchase: boolean;       // true if fired after purchase was captured
  collectedAt: string | null;
  pageUrl: string | null;
  productId: string | null;
  productName: string | null;
  itemId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  sessionId: string | null;
  userKey: string | null;
  checkoutToken: string | null;
  orderId: string | null;
  fbp: string | null;
  fbc: string | null;
  ttclid: string | null;
  gclid: string | null;
  fbclid: string | null;
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
  attributedPlatform: string | null;
  attributedCampaign: string | null;
  attributedAdset: string | null;
  attributedAd: string | null;
  attributedClickId: string | null;
  attributedClickIdProvider?: 'meta' | 'google' | 'tiktok' | null;
  attributionConfidence?: number | null;
  attributionSource?: string | null;
  confidenceScore: number | null;
  createdAt: string;
  sessionId: string | null;
  rrwebRecordingId: string | null;
  behavioralSignals: unknown;
  recordingStatus: string | null;
  customerName: string | null;
  items: LineItem[];
  events: JourneyEvent[];
  // BRI fields
  briArchetype: string | null;
  briConfidence: number | null;
  briOrganicConverter: boolean | null;
  briExcludeFromRetargeting: boolean | null;
  briCustomerTier: string | null;
  briNextBestAction: { type: string; content: string; priority: string } | null;
}

export interface LiveFeedEvent {
  type: string;
  accountId: string;
  sessionId?: string;
  userKey?: string;
  customerName?: string;
  eventId?: string;
  timestamp?: string;
  customerName?: string | null;
  payload?: {
    customerName?: string | null;
    eventName: string;
    timestamp: string;
    pageUrl?: string;
    platform?: string;
    rawSource?: string;
    matchType?: string | null;
    confidenceScore?: number | null;
    collectedAt?: string;
    productId?: string | null;
    customerName?: string | null;
    channel?: string;            // meta / google / tiktok / organic / other / direct
    channelRaw?: string;
    channelPlatform?: string | null;
    channelSource?: 'click_id' | 'utm' | 'referrer' | 'none';
    clickIdProvider?: 'meta' | 'google' | 'tiktok' | null;
    utmCampaign?: string | null;
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

// ─── Session Explorer ─────────────────────────────────────────
export interface SessionProfile {
  profileKey: string;
  profileType: string;
  profileLabel: string;
  customerDisplayName: string | null;
  customerId: string | null;
  sessionCount: number;
  orderCount: number;
  totalRevenue: number;
  recentSessionId: string | null;
  recentSessionStartedAt: string | null;
  lastSeenAt: string | null;
  lastOrderAt: string | null;
  lastLandingPageUrl: string | null;
  lastCampaign: string | null;
}

export interface SessionExplorerResponse {
  summary: {
    storePlatform: string;
    totalProfiles: number;
    totalSessions: number;
    totalOrders: number;
    totalRevenue: number;
  };
  profiles: SessionProfile[];
  degraded?: boolean;
  cache?: { hit: boolean; ttlMs: number };
}

// ─── Session Detail ───────────────────────────────────────────
export interface SessionMetrics {
  totalEvents: number;
  logins: number;
  pageViews: number;
  viewItem: number;
  addToCart: number;
  beginCheckout: number;
  purchase: number;
  revenue: number;
  uniquePages: number;
  uniqueProducts: number;
  orderCount: number;
}

export interface SessionTimelineEvent {
  eventId: string;
  eventName: string;
  bucket: string;
  createdAt: string;
  collectedAt: string | null;
  pageUrl: string;
  productId: string;
  revenue: number;
  currency: string;
  utmSource: string | null;
  utmCampaign: string | null;
  customerId: string | null;
  customerName: string | null;
}

export interface SessionDetailData {
  session: {
    sessionId: string;
    accountId: string;
    userKey: string;
    startedAt: string;
    lastEventAt: string;
    sessionEndAt: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    referrer: string | null;
    landingPageUrl: string | null;
    fbclid: string | null;
    gclid: string | null;
    ttclid: string | null;
    clarityPlaybackUrl: string | null;
    sessionDurationSeconds: number;
  };
  metrics: SessionMetrics;
  journey: {
    entryPage: string | null;
    exitPage: string | null;
    attribution: {
      channel: string;
      platform: string | null;
      campaign: string | null;
      confidence: number;
      source: string;
    };
  };
  timeline: SessionTimelineEvent[];
}

// ─── Recording ────────────────────────────────────────────────
export interface RecordingInfo {
  recordingId: string;
  sessionId: string;
  status: string;
  outcome: string | null;
  cartValue: number | null;
  durationMs: number | null;
  triggerAt: string | null;
  deviceType?: string | null;
  userKey?: string;
  orderId?: string | null;
  customerName?: string | null;
  customerEmailMasked?: string | null;
}

export interface RecordingDetailResponse {
  ok: boolean;
  recording: RecordingInfo | null;
  presignedUrl: string | null;
  sessionId: string;
}

// ─── Data Coverage ────────────────────────────────────────────
export interface FieldState {
  ok: boolean;
  count?: number;
  ratio?: number | null;
  note?: string;
  value?: number | null;
  [key: string]: unknown;
}

export interface DataCoverageResponse {
  success: boolean;
  accountId: string;
  windowDays: number;
  since: string;
  warnings: Array<{ label: string; error: string }>;
  totals: {
    events: number;
    sessions: number;
    orders: number;
    identities: number;
    checkoutMaps: number;
  };
  layers: {
    layer1_identity_anchors: Record<string, FieldState>;
    layer2_session_events: Record<string, FieldState>;
    layer3_touchpoints_click_ids: Record<string, FieldState>;
    layer4_order_truth: Record<string, FieldState>;
    layer5_platform_signals_daily_pull: Record<string, FieldState>;
    layer6_raw_enrichment_every_event: Record<string, FieldState>;
    critical_stitch: Record<string, FieldState>;
  };
  missing: string[];
}
