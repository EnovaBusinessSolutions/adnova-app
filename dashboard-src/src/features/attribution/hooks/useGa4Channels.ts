import { useQuery } from '@tanstack/react-query';
import { fetchGa4Channels } from '../api/attribution';

export function useGa4Channels(shopId: string) {
  return useQuery({
    queryKey: ['attribution', 'ga4-channels', shopId],
    queryFn: ({ signal }) => fetchGa4Channels(shopId, signal),
    enabled: !!shopId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
