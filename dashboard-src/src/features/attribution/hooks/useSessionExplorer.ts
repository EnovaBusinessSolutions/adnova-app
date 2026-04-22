import { useQuery } from '@tanstack/react-query';
import { fetchSessionExplorer } from '../api/attribution';

export function useSessionExplorer(shopId: string) {
  return useQuery({
    queryKey: ['attribution', 'session-explorer', shopId],
    queryFn: ({ signal }) => fetchSessionExplorer(shopId, signal),
    enabled: !!shopId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
