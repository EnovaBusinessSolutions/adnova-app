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
      // PATCH /api/me/profile devuelve { ok, user: { ...campos actualizados } }.
      // Hacemos MERGE con el cache existente (que tiene los campos del GET /api/me)
      // para no perder claves que el PATCH no devuelve (plan, subscription, etc.).
      if (data?.user) {
        queryClient.setQueryData<any>(['me'], (old: any) => ({
          ...(old || {}),
          ...data.user,
        }));
      }
      // No invalidamos: setQueryData ya tiene los datos frescos del server.
      // Si necesitamos refetch eventual, staleTime de useCurrentUser lo maneja.
    },
  });
}
