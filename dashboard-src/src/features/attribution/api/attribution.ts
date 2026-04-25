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

