import { useQuery } from "@tanstack/react-query";

export type Me = {
  _id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  primaryFocus?: string | null;
  profilePhotoUrl?: string | null;
  defaultWorkspaceId?: string | null;
  lastActiveWorkspaceId?: string | null;
  onboardingStep?: string;
};

async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();

  // El endpoint /api/me envuelve los datos en { ok, data, authenticated, user, plan, ... }.
  // Extraemos `data` (que tiene todos los campos del User) o `user` como fallback.
  // Si el response no tiene wrapper (formato antiguo o cache), usamos el response completo.
  const u = json?.data || json?.user || json;

  if (!u || !u._id) return null;

  return u as Me;
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: 0,
    staleTime: 30_000,
  });
}
