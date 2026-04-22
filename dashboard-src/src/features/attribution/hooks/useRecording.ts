import { useQuery } from '@tanstack/react-query';
import { fetchRecording } from '../api/attribution';

export function useRecording(shopId: string, recordingId: string | null) {
  return useQuery({
    queryKey: ['attribution', 'recording', shopId, recordingId],
    queryFn: ({ signal }) => fetchRecording(shopId, recordingId!, signal),
    enabled: !!shopId && !!recordingId,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
