import { useQuery } from '@tanstack/react-query';
import { fetchAnalytics } from '../api/attribution';
import type { AttributionModel, RangePreset } from '../types';

interface UseAnalyticsParams {
  shopId: string;
  model: AttributionModel;
  range: RangePreset | 'custom';
  start?: string;
  end?: string;
}

export function useAnalytics({ shopId, model, range, start, end }: UseAnalyticsParams) {
  const rangeNum = range !== 'custom' ? range : undefined;

  return useQuery({
    queryKey: ['attribution', 'analytics', shopId, model, range, start, end],
    queryFn: ({ signal }) =>
      fetchAnalytics({ shopId, model, range: rangeNum, start, end }, signal),
    enabled: !!shopId,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
