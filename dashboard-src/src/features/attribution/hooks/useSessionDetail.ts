import { useQuery } from '@tanstack/react-query';
import { fetchSessionDetail } from '../api/attribution';

export function useSessionDetail(shopId: string, sessionId: string | null) {
  return useQuery({
    queryKey: ['attribution', 'session', shopId, sessionId],
    queryFn: ({ signal }) => fetchSessionDetail(shopId, sessionId!, signal),
    enabled: !!shopId && !!sessionId,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
