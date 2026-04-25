import { useQuery } from "@tanstack/react-query";

type Me = {
  _id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  defaultWorkspaceId?: string | null;
  lastActiveWorkspaceId?: string | null;
  onboardingStep?: string;
};

async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: 0,
  });
}
