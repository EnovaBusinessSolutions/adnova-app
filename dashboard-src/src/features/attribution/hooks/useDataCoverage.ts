import { useQuery } from '@tanstack/react-query';
import { fetchDataCoverage } from '../api/attribution';

export function useDataCoverage(shopId: string) {
  return useQuery({
    queryKey: ['attribution', 'data-coverage', shopId],
    queryFn: ({ signal }) => fetchDataCoverage(shopId, signal),
    enabled: !!shopId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
