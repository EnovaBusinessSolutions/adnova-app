import { useMutation, useQueryClient } from '@tanstack/react-query';

type ProfilePatch = {
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  primaryFocus?: string | null;
  profilePhotoUrl?: string;
  onboardingStep?: 'NONE' | 'WORKSPACE_CREATED' | 'PROFILE_COMPLETE' | 'COMPLETE';
};

async function patchProfile(payload: ProfilePatch) {
  const res = await fetch('/api/me/profile', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchProfile,
    onSuccess: (data) => {
      // El endpoint devuelve { ok, user }. Inyectamos directo en el cache
      // para que useCurrentUser tenga los datos frescos sin esperar refetch.
      if (data?.user) {
        queryClient.setQueryData(['me'], data.user);
      }
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
