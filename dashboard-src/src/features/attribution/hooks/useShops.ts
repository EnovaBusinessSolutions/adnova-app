import { useQuery } from '@tanstack/react-query';
import { fetchShops } from '../api/attribution';

export function useShops() {
  return useQuery({
    queryKey: ['attribution', 'shops'],
    queryFn: ({ signal }) => fetchShops(signal),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
