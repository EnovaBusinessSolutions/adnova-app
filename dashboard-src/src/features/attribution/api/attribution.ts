import type { ShopsResponse, AnalyticsResponse, AttributionModel } from '../types';

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
