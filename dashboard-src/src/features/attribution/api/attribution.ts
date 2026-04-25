import type {
  ShopsResponse,
  AnalyticsResponse,
  AttributionModel,
  SessionExplorerResponse,
  SessionDetailData,
  RecordingDetailResponse,
  DataCoverageResponse,
} from '../types';

export interface FetchAnalyticsParams {
  shopId: string;
  model: AttributionModel;
  range?: number;
  start?: string;
  end?: string;
}

export async function fetchShops(signal?: AbortSignal): Promise<ShopsResponse> {
  const res = await fetch('/api/analytics/shops', { credentials: 'include', signal });
  if (!res.ok) throw new Error(`Failed to fetch shops: ${res.status}`);
  return res.json() as Promise<ShopsResponse>;
}

export async function fetchAnalytics(
  params: FetchAnalyticsParams,
  signal?: AbortSignal,
): Promise<AnalyticsResponse> {
  const { shopId, model, range, start, end } = params;
  const qs = new URLSearchParams({ attribution_model: model });
  if (range != null) qs.set('range', String(range));
  if (start) qs.set('start', start);
  if (end) qs.set('end', end);
  // Match the per-channel counts shown in the attribution chart: ask the
  // backend for every modeled conversion in the period so the Conversion
  // Paths panel can filter across the full set, not just the latest 100.
  qs.set('recent_limit', 'all');

  const res = await fetch(`/api/analytics/${encodeURIComponent(shopId)}?${qs}`, {
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch analytics: ${res.status}`);
  return res.json() as Promise<AnalyticsResponse>;
}

export async function fetchSessionExplorer(
  shopId: string,
  signal?: AbortSignal,
): Promise<SessionExplorerResponse> {
  const res = await fetch(
    `/api/analytics/${encodeURIComponent(shopId)}/session-explorer`,
    { credentials: 'include', signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch session explorer: ${res.status}`);
  return res.json() as Promise<SessionExplorerResponse>;
}

export async function fetchSessionDetail(
  shopId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionDetailData> {
  const res = await fetch(
    `/api/analytics/${encodeURIComponent(shopId)}/sessions/${encodeURIComponent(sessionId)}`,
    { credentials: 'include', signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch session detail: ${res.status}`);
  return res.json() as Promise<SessionDetailData>;
}

export async function fetchRecording(
  shopId: string,
  recordingId: string,
  signal?: AbortSignal,
): Promise<RecordingDetailResponse> {
  const res = await fetch(
    `/api/recording/${encodeURIComponent(shopId)}/${encodeURIComponent(recordingId)}`,
    { credentials: 'include', signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch recording: ${res.status}`);
  return res.json() as Promise<RecordingDetailResponse>;
}

export async function fetchDataCoverage(
  shopId: string,
  signal?: AbortSignal,
): Promise<DataCoverageResponse> {
  const res = await fetch(
    `/api/analytics/${encodeURIComponent(shopId)}/data-coverage`,
    { credentials: 'include', signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch data coverage: ${res.status}`);
  return res.json() as Promise<DataCoverageResponse>;
}

export interface Ga4ChannelsResponse {
  available: boolean;
  reason?: string;
  source?: 'ga4';
  range?: { from?: string | null; to?: string | null; tz?: string | null } | null;
  channels?: {
    meta:         { orders: number; revenue: number };
    google:       { orders: number; revenue: number };
    tiktok:       { orders: number; revenue: number };
    organic:      { orders: number; revenue: number };
    other:        { orders: number; revenue: number };
    unattributed: { orders: number; revenue: number };
  };
  totalOrders?: number;
  totalRevenue?: number;
  generatedAt?: string | null;
  raw?: Array<{ channel: string; conversions: number; revenue: number; sessions: number }>;
}

export async function fetchGa4Channels(
  shopId: string,
  signal?: AbortSignal,
): Promise<Ga4ChannelsResponse> {
  const res = await fetch(
    `/api/analytics/${encodeURIComponent(shopId)}/ga4-channels`,
    { credentials: 'include', signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch GA4 channels: ${res.status}`);
  return res.json() as Promise<Ga4ChannelsResponse>;
}

